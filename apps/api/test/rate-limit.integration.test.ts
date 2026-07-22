import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, api, auth, createTestApp, login, type Session } from './harness.js';

/**
 * Rate limiting (spec section 20).
 *
 * Lives in its own file so it gets a fresh application instance, and therefore
 * fresh in-memory throttle counters. Deliberately tripping the limit inside the
 * permission suite would poison every test that ran after it.
 */

let app: INestApplication;
let session: Session;

beforeAll(async () => {
  app = await createTestApp();
  session = await login(app, ACCOUNTS.superAdmin);
});

afterAll(async () => {
  await app?.close();
});

describe('throttling', () => {
  it('returns 429 once the global limit is exceeded', async () => {
    const limit = Number(process.env.RATE_LIMIT_MAX ?? 120);
    let sawTooMany = false;
    let firstRejectionAt = 0;

    // One request beyond the configured window, sequentially so the count is
    // deterministic rather than dependent on connection concurrency.
    for (let attempt = 1; attempt <= limit + 5; attempt += 1) {
      const response = await api(app).get('/api/v1/auth/me').set(auth(session));
      if (response.status === 429) {
        sawTooMany = true;
        firstRejectionAt = attempt;
        break;
      }
    }

    expect(sawTooMany, `no 429 after ${limit + 5} requests`).toBe(true);
    // Rejecting far too early would mean the limit is misconfigured in a way
    // that would break normal use.
    expect(firstRejectionAt).toBeGreaterThan(limit / 2);
  });

  it('reports the rejection as a catalogued RATE_LIMITED problem document', async () => {
    const response = await api(app).get('/api/v1/auth/me').set(auth(session));
    expect(response.status).toBe(429);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.body.requestId).toMatch(/^req_/);
  });
});
