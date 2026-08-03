import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.7 R3 — bulk seat operations and transfers.
 *
 * Invariants under test: PARTIAL takes exactly what fits and reports the rest
 * honestly; ATOMIC takes NOTHING unless everything fits; a transfer never
 * creates a seat (the pool counter is provably unchanged) and therefore works
 * on a FULL licence. Seat counts are asserted against the database, not the
 * response, so a lying response cannot pass.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let licenseId: string;
let poolId: string;
let userIds: string[] = [];

const run = Date.now() % 1_000_000;
const SEATS = 5;

async function poolCounts() {
  const pool = await prisma.client.seatPool.findUniqueOrThrow({ where: { id: poolId } });
  const active = await prisma.client.licenseAssignment.count({
    where: { licenseId, status: 'ACTIVE' },
  });
  return { reserved: pool.seatsReserved, allocated: pool.seatsAllocated, active };
}

/** The counter and reality must always agree — the v2.3 no-leak invariant. */
async function assertNoSeatLeak() {
  const { reserved, active } = await poolCounts();
  expect(reserved).toBe(active);
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const created = await api(app)
    .post('/api/v1/licenses')
    .set(auth(s.superAdmin))
    .send({
      name: `Bulk Suite ${run}`,
      family: 'OTHER',
      subscriptionType: 'SUBSCRIPTION',
      purchaseDate: new Date().toISOString(),
      // A subscription needs an expiry (the v2.3 contract refine).
      expiryDate: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      seatsPurchased: SEATS,
      unitOfAssignment: 'USER',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  licenseId = created.body.data.id;
  poolId = (await prisma.client.seatPool.findFirstOrThrow({ where: { licenseId } })).id;

  // Eight candidate holders for a five-seat licence.
  const users = await prisma.client.user.findMany({
    where: { companyId: s.superAdmin.user.companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
    take: 8,
  });
  userIds = users.map((u) => u.id);
  expect(userIds.length).toBeGreaterThanOrEqual(8);
});

afterAll(async () => {
  await prisma.client.licenseAssignment.deleteMany({ where: { licenseId } });
  await prisma.client.seatPool.deleteMany({ where: { licenseId } });
  await prisma.client.softwareLicense.delete({ where: { id: licenseId } }).catch(() => undefined);
  await app?.close();
});

describe('ATOMIC mode', () => {
  it('takes NOTHING when the batch does not fit - not even the seats that would have', async () => {
    const before = await poolCounts();
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
      .set(auth(s.superAdmin))
      .send({
        mode: 'ATOMIC',
        principals: userIds.slice(0, 6).map((userId) => ({ userId })), // 6 into 5
        reason: 'Atomic overflow probe',
      });
    expect(res.status).toBe(409);
    // The refusal carries the real numbers, not just a catalogue title.
    expect(res.body.detail ?? res.body.message).toMatch(/cannot assign 6/i);

    const after = await poolCounts();
    expect(after.reserved).toBe(before.reserved); // nothing taken
    expect(after.active).toBe(before.active);
    await assertNoSeatLeak();
  });

  it('takes them all together when the batch fits', async () => {
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
      .set(auth(s.superAdmin))
      .send({ mode: 'ATOMIC', principals: userIds.slice(0, 3).map((userId) => ({ userId })) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedCount).toBe(3);
    expect(res.body.data.refusedCount).toBe(0);

    const counts = await poolCounts();
    expect(counts.reserved).toBe(3);
    await assertNoSeatLeak();
  });
});

describe('PARTIAL mode', () => {
  it('takes exactly the seats that fit and names every refusal', async () => {
    // 2 seats free; ask for 4 more (users 3..6).
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
      .set(auth(s.superAdmin))
      .send({ mode: 'PARTIAL', principals: userIds.slice(3, 7).map((userId) => ({ userId })) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedCount).toBe(2);
    expect(res.body.data.refusedCount).toBe(2);
    // The refusals carry the real reason, not a generic failure.
    expect(res.body.data.refused[0].reason).toMatch(/seat|licen[cs]e limit/i);
    expect(res.body.data.refused[0].principal.userId).toBeTruthy();

    const counts = await poolCounts();
    expect(counts.reserved).toBe(SEATS); // full, never over
    await assertNoSeatLeak();
  });

  it('a duplicate principal is refused by name while the rest succeed', async () => {
    // Free one seat, then ask for [already-holder, fresh] - one must fail.
    const holder = await prisma.client.licenseAssignment.findFirstOrThrow({
      where: { licenseId, status: 'ACTIVE' },
      select: { id: true, userId: true },
    });
    await api(app)
      .post(`/api/v1/licenses/${licenseId}/revoke`)
      .set(auth(s.superAdmin))
      .send({ assignmentId: holder.id, reason: 'make room' });

    const stillHolding = await prisma.client.licenseAssignment.findFirstOrThrow({
      where: { licenseId, status: 'ACTIVE' },
      select: { userId: true },
    });
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
      .set(auth(s.superAdmin))
      .send({
        mode: 'PARTIAL',
        principals: [{ userId: stillHolding.userId }, { userId: holder.userId }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.assignedCount).toBe(1); // the fresh one
    expect(res.body.data.refusedCount).toBe(1);
    expect(res.body.data.refused[0].reason).toMatch(/already holds/i);
    await assertNoSeatLeak();
  });
});

describe('transfers', () => {
  it('moves a seat on a FULL licence without touching the pool counter', async () => {
    const before = await poolCounts();
    expect(before.reserved).toBe(SEATS); // deliberately full

    const assignment = await prisma.client.licenseAssignment.findFirstOrThrow({
      where: { licenseId, status: 'ACTIVE' },
      select: { id: true, userId: true },
    });
    const holders = await prisma.client.licenseAssignment.findMany({
      where: { licenseId, status: 'ACTIVE' },
      select: { userId: true },
    });
    const heldIds = new Set(holders.map((h) => h.userId));
    const newcomer = userIds.find((id) => !heldIds.has(id))!;
    expect(newcomer).toBeTruthy();

    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/transfer`)
      .set(auth(s.superAdmin))
      .send({ assignmentId: assignment.id, toUserId: newcomer, reason: 'Team change' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const after = await poolCounts();
    expect(after.reserved).toBe(before.reserved); // THE invariant: no seat created
    expect(after.active).toBe(before.active);
    await assertNoSeatLeak();

    // Old holder released, new holder active.
    const old = await prisma.client.licenseAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(old.status).toBe('REVOKED');
    const fresh = await prisma.client.licenseAssignment.findFirst({
      where: { licenseId, status: 'ACTIVE', userId: newcomer },
    });
    expect(fresh).toBeTruthy();

    const audit = await prisma.client.auditLog.findFirst({
      where: { action: 'LICENSE_TRANSFERRED', entityId: licenseId },
    });
    expect(audit).toBeTruthy();
  });

  it('refuses a transfer to someone who already holds a seat, and to the same principal', async () => {
    const [a, b] = await prisma.client.licenseAssignment.findMany({
      where: { licenseId, status: 'ACTIVE' },
      select: { id: true, userId: true },
      take: 2,
    });
    const duplicate = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/transfer`)
      .set(auth(s.superAdmin))
      .send({ assignmentId: a!.id, toUserId: b!.userId });
    expect(duplicate.status).toBe(409);

    const noop = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/transfer`)
      .set(auth(s.superAdmin))
      .send({ assignmentId: a!.id, toUserId: a!.userId });
    expect(noop.status).toBe(422);
    await assertNoSeatLeak();
  });
});

describe('bulk revoke', () => {
  it('revokes what it can and reports what it cannot', async () => {
    const active = await prisma.client.licenseAssignment.findMany({
      where: { licenseId, status: 'ACTIVE' },
      select: { id: true },
      take: 2,
    });
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk-revoke`)
      .set(auth(s.superAdmin))
      .send({ assignmentIds: [...active.map((a) => a.id), 'no-such-assignment'], reason: 'Cleanup' });
    expect(res.status).toBe(201);
    expect(res.body.data.revokedCount).toBe(2);
    expect(res.body.data.skippedCount).toBe(1);
    expect(res.body.data.skipped[0].assignmentId).toBe('no-such-assignment');
    await assertNoSeatLeak();
  });
});

describe('concurrency', () => {
  it('racing ATOMIC batches cannot both win the last seats', async () => {
    // Empty the licence, then leave exactly 3 free seats.
    await prisma.client.licenseAssignment.updateMany({
      where: { licenseId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await prisma.client.seatPool.update({ where: { id: poolId }, data: { seatsReserved: 0 } });
    await prisma.client.licenseAssignment.deleteMany({ where: { licenseId } });
    await prisma.client.seatPool.update({
      where: { id: poolId },
      data: { seatsAllocated: 3, seatsReserved: 0 },
    });

    // Two batches of 3 fired together into 3 seats: exactly one may win.
    const [a, b] = await Promise.all([
      api(app)
        .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
        .set(auth(s.superAdmin))
        .send({ mode: 'ATOMIC', principals: userIds.slice(0, 3).map((userId) => ({ userId })) }),
      api(app)
        .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
        .set(auth(s.superAdmin))
        .send({ mode: 'ATOMIC', principals: userIds.slice(3, 6).map((userId) => ({ userId })) }),
    ]);

    const winners = [a, b].filter((r) => r.status === 201);
    expect(winners).toHaveLength(1);
    const loser = [a, b].find((r) => r.status !== 201)!;
    expect(loser.status).toBe(409);

    const counts = await poolCounts();
    expect(counts.reserved).toBe(3); // never 6, never over
    await assertNoSeatLeak();

    // Restore the fixture for any later test.
    await prisma.client.seatPool.update({
      where: { id: poolId },
      data: { seatsAllocated: SEATS },
    });
  });
});

describe('permissions', () => {
  it('an employee cannot bulk-assign or transfer', async () => {
    const bulk = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
      .set(auth(s.employee))
      .send({ principals: [{ userId: userIds[0] }] });
    expect(bulk.status).toBe(403);

    const transfer = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/transfer`)
      .set(auth(s.employee))
      .send({ assignmentId: 'x', toUserId: userIds[0] });
    expect(transfer.status).toBe(403);
  });
});
