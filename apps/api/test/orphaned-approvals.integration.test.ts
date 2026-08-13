import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Orphaned approval steps (v2.15) - found in production.
 *
 * The go-live tenant had 51 Employees and one Super Admin; the default
 * workflow's first step routed to a Manager role with zero holders. Result:
 * two requests stalled at MANAGER_APPROVAL_PENDING, nobody notified, and by
 * the strict decide rules nobody ABLE to decide - a deadlock wearing a clean
 * status. These tests pin the two escape hatches: user-managers are told, and
 * user-managers may decide, when (and only when) the approver set is provably
 * empty.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

describe('a role step nobody holds', () => {
  it('notifies user-managers and lets them decide', async () => {
    const run = `${Date.now()}`;

    // An empty custom role - the orphan target. Nothing else references it,
    // so parallel suites are untouched.
    const company = await prisma.client.company.findFirstOrThrow({
      where: { id: s.superAdmin.user.companyId },
    });
    const orphanRole = await prisma.client.role.create({
      data: { companyId: company.id, key: `ORPHAN_${run}`, name: `Orphan ${run}`, isSystem: false },
    });

    // A normal request through the normal door.
    const filed = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'DAMAGE',
        businessReason: 'Orphaned-approval regression: hinge cracked on the lid',
        isReplacement: false,
        items: [{ description: `Repair hinge (${Math.random().toString(36).slice(2, 8)})`, quantity: 1 }],
      });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const requestId = filed.body.data.id as string;
    await api(app).post(`/api/v1/requests/${requestId}/submit`).set(auth(s.employee));

    // Re-point the SECOND step at the empty role, then approve step one as
    // the manager: decide() will announce step two - to nobody, which is the
    // case under test.
    const approvals = await prisma.client.requestApproval.findMany({
      where: { requestId },
      orderBy: { stepOrder: 'asc' },
    });
    expect(approvals.length).toBeGreaterThanOrEqual(2);
    await prisma.client.requestApproval.update({
      where: { id: approvals[1]!.id },
      data: { approverRoleId: orphanRole.id, approverId: null, approverType: 'ROLE' },
    });

    const first = await api(app)
      .post(`/api/v1/requests/${requestId}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);

    // 1. The silence is broken: user-managers were told, by name.
    const warning = await prisma.client.notification.findFirst({
      where: {
        entityId: requestId,
        userId: s.superAdmin.user.id,
        title: { contains: 'has no approver' },
      },
    });
    expect(warning, 'user-managers should be told about the orphaned step').not.toBeNull();

    // 2. The deadlock is escapable: a user-manager may decide the empty step.
    const rescued = await api(app)
      .post(`/api/v1/requests/${requestId}/decision`)
      .set(auth(s.superAdmin))
      .send({ decision: 'APPROVED' });
    expect(rescued.status, JSON.stringify(rescued.body).slice(0, 300)).toBe(201);

    // 3. And ONLY when empty: give the role a member and the shortcut closes.
    const another = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'DAMAGE',
        businessReason: 'Second orphan-check request for the closed-door case',
        isReplacement: false,
        items: [{ description: `Check (${Math.random().toString(36).slice(2, 8)})`, quantity: 1 }],
      });
    const secondId = another.body.data.id as string;
    await api(app).post(`/api/v1/requests/${secondId}/submit`).set(auth(s.employee));
    const secondApprovals = await prisma.client.requestApproval.findMany({
      where: { requestId: secondId },
      orderBy: { stepOrder: 'asc' },
    });
    await prisma.client.requestApproval.update({
      where: { id: secondApprovals[0]!.id },
      data: { approverRoleId: orphanRole.id, approverId: null, approverType: 'ROLE' },
    });
    await prisma.client.userRole.create({
      data: { userId: s.employee2.user.id, roleId: orphanRole.id },
    });

    const blocked = await api(app)
      .post(`/api/v1/requests/${secondId}/decision`)
      .set(auth(s.superAdmin))
      .send({ decision: 'APPROVED' });
    // The role has a holder now; the Super Admin is back outside the door.
    expect(blocked.status).toBe(403);
  });
});
