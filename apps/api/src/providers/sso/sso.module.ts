import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { SsoProvider } from './sso.provider.js';
import { EntraSsoProvider } from './entra-sso.provider.js';
import { DisabledSsoProvider } from './disabled-sso.provider.js';

/**
 * Enables Entra ID SSO only when all three Entra settings are present; otherwise
 * the disabled provider is wired. Global so the auth controller can inject it.
 */
@Global()
@Module({
  providers: [
    {
      provide: SsoProvider,
      useFactory: (config: AppConfig): SsoProvider => {
        const configured =
          config.get('ENTRA_TENANT_ID') &&
          config.get('ENTRA_CLIENT_ID') &&
          config.get('ENTRA_CLIENT_SECRET');
        return configured ? new EntraSsoProvider(config) : new DisabledSsoProvider();
      },
      inject: [AppConfig],
    },
  ],
  exports: [SsoProvider],
})
export class SsoModule {}
