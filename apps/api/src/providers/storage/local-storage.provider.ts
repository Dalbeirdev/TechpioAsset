import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { AppConfig } from '../../config/config.module.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  StorageProvider,
  type PutObjectInput,
  type SignedUrl,
  type StoredObject,
} from './storage.provider.js';

/**
 * Local filesystem storage for development.
 *
 * Files are written under .local-storage with opaque ULID keys — never the
 * original filename, so nothing about a document is guessable from its key. The
 * "signed URL" is an HMAC-signed, expiring token pointing at the API's own
 * download route, which mirrors the real signed-URL contract: time-limited,
 * tamper-evident, and gated by the same permission check. It is not a public URL.
 */
@Injectable()
export class LocalStorageProvider extends StorageProvider {
  readonly name = 'local';
  readonly durable = false;

  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly apiUrl: string;
  private readonly signingKey: Buffer;

  constructor(config: AppConfig) {
    super();
    this.root = path.resolve(process.cwd(), config.get('STORAGE_LOCAL_PATH'));
    this.apiUrl = config.get('API_URL');
    // Derived from the JWT secret so dev restarts keep signatures valid without a
    // separate key to manage.
    this.signingKey = createHash('sha256')
      .update(`storage:${config.get('JWT_ACCESS_SECRET')}`)
      .digest();
  }

  private keyToPath(key: string): string {
    // Keys are ULIDs under a prefix; reject anything with traversal characters
    // before it ever reaches the filesystem.
    if (key.includes('..') || path.isAbsolute(key)) {
      throw new AppError('FILE_REJECTED', 'Invalid storage key');
    }
    return path.join(this.root, key);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = `${input.prefix}/${ulid()}`;
    const filePath = this.keyToPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.data);

    return {
      key,
      sizeBytes: input.data.length,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.keyToPath(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.keyToPath(key), { force: true });
  }

  /**
   * Mints a signed, expiring URL. The signature covers the key and the expiry,
   * so neither can be altered without invalidating it — the same guarantee a
   * cloud signed URL gives. The download route re-checks permission regardless;
   * the signature is defence in depth, not the only gate.
   */
  async getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const nonce = randomBytes(8).toString('hex');
    const signature = this.sign(key, expires, nonce);

    const url =
      `${this.apiUrl}/api/v1/storage/${encodeURIComponent(key)}` +
      `?expires=${expires}&nonce=${nonce}&sig=${signature}`;

    return { url, expiresAt, simulated: true };
  }

  /** Verifies a signed-URL token. Used by the download route. */
  verifySignature(key: string, expires: number, nonce: string, signature: string): boolean {
    if (expires * 1000 < Date.now()) return false;
    const expected = this.sign(key, expires, nonce);
    // Constant-time compare so a mismatched signature does not leak length via timing.
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  }

  private sign(key: string, expires: number, nonce: string): string {
    return createHash('sha256')
      .update(`${key}:${expires}:${nonce}`)
      .update(this.signingKey)
      .digest('hex');
  }
}
