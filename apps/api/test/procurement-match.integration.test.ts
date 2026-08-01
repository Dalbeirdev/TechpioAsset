import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.4 P3 — the three-way match gating invoice verification, the audited
 * override, and the PRC concurrency proofs (racing receivers at the last
 * outstanding unit; the storm never over-receives).
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let vendorId: string;

const base = '/api/v1/procurement';
let seq = 0;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  const vendor = await prisma.client.vendor.findFirst({
    where: { companyId: s.superAdmin.user.companyId, deletedAt: null },
    select: { id: true },
  });
  vendorId = vendor!.id;
});

afterAll(async () => {
  await app?.close();
});

/** An ISSUED PO with one line: qty x 40.00. */
async function issuedPo(quantity: number) {
  const pr = await api(app)
    .post(`${base}/requests`)
    .set(auth(s.employee))
    .send({
      justification: 'Match-probe purchase for the three-way match suite.',
      lines: [{ description: 'Match probe unit', quantity, estimatedUnitPrice: '40.00' }],
    });
  expect(pr.status).toBe(201);
  await api(app).post(`${base}/requests/${pr.body.data.id}/submit`).set(auth(s.employee));
  const dec = await api(app)
    .post(`${base}/requests/${pr.body.data.id}/decision`)
    .set(auth(s.finance))
    .send({ decision: 'APPROVE' });
  expect(dec.status).toBe(201);
  const conv = await api(app)
    .post(`${base}/requests/${pr.body.data.id}/convert`)
    .set(auth(s.superAdmin))
    .send({ vendorId });
  const poId = conv.body.data.purchaseOrderId as string;
  await api(app).post(`${base}/orders/${poId}/issue`).set(auth(s.superAdmin));
  const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
  return { poId, lineId: po.body.data.lines[0].id as string };
}

const receive = (poId: string, lineId: string, quantity: number) =>
  api(app)
    .post(`${base}/orders/${poId}/receive`)
    .set(auth(s.superAdmin))
    .send({ lines: [{ purchaseOrderLineId: lineId, quantity, intake: 'ASSET' }] });

/** An invoice tied to the PO, straight to PENDING_REVIEW. */
async function invoiceFor(poId: string, total: string) {
  seq += 1;
  const res = await api(app)
    .post('/api/v1/invoices')
    .set(auth(s.finance))
    .send({
      vendorId,
      purchaseOrderId: poId,
      invoiceNumber: `MATCH-${Date.now()}-${seq}`,
      invoiceDate: '2026-08-01',
      currency: 'USD',
      subtotal: total,
      total,
      lines: [{ lineNumber: 1, description: 'Match probe', quantity: 1, unitPrice: total, lineTotal: total }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

const decide = (invoiceId: string, actor: Session) =>
  api(app)
    .post(`/api/v1/invoices/${invoiceId}/decision`)
    .set(auth(actor))
    .send({ decision: 'VERIFIED' });

describe('the three-way match gates verification', () => {
  it('a fully received PO with a matching invoice verifies cleanly', async () => {
    const { poId, lineId } = await issuedPo(3);
    await receive(poId, lineId, 3);
    const invoiceId = await invoiceFor(poId, '120.00');

    const verified = await decide(invoiceId, s.finance);
    expect(verified.status, JSON.stringify(verified.body)).toBe(201);

    const match = await prisma.client.invoiceMatchResult.findUnique({ where: { invoiceId } });
    expect(match?.outcome).toBe('MATCHED');
  });

  it('billing ahead of delivery blocks with honest numbers; the audited override unblocks', async () => {
    const { poId, lineId } = await issuedPo(3);
    await receive(poId, lineId, 2); // 80.00 received, but the vendor bills 120.00
    const invoiceId = await invoiceFor(poId, '120.00');

    const blocked = await decide(invoiceId, s.finance);
    expect(blocked.status).toBe(409);
    expect(blocked.body.detail).toContain('PRICE_MISMATCH');
    expect(blocked.body.detail).toContain('80.00');
    expect(blocked.body.detail).toContain('120.00');

    // Overriding needs the dedicated permission (IT admin lacks it)...
    const denied = await api(app)
      .post(`${base}/match/${invoiceId}/override`)
      .set(auth(s.itAdmin))
      .send({ reason: 'Trying without the permission' });
    expect(denied.status).toBe(403);

    // ...and a real reason.
    const tooShort = await api(app)
      .post(`${base}/match/${invoiceId}/override`)
      .set(auth(s.finance))
      .send({ reason: 'ok' });
    expect(tooShort.status).toBe(422);

    const overridden = await api(app)
      .post(`${base}/match/${invoiceId}/override`)
      .set(auth(s.finance))
      .send({ reason: 'Vendor bills on dispatch; remainder arrives Friday per confirmation.' });
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(201);

    const verified = await decide(invoiceId, s.finance);
    expect(verified.status, JSON.stringify(verified.body)).toBe(201);

    const auditRow = await prisma.client.auditLog.findFirst({
      where: { action: 'MATCH_OVERRIDDEN', entityId: invoiceId },
    });
    expect(auditRow).not.toBeNull();
  });

  it('an invoice with no receipt at all is blocked (NO_RECEIPT)', async () => {
    const { poId } = await issuedPo(2);
    const invoiceId = await invoiceFor(poId, '80.00');
    const blocked = await decide(invoiceId, s.finance);
    expect(blocked.status).toBe(409);
    expect(blocked.body.detail).toContain('NO_RECEIPT');
  });

  it('an invoice without a PO is untouched by the match gate', async () => {
    const invoiceId = await invoiceFor('', '55.00').catch(() => null);
    // purchaseOrderId '' is invalid — create one genuinely without a PO instead.
    const res = await api(app)
      .post('/api/v1/invoices')
      .set(auth(s.finance))
      .send({
        vendorId,
        invoiceNumber: `MATCH-NOPO-${Date.now()}`,
        invoiceDate: '2026-08-01',
        currency: 'USD',
        subtotal: '55.00',
        total: '55.00',
        lines: [{ lineNumber: 1, description: 'No-PO probe', quantity: 1, unitPrice: '55.00', lineTotal: '55.00' }],
      });
    expect(res.status).toBe(201);
    const verified = await decide(res.body.data.id, s.finance);
    expect(verified.status, JSON.stringify(verified.body)).toBe(201);
    expect(invoiceId).toBeNull();
  });
});

describe('PRC concurrency — receivers cannot over-receive', () => {
  it('two receivers race the last outstanding unit: exactly one wins', async () => {
    const { poId, lineId } = await issuedPo(2);
    await receive(poId, lineId, 1); // 1 outstanding
    const [a, b] = await Promise.all([receive(poId, lineId, 1), receive(poId, lineId, 1)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const line = await prisma.client.purchaseOrderLine.findUnique({
      where: { id: lineId },
      select: { quantity: true, receivedQuantity: true },
    });
    expect(Number(line?.receivedQuantity)).toBe(Number(line?.quantity));
  });

  it('a six-way storm on three outstanding units yields exactly three winners and a RECEIVED PO', async () => {
    const { poId, lineId } = await issuedPo(3);
    const results = await Promise.all(Array.from({ length: 6 }, () => receive(poId, lineId, 1)));
    const won = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 409).length;
    expect(won).toBe(3);
    expect(blocked).toBe(3);

    const line = await prisma.client.purchaseOrderLine.findUnique({
      where: { id: lineId },
      select: { quantity: true, receivedQuantity: true },
    });
    expect(Number(line?.receivedQuantity)).toBe(3);

    const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
    expect(po.body.data.status).toBe('RECEIVED');
    // Six attempts, three receipts - GRN numbers stayed unique under the race.
    expect(po.body.data.receipts).toHaveLength(3);
  });
});
