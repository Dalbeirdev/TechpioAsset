/**
 * One-shot: remove accumulated test assets from the LOCAL dev database.
 * The integration suites now clean up after themselves; this clears what
 * earlier runs left behind.
 */
import path from 'node:path';
import process from 'node:process';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config({ path: path.resolve(process.cwd(), '../../.env') });
const prisma = new PrismaClient();
for (const prefix of ['RSGN-', 'NOTIF-', 'XFER-', 'NB-DEMO', 'OFF-']) {
  const n = await prisma.$executeRawUnsafe(
    `DELETE FROM assets WHERE "assetTag" LIKE '${prefix}%'`,
  );
  console.log(prefix.padEnd(9), '->', n, 'deleted');
}
await prisma.$disconnect();
