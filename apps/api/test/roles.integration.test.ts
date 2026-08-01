import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.2 Workstream G — runtime custom-role management (roles:manage). The guards
 * and invariants are the point: only a Super Admin may author roles, system roles
 * are immutable, a read-only role can never hold a write grant, and a role that
 * still has members cannot be deleted. The suite shares one database, so every
 * created role is deleted and every borrowed user is restored.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

const base = '/api/v1/roles';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

describe('roles:manage guard', () => {
  it('forbids a user without roles:manage', async () => {
    const res = await api(app).get(base).set(auth(s.employee));
    expect(res.status).toBe(403);
  });
});

describe('listing & catalogue', () => {
  it('lists tenant roles with grant and member counts', async () => {
    const res = await api(app).get(base).set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const roles = res.body.data as Array<{
      key: string;
      isSystem: boolean;
      permissionCount: number;
      userCount: number;
    }>;
    const employee = roles.find((r) => r.key === 'EMPLOYEE');
    expect(employee?.isSystem).toBe(true);
    expect(typeof employee?.permissionCount).toBe('number');
    expect(typeof employee?.userCount).toBe('number');
  });

  it('returns the permission catalogue grouped by resource, flagging read-only', async () => {
    const res = await api(app).get(`${base}/permissions`).set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const assets = res.body.data.resources.find(
      (g: { resource: string }) => g.resource === 'assets',
    );
    expect(assets.permissions.some((p: { key: string; readOnly: boolean }) => p.key === 'assets:read' && p.readOnly)).toBe(true);
    expect(assets.permissions.some((p: { key: string; readOnly: boolean }) => p.key === 'assets:create' && !p.readOnly)).toBe(true);
  });
});

describe('custom role lifecycle', () => {
  it('creates, updates and deletes a custom role', async () => {
    const create = await api(app).post(base).set(auth(s.superAdmin)).send({
      name: 'Warehouse Clerk',
      description: 'Stock counts only',
      permissions: ['inventory:read', 'assets:read'],
    });
    expect(create.status).toBe(201);
    const role = create.body.data;
    expect(role.isSystem).toBe(false);
    expect([...role.permissions].sort()).toEqual(['assets:read', 'inventory:read']);

    const upd = await api(app).patch(`${base}/${role.id}`).set(auth(s.superAdmin)).send({
      name: 'Warehouse Lead',
      permissions: ['inventory:read', 'inventory:adjust'],
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.name).toBe('Warehouse Lead');
    expect([...upd.body.data.permissions].sort()).toEqual(['inventory:adjust', 'inventory:read']);

    const del = await api(app).delete(`${base}/${role.id}`).set(auth(s.superAdmin));
    expect(del.status).toBe(200);

    const after = await api(app).get(base).set(auth(s.superAdmin));
    expect(after.body.data.find((r: { id: string }) => r.id === role.id)).toBeUndefined();
  });

  it('rejects a write permission on a read-only role', async () => {
    const res = await api(app).post(base).set(auth(s.superAdmin)).send({
      name: 'Read Only Watcher',
      isReadOnly: true,
      permissions: ['assets:read', 'assets:create'],
    });
    expect(res.status).toBe(422);
  });

  it('returns advisory SoD conflicts for a role combining both sides of a pair', async () => {
    const create = await api(app).post(base).set(auth(s.superAdmin)).send({
      name: 'SoD Probe',
      permissions: ['requests:create', 'requests:approve'],
    });
    expect(create.status).toBe(201);
    const role = create.body.data;
    // Warned, not blocked: the role exists and carries the conflict detail.
    expect(role.sodConflicts.map((c: { id: string }) => c.id)).toContain('request-and-approve');

    await api(app).delete(`${base}/${role.id}`).set(auth(s.superAdmin));
  });

  it('rejects an unknown permission key', async () => {
    const res = await api(app).post(base).set(auth(s.superAdmin)).send({
      name: 'Bogus Role',
      permissions: ['assets:teleport'],
    });
    expect(res.status).toBe(422);
  });
});

describe('system role protection', () => {
  it('refuses to edit or delete a system role', async () => {
    const list = await api(app).get(base).set(auth(s.superAdmin));
    const sys = list.body.data.find((r: { isSystem: boolean }) => r.isSystem);

    const patch = await api(app).patch(`${base}/${sys.id}`).set(auth(s.superAdmin)).send({ name: 'Nope' });
    expect(patch.status).toBe(403);

    const del = await api(app).delete(`${base}/${sys.id}`).set(auth(s.superAdmin));
    expect(del.status).toBe(403);
  });
});

describe('delete protection', () => {
  it('refuses to delete a role that still has members, then allows it once reassigned', async () => {
    const create = await api(app).post(base).set(auth(s.superAdmin)).send({
      name: 'Temp Assignable',
      permissions: ['assets:read'],
    });
    const role = create.body.data;

    const u = await api(app)
      .get('/api/v1/users?q=employee2&pageSize=1')
      .set(auth(s.superAdmin));
    const uid = u.body.data[0].id;

    const assign = await api(app)
      .patch(`/api/v1/users/${uid}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE', role.key] });
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);

    const check = await api(app).get(`${base}/${role.id}`).set(auth(s.superAdmin));
    expect(check.body.data.userCount, JSON.stringify(check.body)).toBe(1);

    const blocked = await api(app).delete(`${base}/${role.id}`).set(auth(s.superAdmin));
    expect(blocked.status).toBe(409);

    // Reassign the member back to plain EMPLOYEE, then the role can be removed.
    await api(app)
      .patch(`/api/v1/users/${uid}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE'] });

    const ok = await api(app).delete(`${base}/${role.id}`).set(auth(s.superAdmin));
    expect(ok.status).toBe(200);
  });
});
