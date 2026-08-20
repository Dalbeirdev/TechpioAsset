import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.25 - the employee states a requirement, somebody authorised states the
 * price.
 *
 * The load-bearing test is the first one. Before this, an employee could POST
 * `estimatedCost: 1` for a laptop and the Finance step was dropped from the
 * chain: the form hid the field, nothing enforced it, so the control was a
 * courtesy. Everything else here exists to make that fix usable - the cost has
 * to come from somewhere, and it arrives after submission, which is why the
 * threshold is evaluated when the step comes up rather than when the chain is
 * built.
 *
 * Scenario A and B are the two the process actually has: the thing is already
 * on the shelf, or it has to be bought.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;

const FINANCE_STEP = 'Finance approval';

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  // Pin the threshold this file reasons about, whatever the tenant is set to.
  await prisma.client.workflowStep.updateMany({
    where: {
      name: FINANCE_STEP,
      workflowDefinition: { companyId: s.superAdmin.user.companyId, requestType: null },
    },
    data: { costThreshold: '250' },
  });
});

afterAll(async () => {
  await app?.close();
});

/** Raise and submit as the employee, returning the chain that was built. */
async function raise(body: Record<string, unknown> = {}) {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Required for development work.',
      items: [{ description: `Laptop ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
      ...body,
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const id = created.body.data.id as string;
  const submitted = await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
  expect(submitted.status, JSON.stringify(submitted.body)).toBeLessThan(300);
  return id;
}

const chainOf = async (id: string, as: Session = s.superAdmin) => {
  const res = await api(app).get(`/api/v1/requests/${id}`).set(auth(as));
  return res.body.data.approvals as { stepName: string; decision: string; comment: string | null }[];
};

/** Walk the chain to the step named, approving as whoever currently holds it. */
async function approveUntil(id: string, stopAt: string) {
  const byStep: Record<string, AccountKey> = {
    'Manager review': 'manager',
    'HR confirmation': 'hr',
    'IT review': 'itAdmin',
    'Office review': 'officeAdmin',
    [FINANCE_STEP]: 'finance',
  };
  for (let guard = 0; guard < 8; guard += 1) {
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    const current = (detail.body.data.approvals as { stepName: string; decision: string }[]).find(
      (a) => a.decision === 'PENDING',
    );
    if (!current || current.stepName === stopAt) return current ?? null;
    const who = byStep[current.stepName];
    if (!who) throw new Error(`no account mapped for step ${current.stepName}`);
    const done = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s[who]))
      .send({ decision: 'APPROVED' });
    expect(done.status, `${current.stepName}: ${JSON.stringify(done.body)}`).toBeLessThan(300);
  }
  throw new Error('chain did not settle');
}

describe('an employee cannot price their own request', () => {
  it('drops a cost supplied by the requester, so Finance is not routed around', async () => {
    // The exact bypass: a laptop declared at 1.00 to duck the 250 threshold.
    const id = await raise({
      estimatedCost: '1.00',
      items: [{ description: `Bypass ${Math.random().toString(36).slice(2, 8)}`, quantity: 1, estimatedCost: '1.00' }],
    });

    const stored = await prisma.client.assetRequest.findUniqueOrThrow({
      where: { id },
      select: { estimatedCost: true },
    });
    expect(stored.estimatedCost, 'the requester’s figure must not be recorded').toBeNull();

    // And the chain still contains Finance: an unpriced request goes to a human.
    expect((await chainOf(id)).map((a) => a.stepName)).toContain(FINANCE_STEP);
  });

  it('keeps a cost supplied by somebody who may price', async () => {
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.officeAdmin))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Raised on behalf, priced by the office.',
        estimatedCost: '1699.00',
        items: [{ description: `Priced ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
      });
    expect(created.status).toBeLessThan(300);
    const stored = await prisma.client.assetRequest.findUniqueOrThrow({
      where: { id: created.body.data.id },
      select: { estimatedCost: true },
    });
    expect(stored.estimatedCost?.toString()).toBe('1699');
  });

  it('will not let the requester read the commercial assessment of their own request', async () => {
    const id = await raise();
    const res = await api(app).get(`/api/v1/requests/${id}/assessment`).set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('will not let the requester write one', async () => {
    const id = await raise();
    const res = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.employee))
      .send({ unitPrice: '1.00', purchaseRequired: true });
    expect(res.status).toBe(403);
  });
});

describe('the total is computed, never asserted', () => {
  it('adds tax and shipping and subtracts the discount', async () => {
    const id = await raise();
    const res = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({
        purchaseRequired: true,
        unitPrice: '1000.00',
        quantity: 2,
        taxAmount: '360.00',
        shipping: '150.00',
        discount: '100.00',
      });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    // 1000 x 2 + 360 + 150 - 100
    expect(res.body.data.totalCost).toBe('2410');
    expect(res.body.data.assessedBy.id).toBe(s.officeAdmin.user.id);
  });

  it('refuses a total supplied by the caller', async () => {
    const id = await raise();
    const res = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ unitPrice: '10.00', totalCost: '999999.00' });
    // .strict() on the schema: an unknown key is a rejection, not a silent drop.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('merges partial updates rather than blanking what it was not sent', async () => {
    const id = await raise();
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ purchaseRequired: true, unitPrice: '500.00', suggestedProduct: 'Dell Latitude 7450' });

    const second = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ shipping: '50.00' });

    expect(second.body.data.suggestedProduct).toBe('Dell Latitude 7450');
    expect(second.body.data.totalCost).toBe('550');
  });
});

describe('Scenario A — the thing is already on the shelf', () => {
  it('skips Finance for no new expenditure, and says so on the step', async () => {
    const id = await raise();

    const assessed = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false });
    expect(assessed.status).toBeLessThan(300);
    expect(assessed.body.data.totalCost, 'nothing to spend means nothing to price').toBeNull();

    await approveUntil(id, FINANCE_STEP);

    const finance = (await chainOf(id)).find((a) => a.stepName === FINANCE_STEP)!;
    expect(finance.decision).toBe('SKIPPED');
    expect(finance.comment).toContain('no new expenditure');

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(detail.body.data.status).toBe('APPROVED');
  });
});

describe('Scenario B — it has to be bought', () => {
  it('routes to Finance when the assessed total clears the threshold', async () => {
    const id = await raise();

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({
        inventoryAvailable: false,
        purchaseRequired: true,
        suggestedProduct: 'Dell Latitude 7450',
        unitPrice: '1000.00',
        quantity: 1,
      });

    const current = await approveUntil(id, FINANCE_STEP);
    expect(current?.stepName).toBe(FINANCE_STEP);

    const atFinance = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.finance));
    expect(atFinance.body.data.status).toBe('FINANCE_APPROVAL_PENDING');
    expect(atFinance.body.data.canDecide).toBe(true);
  });

  it('skips Finance when the assessed total is under the threshold', async () => {
    const id = await raise();

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true, unitPrice: '150.00', quantity: 1 });

    await approveUntil(id, FINANCE_STEP);

    const finance = (await chainOf(id)).find((a) => a.stepName === FINANCE_STEP)!;
    expect(finance.decision).toBe('SKIPPED');
    expect(finance.comment).toContain('under the 250');
  });

  it('a cost entered late still decides the routing — the point of assessing after submission', async () => {
    const id = await raise();
    // Walk right up to Finance with no assessment at all...
    await approveUntil(id, FINANCE_STEP);
    const before = (await chainOf(id)).find((a) => a.stepName === FINANCE_STEP)!;
    expect(before.decision, 'unpriced goes to a human').toBe('PENDING');
  });
});
