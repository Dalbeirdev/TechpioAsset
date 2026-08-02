import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.6 A1 — the analytics engine. Invariant under test: spend never leaves the
 * server without assets:cost:read (403, not hidden fields), and empty ranges
 * report zeros/nulls, never invented trends.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

const base = '/api/v1/analytics';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

describe('access control', () => {
  it('an employee has no analytics at all', async () => {
    for (const path of ['overview', 'spend', 'licenses', 'procurement', 'work-orders', 'health']) {
      const res = await api(app).get(`${base}/${path}`).set(auth(s.employee));
      expect(res.status, path).toBe(403);
    }
  });

  it('the auditor reads analytics but spend is refused - cost visibility is a separate gate', async () => {
    const overview = await api(app).get(`${base}/overview`).set(auth(s.auditor));
    expect(overview.status).toBe(200);

    const spend = await api(app).get(`${base}/spend`).set(auth(s.auditor));
    expect(spend.status).toBe(403);
    expect(spend.body.detail ?? spend.body.title).toMatch(/cost/i);
  });

  it('finance holds both gates and gets the spend series', async () => {
    const res = await api(app).get(`${base}/spend?months=6`).set(auth(s.finance));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.months).toHaveLength(6);
    // Chronological, no gaps - empty months are zeroes, not omissions.
    const months = res.body.data.months.map((m: { month: string }) => m.month);
    expect([...months].sort()).toEqual(months);
    for (const m of res.body.data.months) {
      expect(typeof m.assetSpend).toBe('number');
      expect(typeof m.maintenanceSpend).toBe('number');
    }
  });
});

describe('aggregate shapes over the seeded tenant', () => {
  it('overview reports the fleet honestly', async () => {
    const res = await api(app).get(`${base}/overview`).set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const { totals, assetsByStatus, discoveryCoveragePct } = res.body.data;
    expect(totals.assets).toBeGreaterThan(0);
    expect(totals.activeUsers).toBeGreaterThan(0);
    // The by-status sum equals the total - no double counting.
    const sum = Object.values(assetsByStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(totals.assets);
    // Coverage is a percentage or null, never NaN.
    expect(discoveryCoveragePct === null || (discoveryCoveragePct >= 0 && discoveryCoveragePct <= 100)).toBe(true);
  });

  it('license utilization is per-license with a complete runway histogram', async () => {
    const res = await api(app).get(`${base}/licenses`).set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const { licenses, runway } = res.body.data;
    expect(Object.keys(runway).sort()).toEqual(
      ['beyond', 'expired', 'perpetual', 'within30', 'within60', 'within90'].sort(),
    );
    // Every license lands in exactly one runway bucket.
    const bucketSum = Object.values(runway as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(bucketSum).toBe(licenses.length);
    for (const l of licenses) {
      expect(l.utilizationPct === null || (l.utilizationPct >= 0 && l.utilizationPct <= 100)).toBe(
        true,
      );
    }
  });

  it('procurement cycles report nulls (not fake zeros) when a range has no data', async () => {
    const res = await api(app).get(`${base}/procurement?months=1`).set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const { approvalCycle, fulfilmentCycle } = res.body.data;
    for (const cycle of [approvalCycle, fulfilmentCycle]) {
      expect(cycle.count).toBeGreaterThanOrEqual(0);
      if (cycle.count === 0) {
        expect(cycle.avgDays).toBeNull();
        expect(cycle.medianDays).toBeNull();
      } else {
        expect(typeof cycle.avgDays).toBe('number');
      }
    }
  });

  it('work-order analytics carry the full aging histogram and a sane breach rate', async () => {
    const res = await api(app).get(`${base}/work-orders?months=3`).set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const { months, openAging, slaBreachRatePct } = res.body.data;
    expect(months).toHaveLength(3);
    expect(Object.keys(openAging).sort()).toEqual(['0-7', '31-90', '8-30', '90+'].sort());
    expect(
      slaBreachRatePct === null || (slaBreachRatePct >= 0 && slaBreachRatePct <= 100),
    ).toBe(true);
  });

  it('health analytics agree with the overview on coverage', async () => {
    const [health, overview] = await Promise.all([
      api(app).get(`${base}/health`).set(auth(s.superAdmin)),
      api(app).get(`${base}/overview`).set(auth(s.superAdmin)),
    ]);
    expect(health.status).toBe(200);
    expect(health.body.data.discoveryCoveragePct).toBe(overview.body.data.discoveryCoveragePct);
    expect(health.body.data.cappedCount).toBeGreaterThanOrEqual(0);
    expect(health.body.data.staleCount).toBeGreaterThanOrEqual(0);
  });
});
