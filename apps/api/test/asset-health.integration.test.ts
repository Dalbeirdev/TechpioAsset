import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.5 H4 — health computation and the extended asset payload. Invariant:
 * health is DERIVED — recomputed when discovery applies data, cached with a
 * computedAt, and NEVER fabricated for machines discovery knows nothing about.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweep: AlertSweepService;
let categoryId: string;
let healthyAssetId: string;
let bareAssetId: string;

const run = Date.now() % 1_000_000;
const SERIAL = `HLTH-SN-${run}`;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);

  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;

  const healthy = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.superAdmin))
    .send({
      assetTag: `HLTH-${run}-1`,
      name: 'Health test laptop',
      categoryId,
      status: 'AVAILABLE',
      serialNumber: SERIAL,
      warrantyEndDate: new Date(Date.now() + 400 * 86_400_000).toISOString(),
    });
  expect(healthy.status, JSON.stringify(healthy.body)).toBe(201);
  healthyAssetId = healthy.body.data.id;

  const bare = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.superAdmin))
    .send({ assetTag: `HLTH-${run}-2`, name: 'Undiscovered desk', categoryId, status: 'AVAILABLE' });
  bareAssetId = bare.body.data.id;
});

afterAll(async () => {
  const ids = [healthyAssetId, bareAssetId];
  await prisma.client.discoveredDevice.deleteMany({
    where: { serialNumber: { contains: `HLTH-SN-${run}`, mode: 'insensitive' } },
  });
  await prisma.client.assetHealth.deleteMany({ where: { assetId: { in: ids } } });
  await prisma.client.installedSoftware.deleteMany({ where: { assetId: { in: ids } } });
  await prisma.client.hardwareProfile.deleteMany({ where: { assetId: { in: ids } } });
  await prisma.client.operatingSystemInfo.deleteMany({ where: { assetId: { in: ids } } });
  for (const id of ids) await prisma.client.asset.delete({ where: { id } }).catch(() => undefined);
  await app?.close();
});

const pristineDevice = {
  externalId: `hlth-${run}`,
  serialNumber: SERIAL,
  hardware: {
    manufacturer: 'Dell',
    ramGb: 16,
    storageTotalGb: 512,
    storageFreeGb: 210,
    smartStatus: 'HEALTHY',
    batteryHealthPct: 95,
    batteryCycleCount: 100,
  },
  os: {
    osName: 'Windows 11 Pro',
    osSupported: true,
    osActivated: true,
    diskEncrypted: true,
    defenderEnabled: true,
    firewallEnabled: true,
    tpmPresent: true,
    localAdminCount: 1,
    missingCriticalPatches: 0,
  },
  software: [
    { name: 'Google Chrome', version: '126.0' },
    { name: '7-Zip', version: '24.06' },
    { name: 'Mozilla Firefox', version: '128.0' },
  ],
};

describe('health from discovery', () => {
  it('a pristine ingest yields EXCELLENT 100 on the asset payload, with all six dimensions', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/ingest')
      .set(auth(s.itAdmin))
      .send({ devices: [pristineDevice] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.matched).toBe(1);

    const detail = await api(app).get(`/api/v1/assets/${healthyAssetId}`).set(auth(s.itAdmin));
    expect(detail.status).toBe(200);
    const { hardwareProfile, osInfo, health, _count } = detail.body.data;
    expect(hardwareProfile.manufacturer).toBe('Dell');
    expect(osInfo.diskEncrypted).toBe(true);
    expect(_count.installedSoftware).toBe(3);
    expect(health.overall).toBe(100);
    expect(health.grade).toBe('EXCELLENT');
    expect(health.capped).toBe(false);
    expect(health.subScores).toHaveLength(6); // battery/storage/memory/warranty/security/updates
    expect(health.recommendations).toHaveLength(0);
  });

  it('a failing disk re-ingest drags the score to the POOR ceiling (the capping rule, live)', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/ingest')
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            ...pristineDevice,
            hardware: { ...pristineDevice.hardware, smartStatus: 'FAILING' },
          },
        ],
      });
    expect(res.status).toBe(201);

    const detail = await api(app).get(`/api/v1/assets/${healthyAssetId}`).set(auth(s.itAdmin));
    const health = detail.body.data.health;
    expect(health.capped).toBe(true);
    expect(health.overall).toBe(59);
    expect(health.grade).toBe('POOR');
    expect(health.recommendations.join(' ')).toContain('Replace the drive');
  });

  it('an undiscovered asset has NO health - never a fabricated number', async () => {
    const detail = await api(app).get(`/api/v1/assets/${bareAssetId}`).set(auth(s.itAdmin));
    expect(detail.body.data.health).toBeNull();
    expect(detail.body.data.hardwareProfile).toBeNull();

    const recompute = await api(app)
      .post(`/api/v1/assets/${bareAssetId}/health/recompute`)
      .set(auth(s.superAdmin));
    expect(recompute.status).toBe(201);
    expect(recompute.body.data ?? null).toBeNull();
    expect(await prisma.client.assetHealth.findUnique({ where: { assetId: bareAssetId } })).toBeNull();
  });

  it('an employee cannot trigger recompute (assets:update gate)', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${healthyAssetId}/health/recompute`)
      .set(auth(s.employee));
    expect(res.status).toBe(403);
  });
});

describe('software inventory endpoint', () => {
  it('pages the discovered software alphabetically', async () => {
    const page1 = await api(app)
      .get(`/api/v1/assets/${healthyAssetId}/software?pageSize=2`)
      .set(auth(s.itAdmin));
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.data[0].name).toBe('7-Zip');
    expect(page1.body.meta.page.totalItems).toBe(3);

    const page2 = await api(app)
      .get(`/api/v1/assets/${healthyAssetId}/software?pageSize=2&page=2`)
      .set(auth(s.itAdmin));
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].name).toBe('Mozilla Firefox');
  });
});

describe('health sweep', () => {
  it('daily recompute refreshes computedAt across the fleet', async () => {
    const before = (await prisma.client.assetHealth.findUnique({
      where: { assetId: healthyAssetId },
    }))!;
    await new Promise((resolve) => setTimeout(resolve, 20));

    const count = await sweep.runHealthSweep();
    expect(count).toBeGreaterThanOrEqual(1);

    const after = (await prisma.client.assetHealth.findUnique({
      where: { assetId: healthyAssetId },
    }))!;
    expect(after.computedAt.getTime()).toBeGreaterThan(before.computedAt.getTime());
    expect(after.overall).toBe(59); // still the capped truth, not a reset
  });
});
