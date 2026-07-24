import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Money is shared across assets, invoices and maintenance and must reject
 * negatives — a negative price or total is always a data-entry error and
 * corrupts spend and depreciation figures.
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

function createAsset(purchaseCost: string) {
  const tag = `MONEY-${Math.random().toString(36).slice(2, 8)}`;
  // superAdmin holds cost visibility, so a price is allowed on create.
  return api(app)
    .post('/api/v1/assets')
    .set(auth(s.superAdmin))
    .send({ assetTag: tag, name: 'Money test', categoryId, status: 'AVAILABLE', purchaseCost });
}

describe('money validation', () => {
  it('rejects a negative purchase cost', async () => {
    const res = await createAsset('-500');
    expect(res.status).toBe(422);
  });

  it('accepts a valid positive cost', async () => {
    const res = await createAsset('500.00');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('rejects a negative on the dedicated price endpoint', async () => {
    const created = await createAsset('100.00');
    const res = await api(app)
      .patch(`/api/v1/assets/${created.body.data.id}/price`)
      .set(auth(s.finance))
      .send({ purchaseCost: '-1' });
    expect(res.status).toBe(422);
  });
});
