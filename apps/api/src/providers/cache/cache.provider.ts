/**
 * Cache abstraction (spec section 1: Redis for caching).
 *
 * Behind an interface for the same reason as storage and the queue: local dev
 * and tests use a zero-dependency in-memory implementation, while production
 * points at Redis by setting CACHE_PROVIDER=redis. Call sites depend only on
 * this abstract class, so nothing changes when the backend does.
 */
export abstract class CacheProvider {
  abstract readonly name: string;

  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract shutdown(): Promise<void>;

  /**
   * Cache-aside: return the cached value, or compute it, store it, and return it.
   * A compute error is never cached — only successful results are stored.
   */
  async wrap<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
