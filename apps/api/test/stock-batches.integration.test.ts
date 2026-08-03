import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.9 C4 — lot tracking and expiry.
 *
 * Two invariants, both proven against real stock rather than asserted:
 * issue is FIFO by expiry, and expired stock is never issued silently.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweep: AlertSweepService;
let companyId: string;
let itemId: string;
let locationId: string;
let poLineId: string;
let poId: string;

const stockBase = '/api/v1/stock';
const run = Date.now() % 100_000;

/** A date `days` from today, as the API accepts it. */
const day = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);
  companyId = s.superAdmin.user.companyId;

  const category = await prisma.client.category.findFirstOrThrow({
    where: { companyId, deletedAt: null },
    select: { id: true },
  });
  // A lot-tracked consumable of our own, so no other suite's stock interferes.
  const item = await prisma.client.inventoryItem.create({
    data: {
      companyId,
      sku: `C4-TONER-${run}`,
      name: 'Batch probe toner',
      categoryId: category.id,
      batchTracked: true,
      // The sweep notifies whoever created the item.
      createdById: s.superAdmin.user.id,
    },
    select: { id: true },
  });
  itemId = item.id;
  const location = await prisma.client.stockLocation.create({
    data: { companyId, code: `C4-WH-${run}`, name: 'C4 Warehouse' },
    select: { id: true },
  });
  locationId = location.id;
});

afterAll(async () => {
  await prisma.client.stockMovement.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.stockBatch.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.stockLevel.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.notification.deleteMany({ where: { entityType: 'StockBatch' } });
  await prisma.client.inventoryItem.delete({ where: { id: itemId } }).catch(() => undefined);
  await prisma.client.stockLocation.delete({ where: { id: locationId } }).catch(() => undefined);
  await app?.close();
});

/** An ISSUED PO line with plenty of quantity left to receive against. */
async function ensurePo() {
  if (poLineId) return;
  const pr = await api(app)
    .post('/api/v1/procurement/requests')
    .set(auth(s.employee))
    .send({
      justification: 'Batch probe: toner for the print room, received in lots.',
      lines: [{ description: 'Batch probe toner', quantity: 500, estimatedUnitPrice: '5.00', inventoryItemId: itemId }],
    });
  expect(pr.status, JSON.stringify(pr.body)).toBe(201);
  await api(app).post(`/api/v1/procurement/requests/${pr.body.data.id}/submit`).set(auth(s.employee));
  await api(app)
    .post(`/api/v1/procurement/requests/${pr.body.data.id}/decision`)
    .set(auth(s.finance))
    .send({ decision: 'APPROVE' });
  const vendor = await prisma.client.vendor.findFirstOrThrow({
    where: { companyId, deletedAt: null },
    select: { id: true },
  });
  const converted = await api(app)
    .post(`/api/v1/procurement/requests/${pr.body.data.id}/convert`)
    .set(auth(s.superAdmin))
    .send({ vendorId: vendor.id });
  poId = converted.body.data.purchaseOrderId;
  await api(app).post(`/api/v1/procurement/orders/${poId}/issue`).set(auth(s.superAdmin));
  const po = await api(app).get(`/api/v1/procurement/orders/${poId}`).set(auth(s.superAdmin));
  poLineId = po.body.data.lines[0].id;
}

/** Receive `quantity` into a named lot through the real goods-receipt path. */
async function receiveLot(batchNumber: string, quantity: number, expiryDate: string | null) {
  await ensurePo();
  return api(app)
    .post(`/api/v1/procurement/orders/${poId}/receive`)
    .set(auth(s.superAdmin))
    .send({
      lines: [
        {
          purchaseOrderLineId: poLineId,
          quantity,
          intake: 'STOCK',
          stockLocationId: locationId,
          inventoryItemId: itemId,
          batchNumber,
          ...(expiryDate ? { expiryDate } : {}),
        },
      ],
    });
}

const issue = (quantity: number, extra: Record<string, unknown> = {}) =>
  api(app)
    .post(`${stockBase}/issue`)
    .set(auth(s.superAdmin))
    .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity, ...extra });

const batchesNow = async () =>
  prisma.client.stockBatch.findMany({
    where: { inventoryItemId: itemId },
    orderBy: { batchNumber: 'asc' },
    select: { batchNumber: true, quantity: true, expiryDate: true },
  });

describe('receiving into lots', () => {
  it('a lot-tracked item cannot be received anonymously', async () => {
    await ensurePo();
    const anonymous = await api(app)
      .post(`/api/v1/procurement/orders/${poId}/receive`)
      .set(auth(s.superAdmin))
      .send({
        lines: [
          {
            purchaseOrderLineId: poLineId,
            quantity: 5,
            intake: 'STOCK',
            stockLocationId: locationId,
            inventoryItemId: itemId,
          },
        ],
      });
    expect(anonymous.status).toBe(422);
    expect(anonymous.body.detail).toMatch(/lot-tracked/i);
    expect(anonymous.body.detail).toMatch(/batch number/i);
  });

  it('creates the lot inside the receipt, linked to the line that brought it in', async () => {
    const res = await receiveLot(`LOT-A-${run}`, 10, day(90));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.batchesReceived).toHaveLength(1);

    const batch = await prisma.client.stockBatch.findFirstOrThrow({
      where: { inventoryItemId: itemId, batchNumber: `LOT-A-${run}` },
      select: { quantity: true, sourceGrnLineId: true, stockLocationId: true },
    });
    expect(Number(batch.quantity)).toBe(10);
    expect(batch.sourceGrnLineId).toBeTruthy();
    expect(batch.stockLocationId).toBe(locationId);

    // The ledger row carries the lot: batches are a dimension of the movement,
    // not a parallel truth beside it.
    const movement = await prisma.client.stockMovement.findFirstOrThrow({
      where: { inventoryItemId: itemId, type: 'RECEIPT' },
      orderBy: { createdAt: 'desc' },
      select: { stockBatchId: true, quantity: true },
    });
    expect(movement.stockBatchId).toBeTruthy();
  });

  it('a second delivery of the same lot tops it up rather than duplicating it', async () => {
    expect((await receiveLot(`LOT-A-${run}`, 5, day(90))).status).toBe(201);
    const batch = await prisma.client.stockBatch.findFirstOrThrow({
      where: { inventoryItemId: itemId, batchNumber: `LOT-A-${run}` },
      select: { quantity: true },
    });
    expect(Number(batch.quantity)).toBe(15);
  });

  it('refuses the same lot number arriving with a different expiry date', async () => {
    const clash = await receiveLot(`LOT-A-${run}`, 5, day(200));
    expect(clash.status).toBe(409);
    expect(clash.body.detail).toMatch(/different expiry date/i);
    // The refusal took nothing: the lot is untouched.
    const batch = await prisma.client.stockBatch.findFirstOrThrow({
      where: { inventoryItemId: itemId, batchNumber: `LOT-A-${run}` },
      select: { quantity: true },
    });
    expect(Number(batch.quantity)).toBe(15);
  });
});

describe('issuing is FIFO by expiry', () => {
  it('drains the soonest-expiring lot first, then moves to the next', async () => {
    // LOT-A (15, expires in 90 days) exists; add one that goes off sooner.
    expect((await receiveLot(`LOT-B-${run}`, 6, day(10))).status).toBe(201);

    const res = await issue(8, { reason: 'Print room refill' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // 6 from the lot expiring in 10 days, then 2 from the 90-day lot.
    expect(res.body.data.batchesDrawn.map((p: { batchNumber: string; quantity: string }) => [p.batchNumber, p.quantity]))
      .toEqual([
        [`LOT-B-${run}`, '6'],
        [`LOT-A-${run}`, '2'],
      ]);
    expect(res.body.data.usedExpired).toBe(false);

    const batches = Object.fromEntries((await batchesNow()).map((b) => [b.batchNumber, Number(b.quantity)]));
    expect(batches[`LOT-B-${run}`]).toBe(0);
    expect(batches[`LOT-A-${run}`]).toBe(13);

    // One ledger row per lot drawn on, so the history reads lot by lot.
    const movements = await prisma.client.stockMovement.findMany({
      where: { inventoryItemId: itemId, type: 'ISSUE' },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { stockBatchId: true, quantity: true },
    });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.stockBatchId !== null)).toBe(true);
  });
});

describe('expired stock is never issued silently', () => {
  it('refuses to issue expired stock, separating "not enough" from "gone off"', async () => {
    // A lot that went off yesterday, plus what is left of the good lot (13).
    expect((await receiveLot(`LOT-OLD-${run}`, 100, day(-1))).status).toBe(201);

    const refused = await issue(20);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('only 13 available');
    expect(refused.body.detail).toContain('further 100 has expired');
    expect(refused.body.detail).toMatch(/issue it explicitly with a reason/i);

    // Nothing moved.
    const batches = Object.fromEntries((await batchesNow()).map((b) => [b.batchNumber, Number(b.quantity)]));
    expect(batches[`LOT-OLD-${run}`]).toBe(100);
    expect(batches[`LOT-A-${run}`]).toBe(13);
  });

  it('issues expired stock with a reason, and records that it happened', async () => {
    const res = await issue(20, {
      allowExpired: true,
      expiredReason: 'Toner is sealed and the print shop confirmed it is still usable.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.usedExpired).toBe(true);
    // Usable stock FIRST, expired only for the remainder - permission to fall
    // back on it is not an instruction to reach for it.
    const drawn = res.body.data.batchesDrawn as { batchNumber: string; quantity: string; expired: boolean }[];
    expect(drawn[0]).toMatchObject({ batchNumber: `LOT-A-${run}`, quantity: '13', expired: false });
    expect(drawn[1]).toMatchObject({ batchNumber: `LOT-OLD-${run}`, quantity: '7', expired: true });

    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'STOCK_EXPIRED_ISSUED', entityId: itemId },
      orderBy: { createdAt: 'desc' },
      select: { reason: true, newValues: true },
    });
    expect(audit?.reason).toMatch(/sealed/i);
    expect(JSON.stringify(audit?.newValues)).toContain(`LOT-OLD-${run}`);

    // The movement itself says so too, for anyone reading the ledger.
    const movement = await prisma.client.stockMovement.findFirstOrThrow({
      where: { inventoryItemId: itemId, type: 'ISSUE', reason: { startsWith: 'EXPIRED STOCK ISSUED' } },
      select: { reason: true },
    });
    expect(movement.reason).toMatch(/sealed/i);
  });

  it('refuses the override with no reason at all', async () => {
    const res = await issue(1, { allowExpired: true });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/needs a reason/i);
  });
});

describe('reading and alerting on what is about to go off', () => {
  it('lists lots soonest-expiry first, saying which state each is in', async () => {
    expect((await receiveLot(`LOT-FRESH-${run}`, 12, day(200))).status).toBe(201);
    const res = await api(app)
      .get(`${stockBase}/batches?inventoryItemId=${itemId}`)
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const rows = res.body.data as { batchNumber: string; expiryState: string; expiryDate: string }[];
    const states = Object.fromEntries(rows.map((b) => [b.batchNumber, b.expiryState]));
    expect(states[`LOT-OLD-${run}`]).toBe('EXPIRED');
    expect(states[`LOT-FRESH-${run}`]).toBe('OK');
    // Emptied lots are not shelf stock and do not clutter the list: LOT-A and
    // LOT-B were both drained by the issues above.
    expect(states[`LOT-A-${run}`]).toBeUndefined();
    expect(states[`LOT-B-${run}`]).toBeUndefined();
    // Soonest expiry first, so the list reads in the order stock will leave.
    expect(rows.map((b) => b.expiryDate)).toEqual([...rows.map((b) => b.expiryDate)].sort());
  });

  it('the sweep warns about lots going off, and says which have already gone', async () => {
    expect((await receiveLot(`LOT-SOON-${run}`, 4, day(5))).status).toBe(201);
    const result = await sweep.runExpirySweep();
    expect(result.expiring + result.expired).toBeGreaterThanOrEqual(2);

    const notes = await prisma.client.notification.findMany({
      where: { companyId, type: 'STOCK_EXPIRING', userId: s.superAdmin.user.id },
      select: { title: true, body: true, entityId: true },
    });
    expect(notes.some((n) => n.body.includes(`LOT-SOON-${run}`) && /expires on/.test(n.body))).toBe(true);
    expect(notes.some((n) => n.body.includes(`LOT-OLD-${run}`) && /expired on/.test(n.body))).toBe(true);

    // Once per lot per day: a second pass the same day says nothing new.
    const before = await prisma.client.notification.count({ where: { companyId, type: 'STOCK_EXPIRING' } });
    await sweep.runExpirySweep();
    expect(await prisma.client.notification.count({ where: { companyId, type: 'STOCK_EXPIRING' } })).toBe(before);
  });

  it('the database refuses a lot driven negative, whatever route is taken', async () => {
    const batch = await prisma.client.stockBatch.findFirstOrThrow({
      where: { inventoryItemId: itemId, batchNumber: `LOT-A-${run}` },
      select: { id: true },
    });
    await expect(
      prisma.client.$executeRawUnsafe(`UPDATE "stock_batches" SET "quantity" = -1 WHERE "id" = '${batch.id}'`),
    ).rejects.toThrow(/stock_batches_quantity_not_negative/);
  });

  it('an item that is not lot-tracked still issues exactly as it did before', async () => {
    const plain = await prisma.client.inventoryItem.findFirstOrThrow({
      where: { companyId, batchTracked: false, deletedAt: null },
      select: { id: true },
    });
    await prisma.client.stockLevel.create({
      data: { companyId, inventoryItemId: plain.id, stockLocationId: locationId, quantity: 5 },
    });
    const res = await api(app)
      .post(`${stockBase}/issue`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: plain.id, stockLocationId: locationId, quantity: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // No batch machinery in sight for an item that never asked for it.
    expect(res.body.data.batchesDrawn).toBeUndefined();
    expect(Number(res.body.data.quantity)).toBe(3);

    await prisma.client.stockMovement.deleteMany({ where: { inventoryItemId: plain.id, stockLocationId: locationId } });
    await prisma.client.stockLevel.deleteMany({ where: { inventoryItemId: plain.id, stockLocationId: locationId } });
  });
});
