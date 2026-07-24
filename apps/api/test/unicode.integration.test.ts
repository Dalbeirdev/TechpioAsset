import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * International text must round-trip. A WIN1252-encoded database (the Windows
 * initdb default) accepts ASCII but 500s on any multi-byte character, so an
 * accented name, a non-Latin script, or an emoji silently breaks record
 * creation. This test fails loudly if the database is ever not UTF-8.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let categoryId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
});

afterAll(async () => {
  await app?.close();
});

const SAMPLES = [
  ['accented Latin', 'José Müller — Läptöp'],
  ['non-Latin script', '日本語 ноутбук 노트북'],
  ['emoji', 'Laptop \u{1F680}\u{1F389}'],
];

describe('UTF-8 round-trip (guards against a non-UTF-8 database)', () => {
  it.each(SAMPLES)('stores and returns a %s name intact', async (_label, name) => {
    const tag = `UTF-${Math.random().toString(36).slice(2, 8)}`;
    const created = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({ assetTag: tag, name, categoryId, status: 'AVAILABLE', condition: 'GOOD' });

    // The bug this guards against surfaces here as a 500, not a validation 4xx.
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.name).toBe(name);

    const fetched = await api(app)
      .get(`/api/v1/assets/${created.body.data.id}`)
      .set(auth(s.itAdmin));
    expect(fetched.body.data.name).toBe(name);
  });
});
