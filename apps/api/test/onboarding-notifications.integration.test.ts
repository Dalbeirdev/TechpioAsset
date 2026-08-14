import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.19 onboarding notifications: the invitation email goes through the
 * branded engine and lands in the email log, accepting an invite produces a
 * welcome email plus an admin-facing activation notification, role changes are
 * told to the person, the invitations board lists pending accounts, and the
 * nightly invite sweep sends staged reminders and a final expiry notice.
 */

let app: INestApplication;
let prisma: PrismaService;
let sweep: AlertSweepService;
let s: Record<AccountKey, Session>;
const createdUserIds: string[] = [];
const stamp = Math.random().toString(36).slice(2, 8);

async function pollEmailLog(where: Record<string, unknown>, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const row = await prisma.client.emailLog.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);
  s = await loginAll(app);
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await prisma.client.$executeRawUnsafe('DELETE FROM notifications WHERE "entityId" = $1 OR "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM email_logs WHERE "toUserId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM verification_tokens WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM refresh_tokens WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM audit_logs WHERE "actorId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM user_roles WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM user_profiles WHERE "userId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM users WHERE id = $1', id);
  }
  await prisma.client.$executeRawUnsafe(
    `DELETE FROM notification_rules WHERE type IN ('INVITE_REMINDER') AND "companyId" = $1`,
    s.superAdmin.user.companyId,
  );
  await app?.close();
});

async function inviteUser(email: string, firstName: string) {
  const res = await api(app)
    .post('/api/v1/users/invite')
    .set(auth(s.superAdmin))
    .send({ email, firstName, lastName: 'Onboarding', roleKeys: ['EMPLOYEE'] });
  expect(res.status).toBeLessThan(300);
  createdUserIds.push(res.body.data.id as string);
  return res.body.data as { id: string; email: string; inviteUrl: string };
}

describe('invitation email', () => {
  it('goes through the engine: branded USER_INVITED row in the email log', async () => {
    const email = `invitee-${stamp}-a@example.test`;
    const invited = await inviteUser(email, 'Ava');
    expect(invited.inviteUrl).toContain('/accept-invite?token=');

    const log = await pollEmailLog({ toUserId: invited.id, type: 'USER_INVITED' });
    expect(log).not.toBeNull();
    expect(log?.toEmail).toBe(email);
    expect(log?.subject).toContain('invited to PioAssets');
    expect(['SENT', 'SIMULATED']).toContain(log?.status);
  });

  it('lists the pending invitation on the invitations board (admins only)', async () => {
    const denied = await api(app).get('/api/v1/users/invitations').set(auth(s.employee));
    expect(denied.status).toBe(403);

    const res = await api(app).get('/api/v1/users/invitations').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { email: string }) => r.email === `invitee-${stamp}-a@example.test`);
    expect(row).toBeDefined();
    expect(row.status).toBe('PENDING');
    expect(row.reminders).toBe(0);
    expect(row.expiresAt).toBeTruthy();
  });
});

describe('accepting the invite', () => {
  it('welcomes the user and notifies admins of the activation', async () => {
    const email = `invitee-${stamp}-b@example.test`;
    const invited = await inviteUser(email, 'Ben');
    const token = new URL(invited.inviteUrl).searchParams.get('token')!;

    const before = await prisma.client.notification.count({
      where: { userId: s.hr.user.id, type: 'USER_ACTIVATED' },
    });

    const accept = await api(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, password: 'Onboard!2026xyz' });
    expect(accept.status).toBe(204);

    const welcome = await pollEmailLog({ toUserId: invited.id, type: 'USER_WELCOME' });
    expect(welcome).not.toBeNull();
    expect(welcome?.subject).toContain('Welcome to PioAssets');

    // HR holds a default USER_ACTIVATED audience role; poll for the in-app row.
    let after = before;
    for (let i = 0; i < 20 && after === before; i++) {
      await new Promise((r) => setTimeout(r, 250));
      after = await prisma.client.notification.count({
        where: { userId: s.hr.user.id, type: 'USER_ACTIVATED' },
      });
    }
    expect(after).toBe(before + 1);
  });
});

describe('role changes', () => {
  it('emails the person whose access changed', async () => {
    const email = `invitee-${stamp}-c@example.test`;
    const invited = await inviteUser(email, 'Cal');

    const res = await api(app)
      .patch(`/api/v1/users/${invited.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE', 'FINANCE'] });
    expect(res.status).toBeLessThan(300);

    const log = await pollEmailLog({ toUserId: invited.id, type: 'ROLE_CHANGED' });
    expect(log).not.toBeNull();
    expect(log?.subject).toContain('access has been updated');
  });
});

describe('password reset', () => {
  it('goes through the engine as a PASSWORD_RESET transactional', async () => {
    const res = await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: s.employee.user.email });
    expect(res.status).toBe(202);

    const log = await pollEmailLog({
      toUserId: s.employee.user.id,
      type: 'PASSWORD_RESET',
    });
    expect(log).not.toBeNull();
    expect(log?.subject).toContain('Reset your PioAssets password');
    // Test hygiene: the reset email must never appear as anyone else's.
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM email_logs WHERE "toUserId" = $1 AND type = $2::"NotificationType"',
      s.employee.user.id,
      'PASSWORD_RESET',
    );
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM verification_tokens WHERE "userId" = $1 AND purpose = $2::"VerificationPurpose"',
      s.employee.user.id,
      'PASSWORD_RESET',
    );
  });
});

describe('the invite sweep', () => {
  it('sends staged reminders and finally the expiry notice', async () => {
    const email = `invitee-${stamp}-d@example.test`;
    const invited = await inviteUser(email, 'Dee');

    // Fresh invite, day 0: nothing due yet.
    await sweep.runInviteSweep();
    let reminders = await prisma.client.emailLog.count({
      where: { toUserId: invited.id, type: 'INVITE_REMINDER' },
    });
    expect(reminders).toBe(0);

    // Backdate the invite two days: stage one (day 1) is due, exactly once.
    await prisma.client.user.update({
      where: { id: invited.id },
      data: { createdAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    await sweep.runInviteSweep();
    await sweep.runInviteSweep(); // idempotent within the same stage
    reminders = await prisma.client.emailLog.count({
      where: { toUserId: invited.id, type: 'INVITE_REMINDER', status: { not: 'FAILED' } },
    });
    expect(reminders).toBe(1);

    // A reminder issued a fresh live token; the board still says PENDING.
    const board = await api(app).get('/api/v1/users/invitations').set(auth(s.superAdmin));
    const row = board.body.data.find((r: { id: string }) => r.id === invited.id);
    expect(row.reminders).toBe(1);
    expect(row.status).toBe('PENDING');

    // Kill every live token and disable reminders: the sweep now declares the
    // invitation expired - once.
    await prisma.client.verificationToken.updateMany({
      where: { userId: invited.id, purpose: 'INVITE' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const save = await api(app)
      .patch('/api/v1/notifications/admin/rules/INVITE_REMINDER')
      .set(auth(s.superAdmin))
      .send({ enabled: false, notifyPrimary: true, recipientRoleKeys: [], ccRoleKeys: [], escalationRoleKeys: [], thresholds: [] });
    expect(save.status).toBe(200);

    await sweep.runInviteSweep();
    await sweep.runInviteSweep(); // expiry notice must not repeat
    const expired = await prisma.client.emailLog.count({
      where: { toUserId: invited.id, type: 'INVITE_EXPIRED' },
    });
    expect(expired).toBe(1);

    const boardAfter = await api(app).get('/api/v1/users/invitations').set(auth(s.superAdmin));
    const rowAfter = boardAfter.body.data.find((r: { id: string }) => r.id === invited.id);
    expect(rowAfter.status).toBe('EXPIRED');
  });
});
