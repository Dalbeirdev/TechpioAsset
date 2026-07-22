/**
 * Storage abstraction for the offline queue.
 *
 * The queue manager depends on this interface, not on a concrete store, so its
 * logic can be unit-tested with an in-memory implementation and run in production
 * on expo-sqlite. Keeping the dependency injected is what makes the manager
 * testable without a device.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Deterministic in-memory store, for tests and as a reference implementation. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}
