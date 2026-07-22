import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * Health probes must stay reachable without credentials.
 *
 * Adding the global JwtAuthGuard silently put these behind authentication, which
 * would have broken every Compose healthcheck and uptime monitor while looking
 * perfectly healthy in local testing. This test exists so that cannot recur.
 */

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('health probes', () => {
  it('serves liveness without a token', async () => {
    const response = await api(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('serves readiness without a token', async () => {
    const response = await api(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.data.service).toBe('techpioasset-api');
  });

  it('reports postgres as up and critical', async () => {
    const response = await api(app).get('/health/ready');
    const postgres = response.body.data.dependencies.find(
      (d: { name: string }) => d.name === 'postgres',
    );
    expect(postgres.status).toBe('up');
    expect(postgres.critical).toBe(true);
  });

  it('marks mock providers as mocked rather than up', async () => {
    const response = await api(app).get('/health/ready');
    const names = response.body.data.dependencies
      .filter((d: { status: string }) => d.status === 'mocked')
      .map((d: { name: string }) => d.name);
    // Spec section 28: a simulated dependency is never presented as a real one.
    expect(names).toContain('ai');
    expect(names).toContain('storage');
  });

  it('does not leak tenant data through an unauthenticated probe', async () => {
    const response = await api(app).get('/health/ready');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('techpioasset.dev');
    expect(body).not.toMatch(/postgresql:\/\//);
  });
});
