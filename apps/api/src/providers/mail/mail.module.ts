import { Global, Module } from '@nestjs/common';
import { MailProvider } from './mail.provider.js';
import { RoutingMailProvider } from './routing-mail.provider.js';

@Global()
@Module({
  providers: [
    RoutingMailProvider,
    // Call sites depend on the abstract class; since v2.12 the concrete
    // behaviour is decided per-send by the router (DB settings first, env
    // SMTP second, simulated last), because SMTP is now editable from the
    // operator console and must take effect without a restart.
    { provide: MailProvider, useExisting: RoutingMailProvider },
  ],
  exports: [MailProvider, RoutingMailProvider],
})
export class MailModule {}
