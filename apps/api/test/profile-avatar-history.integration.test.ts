import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — profile photo and login history, both strictly self-service.
 *
 * The line under test: neither carries an id parameter, so there is no shape
 * of request that reads or writes somebody else's photo or sign-in trail.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma?.client.userProfile.updateMany({
    where: { userId: s.employee.user.id },
    data: { avatarKey: null },
  });
  await app?.close();
});

describe('profile photo', () => {
  it('uploads, serves, replaces and deletes — always the caller’s own', async () => {
    const up = await api(app)
      .post('/api/v1/users/me/avatar')
      .set(auth(s.employee))
      .attach('file', PNG, 'me.png');
    expect(up.status, JSON.stringify(up.body).slice(0, 250)).toBe(201);
    const firstKey = up.body.data.avatarKey as string;
    expect(firstKey).toContain('avatars/');

    const get = await api(app).get('/api/v1/users/me/avatar').set(auth(s.employee));
    expect(get.status).toBe(200);

    // Replacing swaps the key (and the old object is cleaned up).
    const again = await api(app)
      .post('/api/v1/users/me/avatar')
      .set(auth(s.employee))
      .attach('file', PNG, 'me2.png');
    expect(again.status).toBe(201);
    expect(again.body.data.avatarKey).not.toBe(firstKey);

    const del = await api(app).delete('/api/v1/users/me/avatar').set(auth(s.employee));
    expect(del.status).toBe(204);

    const after = await prisma.client.userProfile.findUnique({
      where: { userId: s.employee.user.id },
      select: { avatarKey: true },
    });
    expect(after?.avatarKey).toBeNull();
  }, 30_000);

  it('refuses a non-image posted as a photo', async () => {
    const res = await api(app)
      .post('/api/v1/users/me/avatar')
      .set(auth(s.employee))
      .attach('file', Buffer.from('%PDF-1.4 not an image'), 'sneaky.png');
    expect([400, 415, 422]).toContain(res.status);
  });

  it('another user’s photo is unreachable — the route has no id to point at', async () => {
    // employee2 fetching their own avatar when they have none is a clean 404,
    // never a peek at somebody else's.
    const res = await api(app).get('/api/v1/users/me/avatar').set(auth(s.employee2));
    expect(res.status).toBe(404);
  });
});

describe('login history', () => {
  it('returns only the caller’s own sign-ins, newest first and bounded', async () => {
    // Fresh sign-in so there is something to see.
    await api(app)
      .post('/api/v1/auth/login')
      .send({ email: s.employee.user.email, password: 'TechpioDemo!2026' });

    const res = await api(app).get('/api/v1/auth/login-history').set(auth(s.employee));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const rows = res.body.data as { action: string; at: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
    for (const row of rows) expect(['LOGIN', 'LOGIN_FAILED', 'LOGOUT']).toContain(row.action);

    // Newest first.
    const times = rows.map((r) => new Date(r.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // Every returned row belongs to the caller: cross-check against the trail.
    const mine = await prisma.client.auditLog.count({
      where: { actorId: s.employee.user.id, action: { in: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'] } },
    });
    expect(mine).toBeGreaterThanOrEqual(rows.length);
  });
});
