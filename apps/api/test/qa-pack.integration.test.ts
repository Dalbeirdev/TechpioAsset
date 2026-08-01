import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.2 epic #30 Definition-of-Done — QA-pack case runs (APR-*, AST-*, RBAC-*)
 * that were not already pinned by an existing suite. Each test carries its
 * QA-pack case ID so the run doubles as the DoD evidence. Cases exercising
 * blueprint futures (e-signature, vendor portal, impersonation, ABAC) are
 * documented as out of v2.2 scope in the epic instead of being faked here.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

async function createAndSubmit(actor: Session, overrides: Record<string, unknown> = {}) {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(actor))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      priority: 'NORMAL',
      businessReason: 'QA pack verification run for epic #30 definition of done.',
      estimatedCost: '1699.00',
      items: [{ description: 'QA probe laptop', quantity: 1, estimatedCost: '1699.00' }],
      ...overrides,
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const submitted = await api(app)
    .post(`/api/v1/requests/${created.body.data.id}/submit`)
    .set(auth(actor));
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return submitted.body.data as {
    id: string;
    approvals: { id: string; stepName: string; decision: string }[];
  };
}

/** Cancel a request so QA probes do not pile up in the shared inbox. */
async function cancel(actor: Session, id: string) {
  await api(app).post(`/api/v1/requests/${id}/cancel`).set(auth(actor)).send({});
}

describe('QA APR — approvals', () => {
  it('APR-004 boundary: cost exactly at the Finance threshold INCLUDES Finance (blueprint BR-05, inclusive; aligned in v2.3)', async () => {
    const r = await createAndSubmit(s.employee, {
      estimatedCost: '250.00',
      items: [{ description: 'QA boundary probe', quantity: 1, estimatedCost: '250.00' }],
    });
    const names = r.approvals.map((a) => a.stepName.toLowerCase());
    expect(names.some((n) => n.includes('finance'))).toBe(true);
    await cancel(s.employee, r.id);

    // And just below the threshold still skips Finance.
    const below = await createAndSubmit(s.employee, {
      estimatedCost: '249.99',
      items: [{ description: 'QA boundary probe (below)', quantity: 1, estimatedCost: '249.99' }],
    });
    const belowNames = below.approvals.map((a) => a.stepName.toLowerCase());
    expect(belowNames.some((n) => n.includes('finance'))).toBe(false);
    await cancel(s.employee, below.id);
  });

  it('APR-009 SoD: the requester cannot decide their own request (403, step stays pending)', async () => {
    const r = await createAndSubmit(s.employee);
    const res = await api(app)
      .post(`/api/v1/requests/${r.id}/decision`)
      .set(auth(s.employee))
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(403);

    // Nothing was decided: steps are PENDING (current) or WAITING (unreached).
    const after = await api(app).get(`/api/v1/requests/${r.id}`).set(auth(s.employee));
    expect(
      after.body.data.approvals.every((a: { decision: string }) =>
        ['PENDING', 'WAITING'].includes(a.decision),
      ),
    ).toBe(true);
    await cancel(s.employee, r.id);
  });

  it('APR-010 delegation preserves SoD: a delegate cannot approve their own request', async () => {
    // employee raises a request; their manager delegates to... the employee.
    const r = await createAndSubmit(s.employee);
    const delegation = await api(app)
      .post('/api/v1/delegations')
      .set(auth(s.manager))
      .send({ delegateId: s.employee.user.id, reason: 'QA APR-010' });
    expect(delegation.status, JSON.stringify(delegation.body)).toBe(201);

    const res = await api(app)
      .post(`/api/v1/requests/${r.id}/decision`)
      .set(auth(s.employee))
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(403);

    await api(app)
      .delete(`/api/v1/delegations/${delegation.body.data.id}`)
      .set(auth(s.manager));
    await cancel(s.employee, r.id);
  });

  it('APR-011 a valid delegation lets the delegate approve a third party’s request', async () => {
    const r = await createAndSubmit(s.employee);

    // Control: without the delegation, HR cannot decide the line-manager step.
    const before = await api(app)
      .post(`/api/v1/requests/${r.id}/decision`)
      .set(auth(s.hr))
      .send({ decision: 'APPROVED' });
    expect(before.status).toBe(403);

    const delegation = await api(app)
      .post('/api/v1/delegations')
      .set(auth(s.manager))
      .send({ delegateId: s.hr.user.id, reason: 'QA APR-011' });
    expect(delegation.status).toBe(201);

    // HR holds the base requests:approve permission (the route guard) but is
    // NOT the line manager this step waits on — the delegation is what
    // authorises the decision. A delegate without requests:approve is refused
    // at the guard: delegation transfers step authority, not base permissions.
    const res = await api(app)
      .post(`/api/v1/requests/${r.id}/decision`)
      .set(auth(s.hr))
      .send({ decision: 'APPROVED', comment: 'QA APR-011 delegated decision' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    await api(app)
      .delete(`/api/v1/delegations/${delegation.body.data.id}`)
      .set(auth(s.manager));
    await cancel(s.employee, r.id);
  });

  it('APR-012 SLA escalation sweep escalates an overdue step exactly once', async () => {
    const r = await createAndSubmit(s.employee);
    const firstStep = r.approvals[0];
    expect(firstStep).toBeDefined();

    // Age the pending step past its SLA, then run the sweep twice.
    const prisma = app.get(PrismaService);
    await prisma.client.requestApproval.update({
      where: { id: firstStep!.id },
      data: { slaDueAt: new Date(Date.now() - 3_600_000) },
    });
    const sweep = app.get(AlertSweepService);
    const escalated = await sweep.runApprovalEscalationSweep();
    expect(escalated).toBeGreaterThanOrEqual(1);

    const row = await prisma.client.requestApproval.findUnique({
      where: { id: firstStep!.id },
      select: { escalatedAt: true },
    });
    expect(row?.escalatedAt).not.toBeNull();

    // Idempotent: an already-escalated step is not escalated again.
    const again = await sweep.runApprovalEscalationSweep();
    const rowAfter = await prisma.client.requestApproval.findUnique({
      where: { id: firstStep!.id },
      select: { escalatedAt: true },
    });
    expect(rowAfter?.escalatedAt?.getTime()).toBe(row?.escalatedAt?.getTime());
    expect(again).toBeGreaterThanOrEqual(0);

    await cancel(s.employee, r.id);
  });
});

describe('QA AST — assignment custody', () => {
  it('AST-032 only the assignee may acknowledge an assignment', async () => {
    // Find an available asset and assign it to employee3.
    const list = await api(app)
      .get('/api/v1/assets?status=AVAILABLE&pageSize=1')
      .set(auth(s.superAdmin));
    const asset = list.body.data[0];
    expect(asset, 'no AVAILABLE asset in seed data').toBeDefined();

    const assigned = await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId: s.employee3.user.id, conditionOut: 'GOOD' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    const assignment = assigned.body.data.assignments.find(
      (a: { returnedAt: string | null }) => a.returnedAt === null,
    );
    expect(assignment).toBeDefined();

    // A different employee cannot confirm receipt on their behalf.
    const forged = await api(app)
      .post(`/api/v1/assets/assignments/${assignment.id}/acknowledge`)
      .set(auth(s.employee2));
    expect([403, 404]).toContain(forged.status);

    // The real assignee can.
    const genuine = await api(app)
      .post(`/api/v1/assets/assignments/${assignment.id}/acknowledge`)
      .set(auth(s.employee3));
    expect(genuine.status, JSON.stringify(genuine.body)).toBe(201);

    // Restore the pool for other suites.
    const returned = await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.superAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    expect(returned.status).toBe(201);
  });
});

describe('QA RBAC — privilege boundaries', () => {
  it('RBAC-013 HR reads assets without cost fields', async () => {
    const list = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.hr));
    expect(list.status).toBe(200);
    const asset = list.body.data[0];
    expect(asset).toBeDefined();
    expect(asset).not.toHaveProperty('purchaseCost');

    const one = await api(app).get(`/api/v1/assets/${asset.id}`).set(auth(s.hr));
    expect(one.status).toBe(200);
    expect(one.body.data).not.toHaveProperty('purchaseCost');
  });

  it('RBAC-025 an employee cannot change roles — not even their own (403, vertical escalation blocked)', async () => {
    const self = await api(app)
      .patch(`/api/v1/users/${s.employee.user.id}/roles`)
      .set(auth(s.employee))
      .send({ roleKeys: ['EMPLOYEE', 'SUPER_ADMIN'] });
    expect(self.status).toBe(403);
  });

  it('RBAC-027 hidden nav is backed by API denial: employee is refused the audit log and role admin', async () => {
    const audit = await api(app).get('/api/v1/audit').set(auth(s.employee));
    expect(audit.status).toBe(403);
    const roles = await api(app).get('/api/v1/roles').set(auth(s.employee));
    expect(roles.status).toBe(403);
  });
});
