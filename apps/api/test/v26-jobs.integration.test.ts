import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { ReportRunnerService } from '../src/scheduled/report-runner.service.js';
import { WebhooksService } from '../src/integrations/webhooks.service.js';
import { createTestApp } from './harness.js';

/**
 * v2.6 A7 — the consolidated background-job set. Seven daily sweeps plus the
 * two 5-minute interval jobs (report runner, webhook retry) must each resolve
 * cleanly: a timer that dies midway silently starves everything after it.
 */

let app: INestApplication;
let sweep: AlertSweepService;
let runner: ReportRunnerService;
let webhooks: WebhooksService;

beforeAll(async () => {
  app = await createTestApp();
  sweep = app.get(AlertSweepService);
  runner = app.get(ReportRunnerService);
  webhooks = app.get(WebhooksService);
});

afterAll(async () => {
  await app?.close();
});

describe('the consolidated job set', () => {
  it('all seven daily sweeps resolve', async () => {
    await expect(sweep.runWarrantySweep()).resolves.toBeGreaterThanOrEqual(0);
    await expect(sweep.runApprovalEscalationSweep()).resolves.toBeGreaterThanOrEqual(0);
    await expect(sweep.runLicenseSweep()).resolves.toBeDefined();
    await expect(sweep.runStockSweep()).resolves.toBeDefined();
    await expect(sweep.runWorkOrderSweep()).resolves.toMatchObject({
      spawned: expect.any(Number),
      escalated: expect.any(Number),
    });
    await expect(sweep.runHealthSweep()).resolves.toBeGreaterThanOrEqual(0);
    await expect(sweep.runDiscoveryStalenessSweep()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('both v2.6 interval jobs resolve', async () => {
    await expect(runner.runDueReports()).resolves.toMatchObject({
      due: expect.any(Number),
      succeeded: expect.any(Number),
      failed: expect.any(Number),
    });
    await expect(webhooks.runRetrySweep()).resolves.toBeGreaterThanOrEqual(0);
  });
});
