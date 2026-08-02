import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReportRunnerService } from '../src/scheduled/report-runner.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.6 A2 — the scheduled-report runner. Invariants under test: one run per
 * due tick (claim-then-run), reports built AS THE OWNER (permission truth at
 * run time), and outcomes recorded honestly — FAILURE says so and notifies.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let runner: ReportRunnerService;

const run = Date.now() % 1_000_000;
const MAIL_DIR = path.resolve(process.cwd(), '../../.local-mail');

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  runner = app.get(ReportRunnerService);
});

afterAll(async () => {
  await prisma.client.scheduledReport.deleteMany({
    where: { name: { contains: `RUNNER-${run}` } },
  });
  await app?.close();
});

async function makeDue(id: string) {
  await prisma.client.scheduledReport.update({
    where: { id },
    data: { nextRunAt: new Date(Date.now() - 60_000) },
  });
}

describe('the happy path', () => {
  it('runs a due report as its owner, mails the attachment, records SUCCESS and re-arms', async () => {
    const created = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.finance))
      .send({
        name: `RUNNER-${run} weekly spend`,
        type: 'SPENDING_BY_CATEGORY',
        format: 'CSV',
        cron: '0 8 * * 1',
        recipients: ['finance-reports@techpioasset.dev'],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    await makeDue(id);

    const summary = await runner.runDueReports();
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);

    const after = (await prisma.client.scheduledReport.findUnique({ where: { id } }))!;
    expect(after.lastRunStatus).toBe('SUCCESS');
    expect(after.lastRunAt).not.toBeNull();
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

    // The .eml is real and carries the attachment - verifiable end to end.
    const files = await readdir(MAIL_DIR);
    const mine = files.filter((f) => f.includes('finance_reports_techpioasset_dev'));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const newest = mine.sort().at(-1)!;
    const eml = await readFile(path.join(MAIL_DIR, newest), 'utf8');
    expect(eml).toContain('Content-Disposition: attachment');
    expect(eml).toContain('X-TechpioAsset-Simulated: true');

    const delivered = await prisma.client.notification.findFirst({
      where: { type: 'REPORT_DELIVERED', entityId: id, userId: s.finance.user.id },
    });
    expect(delivered).toBeTruthy();

    // Idempotent: the claim advanced nextRunAt, so a second tick finds nothing.
    const again = await runner.runDueReports();
    const stillMine = await prisma.client.scheduledReport.findUnique({ where: { id } });
    expect(stillMine!.lastRunAt!.getTime()).toBe(after.lastRunAt!.getTime());
    expect(again.due).toBeLessThanOrEqual(summary.due);
  });
});

describe('the honest failure path', () => {
  it('an owner without cost visibility gets a recorded FAILURE, not a report they cannot see', async () => {
    // Built directly: the employee could never create this via the API - which
    // is exactly why the runner must re-check permissions at run time.
    const schedule = await prisma.client.scheduledReport.create({
      data: {
        companyId: s.employee.user.companyId,
        ownerId: s.employee.user.id,
        name: `RUNNER-${run} forbidden spend`,
        resource: 'SPENDING_BY_VENDOR',
        format: 'CSV',
        cron: '0 8 * * 1',
        recipients: ['employee@techpioasset.dev'],
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });

    const summary = await runner.runDueReports();
    expect(summary.failed).toBeGreaterThanOrEqual(1);

    const after = (await prisma.client.scheduledReport.findUnique({
      where: { id: schedule.id },
    }))!;
    expect(after.lastRunStatus).toMatch(/^FAILURE:/);
    expect(after.lastRunStatus).toMatch(/financial|permitted/i);

    const failedNotif = await prisma.client.notification.findFirst({
      where: { type: 'REPORT_FAILED', entityId: schedule.id, userId: s.employee.user.id },
    });
    expect(failedNotif).toBeTruthy();
  });
});

describe('pause and resume', () => {
  it('a paused schedule never fires even when due; resuming re-arms from now', async () => {
    const created = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.superAdmin))
      .send({
        name: `RUNNER-${run} paused inventory`,
        type: 'ASSET_INVENTORY',
        format: 'CSV',
        cron: '0 8 * * 1',
        recipients: ['it@techpioasset.dev'],
      });
    const id = created.body.data.id;

    const paused = await api(app)
      .patch(`/api/v1/scheduled/reports/${id}`)
      .set(auth(s.superAdmin))
      .send({ isActive: false });
    expect(paused.status).toBe(200);
    await makeDue(id);

    await runner.runDueReports();
    const after = (await prisma.client.scheduledReport.findUnique({ where: { id } }))!;
    expect(after.lastRunAt).toBeNull(); // never ran

    const resumed = await api(app)
      .patch(`/api/v1/scheduled/reports/${id}`)
      .set(auth(s.superAdmin))
      .send({ isActive: true });
    expect(resumed.status).toBe(200);
    // Re-arming computes a FUTURE due date - the paused backlog must not fire.
    expect(new Date(resumed.body.data.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('an employee may not manage schedules', async () => {
    const res = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.employee))
      .send({
        name: `RUNNER-${run} rogue`,
        type: 'ASSET_INVENTORY',
        format: 'CSV',
        cron: '0 8 * * 1',
        recipients: ['x@y.dev'],
      });
    expect(res.status).toBe(403);
  });
});
