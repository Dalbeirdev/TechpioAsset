import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - "under review": the approver's I-am-on-it signal.
 *
 * A PENDING step read "Awaiting decision" whether the approver had opened it
 * or ignored it for a week. The review mark changes what the chain says, never
 * what anyone may do - and it is guarded by the same rule as a decision, so
 * only the person the step is actually waiting on can claim it.
 *
 * The suite also walks the chain the way the owner asked to see it checked:
 * the manager's desk first, then HR's, each with the same clean set of
 * choices - mark under review, approve, reject.
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

async function submittedRequest() {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Walking the approval chain with the review mark.',
      items: [
        { description: `Review-mark test ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 },
      ],
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const id = created.body.data.id as string;
  await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
  return id;
}

const detail = (id: string, as: Session) =>
  api(app).get(`/api/v1/requests/${id}`).set(auth(as));

const currentStep = (body: { approvals: { decision: string }[] }) =>
  body.approvals.find((a) => a.decision === 'PENDING') as {
    stepName: string;
    reviewStartedAt: string | null;
    reviewStartedBy: { id: string } | null;
  };

describe('marking a step under review', () => {
  it('is refused for anyone but the current approver - HR cannot claim the manager step', async () => {
    const id = await submittedRequest();

    for (const who of ['hr', 'employee', 'superAdmin'] as AccountKey[]) {
      const res = await api(app).post(`/api/v1/requests/${id}/review`).set(auth(s[who]));
      expect(res.status, `${who} must not claim the manager's step`).toBeGreaterThanOrEqual(400);
    }
  });

  it('the manager claims it, the chain says so, and the first claim sticks', async () => {
    const id = await submittedRequest();

    const marked = await api(app).post(`/api/v1/requests/${id}/review`).set(auth(s.manager));
    expect(marked.status, JSON.stringify(marked.body)).toBeLessThan(300);

    // The requester sees progress, not silence.
    const seen = await detail(id, s.employee);
    const step = currentStep(seen.body.data);
    expect(step.reviewStartedAt).toBeTruthy();
    expect(step.reviewStartedBy?.id).toBe(s.manager.user.id);

    // Asking again is a no-op, not an error, and does not reassign the claim.
    const again = await api(app).post(`/api/v1/requests/${id}/review`).set(auth(s.manager));
    expect(again.status).toBeLessThan(300);
    const after = currentStep((await detail(id, s.employee)).body.data);
    expect(after.reviewStartedAt).toBe(step.reviewStartedAt);
  });

  it('does not change what the approver may do - approve still works after it', async () => {
    const id = await submittedRequest();

    await api(app).post(`/api/v1/requests/${id}/review`).set(auth(s.manager));
    const approved = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });

    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
  });
});

describe('the chain, desk by desk', () => {
  it('manager reviews and approves, then HR gets the same clean choices', async () => {
    const id = await submittedRequest();

    // Manager's desk.
    const atManager = await detail(id, s.manager);
    expect(atManager.body.data.status).toBe('MANAGER_APPROVAL_PENDING');
    expect(atManager.body.data.canDecide).toBe(true);

    await api(app).post(`/api/v1/requests/${id}/review`).set(auth(s.manager));
    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED', comment: 'Fine by me.' });

    // HR's desk: a fresh step with no inherited review mark.
    const atHr = await detail(id, s.hr);
    expect(atHr.body.data.status).toBe('HR_REVIEW_PENDING');
    expect(atHr.body.data.canDecide).toBe(true);
    const hrStep = currentStep(atHr.body.data);
    expect(hrStep.reviewStartedAt).toBeNull();

    await api(app).post(`/api/v1/requests/${id}/review`).set(auth(s.hr));
    const claimed = currentStep((await detail(id, s.employee)).body.data);
    expect(claimed.reviewStartedBy?.id).toBe(s.hr.user.id);

    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.hr))
      .send({ decision: 'APPROVED' });

    // Moved on again; HR is done and the manager stayed done.
    const after = await detail(id, s.hr);
    expect(after.body.data.status).not.toBe('HR_REVIEW_PENDING');
    expect(after.body.data.canDecide).toBe(false);
    const decisions = after.body.data.approvals.map((a: { decision: string }) => a.decision);
    expect(decisions.filter((d: string) => d === 'APPROVED').length).toBeGreaterThanOrEqual(2);
  });
});
