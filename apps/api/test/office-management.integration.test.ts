import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEMO_PASSWORD, api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.11 — offices get a write side, and re-authentication gets an endpoint.
 *
 * Offices were seed-only reference data: every picker read them, nothing could
 * create one. The lines these tests hold: writes are SETTINGS_MANAGE, codes are
 * unique per company, tenants cannot see or touch each other's offices, and a
 * write must actually appear in the cached read the pickers use.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  await prisma?.client.office.deleteMany({
    where: { companyId, code: { in: ['PUNE-01', 'PUNE-02', 'GATE-01'] } },
  });
  await app?.close();
});

describe('office management', () => {
  it('creates an office, audits it, and the pickers see it (cache busted)', async () => {
    const res = await api(app)
      .post('/api/v1/offices')
      .set(auth(s.superAdmin))
      .send({ code: 'pune-01', name: 'Pune Office', city: 'Pune', timezone: 'Asia/Kolkata' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.code).toBe('PUNE-01'); // uppercased server-side

    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'SETTING_CHANGED', entityType: 'Office', entityId: res.body.data.id },
      select: { id: true },
    });
    expect(audit).not.toBeNull();

    // The read every picker uses must include the new office immediately -
    // this is the cache-bust check, not just a DB check.
    const list = await api(app).get('/api/v1/offices').set(auth(s.superAdmin));
    expect(list.body.data.map((o: { code: string }) => o.code)).toContain('PUNE-01');
  });

  it('refuses a duplicate code in the same company', async () => {
    const res = await api(app)
      .post('/api/v1/offices')
      .set(auth(s.superAdmin))
      .send({ code: 'PUNE-01', name: 'Pune Again' });
    expect(res.status).toBe(409);
  });

  it('is refused without settings:manage', async () => {
    const res = await api(app)
      .post('/api/v1/offices')
      .set(auth(s.employee))
      .send({ code: 'PUNE-02', name: 'Rogue Office' });
    expect(res.status).toBe(403);

    const manage = await api(app).get('/api/v1/offices/manage').set(auth(s.employee));
    expect(manage.status).toBe(403);
  });

  it('rejects unknown keys instead of silently dropping them', async () => {
    const res = await api(app)
      .post('/api/v1/offices')
      .set(auth(s.superAdmin))
      .send({ code: 'PUNE-02', name: 'Pune Two', companyId: 'someone-elses-tenant' });
    expect([400, 422]).toContain(res.status);
  });

  it('updates and deactivates, and deactivated offices leave the pickers but stay on the manage list', async () => {
    const created = await api(app)
      .post('/api/v1/offices')
      .set(auth(s.superAdmin))
      .send({ code: 'PUNE-02', name: 'Pune Two' });
    const id = created.body.data.id;

    const upd = await api(app)
      .patch(`/api/v1/offices/${id}`)
      .set(auth(s.superAdmin))
      .send({ name: 'Pune Riverside', isActive: false });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.data.name).toBe('Pune Riverside');

    const pickers = await api(app).get('/api/v1/offices').set(auth(s.superAdmin));
    expect(pickers.body.data.map((o: { code: string }) => o.code)).not.toContain('PUNE-02');

    const manage = await api(app).get('/api/v1/offices/manage').set(auth(s.superAdmin));
    const row = manage.body.data.find((o: { id: string }) => o.id === id);
    expect(row?.isActive).toBe(false);
  });

  it("cannot touch another tenant's office", async () => {
    const foreign = await prisma.client.office.findFirst({
      where: { companyId: { not: companyId } },
      select: { id: true },
    });
    if (!foreign) return; // single-tenant test DB - nothing to cross into
    const res = await api(app)
      .patch(`/api/v1/offices/${foreign.id}`)
      .set(auth(s.superAdmin))
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });
});

describe('re-authentication (confirm-password)', () => {
  it('accepts the right password', async () => {
    const res = await api(app)
      .post('/api/v1/auth/confirm-password')
      .set(auth(s.employee))
      .send({ password: DEMO_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  });

  it('refuses a wrong password', async () => {
    const res = await api(app)
      .post('/api/v1/auth/confirm-password')
      .set(auth(s.employee))
      .send({ password: 'definitely-not-it' });
    expect(res.status).toBe(401);
  });
});
