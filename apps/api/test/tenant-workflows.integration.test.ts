import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.7 R5 — a provisioned tenant is GOVERNED from its first request.
 *
 * Before this, provisioning created roles and categories but no workflow
 * definitions, so `materialise` found nothing, logged a warning, and the
 * request went straight to APPROVED with zero approval steps. A brand-new
 * tenant silently had no approvals at all - the gap this closes.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let tenantId: string;
let adminToken: string;

const run = Date.now() % 1_000_000;
const ADMIN = `wf-owner-${run}@acme-workflows.test`;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const created = await api(app)
    .post('/api/v1/platform/tenants')
    .set(auth(s.superAdmin))
    .send({
      name: `Workflow Tenant ${run}`,
      adminEmail: ADMIN,
      adminFirstName: 'Wanda',
      adminLastName: 'Flow',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  tenantId = created.body.data.id;

  const login = await api(app)
    .post('/api/v1/auth/login')
    .send({ email: ADMIN, password: created.body.data.admin.initialPassword });
  expect(login.status).toBe(200);
  adminToken = login.body.data.accessToken;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.client.company.delete({ where: { id: tenantId } }).catch(() => undefined);
  }
  await app?.close();
});

describe('provisioned tenants get real approval chains', () => {
  it('the standard workflow definitions and steps exist', async () => {
    const definitions = await prisma.client.workflowDefinition.findMany({
      where: { companyId: tenantId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    expect(definitions.length).toBeGreaterThanOrEqual(5);

    const keys = definitions.map((d) => d.key).sort();
    expect(keys).toContain('it-equipment');
    expect(keys).toContain('repair');

    // The catch-all (requestType null) is what an unmatched type falls back to.
    expect(definitions.some((d) => d.requestType === null)).toBe(true);

    // Steps resolve to REAL roles in THIS tenant, not dangling ids.
    const itEquipment = definitions.find((d) => d.key === 'it-equipment')!;
    expect(itEquipment.steps.length).toBeGreaterThanOrEqual(6);
    // Deduplicated: since v2.25 two steps legitimately share a role (the
    // inventory check and the cost assessment both sit with the office
    // administrator), so comparing row count to id count would fail for a
    // reason that has nothing to do with dangling ids.
    const roleIds = [
      ...new Set(itEquipment.steps.map((s) => s.approverRoleId).filter(Boolean) as string[]),
    ];
    const roles = await prisma.client.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, companyId: true },
    });
    expect(roles).toHaveLength(roleIds.length);
    expect(roles.every((r) => r.companyId === tenantId)).toBe(true);

    // The Finance threshold survived as a real decimal, not a string blob.
    const finance = itEquipment.steps.find((s) => s.name.includes('Finance'))!;
    expect(Number(finance.costThreshold)).toBe(250);
    expect(finance.isSkippable).toBe(true);
  });

  it('a request in the fresh tenant actually enters approval instead of skipping it', async () => {
    const categories = await api(app)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(categories.status).toBe(200);
    const categoryId = categories.body.data[0].id;

    const created = await api(app)
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'First request in a brand-new tenant',
        items: [{ description: 'Laptop', quantity: 1, categoryId, estimatedCost: '1200.00' }],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const requestId = created.body.data.id;

    const submitted = await api(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);

    // THE point: approval steps were materialised, and the request is waiting
    // on one - not silently APPROVED with an empty chain.
    const approvals = await prisma.client.requestApproval.findMany({
      where: { requestId },
      orderBy: { stepOrder: 'asc' },
    });
    expect(approvals.length).toBeGreaterThan(0);
    expect(approvals.some((a) => a.decision === 'PENDING')).toBe(true);
    expect(submitted.body.data.status).not.toBe('APPROVED');
  });

  it('the onboarding kit is there too, with items linked to this tenant categories', async () => {
    const template = await prisma.client.onboardingTemplate.findFirst({
      where: { companyId: tenantId },
      include: { items: true },
    });
    expect(template).toBeTruthy();
    expect(template!.items.length).toBeGreaterThan(0);
    const linked = template!.items.filter((i) => i.categoryId !== null);
    expect(linked.length).toBeGreaterThan(0);
    const categories = await prisma.client.category.findMany({
      where: { id: { in: linked.map((i) => i.categoryId!) } },
      select: { companyId: true },
    });
    expect(categories.every((c) => c.companyId === tenantId)).toBe(true);
  });
});

describe('preventive schedules API (the UI R5 adds sits on this)', () => {
  it('lists, creates and pauses schedules', async () => {
    const asset = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.superAdmin))
      .send({
        assetTag: `SCHED-${run}`,
        name: 'Schedule probe rig',
        categoryId: (await api(app).get('/api/v1/categories').set(auth(s.itAdmin))).body.data[0].id,
        status: 'AVAILABLE',
      });
    expect(asset.status).toBe(201);

    const created = await api(app)
      .post('/api/v1/maintenance/schedules')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.body.data.id, title: `Quarterly clean ${run}`, intervalDays: 90 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.isActive).toBe(true);

    const list = await api(app).get('/api/v1/maintenance/schedules').set(auth(s.itAdmin));
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: { id: string }) => r.id === created.body.data.id)).toBe(true);

    const paused = await api(app)
      .patch(`/api/v1/maintenance/schedules/${created.body.data.id}`)
      .set(auth(s.itAdmin))
      .send({ isActive: false });
    expect(paused.status).toBe(200);
    expect(paused.body.data.isActive).toBe(false);

    await prisma.client.maintenanceSchedule.delete({ where: { id: created.body.data.id } });
    await prisma.client.asset.delete({ where: { id: asset.body.data.id } });
  });
});
