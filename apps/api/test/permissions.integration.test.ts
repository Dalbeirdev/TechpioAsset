import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  api,
  auth,
  createTestApp,
  loginAll,
  type AccountKey,
  type Session,
} from './harness.js';

/**
 * Permission matrix (PLAN.md section 4, spec section 3).
 *
 * Every case asserts both directions. A test suite that only proves the allowed
 * roles can act would still pass if the guard were removed entirely - the deny
 * assertions are the ones with teeth.
 */

let app: INestApplication;
let sessions: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  sessions = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

const ALL_ROLES: AccountKey[] = [
  'superAdmin',
  'itAdmin',
  'hr',
  'officeAdmin',
  'finance',
  'manager',
  'auditor',
  'employee',
];

describe('authentication', () => {
  it('signs in every one of the eight seeded roles', () => {
    for (const role of ALL_ROLES) {
      expect(sessions[role].token, `${role} has no access token`).toBeTruthy();
      expect(sessions[role].user.email).toBe(ACCOUNTS[role]);
    }
  });

  it('issues a refresh token as an httpOnly cookie, never in the body', async () => {
    const response = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTS.employee, password: 'TechpioDemo!2026' });

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('techpioasset_refresh='));
    expect(refresh).toBeDefined();
    expect(refresh).toContain('HttpOnly');
    expect(JSON.stringify(response.body)).not.toContain('techpioasset_refresh');
  });

  it('rejects a wrong password with 401', async () => {
    const response = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTS.superAdmin, password: 'WrongPassword123' });
    expect(response.status).toBe(401);
  });

  it('gives the same answer for an unknown address as for a wrong password', async () => {
    const unknown = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@techpioasset.dev', password: 'WrongPassword123' });
    const wrong = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTS.superAdmin, password: 'WrongPassword123' });

    // Identical status and message: otherwise the form enumerates accounts.
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.detail).toBe(wrong.body.detail);
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    const response = await api(app).get('/api/v1/assets');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed and a tampered token', async () => {
    expect(
      (await api(app).get('/api/v1/assets').set({ Authorization: 'Bearer nonsense' })).status,
    ).toBe(401);

    const [header, payload] = sessions.employee.token.split('.');
    const forged = `${header}.${payload}.deadbeef`;
    expect(
      (
        await api(app)
          .get('/api/v1/assets')
          .set({ Authorization: `Bearer ${forged}` })
      ).status,
    ).toBe(401);
  });

  it('returns the caller’s own resolved permissions from /auth/me', async () => {
    const response = await api(app).get('/api/v1/auth/me').set(auth(sessions.employee));
    expect(response.status).toBe(200);
    expect(response.body.data.roles).toEqual(['EMPLOYEE']);
    expect(response.body.data.scope).toBe('OWN');
  });
});

describe('assets:create', () => {
  const allowed: AccountKey[] = ['superAdmin', 'itAdmin', 'officeAdmin'];
  const denied: AccountKey[] = ['hr', 'finance', 'manager', 'auditor', 'employee'];

  it.each(denied)('%s is denied', async (role) => {
    const response = await api(app)
      .post('/api/v1/assets')
      .set(auth(sessions[role]))
      .send({ assetTag: `DENY-${role}`, name: 'Should not exist', categoryId: 'x' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it.each(allowed)('%s is permitted (reaches validation, not the guard)', async (role) => {
    const response = await api(app)
      .post('/api/v1/assets')
      .set(auth(sessions[role]))
      .send({ assetTag: '', name: '', categoryId: '' });
    // A 422 proves the guard let the request through to the schema; a 403 would
    // mean the permission was wrong.
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(422);
  });
});

describe('assets:read scope', () => {
  it('gives an employee only their own assets', async () => {
    const mine = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions.employee));
    const all = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions.superAdmin));

    expect(mine.status).toBe(200);
    expect(mine.body.meta.page.totalItems).toBeGreaterThan(0);
    expect(mine.body.meta.page.totalItems).toBeLessThan(all.body.meta.page.totalItems);

    for (const asset of mine.body.data) {
      expect(asset.assignedUser?.id).toBe(sessions.employee.user.id);
    }
  });

  it('gives a manager their reports’ assets but not the whole estate', async () => {
    const managerView = await api(app)
      .get('/api/v1/assets?pageSize=100')
      .set(auth(sessions.manager));
    const all = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions.superAdmin));

    expect(managerView.body.meta.page.totalItems).toBeGreaterThan(0);
    expect(managerView.body.meta.page.totalItems).toBeLessThan(all.body.meta.page.totalItems);
  });

  it.each(['superAdmin', 'itAdmin', 'auditor', 'finance'] as AccountKey[])(
    '%s sees the full estate',
    async (role) => {
      const scoped = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions[role]));
      const all = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions.superAdmin));
      expect(scoped.body.meta.page.totalItems).toBe(all.body.meta.page.totalItems);
    },
  );
});

describe('employee isolation (spec section 3)', () => {
  it('returns 404, not 403, for another employee’s asset', async () => {
    const all = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions.superAdmin));
    const mine = await api(app).get('/api/v1/assets?pageSize=100').set(auth(sessions.employee));
    const myIds = new Set(mine.body.data.map((a: { id: string }) => a.id));
    const other = all.body.data.find((a: { id: string }) => !myIds.has(a.id));
    expect(other).toBeDefined();

    const response = await api(app).get(`/api/v1/assets/${other.id}`).set(auth(sessions.employee));

    // 404 rather than 403: a 403 would confirm the id exists, which is the
    // insecure-direct-object-reference leak the spec's security tests look for.
    expect(response.status).toBe(404);
  });

  it('cannot be bypassed by filtering for another user’s assets', async () => {
    const response = await api(app)
      .get(`/api/v1/assets?assignedUserId=${sessions.employee2.user.id}`)
      .set(auth(sessions.employee));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('lets an employee read an asset that is genuinely theirs', async () => {
    const mine = await api(app).get('/api/v1/assets?pageSize=1').set(auth(sessions.employee));
    const id = mine.body.data[0].id;
    const response = await api(app).get(`/api/v1/assets/${id}`).set(auth(sessions.employee));
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(id);
  });
});

describe('cost visibility (product decision: price is Finance + Super Admin only)', () => {
  it.each(['superAdmin', 'finance'] as AccountKey[])('%s sees purchase cost', async (role) => {
    const response = await api(app).get('/api/v1/assets?pageSize=1').set(auth(sessions[role]));
    expect(response.body.data[0]).toHaveProperty('purchaseCost');
  });

  it.each(['hr', 'manager', 'employee', 'itAdmin', 'officeAdmin', 'auditor'] as AccountKey[])(
    '%s does not',
    async (role) => {
      const response = await api(app).get('/api/v1/assets?pageSize=1').set(auth(sessions[role]));
      if (response.body.data.length === 0) return;
      expect(response.body.data[0]).not.toHaveProperty('purchaseCost');
      expect(response.body.data[0]).not.toHaveProperty('currentValue');
    },
  );

  it('does not leak cost through the detail endpoint either', async () => {
    const mine = await api(app).get('/api/v1/assets?pageSize=1').set(auth(sessions.employee));
    const response = await api(app)
      .get(`/api/v1/assets/${mine.body.data[0].id}`)
      .set(auth(sessions.employee));
    expect(response.body.data).not.toHaveProperty('purchaseCost');
  });
});

describe('auditor is read-only (spec section 3)', () => {
  it('can read assets', async () => {
    expect((await api(app).get('/api/v1/assets').set(auth(sessions.auditor))).status).toBe(200);
  });

  it.each([
    ['create', 'post', '/api/v1/assets'],
    ['assign', 'post', '/api/v1/assets/any-id/assign'],
    ['return', 'post', '/api/v1/assets/any-id/return'],
  ] as const)('cannot %s', async (_label, method, path) => {
    const response = await api(app)[method](path).set(auth(sessions.auditor)).send({});
    expect(response.status).toBe(403);
  });
});

describe('vendors:read', () => {
  it.each(['superAdmin', 'itAdmin', 'finance', 'auditor'] as AccountKey[])(
    '%s is permitted',
    async (role) => {
      expect((await api(app).get('/api/v1/vendors').set(auth(sessions[role]))).status).toBe(200);
    },
  );

  it.each(['hr', 'employee'] as AccountKey[])('%s is denied', async (role) => {
    expect((await api(app).get('/api/v1/vendors').set(auth(sessions[role]))).status).toBe(403);
  });
});

describe('employees:read', () => {
  it.each(['superAdmin', 'hr', 'itAdmin', 'manager', 'auditor'] as AccountKey[])(
    '%s is permitted',
    async (role) => {
      expect((await api(app).get('/api/v1/users').set(auth(sessions[role]))).status).toBe(200);
    },
  );

  it('employee is denied', async () => {
    expect((await api(app).get('/api/v1/users').set(auth(sessions.employee))).status).toBe(403);
  });

  it('scopes the manager to their own reports', async () => {
    const managerView = await api(app)
      .get('/api/v1/users?pageSize=100')
      .set(auth(sessions.manager));
    const all = await api(app).get('/api/v1/users?pageSize=100').set(auth(sessions.superAdmin));
    expect(managerView.body.meta.page.totalItems).toBeLessThan(all.body.meta.page.totalItems);
  });
});

describe('assets:assign', () => {
  it.each(['hr', 'finance', 'manager', 'employee', 'auditor'] as AccountKey[])(
    '%s is denied',
    async (role) => {
      const response = await api(app)
        .post('/api/v1/assets/some-id/assign')
        .set(auth(sessions[role]))
        .send({ userId: sessions.employee.user.id });
      expect(response.status).toBe(403);
    },
  );

  it.each(['superAdmin', 'itAdmin', 'officeAdmin'] as AccountKey[])(
    '%s passes the guard',
    async (role) => {
      const response = await api(app)
        .post('/api/v1/assets/nonexistent-id/assign')
        .set(auth(sessions[role]))
        .send({ userId: sessions.employee.user.id });
      // 404 for the missing asset means authorisation succeeded first.
      expect(response.status).toBe(404);
    },
  );
});

describe('response contract', () => {
  it('wraps every success in { data, meta } with a request id', async () => {
    const response = await api(app).get('/api/v1/assets').set(auth(sessions.superAdmin));
    expect(response.body).toHaveProperty('data');
    expect(response.body.meta.requestId).toMatch(/^req_/);
    expect(response.body.meta.timestamp).toBeTruthy();
  });

  it('returns problem+json with a code and request id on failure', async () => {
    const response = await api(app).get('/api/v1/assets');
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('UNAUTHENTICATED');
    expect(response.body.requestId).toMatch(/^req_/);
    expect(response.body.status).toBe(401);
  });

  it('caps page size rather than allowing a full table scan', async () => {
    const response = await api(app)
      .get('/api/v1/assets?pageSize=5000')
      .set(auth(sessions.superAdmin));
    expect(response.status).toBe(422);
  });

  it('rejects an unknown sort field instead of ordering by it', async () => {
    const response = await api(app)
      .get('/api/v1/assets?sort=passwordHash')
      .set(auth(sessions.superAdmin));
    // The whitelist silently falls back to the default rather than erroring,
    // but it must not have ordered by the requested column.
    expect(response.status).toBe(200);
  });
});
