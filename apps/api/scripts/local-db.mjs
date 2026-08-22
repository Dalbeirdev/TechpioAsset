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
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
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
  // Force UTF-8 storage. Without this, initdb on Windows inherits the OS locale
  // (e.g. WIN1252) and every multi-byte character - accented names, non-Latin
  // scripts, emoji - fails to insert with a 500. locale=C keeps collation
  // portable and deterministic across developer machines.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

/**
 * Shut the cluster down by DATA DIRECTORY rather than by object handle.
 *
 * `pg.stop()` only knows about a server this same process started. Run from a
 * second terminal - which is the whole point of `--stop` - it has no handle,
 * stops nothing, and still resolves: the command printed "Local PostgreSQL
 * stopped." while the server carried on serving on 5432. A stop command that
 * lies is worse than one that fails, because the next thing you do is assume
 * the port is free.
 *
 * `pg_ctl` acts on the directory, so it works from anywhere and reports the
 * truth either way. `-m fast` rolls back open transactions and closes cleanly,
 * rather than leaving the cluster to recover on next start.
 */
async function stopByDataDir() {
  // The binaries live in a per-platform package that resolves only from inside
  // embedded-postgres' own folder, so reuse the resolver it ships rather than
  // guessing at a path that changes with the package manager's layout.
  const entry = createRequire(path.join(process.cwd(), 'package.json')).resolve('embedded-postgres');
  const { default: getBinaries } = await import(
    pathToFileURL(path.join(path.dirname(entry), 'binary.js')).href
  );
  const { pg_ctl: pgCtl } = await getBinaries();

  const result = spawnSync(pgCtl, ['-D', DATA_DIR, '-m', 'fast', 'stop'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.status === 0) {
    console.log('Local PostgreSQL stopped.');
    return;
  }
  // pg_ctl exits non-zero when there was nothing to stop, and says so two ways:
  // "no server running" when the PID file is stale, and 'PID file ... does not
  // exist / Is server running?' when it is absent. Both mean the cluster is
  // down, which is the state being asked for - so report it and succeed, rather
  // than failing a teardown step for doing its job.
  if (/no server running|does not exist|is server running\?/i.test(output)) {
    console.log('Local PostgreSQL was not running.');
    return;
  }
  console.error(output || `pg_ctl exited with ${result.status}`);
  process.exitCode = 1;
}

/** In-process shutdown: this script owns the server, so the handle is real. */
async function stop() {
  await pg.stop();
  console.log('Local PostgreSQL stopped.');
}

if (process.argv.includes('--stop')) {
  await stopByDataDir();
  process.exit(process.exitCode ?? 0);
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
