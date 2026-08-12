/**
 * One-shot production data load (v2.15).
 *
 * Reads import-real-data.json (extracted from the company's M365 user export
 * and the gadget register) and loads it into the named tenant: people as
 * INVITED no-login records - assignable now, invitable when SMTP is real -
 * and laptops as ASSIGNED assets with a proper assignment row each, so
 * day one in the portal already matches who physically holds what.
 *
 * Idempotent: users upsert by (companyId, email), assets by
 * (companyId, assetTag); an existing open assignment for the same holder is
 * left alone. `--delete-company "<name>"` removes a tenant outright first
 * (the demo tenant on production).
 *
 *   node scripts/import-real-data.mjs --company PioTech [--delete-company "Techpio Demo Company"]
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const companyName = arg('--company');
const deleteName = arg('--delete-company');
if (!companyName) {
  console.error('Usage: node import-real-data.mjs --company <name> [--delete-company <name>]');
  process.exit(1);
}

const payload = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'import-real-data.json'), 'utf8'),
);

// ─── optional: remove a tenant outright (the demo company) ───────────────────
if (deleteName && deleteName !== companyName) {
  const doomed = await prisma.company.findFirst({ where: { name: deleteName } });
  if (doomed) {
    const tables = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.columns
       WHERE column_name = 'companyId' AND table_schema = 'public'`,
    );
    for (let pass = 0; pass < 4; pass += 1) {
      let failed = 0;
      for (const { table_name } of tables) {
        try {
          await prisma.$executeRawUnsafe(
            `DELETE FROM "${table_name}" WHERE "companyId" = '${doomed.id}'`,
          );
        } catch {
          failed += 1;
        }
      }
      if (failed === 0) break;
    }
    await prisma.$executeRawUnsafe(`DELETE FROM companies WHERE id = '${doomed.id}'`);
    console.log(`deleted tenant: ${deleteName}`);
  } else {
    console.log(`tenant already gone: ${deleteName}`);
  }
}

// ─── target tenant ───────────────────────────────────────────────────────────
const company = await prisma.company.findFirst({ where: { name: companyName } });
if (!company) {
  console.error(`Company "${companyName}" not found - refusing to invent a tenant.`);
  process.exit(1);
}
const employeeRole = await prisma.role.findFirst({
  where: { companyId: company.id, key: 'EMPLOYEE' },
});
const itCategory = await prisma.category.findFirst({
  where: { companyId: company.id, key: 'it-assets' },
});
if (!employeeRole || !itCategory) {
  console.error('Tenant is missing its EMPLOYEE role or it-assets category.');
  process.exit(1);
}

// ─── users ───────────────────────────────────────────────────────────────────
const userIdByEmail = new Map();
let usersCreated = 0;
for (const u of payload.users) {
  const existing = await prisma.user.findFirst({
    where: { companyId: company.id, email: u.email },
    select: { id: true },
  });
  if (existing) {
    userIdByEmail.set(u.email, existing.id);
    continue;
  }
  const created = await prisma.user.create({
    data: {
      companyId: company.id,
      email: u.email,
      passwordHash: null,
      status: 'INVITED',
      roles: { create: { roleId: employeeRole.id } },
      profile: { create: { firstName: u.firstName, lastName: u.lastName } },
    },
    select: { id: true },
  });
  userIdByEmail.set(u.email, created.id);
  usersCreated += 1;
}

// Holders the user sheet does not know (contractor kit, etc.) become the same
// no-login records the Excel import flow creates.
const holderId = async (asset) => {
  if (asset.holderEmail) return userIdByEmail.get(asset.holderEmail) ?? null;
  if (!asset.holderName) return null;
  const email = `${asset.holderName.toLowerCase().replace(/\s+/g, '.')}@import.local`;
  if (userIdByEmail.has(email)) return userIdByEmail.get(email);
  const [firstName, ...rest] = asset.holderName.split(/\s+/);
  const created = await prisma.user.create({
    data: {
      companyId: company.id,
      email,
      passwordHash: null,
      status: 'INVITED',
      roles: { create: { roleId: employeeRole.id } },
      profile: { create: { firstName, lastName: rest.join(' ') || '-' } },
    },
    select: { id: true },
  });
  userIdByEmail.set(email, created.id);
  usersCreated += 1;
  return created.id;
};

// ─── assets ──────────────────────────────────────────────────────────────────
let assetsCreated = 0;
let assetsSkipped = 0;
let assignmentsCreated = 0;
for (const a of payload.assets) {
  const existing = await prisma.asset.findFirst({
    where: { companyId: company.id, assetTag: a.assetTag },
    select: { id: true },
  });
  if (existing) {
    assetsSkipped += 1;
    continue;
  }
  const userId = await holderId(a);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        companyId: company.id,
        assetTag: a.assetTag,
        qrToken: ulid(),
        name: a.name,
        brand: a.brand,
        model: a.model,
        serialNumber: a.serialNumber,
        categoryId: itCategory.id,
        status: userId ? 'ASSIGNED' : 'AVAILABLE',
        condition: a.condition,
        notes: a.notes,
        warrantyEndDate: a.warrantyEndDate ? new Date(a.warrantyEndDate) : null,
        ...(userId
          ? { assignedUserId: userId, assignmentDate: now }
          : {}),
      },
      select: { id: true },
    });
    if (userId) {
      await tx.assetAssignment.create({
        data: {
          assetId: asset.id,
          userId,
          assignedAt: now,
          conditionOut: a.condition,
          accessoriesIssued: a.accessories,
          notes: 'Loaded from gadget register',
        },
      });
      assignmentsCreated += 1;
    }
  });
  assetsCreated += 1;
}

console.log(
  `done: ${usersCreated} users created, ${assetsCreated} assets created (${assetsSkipped} already present), ${assignmentsCreated} assignments`,
);
const counts = await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*)::int FROM users WHERE "companyId"='${company.id}') AS users,
          (SELECT count(*)::int FROM assets WHERE "companyId"='${company.id}') AS assets`,
);
console.log('tenant now:', counts[0]);
await prisma.$disconnect();
