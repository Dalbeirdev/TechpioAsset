import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ACCOUNTS,
  api,
  auth,
  createTestApp,
  login,
  loginAll,
  type AccountKey,
  type Session,
} from './harness.js';

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
  // Pin the stages off too. Most of this file walks a chain of approval steps
  // only, and its step-to-account map has no entry for an assessment stage - so
  // if anything left them switched on, four unrelated tests fail with "no
  // account mapped for step Inventory check" and look like a bug in the code
  // under test. The blocks that need the stages turn them on for themselves.
  const definition = await prisma.client.workflowDefinition.findFirstOrThrow({
    where: { companyId: s.superAdmin.user.companyId, requestType: null, isActive: true },
    select: { id: true },
  });
  await api(app)
    .patch(`/api/v1/workflows/${definition.id}/assessment-stages`)
    .set(auth(s.superAdmin))
    .send({ enabled: false });
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

  // IT lost requests:assess in v2.26 - pricing is Office Admin, Finance and
  // Super Admin - so it is no longer a case of "holds the permission but is the
  // requester"; it is refused at the guard like any employee.
  for (const who of ['officeAdmin', 'finance'] as const) {
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

    // Recorded at the inventory stage, so the chain settles and the unit is
    // issued in the same breath - it does not linger on the shelf as RESERVED.
    const held = await prisma.client.asset.findUnique({ where: { id: asset.id }, select: { status: true } });
    expect(held?.status, 'the promised unit leaves stock').toBe('ASSIGNED');

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

    // Promised while the request is still at Manager review - assessing is not
    // step-bound - so the unit is held but not yet issued. That is the window
    // in which a correction can still hand it back.
    const id = await raise();
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: asset.id });
    expect(
      (await prisma.client.asset.findUnique({ where: { id: asset.id }, select: { status: true } }))?.status,
      'held, not issued - the chain has not finished',
    ).toBe('RESERVED');

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

/**
 * v2.26 - the promised unit reaches the person.
 *
 * A request filled from stock used to reach the end of its chain and stop: the
 * unit reserved, the request approved, the laptop still on the shelf. Somebody
 * had to notice, find the asset and assign it by hand, with nothing linking the
 * two - so "approved" and "they have their laptop" were separated by a manual
 * step nobody was told to take.
 */
describe('issuing the reserved unit', () => {
  let definitionId: string;

  beforeAll(async () => {
    const definition = await prisma.client.workflowDefinition.findFirstOrThrow({
      where: { companyId: s.superAdmin.user.companyId, requestType: null, isActive: true },
      select: { id: true },
    });
    definitionId = definition.id;
    await api(app).patch(`/api/v1/workflows/${definitionId}/assessment-stages`).set(auth(s.superAdmin)).send({ enabled: true });
  });

  afterAll(async () => {
    await api(app).patch(`/api/v1/workflows/${definitionId}/assessment-stages`).set(auth(s.superAdmin)).send({ enabled: false });
  });

  it('assigns it to the requester and asks them to confirm receipt', async () => {
    const stock = await api(app).get('/api/v1/assets?status=AVAILABLE&pageSize=100').set(auth(s.superAdmin));
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
    const asset = (stock.body.data as { id: string; assetTag: string }[]).find((a) => !claimed.has(a.id));
    if (!asset) return;

    const id = await raise();
    for (const who of ['manager', 'hr', 'itAdmin'] as const) {
      await api(app).post(`/api/v1/requests/${id}/decision`).set(auth(s[who])).send({ decision: 'APPROVED' });
    }

    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: true, purchaseRequired: false, suitableAssetId: asset.id });

    const held = await prisma.client.asset.findUnique({
      where: { id: asset.id },
      select: { status: true, assignedUserId: true },
    });
    expect(held?.status, 'the unit is out of stock and in somebody name').toBe('ASSIGNED');
    expect(held?.assignedUserId, 'assigned to whoever it was for').toBe(s.employee.user.id);

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    expect(detail.body.data.status, 'issued, not yet confirmed received').toBe('ASSIGNED');

    // The request now answers "what did they actually get?".
    const item = (detail.body.data.items as { fulfilledAsset: { id: string } | null }[])[0];
    expect(item?.fulfilledAsset?.id).toBe(asset.id);

    // And there is a real assignment record behind it, not just a status.
    const assignment = await prisma.client.assetAssignment.findFirst({
      where: { assetId: asset.id, userId: s.employee.user.id },
      orderBy: { assignedAt: 'desc' },
    });
    expect(assignment, 'a handover is a record, not a flag').toBeTruthy();
  });

  it('leaves a bought request alone - there is nothing to issue yet', async () => {
    const id = await raise();
    for (const who of ['manager', 'hr', 'itAdmin'] as const) {
      await api(app).post(`/api/v1/requests/${id}/decision`).set(auth(s[who])).send({ decision: 'APPROVED' });
    }
    await api(app)
      .patch(`/api/v1/requests/${id}/assessment`)
      .set(auth(s.officeAdmin))
      .send({ inventoryAvailable: false, purchaseRequired: true, unitPrice: '10', quantity: 1 });

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    expect(detail.body.data.status).not.toBe('ASSIGNED');
  });
});

/**
 * v2.27 - the stage owner can stop the request, without being able to approve it.
 *
 * Reported from production. The owner moved the Inventory check to Inventory
 * Manager, which is the right home for "is this already on the shelf?" - and
 * that removed the only exit from the stage, because the decline path was gated
 * on `requests:approve`. The person best placed to recognise a duplicate became
 * the one person unable to stop it, and a duplicate answered honestly went on to
 * Finance to be refused there.
 *
 * `requests:decline` splits the two rights. This walks the real chain: the same
 * actor is refused an approval and allowed a refusal, on the same step.
 */
describe('whoever staffs a step can stop the request at it', () => {
  let stepId: string;
  let definitionId: string;
  let inventoryManager: Session;
  let originalRoles: string[];

  beforeAll(async () => {
    const defs = await api(app).get('/api/v1/workflows').set(auth(s.superAdmin));
    const definition = (
      defs.body.data as { id: string; requestType: string | null; steps: { id: string; name: string }[] }[]
    ).find((d) => d.requestType === null)!;
    definitionId = definition.id;

    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: true });

    const refreshed = await api(app).get('/api/v1/workflows').set(auth(s.superAdmin));
    stepId = (refreshed.body.data as { id: string; steps: { id: string; name: string }[] }[])
      .find((d) => d.id === definitionId)!
      .steps.find((x) => x.name === 'Inventory check')!.id;

    await api(app)
      .patch(`/api/v1/workflows/steps/${stepId}`)
      .set(auth(s.superAdmin))
      .send({ approverRoleKey: 'INVENTORY_MANAGER' });

    originalRoles = [...s.employee2.user.roles];
    await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['INVENTORY_MANAGER'] });
    inventoryManager = await login(app, ACCOUNTS.employee2);
  });

  afterAll(async () => {
    // Put the tenant back: this file's other blocks assume Office Admin staffs
    // the stage and that the stages are off entirely.
    await api(app)
      .patch(`/api/v1/workflows/steps/${stepId}`)
      .set(auth(s.superAdmin))
      .send({ approverRoleKey: 'OFFICE_ADMIN' });
    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: false });
    await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: originalRoles.length > 0 ? originalRoles : ['EMPLOYEE'] });
  });

  it('holds the two rights apart', () => {
    expect(inventoryManager.user.permissions).toContain('requests:decline');
    expect(inventoryManager.user.permissions).not.toContain('requests:approve');
  });

  it('refuses an approval and accepts a refusal, on the same step', async () => {
    const id = await raise();
    const current = await approveUntil(id, 'Inventory check');
    expect(current?.stepName).toBe('Inventory check');

    // The detail payload has to say the same thing the server will enforce,
    // or the page offers a button that 403s on click.
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(inventoryManager));
    expect(detail.status, JSON.stringify(detail.body)).toBeLessThan(300);
    expect(detail.body.data.canDecide).toBe(false);
    expect(detail.body.data.canDecline).toBe(true);

    const approved = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(inventoryManager))
      .send({ decision: 'APPROVED' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(403);

    const rejected = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(inventoryManager))
      .send({ decision: 'REJECTED', comment: 'Duplicate of an open request.' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBeLessThan(300);

    const after = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    expect(after.body.data.status).toBe('REJECTED');
  });

  it('still refuses someone the step does not belong to', async () => {
    const id = await raise();
    await approveUntil(id, 'Inventory check');
    // Finance can decline in general, but not this step - it is not theirs.
    const res = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'REJECTED', comment: 'Not mine to stop.' });
    expect(res.status).toBe(403);
  });
});

/**
 * v2.27 - damage gets its own short route.
 *
 * DAMAGE had no definition of its own, so it fell to the six-step catch-all:
 * reporting a broken laptop travelled exactly as far as asking for a new one,
 * through a manager and HR first. Both are dropped here, and for the same
 * reason - the device was already authorised once. Control over spending stays
 * with the Finance threshold, which is the step that actually governs money.
 */
describe('a damage report takes the short route', () => {
  // One request, not two. A second open DAMAGE report from the same person is
  // refused as a duplicate - which is correct behaviour, and the reason this
  // asserts the shape and the authority of the same chain rather than raising
  // a fresh one for each. employee2 keeps it clear of the orphaned-approval
  // suite, which files its own reports as employee.
  it('starts at IT, skips the manager and HR, and only IT can act on it', async () => {
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee2))
      .send({
        type: 'DAMAGE',
        businessReason: 'Screen cracked after a fall.',
        items: [{ description: `Laptop screen ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const id = created.body.data.id as string;
    const submitted = await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee2));
    expect(submitted.status, JSON.stringify(submitted.body)).toBeLessThan(300);

    const names = (await chainOf(id)).map((a) => a.stepName);

    expect(names, 'damage should not queue behind a manager').not.toContain('Manager review');
    expect(names, 'employment was confirmed when the kit was issued').not.toContain(
      'HR confirmation',
    );
    expect(names[0], 'IT decides repair or replace first').toBe('IT review');
    expect(names).toContain('Inventory check');
    // Shorter than the catch-all it used to take, which is the whole point.
    expect(names.length).toBeLessThan(6);

    // The manager holds requests:approve, but this step is not theirs.
    const wrong = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });
    expect(wrong.status).toBe(403);

    const right = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.itAdmin))
      .send({ decision: 'APPROVED' });
    expect(right.status, JSON.stringify(right.body)).toBeLessThan(300);
  });
});
