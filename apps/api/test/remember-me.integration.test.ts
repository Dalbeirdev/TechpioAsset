import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * v2.24 - "keep me signed in", and what happens when it is off.
 *
 * Every sign-in used to set a 30-day cookie whether or not the machine belonged
 * to the person using it. Unchecking the box now issues a session cookie
 * instead, so closing the browser ends the session on a shared or borrowed
 * computer.
 *
 * The subtle half is the refresh. The token rotates on every refresh, so the
 * cookie is rewritten constantly - and a browser never tells the server how
 * long its own cookie was set for. Without the companion flag the second
 * refresh would silently restore a 30-day cookie and undo the choice, which is
 * the kind of bug nobody notices until a session outlives a browser it should
 * not have. These tests pin the lifetime across a refresh, in both directions,
 * and pin that a session predating the flag is left persistent rather than
 * demoted.
 */

const EMAIL = 'employee@techpioasset.dev';
const PASSWORD = 'TechpioDemo!2026';

let app: INestApplication;

/** Every Set-Cookie line for one cookie name. */
const cookieLines = (res: { headers: Record<string, unknown> }, name: string): string[] =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | undefined) ?? [])
    .filter((line) => line.startsWith(`${name}=`));

const refreshLine = (res: { headers: Record<string, unknown> }) =>
  cookieLines(res, 'techpioasset_refresh')[0] ?? '';

/** A cookie with no Max-Age/Expires dies with the browser. */
const isSessionCookie = (line: string) =>
  !/max-age=/i.test(line) && !/expires=/i.test(line.replace(/expires=thu, 01 jan 1970[^;]*/i, ''));

/** Both cookies as one header, the way a browser would send them back. */
const cookieHeader = (res: { headers: Record<string, unknown> }): string =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | undefined) ?? [])
    .map((line) => line.split(';')[0])
    .join('; ');

const login = (remember?: boolean) =>
  api(app)
    .post('/api/v1/auth/login')
    .send({ email: EMAIL, password: PASSWORD, ...(remember === undefined ? {} : { remember }) });

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('keep me signed in', () => {
  it('sets a persistent cookie when asked to be remembered', async () => {
    const res = await login(true);

    expect(res.status).toBe(200);
    expect(isSessionCookie(refreshLine(res))).toBe(false);
  });

  it('sets a session cookie when not', async () => {
    const res = await login(false);

    expect(res.status).toBe(200);
    // No Max-Age: the browser drops it on close, which is the entire feature.
    expect(isSessionCookie(refreshLine(res))).toBe(true);
  });

  it('defaults to remembering, so existing clients are unchanged', async () => {
    const res = await login();

    expect(isSessionCookie(refreshLine(res))).toBe(false);
  });

  it('keeps the session cookie a session cookie across a refresh', async () => {
    const signedIn = await login(false);

    const refreshed = await api(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(signedIn));

    expect(refreshed.status).toBe(200);
    // The rotation must not quietly promote it back to 30 days.
    expect(isSessionCookie(refreshLine(refreshed))).toBe(true);
  });

  it('keeps a remembered session persistent across a refresh', async () => {
    const signedIn = await login(true);

    const refreshed = await api(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(signedIn));

    expect(refreshed.status).toBe(200);
    expect(isSessionCookie(refreshLine(refreshed))).toBe(false);
  });

  it('leaves a session that predates the flag persistent', async () => {
    const signedIn = await login(true);
    // A browser signed in before this shipped holds the refresh cookie and no
    // flag beside it. Demoting it would sign those people out at the next
    // browser restart, for a choice they never made.
    const onlyRefresh = refreshLine(signedIn).split(';')[0];

    const refreshed = await api(app).post('/api/v1/auth/refresh').set('Cookie', onlyRefresh);

    expect(refreshed.status).toBe(200);
    expect(isSessionCookie(refreshLine(refreshed))).toBe(false);
  });

  it('signing in without it clears a flag left by an earlier sign-in', async () => {
    const forgetful = await login(false);

    const flag = cookieLines(forgetful, 'techpioasset_remember')[0] ?? '';
    expect(flag).toContain('techpioasset_remember=0');
    expect(isSessionCookie(flag)).toBe(true);
  });
});
