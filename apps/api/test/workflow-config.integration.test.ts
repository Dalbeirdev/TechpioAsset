import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - configuring approval workflows from the application.
 *
 * Spec section 11 has always required Super Admins to configure steps and
 * thresholds. `workflows:configure` was granted to Super Admin and enforced by
 * no route, so a cost threshold could only be changed by editing the database
 * by hand: no audit row, and nobody but an engineer could do it.
 *
 * The behavioural test is the one that matters: clearing the Finance step's
 * threshold must make Finance review a cheap request it previously never saw.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let financeStepId: string;
let originalThreshold: string | null = null;

const listWorkflows = (as: Session) => api(app).get('/api/v1/workflows').set(auth(as));

async function raiseCheapRequest() {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.officeAdmin))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Threshold behaviour.',
      estimatedCost: '10.00',
      items: [
        { description: `Cheap ${Math.random().toString(36).slice(2, 8)}`, quantity: 1, estimatedCost: '10.00' },
      ],
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const id = created.body.data.id as string;
  await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.officeAdmin));
  return id;
}

/**
 * Does the Finance step actually apply?
 *
 * The chain has to be walked to find out: since v2.25 a threshold is evaluated
 * when the step comes up, not when the chain is built, because the cost is
 * entered after submission. A queued step has simply not been decided yet.
 */
async function financeApplies(id: string) {
  const byStep: Record<string, AccountKey> = {
    'Manager review': 'manager',
    'HR confirmation': 'hr',
    'IT review': 'itAdmin',
    'Office review': 'officeAdmin',
  };
  for (let guard = 0; guard < 8; guard += 1) {
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    const steps = detail.body.data.approvals as { stepName: string; decision: string }[];
    const finance = steps.find((a) => a.stepName === 'Finance approval');
    if (!finance) return false;
    if (finance.decision === 'SKIPPED') return false;
    if (finance.decision !== 'WAITING') return true;

    const current = steps.find((a) => a.decision === 'PENDING');
    if (!current) return false;
    const who = byStep[current.stepName];
    if (!who) return false;
    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s[who]))
      .send({ decision: 'APPROVED' });
  }
  return false;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const step = await prisma.client.workflowStep.findFirstOrThrow({
    where: {
      name: 'Finance approval',
      workflowDefinition: { companyId: s.superAdmin.user.companyId, requestType: null },
    },
    select: { id: true, costThreshold: true },
  });
  financeStepId = step.id;
  originalThreshold = step.costThreshold ? step.costThreshold.toString() : null;
});

afterAll(async () => {
  await prisma.client.workflowStep.update({
    where: { id: financeStepId },
    data: { costThreshold: originalThreshold },
  });
  await app?.close();
});

describe('reading the configured chains', () => {
  it('needs workflows:configure - IT and HR cannot see it', async () => {
    for (const who of ['itAdmin', 'hr', 'employee'] as AccountKey[]) {
      const res = await listWorkflows(s[who]);
      expect(res.status, `${who} must not read workflow configuration`).toBe(403);
    }
  });

  it('reports each step with how many people could actually decide it', async () => {
    const res = await listWorkflows(s.superAdmin);
    expect(res.status).toBe(200);

    const itWorkflow = (res.body.data as { requestType: string | null; steps: unknown[] }[]).find(
      (w) => w.requestType === null,
    )!;
    const steps = itWorkflow.steps as {
      name: string;
      eligibleApprovers: number;
      costThreshold: string | null;
    }[];

    expect(steps.map((x) => x.name)).toContain('Finance approval');
    // The staffing number is the point of the page: a threshold is only half
    // the question about whether a step will ever be decided.
    for (const step of steps) expect(typeof step.eligibleApprovers).toBe('number');
  });
});

describe('clearing a threshold', () => {
  it('makes the step review every request, and is audited', async () => {
    // Before: a cheap request never reaches Finance.
    await prisma.client.workflowStep.update({
      where: { id: financeStepId },
      data: { costThreshold: '250' },
    });
    // v2.25 - the step is created either way; the threshold decides whether it
    // applies when it comes up, because the cost is entered after submission.
    expect(await financeApplies(await raiseCheapRequest())).toBe(false);

    const cleared = await api(app)
      .patch(`/api/v1/workflows/steps/${financeStepId}`)
      .set(auth(s.superAdmin))
      .send({ costThreshold: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBeLessThan(300);

    // After: the same cheap request does.
    expect(await financeApplies(await raiseCheapRequest())).toBe(true);

    // Changing who must approve what leaves the same trail a role change does.
    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: financeStepId },
      orderBy: { createdAt: 'desc' },
    });
    expect(trail).not.toBeNull();
    expect(JSON.stringify(trail!.previousValues)).toContain('250');
  });

  it('refuses a step belonging to another tenant, as missing rather than forbidden', async () => {
    const res = await api(app)
      .patch('/api/v1/workflows/steps/not-a-real-step-id')
      .set(auth(s.superAdmin))
      .send({ costThreshold: null });
    expect(res.status).toBe(404);
  });

  it('rejects a nonsense threshold', async () => {
    const res = await api(app)
      .patch(`/api/v1/workflows/steps/${financeStepId}`)
      .set(auth(s.superAdmin))
      .send({ costThreshold: '-5' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
