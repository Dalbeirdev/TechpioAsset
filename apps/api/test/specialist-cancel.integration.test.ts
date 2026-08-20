import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - whoever may raise a request may withdraw their own.
 *
 * Found when the live tenant granted its first specialist roles: the People
 * editor replaces roles wholesale, so somebody made an IT Administrator stops
 * being a Registered Employee. `requests:cancel` lived only on EMPLOYEE (and
 * the two admin roles) while `requests:create` was on all of them - so an IT
 * lead, HR, Finance, Office or Manager could raise a ticket and then find no
 * way to cancel it. The route guard refused before the service's own ownership
 * check could allow it.
 *
 * These run for every specialist role, because the gap was in the matrix
 * rather than in one role's configuration.
 */

const SPECIALISTS: AccountKey[] = ['itAdmin', 'hr', 'officeAdmin', 'finance', 'manager'];

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

describe('a specialist can withdraw their own request', () => {
  for (const role of SPECIALISTS) {
    it(`${role} can raise and then cancel`, async () => {
      const created = await api(app)
        .post('/api/v1/requests')
        .set(auth(s[role]))
        .send({
          type: 'ADDITIONAL_EQUIPMENT',
          businessReason: `Cancel rights for ${role}.`,
          items: [
            { description: `Cancel test ${role} ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 },
          ],
        });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      const id = created.body.data.id as string;

      const cancelled = await api(app)
        .post(`/api/v1/requests/${id}/cancel`)
        .set(auth(s[role]))
        .send({ reason: 'No longer needed' });

      expect(cancelled.status, JSON.stringify(cancelled.body)).toBeLessThan(300);
      const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s[role]));
      expect(detail.body.data.status).toBe('CANCELLED');
    });
  }

  it('holding cancel does not let you cancel somebody else’s request', async () => {
    // The permission is the door; ownership is still the lock. Checked with a
    // plain employee, because every specialist role also holds
    // requests:approve - and an approver cancelling instead of rejecting is
    // long-standing, deliberate behaviour, not something this change touched.
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Somebody else’s request.',
        items: [{ description: `Foreign ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
      });
    const id = created.body.data.id as string;

    const refused = await api(app)
      .post(`/api/v1/requests/${id}/cancel`)
      .set(auth(s.employee2))
      .send({ reason: 'Not mine to cancel' });

    expect(refused.status).toBeGreaterThanOrEqual(400);
  });
});
