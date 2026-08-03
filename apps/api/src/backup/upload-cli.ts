/**
 * v2.8 S1 — the CLI `backup-db.sh` pipes a dump into.
 *
 * Runs inside the api container (which already has node, the SDK and the
 * production env), so the host needs no cloud tooling installed. Reads the
 * gzipped dump on stdin, uploads it, verifies it, prunes old off-site copies,
 * and prints one JSON line. Exit code is the contract: non-zero means the
 * off-site copy did NOT happen, and the caller must keep the local dump and
 * shout about it.
 *
 *   cat dump.sql.gz | node dist/backup/upload-cli.js <filename> [keepDays]
 */
import { pruneBackups, targetFromEnv, uploadBackup } from './backup-storage.js';

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const filename = process.argv[2];
  const keepDays = Number(process.argv[3] ?? 14);
  if (!filename) throw new Error('usage: upload-cli <filename> [keepDays]');

  const target = targetFromEnv();
  if (!target) {
    // Not an error: a deployment with no off-site destination is a supported
    // (if weaker) configuration. Say so plainly so the caller can report it.
    console.log(JSON.stringify({ status: 'skipped', reason: 'no off-site destination configured' }));
    return;
  }

  const body = await readStdin();
  if (body.byteLength === 0) throw new Error('refusing to upload an empty dump');

  const result = await uploadBackup(target, filename, body);
  const pruned = await pruneBackups(target, keepDays);
  console.log(
    JSON.stringify({
      status: 'uploaded',
      bucket: target.bucket,
      key: result.key,
      bytes: result.bytes,
      verifiedBytes: result.verifiedBytes,
      prunedCount: pruned.length,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
