import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { ChatProvider } from './chat.provider.js';
import { MockChatProvider } from './mock-chat.provider.js';
import { WebhookChatProvider } from './webhook-chat.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: ChatProvider,
      useFactory: (config: AppConfig): ChatProvider =>
        config.get('CHAT_PROVIDER') === 'webhook'
          ? new WebhookChatProvider()
          : new MockChatProvider(),
      inject: [AppConfig],
    },
  ],
  exports: [ChatProvider],
})
export class ChatModule {}
