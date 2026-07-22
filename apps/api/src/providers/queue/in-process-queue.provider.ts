import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  QueueProvider,
  type EnqueueOptions,
  type EnqueueResult,
  type JobHandler,
} from './queue.provider.js';

/**
 * Runs jobs in this process, off the request path.
 *
 * Deliberately still asynchronous with retry and backoff, so handlers are written
 * against the same contract they will meet on BullMQ. The two things it cannot
 * offer are durability across restarts and distribution across instances, which
 * is why `durable` is false and readiness reports it.
 */
@Injectable()
export class InProcessQueueProvider extends QueueProvider {
  readonly name = 'in-process';
  readonly durable = false;

  private readonly logger = new Logger(InProcessQueueProvider.name);
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly pending = new Set<NodeJS.Timeout>();
  private stopped = false;

  register<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler<unknown>);
  }

  async enqueue<T>(
    jobName: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const jobId = `job_${ulid()}`;
    const attempts = options.attempts ?? 3;

    if (!this.handlers.has(jobName)) {
      // Losing a job silently because nobody registered a handler is the kind of
      // fault that surfaces weeks later as "we never got the email".
      this.logger.error(`No handler registered for job "${jobName}"; job ${jobId} discarded`);
      return { jobId, inProcess: true };
    }

    this.schedule(jobName, jobId, payload, 1, attempts, options.delayMs ?? 0);
    return { jobId, inProcess: true };
  }

  private schedule<T>(
    jobName: string,
    jobId: string,
    payload: T,
    attempt: number,
    maxAttempts: number,
    delayMs: number,
  ): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      this.pending.delete(timer);
      void this.run(jobName, jobId, payload, attempt, maxAttempts);
    }, delayMs);

    // unref so a queued job cannot hold the process open during shutdown.
    timer.unref?.();
    this.pending.add(timer);
  }

  private async run<T>(
    jobName: string,
    jobId: string,
    payload: T,
    attempt: number,
    maxAttempts: number,
  ): Promise<void> {
    const handler = this.handlers.get(jobName);
    if (!handler) return;

    try {
      await handler(payload, { jobId, attempt });
    } catch (error) {
      const message = (error as Error).message;
      if (attempt >= maxAttempts) {
        this.logger.error(
          `Job ${jobName} (${jobId}) failed permanently after ${attempt} attempts: ${message}`,
        );
        return;
      }
      // Exponential backoff, matching BullMQ's default shape so retry behaviour
      // does not change when the provider is swapped.
      const backoff = 2 ** (attempt - 1) * 1000;
      this.logger.warn(
        `Job ${jobName} (${jobId}) attempt ${attempt} failed: ${message}. Retrying in ${backoff}ms`,
      );
      this.schedule(jobName, jobId, payload, attempt + 1, maxAttempts, backoff);
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }
}
