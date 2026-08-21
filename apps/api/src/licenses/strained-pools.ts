import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Licences with at least one seat pool at or near capacity (v2.26).
 *
 * The dashboard tile counted POOLS while calling itself "Licenses near
 * capacity", and linked to the licence list - so its number could never match
 * its own destination, and the label named the wrong thing besides. A licence
 * with three strained pools counted as three.
 *
 * The 0.9 ratio compares two columns, which a Prisma `where` cannot express, so
 * the pools are read and grouped here. Both the tile and the list's
 * `nearCapacity` filter call this, so the count and the filtered list are the
 * same set by construction rather than by agreement.
 */

/** At 90% of allocated seats reserved, a pool is close enough to be worth saying. */
const STRAIN_RATIO = 0.9;

export interface StrainedLicenses {
  /** Licence ids with at least one strained pool. */
  ids: string[];
  /** Of those, the ones with a pool that is completely full. */
  fullCount: number;
}

export async function strainedLicenses(
  // The extended client shape, not the bare PrismaClient - they are not
  // assignable to one another.
  db: Pick<PrismaService['client'], 'seatPool'>,
  companyId: string,
): Promise<StrainedLicenses> {
  const pools = await db.seatPool.findMany({
    where: { companyId, license: { status: { not: 'RETIRED' } } },
    select: { licenseId: true, seatsAllocated: true, seatsReserved: true },
  });

  const ids = new Set<string>();
  const full = new Set<string>();
  for (const p of pools) {
    if (p.seatsAllocated <= 0) continue;
    if (p.seatsReserved / p.seatsAllocated < STRAIN_RATIO) continue;
    ids.add(p.licenseId);
    if (p.seatsReserved >= p.seatsAllocated) full.add(p.licenseId);
  }
  return { ids: [...ids], fullCount: full.size };
}
