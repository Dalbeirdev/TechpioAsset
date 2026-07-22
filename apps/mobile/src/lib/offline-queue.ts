import {
  operationsToRetain,
  summariseQueue,
  mayQueueOffline,
  type OfflineOperation,
  type OperationResult,
  type QueueStatus,
} from '@techpioasset/domain';
import type { KeyValueStore } from './storage';

/**
 * The device-side offline queue (spec section 16).
 *
 * Persists queued operations, uploads them when connectivity returns, and applies
 * the server's per-operation results — dropping what succeeded, keeping conflicts
 * and rejections for the user to resolve. All of the decision logic lives in the
 * shared, tested `@techpioasset/domain` functions; this class only orchestrates
 * persistence and the network call, which is why it can be unit-tested with an
 * in-memory store and a stub uploader.
 */

const QUEUE_KEY = 'techpioasset.offline.queue';

export type BatchUploader = (
  operations: OfflineOperation[],
  sessionId?: string,
) => Promise<{ results: OperationResult[] }>;

export class OfflineQueue {
  constructor(private readonly store: KeyValueStore) {}

  private async read(): Promise<OfflineOperation[]> {
    const raw = await this.store.get(QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as OfflineOperation[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // A corrupt queue is dropped rather than crashing the app on launch; the
      // operations it held are lost, which is preferable to an unusable device.
      return [];
    }
  }

  private async write(operations: OfflineOperation[]): Promise<void> {
    await this.store.set(QUEUE_KEY, JSON.stringify(operations));
  }

  /**
   * Enqueues an operation, refusing the online-only types (auth, AI, financial
   * approval) that spec section 16 says must not be captured offline.
   */
  async enqueue(operation: OfflineOperation): Promise<void> {
    if (!mayQueueOffline(operation.type)) {
      throw new Error(`${operation.type} may not be queued offline; it requires a connection.`);
    }
    const queue = await this.read();
    // Guard against a double-tap enqueuing the same client id twice.
    if (queue.some((op) => op.clientGeneratedId === operation.clientGeneratedId)) return;
    queue.push(operation);
    await this.write(queue);
  }

  async pendingCount(): Promise<number> {
    return (await this.read()).length;
  }

  async pending(): Promise<OfflineOperation[]> {
    return this.read();
  }

  /**
   * Uploads the queue and reconciles the response.
   *
   * On any network failure the queue is left untouched, so nothing is lost and
   * the next flush retries everything — safe because the server is idempotent on
   * clientGeneratedId. On success, applied and duplicate operations are dropped
   * and conflicts/rejections are retained.
   */
  async flush(uploader: BatchUploader, sessionId?: string): Promise<QueueStatus> {
    const queue = await this.read();
    if (queue.length === 0) return summariseQueue([], 0);

    let results: OperationResult[];
    try {
      ({ results } = await uploader(queue, sessionId));
    } catch {
      // Offline again mid-flush: keep everything, report it all still pending.
      return summariseQueue([], queue.length);
    }

    const retained = operationsToRetain(queue, results);
    await this.write(retained);

    return summariseQueue(results, retained.length);
  }

  /** Discards a conflicted/rejected operation the user chose not to keep. */
  async discard(clientGeneratedId: string): Promise<void> {
    const queue = await this.read();
    await this.write(queue.filter((op) => op.clientGeneratedId !== clientGeneratedId));
  }

  async clear(): Promise<void> {
    await this.store.delete(QUEUE_KEY);
  }
}
