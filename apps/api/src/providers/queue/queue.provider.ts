/**
 * Background job execution behind a provider interface (spec sections 1, 28).
 *
 * Spec section 1 specifies BullMQ on Redis. Redis is not available on every
 * developer machine — notably there is no user-space Redis on Windows — so the
 * queue is abstracted exactly like storage, AI, mail and push. The in-process
 * implementation runs the same handlers with the same retry semantics; the
 * BullMQ implementation is selected by configuration.
 *
 * The distinction that matters: in-process jobs do not survive a restart and do
 * not distribute across instances. `/health/ready` reports which is active, and
 * the difference is documented rather than glossed over.
 */

export interface JobHandlerContext {
  jobId: string;
  attempt: number;
}

export type JobHandler<T> = (payload: T, context: JobHandlerContext) => Promise<void>;

export interface EnqueueOptions {
  /** Delay before first execution, milliseconds. */
  delayMs?: number;
  /** Total attempts including the first. Defaults to 3. */
  attempts?: number;
}

export interface EnqueueResult {
  jobId: string;
  /** True when running in-process rather than on a durable queue. */
  inProcess: boolean;
}

export abstract class QueueProvider {
  abstract readonly name: string;
  /** True when jobs survive a process restart. */
  abstract readonly durable: boolean;

  abstract register<T>(jobName: string, handler: JobHandler<T>): void;
  abstract enqueue<T>(
    jobName: string,
    payload: T,
    options?: EnqueueOptions,
  ): Promise<EnqueueResult>;
  abstract shutdown(): Promise<void>;
}
