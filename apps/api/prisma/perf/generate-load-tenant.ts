/**
 * v2.10 S1 — the large tenant.
 *
 * Builds a defensible "enterprise-sized" tenant so performance claims have a
 * volume attached to them. Production today holds 15 assets and zero stock
 * movements; every figure this project has quoted was measured against data
 * that size, which is why this file exists.
 *
 * Two design decisions worth stating, because they are what make it usable:
 *
 *  1. **The rows are generated inside Postgres.** `INSERT ... SELECT FROM
 *     generate_series(...)` never sends a row over the wire, so millions of
 *     rows take seconds instead of hours. Sending them through Prisma would
 *     have made the rig too slow to run, and a rig nobody runs measures
 *     nothing.
 *  2. **It is deterministic.** Every value derives from the series index -
 *     no randomness, no clock - so two runs produce identical data and two
 *     measurements are comparable. A baseline you cannot reproduce is an
 *     anecdote.
 *
 * It refuses to run against anything that looks like production, and it is
 * idempotent: re-running drops the tenant and rebuilds it.
 *
 *   pnpm --filter @techpioasset/api perf:generate            # default volume
 *   pnpm --filter @techpioasset/api perf:generate -- --scale 0.1   # a tenth
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The fixed identity of the load tenant, so runs are comparable and cleanable. */
const COMPANY_ID = 'load-tenant-v210';
const COMPANY_NAME = 'Load Tenant (v2.10 rig)';

interface Volume {
  users: number;
  assets: number;
  movements: number;
  auditRows: number;
  inventoryItems: number;
  locations: number;
}

const FULL: Volume = {
  users: 5_000,
  assets: 100_000,
  movements: 1_000_000,
  auditRows: 2_000_000,
  inventoryItems: 2_000,
  locations: 50,
};

function scaled(scale: number): Volume {
  const s = (n: number) => Math.max(1, Math.round(n * scale));
  return {
    users: s(FULL.users),
    assets: s(FULL.assets),
    movements: s(FULL.movements),
    auditRows: s(FULL.auditRows),
    inventoryItems: s(FULL.inventoryItems),
    locations: s(FULL.locations),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function purge() {

    // Role wiring first: user_roles and role_permissions reference both sides.
    await prisma.$executeRawUnsafe(
      `DELETE FROM user_roles WHERE "roleId" IN (SELECT id FROM roles WHERE "companyId" = '${COMPANY_ID}')`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM role_permissions WHERE "roleId" IN (SELECT id FROM roles WHERE "companyId" = '${COMPANY_ID}')`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM roles WHERE "companyId" = '${COMPANY_ID}'`);
    const inOrder = [
      'audit_logs',
      'stock_movements',
      'stock_batches',
      'stock_levels',
      'assets',
      'inventory_items',
      'stock_locations',
      'users',
      'offices',
      'categories',
    ];
    for (const table of inOrder) {
      await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE "companyId" = '${COMPANY_ID}'`);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM companies WHERE id = '${COMPANY_ID}'`);
}

const started = Date.now();
const step = async (label: string, fn: () => Promise<unknown>) => {
  const t = Date.now();
  await fn();
  console.log(`  ${label.padEnd(34)} ${((Date.now() - t) / 1000).toFixed(1)}s`);
};

async function main() {
  const scale = Number(arg('scale') ?? 1);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be a positive number');
  const v = scaled(scale);

  // A rig that can be pointed at production is a loaded gun. The refusal is
  // deliberately dumb and total: no override flag exists.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to generate load data with NODE_ENV=production');
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to generate load data against a non-local database: ${url.replace(/:[^:@]*@/, ':***@')}`);
  }

  // The rig shares a database with the test suites, so it has to be removable
  // without a hand-written DELETE in the right order.
  if (process.argv.includes('--drop')) {
    await purge();
    console.log(`\nLoad tenant ${COMPANY_ID} removed.\n`);
    return;
  }

  console.log(`\nLoad tenant — scale ${scale}`);
  console.log(
    `  target: ${v.assets.toLocaleString()} assets, ${v.movements.toLocaleString()} movements, ` +
      `${v.auditRows.toLocaleString()} audit rows, ${v.users.toLocaleString()} users\n`,
  );

  // Idempotent: the tenant is dropped whole and rebuilt, so a re-run is a
  // fresh, identical dataset rather than a doubled one.
  //
  // Children are deleted explicitly and in order because several foreign keys
  // are RESTRICT rather than CASCADE - deliberately, since in the application a
  // company is never meant to be deleted out from under its data.
  //
  // Note on audit_logs: the application cannot delete them (the Prisma client
  // extension refuses), and that guarantee is not weakened here. This is raw
  // SQL against a throwaway tenant the application never sees - a path only a
  // database owner has, which is true of any database.
  await step('clear any previous run', purge);

  await step('company, office, category', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO companies (id, name, "createdAt", "updatedAt")
      VALUES ('${COMPANY_ID}', '${COMPANY_NAME}', NOW(), NOW())`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO offices (id, "companyId", code, name, "createdAt", "updatedAt")
      VALUES ('${COMPANY_ID}-office', '${COMPANY_ID}', 'HQ', 'Load HQ', NOW(), NOW())`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO categories (id, "companyId", key, name, "createdAt", "updatedAt")
      VALUES ('${COMPANY_ID}-cat', '${COMPANY_ID}', 'hardware', 'Hardware', NOW(), NOW())`);
  });

  // One real password hash, reused. Hashing 5,000 times with argon2 would take
  // longer than everything else here put together and prove nothing.
  //
  // It is copied from a NAMED demo account, not from "whatever findFirst
  // returns" - which on a second run is a load user from the first run, whose
  // hash is itself a copy. And there is no placeholder fallback: a rig that
  // cheerfully writes an unusable hash and then prints "measure as load1@..."
  // has told you it worked when it has not.
  const SOURCE_ACCOUNT = 'admin@techpioasset.dev';
  await step(`users (${v.users.toLocaleString()})`, async () => {
    const sample = await prisma.user.findFirst({
      where: { email: SOURCE_ACCOUNT },
      select: { passwordHash: true },
    });
    if (!sample?.passwordHash) {
      throw new Error(
        `No password hash to copy: ${SOURCE_ACCOUNT} does not exist. Run \`pnpm seed\` first — ` +
          'the rig needs a real hash so its users can actually log in.',
      );
    }
    const hash = sample.passwordHash.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`
      INSERT INTO users (id, "companyId", email, "passwordHash", status, "createdAt", "updatedAt")
      SELECT
        '${COMPANY_ID}-u' || i,
        '${COMPANY_ID}',
        'load' || i || '@load.invalid',
        '${hash}',
        'ACTIVE',
        NOW(), NOW()
      FROM generate_series(1, ${v.users}) AS i`);
  });

  // Without a role holding every permission, every measured endpoint would
  // return 403 and the "baseline" would be a benchmark of the auth guard.
  //
  // The key must be a SYSTEM role key. Data scope is resolved from the role key
  // at login, and an unrecognised key falls through to OWN - so a role called
  // LOAD_ADMIN holding every permission still sees zero assets, which measures
  // an empty result set very quickly and proves nothing.
  await step('role + login user for the rig', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO roles (id, "companyId", key, name, "isSystem", "createdAt", "updatedAt")
      VALUES ('${COMPANY_ID}-role', '${COMPANY_ID}', 'SUPER_ADMIN', 'Load rig admin', true, NOW(), NOW())`);
    // Every permission that exists, whatever the current matrix happens to be.
    await prisma.$executeRawUnsafe(`
      INSERT INTO role_permissions ("roleId", "permissionId", "createdAt")
      SELECT '${COMPANY_ID}-role', id, NOW() FROM permissions`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO user_roles ("userId", "roleId", "createdAt")
      VALUES ('${COMPANY_ID}-u1', '${COMPANY_ID}-role', NOW())`);
  });

  await step(`stock locations (${v.locations})`, async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO stock_locations (id, "companyId", code, name, "createdAt", "updatedAt")
      SELECT '${COMPANY_ID}-loc' || i, '${COMPANY_ID}', 'L' || i, 'Location ' || i, NOW(), NOW()
      FROM generate_series(1, ${v.locations}) AS i`);
  });

  await step(`inventory items (${v.inventoryItems.toLocaleString()})`, async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO inventory_items
        (id, "companyId", sku, name, "categoryId", unit, "quantityOnHand", "createdAt", "updatedAt")
      SELECT
        '${COMPANY_ID}-item' || i, '${COMPANY_ID}', 'SKU-' || i, 'Item ' || i,
        '${COMPANY_ID}-cat', 'unit', 100, NOW(), NOW()
      FROM generate_series(1, ${v.inventoryItems}) AS i`);
  });

  // Assets spread across every status and a year of purchase dates, so filters
  // and date ranges have something to actually discriminate between. Enum values
  // come from `enum_range` rather than a hard-coded list: a list drifts from the
  // schema silently and then fails halfway through a long run.
  await step(`assets (${v.assets.toLocaleString()})`, async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO assets
        (id, "companyId", "assetTag", name, "categoryId", "trackingType", "qrToken",
         status, condition, "purchaseDate", "purchaseCost", currency, "createdAt", "updatedAt")
      SELECT
        '${COMPANY_ID}-a' || i,
        '${COMPANY_ID}',
        'LOAD-' || lpad(i::text, 7, '0'),
        'Load asset ' || i,
        '${COMPANY_ID}-cat',
        'INDIVIDUAL',
        '${COMPANY_ID}-qr' || i,
        (enum_range(NULL::"AssetStatus"))[1 + (i % array_length(enum_range(NULL::"AssetStatus"), 1))],
        'GOOD'::"AssetCondition",
        NOW() - ((i % 365) || ' days')::interval,
        100 + (i % 4000),
        'USD',
        NOW() - ((i % 365) || ' days')::interval,
        NOW()
      FROM generate_series(1, ${v.assets}) AS i`);
  });

  // Stock movements are the append-only ledger the drift check walks. This is
  // the table that makes the nightly sweep's per-row query unfinishable, so it
  // is the one that has to be big.
  //
  // Five positive types to two negative, so every running balance stays above
  // zero and the stock_levels CHECK holds. The mix is deliberately narrow: only
  // types the drift check has a sign for, because a movement it scores as zero
  // would make the cache and the ledger disagree by construction.
  //
  // The type cycle is 7 and the item/location cycles are 2000 and 50. That is
  // not arbitrary: with a 5-cycle every movement for a given pair landed on the
  // SAME type (2000 mod 5 = 0), so whole pairs received nothing but issues and
  // went negative. Coprime periods are what make the mix actually mix.
  await step(`stock movements (${v.movements.toLocaleString()})`, async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO stock_movements
        (id, "companyId", "inventoryItemId", "stockLocationId", type, quantity, "createdAt")
      SELECT
        '${COMPANY_ID}-m' || i,
        '${COMPANY_ID}',
        '${COMPANY_ID}-item' || (1 + (i % ${v.inventoryItems})),
        '${COMPANY_ID}-loc' || (1 + (i % ${v.locations})),
        (ARRAY['RECEIPT','RECEIPT','RECEIPT','RECEIPT','ADJUST_UP','ISSUE','ADJUST_DOWN']::"StockMovementType"[])[1 + (i % 7)],
        1 + (i % 5),
        NOW() - ((i % 500) || ' days')::interval
      FROM generate_series(1, ${v.movements}) AS i`);
  });

  // Stock levels: one row per item/location pair that has movements. This is
  // what the sweep iterates, and its size is what turns an N+1 into a wall.
  //
  // The quantity is DERIVED FROM THE LEDGER, using the same sign convention the
  // drift check uses. An earlier version wrote a flat 100 and every one of the
  // 2,000 levels then reported as drifted - the rig inventing the exact defect
  // the sweep exists to find, and failing a real test on the way past. A rig
  // that fabricates a fault measures nothing you can trust.
  await step('stock levels (derived from the ledger)', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO stock_levels (id, "companyId", "inventoryItemId", "stockLocationId", quantity, reserved, "updatedAt")
      SELECT
        '${COMPANY_ID}-lvl' || row_number() OVER (ORDER BY m."inventoryItemId", m."stockLocationId"),
        '${COMPANY_ID}',
        m."inventoryItemId",
        m."stockLocationId",
        m.balance,
        0,
        NOW()
      FROM (
        SELECT
          "inventoryItemId",
          "stockLocationId",
          SUM(CASE WHEN type IN ('RECEIPT','ADJUST_UP','TRANSFER_IN')
                   THEN quantity ELSE -quantity END) AS balance
        FROM stock_movements
        WHERE "companyId" = '${COMPANY_ID}'
        GROUP BY "inventoryItemId", "stockLocationId"
      ) m`);

    // Trust nothing about the arithmetic above: ask.
    const [worst] = await prisma.$queryRawUnsafe<{ min: number | null }[]>(
      `SELECT MIN(quantity)::float AS min FROM stock_levels WHERE "companyId" = '${COMPANY_ID}'`,
    );
    if ((worst?.min ?? 0) < 0) {
      throw new Error(
        `Generated a negative stock level (${worst?.min}). The movement type mix and the ` +
          'item/location cycles have aligned again - they must stay coprime.',
      );
    }
  });

  // The audit log is append-only and undeletable by design, so it only ever
  // grows. This is the volume that makes that a question worth answering.
  await step(`audit rows (${v.auditRows.toLocaleString()})`, async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO audit_logs
        (id, "companyId", action, "entityType", "entityId", "createdAt")
      SELECT
        '${COMPANY_ID}-al' || i,
        '${COMPANY_ID}',
        (enum_range(NULL::"AuditAction"))[1 + (i % array_length(enum_range(NULL::"AuditAction"), 1))],
        'Asset',
        '${COMPANY_ID}-a' || (1 + (i % ${v.assets})),
        NOW() - ((i % 700) || ' days')::interval
      FROM generate_series(1, ${v.auditRows}) AS i`);
  });

  await step('ANALYZE (so plans reflect reality)', async () => {
    // Without this the planner still believes the table statistics from before
    // the load, and every EXPLAIN in S4 would be measuring a fantasy.
    await prisma.$executeRawUnsafe('ANALYZE');
  });

  const counts = await prisma.$queryRawUnsafe<{ table: string; n: bigint }[]>(`
    SELECT 'assets' AS table, count(*) AS n FROM assets WHERE "companyId" = '${COMPANY_ID}'
    UNION ALL SELECT 'stock_movements', count(*) FROM stock_movements WHERE "companyId" = '${COMPANY_ID}'
    UNION ALL SELECT 'stock_levels', count(*) FROM stock_levels WHERE "companyId" = '${COMPANY_ID}'
    UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs WHERE "companyId" = '${COMPANY_ID}'
    UNION ALL SELECT 'users', count(*) FROM users WHERE "companyId" = '${COMPANY_ID}'
    UNION ALL SELECT 'inventory_items', count(*) FROM inventory_items WHERE "companyId" = '${COMPANY_ID}'`);

  console.log('\n  rows now present:');
  for (const c of counts) console.log(`    ${c.table.padEnd(18)} ${Number(c.n).toLocaleString()}`);
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Tenant id: ${COMPANY_ID}`);
  console.log(
    `  measure as: load1@load.invalid (same password as the demo accounts — the hash is copied)\n`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('\nLoad generation failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
