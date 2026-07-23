import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { StorageProvider } from './storage.provider.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { AzureBlobStorageProvider } from './azure-blob-storage.provider.js';
import { S3StorageProvider } from './s3-storage.provider.js';

/**
 * The storage provider is chosen by STORAGE_PROVIDER. All three implement the
 * same StorageProvider interface, so no call site changes when the deployment
 * switches from local dev storage to Azure Blob or S3. Each real provider throws
 * in its constructor if selected without the credentials it needs, so a
 * misconfiguration fails fast at boot rather than on the first upload.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageProvider,
      useFactory: (config: AppConfig): StorageProvider => {
        switch (config.get('STORAGE_PROVIDER')) {
          case 'azure':
            return new AzureBlobStorageProvider(config);
          case 's3':
            return new S3StorageProvider(config);
          default:
            return new LocalStorageProvider(config);
        }
      },
      inject: [AppConfig],
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
