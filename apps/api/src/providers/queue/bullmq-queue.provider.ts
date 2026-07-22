import { Injectable, Logger } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { ulid } from 'ulid';
import { AppConfig } from '../../config/config.module.js';
import {
  QueueProvider,
  type EnqueueOptions,
  type EnqueueResult,
  type JobHandler,
} from './queue.provider.js';

const QUEUE_NAME = 'techpioasset';

/**
 * Durable queue on Redis (spec section 1). Selected with QUEUE_PROVIDER=bullmq.
 *
 * One queue with a job name discriminator rather than a queue per job type: the
 * job set is small, and a single worker keeps concurrency and shutdown in one
 * place instead of spread across a growing list of workers.
 */
@Injectable()
export class BullMqQueueProvider extends QueueProvider {
  readonly name = 'bullmq';
  readonly durable = true;

  private readonly logger = new Logger(BullMqQueueProvider.name);
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly connection: ConnectionOptions;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(config: AppConfig) {
    super();
    const url = new URL(config.get('REDIS_URL'));
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      // BullMQ requires this to be null; it manages its own retry semantics.
      maxRetriesPerRequest: null,
    };
  }

  private ensureStarted(): Queue {
    this.queue ??= new Queue(QUEUE_NAME, { connection: this.connection });

    this.worker ??= new Worker(
      QUEUE_NAME,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) {
          this.logger.error(`No handler registered for job "${job.name}" (${job.id})`);
          return;
        }
        await handler(job.data, { jobId: job.id ?? 'unknown', attempt: job.attemptsMade + 1 });
      },
      { connection: this.connection, concurrency: 5 },
    );

    return this.queue;
  }

  register<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler<unknown>);
    this.ensureStarted();
  }

  async enqueue<T>(
    jobName: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const queue = this.ensureStarted();
    const job = await queue.add(jobName, payload, {
      delay: options.delayMs,
      attempts: options.attempts ?? 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 1000 },
      // Failures are kept far longer than successes; they are the ones anyone
      // ever needs to inspect.
      removeOnFail: { age: 86_400 * 7 },
    });

    return { jobId: job.id ?? `job_${ulid()}`, inProcess: false };
  }

  async shutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
