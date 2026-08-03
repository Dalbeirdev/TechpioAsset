/**
 * License seat math and lifecycle derivation — v2.3 (blueprint Part A).
 *
 * Pure logic only: the transactional seat reservation lives in the API's
 * licenses module; everything here must be safe to run identically on web,
 * mobile, and server. Seats available/used are always DERIVED — the only
 * authoritative stored number is SeatPool.seatsReserved.
 */

export const LICENSE_STATUSES = ['ACTIVE', 'EXPIRING', 'EXPIRED', 'RETIRED'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_UNITS = ['USER', 'DEVICE'] as const;
export type LicenseUnit = (typeof LICENSE_UNITS)[number];

/** A licence within this many days of expiry counts as EXPIRING. */
export const LICENSE_EXPIRY_WARN_DAYS = 90;

/** Pools at or above this share of allocated seats trigger a utilization alert. */
export const HIGH_UTILIZATION_THRESHOLD = 0.9;

/** Sweep notification buckets, in days-until-expiry (checked in this order). */
/** v2.7 R4: 7 joins the ladder - a week out is the last useful nudge. */
export const LICENSE_EXPIRY_BUCKETS = [7, 30, 60, 90] as const;
export type LicenseExpiryBucket = (typeof LICENSE_EXPIRY_BUCKETS)[number];

const DAY = 86_400_000;

/**
 * Lifecycle from dates. RETIRED is an explicit administrative state and wins;
 * a licence with no expiry (perpetual) is simply ACTIVE.
 */
export function deriveLicenseStatus(
  expiryDate: Date | null | undefined,
  now: Date,
  retired = false,
): LicenseStatus {
  if (retired) return 'RETIRED';
  if (!expiryDate) return 'ACTIVE';
  const remaining = expiryDate.getTime() - now.getTime();
  if (remaining < 0) return 'EXPIRED';
  if (remaining <= LICENSE_EXPIRY_WARN_DAYS * DAY) return 'EXPIRING';
  return 'ACTIVE';
}

/** Whole days until expiry, rounded up; negative when already expired. */
export function daysUntilExpiry(expiryDate: Date, now: Date): number {
  return Math.ceil((expiryDate.getTime() - now.getTime()) / DAY);
}

/**
 * The sweep bucket an expiry currently falls in, or null when it is more than
 * the largest bucket away (or already expired — expiry is its own event).
 */
export function expiryBucket(expiryDate: Date, now: Date): LicenseExpiryBucket | null {
  const days = daysUntilExpiry(expiryDate, now);
  if (days < 0) return null;
  for (const bucket of LICENSE_EXPIRY_BUCKETS) {
    if (days <= bucket) return bucket;
  }
  return null;
}

/** Free seats in a pool. Never negative, whatever the inputs claim. */
export function seatsAvailable(seatsAllocated: number, seatsReserved: number): number {
  return Math.max(0, seatsAllocated - seatsReserved);
}

/** Reserved share of a pool or licence, clamped to [0, 1]. Empty pools are 0. */
export function seatUtilization(seatsAllocated: number, seatsReserved: number): number {
  if (seatsAllocated <= 0) return 0;
  return Math.min(1, Math.max(0, seatsReserved / seatsAllocated));
}

export function isHighUtilization(seatsAllocated: number, seatsReserved: number): boolean {
  return seatsAllocated > 0 && seatUtilization(seatsAllocated, seatsReserved) >= HIGH_UTILIZATION_THRESHOLD;
}

/**
 * A licence's pool allocations may never promise more seats than were bought.
 * Returns the problem as a message so callers surface it verbatim.
 */
export function validatePoolAllocations(
  seatsPurchased: number,
  allocations: readonly number[],
): { ok: boolean; total: number; message?: string } {
  if (allocations.some((a) => a < 0 || !Number.isInteger(a))) {
    return { ok: false, total: 0, message: 'Seat allocations must be whole numbers of 0 or more' };
  }
  const total = allocations.reduce((sum, a) => sum + a, 0);
  if (total > seatsPurchased) {
    return {
      ok: false,
      total,
      message: `Pools allocate ${total} seats but only ${seatsPurchased} were purchased`,
    };
  }
  return { ok: true, total };
}

/**
 * Validates that an assignment names exactly one principal of the kind the
 * licence's unit demands. Returns the principal column to set, or an error.
 */
export function resolveAssignmentPrincipal(
  unit: LicenseUnit,
  principal: { userId?: string | null; assetId?: string | null },
): { ok: true; field: 'userId' | 'assetId'; id: string } | { ok: false; message: string } {
  const hasUser = !!principal.userId;
  const hasAsset = !!principal.assetId;
  if (hasUser === hasAsset) {
    return { ok: false, message: 'Provide exactly one of userId or assetId' };
  }
  if (unit === 'USER' && !hasUser) {
    return { ok: false, message: 'This licence assigns per user — provide a userId' };
  }
  if (unit === 'DEVICE' && !hasAsset) {
    return { ok: false, message: 'This licence assigns per device — provide an assetId' };
  }
  return hasUser
    ? { ok: true, field: 'userId', id: principal.userId as string }
    : { ok: true, field: 'assetId', id: principal.assetId as string };
}

/**
 * The honest numbers shown when a seat is refused (blueprint §A.7's
 * "License Limit Exceeded / Available: 0 / Purchased: N / Assigned: N").
 */
export function seatLimitMessage(snapshot: {
  purchased: number;
  reserved: number;
}): string {
  const available = seatsAvailable(snapshot.purchased, snapshot.reserved);
  return (
    `License limit exceeded. Available: ${available} / Purchased: ${snapshot.purchased} / ` +
    `Assigned: ${snapshot.reserved}. Purchase additional seats or reclaim unused ones.`
  );
}
