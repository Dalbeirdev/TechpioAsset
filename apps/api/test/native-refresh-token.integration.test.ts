import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * v2.23 - a refresh token a phone can actually hold.
 *
 * The mobile app sends and expects the refresh token in an X-Refresh-Token
 * header, because a native client has no cookie jar. Nothing on the server read
 * or set that header: login returned only a Set-Cookie the phone discarded, and
 * refresh answered 401. Every session therefore ended the moment the access
 * token expired - which reads as "the app keeps signing me out", and was
 * invisible in the browser preview because a browser does have a cookie jar.
 *
 * The exposure is the reason the header is conditional: X-Refresh-Token is in
 * the CORS exposed list, so returning it to a browser would put a long-lived
 * credential within reach of any script on the page - the exact theft the
 * httpOnly cookie exists to prevent. These tests pin both halves.
 */

const EMAIL = 'employee@techpioasset.dev';
const PASSWORD = 'TechpioDemo!2026';

let app: INestApplication;

const loginNative = () =>
  api(app).post('/api/v1/auth/login').set('X-Client-Type', 'mobile').send({ email: EMAIL, password: PASSWORD });

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('refresh token for a native client', () => {
  it('hands the token back in a header the phone can read', async () => {
    const res = await loginNative();

    expect(res.status).toBe(200);
    expect(res.headers['x-refresh-token']).toBeTruthy();
  });

  it('refreshes with the header alone, and returns the rotated token', async () => {
    const login = await loginNative();

    const refreshed = await api(app)
      .post('/api/v1/auth/refresh')
      .set('X-Refresh-Token', login.headers['x-refresh-token']);

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    // The token rotates, so a client that never receives the new one is signed
    // out at its next attempt - which is the bug, one refresh later.
    expect(refreshed.headers['x-refresh-token']).toBeTruthy();
    expect(refreshed.headers['x-refresh-token']).not.toBe(login.headers['x-refresh-token']);
  });

  it('keeps this session alive when signing the other devices out', async () => {
    const mine = await loginNative();
    const other = await loginNative();

    await api(app)
      .post('/api/v1/auth/sessions/revoke-others')
      .set('Authorization', `Bearer ${mine.body.data.accessToken}`)
      .set('X-Refresh-Token', mine.headers['x-refresh-token']);

    const stillMine = await api(app)
      .post('/api/v1/auth/refresh')
      .set('X-Refresh-Token', mine.headers['x-refresh-token']);
    const revoked = await api(app)
      .post('/api/v1/auth/refresh')
      .set('X-Refresh-Token', other.headers['x-refresh-token']);

    expect(stillMine.status).toBe(200);
    expect(revoked.status).toBe(401);
  });

  it('marks which listed session is this device', async () => {
    const mine = await loginNative();

    const res = await api(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${mine.body.data.accessToken}`)
      .set('X-Refresh-Token', mine.headers['x-refresh-token']);

    expect(res.status).toBe(200);
    expect(res.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });
});

describe('refresh token for a browser', () => {
  it('never exposes the token to page scripts', async () => {
    // No X-Client-Type: this is what the web app sends.
    const res = await api(app).post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.headers['x-refresh-token']).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('still refreshes from the cookie', async () => {
    const login = await api(app).post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('techpioasset_refresh='),
    )!;

    const refreshed = await api(app).post('/api/v1/auth/refresh').set('Cookie', cookie);

    expect(refreshed.status).toBe(200);
    expect(refreshed.headers['x-refresh-token']).toBeUndefined();
  });
});
