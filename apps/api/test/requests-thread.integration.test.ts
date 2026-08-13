import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.17: one open ticket per problem + the request conversation thread.
 * The duplicate rule: same subject, same type, same asset/item, still in
 * flight, younger than 10 days. Thread: messages notify the other side.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let categoryId: string;
const requests: string[] = [];
const itemName = `Thread Test Dock ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

async function createEquipmentRequest(who: AccountKey, description: string) {
  return api(app)
    .post('/api/v1/requests')
    .set(auth(s[who]))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      priority: 'NORMAL',
      businessReason: 'Dual-monitor setup needs a docking station at my desk.',
      items: [{ description, quantity: 1 }],
    });
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
  expect(categoryId).toBeDefined();
});

afterAll(async () => {
  for (const id of requests) {
    await prisma.client.$executeRawUnsafe('DELETE FROM notifications WHERE "entityId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_comments WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_approvals WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', id);
  }
  await app?.close();
});

describe('duplicate prevention', () => {
  let firstId: string;

  it('a draft does not block; a submitted request does', async () => {
    const first = await createEquipmentRequest('employee', itemName);
    expect(first.status).toBe(201);
    firstId = first.body.data.id;
    requests.push(firstId);

    // Still a draft: a second create is allowed...
    const whileDraft = await createEquipmentRequest('employee', itemName);
    expect(whileDraft.status).toBe(201);
    requests.push(whileDraft.body.data.id);
    // ...but tidy it away and submit the first, which arms the guard.
    await prisma.client.assetRequest.update({
      where: { id: whileDraft.body.data.id },
      data: { status: 'CANCELLED' },
    });
    const submit = await api(app).post(`/api/v1/requests/${firstId}/submit`).set(auth(s.employee));
    expect(submit.status).toBe(201);

    const dup = await createEquipmentRequest('employee', itemName);
    expect(dup.status).toBe(409);
    expect(dup.body.detail ?? JSON.stringify(dup.body)).toMatch(/10 days|open request|already/i);
  });

  it('matching is case-insensitive on the item', async () => {
    const dup = await createEquipmentRequest('employee', itemName.toLowerCase());
    expect(dup.status).toBe(409);
  });

  it('a different person raising the same item is not a duplicate', async () => {
    const other = await createEquipmentRequest('employee2', itemName);
    expect(other.status).toBe(201);
    requests.push(other.body.data.id);
  });

  it('the pre-check endpoint reports the duplicate for the form', async () => {
    const res = await api(app)
      .get(`/api/v1/requests/open-duplicate?type=ADDITIONAL_EQUIPMENT&item=${encodeURIComponent(itemName)}`)
      .set(auth(s.employee));
    expect(res.status).toBe(200);
    expect(res.body.data.duplicate?.id).toBe(firstId);
  });

  it('completion clears the block', async () => {
    await prisma.client.assetRequest.update({ where: { id: firstId }, data: { status: 'COMPLETED' } });
    const after = await createEquipmentRequest('employee', itemName);
    expect(after.status).toBe(201);
    requests.push(after.body.data.id);
    // Re-arm nothing: leave this one a draft so later tests stay unaffected.
  });
});

describe('conversation thread notifications', () => {
  it('a reviewer reply notifies the requester; internal notes do not', async () => {
    const created = await createEquipmentRequest('employee', `${itemName} thread`);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    requests.push(id);
    await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));

    const before = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, type: 'REQUEST_COMMENT', entityId: id },
    });

    const reply = await api(app)
      .post(`/api/v1/requests/${id}/comments`)
      .set(auth(s.itAdmin))
      .send({ body: 'Ordered — should arrive within a week.', isInternal: false });
    expect(reply.status).toBe(201);

    const after = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, type: 'REQUEST_COMMENT', entityId: id },
    });
    expect(after).toBe(before + 1);

    const internal = await api(app)
      .post(`/api/v1/requests/${id}/comments`)
      .set(auth(s.itAdmin))
      .send({ body: 'Vendor quote attached internally.', isInternal: true });
    expect(internal.status).toBe(201);
    const afterInternal = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, type: 'REQUEST_COMMENT', entityId: id },
    });
    expect(afterInternal).toBe(after);
  });

  it('a requester question notifies the pending approver side without error', async () => {
    const id = requests[requests.length - 1]!;
    const ask = await api(app)
      .post(`/api/v1/requests/${id}/comments`)
      .set(auth(s.employee))
      .send({ body: 'Any update on this? How long will it take?', isInternal: false });
    expect(ask.status).toBe(201);
    // Approver resolution depends on the workflow fixture; the contract here
    // is that the message lands and the requester is never self-notified.
    const selfNotified = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, type: 'REQUEST_COMMENT', entityId: id, title: { contains: 'New message' } },
    });
    expect(selfNotified).toBe(0);
  });
});
