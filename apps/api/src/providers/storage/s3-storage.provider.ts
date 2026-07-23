import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { AppConfig } from '../../config/config.module.js';
import {
  StorageProvider,
  type PutObjectInput,
  type SignedUrl,
  type StoredObject,
} from './storage.provider.js';

/**
 * Amazon S3 (or any S3-compatible) storage provider (spec section 28).
 *
 * Objects live in a private bucket under opaque ULID keys; downloads use a
 * pre-signed GET URL minted per request, never a public object URL (spec
 * section 20). Explicit credentials are used when supplied; otherwise the SDK's
 * default provider chain (IAM role, env, shared profile) applies, which is the
 * preferred production posture.
 */
@Injectable()
export class S3StorageProvider extends StorageProvider {
  readonly name = 's3';
  readonly durable = true;

  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    super();
    const region = config.get('S3_REGION');
    this.bucket = config.get('S3_BUCKET') ?? '';
    if (!region || !this.bucket) {
      throw new Error('STORAGE_PROVIDER=s3 requires S3_REGION and S3_BUCKET');
    }
    const accessKeyId = config.get('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY');
    this.client = new S3Client({
      region,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
    this.logger.log(`S3 storage ready (bucket "${this.bucket}", region "${region}")`);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = `${input.prefix}/${ulid()}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.data,
        ContentType: input.contentType,
      }),
    );
    return {
      key,
      sizeBytes: input.data.length,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000), simulated: false };
  }
}
