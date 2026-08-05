import { buildPageMeta, type PageQuery } from '@techpioasset/contracts';
import type { CacheProvider } from '../providers/cache/cache.provider.js';

/**
 * Runs a count and a page query, returning the envelope shape the response
 * interceptor passes through untouched.
 */
export async function paginate<T>(
  query: PageQuery,
  runner: {
    count: () => Promise<number>;
    findMany: (args: { skip: number; take: number }) => Promise<T[]>;
    /**
     * v2.10 S6 — optional short-lived cache for the total.
     *
     * Offset pagination needs a total, and on an append-only table of two
     * million rows an exact `count(*)` is a parallel index-only scan over every
     * entry: 78 ms measured, and the dominant cost of `/audit` once its page
     * query was indexed down to 0.1 ms.
     *
     * Passing this makes the TOTAL up to `ttlSeconds` stale while the PAGE
     * stays exact. That trade is only offered here; each caller decides whether
     * a slightly old total is acceptable for its data.
     */
    countCache?: { key: string; ttlSeconds: number; cache: CacheProvider };
  },
) {
  const skip = (query.page - 1) * query.pageSize;
  const countTotal = runner.countCache
    ? () =>
        runner.countCache!.cache.wrap(
          runner.countCache!.key,
          runner.countCache!.ttlSeconds,
          runner.count,
        )
    : runner.count;
  const [totalItems, data] = await Promise.all([
    countTotal(),
    runner.findMany({ skip, take: query.pageSize }),
  ]);

  return {
    data,
    meta: {
      page: buildPageMeta({ page: query.page, pageSize: query.pageSize, totalItems }),
    },
  };
}

/**
 * Builds a Prisma orderBy from a caller-supplied sort field.
 *
 * `allowed` is a whitelist, not a suggestion: passing the raw query value through
 * would let a caller order by any column, including ones they cannot read, and
 * infer their values from the ordering.
 */
export function buildOrderBy<T extends string>(
  sort: string | undefined,
  order: 'asc' | 'desc',
  allowed: readonly T[],
  fallback: T,
): Record<string, 'asc' | 'desc'> {
  const field = sort && (allowed as readonly string[]).includes(sort) ? sort : fallback;
  return { [field]: order };
}
