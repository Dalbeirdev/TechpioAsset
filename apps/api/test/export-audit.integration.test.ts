import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReportRunnerService } from '../src/scheduled/report-runner.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.7 R2 — closing AUD-009: data leaving the system leaves a trail. Every
 * export path (report download, asset CSV, scheduled send) writes a
 * REPORT_EXPORTED row naming the actor, the report, the format and the size.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let runner: ReportRunnerService;

const run = Date.now() % 1_000_000;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  runner = app.get(ReportRunnerService);
});

afterAll(async () => {
  await prisma.client.scheduledReport.deleteMany({ where: { name: { contains: `EXPAUD-${run}` } } });
  await app?.close();
});

/**
 * Export rows in a window. Scoped by actor as well as time: the suite shares a
 * database with the scheduled-report runner exercised elsewhere, whose
 * deliveries are legitimate REPORT_EXPORTED rows by other actors - a
 * time-only filter would make the "no row" assertions flaky for the wrong
 * reason.
 */
const exportsSince = (since: Date, actorId: string, entityId?: string) =>
  prisma.client.auditLog.findMany({
    where: {
      action: 'REPORT_EXPORTED',
      createdAt: { gte: since },
      actorId,
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

describe('manual downloads', () => {
  it('a CSV report download is audited with actor, type, format and row count', async () => {
    const since = new Date();
    const res = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY&format=CSV')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');

    const rows = await exportsSince(since, s.superAdmin.user.id, 'ASSET_INVENTORY');
    expect(rows).toHaveLength(1);
    const values = rows[0]!.newValues as Record<string, unknown>;
    expect(values.format).toBe('CSV');
    expect(values.delivery).toBe('DOWNLOAD');
    expect(Number(values.rows)).toBeGreaterThan(0);
  });

  it('an Excel export of a FINANCIAL report is audited too - the one that matters most', async () => {
    const since = new Date();
    const res = await api(app)
      .get('/api/v1/reports?type=SPENDING_BY_CATEGORY&format=XLSX')
      .set(auth(s.finance));
    expect(res.status).toBe(200);

    const rows = await exportsSince(since, s.finance.user.id, 'SPENDING_BY_CATEGORY');
    expect(rows).toHaveLength(1);
    expect((rows[0]!.newValues as Record<string, unknown>).format).toBe('XLSX');
  });

  it('viewing a report as JSON is NOT an export - no row, no noise', async () => {
    const since = new Date();
    const res = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(await exportsSince(since, s.superAdmin.user.id)).toHaveLength(0);
  });

  it('a REFUSED export writes no row - only data that actually left is recorded', async () => {
    const since = new Date();
    // A Manager may READ reports but holds no reports:export grant. (The
    // Auditor deliberately does hold it: exporting reads nothing it could not
    // already see, and an auditor who cannot take evidence away is useless.)
    const res = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY&format=CSV')
      .set(auth(s.manager));
    expect(res.status).toBe(403);
    expect(await exportsSince(since, s.manager.user.id)).toHaveLength(0);
  });

  it('the asset CSV export is audited', async () => {
    const since = new Date();
    const res = await api(app).get('/api/v1/assets/export?pageSize=5').set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    const rows = await exportsSince(since, s.itAdmin.user.id, 'ASSET_CSV');
    expect(rows).toHaveLength(1);
  });
});

describe('scheduled sends', () => {
  it('a scheduled delivery is audited against its owner with the schedule id', async () => {
    const created = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.finance))
      .send({
        name: `EXPAUD-${run} weekly inventory`,
        type: 'ASSET_INVENTORY',
        format: 'CSV',
        cron: '0 8 * * 1',
        recipients: ['exports@techpioasset.dev'],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    await prisma.client.scheduledReport.update({
      where: { id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    const since = new Date();
    const summary = await runner.runDueReports();
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);

    const rows = await exportsSince(since, s.finance.user.id, 'ASSET_INVENTORY');
    const mine = rows.find(
      (r) => (r.newValues as Record<string, unknown>).scheduleId === id,
    );
    expect(mine).toBeTruthy();
    const values = mine!.newValues as Record<string, unknown>;
    // (actor is the owner by construction of the query scope above)
    expect(values.delivery).toBe('SCHEDULED');
    expect(values.recipients).toBe(1);
  });
});

describe('the audit log surfaces it', () => {
  it('REPORT_EXPORTED is filterable through the audit API', async () => {
    const res = await api(app)
      .get('/api/v1/audit?action=REPORT_EXPORTED&pageSize=5')
      .set(auth(s.auditor));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r: { action: string }) => r.action === 'REPORT_EXPORTED')).toBe(true);
  });
});
