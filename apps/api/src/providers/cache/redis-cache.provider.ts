import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/config.module.js';
import { CacheProvider } from './cache.provider.js';

/**
 * Redis-backed cache (spec section 1). Values are JSON-serialised under a
 * `cache:` key prefix with a native Redis TTL, so expiry is enforced by Redis
 * rather than by this process. Selected with CACHE_PROVIDER=redis.
 */
@Injectable()
export class RedisCacheProvider extends CacheProvider {
  readonly name = 'redis';

  private readonly logger = new Logger(RedisCacheProvider.name);
  private readonly redis: Redis;

  constructor(config: AppConfig) {
    super();
    this.redis = new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: 2 });
    // A cache must never take the app down. Log connection errors and degrade to
    // cache-miss behaviour rather than throwing on every request.
    this.redis.on('error', (err) => this.logger.warn(`Redis cache error: ${err.message}`));
  }

  private prefixed(key: string): string {
    return `cache:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.prefixed(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(this.prefixed(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* a failed cache write is not an error the caller should see */
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefixed(key));
    } catch {
      /* ignore */
    }
  }

  async shutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
