import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — the invite flow: the registration path tenant admins were missing.
 *
 * The lines these tests hold: only users:manage can invite; an invited
 * account cannot sign in until accepted; accepting is single-use and sets
 * password + ACTIVE + verified email in one step; the link never works twice.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

const EMAIL = 'invitee@techpioasset.test';
const PASSWORD = 'Invitee!Pass2026x';

async function cleanupInvitee() {
  const rows = await prisma.client.$queryRawUnsafe<{ id: string }[]>(
    'SELECT id FROM users WHERE email = $1',
    EMAIL,
  );
  for (const { id } of rows) {
    await prisma.client.$executeRawUnsafe('DELETE FROM verification_tokens WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM refresh_tokens WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM user_roles WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM user_profiles WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM users WHERE id = $1', id);
  }
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
  await cleanupInvitee();
});

afterAll(async () => {
  await cleanupInvitee();
  await app?.close();
});

describe('inviting a user', () => {
  let inviteUrl: string;

  it('is refused without users:manage', async () => {
    const res = await api(app)
      .post('/api/v1/users/invite')
      .set(auth(s.employee))
      .send({ email: EMAIL, firstName: 'Invi', lastName: 'Tee' });
    expect(res.status).toBe(403);
  });

  it('creates an INVITED account, audits it, and returns the link once', async () => {
    const res = await api(app)
      .post('/api/v1/users/invite')
      .set(auth(s.superAdmin))
      .send({ email: EMAIL, firstName: 'Invi', lastName: 'Tee', roleKeys: ['EMPLOYEE'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.inviteUrl).toContain('/accept-invite?token=');
    inviteUrl = res.body.data.inviteUrl;

    const user = await prisma.client.user.findFirst({
      where: { companyId, email: EMAIL },
      select: { status: true, emailVerifiedAt: true, roles: { select: { role: { select: { key: true } } } } },
    });
    expect(user?.status).toBe('INVITED');
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.roles.map((r) => r.role.key)).toEqual(['EMPLOYEE']);

    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'USER_CREATED', actorId: s.superAdmin.user.id },
      orderBy: { createdAt: 'desc' },
      select: { newValues: true },
    });
    expect(JSON.stringify(audit?.newValues)).toContain('invited');
  });

  it('refuses a duplicate email', async () => {
    const res = await api(app)
      .post('/api/v1/users/invite')
      .set(auth(s.superAdmin))
      .send({ email: EMAIL, firstName: 'Again', lastName: 'Again' });
    expect(res.status).toBe(409);
  });

  it('the invited account cannot sign in before accepting', async () => {
    const res = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect([400, 401, 403]).toContain(res.status);
  });

  it('rejects a weak password on accept', async () => {
    const token = new URL(inviteUrl).searchParams.get('token')!;
    const res = await api(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, password: 'short' });
    expect([400, 422]).toContain(res.status);
  });

  it('accepting sets the password, verifies the email and activates the account', async () => {
    const token = new URL(inviteUrl).searchParams.get('token')!;
    const res = await api(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    const user = await prisma.client.user.findFirst({
      where: { companyId, email: EMAIL },
      select: { status: true, emailVerifiedAt: true },
    });
    expect(user?.status).toBe('ACTIVE');
    expect(user?.emailVerifiedAt).not.toBeNull();

    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('the link never works twice', async () => {
    const token = new URL(inviteUrl).searchParams.get('token')!;
    const res = await api(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, password: 'Another!Pass2026x' });
    expect([400, 409, 422]).toContain(res.status);
  });

  it('refuses an unknown role and a foreign-tenant department', async () => {
    const badRole = await api(app)
      .post('/api/v1/users/invite')
      .set(auth(s.superAdmin))
      .send({ email: 'other@techpioasset.test', firstName: 'A', lastName: 'B', roleKeys: ['EMPLOYEE', 'NOT_A_ROLE'] });
    expect([400, 422]).toContain(badRole.status);

    const foreignDept = await prisma.client.department.findFirst({
      where: { companyId: { not: companyId } },
      select: { id: true },
    });
    if (foreignDept) {
      const res = await api(app)
        .post('/api/v1/users/invite')
        .set(auth(s.superAdmin))
        .send({ email: 'other@techpioasset.test', firstName: 'A', lastName: 'B', departmentId: foreignDept.id });
      expect(res.status).toBe(404);
    }
  });
});
