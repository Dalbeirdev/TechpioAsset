import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.11 — profile fields finally have an editor, and the editor has edges.
 *
 * Until this change NOBODY could set job title, department or office — not the
 * user, not an admin. The fields existed and rendered dashes forever.
 *
 * The line these tests hold: self-service stops where access begins. Department
 * feeds the DEPARTMENT data scope, so a user who could move their own
 * department could choose whose assets they see.
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

describe('editing your own profile', () => {
  it('updates name, phone and job title, and the change is audited', async () => {
    const res = await api(app)
      .patch('/api/v1/users/me/profile')
      .set(auth(s.employee))
      .send({ jobTitle: 'Field Engineer', phone: '+91 98765 43210' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const profile = await prisma.client.userProfile.findUnique({
      where: { userId: s.employee.user.id },
      select: { jobTitle: true, phone: true },
    });
    expect(profile?.jobTitle).toBe('Field Engineer');
    expect(profile?.phone).toBe('+91 98765 43210');

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        companyId,
        action: 'USER_UPDATED',
        entityId: s.employee.user.id,
        actorId: s.employee.user.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { newValues: true },
    });
    expect(JSON.stringify(audit?.newValues)).toContain('own profile');
  });

  it('refuses to move your own department or office - that would move your data scope', async () => {
    const department = await prisma.client.department.findFirst({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    const res = await api(app)
      .patch('/api/v1/users/me/profile')
      .set(auth(s.employee))
      .send({ departmentId: department?.id ?? 'any' });
    // Rejected by the contract before the service is even reached.
    expect([400, 403, 422]).toContain(res.status);

    const stillThere = await prisma.client.userProfile.findUnique({
      where: { userId: s.employee.user.id },
      select: { departmentId: true },
    });
    // Whatever it was before, this request did not set it to our value.
    expect(stillThere?.departmentId ?? null).not.toBe('any');
  });

  it('needs no special permission - every signed-in user owns their own card', async () => {
    const res = await api(app)
      .patch('/api/v1/users/me/profile')
      .set(auth(s.auditor))
      .send({ phone: '+91 11111 11111' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe('an administrator editing someone else', () => {
  it('can place a user in a department and office', async () => {
    const [department, office] = await Promise.all([
      prisma.client.department.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
      prisma.client.office.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
    ]);
    const res = await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/profile`)
      .set(auth(s.superAdmin))
      .send({ departmentId: department!.id, officeId: office!.id, jobTitle: 'Desk-side Support' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const profile = await prisma.client.userProfile.findUnique({
      where: { userId: s.employee2.user.id },
      select: { departmentId: true, officeId: true, jobTitle: true },
    });
    expect(profile?.departmentId).toBe(department!.id);
    expect(profile?.officeId).toBe(office!.id);
    expect(profile?.jobTitle).toBe('Desk-side Support');
  });

  it('is refused without users:manage', async () => {
    const res = await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/profile`)
      .set(auth(s.employee))
      .send({ jobTitle: 'Chief Prankster' });
    expect(res.status).toBe(403);
  });

  it('refuses a department from another tenant', async () => {
    const foreign = await prisma.client.department.findFirst({
      where: { companyId: { not: companyId } },
      select: { id: true },
    });
    const res = await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/profile`)
      .set(auth(s.superAdmin))
      .send({ departmentId: foreign?.id ?? 'no-such-department' });
    expect(res.status).toBe(404);
  });
});
