import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2 exit criterion: a laptop request traverses
 * Employee → Manager → HR → IT → Finance → assigned → receipt-confirmed.
 *
 * Driven entirely through the HTTP API as the real actors, so the configured
 * workflow, the step-level authorisation and the status machine are all exercised
 * together rather than in isolation.
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

async function createRequest(actor: Session, overrides: Record<string, unknown> = {}) {
  const response = await api(app)
    .post('/api/v1/requests')
    .set(auth(actor))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      priority: 'NORMAL',
      businessReason: 'Current laptop is out of warranty and struggling with builds.',
      estimatedCost: '1699.00',
      items: [{ description: 'Dell Latitude 7450', quantity: 1, estimatedCost: '1699.00' }],
      ...overrides,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

describe('laptop request end to end', () => {
  it('traverses every configured step and completes on receipt confirmation', async () => {
    // ── 1. Employee submits ──────────────────────────────────────────────────
    const created = await createRequest(s.employee);
    expect(created.status).toBe('DRAFT');
    expect(created.requestNumber).toMatch(/^REQ-\d{4}-\d{6}$/);

    const submitted = await api(app)
      .post(`/api/v1/requests/${created.id}/submit`)
      .set(auth(s.employee));
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.status).toBe('MANAGER_APPROVAL_PENDING');

    // The chain is materialised at submit: four steps, Finance included because
    // 1699.00 is above its 250.00 threshold.
    const steps = submitted.body.data.approvals;
    expect(steps.map((a: { stepName: string }) => a.stepName)).toEqual([
      'Manager review',
      'HR confirmation',
      'IT review',
      'Finance approval',
    ]);

    // ── 2. The wrong approver cannot act ─────────────────────────────────────
    const wrongApprover = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'APPROVED' });
    // Finance holds requests:approve but this step belongs to the line manager.
    expect(wrongApprover.status).toBe(403);

    // Nor can the requester approve their own request.
    const selfApprove = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.employee))
      .send({ decision: 'APPROVED' });
    expect(selfApprove.status).toBe(403);

    // ── 3. Manager → HR → IT → Finance ───────────────────────────────────────
    const manager = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED', comment: 'Agreed, his machine is four years old.' });
    expect(manager.status).toBe(201);
    expect(manager.body.data.status).toBe('HR_REVIEW_PENDING');

    const hr = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.hr))
      .send({ decision: 'APPROVED' });
    expect(hr.body.data.status).toBe('IT_REVIEW_PENDING');

    const it = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.itAdmin))
      .send({ decision: 'APPROVED', comment: 'Stock available.' });
    expect(it.body.data.status).toBe('FINANCE_APPROVAL_PENDING');

    const finance = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'APPROVED' });
    expect(finance.body.data.status).toBe('APPROVED');

    // Every step is recorded with its decider.
    const decisions = finance.body.data.approvals;
    expect(decisions.every((a: { decision: string }) => a.decision === 'APPROVED')).toBe(true);
    expect(decisions[0].approver.email).toBe('manager@techpioasset.dev');

    // ── 4. IT reserves and readies the asset ─────────────────────────────────
    const reserved = await api(app)
      .post(`/api/v1/requests/${created.id}/advance`)
      .set(auth(s.itAdmin))
      .send({ status: 'INVENTORY_RESERVED' });
    expect(reserved.body.data.status).toBe('INVENTORY_RESERVED');

    const ready = await api(app)
      .post(`/api/v1/requests/${created.id}/advance`)
      .set(auth(s.itAdmin))
      .send({ status: 'READY_FOR_ASSIGNMENT' });
    expect(ready.body.data.status).toBe('READY_FOR_ASSIGNMENT');

    // ── 5. IT assigns a real asset ───────────────────────────────────────────
    // The asset is created here rather than taken from seed stock: the suite runs
    // repeatedly against a persistent database, and consuming seeded laptops
    // would make the test pass once and then fail for want of inventory.
    const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
    const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');

    const unique = created.requestNumber.replace(/\D/g, '');
    const createdAsset = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({
        assetTag: `WF-${unique}`,
        name: 'Dell Latitude 7450 (workflow test)',
        categoryId: itCategory.id,
        serialNumber: `WFSN-${unique}`,
        status: 'AVAILABLE',
        condition: 'NEW',
      });
    expect(createdAsset.status, JSON.stringify(createdAsset.body)).toBe(201);
    const laptop = createdAsset.body.data;
    expect(laptop).toBeDefined();

    const assigned = await api(app)
      .post(`/api/v1/assets/${laptop.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.status).toBe('ASSIGNED');

    await api(app)
      .post(`/api/v1/requests/${created.id}/advance`)
      .set(auth(s.itAdmin))
      .send({ status: 'ASSIGNED' });

    // ── 6. Employee confirms receipt ─────────────────────────────────────────
    const detail = await api(app).get(`/api/v1/assets/${laptop.id}`).set(auth(s.employee));
    const openAssignment = detail.body.data.assignments.find(
      (a: { returnedAt: string | null }) => a.returnedAt === null,
    );
    expect(openAssignment).toBeDefined();

    const acknowledged = await api(app)
      .post(`/api/v1/assets/assignments/${openAssignment.id}/acknowledge`)
      .set(auth(s.employee));
    expect(acknowledged.status).toBe(201);
    expect(acknowledged.body.data.acknowledgedAt).toBeTruthy();

    const completed = await api(app)
      .post(`/api/v1/requests/${created.id}/advance`)
      .set(auth(s.itAdmin))
      .send({ status: 'COMPLETED' });
    expect(completed.body.data.status).toBe('COMPLETED');

    // ── 7. The employee was notified along the way ───────────────────────────
    const notifications = await api(app)
      .get('/api/v1/notifications?pageSize=50')
      .set(auth(s.employee));
    const types = notifications.body.data.map((n: { type: string }) => n.type);
    expect(types).toContain('REQUEST_APPROVED');
  });

  it('rejects at the first step and skips the remaining ones', async () => {
    const created = await createRequest(s.employee);
    await api(app).post(`/api/v1/requests/${created.id}/submit`).set(auth(s.employee));

    const rejected = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'REJECTED', comment: 'Budget is frozen until Q3.' });

    expect(rejected.body.data.status).toBe('REJECTED');
    const decisions = rejected.body.data.approvals;
    expect(decisions[0].decision).toBe('REJECTED');
    // The rest are closed as skipped, so the chain reads as a finished history.
    expect(decisions.slice(1).every((a: { decision: string }) => a.decision === 'SKIPPED')).toBe(
      true,
    );
  });
});

describe('cost thresholds (spec section 11)', () => {
  it('skips finance approval for a low-value kitchen request', async () => {
    const created = await createRequest(s.employee, {
      type: 'KITCHEN_REQUIREMENT',
      estimatedCost: '45.00',
      businessReason: 'The kettle in the second-floor kitchen has stopped working.',
      items: [{ description: 'Electric kettle', quantity: 1, estimatedCost: '45.00' }],
    });

    const submitted = await api(app)
      .post(`/api/v1/requests/${created.id}/submit`)
      .set(auth(s.employee));

    // Kitchen workflow is Office review then Finance above 200.00. At 45.00 the
    // finance step must not exist at all.
    const names = submitted.body.data.approvals.map((a: { stepName: string }) => a.stepName);
    expect(names).toEqual(['Office review']);
    expect(submitted.body.data.status).toBe('OFFICE_ADMIN_REVIEW_PENDING');

    const approved = await api(app)
      .post(`/api/v1/requests/${created.id}/decision`)
      .set(auth(s.officeAdmin))
      .send({ decision: 'APPROVED' });
    expect(approved.body.data.status).toBe('APPROVED');
  });

  it('includes finance approval for a high-value kitchen request', async () => {
    const created = await createRequest(s.employee, {
      type: 'KITCHEN_REQUIREMENT',
      estimatedCost: '2199.00',
      businessReason: 'Replacement commercial coffee machine for the main kitchen.',
      items: [{ description: 'Nespresso Momento', quantity: 1, estimatedCost: '2199.00' }],
    });

    const submitted = await api(app)
      .post(`/api/v1/requests/${created.id}/submit`)
      .set(auth(s.employee));

    expect(submitted.body.data.approvals.map((a: { stepName: string }) => a.stepName)).toEqual([
      'Office review',
      'Finance approval',
    ]);
  });
});

describe('request scope', () => {
  it('hides one employee’s request from another', async () => {
    const created = await createRequest(s.employee);

    const otherEmployee = await api(app)
      .get(`/api/v1/requests/${created.id}`)
      .set(auth(s.employee2));
    expect(otherEmployee.status).toBe(404);

    const own = await api(app).get(`/api/v1/requests/${created.id}`).set(auth(s.employee));
    expect(own.status).toBe(200);
  });

  it('shows a manager their direct report’s request', async () => {
    const created = await createRequest(s.employee);
    await api(app).post(`/api/v1/requests/${created.id}/submit`).set(auth(s.employee));

    const managerView = await api(app).get(`/api/v1/requests/${created.id}`).set(auth(s.manager));
    expect(managerView.status).toBe(200);
  });

  it('surfaces only requests awaiting the caller in the approvals inbox', async () => {
    const created = await createRequest(s.employee);
    await api(app).post(`/api/v1/requests/${created.id}/submit`).set(auth(s.employee));

    const managerInbox = await api(app)
      .get('/api/v1/requests?awaitingMe=true&pageSize=50')
      .set(auth(s.manager));
    expect(managerInbox.body.data.some((r: { id: string }) => r.id === created.id)).toBe(true);

    // It is on the manager's desk, so it must not be on IT's yet.
    const itInbox = await api(app)
      .get('/api/v1/requests?awaitingMe=true&pageSize=50')
      .set(auth(s.itAdmin));
    expect(itInbox.body.data.some((r: { id: string }) => r.id === created.id)).toBe(false);
  });

  it('refuses a request raised on behalf of someone else without permission', async () => {
    const response = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        beneficiaryId: s.employee2.user.id,
        businessReason: 'Trying to raise this for a colleague without the permission.',
        items: [{ description: 'Laptop', quantity: 1 }],
      });
    expect(response.status).toBe(403);
  });

  it('allows HR to raise a request on behalf of an employee', async () => {
    const response = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.hr))
      .send({
        type: 'NEW_EMPLOYEE_ONBOARDING',
        beneficiaryId: s.employee2.user.id,
        businessReason: 'Standard equipment for a new starter joining next Monday.',
        items: [{ description: 'Laptop', quantity: 1, estimatedCost: '1499.00' }],
      });
    expect(response.status).toBe(201);
    expect(response.body.data.beneficiary.id).toBe(s.employee2.user.id);
  });
});

describe('internal comments', () => {
  it('hides internal comments from the requester', async () => {
    const created = await createRequest(s.employee);
    await api(app).post(`/api/v1/requests/${created.id}/submit`).set(auth(s.employee));

    await api(app)
      .post(`/api/v1/requests/${created.id}/comments`)
      .set(auth(s.manager))
      .send({ body: 'Checking headcount budget before approving.', isInternal: true });

    await api(app)
      .post(`/api/v1/requests/${created.id}/comments`)
      .set(auth(s.manager))
      .send({ body: 'Looking into this now.', isInternal: false });

    const requesterView = await api(app)
      .get(`/api/v1/requests/${created.id}`)
      .set(auth(s.employee));
    const bodies = requesterView.body.data.comments.map((c: { body: string }) => c.body);
    expect(bodies).toContain('Looking into this now.');
    expect(bodies).not.toContain('Checking headcount budget before approving.');

    const approverView = await api(app).get(`/api/v1/requests/${created.id}`).set(auth(s.manager));
    expect(approverView.body.data.comments).toHaveLength(2);
  });

  it('refuses an internal comment from an employee', async () => {
    const created = await createRequest(s.employee);
    const response = await api(app)
      .post(`/api/v1/requests/${created.id}/comments`)
      .set(auth(s.employee))
      .send({ body: 'Trying to write an internal note.', isInternal: true });
    expect(response.status).toBe(403);
  });
});
