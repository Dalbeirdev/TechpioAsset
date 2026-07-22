import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { PushProvider } from './push.provider.js';
import { MockPushProvider } from './mock-push.provider.js';
import { ExpoPushProvider } from './expo-push.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: PushProvider,
      useFactory: (config: AppConfig): PushProvider =>
        config.get('PUSH_PROVIDER') === 'expo' ? new ExpoPushProvider() : new MockPushProvider(),
      inject: [AppConfig],
    },
  ],
  exports: [PushProvider],
})
export class PushModule {}
