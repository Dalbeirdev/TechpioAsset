import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  isReadOnlyPermission,
  READ_ONLY_ROLES,
  assertGrantAllowed,
  type SystemRole,
} from '@techpioasset/domain';
import { CATEGORY_SEED } from './catalogue.js';
import { seedDemo } from './demo.js';

// Run via `pnpm seed`, which sets the working directory to apps/api.
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * Phase 0 seed: reference data only.
 *
 * Idempotent throughout - every write is an upsert keyed on a natural key, so a
 * re-run against a populated database changes nothing. Demonstration accounts and
 * sample assets (spec section 25) arrive in Phase 1 with authentication, because
 * seeding a user before password hashing exists would mean seeding a login nobody
 * can use.
 */

const prisma = new PrismaClient();

const ROLE_LABELS: Record<SystemRole, { name: string; description: string }> = {
  SUPER_ADMIN: { name: 'Super Admin', description: 'Full system access.' },
  IT_ADMIN: {
    name: 'IT Administrator',
    description: 'Manages IT equipment, assignments, warranties and device lifecycle.',
  },
  HR: {
    name: 'HR',
    description:
      'Manages employees, onboarding and offboarding. No financial invoice access unless granted.',
  },
  OFFICE_ADMIN: {
    name: 'Office Administrator',
    description: 'Manages furniture, kitchen equipment, pantry stock and office supplies.',
  },
  FINANCE: {
    name: 'Finance',
    description: 'Reviews costs, verifies invoices, approves purchases and tracks vendor spend.',
  },
  MANAGER: {
    name: 'Manager',
    description: 'Reviews and approves requests raised by direct reports.',
  },
  EMPLOYEE: {
    name: 'Registered Employee',
    description: 'Views own assets, raises requests, reports damage and submits returns.',
  },
  AUDITOR: {
    name: 'Auditor',
    description: 'Read-only access to assets, invoices, approvals, audit logs and reports.',
  },
};

async function seedPermissions(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const key of ALL_PERMISSIONS) {
    const [resource, ...rest] = key.split(':');
    const action = rest.join(':');
    const record = await prisma.permission.upsert({
      where: { key },
      update: { resource: resource ?? key, action, isReadOnly: isReadOnlyPermission(key) },
      create: {
        key,
        resource: resource ?? key,
        action,
        isReadOnly: isReadOnlyPermission(key),
        description: `${action} on ${resource}`,
      },
    });
    ids.set(key, record.id);
  }

  console.log(`  permissions           ${ids.size}`);
  return ids;
}

async function seedCompany(): Promise<string> {
  const existing = await prisma.company.findFirst({ where: { name: 'Techpio Demo Company' } });
  if (existing) {
    console.log('  company               reused');
    return existing.id;
  }
  const company = await prisma.company.create({
    data: {
      name: 'Techpio Demo Company',
      legalName: 'Techpio Demo Company Ltd.',
      baseCurrency: 'USD',
      locale: 'en-US',
      timezone: 'UTC',
    },
  });
  console.log('  company               created');
  return company.id;
}

async function seedRoles(companyId: string, permissionIds: Map<string, string>): Promise<void> {
  for (const roleKey of SYSTEM_ROLES) {
    const label = ROLE_LABELS[roleKey];
    const isReadOnly = READ_ONLY_ROLES.includes(roleKey);

    const role = await prisma.role.upsert({
      where: { companyId_key: { companyId, key: roleKey } },
      update: { name: label.name, description: label.description, isSystem: true, isReadOnly },
      create: {
        companyId,
        key: roleKey,
        name: label.name,
        description: label.description,
        isSystem: true,
        isReadOnly,
      },
    });

    const grants = ROLE_PERMISSIONS[roleKey];
    // Belt and braces: the same invariant the unit tests assert is re-checked at
    // seed time, so a future edit to the matrix cannot quietly hand the Auditor a
    // write grant in a real database.
    for (const permission of grants) assertGrantAllowed(roleKey, permission);

    const rows: Prisma.RolePermissionCreateManyInput[] = grants.flatMap((permission) => {
      const permissionId = permissionIds.get(permission);
      return permissionId ? [{ roleId: role.id, permissionId }] : [];
    });

    await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });

    // Drop grants that the matrix no longer contains, so re-seeding after a
    // permission is revoked actually revokes it.
    const grantedIds = rows.map((r) => r.permissionId);
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: grantedIds } },
    });

    console.log(`  role ${roleKey.padEnd(16)} ${rows.length} permissions`);
  }
}

async function seedCategories(companyId: string): Promise<void> {
  let categoryCount = 0;
  let subcategoryCount = 0;

  for (const [index, category] of CATEGORY_SEED.entries()) {
    const record = await prisma.category.upsert({
      where: { companyId_key: { companyId, key: category.key } },
      update: {
        name: category.name,
        icon: category.icon,
        sortOrder: index,
        defaultTrackingType: category.defaultTrackingType,
      },
      create: {
        companyId,
        key: category.key,
        name: category.name,
        icon: category.icon,
        sortOrder: index,
        defaultTrackingType: category.defaultTrackingType,
      },
    });
    categoryCount += 1;

    for (const [subIndex, subcategory] of category.subcategories.entries()) {
      await prisma.subcategory.upsert({
        where: { categoryId_key: { categoryId: record.id, key: subcategory.key } },
        update: { name: subcategory.name, sortOrder: subIndex },
        create: {
          categoryId: record.id,
          key: subcategory.key,
          name: subcategory.name,
          sortOrder: subIndex,
        },
      });
      subcategoryCount += 1;
    }
  }

  console.log(`  categories            ${categoryCount} (${subcategoryCount} subcategories)`);
}

async function seedAiConfiguration(companyId: string): Promise<void> {
  // Spec section 10 recommended defaults. AI is off, human review is required and
  // automatic financial approval is disabled - all three must be deliberate opt-ins.
  const featureModes: Record<string, string> = {
    INVOICE_OCR: 'MANUAL_REVIEW_REQUIRED',
    INVOICE_FIELD_EXTRACTION: 'MANUAL_REVIEW_REQUIRED',
    LINE_ITEM_EXTRACTION: 'MANUAL_REVIEW_REQUIRED',
    CATEGORY_SUGGESTION: 'SUGGESTION_ONLY',
    VENDOR_SUGGESTION: 'SUGGESTION_ONLY',
    INVOICE_TO_ASSET_MATCHING: 'MANUAL_REVIEW_REQUIRED',
    DUPLICATE_WARNING: 'SUGGESTION_ONLY',
    WARRANTY_EXTRACTION: 'SUGGESTION_ONLY',
    DRAFT_ASSET_CREATION: 'MANUAL_REVIEW_REQUIRED',
    AI_SUMMARIES: 'DISABLED',
    AI_ASSISTANT: 'DISABLED',
    SEMANTIC_SEARCH: 'DISABLED',
  };

  await prisma.aIConfiguration.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      globallyEnabled: false,
      featureModes,
      confidenceThreshold: '0.85',
      alertThresholdPct: 80,
      retentionDays: 365,
      automaticFinancialApproval: false,
      humanReviewRequired: true,
      providerName: process.env.AI_PROVIDER ?? 'mock',
    },
  });

  console.log('  ai configuration      disabled, human review required');
}

async function main(): Promise<void> {
  console.log('Seeding TechpioAsset reference data...\n');

  const permissionIds = await seedPermissions();
  const companyId = await seedCompany();
  await seedRoles(companyId, permissionIds);
  await seedCategories(companyId);
  await seedAiConfiguration(companyId);

  // Demonstration accounts share one published password. Loading them into a
  // production database would hand out administrator access, so this is refused
  // outright rather than left to operator discipline.
  if (process.env.NODE_ENV === 'production') {
    console.log('\nNODE_ENV=production - demonstration data skipped.');
  } else if (process.env.SEED_DEMO === 'false') {
    console.log('\nSEED_DEMO=false - demonstration data skipped.');
  } else {
    await seedDemo(prisma, companyId);
  }

  console.log('\nSeed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error('\nSeed failed:', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
