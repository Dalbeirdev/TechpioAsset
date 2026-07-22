/**
 * Local PostgreSQL for development without Docker.
 *
 * Runs a real PostgreSQL server from user-space binaries - no Docker, no WSL, no
 * administrator rights, no system service. This exists because Compose is not
 * available on every developer machine and the alternative (an in-memory or
 * WASM stand-in) would mean testing against something that is not the database
 * we deploy to.
 *
 * Compose remains the primary path; see README. This is the fallback.
 *
 *   node scripts/local-db.mjs          start and stay in the foreground
 *   node scripts/local-db.mjs --stop   stop a running instance
 */
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import EmbeddedPostgres from 'embedded-postgres';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const DATA_DIR = path.resolve(process.cwd(), '.local-db');
const DATABASE = 'techpioasset';

/** Parsed from DATABASE_URL so the cluster and Prisma cannot disagree. */
function connectionSettings() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  return {
    user: decodeURIComponent(url.username || 'techpioasset'),
    password: decodeURIComponent(url.password || 'techpioasset'),
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, '') || DATABASE,
  };
}

const settings = connectionSettings();

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: settings.user,
  password: settings.password,
  port: settings.port,
  persistent: true,
  onLog: () => {},
});

async function stop() {
  await pg.stop();
  console.log('Local PostgreSQL stopped.');
}

if (process.argv.includes('--stop')) {
  await stop();
  process.exit(0);
}

const { existsSync } = await import('node:fs');
if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
  console.log(`Initialising a new cluster at ${DATA_DIR} ...`);
  await pg.initialise();
}

await pg.start();

// createDatabase throws if it already exists; that is the normal case on restart.
try {
  await pg.createDatabase(settings.database);
  console.log(`Created database "${settings.database}".`);
} catch {
  console.log(`Database "${settings.database}" already present.`);
}

console.log(
  `Local PostgreSQL listening on port ${settings.port} as "${settings.user}". ` +
    'Press Ctrl+C to stop.',
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}

// Hold the process open; the server runs as a child of this script.
setInterval(() => {}, 1 << 30);
