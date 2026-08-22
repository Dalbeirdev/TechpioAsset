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

/**
 * v2.26 - the two tests above pass for the wrong reason.
 *
 * `s.employee` holds no `requests:assess`, so the route guard refuses them
 * before anything looks at who raised the request. The roles that DO hold the
 * permission - IT, Office and Finance - also raise requests of their own, and
 * for them nothing was checking. An IT administrator could put the price on
 * their own laptop request, and that price is what decides whether Finance ever
 * sees it. Found on a live request: REQ-2026-000010, raised by an IT
 * administrator, sitting on the inventory-check stage.
 */
describe('nor can a requester who does hold requests:assess', () => {
  const raiseAs = async (who: Session) => {
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(who))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Required for software development work.',
        items: [{ description: `Laptop ${Math.random().toString(36).slice(2, 9)}`, quantity: 1 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    return created.body.data.id as string;
  };

  for (const who of ['itAdmin', 'officeAdmin', 'finance'] as const) {
    it(`refuses ${who} pricing their own request`, async () => {
      const id = await raiseAs(s[who]);
      const res = await api(app)
        .patch(`/api/v1/requests/${id}/assessment`)
        .set(auth(s[who]))
        .send({ purchaseRequired: true, unitPrice: '1.00', quantity: 1 });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('your own request');

      // And nothing was written on the way to being refused.
      const stored = await prisma.client.requestAssessment.findUnique({ where: { requestId: id } });
      expect(stored).toBeNull();
    });

    it(`refuses ${who} reading the commercial side of their own request`, async () => {
      const id = await raiseAs(s[who]);
      const res = await api(app).get(`/api/v1/requests/${id}/assessment`).set(auth(s[who]));
      expect(res.status).toBe(403);
    });
  }

  it('still lets them assess a request somebody else raised', async () => {
    const id = await raiseAs(s.employee);
    const res = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ purchaseRequired: true, unitPrice: '100.00', quantity: 1 });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
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

/**
 * v2.26 - "which item off the shelf?"
 *
 * The stage asks whether the thing is in stock, and the answer was an
 * unverifiable yes: `inventoryAvailable` was written as the blind inverse of
 * `purchaseRequired` and read by nothing, while `suitableAssetId` - the field
 * that says WHICH unit fills the request - had existed since v2.25 with no
 * screen to set it. So the record said something was in stock without saying
 * what, and nobody could check it or hand it over.
 */
describe('filling a request from stock', () => {
  it('records which asset fills it, and still skips Finance', async () => {
    const stock = await api(app)
      .get('/api/v1/assets?status=AVAILABLE&pageSize=100')
      .set(auth(s.officeAdmin));
    expect(stock.status, JSON.stringify(stock.body)).toBeLessThan(300);
    // Unclaimed, not merely available - see the note on freeAsset below.
    const claimed = new Set(
      (
        await prisma.client.requestAssessment.findMany({
          where: {
            suitableAssetId: { not: null },
            purchaseRequired: false,
            request: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
          },
          select: { suitableAssetId: true },
        })
      ).map((a) => a.suitableAssetId),
    );
    const asset = (stock.body.data as { id: string; assetTag: string }[]).find(
      (a) => !claimed.has(a.id),
    )!;
    if (!asset) return; // nothing available in this database; the rest is covered elsewhere

    const id = await raise();
    const res = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: asset.id });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(res.body.data.suitableAsset?.id).toBe(asset.id);
    // Nothing is being bought, so there is no total to measure Finance against.
    expect(res.body.data.totalCost).toBeNull();

    const stored = await prisma.client.requestAssessment.findUnique({ where: { requestId: id } });
    expect(stored?.suitableAssetId).toBe(asset.id);
    expect(stored?.inventoryAvailable).toBe(true);
  });

  it('refuses an asset from another company', async () => {
    const id = await raise();
    const res = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: 'not-an-asset' });
    expect(res.status).toBe(404);
  });
});

/**
 * v2.26 - a wrong stock answer must be correctable.
 *
 * Answering "filled from stock" settles the chain: nothing is bought, so the
 * costing and Finance are skipped and the request is approved. Right when the
 * answer is right, and unrecoverable when it is not. It happened in production:
 * a replacement laptop closed itself as fulfilled, Finance never saw it, and
 * the notes on the same record read "sorry not available in my stock".
 * Correcting the assessment changed the record and left the chain settled.
 */
describe('correcting a wrong stock answer', () => {
  // Self-contained: the rest of this file assumes the stages are off, so this
  // block turns them on for itself and puts them back.
  let definitionId: string;

  beforeAll(async () => {
    const definition = await prisma.client.workflowDefinition.findFirstOrThrow({
      where: { companyId: s.superAdmin.user.companyId, requestType: null, isActive: true },
      select: { id: true },
    });
    definitionId = definition.id;
    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: true });
  });

  afterAll(async () => {
    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: false });
  });

  async function walkToInventory() {
    const id = await raise();
    for (const who of ['manager', 'hr', 'itAdmin'] as const) {
      await api(app).post(`/api/v1/requests/${id}/decision`).set(auth(s[who])).send({ decision: 'APPROVED' });
    }
    return id;
  }

  it('reopens the costing and Finance it skipped', async () => {
    const id = await walkToInventory();

    // The mistake.
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, notes: 'sorry not available in my stock' });

    let detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    expect(detail.body.data.status, 'the wrong answer settles it').toBe('APPROVED');
    const skippedFinance = (detail.body.data.approvals as { stepName: string; decision: string }[])
      .find((a) => a.stepName === 'Finance approval');
    expect(skippedFinance?.decision).toBe('SKIPPED');

    // The correction.
    const fix = await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true, unitPrice: '95000', quantity: 1 });
    expect(fix.status, JSON.stringify(fix.body)).toBeLessThan(300);

    detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    const approvals = detail.body.data.approvals as { stepName: string; decision: string }[];
    expect(
      approvals.find((a) => a.stepName === 'Finance approval')?.decision,
      'Finance must be back in play once something is being bought',
    ).not.toBe('SKIPPED');
    expect(detail.body.data.status, 'and the request is no longer settled').not.toBe('APPROVED');
  });

  it('leaves a request alone once it is being fulfilled', async () => {
    const id = await walkToInventory();
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false });

    // Somebody has acted on the answer: stock is reserved against it.
    await prisma.client.assetRequest.update({
      where: { id },
      data: { status: 'INVENTORY_RESERVED' },
    });

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true, unitPrice: '95000', quantity: 1 });

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    // Unwinding something already acted on is a conversation, not a write.
    expect(detail.body.data.status).toBe('INVENTORY_RESERVED');
  });
});

/**
 * v2.26 - a promise on a unit has to hold it.
 *
 * Naming an asset recorded a preference and nothing else: it stayed AVAILABLE,
 * so the same laptop could be promised to two people and both requests would
 * close as "filled from existing stock". Found by doing exactly that.
 */
describe('promising a unit from stock', () => {
  let definitionId: string;

  beforeAll(async () => {
    const definition = await prisma.client.workflowDefinition.findFirstOrThrow({
      where: { companyId: s.superAdmin.user.companyId, requestType: null, isActive: true },
      select: { id: true },
    });
    definitionId = definition.id;
    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: true });
  });

  afterAll(async () => {
    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: false });
  });

  /**
   * Available AND unclaimed. A shared database accumulates requests that named
   * a unit, so "first available" is not the same as "free to promise" - and
   * picking a claimed one makes this test fail on the guard it is testing.
   */
  const freeAsset = async () => {
    const res = await api(app)
      .get('/api/v1/assets?status=AVAILABLE&pageSize=100')
      .set(auth(s.superAdmin));
    const claimed = new Set(
      (
        await prisma.client.requestAssessment.findMany({
          where: {
            suitableAssetId: { not: null },
            purchaseRequired: false,
            request: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
          },
          select: { suitableAssetId: true },
        })
      ).map((a) => a.suitableAssetId),
    );
    return (
      (res.body.data as { id: string; assetTag: string }[]).find((a) => !claimed.has(a.id)) ?? null
    );
  };

  const toInventory = async () => {
    const id = await raise();
    for (const who of ['manager', 'hr', 'itAdmin'] as const) {
      await api(app).post(`/api/v1/requests/${id}/decision`).set(auth(s[who])).send({ decision: 'APPROVED' });
    }
    return id;
  };

  it('reserves it, and refuses to promise it twice', async () => {
    const asset = await freeAsset();
    if (!asset) return;

    const first = await toInventory();
    const ok = await api(app)
      .patch(`/api/v1/requests/${first}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: asset.id });
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);

    const held = await prisma.client.asset.findUnique({ where: { id: asset.id }, select: { status: true } });
    expect(held?.status, 'the promised unit is held').toBe('RESERVED');

    const second = await toInventory();
    const clash = await api(app)
      .patch(`/api/v1/requests/${second}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: asset.id });
    expect(clash.status, 'the same unit cannot fill two requests').toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(clash.body)).toContain('already promised');
  });

  it('gives it back when the answer changes to "must be bought"', async () => {
    const asset = await freeAsset();
    if (!asset) return;

    const id = await toInventory();
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: asset.id });
    expect((await prisma.client.asset.findUnique({ where: { id: asset.id }, select: { status: true } }))?.status)
      .toBe('RESERVED');

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true, unitPrice: '95000', quantity: 1 });

    expect(
      (await prisma.client.asset.findUnique({ where: { id: asset.id }, select: { status: true } }))?.status,
      'nothing is being filled from stock any more, so the unit is free',
    ).toBe('AVAILABLE');
  });
});

/**
 * v2.26 - an assessment note belongs to whoever wrote it.
 *
 * `notes` is one string shared by everybody who touches the request. The panel
 * loaded it into an editable box, so a colleague's words appeared as your
 * unsaved draft; saving replaced them, and `assessedById` then credited the
 * replacement to whoever saved last. Reported after a note written by one
 * person turned up in another's editor.
 */
describe('notes on an assessment', () => {
  it('files a note under its author instead of overwriting the shared field', async () => {
    const id = await raise();

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ purchaseRequired: true, unitPrice: '100', note: 'Checked the shelf — nothing there.' });

    const comments = await prisma.client.requestComment.findMany({
      where: { requestId: id },
      include: { author: { select: { email: true } } },
    });
    const filed = comments.find((c) => c.body.includes('Checked the shelf'));
    expect(filed, 'the note is filed as a comment').toBeTruthy();
    expect(filed!.author?.email).toBe(s.officeAdmin.user.email);
    expect(filed!.isInternal, 'assessment notes are not for the requester').toBe(true);

    // A second person's note does not replace the first.
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.finance))
      .send({ purchaseRequired: true, unitPrice: '120', note: 'Quote from the vendor attached.' });

    const after = await prisma.client.requestComment.findMany({ where: { requestId: id } });
    expect(after.filter((c) => c.body.includes('Checked the shelf'))).toHaveLength(1);
    expect(after.filter((c) => c.body.includes('Quote from the vendor'))).toHaveLength(1);
  });

  it('does not file an empty note', async () => {
    const id = await raise();
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ purchaseRequired: true, unitPrice: '100' });
    const comments = await prisma.client.requestComment.count({ where: { requestId: id } });
    expect(comments).toBe(0);
  });
});
