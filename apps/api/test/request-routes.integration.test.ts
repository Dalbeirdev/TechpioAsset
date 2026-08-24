import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.27 - every route reaches the end.
 *
 * The suites around this one each prove something specific about one stage.
 * None of them answers the question the owner actually asks: can a request of
 * each kind be raised and taken all the way through? That gap is not academic.
 * Every failure worth fixing this month was a step that pointed at somebody who
 * could not clear it - a tile that hid the queue, a decline the stage owner was
 * not allowed to give, an approval email sent to a role holding no approval
 * right. All of them look like a dead end from the requester's side, and none
 * of them would have been caught by a test of a single step.
 *
 * Two deliberate choices, both learned the hard way:
 *
 * It walks whatever chain each route currently has rather than asserting a step
 * count. Assessment stages are a runtime toggle - a Super Admin turns them on
 * and off per definition, and other suites in this directory do exactly that -
 * so a hard-coded length would fail for a configuration that is perfectly
 * legitimate. What is asserted instead is what must hold whatever the shape:
 * the route resolves, no step is a dead end, and the request finishes.
 *
 * And it changes no workflow configuration at all. The last suite that adjusted
 * shared workflow state to suit itself deleted every assessment stage in the
 * company and left them deleted, which stayed invisible for weeks because the
 * definitions that mattered were rebuilt by whoever ran next. A test that has
 * to reshape the world to pass is testing the reshaping.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;

/** Everything raised here, removed in afterAll so no route is left holding an
 *  open ticket - an open request blocks the next one of its type as a duplicate. */
const created: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
});

afterAll(async () => {
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM request_approvals WHERE "requestId" = $1',
      id,
    );
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', id);
  }
  await app?.close();
});

/**
 * Tried in turn against each approval step; the first one the server accepts wins.
 *
 * Super Admin is deliberately absent. A step pointing at a role nobody holds is
 * not a deadlock - by design it falls back to whoever manages users, so an
 * administrator can always rescue it. That makes an admin a universal key, and
 * a walk that carries one proves only that the escape hatch works: re-pointing
 * a step at an empty role still passed. What this asserts instead is that each
 * route completes under its own staffing, without anyone having to step outside
 * their job to unstick it.
 */
const APPROVERS: AccountKey[] = ['manager', 'hr', 'itAdmin', 'officeAdmin', 'finance'];

const CLOSED = ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];

interface Walked {
  chain: string[];
  /** One line per step actually cleared, naming who cleared it and how. */
  cleared: string[];
  status: string;
}

/**
 * Raise one request and take it as far as it will go.
 *
 * Assessment stages are answered rather than approved - the server refuses an
 * approval on them - and "nothing needs buying" is the answer that exercises
 * the interesting path, because it should stand the costing and any threshold
 * step aside.
 */
async function walkRoute(type: string, raiser: AccountKey): Promise<Walked> {
  const tag = Math.random().toString(36).slice(2, 8);

  const created$ = await api(app)
    .post('/api/v1/requests')
    .set(auth(s[raiser]))
    .send({
      type,
      businessReason: `Route check ${type} ${tag}`,
      items: [{ description: `${type} item ${tag}`, quantity: 1 }],
    });
  expect(created$.status, `raise ${type}: ${JSON.stringify(created$.body).slice(0, 200)}`).toBe(201);
  const id = created$.body.data.id as string;
  created.push(id);

  const submitted = await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s[raiser]));
  expect(
    submitted.status,
    `submit ${type}: ${JSON.stringify(submitted.body).slice(0, 200)}`,
  ).toBeLessThan(300);

  const opened = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
  const chain = (opened.body.data.approvals as { stepName: string }[]).map((a) => a.stepName);
  expect(chain.length, `${type} resolved to no workflow at all`).toBeGreaterThan(0);

  const cleared: string[] = [];
  let status = opened.body.data.status as string;

  // Generous bound: the longest configured route is six steps, and the loop
  // exits as soon as nothing is pending.
  for (let guard = 0; guard < 12; guard += 1) {
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    status = detail.body.data.status as string;
    const pending = (
      detail.body.data.approvals as { decision: string; kind: string; stepName: string }[]
    ).find((a) => a.decision === 'PENDING');
    if (!pending) break;

    if (pending.kind !== 'APPROVAL') {
      const answered = await api(app)
        .patch(`/api/v1/requests/${id}/assessment`)
        .set(auth(s.officeAdmin))
        .send({ purchaseRequired: false });
      expect(
        answered.status,
        `${type}: "${pending.stepName}" could not be answered - ${JSON.stringify(answered.body).slice(0, 200)}`,
      ).toBeLessThan(300);
      cleared.push(`${pending.stepName} answered`);
      continue;
    }

    let by: AccountKey | null = null;
    for (const who of APPROVERS) {
      const decided = await api(app)
        .post(`/api/v1/requests/${id}/decision`)
        .set(auth(s[who]))
        .send({ decision: 'APPROVED' });
      if (decided.status < 300) {
        by = who;
        break;
      }
    }
    // The failure this whole file exists to catch: a step on somebody's desk
    // that nobody in the company is able to clear.
    expect(by, `${type}: nobody could clear "${pending.stepName}" (status ${status})`).not.toBeNull();
    cleared.push(`${pending.stepName} approved by ${by}`);
  }

  return { chain, cleared, status };
}

describe('every request route runs to the end', () => {
  // Spread across requesters: a second open request of the same type from the
  // same person is refused as a duplicate, which is correct and would otherwise
  // make this file's own cases collide.
  const routes: { label: string; type: string; raiser: AccountKey }[] = [
    { label: 'a repair', type: 'REPAIR', raiser: 'employee' },
    { label: 'a damage report', type: 'DAMAGE', raiser: 'employee2' },
    { label: 'kitchen supplies', type: 'KITCHEN_REQUIREMENT', raiser: 'employee' },
    { label: 'furniture', type: 'OFFICE_REQUIREMENT', raiser: 'employee' },
    { label: 'onboarding kit', type: 'NEW_EMPLOYEE_ONBOARDING', raiser: 'hr' },
    { label: 'new IT equipment', type: 'ADDITIONAL_EQUIPMENT', raiser: 'employee' },
  ];

  for (const route of routes) {
    it(`${route.label} reaches a decision with no dead end`, async () => {
      const walked = await walkRoute(route.type, route.raiser);
      expect(
        CLOSED,
        `${route.type} stalled at ${walked.status} after: ${walked.cleared.join(' | ')}`,
      ).toContain(walked.status);
    });
  }

  /**
   * The two shapes that are a business rule rather than a configuration, so a
   * step count is not what is asserted - the presence of the wrong desk is.
   */
  it('sends a repair straight to IT, with nobody in front of it', async () => {
    const walked = await walkRoute('REPAIR', 'employee3');
    expect(walked.chain[0]).toBe('IT review');
    expect(walked.chain, 'a repair should not queue behind a manager').not.toContain(
      'Manager review',
    );
  });

  it('does not send a damage report past a manager or HR', async () => {
    const walked = await walkRoute('DAMAGE', 'employee3');
    expect(walked.chain[0]).toBe('IT review');
    // The device was authorised once already; neither desk is asked again.
    expect(walked.chain).not.toContain('Manager review');
    expect(walked.chain).not.toContain('HR confirmation');
  });
});
