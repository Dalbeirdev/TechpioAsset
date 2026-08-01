import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.4 P7 — the stock sweep (ledger-drift WARN, daily low-stock catch-up) and
 * two QA-pack pins the earlier specs left to the contract layer:
 * PRC-004 (needed-by in the past) and PRC-006 (zero-quantity line).
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweep: AlertSweepService;
let itemId: string;
let locationId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);

  const category = await prisma.client.category.findFirst({
    where: { companyId: s.superAdmin.user.companyId },
    select: { id: true },
  });
  const item = await prisma.client.inventoryItem.create({
    data: {
      companyId: s.superAdmin.user.companyId,
      sku: `SWEEP-TEST-${Date.now()}`,
      name: 'Sweep Probe Item',
      categoryId: category!.id,
      minStock: 2,
      createdById: s.superAdmin.user.id,
    },
    select: { id: true },
  });
  itemId = item.id;
  const location = await api(app)
    .post('/api/v1/stock/locations')
    .set(auth(s.superAdmin))
    .send({ code: `SWP-${Date.now() % 100000}`, name: 'Sweep Warehouse' });
  locationId = location.body.data.id;
});

afterAll(async () => {
  await prisma.client.stockMovement.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.stockLevel.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.inventoryItem.delete({ where: { id: itemId } }).catch(() => undefined);
  await prisma.client.stockLocation.delete({ where: { id: locationId } }).catch(() => undefined);
  await app?.close();
});

describe('the stock sweep', () => {
  it('a healthy ledger reports zero drift; corruption is WARNED, never repaired', async () => {
    await api(app)
      .post('/api/v1/stock/adjust')
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, delta: 5, reason: 'Sweep fixture' });

    const healthy = await sweep.runStockSweep();
    expect(healthy.drift).toBe(0);

    // Corrupt the cache directly (stays within the CHECK bounds).
    const level = await prisma.client.stockLevel.findFirst({
      where: { inventoryItemId: itemId },
      select: { id: true, quantity: true },
    });
    await prisma.client.stockLevel.update({ where: { id: level!.id }, data: { quantity: 4 } });

    const corrupted = await sweep.runStockSweep();
    expect(corrupted.drift).toBeGreaterThanOrEqual(1);
    // Untouched: the sweep only warns.
    const after = await prisma.client.stockLevel.findUnique({
      where: { id: level!.id },
      select: { quantity: true },
    });
    expect(Number(after?.quantity)).toBe(4);
    await prisma.client.stockLevel.update({ where: { id: level!.id }, data: { quantity: level!.quantity } });
  });

  it('catches low stock daily, once, even without a triggering mutation', async () => {
    // Drop the cache to the minimum via a legitimate issue (5 → 2).
    await api(app)
      .post('/api/v1/stock/issue')
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 3 });

    const level = await prisma.client.stockLevel.findFirst({
      where: { inventoryItemId: itemId },
      select: { id: true },
    });
    // The inline alert on the mutation already fired today; the sweep must not double up.
    const first = await sweep.runStockSweep();
    const alerts = await prisma.client.notification.findMany({
      where: { entityId: level!.id, type: 'LOW_STOCK' },
    });
    expect(alerts).toHaveLength(1);
    expect(first.lowStock).toBe(0);

    // A fresh day (simulated by clearing today's alert) → the sweep raises one.
    await prisma.client.notification.deleteMany({ where: { entityId: level!.id, type: 'LOW_STOCK' } });
    const second = await sweep.runStockSweep();
    expect(second.lowStock).toBeGreaterThanOrEqual(1);
  });
});

describe('QA PRC pins left to the contract layer', () => {
  it('PRC-004 a needed-by date in the past is refused', async () => {
    const res = await api(app)
      .post('/api/v1/procurement/requests')
      .set(auth(s.employee))
      .send({
        justification: 'Backdated need probe for the QA pack.',
        neededBy: '2020-01-01',
        lines: [{ description: 'Anything', quantity: 1 }],
      });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('past');
  });

  it('PRC-006 a zero-quantity line is refused', async () => {
    const res = await api(app)
      .post('/api/v1/procurement/requests')
      .set(auth(s.employee))
      .send({
        justification: 'Zero-quantity probe for the QA pack.',
        lines: [{ description: 'Nothing at all', quantity: 0 }],
      });
    expect(res.status).toBe(422);
  });
});
