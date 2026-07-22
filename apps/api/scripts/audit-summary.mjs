/**
 * Prints a summary of the audit trail. A small operator utility, and the quickest
 * way to confirm that audited actions are actually being recorded.
 *
 *   pnpm --filter @techpioasset/api audit:summary
 */
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

const total = await prisma.auditLog.count();
const byAction = await prisma.auditLog.groupBy({
  by: ['action'],
  _count: { action: true },
  orderBy: { _count: { action: 'desc' } },
});

console.log(`audit_logs rows: ${total}\n`);
for (const row of byAction) {
  console.log(`  ${row.action.padEnd(28)} ${row._count.action}`);
}

const recent = await prisma.auditLog.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  include: { actor: { select: { email: true } } },
});

console.log('\nmost recent:');
for (const row of recent) {
  console.log(
    `  ${row.createdAt.toISOString()}  ${row.action.padEnd(22)} ` +
      `${(row.actor?.email ?? 'system').padEnd(30)} ${row.entityType}:${row.entityId.slice(0, 8)}`,
  );
}

await prisma.$disconnect();
