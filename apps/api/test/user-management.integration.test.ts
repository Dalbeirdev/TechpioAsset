import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * User & role management (users:manage / roles:manage). These endpoints can
 * escalate privilege and lock people out, so the guards are the point: only a
 * Super Admin may wield them, the company can never lose its last Super Admin,
 * and no one can disable their own account.
 *
 * Every test that mutates employee3 restores it afterwards, because the suite
 * shares one database.
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

async function userId(email: string): Promise<string> {
  const res = await api(app)
    .get(`/api/v1/users?q=${encodeURIComponent(email)}&pageSize=1`)
    .set(auth(s.superAdmin));
  return res.body.data[0].id;
}

// Return employee3 to its seeded baseline after each mutation test.
afterEach(async () => {
  const id = await userId('employee3');
  await api(app)
    .patch(`/api/v1/users/${id}/roles`)
    .set(auth(s.superAdmin))
    .send({ roleKeys: ['EMPLOYEE'] });
  await api(app)
    .patch(`/api/v1/users/${id}/status`)
    .set(auth(s.superAdmin))
    .send({ status: 'ACTIVE' });
});

describe('role filter', () => {
  it('returns only users holding the requested role', async () => {
    const res = await api(app)
      .get('/api/v1/users?role=FINANCE&pageSize=100')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const u of res.body.data) {
      expect(u.roles.some((r: { role: { key: string } }) => r.role.key === 'FINANCE')).toBe(true);
    }
  });
});

describe('changing roles (roles:manage)', () => {
  it('lets a Super Admin replace a user’s roles', async () => {
    const id = await userId('employee3');
    const res = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE', 'FINANCE'] });
    expect(res.status).toBe(200);
    expect(res.body.data.roles.map((r: { role: { key: string } }) => r.role.key).sort()).toEqual([
      'EMPLOYEE',
      'FINANCE',
    ]);
  });

  it.each(['itAdmin', 'hr', 'manager', 'employee'] as AccountKey[])(
    'forbids %s from changing roles',
    async (role) => {
      const id = await userId('employee3');
      const res = await api(app)
        .patch(`/api/v1/users/${id}/roles`)
        .set(auth(s[role]))
        .send({ roleKeys: ['FINANCE'] });
      expect(res.status).toBe(403);
    },
  );

  it('rejects an empty role set (everyone keeps at least one role)', async () => {
    const id = await userId('employee3');
    const res = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: [] });
    expect(res.status).toBe(422);
  });

  it('refuses to demote the last Super Admin', async () => {
    const id = s.superAdmin.user.id;
    const res = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE'] });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/Super Admin/i);
  });
});

describe('changing status (users:manage)', () => {
  it('deactivates and reactivates a user', async () => {
    const id = await userId('employee3');
    const off = await api(app)
      .patch(`/api/v1/users/${id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'DEACTIVATED', reason: 'Left the company' });
    expect(off.status).toBe(200);
    expect(off.body.data.status).toBe('DEACTIVATED');

    const on = await api(app)
      .patch(`/api/v1/users/${id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'ACTIVE' });
    expect(on.body.data.status).toBe('ACTIVE');
  });

  it('forbids a non-admin from changing status', async () => {
    const id = await userId('employee3');
    const res = await api(app)
      .patch(`/api/v1/users/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(403);
  });

  it('refuses to let a Super Admin deactivate their own account', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${s.superAdmin.user.id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(422);
  });
});
