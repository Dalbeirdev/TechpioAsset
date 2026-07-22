import Decimal from 'decimal.js';
import { money } from './money';

/**
 * Warranty windows and repair-versus-replace guidance (spec section 14).
 *
 * Pure classification and comparison. The spec asks the dashboard to show
 * "warranties expiring in 30, 60, and 90 days" and "repair cost compared with
 * replacement cost"; both are decided here so the rules are testable and shared
 * between the API's alert sweep and the web dashboard.
 */

export const WARRANTY_BUCKETS = [
  'EXPIRED',
  'WITHIN_30',
  'WITHIN_60',
  'WITHIN_90',
  'BEYOND_90',
  'NONE',
] as const;
export type WarrantyBucket = (typeof WARRANTY_BUCKETS)[number];

const DAY = 86_400_000;

/** Buckets a warranty end date relative to `asOf`. */
export function warrantyBucket(
  warrantyEndDate: Date | null | undefined,
  asOf: Date,
): WarrantyBucket {
  if (!warrantyEndDate) return 'NONE';
  const remainingDays = Math.ceil((warrantyEndDate.getTime() - asOf.getTime()) / DAY);
  if (remainingDays < 0) return 'EXPIRED';
  if (remainingDays <= 30) return 'WITHIN_30';
  if (remainingDays <= 60) return 'WITHIN_60';
  if (remainingDays <= 90) return 'WITHIN_90';
  return 'BEYOND_90';
}

/** True when a warranty falls in one of the alertable windows (30/60/90). */
export function isWarrantyAlertable(bucket: WarrantyBucket): boolean {
  return bucket === 'WITHIN_30' || bucket === 'WITHIN_60' || bucket === 'WITHIN_90';
}

/** Days until a warranty ends; negative once expired, null when none. */
export function warrantyDaysRemaining(
  warrantyEndDate: Date | null | undefined,
  asOf: Date,
): number | null {
  if (!warrantyEndDate) return null;
  return Math.ceil((warrantyEndDate.getTime() - asOf.getTime()) / DAY);
}

export type RepairRecommendation = 'REPAIR' | 'REPLACE' | 'MARGINAL';

/**
 * Recommends repair vs replacement from cost.
 *
 * The classic rule: if a repair costs more than a threshold fraction of what a
 * replacement costs (or of the asset's current value), replacing is the better
 * spend. A band around the threshold is MARGINAL so the recommendation does not
 * flip on a rounding cent, and a human still decides — this is guidance, not an
 * automated write-off.
 */
export function repairRecommendation(input: {
  repairCost: string | number;
  replacementCost: string | number;
  /** Fraction of replacement cost above which replacing is advised. Default 0.5. */
  threshold?: number;
}): { recommendation: RepairRecommendation; ratio: string } {
  const repair = money(input.repairCost);
  const replacement = money(input.replacementCost);
  const threshold = new Decimal(input.threshold ?? 0.5);

  if (replacement.lessThanOrEqualTo(0)) {
    // Unknown replacement cost: cannot advise replacing, so default to repair.
    return { recommendation: 'REPAIR', ratio: '0' };
  }

  const ratio = repair.dividedBy(replacement);
  // A 10% band around the threshold is marginal.
  const band = threshold.times(0.1);

  let recommendation: RepairRecommendation;
  if (ratio.greaterThanOrEqualTo(threshold.plus(band))) recommendation = 'REPLACE';
  else if (ratio.lessThanOrEqualTo(threshold.minus(band))) recommendation = 'REPAIR';
  else recommendation = 'MARGINAL';

  return { recommendation, ratio: ratio.toDecimalPlaces(3).toString() };
}

/**
 * Flags an asset as a repeat-failure risk (spec section 14: "Repeat failures").
 * Two or more completed repairs inside a rolling window is the usual signal.
 */
export function isRepeatFailure(input: {
  completedRepairCount: number;
  windowMonths?: number;
  threshold?: number;
}): boolean {
  return input.completedRepairCount >= (input.threshold ?? 2);
}
