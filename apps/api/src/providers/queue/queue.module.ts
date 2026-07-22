import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { QueueProvider } from './queue.provider.js';
import { InProcessQueueProvider } from './in-process-queue.provider.js';
import { BullMqQueueProvider } from './bullmq-queue.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: QueueProvider,
      useFactory: (config: AppConfig): QueueProvider =>
        config.get('QUEUE_PROVIDER') === 'bullmq'
          ? new BullMqQueueProvider(config)
          : new InProcessQueueProvider(),
      inject: [AppConfig],
    },
  ],
  exports: [QueueProvider],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(private readonly queue: QueueProvider) {}

  /** Drains timers and closes Redis connections so tests and restarts exit cleanly. */
  async onApplicationShutdown(): Promise<void> {
    await this.queue.shutdown();
  }
}
