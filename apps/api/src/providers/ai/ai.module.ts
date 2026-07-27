import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { AiDocumentProvider } from './ai-document.provider.js';
import { MockAiProvider } from './mock-ai.provider.js';
import { AzureAiProvider } from './azure-ai.provider.js';
import { AnthropicAiProvider } from './anthropic-ai.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: AiDocumentProvider,
      useFactory: (config: AppConfig): AiDocumentProvider => {
        switch (config.get('AI_PROVIDER')) {
          case 'anthropic':
            return new AnthropicAiProvider(config);
          case 'azure':
            return new AzureAiProvider(config);
          default:
            return new MockAiProvider();
        }
      },
      inject: [AppConfig],
    },
  ],
  exports: [AiDocumentProvider],
})
export class AiModule {}
