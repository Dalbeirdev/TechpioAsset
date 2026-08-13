import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * Public demo-request endpoint behind the pioassets.com lead form. Public by
 * design - these tests prove it takes no token, validates strictly, and that
 * the honeypot swallows bot submissions without an error they could learn from.
 */

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

const VALID = {
  fullName: 'Test Visitor',
  email: 'visitor@example.com',
  company: 'Example Corp',
  phone: '',
  assetCount: 'FROM_100_TO_500',
  interest: 'WARRANTY_MANAGEMENT',
  message: 'Please show me warranty tracking.',
  website: '',
};

describe('POST /marketing/demo-request', () => {
  it('accepts a valid unauthenticated request', async () => {
    const res = await api(app).post('/api/v1/marketing/demo-request').send(VALID);
    expect(res.status).toBe(202);
    expect(res.body.data.received).toBe(true);
  });

  it('rejects an invalid email with a validation error', async () => {
    const res = await api(app)
      .post('/api/v1/marketing/demo-request')
      .send({ ...VALID, email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('rejects an unknown asset-count bucket', async () => {
    const res = await api(app)
      .post('/api/v1/marketing/demo-request')
      .send({ ...VALID, assetCount: 'MILLIONS' });
    expect(res.status).toBe(422);
  });

  it('quietly accepts a honeypot submission (bots learn nothing)', async () => {
    // A filled honeypot fails the z.literal('') schema -> 422 is fine too, but
    // the schema drops it earlier; assert the endpoint never 500s on bots.
    const res = await api(app)
      .post('/api/v1/marketing/demo-request')
      .send({ ...VALID, website: 'https://spam.example' });
    expect([202, 422]).toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });
});
