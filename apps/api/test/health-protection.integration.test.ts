import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * v2.8 S6 — "is this deployment actually protected?", answerable from outside
 * without credentials.
 *
 * It exists because the honest answer has twice been "less than you think":
 * RLS sat installed-but-dormant for six releases, and every backup lived on
 * the machine it was protecting. Neither was visible from anywhere, so nobody
 * was reminded. Now the probe says so out loud.
 */

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('the readiness probe reports the protection posture', () => {
  it('says plainly that RLS is not enforcing in this configuration', async () => {
    const res = await api(app).get('/health/ready');
    expect(res.status).toBe(200);

    const protection = res.body.data.protection;
    expect(protection).toBeTruthy();
    // This lane runs without RLS_ENFORCE, and the probe does not pretend otherwise.
    expect(protection.rlsEnforced).toBe(false);
    expect(protection.rlsDetail).toMatch(/application layer alone/i);
  });

  it('says plainly that the local copy is the only copy', async () => {
    const res = await api(app).get('/health/ready');
    const protection = res.body.data.protection;
    expect(protection.offsiteBackups).toBe('not-configured');
    expect(protection.lastOffsiteBackupAgeHours).toBeNull();
    expect(protection.offsiteDetail).toMatch(/only copy/i);
  });

  it('carries no tenant data - booleans, an age, and short explanations only', async () => {
    const res = await api(app).get('/health/ready');
    const serialised = JSON.stringify(res.body.data.protection);
    // The endpoint is unauthenticated, so this is a security property, not tidiness.
    for (const forbidden of ['companyId', 'email', '@', 'techpioasset_app', 'password']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(Object.keys(res.body.data.protection).sort()).toEqual(
      ['lastOffsiteBackupAgeHours', 'offsiteBackups', 'offsiteDetail', 'rlsDetail', 'rlsEnforced'].sort(),
    );
  });

  it('needs no credentials - an uptime monitor can read it', async () => {
    const res = await api(app).get('/health/ready'); // deliberately no Authorization header
    expect(res.status).toBe(200);
    expect(res.body.data.protection).toBeTruthy();
  });
});
