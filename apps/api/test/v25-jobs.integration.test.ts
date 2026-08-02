import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.5 H7 — the consolidated daily jobs. The three v2.5 sweeps (work orders,
 * health, discovery staleness) run alongside the earlier four; staleness WARNS
 * on machines reported >30 days ago and never touches the data.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweep: AlertSweepService;
let staleAssetId: string;
let freshAssetId: string;

const run = Date.now() % 1_000_000;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);

  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;

  for (const [key, name] of [
    ['stale', 'Staleness sweep stale rig'],
    ['fresh', 'Staleness sweep fresh rig'],
  ] as const) {
    const res = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.superAdmin))
      .send({ assetTag: `STALE-${run}-${key}`, name, categoryId, status: 'AVAILABLE' });
    expect(res.status).toBe(201);
    if (key === 'stale') staleAssetId = res.body.data.id;
    else freshAssetId = res.body.data.id;
  }

  const companyId = s.superAdmin.user.companyId;
  await prisma.client.hardwareProfile.create({
    data: {
      companyId,
      assetId: staleAssetId,
      manufacturer: 'Dell',
      source: 'AGENT',
      lastDiscoveredAt: new Date(Date.now() - 45 * 86_400_000), // 45 days silent
    },
  });
  await prisma.client.hardwareProfile.create({
    data: { companyId, assetId: freshAssetId, manufacturer: 'HP', source: 'AGENT' },
  });
});

afterAll(async () => {
  const ids = [staleAssetId, freshAssetId];
  await prisma.client.hardwareProfile.deleteMany({ where: { assetId: { in: ids } } });
  await prisma.client.assetHealth.deleteMany({ where: { assetId: { in: ids } } });
  for (const id of ids) await prisma.client.asset.delete({ where: { id } }).catch(() => undefined);
  await app?.close();
});

describe('discovery staleness sweep', () => {
  it('counts machines silent for >30 days and mutates nothing', async () => {
    const before = await prisma.client.hardwareProfile.findUnique({
      where: { assetId: staleAssetId },
    });
    const staleCount = await sweep.runDiscoveryStalenessSweep();
    expect(staleCount).toBeGreaterThanOrEqual(1);

    // WARN only: the profile is untouched — no fabricated freshness.
    const after = await prisma.client.hardwareProfile.findUnique({
      where: { assetId: staleAssetId },
    });
    expect(after!.lastDiscoveredAt.getTime()).toBe(before!.lastDiscoveredAt.getTime());
  });

  it('a freshly-reported machine is not flagged', async () => {
    // Isolate: only our stale fixture should differ between these two runs.
    const withStale = await sweep.runDiscoveryStalenessSweep();
    await prisma.client.hardwareProfile.update({
      where: { assetId: staleAssetId },
      data: { lastDiscoveredAt: new Date() },
    });
    const withoutStale = await sweep.runDiscoveryStalenessSweep();
    expect(withStale - withoutStale).toBe(1);
  });
});

describe('the consolidated daily set', () => {
  it('every v2.5 sweep runs cleanly end to end', async () => {
    // Each returns rather than throws — the daily timer must never die midway.
    await expect(sweep.runWorkOrderSweep()).resolves.toMatchObject({
      spawned: expect.any(Number),
      escalated: expect.any(Number),
    });
    await expect(sweep.runHealthSweep()).resolves.toBeGreaterThanOrEqual(0);
    await expect(sweep.runDiscoveryStalenessSweep()).resolves.toBeGreaterThanOrEqual(0);
  });
});
