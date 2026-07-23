import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryCacheProvider } from './in-memory-cache.provider.js';

describe('InMemoryCacheProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stores and returns a value within its TTL', async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set('k', { n: 1 }, 60);
    expect(await cache.get<{ n: number }>('k')).toEqual({ n: 1 });
  });

  it('returns null for a missing key', async () => {
    const cache = new InMemoryCacheProvider();
    expect(await cache.get('nope')).toBeNull();
  });

  it('expires a value after its TTL', async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set('k', 'v', 10);
    vi.advanceTimersByTime(9_000);
    expect(await cache.get('k')).toBe('v');
    vi.advanceTimersByTime(2_000);
    expect(await cache.get('k')).toBeNull();
  });

  it('del removes a value', async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set('k', 'v', 60);
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  describe('wrap (cache-aside)', () => {
    it('computes on a miss, then serves from cache on the next call', async () => {
      const cache = new InMemoryCacheProvider();
      const compute = vi.fn().mockResolvedValue('computed');

      expect(await cache.wrap('k', 60, compute)).toBe('computed');
      expect(await cache.wrap('k', 60, compute)).toBe('computed');
      // Computed once; the second call was a cache hit.
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('does not cache a computation that throws', async () => {
      const cache = new InMemoryCacheProvider();
      const boom = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(cache.wrap('k', 60, boom)).rejects.toThrow('fail');
      // Nothing was stored, so a later success is what gets cached.
      const ok = vi.fn().mockResolvedValue('ok');
      expect(await cache.wrap('k', 60, ok)).toBe('ok');
      expect(ok).toHaveBeenCalledTimes(1);
    });

    it('recomputes after the cached value expires', async () => {
      const cache = new InMemoryCacheProvider();
      const compute = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
      expect(await cache.wrap('k', 10, compute)).toBe('first');
      vi.advanceTimersByTime(11_000);
      expect(await cache.wrap('k', 10, compute)).toBe('second');
      expect(compute).toHaveBeenCalledTimes(2);
    });
  });
});
