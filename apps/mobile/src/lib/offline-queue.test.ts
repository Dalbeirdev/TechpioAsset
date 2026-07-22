import { describe, it, expect, beforeEach } from 'vitest';
import type { OfflineOperation, OperationResult } from '@techpioasset/domain';
import { OfflineQueue } from './offline-queue';
import { MemoryStore } from './storage';

/**
 * The mobile offline queue's own logic, tested with an in-memory store and a stub
 * uploader — no React Native, no device. This is the part of the mobile app that
 * can be verified in this environment, and it is the part where a bug loses a
 * warehouse worker's whole afternoon of scans, so it is tested hard.
 */

let store: MemoryStore;
let queue: OfflineQueue;

beforeEach(() => {
  store = new MemoryStore();
  queue = new OfflineQueue(store);
});

function scan(id: string): OfflineOperation {
  return {
    clientGeneratedId: id,
    type: 'INVENTORY_SCAN',
    entityId: null,
    payload: { scannedCode: `CODE-${id}` },
    capturedAt: '2026-07-01T10:00:00.000Z',
  };
}

describe('enqueue', () => {
  it('adds operations and counts them', async () => {
    await queue.enqueue(scan('a'));
    await queue.enqueue(scan('b'));
    expect(await queue.pendingCount()).toBe(2);
  });

  it('is idempotent on a double-tap of the same client id', async () => {
    await queue.enqueue(scan('a'));
    await queue.enqueue(scan('a'));
    expect(await queue.pendingCount()).toBe(1);
  });

  it('refuses to queue an online-only operation (spec section 16)', async () => {
    await expect(queue.enqueue({ ...scan('a'), type: 'AI_EXTRACTION' as never })).rejects.toThrow(
      /requires a connection/i,
    );
  });
});

describe('flush', () => {
  it('drops applied operations and keeps conflicts and rejections', async () => {
    await queue.enqueue(scan('a'));
    await queue.enqueue(scan('b'));
    await queue.enqueue(scan('c'));

    const status = await queue.flush(async (): Promise<{ results: OperationResult[] }> => ({
      results: [
        { clientGeneratedId: 'a', outcome: 'APPLIED' },
        { clientGeneratedId: 'b', outcome: 'CONFLICT' },
        { clientGeneratedId: 'c', outcome: 'REJECTED' },
      ],
    }));

    expect(status.applied).toBe(1);
    expect(status.conflict).toBe(1);
    expect(status.rejected).toBe(1);
    // a is gone; b and c remain for the user to resolve.
    expect((await queue.pending()).map((o) => o.clientGeneratedId)).toEqual(['b', 'c']);
  });

  it('treats a duplicate result as resolved and drops it', async () => {
    await queue.enqueue(scan('a'));
    await queue.flush(async () => ({
      results: [{ clientGeneratedId: 'a', outcome: 'DUPLICATE' }],
    }));
    expect(await queue.pendingCount()).toBe(0);
  });

  it('loses nothing when the upload throws (still offline)', async () => {
    await queue.enqueue(scan('a'));
    await queue.enqueue(scan('b'));

    const status = await queue.flush(async () => {
      throw new Error('network down');
    });

    // Everything is retained and reported pending, safe to retry.
    expect(status.pending).toBe(2);
    expect(await queue.pendingCount()).toBe(2);
  });

  it('is a no-op on an empty queue', async () => {
    const status = await queue.flush(async () => ({ results: [] }));
    expect(status.clean).toBe(true);
  });

  it('retrying after a partial success is safe (server is idempotent)', async () => {
    await queue.enqueue(scan('a'));
    await queue.enqueue(scan('b'));

    // First flush applies a, leaves b (imagine the connection dropped mid-batch
    // and the server only answered for a).
    await queue.flush(async () => ({ results: [{ clientGeneratedId: 'a', outcome: 'APPLIED' }] }));
    expect((await queue.pending()).map((o) => o.clientGeneratedId)).toEqual(['b']);

    // Retry: b applies, and if a were somehow resent it would come back DUPLICATE.
    await queue.flush(async () => ({ results: [{ clientGeneratedId: 'b', outcome: 'APPLIED' }] }));
    expect(await queue.pendingCount()).toBe(0);
  });
});

describe('discard and clear', () => {
  it('discards a single conflicted operation the user rejected', async () => {
    await queue.enqueue(scan('a'));
    await queue.enqueue(scan('b'));
    await queue.discard('a');
    expect((await queue.pending()).map((o) => o.clientGeneratedId)).toEqual(['b']);
  });

  it('clears the whole queue', async () => {
    await queue.enqueue(scan('a'));
    await queue.clear();
    expect(await queue.pendingCount()).toBe(0);
  });
});

describe('resilience', () => {
  it('recovers from a corrupt persisted queue rather than crashing', async () => {
    await store.set('techpioasset.offline.queue', '{ this is not valid json');
    expect(await queue.pendingCount()).toBe(0);
    // And it can be used normally afterwards.
    await queue.enqueue(scan('a'));
    expect(await queue.pendingCount()).toBe(1);
  });
});
