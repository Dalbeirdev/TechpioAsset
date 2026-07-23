import { Injectable } from '@nestjs/common';
import { CacheProvider } from './cache.provider.js';

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * In-memory cache for local dev and tests. Per-process and non-durable — a
 * restart clears it — which is exactly right for a cache. Expired entries are
 * dropped lazily on read; nothing here needs a sweep timer at this scale.
 */
@Injectable()
export class InMemoryCacheProvider extends CacheProvider {
  readonly name = 'memory';
  private readonly store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async shutdown(): Promise<void> {
    this.store.clear();
  }
}
