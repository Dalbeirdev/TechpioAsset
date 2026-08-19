import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - requests that work under any staffing (found broken in production:
 * every request stalled because no profile had a line manager and one step's
 * role had no holders).
 *
 *  1. A LINE_MANAGER step with no manager recorded goes to the Manager ROLE -
 *     inbox, canDecide, waiting-on banner and approval all agree on it.
 *  2. A recorded line manager keeps exclusive claim; the role is a fallback,
 *     not an override.
 *  3. A step whose role nobody holds is SKIPPED with the reason on the step -
 *     unless it is the last step, which always waits for a human.
 *  4. The requester is notified at every intermediate approval, not only the
 *     terminal one.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let savedManagerId: string | null = null;
const fixtures: { definitionIds: string[]; roleIds: string[] } = { definitionIds: [], roleIds: [] };

async function raise(type = 'ADDITIONAL_EQUIPMENT') {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type,
      businessReason: 'Approval staffing behaviour.',
      items: [{ description: `Fallback test ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const id = created.body.data.id as string;
  const submitted = await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
  expect(submitted.status, JSON.stringify(submitted.body)).toBeLessThan(300);
  return id;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  // The whole point is a requester with NO manager recorded. The seed gives the
  // employee one; take it away for this file and restore it after.
  const profile = await prisma.client.userProfile.findUniqueOrThrow({
    where: { userId: s.employee.user.id },
    select: { managerId: true },
  });
  savedManagerId = profile.managerId;
  await prisma.client.userProfile.update({
    where: { userId: s.employee.user.id },
    data: { managerId: null },
  });
  // The denormalised copy new requests take their inbox routing from.
  await prisma.client.assetRequest.updateMany({
    where: { requesterId: s.employee.user.id },
    data: { managerId: null },
  });
});

afterAll(async () => {
  await prisma.client.userProfile.update({
    where: { userId: s.employee.user.id },
    data: { managerId: savedManagerId },
  });
  for (const id of fixtures.definitionIds) {
    await prisma.client.workflowStep.deleteMany({ where: { workflowDefinitionId: id } });
    await prisma.client.workflowDefinition.delete({ where: { id } }).catch(() => {});
  }
  for (const id of fixtures.roleIds) {
    await prisma.client.role.delete({ where: { id } }).catch(() => {});
  }
  await app?.close();
});

describe('the Manager role stands in when no line manager is recorded', () => {
  it('a Manager-role holder can see it, is named on it, and can approve it', async () => {
    const id = await raise();

    // In the manager's inbox.
    const inbox = await api(app)
      .get('/api/v1/requests?awaitingMe=true&pageSize=50')
      .set(auth(s.manager));
    expect((inbox.body.data as { id: string }[]).some((r) => r.id === id)).toBe(true);

    // Offered the controls, and the banner names them rather than "nobody".
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.manager));
    expect(detail.body.data.canDecide).toBe(true);
    expect(detail.body.data.waitingOn.blocked).toBe(false);
    expect(
      detail.body.data.waitingOn.approvers.some(
        (a: { id: string }) => a.id === s.manager.user.id,
      ),
    ).toBe(true);

    // And the approval genuinely works.
    const approved = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED', comment: 'Looks reasonable.' });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
  });

  it('non-managers get no such fallback', async () => {
    const id = await raise();
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.finance));
    expect(detail.body.data.canDecide).toBe(false);
  });

  it('tells the requester about each intermediate approval, not only the last', async () => {
    const id = await raise();
    const before = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, entityId: id, type: 'REQUEST_APPROVED' },
    });

    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED', comment: 'Fine.' });

    // The chain has more steps (HR is next), yet the requester already heard.
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(detail.body.data.status).toBe('HR_REVIEW_PENDING');
    const after = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, entityId: id, type: 'REQUEST_APPROVED' },
    });
    expect(after).toBe(before + 1);
  });
});

describe('steps nobody staffs', () => {
  /** A role with zero holders, and a workflow that routes through it. */
  async function emptyRoleWorkflow(requestType: string, steps: 'middle' | 'only') {
    const role = await prisma.client.role.create({
      data: {
        companyId: s.superAdmin.user.companyId,
        key: `EMPTY_${requestType}`,
        name: `Empty role for ${requestType}`,
        isSystem: false,
      },
    });
    fixtures.roleIds.push(role.id);

    const financeRole = await prisma.client.role.findFirstOrThrow({
      where: { companyId: s.superAdmin.user.companyId, key: 'FINANCE' },
    });

    const definition = await prisma.client.workflowDefinition.create({
      data: {
        companyId: s.superAdmin.user.companyId,
        key: `fixture-${requestType.toLowerCase()}`,
        name: `Fixture: ${requestType}`,
        requestType: requestType as never,
        isActive: true,
        steps: {
          create:
            steps === 'middle'
              ? [
                  { stepOrder: 1, name: 'Manager review', approverType: 'LINE_MANAGER' },
                  { stepOrder: 2, name: 'Ghost review', approverType: 'ROLE', approverRoleId: role.id },
                  { stepOrder: 3, name: 'Finance approval', approverType: 'ROLE', approverRoleId: financeRole.id },
                ]
              : [{ stepOrder: 1, name: 'Ghost review', approverType: 'ROLE', approverRoleId: role.id }],
        },
      },
    });
    fixtures.definitionIds.push(definition.id);
  }

  it('a mid-chain step with an unstaffed role is skipped, with the reason on the step', async () => {
    await emptyRoleWorkflow('UPGRADE', 'middle');
    const id = await raise('UPGRADE');

    // Manager approves; the ghost step must not trap the request.
    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.finance));
    const steps = detail.body.data.approvals as { stepName: string; decision: string; comment: string | null }[];
    const ghost = steps.find((a) => a.stepName === 'Ghost review')!;
    expect(ghost.decision).toBe('SKIPPED');
    expect(ghost.comment).toContain('nobody holds');

    // Landed with finance, who can act.
    expect(detail.body.data.canDecide).toBe(true);
  });

  it('the last step is never skipped - a request always ends on a human decision', async () => {
    await emptyRoleWorkflow('LOSS', 'only');
    const id = await raise('LOSS');

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    const steps = detail.body.data.approvals as { stepName: string; decision: string }[];
    expect(steps.find((a) => a.stepName === 'Ghost review')!.decision).toBe('PENDING');
    // The banner says so honestly rather than pretending progress.
    expect(detail.body.data.waitingOn.blocked).toBe(true);
  });
});
