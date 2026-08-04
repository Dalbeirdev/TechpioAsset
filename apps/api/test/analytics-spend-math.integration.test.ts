import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.10 S4 — the arithmetic of spend, pinned before it moves.
 *
 * The monthly totals were computed by loading every matching asset and adding
 * them up in JavaScript. S4 moves that sum into SQL, which is only safe if the
 * ANSWER is unchanged — so these tests exist to fail if it is.
 *
 * The existing analytics suite proves who may see spend. Nothing proved what
 * the numbers were.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;
let categoryId: string;
let before: Record<string, number>;

/** Monthly asset spend, keyed by month, as the endpoint reports it. */
async function spendMonths(months: number): Promise<Record<string, number>> {
  const res = await api(app).get(`${base}/spend?months=${months}`).set(auth(s.finance));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return Object.fromEntries(
    (res.body.data.months as { month: string; assetSpend: number }[]).map((m) => [m.month, m.assetSpend]),
  );
}

const base = '/api/v1/analytics';
const run = Date.now() % 100_000;

/** A UTC month key n whole months before this one. */
function monthsAgo(n: number): { key: string; mid: Date; firstInstant: Date; lastInstant: Date } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  const key = d.toISOString().slice(0, 7);
  return {
    key,
    mid: new Date(`${key}-15T12:00:00.000Z`),
    firstInstant: new Date(`${key}-01T00:00:00.000Z`),
    lastInstant: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)),
  };
}

const thisMonth = monthsAgo(0);
const lastMonth = monthsAgo(1);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
  categoryId = (await prisma.client.category.findFirstOrThrow({ where: { companyId }, select: { id: true } })).id;

  // The demo tenant already owns costed assets, so absolute totals would be
  // asserting somebody else's data. Everything below is a DELTA against what
  // the endpoint reported before these rows existed.
  //
  // The baseline is read through a DIFFERENT window (6) from the assertions
  // (12) on purpose: the endpoint caches per company and window for 60s, so
  // reading the same window twice would compare a value against itself. A
  // month's total does not depend on how many months were asked for, which is
  // what makes the two comparable.
  before = await spendMonths(6);

  // Deliberately awkward values: a boundary instant at each end of a month, a
  // fractional cost, a row outside the window, and a soft-deleted row.
  const assets: [string, string, Date][] = [
    [`S4-A-${run}`, '100.25', thisMonth.mid],
    [`S4-B-${run}`, '200.50', thisMonth.firstInstant],
    [`S4-C-${run}`, '300.25', lastMonth.lastInstant],
    [`S4-D-${run}`, '999.99', monthsAgo(30).mid], // outside any sane window
  ];
  for (const [tag, cost, purchaseDate] of assets) {
    await prisma.client.asset.create({
      data: {
        companyId,
        assetTag: tag,
        name: tag,
        categoryId,
        qrToken: `qr-${tag}`,
        purchaseCost: cost,
        currency: 'USD',
        purchaseDate,
      },
    });
  }
  // A soft-deleted asset must not count towards spend.
  await prisma.client.asset.create({
    data: {
      companyId,
      assetTag: `S4-DEL-${run}`,
      name: `S4-DEL-${run}`,
      categoryId,
      qrToken: `qr-S4-DEL-${run}`,
      purchaseCost: '500.00',
      currency: 'USD',
      purchaseDate: thisMonth.mid,
      deletedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.client.asset.deleteMany({ where: { companyId, assetTag: { startsWith: `S4-` } } });
  await app?.close();
});

describe('spend arithmetic', () => {
  it('buckets by UTC month, to the cent, including both month boundaries', async () => {
    const after = await spendMonths(12);

    // 100.25 (mid-month) + 200.50 at the FIRST instant of the month — a row at
    // 00:00:00.000 on the 1st belongs to that month, not the one before.
    expect(after[thisMonth.key]! - (before[thisMonth.key] ?? 0)).toBeCloseTo(300.75, 2);
    // 300.25 at 23:59:59.999 on the last day belongs to the month it ends.
    expect(after[lastMonth.key]! - (before[lastMonth.key] ?? 0)).toBeCloseTo(300.25, 2);
  });

  it('excludes soft-deleted assets and anything outside the window', async () => {
    const after = await spendMonths(12);

    // The 500.00 soft-deleted row would otherwise have landed in this month;
    // the delta staying at 300.75 is what proves it did not.
    expect(after[thisMonth.key]! - (before[thisMonth.key] ?? 0)).toBeCloseTo(300.75, 2);

    // The 30-months-ago row cannot appear in a 12-month window at all.
    expect(Object.keys(after)).toHaveLength(12);
    expect(after[monthsAgo(30).key]).toBeUndefined();

    // And nothing outside our two months moved, across the months both windows
    // have in common.
    const movedMonths = Object.keys(before).filter(
      (k) => Math.abs((after[k] ?? 0) - before[k]!) > 0.005,
    );
    expect(movedMonths.sort()).toEqual([lastMonth.key, thisMonth.key].sort());
  });

  it('returns a bucket for every month in the window, zero-filled and in order', async () => {
    // A window nothing else has read, so this is not answered from the cache.
    const keys = Object.keys(await spendMonths(3));
    expect(keys).toHaveLength(3);
    // Oldest first, no gaps — an empty month reports zero rather than vanishing.
    expect([...keys].sort()).toEqual(keys);
  });

  it('still refuses without cost visibility', async () => {
    expect((await api(app).get(`${base}/spend`).set(auth(s.employee))).status).toBe(403);
  });
});
