import { Global, Module } from '@nestjs/common';
import { AiDocumentProvider } from './ai-document.provider.js';
import { RoutingAiProvider } from './routing-ai.provider.js';

@Global()
@Module({
  providers: [
    RoutingAiProvider,
    // Call sites depend on the abstract class; since v2.15 the concrete
    // behaviour is decided per-extraction by the router (DB settings first,
    // env second, mock last), because the provider is now editable from the
    // operator console and must take effect without a restart.
    { provide: AiDocumentProvider, useExisting: RoutingAiProvider },
  ],
  exports: [AiDocumentProvider, RoutingAiProvider],
})
export class AiModule {}
