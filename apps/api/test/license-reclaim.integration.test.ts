import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.7 R4 — reclamation, the 7-day reminder bucket and the capacity tile.
 *
 * The waste this closes: a deactivated employee keeps consuming a paid seat
 * until someone notices at renewal. Reclamation makes it visible and takes it
 * back through the ordinary guarded revoke, so the counter can never drift.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweep: AlertSweepService;
let licenseId: string;
let poolId: string;
let leaverId: string;
let stayerId: string;

const run = Date.now() % 1_000_000;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);

  const created = await api(app)
    .post('/api/v1/licenses')
    .set(auth(s.superAdmin))
    .send({
      name: `Reclaim Suite ${run}`,
      family: 'OTHER',
      subscriptionType: 'SUBSCRIPTION',
      purchaseDate: new Date().toISOString(),
      // Five days out: inside the new 7-day bucket.
      expiryDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      seatsPurchased: 4,
      unitOfAssignment: 'USER',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  licenseId = created.body.data.id;
  poolId = (await prisma.client.seatPool.findFirstOrThrow({ where: { licenseId } })).id;

  // Two holders: one who will leave, one who stays.
  leaverId = s.employee2.user.id;
  stayerId = s.employee3.user.id;
  for (const userId of [leaverId, stayerId]) {
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
});

afterAll(async () => {
  // Restore the borrowed account so later suites see it active.
  await prisma.client.user.update({ where: { id: leaverId }, data: { status: 'ACTIVE' } });
  await prisma.client.licenseAssignment.deleteMany({ where: { licenseId } });
  await prisma.client.seatPool.deleteMany({ where: { licenseId } });
  await prisma.client.softwareLicense.delete({ where: { id: licenseId } }).catch(() => undefined);
  await app?.close();
});

const reserved = async () =>
  (await prisma.client.seatPool.findUniqueOrThrow({ where: { id: poolId } })).seatsReserved;

describe('reclamation', () => {
  it('an active holder is NOT reclaimable - only departed people are', async () => {
    const res = await api(app)
      .get(`/api/v1/licenses/reclaimable?licenseId=${licenseId}`)
      .set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  it('deactivating a holder surfaces their seat with the reason why', async () => {
    await prisma.client.user.update({
      where: { id: leaverId },
      data: { status: 'DEACTIVATED' },
    });

    const res = await api(app)
      .get(`/api/v1/licenses/reclaimable?licenseId=${licenseId}`)
      .set(auth(s.superAdmin));
    expect(res.body.data.count).toBe(1);
    const row = res.body.data.assignments[0];
    expect(row.holder.id).toBe(leaverId);
    expect(row.holder.reason).toBe('DEACTIVATED'); // why, not just that
    expect(row.license.id).toBe(licenseId);
    // The seat is still consumed until someone acts - that is the point.
    expect(await reserved()).toBe(2);
  });

  it('reclaiming frees the seat, audits the reason, and empties the queue', async () => {
    const queue = await api(app)
      .get(`/api/v1/licenses/reclaimable?licenseId=${licenseId}`)
      .set(auth(s.superAdmin));
    const assignmentId = queue.body.data.assignments[0].assignmentId;

    const res = await api(app)
      .post('/api/v1/licenses/reclaim')
      .set(auth(s.superAdmin))
      .send({ assignmentIds: [assignmentId, 'not-a-real-id'], reason: 'Left the company' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.reclaimedCount).toBe(1);
    expect(res.body.data.skippedCount).toBe(1); // unknown ids reported, not fatal

    expect(await reserved()).toBe(1); // the seat is genuinely back
    const active = await prisma.client.licenseAssignment.count({
      where: { licenseId, status: 'ACTIVE' },
    });
    expect(active).toBe(1); // counter and reality agree

    const audit = await prisma.client.auditLog.findFirst({
      where: { action: 'LICENSE_REVOKED', entityId: licenseId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit!.reason).toBe('Left the company');

    const after = await api(app)
      .get(`/api/v1/licenses/reclaimable?licenseId=${licenseId}`)
      .set(auth(s.superAdmin));
    expect(after.body.data.count).toBe(0);
  });

  it('a reason is mandatory, and an employee cannot reclaim', async () => {
    const noReason = await api(app)
      .post('/api/v1/licenses/reclaim')
      .set(auth(s.superAdmin))
      .send({ assignmentIds: ['x'] });
    expect(noReason.status).toBe(422);

    const forbidden = await api(app)
      .post('/api/v1/licenses/reclaim')
      .set(auth(s.employee))
      .send({ assignmentIds: ['x'], reason: 'because I said so' });
    expect(forbidden.status).toBe(403);
  });
});

describe('the 7-day reminder bucket', () => {
  it('a licence five days from expiry alerts in the 7-day bucket', async () => {
    const raised = await sweep.runLicenseSweep();
    expect(raised).toBeDefined();

    const notif = await prisma.client.notification.findFirst({
      where: { type: 'LICENSE_EXPIRING', entityId: licenseId },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif).toBeTruthy();
    // The message names the tightest bucket - a week out, not "within 30 days".
    expect(notif!.body).toMatch(/\b7\b/);
  });
});

describe('the capacity tile', () => {
  it('appears for licence readers and turns critical when a pool is full', async () => {
    // Fill the licence: 4 seats, 1 held - add 3 more holders.
    const candidates = await prisma.client.user.findMany({
      where: {
        companyId: s.superAdmin.user.companyId,
        status: 'ACTIVE',
        deletedAt: null,
        licenseAssignments: { none: { licenseId, status: 'ACTIVE' } },
      },
      select: { id: true },
      take: 3,
    });
    const res = await api(app)
      .post(`/api/v1/licenses/${licenseId}/seats/bulk`)
      .set(auth(s.superAdmin))
      .send({ mode: 'ATOMIC', principals: candidates.map((c) => ({ userId: c.id })) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await reserved()).toBe(4); // full

    const dashboard = await api(app).get('/api/v1/dashboard').set(auth(s.superAdmin));
    expect(dashboard.status).toBe(200);
    const tile = dashboard.body.data.tiles.find(
      (t: { key: string }) => t.key === 'licenses-at-capacity',
    );
    expect(tile).toBeTruthy();
    expect(tile.value).toBeGreaterThanOrEqual(1);
    expect(tile.tone).toBe('danger'); // a full pool is tomorrow's blocked hire
    expect(tile.label).toMatch(/full/i);
  });

  it('an employee never sees the licence tiles at all', async () => {
    const dashboard = await api(app).get('/api/v1/dashboard').set(auth(s.employee));
    expect(dashboard.status).toBe(200);
    const keys = dashboard.body.data.tiles.map((t: { key: string }) => t.key);
    expect(keys).not.toContain('licenses-at-capacity');
    expect(keys).not.toContain('licenses-expiring');
  });
});
