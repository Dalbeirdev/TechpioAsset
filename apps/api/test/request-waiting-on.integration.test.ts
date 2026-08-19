import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.23 - who a request is actually waiting on.
 *
 * A step names a role or "the line manager" rather than a person, so a chain can
 * point at nobody: a requester with no manager recorded, or a role no account
 * holds. The request then waits forever, appears in no one's approval queue, and
 * the detail page looks exactly like one that is about to be approved.
 *
 * Every request in the live tenant was stuck this way. These tests pin the
 * difference between "waiting on someone" and "waiting on no one".
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let requestId: string;
let profileId: string;
let originalManagerId: string | null = null;

/** Raise and submit, so the request is sitting on a real approval step. */
async function raise() {
  const res = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Checking who the approval step resolves to.',
      // Uniquified: the duplicate guard rejects a second open request for the
      // same named item from the same person.
      items: [{ description: `Waiting-on test ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
    });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  const id = res.body.data.id as string;
  await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
  return id;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const profile = await prisma.client.userProfile.findFirstOrThrow({
    where: { userId: s.employee.user.id },
    select: { id: true, managerId: true },
  });
  profileId = profile.id;
  originalManagerId = profile.managerId;

  requestId = await raise();
});

afterAll(async () => {
  // The seeded manager is restored whatever the tests did to it.
  await prisma.client.userProfile.update({
    where: { id: profileId },
    data: { managerId: originalManagerId },
  });
  await app?.close();
});

describe('waitingOn', () => {
  it('names the person the current step is with', async () => {
    const res = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.itAdmin));

    expect(res.status).toBe(200);
    expect(res.body.data.waitingOn).toBeTruthy();
    expect(res.body.data.waitingOn.blocked).toBe(false);
    expect(res.body.data.waitingOn.approvers.length).toBeGreaterThan(0);
    expect(res.body.data.waitingOn.blockedReason).toBeNull();
  });

  it('with no line manager recorded, the Manager role stands in - not blocked', async () => {
    await prisma.client.userProfile.update({ where: { id: profileId }, data: { managerId: null } });
    const withFallback = await raise();

    const res = await api(app).get(`/api/v1/requests/${withFallback}`).set(auth(s.itAdmin));

    // v2.24: this used to be a stall; now the Manager role's holders are the
    // approvers, and the banner names them instead of "nobody".
    expect(res.body.data.waitingOn.blocked).toBe(false);
    expect(
      res.body.data.waitingOn.approvers.some((a: { id: string }) => a.id === s.manager.user.id),
    ).toBe(true);
  });

  it('skips a manager step truly nobody can act on - the chain moves to HR', async () => {
    await prisma.client.userProfile.update({ where: { id: profileId }, data: { managerId: null } });
    // "Nobody" now means no line manager AND an empty Manager role.
    const managerRole = await prisma.client.role.findFirstOrThrow({
      where: { companyId: s.employee.user.companyId, key: 'MANAGER' },
    });
    const holders = await prisma.client.userRole.findMany({ where: { roleId: managerRole.id } });
    await prisma.client.userRole.deleteMany({ where: { roleId: managerRole.id } });

    try {
      const stranded = await raise();
      const res = await api(app).get(`/api/v1/requests/${stranded}`).set(auth(s.itAdmin));

      // v2.24: an unstaffed mid-chain step no longer strands the request - it
      // is skipped with the reason written on the step, and the chain lands on
      // the next staffed desk. Only a LAST unstaffed step still blocks, which
      // manager-fallback.integration.test.ts pins.
      const steps = res.body.data.approvals as { stepName: string; decision: string; comment: string | null }[];
      const managerStep = steps.find((a) => a.stepName.toLowerCase().includes('manager'))!;
      expect(managerStep.decision).toBe('SKIPPED');
      expect(res.body.data.status).toBe('HR_REVIEW_PENDING');
      expect(res.body.data.waitingOn.blocked).toBe(false);
    } finally {
      await prisma.client.userRole.createMany({
        data: holders.map((h) => ({ userId: h.userId, roleId: h.roleId, createdById: h.createdById })),
      });
    }
  });

  it('recovers as soon as the missing manager is recorded', async () => {
    await prisma.client.userProfile.update({
      where: { id: profileId },
      data: { managerId: originalManagerId },
    });

    const res = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.itAdmin));

    expect(res.body.data.waitingOn.blocked).toBe(false);
  });
});
