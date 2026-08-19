import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - there is exactly one Super Admin, holding exactly one session.
 *
 * The role is the tenant's master key: full access to users, roles, workflows
 * and platform settings. Two rules pin it down:
 *
 *  1. The role cannot be granted while an active Super Admin exists - not
 *     through a role edit, not on an invitation. Together with the existing
 *     floor (the last one cannot be demoted, deactivated or deleted) this
 *     makes the count exactly one.
 *  2. The account holds one session at a time. A fresh sign-in revokes every
 *     other session before the new tokens are issued, so a stolen or forgotten
 *     session dies the moment the real owner signs in anywhere.
 *
 * The session tests sit last in this file on purpose: they sign the Super
 * Admin in repeatedly, which revokes the session the harness opened, and
 * nothing after them should depend on it.
 */

const ADMIN = { email: 'admin@techpioasset.dev', password: 'TechpioDemo!2026' };
const EMPLOYEE = { email: 'employee@techpioasset.dev', password: 'TechpioDemo!2026' };

let app: INestApplication;
let s: Record<AccountKey, Session>;

/** Native-client login, so the refresh token comes back in a readable header. */
const loginNative = (creds: { email: string; password: string }) =>
  api(app).post('/api/v1/auth/login').set('X-Client-Type', 'mobile').send(creds);

const refreshWith = (token: string) =>
  api(app).post('/api/v1/auth/refresh').set('X-Refresh-Token', token);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

describe('exactly one Super Admin', () => {
  it('refuses to grant the role to a second user', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${s.employee.user.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['SUPER_ADMIN', 'EMPLOYEE'] });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('cannot be granted to another account');
  });

  it('refuses an invitation that carries the role', async () => {
    const res = await api(app)
      .post('/api/v1/users/invite')
      .set(auth(s.superAdmin))
      .send({
        email: `never-a-second-admin-${Date.now()}@techpioasset.dev`,
        firstName: 'Second',
        lastName: 'Admin',
        roleKeys: ['SUPER_ADMIN'],
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('cannot be granted to another account');
  });

  it('still refuses to strip the role from the only holder - the floor stands', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${s.superAdmin.user.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE'] });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('Grant Super Admin to another active user');
  });
});

describe('one Super Admin session at a time', () => {
  it('lets an ordinary account hold several sessions - no collateral', async () => {
    const first = await loginNative(EMPLOYEE);
    const second = await loginNative(EMPLOYEE);
    expect(second.status).toBe(200);

    // The employee's first session survives the second sign-in.
    const stillAlive = await refreshWith(first.headers['x-refresh-token']);
    expect(stillAlive.status).toBe(200);
  });

  it('ends every other Super Admin session on a fresh sign-in', async () => {
    const first = await loginNative(ADMIN);
    expect(first.status).toBe(200);

    const second = await loginNative(ADMIN);
    expect(second.status).toBe(200);

    // The earlier session is dead the moment the new one exists...
    const revoked = await refreshWith(first.headers['x-refresh-token']);
    expect(revoked.status).toBeGreaterThanOrEqual(400);

    // ...and the new one is the single survivor.
    const current = await refreshWith(second.headers['x-refresh-token']);
    expect(current.status).toBe(200);
  });
});
