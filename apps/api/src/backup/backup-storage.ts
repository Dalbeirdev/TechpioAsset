import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * v2.8 S1 — off-site backup shipping.
 *
 * Until now every dump lived on the same machine as the database it protects,
 * so a host loss took the data and the recovery material together. This
 * uploads the nightly dump to object storage and, crucially, VERIFIES it
 * arrived (a PUT that returns 200 to a proxy that swallowed the body is not a
 * backup).
 *
 * S3-compatible on purpose: the same code reaches AWS, Backblaze B2, Wasabi,
 * Cloudflare R2, MinIO or any other endpoint an operator already has.
 */

export interface BackupTarget {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for non-AWS providers; omit for AWS itself. */
  endpoint?: string;
  /** Non-AWS endpoints generally need path-style addressing. */
  forcePathStyle?: boolean;
  /** Key prefix, so backups can share a bucket with other things. */
  prefix?: string;
}

export interface UploadResult {
  key: string;
  bytes: number;
  /** Size the destination reports back — proof it actually landed. */
  verifiedBytes: number;
}

export function createClient(target: BackupTarget): S3Client {
  return new S3Client({
    region: target.region,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
    ...(target.endpoint ? { endpoint: target.endpoint } : {}),
    forcePathStyle: target.forcePathStyle ?? Boolean(target.endpoint),
  });
}

function keyFor(target: BackupTarget, filename: string): string {
  const prefix = (target.prefix ?? 'techpioasset').replace(/^\/+|\/+$/g, '');
  return `${prefix}/${filename}`;
}

/**
 * Upload and verify. Throws on any failure — the caller (backup-db.sh) keeps
 * the local dump and raises an alert rather than reporting a backup that only
 * exists in a log line.
 */
export async function uploadBackup(
  target: BackupTarget,
  filename: string,
  body: Buffer,
  client = createClient(target),
): Promise<UploadResult> {
  const key = keyFor(target, filename);

  await client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
    }),
  );

  // Verify rather than trust: ask the destination how big the object is.
  const head = await client.send(
    new HeadObjectCommand({ Bucket: target.bucket, Key: key }),
  );
  const verifiedBytes = head.ContentLength ?? 0;
  if (verifiedBytes !== body.byteLength) {
    throw new Error(
      `Off-site verification failed for ${key}: uploaded ${body.byteLength} bytes, ` +
        `destination reports ${verifiedBytes}`,
    );
  }

  return { key, bytes: body.byteLength, verifiedBytes };
}

/**
 * Off-site retention. Mirrors the local KEEP_DAYS policy so the remote copy
 * does not grow without bound. Returns the keys removed.
 */
export async function pruneBackups(
  target: BackupTarget,
  keepDays: number,
  now: Date = new Date(),
  client = createClient(target),
): Promise<string[]> {
  if (keepDays < 1) throw new Error('keepDays must be at least 1');
  const cutoff = now.getTime() - keepDays * 86_400_000;
  const prefix = keyFor(target, '').replace(/\/$/, '');

  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: target.bucket, Prefix: prefix }),
  );
  const removed: string[] = [];
  for (const object of listed.Contents ?? []) {
    if (!object.Key || !object.LastModified) continue;
    if (object.LastModified.getTime() >= cutoff) continue;
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: object.Key }));
    removed.push(object.Key);
  }
  return removed;
}

/** The newest backup off-site, for the freshness answer in /health/ready (S6). */
export async function latestBackup(
  target: BackupTarget,
  client = createClient(target),
): Promise<{ key: string; lastModified: Date; bytes: number } | null> {
  const prefix = keyFor(target, '').replace(/\/$/, '');
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: target.bucket, Prefix: prefix }),
  );
  const newest = (listed.Contents ?? [])
    .filter((o) => o.Key && o.LastModified)
    .sort((a, b) => b.LastModified!.getTime() - a.LastModified!.getTime())[0];
  if (!newest) return null;
  return {
    key: newest.Key!,
    lastModified: newest.LastModified!,
    bytes: newest.Size ?? 0,
  };
}

/** Reads the target from the environment; null means "no off-site configured". */
export function targetFromEnv(env: NodeJS.ProcessEnv = process.env): BackupTarget | null {
  const bucket = env.BACKUP_S3_BUCKET;
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.BACKUP_S3_REGION ?? 'us-east-1',
    ...(env.BACKUP_S3_ENDPOINT ? { endpoint: env.BACKUP_S3_ENDPOINT } : {}),
    ...(env.BACKUP_S3_PREFIX ? { prefix: env.BACKUP_S3_PREFIX } : {}),
  };
}
