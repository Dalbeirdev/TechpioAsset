import type { INestApplication } from '@nestjs/common';
import { SYSTEM_ROLES } from '@techpioasset/domain';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.6 A4 — the platform plane. Invariants under test: the gate is
 * operator-designated (a tenant Super Admin alone is NOT enough), a
 * provisioned tenant is complete and ISOLATED, suspension blocks every login,
 * and every platform action is audited against the target tenant.
 */

// The demo Super Admin doubles as the designated platform operator - set in
// vitest.integration.config.ts env (ConfigModule validates eagerly; setting it
// here would be too late). itAdmin proves tenant power alone means 403.

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let tenantId: string;
let adminPassword: string;

const run = Date.now() % 1_000_000;
const TENANT = `Acme Rentals ${run}`;
const ADMIN = `owner-${run}@acme-rentals.test`;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  if (tenantId) {
    // AuditLog is append-only at the app layer (correctly refuses deleteMany);
    // dropping the company cascades its children at the database level.
    await prisma.client.company.delete({ where: { id: tenantId } }).catch(() => undefined);
  }
  await app?.close();
});

describe('the operator gate', () => {
  it('tenant power alone does not open the platform plane', async () => {
    // itAdmin and even a would-be listed employee are refused; only the
    // operator-designated email passes.
    for (const key of ['itAdmin', 'employee', 'finance'] as const) {
      const res = await api(app).get('/api/v1/platform/tenants').set(auth(s[key]));
      expect(res.status, key).toBe(403);
    }
    const ok = await api(app).get('/api/v1/platform/tenants').set(auth(s.superAdmin));
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBeGreaterThanOrEqual(1);
    expect(ok.body.data[0].usage.users).toBeGreaterThan(0);
  });
});

describe('tenant provisioning', () => {
  it('provisions a complete, isolated tenant; the bootstrap password works once shown', async () => {
    const created = await api(app)
      .post('/api/v1/platform/tenants')
      .set(auth(s.superAdmin))
      .send({ name: TENANT, adminEmail: ADMIN, adminFirstName: 'Ada', adminLastName: 'Acme' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    tenantId = created.body.data.id;
    adminPassword = created.body.data.admin.initialPassword;
    expect(adminPassword).toBeTruthy();

    // Complete: every system role with grants, core categories, safe AI config.
    // Counted from SYSTEM_ROLES rather than a literal, so removing a role (as
    // v2.40 did with VENDOR) updates provisioning and this assertion together
    // instead of leaving a number nobody remembers the reason for.
    const roles = await prisma.client.role.findMany({
      where: { companyId: tenantId },
      include: { _count: { select: { permissions: true } } },
    });
    expect(roles).toHaveLength(SYSTEM_ROLES.length);
    const superAdmin = roles.find((r) => r.key === 'SUPER_ADMIN')!;
    expect(superAdmin._count.permissions).toBeGreaterThan(60);
    const auditor = roles.find((r) => r.key === 'AUDITOR')!;
    expect(auditor.isReadOnly).toBe(true);
    expect(await prisma.client.category.count({ where: { companyId: tenantId } })).toBe(4);
    expect(
      await prisma.client.aIConfiguration.findUnique({ where: { companyId: tenantId } }),
    ).toMatchObject({ globallyEnabled: false, humanReviewRequired: true });

    // The returned password signs in and carries Super Admin power.
    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN, password: adminPassword });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.data.user.roles).toContain('SUPER_ADMIN');

    // ISOLATED: the new tenant sees none of the demo tenant's assets.
    const token = login.body.data.accessToken;
    const assets = await api(app)
      .get('/api/v1/assets?pageSize=5')
      .set('Authorization', `Bearer ${token}`);
    expect(assets.status).toBe(200);
    expect(assets.body.data).toHaveLength(0);

    // Audited against the TARGET tenant, naming the operator.
    const auditRow = await prisma.client.auditLog.findFirst({
      where: { companyId: tenantId, action: 'TENANT_CREATED' },
    });
    expect(auditRow).toBeTruthy();
  });

  it('a duplicate admin email is refused', async () => {
    const res = await api(app)
      .post('/api/v1/platform/tenants')
      .set(auth(s.superAdmin))
      .send({ name: 'Dup Co', adminEmail: ADMIN, adminFirstName: 'A', adminLastName: 'B' });
    expect(res.status).toBe(409);
  });
});

describe('suspension', () => {
  it('suspending a tenant blocks every login; reactivating restores it', async () => {
    const suspended = await api(app)
      .patch(`/api/v1/platform/tenants/${tenantId}/active`)
      .set(auth(s.superAdmin))
      .send({ isActive: false });
    expect(suspended.status).toBe(200);

    const blocked = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN, password: adminPassword });
    expect(blocked.status).toBe(403);
    expect(blocked.body.detail).toContain('suspended');

    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId: tenantId, action: 'TENANT_SUSPENDED' },
    });
    expect(audit).toBeTruthy();

    const reactivated = await api(app)
      .patch(`/api/v1/platform/tenants/${tenantId}/active`)
      .set(auth(s.superAdmin))
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    const restored = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN, password: adminPassword });
    expect(restored.status).toBe(200);
  });

  it('the operator cannot suspend the tenant they are signed into', async () => {
    const res = await api(app)
      .patch(`/api/v1/platform/tenants/${s.superAdmin.user.companyId}/active`)
      .set(auth(s.superAdmin))
      .send({ isActive: false });
    expect(res.status).toBe(409);
  });
});

describe('AI provider settings (v2.15)', () => {
  it('saves, routes, verifies and clears - key never returned', async () => {
    // Explicit operator choice of simulation.
    const put = await api(app)
      .put('/api/v1/platform/ai-settings')
      .set(auth(s.superAdmin))
      .send({ provider: 'mock' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data.configured).toBe(true);
    expect(put.body.data.effective.provider).toBe('mock');

    // A real provider requires a key on first save.
    const noKey = await api(app)
      .put('/api/v1/platform/ai-settings')
      .set(auth(s.superAdmin))
      .send({ provider: 'anthropic' });
    expect(noKey.status).toBe(422);

    const withKey = await api(app)
      .put('/api/v1/platform/ai-settings')
      .set(auth(s.superAdmin))
      .send({ provider: 'anthropic', apiKey: 'sk-test-not-a-real-key' });
    expect(withKey.status).toBe(200);
    expect(withKey.body.data.hasKey).toBe(true);
    // The key itself never comes back.
    expect(JSON.stringify(withKey.body)).not.toContain('sk-test-not-a-real-key');

    // Azure needs its endpoint.
    const azureNoEndpoint = await api(app)
      .put('/api/v1/platform/ai-settings')
      .set(auth(s.superAdmin))
      .send({ provider: 'azure', apiKey: 'x' });
    expect(azureNoEndpoint.status).toBe(422);

    // Mock verifies as simulated without touching any network.
    await api(app)
      .put('/api/v1/platform/ai-settings')
      .set(auth(s.superAdmin))
      .send({ provider: 'mock' });
    const test = await api(app)
      .post('/api/v1/platform/ai-settings/test')
      .set(auth(s.superAdmin))
      .send({});
    expect(test.status).toBe(200);
    expect(test.body.data.ok).toBe(true);
    expect(test.body.data.provider).toBe('mock');

    // Tenant power alone cannot reach any of it.
    const denied = await api(app)
      .get('/api/v1/platform/ai-settings')
      .set(auth(s.itAdmin));
    expect(denied.status).toBe(403);

    // Clear restores the environment default.
    const del = await api(app)
      .delete('/api/v1/platform/ai-settings')
      .set(auth(s.superAdmin));
    expect(del.status).toBe(204);
    const after = await api(app).get('/api/v1/platform/ai-settings').set(auth(s.superAdmin));
    expect(after.body.data.configured).toBe(false);
    expect(after.body.data.effective.source).toBe('environment');
  });
});
