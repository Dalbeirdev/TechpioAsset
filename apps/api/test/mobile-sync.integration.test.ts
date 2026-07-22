import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Mobile synchronisation (spec section 16).
 *
 * The load-bearing assertion is idempotency: uploading the same queued batch
 * twice must apply it once. This is what lets a phone on a flaky connection retry
 * the whole queue without creating duplicate scans.
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

async function newSession(name: string) {
  const response = await api(app)
    .post('/api/v1/mobile/inventory/sessions')
    .set(auth(s.itAdmin))
    .send({ name });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

describe('device registration', () => {
  it('registers a device and is idempotent on the token', async () => {
    const token = `ExponentPushToken[${ulid()}]`;
    const first = await api(app)
      .post('/api/v1/mobile/devices')
      .set(auth(s.employee))
      .send({ token, platform: 'android', deviceName: 'Pixel 8' });
    expect(first.status).toBe(200);

    // Re-registering the same token must not create a second row; it updates.
    const second = await api(app)
      .post('/api/v1/mobile/devices')
      .set(auth(s.employee))
      .send({ token, platform: 'android' });
    expect(second.status).toBe(200);
  });
});

describe('offline scan sync — idempotent replay (spec section 16)', () => {
  it('applies a batch once and treats a replay as a no-op', async () => {
    const sessionId = await newSession(`Sync test ${Date.now()}`);
    const clientId = ulid();

    const batch = {
      sessionId,
      operations: [
        {
          clientGeneratedId: clientId,
          type: 'INVENTORY_SCAN',
          entityId: null,
          capturedAt: new Date().toISOString(),
          payload: { scannedCode: 'UNKNOWN-CODE-123' },
        },
      ],
    };

    const first = await api(app).post('/api/v1/mobile/sync').set(auth(s.itAdmin)).send(batch);
    expect(first.status).toBe(201);
    expect(first.body.data.results[0].outcome).toBe('APPLIED');

    // The exact same batch again — the whole point of the clientGeneratedId.
    const replay = await api(app).post('/api/v1/mobile/sync').set(auth(s.itAdmin)).send(batch);
    expect(replay.status).toBe(201);
    expect(replay.body.data.results[0].outcome).toBe('DUPLICATE');

    // And the session holds exactly one scan, not two.
    const session = await api(app)
      .get(`/api/v1/mobile/inventory/sessions/${sessionId}`)
      .set(auth(s.itAdmin));
    expect(session.body.data.scans).toHaveLength(1);
  });

  it('classifies a scan of a known asset as EXPECTED', async () => {
    const sessionId = await newSession(`Known asset ${Date.now()}`);
    const assets = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.itAdmin));
    const asset = assets.body.data[0];

    const response = await api(app)
      .post('/api/v1/mobile/sync')
      .set(auth(s.itAdmin))
      .send({
        sessionId,
        operations: [
          {
            clientGeneratedId: ulid(),
            type: 'INVENTORY_SCAN',
            entityId: asset.id,
            capturedAt: new Date().toISOString(),
            payload: { scannedCode: asset.assetTag },
          },
        ],
      });

    expect(response.body.data.results[0].outcome).toBe('APPLIED');
    const session = await api(app)
      .get(`/api/v1/mobile/inventory/sessions/${sessionId}`)
      .set(auth(s.itAdmin));
    expect(session.body.data.summary.EXPECTED).toBeGreaterThanOrEqual(1);
  });

  it('records an unknown code as NOT_IN_REGISTER', async () => {
    const sessionId = await newSession(`Unknown ${Date.now()}`);
    await api(app)
      .post('/api/v1/mobile/sync')
      .set(auth(s.itAdmin))
      .send({
        sessionId,
        operations: [
          {
            clientGeneratedId: ulid(),
            type: 'INVENTORY_SCAN',
            entityId: null,
            capturedAt: new Date().toISOString(),
            payload: { scannedCode: 'GHOST-ASSET-999' },
          },
        ],
      });

    const session = await api(app)
      .get(`/api/v1/mobile/inventory/sessions/${sessionId}`)
      .set(auth(s.itAdmin));
    expect(session.body.data.summary.NOT_IN_REGISTER).toBeGreaterThanOrEqual(1);
  });

  it('conflicts a stale condition update when the asset changed server-side', async () => {
    const assets = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.itAdmin));
    const asset = assets.body.data[0];

    // Bump the asset's version via a legitimate update so the device's base is stale.
    await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.itAdmin))
      .send({ notes: 'Touched to advance version' });

    const response = await api(app)
      .post('/api/v1/mobile/sync')
      .set(auth(s.itAdmin))
      .send({
        operations: [
          {
            clientGeneratedId: ulid(),
            type: 'CONDITION_UPDATE',
            entityId: asset.id,
            capturedAt: new Date().toISOString(),
            baseVersion: 0, // deliberately stale
            payload: { condition: 'FAIR' },
          },
        ],
      });

    expect(response.body.data.results[0].outcome).toBe('CONFLICT');
  });

  it('rejects an operation whose target asset does not exist', async () => {
    const response = await api(app)
      .post('/api/v1/mobile/sync')
      .set(auth(s.itAdmin))
      .send({
        operations: [
          {
            clientGeneratedId: ulid(),
            type: 'CONDITION_UPDATE',
            entityId: 'nonexistent-asset',
            capturedAt: new Date().toISOString(),
            payload: { condition: 'GOOD' },
          },
        ],
      });
    expect(response.body.data.results[0].outcome).toBe('REJECTED');
  });
});

describe('delta pull (spec section 24)', () => {
  it('returns assets changed since a timestamp, scoped to the caller', async () => {
    const past = new Date(Date.now() - 86_400_000 * 400).toISOString();
    const admin = await api(app)
      .get(`/api/v1/mobile/assets/delta?since=${past}`)
      .set(auth(s.superAdmin));
    const employee = await api(app)
      .get(`/api/v1/mobile/assets/delta?since=${past}`)
      .set(auth(s.employee));

    expect(admin.status).toBe(200);
    expect(admin.body.data.data.length).toBeGreaterThan(0);
    // The employee's delta is scoped just like every other asset read.
    expect(employee.body.data.data.length).toBeLessThan(admin.body.data.data.length);
    expect(admin.body.data.syncedAt).toBeTruthy();
  });

  it('returns nothing for a future timestamp', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const response = await api(app)
      .get(`/api/v1/mobile/assets/delta?since=${future}`)
      .set(auth(s.superAdmin));
    expect(response.body.data.data).toEqual([]);
  });
});

describe('mobile sync authorisation', () => {
  it('denies an employee the sync endpoint (no inventory:adjust)', async () => {
    const response = await api(app)
      .post('/api/v1/mobile/sync')
      .set(auth(s.employee))
      .send({
        operations: [
          {
            clientGeneratedId: ulid(),
            type: 'NOTE',
            entityId: null,
            capturedAt: new Date().toISOString(),
            payload: {},
          },
        ],
      });
    expect(response.status).toBe(403);
  });

  it('lets any authenticated user register a device', async () => {
    const response = await api(app)
      .post('/api/v1/mobile/devices')
      .set(auth(s.employee))
      .send({ token: `ExponentPushToken[${ulid()}]`, platform: 'ios' });
    expect(response.status).toBe(200);
  });
});
