import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * The monorepo keeps a single `.env` at the repo root so the API, the web app and
 * Compose all read the same values. The Prisma CLI resolves relative to this
 * package, so the root file is loaded explicitly rather than duplicated per app.
 *
 * Every db:* script runs via `pnpm --filter @techpioasset/api`, which sets the
 * working directory to apps/api.
 */
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed/index.ts',
  },
});
