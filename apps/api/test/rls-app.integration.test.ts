import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.7 R1 — the application under REAL enforcement: booted as the
 * non-superuser role with RLS_ENFORCE=true (see vitest.rls.config.ts).
 * Correct code must behave identically; the platform plane must keep its
 * deliberate cross-tenant reads; a foreign row must be invisible everywhere.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let admin: PrismaClient;
let foreignCompanyId: string;
let foreignAssetId: string;

const run = Date.now() % 1_000_000;

beforeAll(async () => {
  // Admin (superuser) connection for planting/cleaning fixtures - the app
  // itself runs as the RLS-subject role.
  const env = parse(readFileSync(path.resolve(process.cwd(), '../../.env')));
  admin = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

  app = await createTestApp();
  s = await loginAll(app);

  const company = await admin.company.create({
    data: { name: `RLS Lane Tenant ${run}` },
    select: { id: true },
  });
  foreignCompanyId = company.id;
  const category = await admin.category.findFirst({ select: { id: true } });
  const asset = await admin.asset.create({
    data: {
      companyId: foreignCompanyId,
      assetTag: `RLSLANE-${run}`,
      name: 'Lane foreign asset',
      categoryId: category!.id,
      qrToken: `rls-lane-${run}`,
      trackingType: 'INDIVIDUAL',
    },
    select: { id: true },
  });
  foreignAssetId = asset.id;
});

afterAll(async () => {
  await admin?.asset.delete({ where: { id: foreignAssetId } }).catch(() => undefined);
  await admin?.company.delete({ where: { id: foreignCompanyId } }).catch(() => undefined);
  await admin?.$disconnect();
  await app?.close();
});

describe('enforcement changes nothing for correct code', () => {
  it('login, list, detail and aggregates all work as the RLS-subject role', async () => {
    const list = await api(app).get('/api/v1/assets?pageSize=5').set(auth(s.superAdmin));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    const detail = await api(app)
      .get(`/api/v1/assets/${list.body.data[0].id}`)
      .set(auth(s.superAdmin));
    expect(detail.status).toBe(200);

    const overview = await api(app).get('/api/v1/analytics/overview').set(auth(s.superAdmin));
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    expect(overview.body.data.totals.assets).toBeGreaterThan(0);
  });

  it('a foreign tenant row is invisible through every read path', async () => {
    const detail = await api(app)
      .get(`/api/v1/assets/${foreignAssetId}`)
      .set(auth(s.superAdmin));
    expect(detail.status).toBe(404);

    const list = await api(app).get('/api/v1/assets?pageSize=100').set(auth(s.superAdmin));
    expect(
      list.body.data.some((a: { id: string }) => a.id === foreignAssetId),
    ).toBe(false);
  });

  it('the platform plane still reads ACROSS tenants under enforcement (SkipRls)', async () => {
    const res = await api(app).get('/api/v1/platform/tenants').set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const names = res.body.data.map((t: { name: string }) => t.name);
    expect(names).toContain(`RLS Lane Tenant ${run}`); // the operator sees the other tenant
  });

  it('a service that opens its OWN transaction still works under enforcement', async () => {
    // The path RLS could plausibly break: licence assign runs $transaction with
    // a raw guarded UPDATE inside it, nested within the interceptor's tenant
    // transaction. The proxy flattens the inner transaction into the outer one;
    // without that this 500s under RLS_ENFORCE, and no health check would say so.
    const created = await api(app)
      .post('/api/v1/licenses')
      .set(auth(s.superAdmin))
      .send({
        name: `RLS Tx Probe ${run}`,
        family: 'OTHER',
        subscriptionType: 'SUBSCRIPTION',
        purchaseDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        seatsPurchased: 1,
        unitOfAssignment: 'USER',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const licenseId = created.body.data.id;

    const assigned = await api(app)
      .post(`/api/v1/licenses/${licenseId}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId: s.employee.user.id });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);

    // The guarded counter moved exactly once, inside the nested transaction.
    const pool = await admin.seatPool.findFirstOrThrow({ where: { licenseId } });
    expect(pool.seatsReserved).toBe(1);

    // And the honest refusal still fires on the last seat.
    const refused = await api(app)
      .post(`/api/v1/licenses/${licenseId}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId: s.employee2.user.id });
    expect(refused.status).toBe(409);

    await admin.licenseAssignment.deleteMany({ where: { licenseId } });
    await admin.seatPool.deleteMany({ where: { licenseId } });
    await admin.softwareLicense.delete({ where: { id: licenseId } });
  });

  it('writes work in-tenant and the created row lands in the right tenant', async () => {
    const categories = await api(app).get('/api/v1/categories').set(auth(s.superAdmin));
    const categoryId = categories.body.data[0].id;
    const created = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.superAdmin))
      .send({ assetTag: `RLSW-${run}`, name: 'Written under RLS', categoryId, status: 'AVAILABLE' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const row = await admin.asset.findUnique({ where: { id: created.body.data.id } });
    expect(row!.companyId).toBe(s.superAdmin.user.companyId);
    await admin.asset.delete({ where: { id: created.body.data.id } });
  });
});
