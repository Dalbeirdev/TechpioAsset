import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.3 L3 — QA-pack LIC-* case runs, headlined by the concurrency proofs
 * (LIC-010/011): racing assigns must yield exactly as many winners as there are
 * free seats, with zero seat leak, proven against the database counters.
 *
 * Cases needing surfaces that arrive later are pinned there, not faked here:
 * UI/dashboard/notification reactions (LIC-004/005/006/012/013) → L4/L6;
 * renewal reminders (LIC-014/029/030) → L6 sweep. Bulk ops (LIC-017..020),
 * transfers (LIC-022..025) and idle-seat reclamation (LIC-026..028) are outside
 * the v2.3 scope cut (plan §2) and stay open on the epic.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let userIds: string[] = [];

const base = '/api/v1/licenses';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  const users = await api(app).get('/api/v1/users?pageSize=50').set(auth(s.superAdmin));
  userIds = (users.body.data as { id: string }[]).map((u) => u.id);
  expect(userIds.length).toBeGreaterThanOrEqual(8);
});

afterAll(async () => {
  await app?.close();
});

async function createLicense(seats: number, name: string) {
  const res = await api(app).post(base).set(auth(s.superAdmin)).send({
    name,
    family: 'SAAS',
    subscriptionType: 'SUBSCRIPTION',
    purchaseDate: '2026-01-01',
    expiryDate: '2027-12-31',
    seatsPurchased: seats,
    unitOfAssignment: 'USER',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

const assign = (licenseId: string, userId: string) =>
  api(app).post(`${base}/${licenseId}/assign`).set(auth(s.superAdmin)).send({ userId });

async function destroy(licenseId: string) {
  const detail = await api(app).get(`${base}/${licenseId}`).set(auth(s.superAdmin));
  if (detail.status !== 200) return;
  for (const a of detail.body.data.assignments as { id: string; status: string }[]) {
    if (a.status === 'ACTIVE') {
      await api(app).post(`${base}/${licenseId}/revoke`).set(auth(s.superAdmin)).send({ assignmentId: a.id });
    }
  }
  await api(app).delete(`${base}/${licenseId}`).set(auth(s.superAdmin));
}

/** The invariant the whole module hangs on: counter == reality, always. */
async function assertNoSeatLeak(licenseId: string) {
  const prisma = app.get(PrismaService);
  const pool = await prisma.client.seatPool.findFirst({
    where: { licenseId },
    select: { seatsReserved: true, seatsAllocated: true },
  });
  const active = await prisma.client.licenseAssignment.count({
    where: { licenseId, status: 'ACTIVE' },
  });
  expect(pool?.seatsReserved).toBe(active);
  expect(pool!.seatsReserved).toBeLessThanOrEqual(pool!.seatsAllocated);
  return { reserved: pool!.seatsReserved, active };
}

describe('QA LIC — capacity and the hard block', () => {
  it('LIC-001/002 assigns with capacity and fills the pool exactly to the limit', async () => {
    const l = await createLicense(2, 'QA LIC-001 Fill To Limit');
    try {
      const first = await assign(l.id, userIds[0]!);
      expect(first.status).toBe(201);
      expect(first.body.data.seatsAvailable).toBe(1);

      const second = await assign(l.id, userIds[1]!);
      expect(second.status).toBe(201);
      expect(second.body.data.seatsReserved).toBe(2);
      expect(second.body.data.seatsAvailable).toBe(0);
      await assertNoSeatLeak(l.id);
    } finally {
      await destroy(l.id);
    }
  });

  it('LIC-003/009 hard-blocks the seat beyond the limit with the contracted 409 body', async () => {
    const l = await createLicense(1, 'QA LIC-003 Hard Block');
    try {
      await assign(l.id, userIds[0]!);
      const blocked = await assign(l.id, userIds[1]!);
      expect(blocked.status).toBe(409);
      // House problem-details contract (blueprint's error:"SeatLimitExceeded"
      // adapted): stable code + the honest numbers in the human message.
      expect(blocked.body.code).toBe('SEAT_LIMIT_EXCEEDED');
      expect(blocked.body.detail).toContain('Available: 0');
      expect(blocked.body.detail).toContain('Purchased: 1');
      expect(blocked.body.detail).toContain('Assigned: 1');
      await assertNoSeatLeak(l.id);
    } finally {
      await destroy(l.id);
    }
  });

  it('LIC-007 a blocked assign writes an immutable audit event naming the licence', async () => {
    const l = await createLicense(1, 'QA LIC-007 Audit Trail');
    try {
      await assign(l.id, userIds[0]!);
      await assign(l.id, userIds[1]!); // blocked
      const prisma = app.get(PrismaService);
      const rows = await prisma.client.auditLog.findMany({
        where: { action: 'LICENSE_ASSIGN_BLOCKED', entityId: l.id },
        select: { id: true, newValues: true },
      });
      expect(rows.length).toBe(1);
      // Append-only by design: the API exposes no mutation route for audit rows.
      const del = await api(app).delete(`/api/v1/audit/${rows[0]!.id}`).set(auth(s.superAdmin));
      expect([404, 405]).toContain(del.status);
    } finally {
      await destroy(l.id);
    }
  });
});

describe('QA LIC — concurrency (the flagship proof)', () => {
  it('LIC-010 two admins race for the last seat: exactly one wins', async () => {
    const l = await createLicense(1, 'QA LIC-010 Last Seat Race');
    try {
      const [a, b] = await Promise.all([assign(l.id, userIds[0]!), assign(l.id, userIds[1]!)]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('SEAT_LIMIT_EXCEEDED');
      const state = await assertNoSeatLeak(l.id);
      expect(state.reserved).toBe(1);
    } finally {
      await destroy(l.id);
    }
  });

  it('LIC-011 a concurrent storm never leaks a seat: winners == free seats exactly', async () => {
    const SEATS = 3;
    const CONTENDERS = 8;
    const l = await createLicense(SEATS, 'QA LIC-011 Storm');
    try {
      const results = await Promise.all(
        userIds.slice(0, CONTENDERS).map((uid) => assign(l.id, uid)),
      );
      const won = results.filter((r) => r.status === 201).length;
      const blocked = results.filter(
        (r) => r.status === 409 && r.body.code === 'SEAT_LIMIT_EXCEEDED',
      ).length;
      expect(won).toBe(SEATS);
      expect(blocked).toBe(CONTENDERS - SEATS);

      const state = await assertNoSeatLeak(l.id);
      expect(state.reserved).toBe(SEATS);
      expect(state.active).toBe(SEATS);
    } finally {
      await destroy(l.id);
    }
  });
});

describe('QA LIC — duplicates, revoke, reassignment', () => {
  it('LIC-015 a principal cannot hold two active seats on one licence', async () => {
    const l = await createLicense(2, 'QA LIC-015 Duplicate');
    try {
      await assign(l.id, userIds[0]!);
      const dup = await assign(l.id, userIds[0]!);
      expect(dup.status).toBe(409);
      await assertNoSeatLeak(l.id);
    } finally {
      await destroy(l.id);
    }
  });

  it('LIC-016/021 revoking releases the seat and the same principal can return', async () => {
    const l = await createLicense(1, 'QA LIC-016 Reassign');
    try {
      const first = await assign(l.id, userIds[0]!);
      const active = first.body.data.assignments.find(
        (x: { status: string }) => x.status === 'ACTIVE',
      );
      const revoked = await api(app)
        .post(`${base}/${l.id}/revoke`)
        .set(auth(s.superAdmin))
        .send({ assignmentId: active.id });
      expect(revoked.status).toBe(201);
      expect(revoked.body.data.seatsAvailable).toBe(1);

      // The revoked row does not block the comeback (partial unique on ACTIVE only).
      const again = await assign(l.id, userIds[0]!);
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      await assertNoSeatLeak(l.id);
    } finally {
      await destroy(l.id);
    }
  });
});
