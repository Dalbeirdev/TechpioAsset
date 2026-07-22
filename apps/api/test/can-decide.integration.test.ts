import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * `canDecide` on the request detail.
 *
 * The UI uses it to decide whether to offer approve/reject. If it were merely
 * "holds requests:approve" the interface would present an Approve button to
 * every approver on every request and let them discover the 403 by clicking it.
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
      businessReason: 'Checking who is offered the approve control on this request.',
      estimatedCost: '1699.00',
      items: [{ description: 'Dell Latitude 7450', quantity: 1, estimatedCost: '1699.00' }],
    });
  await api(app).post(`/api/v1/requests/${created.body.data.id}/submit`).set(auth(s.employee));
  return created.body.data.id as string;
}

describe('canDecide', () => {
  it('is true for the approver of the current step', async () => {
    const id = await submittedRequest();
    const response = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.manager));
    expect(response.body.data.status).toBe('MANAGER_APPROVAL_PENDING');
    expect(response.body.data.canDecide).toBe(true);
  });

  it('is false for an approver whose step has not been reached', async () => {
    const id = await submittedRequest();

    // All three hold requests:approve, and all three are on this workflow - but
    // none of their steps is current.
    for (const role of ['hr', 'itAdmin', 'finance'] as AccountKey[]) {
      const response = await api(app).get(`/api/v1/requests/${id}`).set(auth(s[role]));
      expect(response.body.data.canDecide, `${role} should not be offered the control`).toBe(false);
    }
  });

  it('is false for the requester, who cannot approve their own request', async () => {
    const id = await submittedRequest();
    const response = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(response.body.data.canDecide).toBe(false);
  });

  it('is false for a Super Admin who is not this requester’s line manager', async () => {
    const id = await submittedRequest();
    const response = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    // Holding every permission does not make someone the line manager.
    expect(response.body.data.canDecide).toBe(false);
  });

  it('moves to the next approver as the request advances', async () => {
    const id = await submittedRequest();

    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });

    const managerAfter = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.manager));
    expect(managerAfter.body.data.canDecide).toBe(false);

    const hrAfter = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.hr));
    expect(hrAfter.body.data.canDecide).toBe(true);
  });

  it('is false once the request is fully decided', async () => {
    const id = await submittedRequest();
    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'REJECTED', comment: 'Not this quarter.' });

    for (const role of ['manager', 'hr', 'itAdmin', 'finance'] as AccountKey[]) {
      const response = await api(app).get(`/api/v1/requests/${id}`).set(auth(s[role]));
      expect(response.body.data.canDecide, `${role}`).toBe(false);
    }
  });
});
