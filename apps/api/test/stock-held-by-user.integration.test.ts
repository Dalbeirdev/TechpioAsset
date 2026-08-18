import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.21 - consumables a person holds.
 *
 * Cables and spare mice are stock, not serialised assets, so "what does this
 * person have" was blind to them. The movement ledger already recorded every
 * issue; it just never recorded who walked away with it. These tests pin the
 * arithmetic: issues add, returns subtract, and nobody can hand back more than
 * they hold.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let itemId: string;
let locationId: string;
let holderId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  holderId = s.employee.user.id;

  // A dedicated item of our own, so nothing here touches the seeded stock and
  // the ledger the sweep audits stays balanced: the opening quantity arrives as
  // a RECEIPT movement rather than a silent column bump. Deleting the item at
  // the end cascades every movement with it, leaving no drift behind.
  const location = await prisma.client.stockLocation.findFirst({
    where: { companyId: s.itAdmin.user.companyId },
    select: { id: true },
  });
  const category = await prisma.client.category.findFirst({
    where: { companyId: s.itAdmin.user.companyId },
    select: { id: true },
  });
  locationId = location!.id;

  const item = await prisma.client.inventoryItem.create({
    data: {
      companyId: s.itAdmin.user.companyId,
      categoryId: category!.id,
      sku: `KIT-CONS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'HDMI cable (kit test)',
      unit: 'unit',
      quantityOnHand: 100,
    },
    select: { id: true },
  });
  itemId = item.id;

  await prisma.client.stockLevel.create({
    data: {
      companyId: s.itAdmin.user.companyId,
      inventoryItemId: itemId,
      stockLocationId: locationId,
      quantity: 100,
    },
  });
  await prisma.client.stockMovement.create({
    data: {
      companyId: s.itAdmin.user.companyId,
      inventoryItemId: itemId,
      stockLocationId: locationId,
      type: 'RECEIPT',
      quantity: 100,
      reason: 'Opening balance for the kit test',
    },
  });
});

afterAll(async () => {
  // Cascades stock_movements and stock_levels, so the ledger is left balanced.
  await prisma.client.$executeRawUnsafe('DELETE FROM inventory_items WHERE id = $1', itemId);
  await app?.close();
});
describe('consumables held by a person', () => {
  it('starts empty', async () => {
    const res = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('records the recipient when stock is issued to them', async () => {
    const res = await api(app)
      .post('/api/v1/stock/issue')
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 3, issuedToUserId: holderId });
    expect(res.status).toBeLessThan(300);

    const held = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(held.body.data).toHaveLength(1);
    expect(held.body.data[0].quantity).toBe(3);
    expect(held.body.data[0].inventoryItemId).toBe(itemId);
  });

  it('adds a second issue to the same holding rather than duplicating the row', async () => {
    await api(app)
      .post('/api/v1/stock/issue')
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 2, issuedToUserId: holderId });

    const held = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(held.body.data).toHaveLength(1);
    expect(held.body.data[0].quantity).toBe(5);
  });

  it('subtracts what comes back', async () => {
    const res = await api(app)
      .post('/api/v1/stock/return')
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 1, returnedByUserId: holderId });
    expect(res.status).toBeLessThan(300);

    const held = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(held.body.data[0].quantity).toBe(4);
  });

  it('lets a person read their own holdings without inventory:read', async () => {
    // The employee holds the stock issued above but has no inventory permission;
    // before v2.23 the route asked for inventory:read, so the one person who
    // most needs to know what is in their name was the one who could not see it.
    const mine = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.employee));
    expect(mine.status).toBe(200);
    expect(mine.body.data[0].quantity).toBe(4);
  });

  it("still refuses to show one employee another person's holdings", async () => {
    const other = await api(app)
      .get(`/api/v1/stock/held-by/${s.itAdmin.user.id}`)
      .set(auth(s.employee));
    expect(other.status).toBe(403);
  });

  it('refuses to take back more than the person holds', async () => {
    const res = await api(app)
      .post('/api/v1/stock/return')
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 99, returnedByUserId: holderId });
    expect(res.status).toBe(422);

    const held = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(held.body.data[0].quantity).toBe(4);
  });

  it('drops the row once everything is returned', async () => {
    await api(app)
      .post('/api/v1/stock/return')
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 4, returnedByUserId: holderId });

    const held = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(held.body.data).toEqual([]);
  });

  it('issuing without a recipient leaves nobody holding it', async () => {
    await api(app)
      .post('/api/v1/stock/issue')
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 1 });

    const held = await api(app).get(`/api/v1/stock/held-by/${holderId}`).set(auth(s.itAdmin));
    expect(held.body.data).toEqual([]);
  });
});
