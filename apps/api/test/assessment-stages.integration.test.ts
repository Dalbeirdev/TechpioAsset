import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.25 - Inventory check and Cost assessment as stages in the chain.
 *
 * The commercial half used to be a panel anyone with the permission could fill
 * in whenever they liked, which left "has anybody actually checked stock?"
 * unanswerable. As stages they sit in the chain, they hold the request until
 * the answer exists, and the answer itself completes them - nobody approves an
 * inventory check.
 *
 * The two scenarios differ in what the stages do: with stock, the cost stage
 * has nothing to price and stands aside; without, it holds the request until a
 * figure exists, and that figure is what Finance is measured against.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let definitionId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const definition = await prisma.client.workflowDefinition.findFirstOrThrow({
    where: { companyId: s.superAdmin.user.companyId, requestType: null, isActive: true },
    select: { id: true },
  });
  definitionId = definition.id;

  await prisma.client.workflowStep.updateMany({
    where: { workflowDefinitionId: definitionId, name: 'Finance approval' },
    data: { costThreshold: '250' },
  });
  // Start from a known state whatever a previous run left behind.
  await api(app)
    .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
    .set(auth(s.superAdmin))
    .send({ enabled: false });
});

afterAll(async () => {
  await api(app)
    .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
    .set(auth(s.superAdmin))
    .send({ enabled: false });
  await app?.close();
});

const enableStages = () =>
  api(app)
    .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
    .set(auth(s.superAdmin))
    .send({ enabled: true });

async function raise() {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Required for software development work.',
      items: [{ description: `Laptop ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const id = created.body.data.id as string;
  await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
  return id;
}

const chain = async (id: string) => {
  const res = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
  return res.body.data.approvals as {
    stepName: string;
    decision: string;
    comment: string | null;
  }[];
};

/** Approve the ordinary steps until an assessment stage (or Finance) is current. */
async function walkToStage(id: string) {
  const byStep: Record<string, AccountKey> = {
    'Manager review': 'manager',
    'HR confirmation': 'hr',
    'IT review': 'itAdmin',
  };
  for (let guard = 0; guard < 8; guard += 1) {
    const current = (await chain(id)).find((a) => a.decision === 'PENDING');
    if (!current) return null;
    const who = byStep[current.stepName];
    if (!who) return current;
    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s[who]))
      .send({ decision: 'APPROVED' });
  }
  throw new Error('chain did not settle');
}

describe('configuring the stages', () => {
  it('inserts them before the thresholded step, because that is what they answer', async () => {
    const res = await enableStages();
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const steps = await prisma.client.workflowStep.findMany({
      where: { workflowDefinitionId: definitionId },
      orderBy: { stepOrder: 'asc' },
      select: { name: true, kind: true, stepOrder: true },
    });
    const names = steps.map((x) => x.name);
    expect(names).toEqual([
      'Manager review',
      'HR confirmation',
      'IT review',
      'Inventory check',
      'Cost assessment',
      'Finance approval',
    ]);
    // Ordering must stay strictly increasing and unique after the shuffle.
    const orders = steps.map((x) => x.stepOrder);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('leaves no gaps after repeated add and remove', async () => {
    // Adding shifts later steps down by two; removing used to leave them there,
    // so a workflow toggled a few times ended up with its last step at order
    // 10. Found on a dev database after a handful of test runs.
    for (let i = 0; i < 3; i += 1) {
      await enableStages();
      await api(app)
        .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
        .set(auth(s.superAdmin))
        .send({ enabled: false });
    }
    const orders = (
      await prisma.client.workflowStep.findMany({
        where: { workflowDefinitionId: definitionId },
        orderBy: { stepOrder: 'asc' },
        select: { stepOrder: true },
      })
    ).map((x) => x.stepOrder);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
  });

  it('is idempotent - enabling twice does not duplicate the stages', async () => {
    await enableStages();
    await enableStages();
    const count = await prisma.client.workflowStep.count({
      where: { workflowDefinitionId: definitionId, kind: { not: 'APPROVAL' } },
    });
    expect(count).toBe(2);
  });

  it('needs workflows:configure', async () => {
    const res = await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.officeAdmin))
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });
});

describe('Scenario A — already in stock', () => {
  it('the inventory answer completes the stage and the cost stage stands aside', async () => {
    await enableStages();
    const id = await raise();

    const stage = await walkToStage(id);
    expect(stage?.stepName).toBe('Inventory check');

    // Nobody approves an inventory check - it is completed by answering it.
    const approving = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.officeAdmin))
      .send({ decision: 'APPROVED' });
    expect(approving.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(approving.body)).toContain('recording the assessment');

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false });

    const after = await chain(id);
    const inventory = after.find((a) => a.stepName === 'Inventory check')!;
    const cost = after.find((a) => a.stepName === 'Cost assessment')!;
    const finance = after.find((a) => a.stepName === 'Finance approval')!;

    expect(inventory.decision).toBe('APPROVED');
    expect(inventory.comment).toContain('Filled from existing stock');
    expect(cost.decision, 'nothing to price').toBe('SKIPPED');
    expect(cost.comment).toContain('nothing to cost');
    expect(finance.decision, 'no new expenditure').toBe('SKIPPED');

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(detail.body.data.status).toBe('APPROVED');
  });
});

describe('Scenario B — it has to be bought', () => {
  it('holds at the cost stage until a figure exists, then routes on that figure', async () => {
    await enableStages();
    const id = await raise();

    const stage = await walkToStage(id);
    expect(stage?.stepName).toBe('Inventory check');

    // Answering "a purchase is required" clears the check but NOT the costing:
    // there is still no figure, so the chain must wait rather than reach
    // Finance with nothing to measure.
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true });

    let after = await chain(id);
    expect(after.find((a) => a.stepName === 'Inventory check')!.decision).toBe('APPROVED');
    expect(after.find((a) => a.stepName === 'Cost assessment')!.decision).toBe('PENDING');

    const held = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(held.body.data.status).toBe('OFFICE_ADMIN_REVIEW_PENDING');

    // Now the figure, which both completes the stage and decides Finance.
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ suggestedProduct: 'Dell Latitude 7450', unitPrice: '1000.00', quantity: 1 });

    after = await chain(id);
    expect(after.find((a) => a.stepName === 'Cost assessment')!.decision).toBe('APPROVED');
    expect(after.find((a) => a.stepName === 'Cost assessment')!.comment).toContain('1000');
    expect(after.find((a) => a.stepName === 'Finance approval')!.decision).toBe('PENDING');

    const atFinance = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.finance));
    expect(atFinance.body.data.status).toBe('FINANCE_APPROVAL_PENDING');
    expect(atFinance.body.data.canDecide).toBe(true);
  });

  it('a cheap purchase clears both stages and still skips Finance', async () => {
    await enableStages();
    const id = await raise();
    await walkToStage(id);

    // Both answers in one save: both stages should clear.
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true, unitPrice: '150.00', quantity: 1 });

    const after = await chain(id);
    expect(after.find((a) => a.stepName === 'Inventory check')!.decision).toBe('APPROVED');
    expect(after.find((a) => a.stepName === 'Cost assessment')!.decision).toBe('APPROVED');
    const finance = after.find((a) => a.stepName === 'Finance approval')!;
    expect(finance.decision).toBe('SKIPPED');
    expect(finance.comment).toContain('under the 250');
  });

  it('the requester is told as each stage completes, without a figure', async () => {
    await enableStages();
    const id = await raise();
    await walkToStage(id);

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true });

    const told = await prisma.client.notification.findMany({
      where: { entityId: id, userId: s.employee.user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { title: true, body: true },
    });
    const stageNote = told.find((n) => n.title.includes('Inventory check completed'));
    expect(stageNote, 'the requester hears that the check is done').toBeTruthy();
    // And hears nothing about money.
    expect(JSON.stringify(told)).not.toMatch(/1000|price|vendor/i);
  });
});

describe('a list row names the step it is on', () => {
  /**
   * v2.26 - the reason this exists. A row could only report its STATUS, and
   * Inventory check and Cost assessment both resolve to
   * OFFICE_ADMIN_REVIEW_PENDING, so both rendered as "Office review" - wording
   * that matches no step, no role and no permission. It sent the owner through
   * every role looking for an "Office review" permission that does not exist.
   */
  it('reports the live step, not just the status', async () => {
    await enableStages();
    const id = await raise();
    await walkToStage(id);

    const res = await api(app)
      .get(`/api/v1/requests?pageSize=100`)
      .set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const row = (res.body.data as { id: string; status: string; currentStep: { name: string; kind: string } | null }[])
      .find((r) => r.id === id);
    expect(row, 'the request should be in the list').toBeTruthy();
    expect(row!.status).toBe('OFFICE_ADMIN_REVIEW_PENDING');
    // The status is the coarse one; the step is what a person can act on.
    expect(row!.currentStep?.name).toBe('Inventory check');
    expect(row!.currentStep?.kind).toBe('INVENTORY_CHECK');

    // Answer it, and the row should move on to the next stage by name.
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true });

    const after = await api(app).get(`/api/v1/requests?pageSize=100`).set(auth(s.superAdmin));
    const moved = (after.body.data as { id: string; currentStep: { name: string } | null }[])
      .find((r) => r.id === id);
    expect(moved!.currentStep?.name).toBe('Cost assessment');
  });

  it('has no step to name once nothing is pending', async () => {
    const id = await raise();
    await api(app).post(`/api/v1/requests/${id}/cancel`).set(auth(s.employee)).send({});

    const res = await api(app).get(`/api/v1/requests?pageSize=100`).set(auth(s.superAdmin));
    const row = (res.body.data as { id: string; currentStep: unknown }[]).find((r) => r.id === id);
    expect(row!.currentStep, 'a cancelled request is on no step').toBeNull();
  });
});

describe('the dashboard tile agrees with the inbox', () => {
  /**
   * v2.26 - they disagreed. The tile counted only steps carrying
   * `approverId: actor.id`, but a role-based step has no approverId until it is
   * decided, so it counted almost nothing. An Office Administrator with a full
   * inbox saw "Awaiting my approval: 0" on a tile linking to the very list that
   * showed them all. Found by opening the mobile app and reading the home
   * screen next to the approvals tab.
   */
  it('counts a role-based step the same way the list does', async () => {
    await enableStages();
    const id = await raise();
    const stage = await walkToStage(id);
    expect(stage?.stepName).toBe('Inventory check');

    const inbox = await api(app)
      .get('/api/v1/requests?awaitingMe=true&pageSize=100')
      .set(auth(s.officeAdmin));
    // The page is capped; the tile counts everything, so compare against the
    // total rather than the page length.
    const waiting = inbox.body.meta.page.totalItems as number;
    expect(waiting, 'the inventory stage should be in the inbox').toBeGreaterThan(0);
    expect(
      (inbox.body.data as { id: string }[]).some((r) => r.id === id),
      'this request specifically should be in it',
    ).toBe(true);

    const dash = await api(app).get('/api/v1/dashboard').set(auth(s.officeAdmin));
    const tile = (dash.body.data.tiles as { key: string; value: number }[]).find(
      (t) => t.key === 'awaiting-approval',
    );
    expect(tile, 'the tile should be present for an approver').toBeTruthy();
    expect(tile!.value, 'tile must not read 0 while the inbox has items').toBe(waiting);
  });
});
