/**
 * One-off sync for the 2026-08 "Gadget Details" register update.
 *
 * Reads sync-gadget-update.json (git-ignored - real staff data) and applies:
 *   - employeeNumber backfill on user profiles
 *   - serial corrections and the two custody stories the sheet tells
 *     (TECHPIO-DELL's 5310 handed to Sargam + Rohit's new 7420;
 *      Inderpreet's ThinkPad handed to Gautam + Inderpreet's new 5420)
 *   - refreshed sheet-notes on matched assets
 * Everything is audited; assignments are closed/opened like the go-live import.
 *
 * Run inside the api container (or locally):
 *   DATABASE_URL="$MIGRATE_DATABASE_URL" node scripts/sync-gadget-update.mjs --company PioTech
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();
const companyName = process.argv[process.argv.indexOf('--company') + 1];
if (!companyName) {
  console.error('Usage: node sync-gadget-update.mjs --company <name>');
  process.exit(1);
}
const payload = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'sync-gadget-update.json'), 'utf8'),
);

const company = await prisma.company.findFirst({ where: { name: companyName } });
if (!company) throw new Error(`company ${companyName} not found`);

const DIMS = {
  ASSIGNED: { lifecycleState: 'DEPLOYED', availabilityState: 'ASSIGNED' },
  RETIRED: { lifecycleState: 'RETIRED', availabilityState: 'AVAILABLE' },
};

const audit = (action, entityType, entityId, previousValues, newValues) =>
  prisma.auditLog.create({
    data: {
      companyId: company.id,
      actorId: null,
      action,
      entityType,
      entityId,
      previousValues: previousValues ?? undefined,
      newValues: newValues ?? undefined,
    },
  });

const userByEmail = async (email) => {
  const u = await prisma.user.findFirst({
    where: { companyId: company.id, email },
    select: { id: true },
  });
  if (!u) {
    console.warn(`SKIP - user ${email} not found`);
    return null;
  }
  return u.id;
};

// 1 - employee numbers -------------------------------------------------------
let empSet = 0;
for (const { email, employeeNumber } of payload.employeeNumbers) {
  const userId = await userByEmail(email);
  if (!userId) continue;
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { id: true, employeeNumber: true },
  });
  if (!profile || profile.employeeNumber === employeeNumber) continue;
  await prisma.userProfile.update({ where: { userId }, data: { employeeNumber } });
  await audit('USER_UPDATED', 'User', userId, { employeeNumber: profile.employeeNumber }, { employeeNumber, source: 'gadget-register-2026-08' });
  empSet += 1;
}
console.log(`employee numbers set: ${empSet}`);

// 2 - retirements first: the freed serial is reused below ------------------------------------------------------------
for (const r of payload.retirements) {
  const asset = await prisma.asset.findFirst({
    where: { companyId: company.id, assetTag: r.assetTag },
  });
  if (!asset || asset.status === 'RETIRED') continue;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.assetAssignment.updateMany({
      where: { assetId: asset.id, returnedAt: null },
      data: { returnedAt: now, notes: r.note },
    });
    await tx.asset.update({
      where: { id: asset.id },
      data: {
        status: 'RETIRED',
        assignedUserId: null,
        serialNumber: r.clearSerial ? null : asset.serialNumber,
        notes: [asset.notes, r.note].filter(Boolean).join('\n'),
        ...DIMS.RETIRED,
      },
    });
  });
  await audit('ASSET_STATUS_CHANGED', 'Asset', asset.id, { status: asset.status }, { status: 'RETIRED', reason: r.note });
  console.log(`retired ${r.assetTag}`);
}

// 3 - simple field updates (serials, notes, tag renames) (serials, notes, brand fixes) ---------------------
let fieldUpdates = 0;
for (const u of payload.assetUpdates) {
  const asset = await prisma.asset.findFirst({
    where: { companyId: company.id, assetTag: u.assetTag },
  });
  if (!asset) {
    console.warn(`SKIP update - no asset ${u.assetTag}`);
    continue;
  }
  const data = {};
  const prev = {};
  for (const key of ['serialNumber', 'brand', 'model', 'notes', 'name']) {
    if (u[key] !== undefined && u[key] !== asset[key]) {
      data[key] = u[key];
      prev[key] = asset[key];
    }
  }
  if (u.newTag && u.newTag !== asset.assetTag) {
    data.assetTag = u.newTag;
    prev.assetTag = asset.assetTag;
  }
  if (Object.keys(data).length === 0) continue;
  await prisma.asset.update({ where: { id: asset.id }, data });
  await audit('ASSET_UPDATED', 'Asset', asset.id, prev, { ...data, source: 'gadget-register-2026-08' });
  fieldUpdates += 1;
}
console.log(`asset field updates: ${fieldUpdates}`);

// 4 - reassignments (close old assignment, open new, flip holder) ------------
for (const r of payload.reassignments) {
  const asset = await prisma.asset.findFirst({
    where: { companyId: company.id, assetTag: r.assetTag },
  });
  if (!asset) {
    console.warn(`SKIP reassign - no asset ${r.assetTag}`);
    continue;
  }
  const toUserId = await userByEmail(r.toEmail);
  if (!toUserId || asset.assignedUserId === toUserId) continue;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.assetAssignment.updateMany({
      where: { assetId: asset.id, returnedAt: null },
      data: { returnedAt: now, notes: r.closeNote },
    });
    await tx.assetAssignment.create({
      data: {
        assetId: asset.id,
        userId: toUserId,
        assignedAt: now,
        conditionOut: asset.condition,
        accessoriesIssued: r.accessories ?? null,
        notes: 'Gadget register update 2026-08',
      },
    });
    await tx.asset.update({
      where: { id: asset.id },
      data: { assignedUserId: toUserId, assignmentDate: now, status: 'ASSIGNED', ...DIMS.ASSIGNED },
    });
  });
  await audit('ASSIGNMENT_CREATED', 'Asset', asset.id, { assignedUserId: asset.assignedUserId }, { assignedUserId: toUserId, source: 'gadget-register-2026-08' });
  console.log(`reassigned ${r.assetTag} -> ${r.toEmail}`);
}

// 5 - new assets -------------------------------------------------------------
for (const a of payload.newAssets) {
  const existing = await prisma.asset.findFirst({
    where: { companyId: company.id, assetTag: a.assetTag },
    select: { id: true },
  });
  if (existing) {
    console.log(`SKIP create - ${a.assetTag} already exists`);
    continue;
  }
  const category = await prisma.category.findFirst({
    where: { companyId: company.id, key: 'it-assets' },
    select: { id: true },
  });
  const userId = await userByEmail(a.holderEmail);
  if (!userId) continue;
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
        categoryId: category.id,
        status: 'ASSIGNED',
        condition: 'GOOD',
        notes: a.notes,
        assignedUserId: userId,
        assignmentDate: now,
        ...DIMS.ASSIGNED,
      },
      select: { id: true },
    });
    await tx.assetAssignment.create({
      data: {
        assetId: asset.id,
        userId,
        assignedAt: now,
        conditionOut: 'GOOD',
        accessoriesIssued: a.accessories ?? null,
        notes: 'Gadget register update 2026-08',
      },
    });
    await audit('ASSET_CREATED', 'Asset', asset.id, null, { assetTag: a.assetTag, source: 'gadget-register-2026-08' });
  });
  console.log(`created ${a.assetTag} -> ${a.holderEmail}`);
}

const counts = await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*)::int FROM assets WHERE "companyId"='${company.id}' AND "deletedAt" IS NULL) AS assets,
          (SELECT count(*)::int FROM user_profiles p JOIN users u ON u.id=p."userId" WHERE u."companyId"='${company.id}' AND p."employeeNumber" IS NOT NULL) AS with_emp`,
);
console.log('tenant now:', counts[0]);
await prisma.$disconnect();
