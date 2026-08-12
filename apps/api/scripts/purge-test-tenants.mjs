/**
 * Removes tenants created by the integration suites from the LOCAL dev
 * database: "Acme Rentals NNN", "Quiet Tenant NNN", "Workflow Tenant NNN".
 * Deletes every dependent row first (any table carrying companyId), then the
 * companies. The demo company is never touched.
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
config({ path: path.resolve(process.cwd(), '../../.env') });
const prisma = new PrismaClient();

const PATTERN = `name ~ '^(Acme Rentals|Quiet Tenant|Workflow Tenant) [0-9]+$'`;
const ids = (
  await prisma.$queryRawUnsafe(`SELECT id FROM companies WHERE ${PATTERN}`)
).map((r) => r.id);
console.log('test tenants found:', ids.length);
if (ids.length === 0) process.exit(0);

const idList = ids.map((i) => `'${i}'`).join(',');
const tables = await prisma.$queryRawUnsafe(
  `SELECT table_name FROM information_schema.columns
   WHERE column_name = 'companyId' AND table_schema = 'public'`,
);
// A few passes: FK chains between dependent tables (e.g. request -> item)
// resolve as earlier deletions unblock later ones.
for (let pass = 0; pass < 4; pass += 1) {
  let failed = 0;
  for (const { table_name } of tables) {
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${table_name}" WHERE "companyId" IN (${idList})`,
      );
    } catch {
      failed += 1;
    }
  }
  if (failed === 0) break;
  console.log(`pass ${pass + 1}: ${failed} table(s) deferred to next pass`);
}
const gone = await prisma.$executeRawUnsafe(`DELETE FROM companies WHERE ${PATTERN}`);
console.log('companies deleted:', gone);
console.log(await prisma.$queryRawUnsafe(`SELECT count(*)::int AS remaining FROM companies`));
await prisma.$disconnect();
