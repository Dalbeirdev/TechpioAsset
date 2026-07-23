import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * SSO is optional and disabled in the test environment (no ENTRA_* config), so
 * these prove the endpoints are wired and correctly gated: they advertise as
 * disabled and refuse to start a flow, rather than half-working or 500ing.
 */

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('SSO availability and gating (spec: optional Entra ID SSO)', () => {
  it('reports SSO as disabled when no Entra credentials are configured', async () => {
    const res = await api(app).get('/api/v1/auth/sso/available');
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.provider).toBe('disabled');
  });

  it('is a public endpoint (no auth required)', async () => {
    // No Authorization header — still 200, because a login page must read it
    // before anyone has signed in.
    const res = await api(app).get('/api/v1/auth/sso/available');
    expect(res.status).toBe(200);
  });

  it('404s the start endpoint while SSO is disabled', async () => {
    const res = await api(app).get('/api/v1/auth/sso/entra');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('refuses the callback while SSO is disabled', async () => {
    const res = await api(app).get('/api/v1/auth/sso/entra/callback?code=x&state=y');
    // NOT_FOUND (disabled) rather than attempting an exchange.
    expect(res.status).toBe(404);
  });
});
