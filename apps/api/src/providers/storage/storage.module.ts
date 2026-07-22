import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { StorageProvider } from './storage.provider.js';
import { LocalStorageProvider } from './local-storage.provider.js';

/**
 * Only the local provider is wired for now. Azure Blob and S3 implementations
 * conform to the same StorageProvider interface and are selected here by
 * STORAGE_PROVIDER once their SDKs and credentials are supplied — no call site
 * changes, because everything depends on the abstract class.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageProvider,
      useFactory: (config: AppConfig): StorageProvider => {
        switch (config.get('STORAGE_PROVIDER')) {
          case 'azure':
          case 's3':
            // Guarded rather than silently falling back: shipping to production
            // with STORAGE_PROVIDER=azure but the local provider running would be
            // a data-durability incident waiting to happen.
            throw new Error(
              `STORAGE_PROVIDER=${config.get('STORAGE_PROVIDER')} is not yet wired. ` +
                'Implement the corresponding StorageProvider and register it here.',
            );
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
