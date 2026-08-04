import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './harness.js';

/**
 * v2.10 S3 — how long the nightly jobs actually take, at volume.
 *
 * The read paths have `perf/load-probe.mjs`. The background jobs had nothing,
 * which is how `runStockSweep` came to reload every movement ever recorded once
 * per stock level. This runs the real services against whatever is in the
 * database, so with the load tenant present it measures the real cost.
 *
 * Manual lane — see `vitest.perf.config.ts`. It is not part of any automatic
 * run, and it writes its numbers to `perf/baselines/` so before and after can
 * be compared rather than remembered.
 */

let app: INestApplication;
let sweep: AlertSweepService;
let prisma: PrismaService;

/** The v2.10 acceptance criterion: the nightly pass finishes inside 5 minutes. */
const BUDGET_MS = 300_000;

beforeAll(async () => {
  app = await createTestApp();
  sweep = app.get(AlertSweepService);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

describe('nightly sweeps at volume', () => {
  it('runs each sweep, reports the cost, and stays inside the budget', async () => {
    const [counts] = await prisma.client.$queryRawUnsafe<{ levels: bigint; movements: bigint }[]>(
      `SELECT (SELECT count(*) FROM stock_levels) AS levels,
              (SELECT count(*) FROM stock_movements) AS movements`,
    );
    const levels = Number(counts!.levels);
    const movements = Number(counts!.movements);

    const runsMs: Record<string, number> = {};
    const time = async (name: string, fn: () => Promise<unknown>) => {
      const start = Date.now();
      const result = await fn();
      runsMs[name] = Date.now() - start;
      return result;
    };

    await time('stock', () => sweep.runStockSweep());
    await time('expiry', () => sweep.runExpirySweep());
    await time('warranty', () => sweep.runWarrantySweep());
    await time('licenses', () => sweep.runLicenseSweep());

    const totalMs = Object.values(runsMs).reduce((a, b) => a + b, 0);

    const label = process.env.PERF_LABEL ?? 'run';
    const lines = [
      '',
      `Sweep timing — ${levels.toLocaleString()} stock levels, ${movements.toLocaleString()} movements`,
      '',
      ...Object.entries(runsMs).map(
        ([name, msTaken]) => `  ${name.padEnd(12)} ${`${(msTaken / 1000).toFixed(2)}s`.padStart(9)}`,
      ),
      `  ${'TOTAL'.padEnd(12)} ${`${(totalMs / 1000).toFixed(2)}s`.padStart(9)}`,
      `  budget ${BUDGET_MS / 1000}s — ${totalMs < BUDGET_MS ? 'within' : 'OVER'}`,
      '',
    ];
    // eslint-disable-next-line no-console -- the printed table IS this lane's
    // output; console.warn would dress a measurement up as a problem.
    console.log(lines.join('\n'));

    const dir = path.resolve(import.meta.dirname, '../../../perf/baselines');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `sweeps-${label}.json`),
      `${JSON.stringify({ label, takenAt: new Date().toISOString(), levels, movements, runsMs, totalMs }, null, 2)}\n`,
    );

    // The measurement is the point, but the budget is the commitment.
    expect(totalMs).toBeLessThan(BUDGET_MS);
  });
});
