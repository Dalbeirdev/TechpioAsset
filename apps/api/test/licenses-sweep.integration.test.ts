import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.3 L6 — the licence sweep: expiry buckets (LIC-029/030 analog for the
 * 90/60/30 windows), capacity alerts at >=90% utilisation, cached-status
 * refresh, counter-drift reconciliation, and the blocked-assign notification
 * (blueprint A.7c). Sweeps are same-day idempotent by design.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let sweep: AlertSweepService;
let prisma: PrismaService;

const base = '/api/v1/licenses';
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  sweep = app.get(AlertSweepService);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

async function createLicense(overrides: Record<string, unknown>) {
  const res = await api(app)
    .post(base)
    .set(auth(s.superAdmin))
    .send({
      name: 'Sweep Probe',
      family: 'SAAS',
      subscriptionType: 'SUBSCRIPTION',
      purchaseDate: '2026-01-01',
      expiryDate: days(400),
      seatsPurchased: 2,
      unitOfAssignment: 'USER',
      ...overrides,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function destroy(id: string) {
  const detail = await api(app).get(`${base}/${id}`).set(auth(s.superAdmin));
  if (detail.status !== 200) return;
  for (const a of detail.body.data.assignments as { id: string; status: string }[]) {
    if (a.status === 'ACTIVE') {
      await api(app).post(`${base}/${id}/revoke`).set(auth(s.superAdmin)).send({ assignmentId: a.id });
    }
  }
  await api(app).delete(`${base}/${id}`).set(auth(s.superAdmin));
}

const notificationsFor = (entityId: string, type: string) =>
  prisma.client.notification.findMany({ where: { entityId, type: type as never } });

describe('expiry buckets (LIC-029/030 analog)', () => {
  it('raises LICENSE_EXPIRING inside the window, exactly once per day', async () => {
    const l = await createLicense({ name: 'Sweep Expiring 20d', expiryDate: days(20) });
    try {
      const first = await sweep.runLicenseSweep();
      expect(first.expiring).toBeGreaterThanOrEqual(1);
      const rows = await notificationsFor(l.id, 'LICENSE_EXPIRING');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toContain('Sweep Expiring 20d');
      expect(rows[0]!.body).toContain('within 30 days');

      // Same-day idempotency: a second pass raises nothing new for it.
      await sweep.runLicenseSweep();
      expect(await notificationsFor(l.id, 'LICENSE_EXPIRING')).toHaveLength(1);
    } finally {
      await destroy(l.id);
    }
  });

  it('stays quiet for licences comfortably outside the 90-day window', async () => {
    const l = await createLicense({ name: 'Sweep Far Future', expiryDate: days(400) });
    try {
      await sweep.runLicenseSweep();
      expect(await notificationsFor(l.id, 'LICENSE_EXPIRING')).toHaveLength(0);
    } finally {
      await destroy(l.id);
    }
  });

  it('refreshes the cached status when the calendar overtakes it', async () => {
    const l = await createLicense({ name: 'Sweep Status Cache', expiryDate: days(400) });
    try {
      // The calendar moves under the cached ACTIVE status.
      await prisma.client.softwareLicense.update({
        where: { id: l.id },
        data: { expiryDate: new Date(Date.now() + 20 * 86_400_000) },
      });
      await sweep.runLicenseSweep();
      const row = await prisma.client.softwareLicense.findUnique({
        where: { id: l.id },
        select: { status: true },
      });
      expect(row?.status).toBe('EXPIRING');
    } finally {
      await destroy(l.id);
    }
  });
});

describe('capacity alerts and counter drift', () => {
  it('raises SEAT_LIMIT_REACHED when the pool fills (once per day)', async () => {
    const l = await createLicense({ name: 'Sweep Full Pool', seatsPurchased: 1 });
    try {
      await api(app)
        .post(`${base}/${l.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });

      const result = await sweep.runLicenseSweep();
      expect(result.capacity).toBeGreaterThanOrEqual(1);
      const rows = await notificationsFor(l.id, 'SEAT_LIMIT_REACHED');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toContain('refused');

      await sweep.runLicenseSweep();
      expect(await notificationsFor(l.id, 'SEAT_LIMIT_REACHED')).toHaveLength(1);
    } finally {
      await destroy(l.id);
    }
  });

  it('detects seat-counter drift without silently repairing it', async () => {
    const l = await createLicense({ name: 'Sweep Drift', seatsPurchased: 2 });
    try {
      await api(app)
        .post(`${base}/${l.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });

      const pool = await prisma.client.seatPool.findFirst({
        where: { licenseId: l.id },
        select: { id: true, seatsReserved: true },
      });
      // Corrupt the counter (stays within the CHECK bounds: 2 <= allocated 2).
      await prisma.client.seatPool.update({
        where: { id: pool!.id },
        data: { seatsReserved: 2 },
      });

      const result = await sweep.runLicenseSweep();
      expect(result.drift).toBeGreaterThanOrEqual(1);

      // The sweep only warns; the counter is untouched. Restore it ourselves.
      const after = await prisma.client.seatPool.findUnique({
        where: { id: pool!.id },
        select: { seatsReserved: true },
      });
      expect(after?.seatsReserved).toBe(2);
      await prisma.client.seatPool.update({
        where: { id: pool!.id },
        data: { seatsReserved: pool!.seatsReserved },
      });
    } finally {
      await destroy(l.id);
    }
  });
});

describe('blocked assign notifies the actor (blueprint A.7c)', () => {
  it('a refused seat lands in the actor’s inbox as SEAT_LIMIT_REACHED', async () => {
    const l = await createLicense({ name: 'Sweep Blocked Notify', seatsPurchased: 1 });
    try {
      await api(app)
        .post(`${base}/${l.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });
      const blocked = await api(app)
        .post(`${base}/${l.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee2.user.id });
      expect(blocked.status).toBe(409);

      const rows = await prisma.client.notification.findMany({
        where: { entityId: l.id, type: 'SEAT_LIMIT_REACHED', userId: s.superAdmin.user.id },
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.body).toContain('Available: 0');
    } finally {
      await destroy(l.id);
    }
  });
});
