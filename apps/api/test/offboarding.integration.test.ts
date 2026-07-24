import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2 exit criterion: offboarding is blocked while an asset is unresolved.
 *
 * Spec section 13: "Offboarding cannot be marked fully completed until every
 * required asset has an outcome or approved exception."
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

// Completing an offboarding now deactivates the subject (employee3). Restore it
// so this shared account stays ACTIVE for the rest of the suite.
afterEach(async () => {
  await api(app)
    .patch(`/api/v1/users/${s.employee3.user.id}/status`)
    .set(auth(s.superAdmin))
    .send({ status: 'ACTIVE' });
});

/** Creates and assigns a fresh asset, so the test never fights shared seed stock. */
async function assignFreshAsset(toUserId: string, tagSuffix: string) {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');

  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `OFF-${tagSuffix}`,
      name: `Offboarding test laptop ${tagSuffix}`,
      categoryId: itCategory.id,
      serialNumber: `OFFSN-${tagSuffix}`,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const assigned = await api(app)
    .post(`/api/v1/assets/${created.body.data.id}/assign`)
    .set(auth(s.itAdmin))
    .send({ userId: toUserId, conditionOut: 'GOOD' });
  expect(assigned.status).toBe(201);

  return created.body.data;
}

describe('offboarding completion gate (spec section 13)', () => {
  it('refuses to complete while an asset is still in the employee’s custody', async () => {
    const suffix = `A${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    expect(started.status).toBe(201);

    const task = started.body.data;
    expect(task.direction).toBe('OFFBOARDING');
    // The snapshot names exactly what is outstanding.
    expect(
      task.outstandingAssets.some((a: { assetTag: string }) => a.assetTag === asset.assetTag),
    ).toBe(true);
    expect(task.canComplete).toBe(false);

    const blocked = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${task.id}/complete`)
      .set(auth(s.hr))
      .send({});

    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CONFLICT');
    // The message must say which assets, or the user cannot act on it.
    expect(blocked.body.detail).toContain(asset.assetTag);
  });

  it('completes once the asset is returned', async () => {
    const suffix = `B${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const taskId = started.body.data.id;

    const returned = await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    expect(returned.status).toBe(201);

    // Any other asset assigned to this employee by an earlier test would still
    // block, so resolve everything outstanding first.
    const refreshed = await api(app).get(`/api/v1/lifecycle/tasks/${taskId}`).set(auth(s.hr));
    for (const outstanding of refreshed.body.data.outstandingAssets) {
      await api(app)
        .post(`/api/v1/assets/${outstanding.assetId}/return`)
        .set(auth(s.itAdmin))
        .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    }

    const completed = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/complete`)
      .set(auth(s.hr))
      .send({});

    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.completedAt).toBeTruthy();

    // The leaver's account is disabled so they can no longer sign in.
    const subject = await api(app)
      .get(`/api/v1/users/${s.employee3.user.id}`)
      .set(auth(s.superAdmin));
    expect(subject.body.data.status).toBe('DEACTIVATED');
  });

  it('allows completion with a documented exception, and records who approved it', async () => {
    const suffix = `C${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const taskId = started.body.data.id;

    const completed = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/complete`)
      .set(auth(s.hr))
      .send({ exceptionReason: 'Laptop reported stolen; police report PR-2026-4471 filed.' });

    expect(completed.status).toBe(201);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.exceptionReason).toContain('PR-2026-4471');

    // Clean up so later runs start from a known state.
    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('rejects a token exception reason', async () => {
    const suffix = `D${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });

    const response = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/complete`)
      .set(auth(s.hr))
      .send({ exceptionReason: 'n/a' });

    // "Documented exception" has to mean something someone can be held to.
    expect(response.status).toBe(422);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('notifies the employee that equipment must be returned', async () => {
    const suffix = `E${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });

    const employee3 = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: 'employee3@techpioasset.dev', password: 'TechpioDemo!2026' });
    const token = employee3.body.data.accessToken;

    const notifications = await api(app)
      .get('/api/v1/notifications?pageSize=20')
      .set({ Authorization: `Bearer ${token}` });

    expect(
      notifications.body.data.some((n: { type: string }) => n.type === 'RETURN_REQUIRED'),
    ).toBe(true);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });
});

describe('offboarding authorisation', () => {
  it('refuses an employee starting an offboarding', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.employee))
      .send({ subjectUserId: s.employee2.user.id });
    expect(response.status).toBe(403);
  });

  it('refuses IT completing one (offboarding:manage is HR’s)', async () => {
    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee2.user.id });

    const response = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/complete`)
      .set(auth(s.itAdmin))
      .send({ exceptionReason: 'IT should not be able to sign this off at all.' });
    expect(response.status).toBe(403);
  });
});

describe('onboarding', () => {
  it('starts onboarding from a template and lists the required items', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/onboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee2.user.id, templateKey: 'engineer-standard' });

    // A second concurrent onboarding for the same person is a conflict, which is
    // the expected result on a re-run against a persistent database.
    expect([201, 409]).toContain(response.status);

    if (response.status === 201) {
      expect(response.body.data.direction).toBe('ONBOARDING');
      expect(response.body.data.template.key).toBe('engineer-standard');
      expect(Array.isArray(response.body.data.checklist)).toBe(true);
      expect(response.body.data.checklist.length).toBeGreaterThan(0);
    }
  });

  it('refuses an unknown template rather than silently creating an empty checklist', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/onboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee.user.id, templateKey: 'does-not-exist' });
    expect(response.status).toBe(404);
  });
});
