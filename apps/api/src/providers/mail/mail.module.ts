import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { MailProvider } from './mail.provider.js';
import { LocalMailProvider } from './local-mail.provider.js';
import { SmtpMailProvider } from './smtp-mail.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: MailProvider,
      // Selected once at startup from configuration. Call sites depend on the
      // abstract class, so swapping providers needs no application changes.
      useFactory: (config: AppConfig): MailProvider =>
        config.get('MAIL_PROVIDER') === 'smtp'
          ? new SmtpMailProvider(config)
          : new LocalMailProvider(config),
      inject: [AppConfig],
    },
  ],
  exports: [MailProvider],
})
export class MailModule {}
