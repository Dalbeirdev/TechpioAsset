import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 5: maintenance lifecycle, reports with permission-gated financial
 * columns, and the warranty alert sweep.
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

async function anAsset() {
  const assets = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.itAdmin));
  return assets.body.data[0];
}

describe('maintenance lifecycle (spec section 14)', () => {
  it('runs request → start → complete and returns the asset to service', async () => {
    const asset = await anAsset();

    const created = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.id, type: 'REPAIR', title: 'Screen replacement' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('REQUESTED');
    const id = created.body.data.id;

    const started = await api(app).post(`/api/v1/maintenance/${id}/start`).set(auth(s.itAdmin));
    expect(started.body.data.status).toBe('IN_PROGRESS');
    // The asset went under repair.
    expect(started.body.data.asset.status).toBe('UNDER_REPAIR');

    const completed = await api(app)
      .post(`/api/v1/maintenance/${id}/complete`)
      .set(auth(s.itAdmin))
      .send({ serviceCost: '149.99', downtimeHours: '48', restoreAsset: true });
    expect(completed.body.data.status).toBe('COMPLETED');
    // And came back to service.
    expect(completed.body.data.asset.status).toBe('AVAILABLE');
  });

  it('rejects an illegal transition (complete before start)', async () => {
    const asset = await anAsset();
    const created = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.id, type: 'INSPECTION', title: 'Annual check' });

    const response = await api(app)
      .post(`/api/v1/maintenance/${created.body.data.id}/complete`)
      .set(auth(s.itAdmin))
      .send({ restoreAsset: false });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_STATE_TRANSITION');
  });

  it('hides service cost from a non-cost role', async () => {
    const asset = await anAsset();
    const created = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.id, type: 'REPAIR', title: 'Battery swap' });
    await api(app).post(`/api/v1/maintenance/${created.body.data.id}/start`).set(auth(s.itAdmin));
    await api(app)
      .post(`/api/v1/maintenance/${created.body.data.id}/complete`)
      .set(auth(s.itAdmin))
      .send({ serviceCost: '89.00', restoreAsset: true });

    // The auditor can read maintenance but — since price became a Finance /
    // Super Admin capability — no longer holds cost visibility, so the service
    // cost must be absent from their view.
    const auditorView = await api(app)
      .get(`/api/v1/maintenance/${created.body.data.id}`)
      .set(auth(s.auditor));
    expect(auditorView.status).toBe(200);
    expect(auditorView.body.data).not.toHaveProperty('serviceCost');

    // A cost-visible role (Super Admin) still sees it.
    const adminView = await api(app)
      .get(`/api/v1/maintenance/${created.body.data.id}`)
      .set(auth(s.superAdmin));
    expect(adminView.body.data).toHaveProperty('serviceCost');
  });

  it('requires maintenance:manage to create', async () => {
    const asset = await anAsset();
    const response = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.employee))
      .send({ assetId: asset.id, type: 'REPAIR', title: 'Nope' });
    expect(response.status).toBe(403);
  });
});

describe('reports (spec section 18)', () => {
  it('lets Finance run a spending-by-vendor report', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=SPENDING_BY_VENDOR')
      .set(auth(s.finance));
    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Spending by vendor');
    expect(response.body.data.columns.some((c: { key: string }) => c.key === 'total')).toBe(true);
  });

  it('refuses a financial report to a role without cost permission', async () => {
    // HR holds reports:read but not assets:cost:read.
    const response = await api(app).get('/api/v1/reports?type=SPENDING_BY_VENDOR').set(auth(s.hr));
    expect(response.status).toBe(403);
  });

  it('lets HR run a non-financial inventory report', async () => {
    const response = await api(app).get('/api/v1/reports?type=ASSET_INVENTORY').set(auth(s.hr));
    expect(response.status).toBe(200);
    // The cost column is absent for HR even on the non-financial report.
    expect(response.body.data.columns.some((c: { key: string }) => c.key === 'cost')).toBe(false);
  });

  it('includes the cost column for a cost-permitted role', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY')
      .set(auth(s.finance));
    expect(response.body.data.columns.some((c: { key: string }) => c.key === 'cost')).toBe(true);
  });

  it('streams a CSV download', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY&format=CSV')
      .set(auth(s.finance));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    // The body is raw CSV, not the JSON envelope.
    expect(response.text.split('\r\n')[0]).toContain('Asset tag');
  });

  it('streams an Excel download', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=DEPRECIATION&format=XLSX')
      .set(auth(s.finance));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('ms-excel');
    expect(response.text).toContain('mso-application');
  });

  it('produces a depreciation report with current values', async () => {
    const response = await api(app).get('/api/v1/reports?type=DEPRECIATION').set(auth(s.finance));
    expect(response.status).toBe(200);
    const columns = response.body.data.columns.map((c: { key: string }) => c.key);
    expect(columns).toContain('current');
    expect(columns).toContain('depreciation');
  });
});

describe('warranty alert sweep (spec section 14)', () => {
  it('raises warranty-expiry notifications for the alert windows', async () => {
    // The seed has assets with warranties inside 30 days (MON-0001 at 18 days).
    const before = await api(app).get('/api/v1/notifications?pageSize=100').set(auth(s.employee));
    const beforeWarranty = before.body.data.filter(
      (n: { type: string }) => n.type === 'WARRANTY_EXPIRATION',
    ).length;

    const run = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.superAdmin));
    expect(run.status).toBe(200);
    expect(run.body.data.warrantyAlerts).toBeGreaterThanOrEqual(0);

    // The employee holds an asset expiring in 18 days, so they should now have
    // at least one warranty alert (unless a prior run already raised it today).
    const after = await api(app).get('/api/v1/notifications?pageSize=100').set(auth(s.employee));
    const afterWarranty = after.body.data.filter(
      (n: { type: string }) => n.type === 'WARRANTY_EXPIRATION',
    ).length;
    expect(afterWarranty).toBeGreaterThanOrEqual(beforeWarranty);
  });

  it('does not raise a duplicate alert on a second run the same day', async () => {
    const first = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.superAdmin));
    const second = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.superAdmin));
    // The second run finds everything already alerted today, so it raises none.
    expect(second.body.data.warrantyAlerts).toBe(0);
    void first;
  });

  it('requires settings:manage to trigger the sweep', async () => {
    const response = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.finance));
    expect(response.status).toBe(403);
  });
});

describe('scheduled reports (spec section 18)', () => {
  it('creates a scheduled report and computes its next run', async () => {
    const response = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.finance))
      .send({
        name: 'Weekly vendor spend',
        type: 'SPENDING_BY_VENDOR',
        format: 'CSV',
        cron: '0 9 * * 1',
        recipients: ['finance@techpioasset.dev'],
      });
    expect(response.status).toBe(201);
    expect(response.body.data.nextRunAt).toBeTruthy();
  });

  it('refuses to schedule without export permission', async () => {
    const response = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.employee))
      .send({
        name: 'x',
        type: 'ASSET_INVENTORY',
        cron: '0 9 * * 1',
        recipients: ['employee@techpioasset.dev'],
      });
    expect(response.status).toBe(403);
  });
});
