import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  latestBackup,
  pruneBackups,
  targetFromEnv,
  uploadBackup,
  type BackupTarget,
} from './backup-storage';

/**
 * v2.8 S1 — verified against a real S3-compatible HTTP endpoint running
 * in-process: the AWS SDK signs and sends genuine requests to it, so the
 * upload path (PUT -> HEAD verification -> list -> delete) is exercised for
 * real rather than mocked away.
 *
 * Honest limitation: this proves the protocol conversation, not a particular
 * cloud vendor's quirks. No cloud credentials exist in this environment, so
 * the connector ships built-to-contract - the same statement made about the
 * Intune connector and SCIM.
 */

interface StoredObject {
  body: Buffer;
  lastModified: Date;
}

let server: Server;
let target: BackupTarget;
const objects = new Map<string, StoredObject>();
/** Lets a test make the destination lie about the size it stored. */
let headSizeOverride: number | null = null;

function listXml(bucket: string, prefix: string): string {
  const entries = [...objects.entries()].filter(([key]) => key.startsWith(prefix));
  const contents = entries
    .map(
      ([key, object]) =>
        `<Contents><Key>${key}</Key><LastModified>${object.lastModified.toISOString()}</LastModified>` +
        `<ETag>&quot;x&quot;</ETag><Size>${object.body.byteLength}</Size>` +
        `<StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${entries.length}</KeyCount>` +
    `<MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Path-style addressing: /{bucket}/{key...}
    const [, bucket, ...rest] = url.pathname.split('/');
    const key = rest.join('/');

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        objects.set(key, { body: Buffer.concat(chunks), lastModified: new Date() });
        res.writeHead(200, { ETag: '"x"' }).end();
      });
      return;
    }
    if (req.method === 'HEAD') {
      const object = objects.get(key);
      if (!object) return void res.writeHead(404).end();
      const size = headSizeOverride ?? object.body.byteLength;
      return void res.writeHead(200, { 'Content-Length': String(size) }).end();
    }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const xml = listXml(bucket ?? '', url.searchParams.get('prefix') ?? '');
      return void res
        .writeHead(200, { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(xml) })
        .end(xml);
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      return void res.writeHead(204).end();
    }
    res.writeHead(400).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  target = {
    bucket: 'techpio-backups',
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    forcePathStyle: true,
    prefix: 'techpioasset',
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  objects.clear();
  headSizeOverride = null;
});

describe('uploadBackup', () => {
  it('uploads under a prefixed key and verifies the destination really has it', async () => {
    const body = Buffer.from('fake gzipped dump contents');
    const result = await uploadBackup(target, 'techpioasset_2026-08-03_120000.sql.gz', body);

    expect(result.key).toBe('techpioasset/techpioasset_2026-08-03_120000.sql.gz');
    expect(result.bytes).toBe(body.byteLength);
    expect(result.verifiedBytes).toBe(body.byteLength);
    expect(objects.get(result.key)!.body.equals(body)).toBe(true);
  });

  it('FAILS when the destination stored something other than what we sent', async () => {
    // The failure mode a bare PUT cannot catch: a proxy or quota truncates the
    // object, the PUT still returns 200, and you believe you have a backup.
    headSizeOverride = 3;
    await expect(
      uploadBackup(target, 'truncated.sql.gz', Buffer.from('much longer than three bytes')),
    ).rejects.toThrow(/verification failed/i);
  });
});

describe('pruneBackups', () => {
  it('removes copies older than the retention window and keeps the rest', async () => {
    const now = new Date('2026-08-03T00:00:00Z');
    const day = 86_400_000;
    objects.set('techpioasset/old.sql.gz', {
      body: Buffer.from('old'),
      lastModified: new Date(now.getTime() - 20 * day),
    });
    objects.set('techpioasset/recent.sql.gz', {
      body: Buffer.from('recent'),
      lastModified: new Date(now.getTime() - 2 * day),
    });
    // Another tenant of the same bucket must not be touched.
    objects.set('someone-else/ancient.sql.gz', {
      body: Buffer.from('theirs'),
      lastModified: new Date(now.getTime() - 400 * day),
    });

    const removed = await pruneBackups(target, 14, now);

    expect(removed).toEqual(['techpioasset/old.sql.gz']);
    expect(objects.has('techpioasset/recent.sql.gz')).toBe(true);
    expect(objects.has('someone-else/ancient.sql.gz')).toBe(true);
  });

  it('refuses a nonsensical retention window rather than deleting everything', async () => {
    await expect(pruneBackups(target, 0)).rejects.toThrow(/at least 1/);
  });
});

describe('latestBackup', () => {
  it('reports the newest copy, or null when there is none', async () => {
    expect(await latestBackup(target)).toBeNull();

    objects.set('techpioasset/older.sql.gz', {
      body: Buffer.from('a'),
      lastModified: new Date('2026-08-01T00:00:00Z'),
    });
    objects.set('techpioasset/newer.sql.gz', {
      body: Buffer.from('bb'),
      lastModified: new Date('2026-08-03T00:00:00Z'),
    });

    const latest = await latestBackup(target);
    expect(latest!.key).toBe('techpioasset/newer.sql.gz');
    expect(latest!.bytes).toBe(2);
  });
});

describe('targetFromEnv', () => {
  it('returns null unless a bucket and both credentials are present', () => {
    expect(targetFromEnv({})).toBeNull();
    expect(targetFromEnv({ BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY_ID: 'k' })).toBeNull();
  });

  it('defaults the region and honours a custom endpoint', () => {
    const parsed = targetFromEnv({
      BACKUP_S3_BUCKET: 'b',
      BACKUP_S3_ACCESS_KEY_ID: 'k',
      BACKUP_S3_SECRET_ACCESS_KEY: 's',
      BACKUP_S3_ENDPOINT: 'https://s3.example.test',
    })!;
    expect(parsed.region).toBe('us-east-1');
    expect(parsed.endpoint).toBe('https://s3.example.test');
    expect(parsed.prefix).toBeUndefined(); // uploadBackup applies the default
  });
});
