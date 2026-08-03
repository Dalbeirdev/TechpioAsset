import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { provisionRlsRole } from './rls-role.js';

/**
 * v2.7 R1 — global setup for the RLS-ON lane. Provisions the non-superuser
 * app role using the ADMIN connection from the repo .env BEFORE the app boots
 * as that role (the lane's own DATABASE_URL is the app role, which obviously
 * cannot create itself).
 */
export default async function setup(): Promise<void> {
  const env = parse(readFileSync(path.resolve(process.cwd(), '../../.env')));
  const adminUrl = env.DATABASE_URL;
  if (!adminUrl) throw new Error('No DATABASE_URL in the repo .env - cannot provision the RLS role');
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  try {
    await provisionRlsRole(admin);
  } finally {
    await admin.$disconnect();
  }
}
