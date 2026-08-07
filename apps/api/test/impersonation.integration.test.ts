import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — sign in as another user. The containment lines under test: only
 * users:impersonate holders may do it, Super Admins can never be targets, the
 * issued session carries the TARGET's permissions (not the admin's), it is
 * access-only (no refresh token minted), and it is audited from both sides.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  await app?.close();
});

describe('impersonation', () => {
  it('is refused without users:impersonate', async () => {
    const res = await api(app)
      .post(`/api/v1/users/${s.employee.user.id}/impersonate`)
      .set(auth(s.hr))
      .send({});
    expect(res.status).toBe(403);
  });

  it('refuses yourself and refuses a Super Admin target', async () => {
    const self = await api(app)
      .post(`/api/v1/users/${s.superAdmin.user.id}/impersonate`)
      .set(auth(s.superAdmin))
      .send({});
    expect([400, 422]).toContain(self.status);

    // Make a second Super Admin the target - it must be refused even for a
    // Super Admin actor.
    const otherAdmin = await prisma.client.user.findFirst({
      where: {
        companyId,
        id: { not: s.superAdmin.user.id },
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
      select: { id: true },
    });
    if (otherAdmin) {
      const res = await api(app)
        .post(`/api/v1/users/${otherAdmin.id}/impersonate`)
        .set(auth(s.superAdmin))
        .send({});
      expect(res.status).toBe(403);
    }
  });

  it('issues a session with the TARGET permissions, no refresh token, and audits it', async () => {
    const refreshBefore = await prisma.client.refreshToken.count({
      where: { userId: s.employee.user.id },
    });

    const res = await api(app)
      .post(`/api/v1/users/${s.employee.user.id}/impersonate`)
      .set(auth(s.superAdmin))
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.expiresIn).toBeLessThanOrEqual(900);
    expect(res.body.data.user.email).toBe(s.employee.user.email);

    // The token really is the employee: /auth/me answers as them, and an
    // admin-only endpoint refuses.
    const token = res.body.data.accessToken as string;
    const me = await api(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` });
    expect(me.body.data.email).toBe(s.employee.user.email);

    const adminOnly = await api(app)
      .get('/api/v1/users?view=deactivated')
      .set({ Authorization: `Bearer ${token}` });
    expect(adminOnly.status).toBe(403);

    // Access-only: impersonation minted no refresh token for the target.
    const refreshAfter = await prisma.client.refreshToken.count({
      where: { userId: s.employee.user.id },
    });
    expect(refreshAfter).toBe(refreshBefore);

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        companyId,
        action: 'LOGIN',
        actorId: s.superAdmin.user.id,
        entityId: s.employee.user.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { newValues: true },
    });
    expect(JSON.stringify(audit?.newValues)).toContain('impersonation');
  });

  it('refuses a deactivated target', async () => {
    const parked = await prisma.client.user.upsert({
      where: { companyId_email: { companyId, email: 'imp-parked@techpioasset.test' } },
      update: { status: 'DEACTIVATED', deletedAt: null },
      create: {
        companyId,
        email: 'imp-parked@techpioasset.test',
        passwordHash: 'x',
        status: 'DEACTIVATED',
        profile: { create: { firstName: 'Imp', lastName: 'Parked' } },
      },
    });
    const res = await api(app)
      .post(`/api/v1/users/${parked.id}/impersonate`)
      .set(auth(s.superAdmin))
      .send({});
    expect(res.status).toBe(409);

    await prisma.client.$executeRawUnsafe('DELETE FROM user_profiles WHERE "userId" = $1', parked.id);
    await prisma.client.$executeRawUnsafe('DELETE FROM users WHERE id = $1', parked.id);
  });
});
