import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';
import { ulid } from 'ulid';
import { AppConfig } from '../../config/config.module.js';
import {
  StorageProvider,
  type PutObjectInput,
  type SignedUrl,
  type StoredObject,
} from './storage.provider.js';

/**
 * Azure Blob Storage provider (spec section 28).
 *
 * Objects are stored in a private container under opaque ULID keys, and access
 * is always via a short-lived SAS URL minted per request — never a public URL
 * (spec section 20). The account key is parsed from the connection string so the
 * SAS can be signed; a connection string without an account key (SAS-only) can
 * store and read but cannot mint SAS URLs, and that is refused rather than
 * silently returning something unusable.
 */
@Injectable()
export class AzureBlobStorageProvider extends StorageProvider {
  readonly name = 'azure';
  readonly durable = true;

  private readonly logger = new Logger(AzureBlobStorageProvider.name);
  private readonly container: ContainerClient;
  private readonly sharedKey: StorageSharedKeyCredential | null;

  constructor(config: AppConfig) {
    super();
    const connectionString = config.get('AZURE_STORAGE_CONNECTION_STRING');
    if (!connectionString) {
      throw new Error('STORAGE_PROVIDER=azure requires AZURE_STORAGE_CONNECTION_STRING');
    }
    const service = BlobServiceClient.fromConnectionString(connectionString);
    this.container = service.getContainerClient(config.get('STORAGE_CONTAINER'));

    const { accountName, accountKey } = parseConnectionString(connectionString);
    this.sharedKey =
      accountName && accountKey ? new StorageSharedKeyCredential(accountName, accountKey) : null;

    this.logger.log(`Azure Blob storage ready (container "${this.container.containerName}")`);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = `${input.prefix}/${ulid()}`;
    const blob = this.container.getBlockBlobClient(key);
    await blob.uploadData(input.data, {
      blobHTTPHeaders: { blobContentType: input.contentType },
    });
    return {
      key,
      sizeBytes: input.data.length,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    return this.container.getBlockBlobClient(key).downloadToBuffer();
  }

  async delete(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    if (!this.sharedKey) {
      throw new Error('Cannot sign an Azure URL: the connection string has no account key');
    }
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const blob = this.container.getBlockBlobClient(key);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        // A small backdated start absorbs minor clock skew between hosts.
        startsOn: new Date(Date.now() - 60_000),
        expiresOn: expiresAt,
      },
      this.sharedKey,
    ).toString();
    return { url: `${blob.url}?${sas}`, expiresAt, simulated: false };
  }
}

/** Parses AccountName/AccountKey out of an Azure Storage connection string. */
function parseConnectionString(conn: string): {
  accountName?: string;
  accountKey?: string;
} {
  const parts: Record<string, string> = {};
  for (const segment of conn.split(';')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq)] = segment.slice(eq + 1);
  }
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}
