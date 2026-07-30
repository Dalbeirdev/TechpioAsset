import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { ARGON2_PARAMS } from '../../src/auth/argon2-params.js';

/**
 * Production super-admin bootstrap.
 *
 * The reference-data seed (`pnpm seed`) deliberately creates NO users when
 * NODE_ENV=production, so a fresh production database has no way to log in. This
 * script creates exactly one SUPER_ADMIN from environment variables:
 *
 *   SEED_ADMIN_EMAIL     - the login email (required)
 *   SEED_ADMIN_PASSWORD  - the initial password (required; min 12 chars)
 *   SEED_ADMIN_NAME      - display name (optional; defaults to "Super Admin")
 *
 * It is idempotent: re-running it resets the password and re-asserts the role
 * for that email rather than creating duplicates. It never prints the password.
 *
 * Run AFTER migrations and the reference seed:
 *   docker compose -f docker-compose.prod.yml exec api pnpm seed:admin
 */

// Local runs read the repo .env; in the container the values come from env_file,
// so a missing file here is harmless.
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Super Admin';

  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required. Set them in .env.prod, then re-run.',
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`SEED_ADMIN_EMAIL is not a valid email address: ${email}`);
  }
  const minLength = Number(process.env.PASSWORD_MIN_LENGTH ?? 12);
  if (password.length < minLength) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${minLength} characters.`);
  }

  // The reference seed creates the single company and the system roles. If they
  // are absent, the operator skipped `pnpm seed` — fail loudly rather than
  // silently creating an admin with no company or permissions.
  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    throw new Error('No company found. Run `pnpm seed` (reference data) before creating an admin.');
  }
  const role = await prisma.role.findUnique({
    where: { companyId_key: { companyId: company.id, key: 'SUPER_ADMIN' } },
  });
  if (!role) {
    throw new Error('SUPER_ADMIN role not found. Run `pnpm seed` before creating an admin.');
  }

  const passwordHash = await hash(password, ARGON2_PARAMS);
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(' ') || 'Admin';

  const user = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email } },
    update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), lockedUntil: null, failedLoginCount: 0 },
    create: {
      companyId: company.id,
      email,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: { firstName: firstName ?? 'Super', lastName, displayName: name },
    create: {
      userId: user.id,
      firstName: firstName ?? 'Super',
      lastName,
      displayName: name,
      jobTitle: 'Administrator',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  console.log(`\n✔ Super admin ready: ${email} (company: ${company.name})`);
  console.log('  Log in with the password from SEED_ADMIN_PASSWORD, then change it in the app.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error('\nAdmin bootstrap failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
