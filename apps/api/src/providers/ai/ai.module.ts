import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { AiDocumentProvider } from './ai-document.provider.js';
import { MockAiProvider } from './mock-ai.provider.js';
import { AzureAiProvider } from './azure-ai.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: AiDocumentProvider,
      useFactory: (config: AppConfig): AiDocumentProvider =>
        config.get('AI_PROVIDER') === 'azure' ? new AzureAiProvider(config) : new MockAiProvider(),
      inject: [AppConfig],
    },
  ],
  exports: [AiDocumentProvider],
})
export class AiModule {}
