import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { DiscoveryProvider } from './discovery.provider.js';
import { MockDiscoveryProvider } from './mock-discovery.provider.js';
import { IntuneDiscoveryProvider } from './intune-discovery.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: DiscoveryProvider,
      useFactory: (config: AppConfig): DiscoveryProvider => {
        switch (config.get('DISCOVERY_PROVIDER')) {
          case 'intune':
            return new IntuneDiscoveryProvider(config);
          default:
            return new MockDiscoveryProvider();
        }
      },
      inject: [AppConfig],
    },
  ],
  exports: [DiscoveryProvider],
})
export class DiscoveryProviderModule {}
