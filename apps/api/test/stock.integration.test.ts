import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.4 P4 — the warehouse layer: locations, the append-only ledger as the
 * truth (cache == Σ movements asserted), guarded issue/adjust/transfer/
 * reserve, count corrections, stock→asset conversion, the INV concurrency
 * storm, and the per-location low-stock alert.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let itemId: string;
let locA: string;
let locB: string;

const base = '/api/v1/stock';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  // A dedicated item so quantity churn never touches other suites' fixtures.
  const category = await prisma.client.category.findFirst({
    where: { companyId: s.superAdmin.user.companyId },
    select: { id: true },
  });
  const item = await prisma.client.inventoryItem.create({
    data: {
      companyId: s.superAdmin.user.companyId,
      sku: `STOCK-TEST-${Date.now()}`,
      name: 'Stock Suite Probe Item',
      categoryId: category!.id,
      unit: 'unit',
      minStock: 2,
      createdById: s.superAdmin.user.id,
    },
    select: { id: true },
  });
  itemId = item.id;

  const a = await api(app)
    .post(`${base}/locations`)
    .set(auth(s.superAdmin))
    .send({ code: `WH-A-${Date.now() % 100000}`, name: 'Warehouse A' });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  locA = a.body.data.id;
  const b = await api(app)
    .post(`${base}/locations`)
    .set(auth(s.superAdmin))
    .send({ code: `WH-B-${Date.now() % 100000}`, name: 'Warehouse B' });
  locB = b.body.data.id;
});

afterAll(async () => {
  await prisma.client.stockMovement.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.stockLevel.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.stockTransfer.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.inventoryItem.delete({ where: { id: itemId } }).catch(() => undefined);
  await prisma.client.stockLocation.deleteMany({ where: { id: { in: [locA, locB] } } });
  await app?.close();
});

const adjust = (delta: number, locationId = locA) =>
  api(app)
    .post(`${base}/adjust`)
    .set(auth(s.superAdmin))
    .send({ inventoryItemId: itemId, stockLocationId: locationId, delta, reason: 'Suite fixture adjustment' });

const level = async (locationId = locA) => {
  const row = await prisma.client.stockLevel.findUnique({
    where: { inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId: locationId } },
    select: { quantity: true, reserved: true },
  });
  return { quantity: Number(row?.quantity ?? 0), reserved: Number(row?.reserved ?? 0) };
};

/** The invariant: the cached level equals the signed sum of the ledger. */
async function assertLedgerEqualsCache(locationId: string) {
  const movements = await prisma.client.stockMovement.findMany({
    where: { inventoryItemId: itemId, stockLocationId: locationId },
    select: { type: true, quantity: true },
  });
  const sign: Record<string, number> = {
    RECEIPT: 1, ISSUE: -1, ADJUST_UP: 1, ADJUST_DOWN: -1,
    TRANSFER_IN: 1, TRANSFER_OUT: -1, CONVERT_TO_ASSET: -1,
  };
  const balance = movements.reduce((sum, m) => sum + sign[m.type]! * Number(m.quantity), 0);
  expect((await level(locationId)).quantity).toBe(balance);
}

describe('locations', () => {
  it('managing needs the permission; duplicate codes are refused', async () => {
    const denied = await api(app)
      .post(`${base}/locations`)
      .set(auth(s.employee))
      .send({ code: 'NOPE', name: 'Not allowed' });
    expect(denied.status).toBe(403);

    const list = await api(app).get(`${base}/locations`).set(auth(s.itAdmin));
    expect(list.status).toBe(200);
    const code = list.body.data.find((l: { id: string }) => l.id === locA).code;
    const dup = await api(app)
      .post(`${base}/locations`)
      .set(auth(s.superAdmin))
      .send({ code, name: 'Duplicate' });
    expect(dup.status).toBe(409);
  });
});

describe('guarded movements and the ledger invariant', () => {
  it('INV-01x adjust seeds the level; issue is guarded by reservations with honest refusals', async () => {
    await adjust(10);
    expect(await level()).toEqual({ quantity: 10, reserved: 0 });

    const reserve = await api(app)
      .post(`${base}/reserve`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locA, quantity: 4 });
    expect(reserve.status).toBe(201);

    // 10 on hand, 4 reserved → only 6 issuable.
    const tooMany = await api(app)
      .post(`${base}/issue`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locA, quantity: 7 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.detail).toContain('only 6 available');
    expect(tooMany.body.detail).toContain('4 reserved');

    const ok = await api(app)
      .post(`${base}/issue`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locA, quantity: 6, reason: 'handout' });
    expect(ok.status).toBe(201);
    expect(await level()).toEqual({ quantity: 4, reserved: 4 });

    // Over-release refused; release restores headroom.
    const overRelease = await api(app)
      .post(`${base}/release`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locA, quantity: 5 });
    expect(overRelease.status).toBe(409);
    await api(app)
      .post(`${base}/release`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locA, quantity: 4 });
    await assertLedgerEqualsCache(locA);
  });

  it('INV-02x transfer moves stock atomically; over-transfer and self-transfer are refused', async () => {
    await adjust(6); // locA back to 10
    const move = await api(app)
      .post(`${base}/transfer`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, fromLocationId: locA, toLocationId: locB, quantity: 3 });
    expect(move.status, JSON.stringify(move.body)).toBe(201);
    expect((await level(locA)).quantity).toBe(7);
    expect((await level(locB)).quantity).toBe(3);

    const tooMuch = await api(app)
      .post(`${base}/transfer`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, fromLocationId: locB, toLocationId: locA, quantity: 99 });
    expect(tooMuch.status).toBe(409);

    const self = await api(app)
      .post(`${base}/transfer`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, fromLocationId: locA, toLocationId: locA, quantity: 1 });
    expect(self.status).toBe(422);

    await assertLedgerEqualsCache(locA);
    await assertLedgerEqualsCache(locB);
  });

  it('INV-03x a cycle count posts the signed difference and reconciles the shelf', async () => {
    const before = (await level(locB)).quantity; // 3
    const counted = await api(app)
      .post(`${base}/count-correction`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locB, countedQuantity: before + 2 });
    expect(counted.status).toBe(201);
    expect(counted.body.data.corrected).toBe(true);
    expect((await level(locB)).quantity).toBe(before + 2);

    const noop = await api(app)
      .post(`${base}/count-correction`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locB, countedQuantity: before + 2 });
    expect(noop.body.data.corrected).toBe(false);
    await assertLedgerEqualsCache(locB);
  });

  it('INV-04x stock→asset conversion is one transaction: level, ledger, cache and asset agree', async () => {
    const globalBefore = Number(
      (await prisma.client.inventoryItem.findUnique({ where: { id: itemId }, select: { quantityOnHand: true } }))
        ?.quantityOnHand,
    );
    const levelBefore = (await level(locA)).quantity;

    const tag = `CONV-${Date.now()}`;
    const converted = await api(app)
      .post(`${base}/convert-to-asset`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locA, assetTag: tag });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(converted.body.data.asset.assetTag).toBe(tag);

    expect((await level(locA)).quantity).toBe(levelBefore - 1);
    const globalAfter = Number(
      (await prisma.client.inventoryItem.findUnique({ where: { id: itemId }, select: { quantityOnHand: true } }))
        ?.quantityOnHand,
    );
    expect(globalBefore - globalAfter).toBe(1);
    const movement = await prisma.client.stockMovement.findFirst({
      where: { inventoryItemId: itemId, type: 'CONVERT_TO_ASSET' },
    });
    expect(movement?.refId).toBe(converted.body.data.asset.id);
    await assertLedgerEqualsCache(locA);

    // Clean the created asset out of the shared pool.
    await prisma.client.asset.delete({ where: { id: converted.body.data.asset.id } });
  });
});

describe('INV concurrency — the issue storm', () => {
  it('six concurrent single-unit issues against three available: exactly three win', async () => {
    // Pin locB to exactly 3 on hand.
    const current = (await level(locB)).quantity;
    if (current !== 3) await adjust(3 - current, locB);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api(app)
          .post(`${base}/issue`)
          .set(auth(s.superAdmin))
          .send({ inventoryItemId: itemId, stockLocationId: locB, quantity: 1 }),
      ),
    );
    const won = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 409).length;
    expect(won).toBe(3);
    expect(blocked).toBe(3);
    expect((await level(locB)).quantity).toBe(0);
    await assertLedgerEqualsCache(locB);
  });
});

describe('low stock', () => {
  it('dropping to the minimum raises LOW_STOCK once per day for the location', async () => {
    // minStock = 2; take locA down to 2.
    const current = (await level(locA)).quantity;
    if (current > 2) {
      const res = await api(app)
        .post(`${base}/issue`)
        .set(auth(s.superAdmin))
        .send({ inventoryItemId: itemId, stockLocationId: locA, quantity: current - 2 });
      expect(res.status).toBe(201);
    }
    const levelRow = await prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId: locA } },
      select: { id: true },
    });
    const alerts = await prisma.client.notification.findMany({
      where: { entityId: levelRow!.id, type: 'LOW_STOCK' },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toContain('minimum 2');

    // Another movement at low stock the same day does not spam.
    await adjust(-1);
    const again = await prisma.client.notification.findMany({
      where: { entityId: levelRow!.id, type: 'LOW_STOCK' },
    });
    expect(again).toHaveLength(1);
  });
});
