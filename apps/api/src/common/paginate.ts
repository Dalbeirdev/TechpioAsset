import { buildPageMeta, type PageQuery } from '@techpioasset/contracts';

/**
 * Runs a count and a page query, returning the envelope shape the response
 * interceptor passes through untouched.
 */
export async function paginate<T>(
  query: PageQuery,
  runner: {
    count: () => Promise<number>;
    findMany: (args: { skip: number; take: number }) => Promise<T[]>;
  },
) {
  const skip = (query.page - 1) * query.pageSize;
  const [totalItems, data] = await Promise.all([
    runner.count(),
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
