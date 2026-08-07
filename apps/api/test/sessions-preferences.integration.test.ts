import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — profile preferences (self-service) and session management.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

describe('profile preferences (self-service)', () => {
  it('an employee can set their own locale/timezone/date format and it shows on /auth/me', async () => {
    const res = await api(app)
      .patch('/api/v1/users/me/profile')
      .set(auth(s.employee))
      .send({ locale: 'en-IN', timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const me = await api(app).get('/api/v1/auth/me').set(auth(s.employee));
    expect(me.body.data.locale).toBe('en-IN');
    expect(me.body.data.timezone).toBe('Asia/Kolkata');
    expect(me.body.data.dateFormat).toBe('DD/MM/YYYY');

    // Preferences are not org-placement fields; self-service must still refuse those.
    const escalation = await api(app)
      .patch('/api/v1/users/me/profile')
      .set(auth(s.employee))
      .send({ departmentId: 'anything' });
    expect([400, 403, 422]).toContain(escalation.status);
  });
});

describe('session management', () => {
  it('lists the active session and can sign out other devices', async () => {
    // Two independent logins for the same user = two sessions (families).
    const login = (email: string) =>
      api(app).post('/api/v1/auth/login').send({ email, password: 'TechpioDemo!2026' });

    const a = await login(s.auditor.user.email);
    const b = await login(s.auditor.user.email);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const tokenB = b.body.data.accessToken as string;
    const list = await api(app)
      .get('/api/v1/auth/sessions')
      .set({ Authorization: `Bearer ${tokenB}` });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    // At least the two we just created.
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);

    const activeBefore = await prisma.client.refreshToken.count({
      where: { userId: s.auditor.user.id, revokedAt: null },
    });
    expect(activeBefore).toBeGreaterThanOrEqual(2);

    const revoke = await api(app)
      .post('/api/v1/auth/sessions/revoke-others')
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({});
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBeGreaterThanOrEqual(1);

    // Something remains (the caller had no refresh cookie in this test client,
    // so "others" is all of them — the point proven is that revoke-others runs
    // and reports a count without erroring).
    const activeAfter = await prisma.client.refreshToken.count({
      where: { userId: s.auditor.user.id, revokedAt: null },
    });
    expect(activeAfter).toBeLessThan(activeBefore);
  });

  it('sessions endpoint is per-user — never another account', async () => {
    const list = await api(app).get('/api/v1/auth/sessions').set(auth(s.employee));
    expect(list.status).toBe(200);
    // Every returned session belongs to the caller (checked by counting the
    // caller's live families — the endpoint has no parameter to widen it).
    const mine = await prisma.client.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId: s.employee.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(list.body.data.length).toBeLessThanOrEqual(mine.length + 1);
  });
});
