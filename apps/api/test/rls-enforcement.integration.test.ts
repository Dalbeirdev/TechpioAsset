import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';
import { provisionRlsRole, RLS_APP_URL } from './setup/rls-role.js';

/**
 * v2.7 R1 — Row-Level Security enforced AT THE DATABASE.
 *
 * The queries below are deliberately UNFILTERED — no companyId in the WHERE
 * clause, simulating a buggy or malicious app-layer path. Connected as the
 * non-superuser app role with the tenant GUC set, the database itself must
 * scope every row. This is the backstop the app-layer filters stand in front
 * of, staged since v2.1 and finally proven here.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let appRole: PrismaClient;
let demoCompanyId: string;
let foreignCompanyId: string;
let foreignAssetId: string;

const run = Date.now() % 1_000_000;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  demoCompanyId = s.superAdmin.user.companyId;

  // Provision the non-superuser role (idempotent), then connect AS it.
  await provisionRlsRole(prisma.client);
  appRole = new PrismaClient({ datasourceUrl: RLS_APP_URL });

  // A second tenant with one asset — the row that must never leak.
  const company = await prisma.client.company.create({
    data: { name: `RLS Probe Tenant ${run}` },
    select: { id: true },
  });
  foreignCompanyId = company.id;
  const category = await prisma.client.category.findFirst({
    where: { companyId: demoCompanyId },
    select: { id: true },
  });
  const asset = await prisma.client.asset.create({
    data: {
      companyId: foreignCompanyId,
      assetTag: `RLS-${run}`,
      name: 'Foreign tenant asset',
      // Cross-tenant categoryId is deliberate: this row exists only to test
      // row visibility, not referential hygiene.
      categoryId: category!.id,
      qrToken: `rls-probe-${run}`,
      trackingType: 'INDIVIDUAL',
    },
    select: { id: true },
  });
  foreignAssetId = asset.id;
});

afterAll(async () => {
  await appRole?.$disconnect();
  await prisma.client.asset.delete({ where: { id: foreignAssetId } }).catch(() => undefined);
  await prisma.client.company.delete({ where: { id: foreignCompanyId } }).catch(() => undefined);
  await app?.close();
});

/** Run raw SQL as the app role inside a tx with the tenant GUC set. */
async function asTenant<T>(companyId: string | null, sql: string): Promise<T> {
  return appRole.$transaction(async (tx) => {
    if (companyId !== null) {
      await tx.$executeRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", companyId);
    }
    return (await tx.$queryRawUnsafe(sql)) as T;
  });
}

describe('the database is the backstop', () => {
  it('an UNFILTERED query under tenant A returns zero tenant-B rows', async () => {
    const rows = await asTenant<{ id: string }[]>(
      demoCompanyId,
      `SELECT id FROM assets WHERE "deletedAt" IS NULL`,
    );
    expect(rows.length).toBeGreaterThan(0); // tenant A sees its own fleet
    expect(rows.some((r) => r.id === foreignAssetId)).toBe(false); // and nothing else
  });

  it('the same unfiltered query under tenant B sees ONLY its single asset', async () => {
    const rows = await asTenant<{ id: string }[]>(
      foreignCompanyId,
      `SELECT id FROM assets WHERE "deletedAt" IS NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(foreignAssetId);
  });

  it('enforcement covers users and the v2.6 tables too', async () => {
    const users = await asTenant<{ count: bigint }[]>(
      foreignCompanyId,
      `SELECT count(*)::bigint AS count FROM users`,
    );
    expect(Number(users[0]!.count)).toBe(0); // the demo tenant's people are invisible

    const webhooks = await asTenant<{ count: bigint }[]>(
      foreignCompanyId,
      `SELECT count(*)::bigint AS count FROM webhook_subscriptions`,
    );
    expect(Number(webhooks[0]!.count)).toBe(0);
  });

  it('a cross-tenant WRITE dies at the database (WITH CHECK)', async () => {
    await expect(
      appRole.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SELECT set_config('app.tenant_id', $1, true)",
          foreignCompanyId,
        );
        // Trying to plant a row in tenant A while scoped to tenant B.
        await tx.$executeRawUnsafe(
          `INSERT INTO webhook_subscriptions (id, "companyId", url, secret, events, "updatedAt")
           VALUES ('rls-smuggle-${run}', '${demoCompanyId}', 'https://x.test', 's', '{}', now())`,
        );
      }),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('a GUC-less session sees everything - the documented permissive design', async () => {
    // This is what the platform plane relies on (behind its operator gate),
    // and why enforcement is opt-in per request rather than per connection.
    const rows = await asTenant<{ id: string }[]>(
      null,
      `SELECT id FROM assets WHERE "deletedAt" IS NULL`,
    );
    expect(rows.some((r) => r.id === foreignAssetId)).toBe(true);
  });

  it('REGRESSION: GUC-less stays permissive on a session that ran a tenant tx before', async () => {
    // Once set_config(..., local) has run, the session's reset value is the
    // EMPTY STRING, not NULL - the original policies silently blocked every
    // row for later GUC-less work on that pooled connection. The NULLIF
    // policies (rls_policy_empty_guc migration) fix exactly this.
    await asTenant(demoCompanyId, `SELECT 1`); // dirty the session's GUC
    const rows = await asTenant<{ id: string }[]>(
      null,
      `SELECT id FROM assets WHERE "deletedAt" IS NULL`,
    );
    expect(rows.some((r) => r.id === foreignAssetId)).toBe(true);
  });

  it('the superuser bypass is real - which is exactly why prod must use the app role', async () => {
    // Same unfiltered query, run over the (superuser) app connection with the
    // GUC set: RLS does not apply to superusers, honest and demonstrated.
    const rows = await prisma.runInTenant(foreignCompanyId, async () => {
      return (await prisma.client.$queryRawUnsafe(
        `SELECT id FROM assets WHERE "deletedAt" IS NULL`,
      )) as { id: string }[];
    });
    expect(rows.length).toBeGreaterThan(1);
  });
});

describe('sanity: the app keeps working for tenants', () => {
  it('the demo admin still reads their fleet through the API', async () => {
    const res = await api(app).get('/api/v1/assets?pageSize=5').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
