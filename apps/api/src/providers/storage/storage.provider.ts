/**
 * Object storage behind a provider interface (spec sections 1, 20, 28).
 *
 * Documents are private. They are never served by a public URL — spec section 20
 * is explicit: "Never expose invoice documents through public URLs." Access is
 * always through a short-lived signed URL minted per request after a permission
 * check. The local implementation simulates that with an opaque, expiring token;
 * the Azure and S3 implementations use the real signing APIs.
 */

export interface StoredObject {
  /** Opaque storage key. Never a filesystem path or a guessable name. */
  key: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
  /** True when the URL points at the local dev server rather than a real CDN. */
  simulated: boolean;
}

export interface PutObjectInput {
  /** Logical container/prefix, e.g. `invoices/<companyId>`. */
  prefix: string;
  originalName: string;
  contentType: string;
  data: Buffer;
}

export abstract class StorageProvider {
  abstract readonly name: string;
  /** True when objects live on real durable object storage. */
  abstract readonly durable: boolean;

  abstract put(input: PutObjectInput): Promise<StoredObject>;
  abstract getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl>;
  /** Reads bytes back — used by the AI extraction path, never exposed to clients. */
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}
