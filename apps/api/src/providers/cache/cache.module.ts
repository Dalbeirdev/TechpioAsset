import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { CacheProvider } from './cache.provider.js';
import { InMemoryCacheProvider } from './in-memory-cache.provider.js';
import { RedisCacheProvider } from './redis-cache.provider.js';

/**
 * Selects the cache backend by CACHE_PROVIDER (in-memory by default, Redis in
 * production). Global so any service can inject CacheProvider.
 */
@Global()
@Module({
  providers: [
    {
      provide: CacheProvider,
      useFactory: (config: AppConfig): CacheProvider =>
        config.get('CACHE_PROVIDER') === 'redis'
          ? new RedisCacheProvider(config)
          : new InMemoryCacheProvider(),
      inject: [AppConfig],
    },
  ],
  exports: [CacheProvider],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(private readonly cache: CacheProvider) {}

  async onApplicationShutdown(): Promise<void> {
    await this.cache.shutdown();
  }
}
