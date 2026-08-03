import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, login, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.9 C2 — a budget is a hard limit, not a warning.
 *
 * The proofs that matter are the ones a read-then-write would fail: two
 * approvers racing the last of a budget, and a release that must give the money
 * back exactly once however many times it is called.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;
let vendorId: string;
/** employee3 borrowed as a second approver, so two people can race. */
let pm: Session;

const base = '/api/v1/procurement';
let seq = 0;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
  const vendor = await prisma.client.vendor.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } });
  vendorId = vendor!.id;

  const roles = await api(app)
    .patch(`/api/v1/users/${s.employee3.user.id}/roles`)
    .set(auth(s.superAdmin))
    .send({ roleKeys: ['PROCUREMENT_MANAGER'] });
  expect(roles.status, JSON.stringify(roles.body)).toBe(200);
  pm = await login(app, 'employee3@techpioasset.dev');
});

afterAll(async () => {
  await api(app)
    .patch(`/api/v1/users/${s.employee3.user.id}/roles`)
    .set(auth(s.superAdmin))
    .send({ roleKeys: ['EMPLOYEE'] });
  // Commitments reference budgets, which reference cost centres (RESTRICT).
  await prisma.client.purchaseRequest.updateMany({
    where: { companyId, costCentreId: { not: null } },
    data: { costCentreId: null, budgetId: null, committedAmount: null, committedAt: null },
  });
  await prisma.client.budget.deleteMany({ where: { companyId } });
  await prisma.client.costCentre.deleteMany({ where: { companyId } });
  await app?.close();
});

async function costCentre(code: string) {
  const res = await api(app)
    .post('/api/v1/cost-centres')
    .set(auth(s.finance))
    .send({ code, name: `Cost centre ${code}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

async function budget(costCentreId: string, amount: string, name = 'FY26') {
  const res = await api(app)
    .post('/api/v1/budgets')
    .set(auth(s.finance))
    .send({
      costCentreId,
      name,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      currency: 'USD',
      amount,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; remaining: string; committed: string };
}

/** A SUBMITTED request for `total`, charged to `costCentreId`. */
async function submittedPr(costCentreId: string | null, total: string, requester: Session = s.employee) {
  seq += 1;
  const res = await api(app)
    .post(`${base}/requests`)
    .set(auth(requester))
    .send({
      justification: `Budget probe ${seq}: kit for the build lab, charged to a cost centre.`,
      lines: [{ description: `Budget probe ${seq}`, quantity: 1, estimatedUnitPrice: total }],
      ...(costCentreId ? { costCentreId } : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.id as string;
  expect((await api(app).post(`${base}/requests/${id}/submit`).set(auth(requester))).status).toBe(201);
  return id;
}

const approve = (id: string, approver: Session = s.finance) =>
  api(app).post(`${base}/requests/${id}/decision`).set(auth(approver)).send({ decision: 'APPROVE' });

const readBudget = async (id: string) =>
  (await api(app).get(`/api/v1/budgets/${id}`).set(auth(s.finance))).body.data as {
    amount: string;
    committed: string;
    remaining: string;
    utilisationPercent: number;
    commitments: { prNumber: string; committedAmount: string }[];
  };

describe('a budget is a hard limit', () => {
  it('an approval commits its estimate, and the budget says who is holding it', async () => {
    const centre = await costCentre('C2-HOLD');
    const b = await budget(centre, '1000.00');
    const pr = await submittedPr(centre, '250.00');

    const ok = await approve(pr);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.status).toBe('APPROVED');
    expect(ok.body.data.committedAmount).toBe('250');

    const after = await readBudget(b.id);
    expect(after.committed).toBe('250');
    expect(after.remaining).toBe('750.00');
    expect(after.utilisationPercent).toBe(25);
    expect(after.commitments).toHaveLength(1);
  });

  it('refuses the request that would exceed it, with remaining, committed and requested', async () => {
    const centre = await costCentre('C2-REFUSE');
    const b = await budget(centre, '1000.00');
    expect((await approve(await submittedPr(centre, '900.00'))).status).toBe(201);

    const tooBig = await approve(await submittedPr(centre, '150.00'));
    expect(tooBig.status).toBe(409);
    expect(tooBig.body.detail).toContain('Requested: 150.00 USD');
    expect(tooBig.body.detail).toContain('Remaining: 100.00');
    expect(tooBig.body.detail).toContain('Committed: 900.00 of 1000.00');
    expect(tooBig.body.detail).toContain('Short by 50.00');

    // The refusal took nothing: the budget is exactly as it was.
    expect((await readBudget(b.id)).committed).toBe('900');
  });

  it('a refused approval leaves the request decidable, not half-approved', async () => {
    const centre = await costCentre('C2-ATOMIC');
    await budget(centre, '100.00');
    const pr = await submittedPr(centre, '500.00');
    expect((await approve(pr)).status).toBe(409);

    const state = await api(app).get(`${base}/requests/${pr}`).set(auth(s.finance));
    expect(state.body.data.status).toBe('SUBMITTED');
    expect(state.body.data.committedAmount).toBeNull();
    // And it can still be rejected or re-costed - nothing is stuck.
    const rejected = await api(app)
      .post(`${base}/requests/${pr}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'REJECT', reason: 'Over budget - split it.' });
    expect(rejected.status).toBe(201);
  });

  it('spending a budget to exactly zero is allowed; the next cent is not', async () => {
    const centre = await costCentre('C2-EXACT');
    const b = await budget(centre, '500.00');
    expect((await approve(await submittedPr(centre, '500.00'))).status).toBe(201);
    expect((await readBudget(b.id)).remaining).toBe('0.00');
    expect((await approve(await submittedPr(centre, '0.01'))).status).toBe(409);
  });

  it('a request charged to a cost centre needs an estimate before it can be approved', async () => {
    const centre = await costCentre('C2-NOEST');
    await budget(centre, '1000.00');
    seq += 1;
    const created = await api(app)
      .post(`${base}/requests`)
      .set(auth(s.employee))
      .send({
        justification: 'Budget probe: no price on the line, so nothing can be reserved.',
        lines: [{ description: 'Unpriced item', quantity: 1 }],
        costCentreId: centre,
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    await api(app).post(`${base}/requests/${id}/submit`).set(auth(s.employee));

    const refused = await approve(id);
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatch(/needs an estimated cost/i);
  });

  it('requests with no cost centre approve exactly as they did before budgets existed', async () => {
    const pr = await submittedPr(null, '80.00');
    const ok = await approve(pr, pm);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.committedAmount).toBeNull();
  });
});

describe('concurrency: the last of a budget', () => {
  it('two approvers racing the last 250 commit exactly one, and the budget is never overcommitted', async () => {
    const centre = await costCentre('C2-RACE');
    const b = await budget(centre, '1000.00');
    expect((await approve(await submittedPr(centre, '750.00'))).status).toBe(201);

    // Two different requests, two different approvers, one 250 left.
    const [a, c] = await Promise.all([
      approve(await submittedPr(centre, '250.00'), s.finance),
      approve(await submittedPr(centre, '250.00'), s.superAdmin),
    ]);
    expect([a.status, c.status].sort()).toEqual([201, 409]);

    const after = await readBudget(b.id);
    expect(after.committed).toBe('1000');
    expect(after.remaining).toBe('0.00');
    // Two commitments totalling exactly the budget - not three.
    expect(after.commitments).toHaveLength(2);
  });

  it('a six-way storm on a budget with room for three yields exactly three winners', async () => {
    const centre = await costCentre('C2-STORM');
    const b = await budget(centre, '300.00');
    const requests = await Promise.all(Array.from({ length: 6 }, () => submittedPr(centre, '100.00')));
    const results = await Promise.all(
      requests.map((id, i) => approve(id, i % 2 === 0 ? s.finance : s.superAdmin)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);

    const after = await readBudget(b.id);
    expect(after.committed).toBe('300');
    expect(after.utilisationPercent).toBe(100);
  });
});

describe('releasing gives the money back, exactly once', () => {
  it('cancelling a committed request returns its commitment to the budget', async () => {
    const centre = await costCentre('C2-CANCEL');
    const b = await budget(centre, '1000.00');
    const pr = await submittedPr(centre, '400.00');
    expect((await approve(pr)).status).toBe(201);
    expect((await readBudget(b.id)).committed).toBe('400');

    const cancelled = await api(app)
      .post(`${base}/requests/${pr}/cancel`)
      .set(auth(s.finance))
      .send({ reason: 'Vendor withdrew the quote.' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.committedAmount).toBeNull();

    const after = await readBudget(b.id);
    expect(after.committed).toBe('0');
    expect(after.remaining).toBe('1000.00');
    expect(after.commitments).toHaveLength(0);
    // The give-back is audited against the budget, with the figure.
    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'BUDGET_RELEASED', entityId: b.id },
      select: { previousValues: true },
    });
    expect(JSON.stringify(audit?.previousValues)).toContain('400.00');
  });

  it('cancelling twice releases once - the second attempt cannot credit the budget again', async () => {
    const centre = await costCentre('C2-TWICE');
    const b = await budget(centre, '1000.00');
    const pr = await submittedPr(centre, '400.00');
    expect((await approve(pr)).status).toBe(201);

    const [first, second] = await Promise.all([
      api(app).post(`${base}/requests/${pr}/cancel`).set(auth(s.finance)).send({}),
      api(app).post(`${base}/requests/${pr}/cancel`).set(auth(s.finance)).send({}),
    ]);
    // One succeeds; the other is refused as an illegal transition. Whichever
    // way the race falls, the money comes back exactly once.
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect((await readBudget(b.id)).committed).toBe('0');
  });

  it('cancelling the order that has received nothing releases the request that paid for it', async () => {
    const centre = await costCentre('C2-PO');
    const b = await budget(centre, '1000.00');
    const pr = await submittedPr(centre, '300.00');
    expect((await approve(pr)).status).toBe(201);

    const converted = await api(app)
      .post(`${base}/requests/${pr}/convert`)
      .set(auth(s.superAdmin))
      .send({ vendorId });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const poId = converted.body.data.purchaseOrderId as string;
    expect((await readBudget(b.id)).committed).toBe('300');

    const cancelled = await api(app)
      .post(`${base}/orders/${poId}/cancel`)
      .set(auth(s.superAdmin))
      .send({ reason: 'Vendor cannot supply.' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
    expect((await readBudget(b.id)).committed).toBe('0');
  });
});

describe('administration and who may see the money', () => {
  it('refuses a second budget covering the same days for one cost centre', async () => {
    const centre = await costCentre('C2-OVERLAP');
    await budget(centre, '1000.00', 'FY26 full year');
    const overlapping = await api(app)
      .post('/api/v1/budgets')
      .set(auth(s.finance))
      .send({
        costCentreId: centre,
        name: 'FY26 Q3',
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
        currency: 'USD',
        amount: '100.00',
      });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.detail).toMatch(/already covers/i);
  });

  it('refuses approval when no budget covers the date, naming the cost centre', async () => {
    const centre = await costCentre('C2-NOBUDGET');
    const refused = await approve(await submittedPr(centre, '50.00'));
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('C2-NOBUDGET');
    expect(refused.body.detail).toMatch(/no budget covers/i);
  });

  it('refuses to cut a budget below what it is already holding', async () => {
    const centre = await costCentre('C2-CUT');
    const b = await budget(centre, '1000.00');
    expect((await approve(await submittedPr(centre, '600.00'))).status).toBe(201);

    const cut = await api(app).patch(`/api/v1/budgets/${b.id}`).set(auth(s.finance)).send({ amount: '500.00' });
    expect(cut.status).toBe(409);
    expect(cut.body.detail).toContain('600.00');

    const raise = await api(app).patch(`/api/v1/budgets/${b.id}`).set(auth(s.finance)).send({ amount: '2000.00' });
    expect(raise.status).toBe(200);
    expect(raise.body.data.remaining).toBe('1400.00');
  });

  it('money is Finance and Super Admin only; naming a cost centre is not money', async () => {
    const centre = await costCentre('C2-VISIBILITY');
    await budget(centre, '1000.00');

    // An employee may see what they can charge to...
    const centres = await api(app).get('/api/v1/cost-centres').set(auth(s.employee));
    expect(centres.status).toBe(200);
    // ...but not the figures, and cannot set them.
    expect((await api(app).get('/api/v1/budgets').set(auth(s.employee))).status).toBe(403);
    expect((await api(app).get('/api/v1/budgets/report').set(auth(s.employee))).status).toBe(403);
    expect(
      (
        await api(app)
          .post('/api/v1/cost-centres')
          .set(auth(s.employee))
          .send({ code: 'C2-NOPE', name: 'Not allowed' })
      ).status,
    ).toBe(403);
    // The procurement manager approves purchases but does not set budgets.
    expect((await api(app).post('/api/v1/budgets').set(auth(pm)).send({})).status).toBe(403);
  });

  it('the consumption report totals what every cost centre is holding today', async () => {
    const centre = await costCentre('C2-REPORT');
    const b = await budget(centre, '800.00', 'Report probe');
    expect((await approve(await submittedPr(centre, '200.00'))).status).toBe(201);

    const report = await api(app).get('/api/v1/budgets/report').set(auth(s.finance));
    expect(report.status).toBe(200);
    const row = report.body.data.rows.find((r: { id: string }) => r.id === b.id);
    expect(row).toBeTruthy();
    expect(row.committed).toBe('200');
    expect(row.remaining).toBe('600.00');
    expect(Number(report.body.data.totals.committed)).toBeGreaterThanOrEqual(200);
  });

  it('the database refuses an overcommitted budget however it is reached', async () => {
    const centre = await costCentre('C2-CHECK');
    const b = await budget(centre, '100.00');
    // The backstop, proven directly: no service, no guard, just the constraint.
    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE "budgets" SET "committed" = 100000 WHERE "id" = '${b.id}'`,
      ),
    ).rejects.toThrow(/budgets_committed_within_amount/);
  });
});
