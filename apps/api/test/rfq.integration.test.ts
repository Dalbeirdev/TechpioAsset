import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, login, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.9 C3 — competitive quoting, and the invariant that makes it worth having:
 * **a losing quote can never become a purchase order.**
 *
 * Proven twice over — through the API, and directly against the CHECK
 * constraint, because a rule enforced only by the code that usually runs is a
 * rule with a hole in it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;
let vendorA: string;
let vendorB: string;
let vendorNames: Record<string, string>;
/** employee3 borrowed as a PROCUREMENT_MANAGER: the role that runs an RFQ. */
let pm: Session;

const base = '/api/v1/procurement';
let seq = 0;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;

  const vendors = await prisma.client.vendor.findMany({
    where: { companyId, deletedAt: null },
    take: 2,
    select: { id: true, name: true },
  });
  expect(vendors.length, 'the seed provides at least two vendors').toBe(2);
  vendorA = vendors[0]!.id;
  vendorB = vendors[1]!.id;
  vendorNames = { [vendorA]: vendors[0]!.name, [vendorB]: vendors[1]!.name };

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
  await app?.close();
});

/** An APPROVED purchase request for 2 units at 40.00 - ready to quote. */
async function approvedPr() {
  seq += 1;
  const created = await api(app)
    .post(`${base}/requests`)
    .set(auth(s.employee))
    .send({
      justification: `RFQ probe ${seq}: docks for the build lab, out to competitive quote.`,
      lines: [{ description: `RFQ probe item ${seq}`, quantity: 2, estimatedUnitPrice: '40.00' }],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id as string;
  await api(app).post(`${base}/requests/${id}/submit`).set(auth(s.employee));
  const decided = await api(app)
    .post(`${base}/requests/${id}/decision`)
    .set(auth(s.finance))
    .send({ decision: 'APPROVE' });
  expect(decided.status, JSON.stringify(decided.body)).toBe(201);
  return id;
}

const raiseRfq = (prId: string, vendorIds = [vendorA, vendorB]) =>
  api(app).post(`${base}/requests/${prId}/rfq`).set(auth(pm)).send({ vendorIds });

const respond = (quoteId: string, unitPrice: string, leadTimeDays?: number) =>
  api(app)
    .post(`${base}/quotes/${quoteId}/response`)
    .set(auth(pm))
    .send({
      currency: 'USD',
      leadTimeDays,
      lines: [{ description: 'Quoted item', quantity: 2, unitPrice }],
    });

const quoteIdFor = (rfqBody: { data: { quotes: { id: string; vendor: { id: string } }[] } }, vendorId: string) =>
  rfqBody.data.quotes.find((q) => q.vendor.id === vendorId)!.id;

/** An RFQ with both vendors answered: A dear+fast, B cheap+slow. */
async function quotedRfq() {
  const prId = await approvedPr();
  const rfq = await raiseRfq(prId);
  expect(rfq.status, JSON.stringify(rfq.body)).toBe(201);
  const rfqId = rfq.body.data.id as string;
  const qA = quoteIdFor(rfq.body, vendorA);
  const qB = quoteIdFor(rfq.body, vendorB);
  expect((await respond(qA, '60.00', 3)).status).toBe(201);
  expect((await respond(qB, '50.00', 21)).status).toBe(201);
  return { prId, rfqId, qA, qB };
}

describe('requesting and comparing quotes', () => {
  it('invites every vendor as an unanswered quote, numbered and linked to the request', async () => {
    const prId = await approvedPr();
    const res = await raiseRfq(prId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.rfqNumber).toMatch(/^RFQ-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe('SENT');
    expect(res.body.data.quotes).toHaveLength(2);
    expect(res.body.data.quotes.every((q: { status: string }) => q.status === 'INVITED')).toBe(true);
    expect(res.body.data.comparison.awaiting).toBe(2);
    expect(res.body.data.comparison.responded).toBe(0);
  });

  it('refuses to quote an unapproved request, or to ask only one vendor', async () => {
    seq += 1;
    const draft = await api(app)
      .post(`${base}/requests`)
      .set(auth(s.employee))
      .send({
        justification: 'RFQ probe: still a draft, so nobody should be asked to price it.',
        lines: [{ description: 'Draft item', quantity: 1, estimatedUnitPrice: '10.00' }],
      });
    const tooEarly = await raiseRfq(draft.body.data.id);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.detail).toMatch(/APPROVED/);

    const prId = await approvedPr();
    const single = await raiseRfq(prId, [vendorA]);
    expect(single.status).toBe(422);
    // The same vendor twice passes the shape check and is caught for what it
    // really is: one vendor, which is not a comparison.
    const duplicated = await raiseRfq(prId, [vendorA, vendorA]);
    expect(duplicated.status).toBe(422);
    expect(duplicated.body.detail).toMatch(/at least two different/i);
  });

  it('records responses and ranks them, flagging the cheap-but-slow trade-off', async () => {
    const { rfqId, qA, qB } = await quotedRfq();
    const rfq = await api(app).get(`${base}/rfqs/${rfqId}`).set(auth(pm));
    expect(rfq.status).toBe(200);

    const comparison = rfq.body.data.comparison;
    expect(comparison.responded).toBe(2);
    expect(comparison.cheapestQuoteId).toBe(qB);
    expect(comparison.fastestQuoteId).toBe(qA);
    // The exact case an award reason exists for.
    expect(comparison.cheapestIsNotFastest).toBe(true);
    const dear = comparison.rows.find((r: { id: string }) => r.id === qA);
    expect(dear.rank).toBe(2);
    expect(dear.premiumOverCheapest).toBe('20.00');

    // Totals are computed from the lines, not taken on trust.
    const quoted = rfq.body.data.quotes.find((q: { id: string }) => q.id === qB);
    expect(quoted.total).toBe('100');
    expect(quoted.status).toBe('RECEIVED');
  });

  it('re-recording replaces the vendor numbers rather than accumulating them', async () => {
    const { rfqId, qA } = await quotedRfq();
    expect((await respond(qA, '55.00', 5)).status).toBe(201);
    const rfq = await api(app).get(`${base}/rfqs/${rfqId}`).set(auth(pm));
    const quote = rfq.body.data.quotes.find((q: { id: string }) => q.id === qA);
    expect(quote.lines).toHaveLength(1);
    expect(quote.total).toBe('110');
  });
});

describe('the award is the only route to an order', () => {
  it('awards one quote with a reason; every other quote is marked LOST', async () => {
    const { rfqId, qA, qB } = await quotedRfq();
    const awarded = await api(app)
      .post(`${base}/rfqs/${rfqId}/award`)
      .set(auth(pm))
      .send({ quoteId: qA, reason: 'Three-day lead time; the lab is blocked without these.' });
    expect(awarded.status, JSON.stringify(awarded.body)).toBe(201);
    expect(awarded.body.data.status).toBe('AWARDED');
    expect(awarded.body.data.awardedQuoteId).toBe(qA);
    expect(awarded.body.data.awardReason).toMatch(/lead time/i);
    const statuses = Object.fromEntries(
      awarded.body.data.quotes.map((q: { id: string; status: string }) => [q.id, q.status]),
    );
    expect(statuses[qA]).toBe('AWARDED');
    expect(statuses[qB]).toBe('LOST');

    // The reason is on the audit record, which is where it will be looked for.
    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'RFQ_AWARDED', entityId: rfqId },
      select: { reason: true, newValues: true },
    });
    expect(audit?.reason).toMatch(/lead time/i);
    expect(JSON.stringify(audit?.newValues)).toContain(vendorNames[vendorA]!);
  });

  it('converts from the winning quote: its vendor, its prices, and a link back', async () => {
    const { prId, rfqId, qA } = await quotedRfq();
    await api(app)
      .post(`${base}/rfqs/${rfqId}/award`)
      .set(auth(pm))
      .send({ quoteId: qA, reason: 'Fastest delivery and the only one who can ship this month.' });

    // No vendor named: the award already decided it.
    const converted = await api(app).post(`${base}/requests/${prId}/convert`).set(auth(s.superAdmin)).send({});
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const poId = converted.body.data.purchaseOrderId as string;

    const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
    expect(po.body.data.vendor?.id ?? po.body.data.vendorId).toBe(vendorA);
    // The quoted price, not the requester's estimate of 40.00.
    expect(Number(po.body.data.lines[0].unitPrice)).toBe(60);
    expect(Number(po.body.data.total)).toBe(120);

    const quote = await prisma.client.quote.findUniqueOrThrow({ where: { id: qA } });
    expect(quote.convertedPoId).toBe(poId);
  });

  it('refuses to order from a losing quote, naming the winner', async () => {
    const { prId, rfqId, qA, qB } = await quotedRfq();
    await api(app)
      .post(`${base}/rfqs/${rfqId}/award`)
      .set(auth(pm))
      .send({ quoteId: qA, reason: 'Awarded on lead time, documented for the record.' });

    const loser = await api(app)
      .post(`${base}/requests/${prId}/convert`)
      .set(auth(s.superAdmin))
      .send({ quoteId: qB });
    expect(loser.status).toBe(409);
    expect(loser.body.detail).toContain(vendorNames[vendorA]!);
    expect(loser.body.detail).toMatch(/did not win/i);

    // Naming the losing vendor directly is refused just as firmly.
    const wrongVendor = await api(app)
      .post(`${base}/requests/${prId}/convert`)
      .set(auth(s.superAdmin))
      .send({ vendorId: vendorB });
    expect(wrongVendor.status).toBe(409);
    expect(wrongVendor.body.detail).toMatch(/cannot go to a different vendor/i);

    // Nothing was ordered by either attempt.
    const pr = await api(app).get(`${base}/requests/${prId}`).set(auth(s.superAdmin));
    expect(pr.body.data.status).toBe('APPROVED');
    expect(pr.body.data.convertedPoId).toBeNull();
  });

  it('refuses to order at all while quotes are still out', async () => {
    const { prId, rfqId } = await quotedRfq();
    const early = await api(app)
      .post(`${base}/requests/${prId}/convert`)
      .set(auth(s.superAdmin))
      .send({ vendorId: vendorA });
    expect(early.status).toBe(409);
    expect(early.body.detail).toMatch(/Award one/i);
    expect(early.body.detail).toContain('RFQ-');

    // Abandoning the RFQ frees the request to be ordered the old way.
    expect((await api(app).post(`${base}/rfqs/${rfqId}/cancel`).set(auth(pm)).send({ reason: 'Bought elsewhere' })).status).toBe(201);
    const after = await api(app)
      .post(`${base}/requests/${prId}/convert`)
      .set(auth(s.superAdmin))
      .send({ vendorId: vendorA });
    expect(after.status, JSON.stringify(after.body)).toBe(201);
  });

  it('a second award is refused, whichever way two buyers race', async () => {
    const { rfqId, qA, qB } = await quotedRfq();
    const [first, second] = await Promise.all([
      api(app).post(`${base}/rfqs/${rfqId}/award`).set(auth(pm)).send({ quoteId: qA, reason: 'Fastest lead time by three weeks.' }),
      api(app).post(`${base}/rfqs/${rfqId}/award`).set(auth(s.superAdmin)).send({ quoteId: qB, reason: 'Cheapest quote of the two received.' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const loser = [first, second].find((r) => r.status === 409)!;
    expect(loser.body.detail).toMatch(/already been awarded/i);

    // Exactly one winner on the record, and exactly one non-LOST quote.
    const rfq = await prisma.client.quoteRequest.findUniqueOrThrow({
      where: { id: rfqId },
      select: { awardedQuoteId: true, quotes: { select: { status: true } } },
    });
    expect(rfq.awardedQuoteId).toBeTruthy();
    expect(rfq.quotes.filter((q) => q.status === 'AWARDED')).toHaveLength(1);
    expect(rfq.quotes.filter((q) => q.status === 'LOST')).toHaveLength(1);
  });

  it('refuses to award a vendor who never answered, or an awarded RFQ to be cancelled', async () => {
    const prId = await approvedPr();
    const rfq = await raiseRfq(prId);
    const rfqId = rfq.body.data.id as string;
    const silent = quoteIdFor(rfq.body, vendorB);

    const noQuote = await api(app)
      .post(`${base}/rfqs/${rfqId}/award`)
      .set(auth(pm))
      .send({ quoteId: silent, reason: 'Trying to award a vendor who never replied.' });
    expect(noQuote.status).toBe(422);
    expect(noQuote.body.detail).toMatch(/has not submitted a quote/i);

    const answered = quoteIdFor(rfq.body, vendorA);
    expect((await respond(answered, '45.00', 10)).status).toBe(201);
    expect(
      (
        await api(app)
          .post(`${base}/rfqs/${rfqId}/award`)
          .set(auth(pm))
          .send({ quoteId: answered, reason: 'Only vendor to respond before the deadline.' })
      ).status,
    ).toBe(201);

    const cancelled = await api(app).post(`${base}/rfqs/${rfqId}/cancel`).set(auth(pm)).send({ reason: 'Changed mind' });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.detail).toMatch(/on the record/i);
  });

  it('an award with no reason is refused - the reason is the point of the record', async () => {
    const { rfqId, qA } = await quotedRfq();
    const noReason = await api(app).post(`${base}/rfqs/${rfqId}/award`).set(auth(pm)).send({ quoteId: qA });
    expect(noReason.status).toBe(422);
    const tooShort = await api(app)
      .post(`${base}/rfqs/${rfqId}/award`)
      .set(auth(pm))
      .send({ quoteId: qA, reason: 'cheap' });
    expect(tooShort.status).toBe(422);
  });

  it('the database refuses an order recorded against a quote that did not win', async () => {
    const { prId, rfqId, qA, qB } = await quotedRfq();
    await api(app)
      .post(`${base}/rfqs/${rfqId}/award`)
      .set(auth(pm))
      .send({ quoteId: qA, reason: 'Awarded for delivery date, per the comparison.' });
    const converted = await api(app).post(`${base}/requests/${prId}/convert`).set(auth(s.superAdmin)).send({});
    const poId = converted.body.data.purchaseOrderId as string;

    // The backstop: no service, no guard, just the constraint.
    await expect(
      prisma.client.quote.update({ where: { id: qB }, data: { convertedPoId: poId } }),
    ).rejects.toThrow(/quotes_only_awarded_converts/);
  });
});

describe('who may run a competition', () => {
  it('an employee can read the record but cannot raise, record, award or cancel', async () => {
    const { rfqId, qA } = await quotedRfq();
    expect((await api(app).get(`${base}/rfqs/${rfqId}`).set(auth(s.employee))).status).toBe(200);

    const prId = await approvedPr();
    expect(
      (await api(app).post(`${base}/requests/${prId}/rfq`).set(auth(s.employee)).send({ vendorIds: [vendorA, vendorB] }))
        .status,
    ).toBe(403);
    expect((await api(app).post(`${base}/quotes/${qA}/response`).set(auth(s.employee)).send({})).status).toBe(403);
    expect(
      (await api(app).post(`${base}/rfqs/${rfqId}/award`).set(auth(s.employee)).send({ quoteId: qA, reason: 'because' }))
        .status,
    ).toBe(403);
    expect((await api(app).post(`${base}/rfqs/${rfqId}/cancel`).set(auth(s.employee)).send({})).status).toBe(403);
  });
});
