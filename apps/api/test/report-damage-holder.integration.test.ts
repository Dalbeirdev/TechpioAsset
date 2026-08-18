import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.23 - the person holding an asset may report it damaged.
 *
 * The mobile asset screen has offered "Report damage" since v2.x, but the route
 * required assets:update and no employee holds it, so the one button meant for
 * the person with the cracked screen answered 403 for exactly them.
 *
 * The exception is deliberately narrow, and these tests are mostly about what it
 * still refuses: only the current holder, only DAMAGED, and only while they
 * actually hold it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let categoryId: string;
let assetId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;

  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({ assetTag: `DMG-${suffix}`, name: `Damage test ${suffix}`, categoryId, status: 'AVAILABLE' });
  assetId = created.body.data.id;

  const assigned = await api(app)
    .post(`/api/v1/assets/${assetId}/assign`)
    .set(auth(s.itAdmin))
    .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
  expect(assigned.status, JSON.stringify(assigned.body)).toBeLessThan(300);
});

afterAll(async () => {
  await app?.close();
});

describe('reporting damage as the holder', () => {
  it('refuses a status the holder has no business setting', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/status`)
      .set(auth(s.employee))
      .send({ status: 'RETIRED', reason: 'Should not be allowed' });

    expect(res.status).toBe(403);
  });

  it('refuses someone who does not hold it', async () => {
    // employee2 has the same role as employee - what separates them here is
    // only that the asset is not in their name.
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/status`)
      .set(auth(s.employee2))
      .send({ status: 'DAMAGED', reason: 'Not mine to report' });

    expect(res.status).toBe(403);
  });

  it('lets the holder report their own asset damaged', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/status`)
      .set(auth(s.employee))
      .send({ status: 'DAMAGED', reason: 'Screen cracked' });

    expect(res.status).toBeLessThan(300);

    const after = await api(app).get(`/api/v1/assets/${assetId}`).set(auth(s.itAdmin));
    expect(after.body.data.status).toBe('DAMAGED');
  });

  it('still lets someone with assets:update change it freely', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'UNDER_REPAIR', reason: 'Sent to the workshop' });

    expect(res.status).toBeLessThan(300);
  });
});
