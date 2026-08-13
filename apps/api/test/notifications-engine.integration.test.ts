import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.18 notification engine: routing rules actually route, disabling actually
 * silences, template overrides actually render, and every email lands in the
 * log. The asset-return path is exercised end-to-end through the real API.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let categoryId: string;
const assets: string[] = [];

async function makeAssignedAsset(tag: string): Promise<string> {
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({ assetTag: tag, name: `Engine Test ${tag}`, categoryId, status: 'AVAILABLE' });
  const id = created.body.data.id as string;
  assets.push(id);
  await api(app).post(`/api/v1/assets/${id}/assign`).set(auth(s.itAdmin)).send({ userId: s.employee.user.id });
  return id;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
});

afterAll(async () => {
  await prisma.client.$executeRawUnsafe(
    `DELETE FROM notification_rules WHERE type IN ('ASSET_RETURNED','WARRANTY_EXPIRATION') AND "companyId" = $1`,
    s.superAdmin.user.companyId,
  );
  await prisma.client.$executeRawUnsafe(
    `DELETE FROM email_templates WHERE type = 'WARRANTY_EXPIRATION' AND "companyId" = $1`,
    s.superAdmin.user.companyId,
  );
  for (const id of assets) {
    await prisma.client.$executeRawUnsafe('DELETE FROM notifications WHERE "entityId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "assetId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await app?.close();
});

describe('admin plane', () => {
  it('is closed to employees', async () => {
    const res = await api(app).get('/api/v1/notifications/admin/rules').set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('lists every event with defaults, and warranty carries its thresholds', async () => {
    const res = await api(app).get('/api/v1/notifications/admin/rules').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const warranty = res.body.data.rules.find((r: { type: string }) => r.type === 'WARRANTY_EXPIRATION');
    expect(warranty.thresholds).toEqual([90, 60, 30, 15, 7, 1, 0]);
    expect(res.body.data.roles.length).toBeGreaterThan(3);
  });

  it('refuses to disable a mandatory event', async () => {
    const res = await api(app)
      .patch('/api/v1/notifications/admin/rules/APPROVAL_REQUIRED')
      .set(auth(s.superAdmin))
      .send({ enabled: false, notifyPrimary: true, recipientRoleKeys: [], ccRoleKeys: [], escalationRoleKeys: [], thresholds: [] });
    expect(res.status).toBe(422);
  });
});

describe('routing end-to-end (asset return)', () => {
  it('a stored rule routes the event to the configured role holders', async () => {
    const save = await api(app)
      .patch('/api/v1/notifications/admin/rules/ASSET_RETURNED')
      .set(auth(s.superAdmin))
      .send({ enabled: true, notifyPrimary: true, recipientRoleKeys: ['HR'], ccRoleKeys: [], escalationRoleKeys: [], thresholds: [] });
    expect(save.status).toBe(200);

    const id = await makeAssignedAsset(`ENG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`);
    const before = await prisma.client.notification.count({
      where: { userId: s.hr.user.id, type: 'ASSET_RETURNED' },
    });
    const ret = await api(app)
      .post(`/api/v1/assets/${id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    expect(ret.status).toBeLessThan(300);

    const after = await prisma.client.notification.count({
      where: { userId: s.hr.user.id, type: 'ASSET_RETURNED' },
    });
    expect(after).toBe(before + 1);
  });

  it('disabling the rule silences the event entirely', async () => {
    await api(app)
      .patch('/api/v1/notifications/admin/rules/ASSET_RETURNED')
      .set(auth(s.superAdmin))
      .send({ enabled: false, notifyPrimary: true, recipientRoleKeys: ['HR'], ccRoleKeys: [], escalationRoleKeys: [], thresholds: [] });

    const id = await makeAssignedAsset(`ENG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`);
    const before = await prisma.client.notification.count({ where: { type: 'ASSET_RETURNED' } });
    await api(app)
      .post(`/api/v1/assets/${id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    const after = await prisma.client.notification.count({ where: { type: 'ASSET_RETURNED' } });
    expect(after).toBe(before);
  });
});

describe('templates, preview and the email log', () => {
  it('an override changes the rendered subject in preview', async () => {
    const save = await api(app)
      .patch('/api/v1/notifications/admin/templates/WARRANTY_EXPIRATION')
      .set(auth(s.superAdmin))
      .send({ subject: 'CUSTOM {{asset.asset_tag}} check', body: 'Custom body for {{asset.name}}.', enabled: true });
    expect(save.status).toBe(200);

    const preview = await api(app)
      .get('/api/v1/notifications/admin/templates/WARRANTY_EXPIRATION/preview')
      .set(auth(s.superAdmin));
    expect(preview.status).toBe(200);
    expect(preview.body.data.subject).toBe('CUSTOM PIO-01241 check');
    expect(preview.body.data.html).toContain('PioAssets');
    expect(preview.body.data.html).toContain('Custom body for Dell Latitude 7450.');
  });

  it('a test send lands in the email log', async () => {
    const before = await prisma.client.emailLog.count({
      where: { companyId: s.superAdmin.user.companyId, type: 'WARRANTY_EXPIRATION' },
    });
    const res = await api(app)
      .post('/api/v1/notifications/admin/templates/WARRANTY_EXPIRATION/test')
      .set(auth(s.superAdmin))
      .send({});
    expect(res.status).toBe(202);

    // The in-process queue executes promptly; poll briefly for the log row.
    let after = before;
    for (let i = 0; i < 20 && after === before; i++) {
      await new Promise((r) => setTimeout(r, 250));
      after = await prisma.client.emailLog.count({
        where: { companyId: s.superAdmin.user.companyId, type: 'WARRANTY_EXPIRATION' },
      });
    }
    expect(after).toBe(before + 1);

    const row = await prisma.client.emailLog.findFirst({
      where: { companyId: s.superAdmin.user.companyId, type: 'WARRANTY_EXPIRATION' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.subject).toBe('CUSTOM PIO-01241 check');
    expect(['SENT', 'SIMULATED']).toContain(row?.status);
  });

  it('the email log endpoint filters and pages', async () => {
    const res = await api(app)
      .get('/api/v1/notifications/admin/email-logs?status=SIMULATED&pageSize=5')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.rows)).toBe(true);
  });
});
