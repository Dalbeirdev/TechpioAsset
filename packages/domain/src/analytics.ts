/**
 * v2.6 A1 — pure analytics math (plan section 5).
 *
 * Everything here is deterministic arithmetic over values the API passes in;
 * no queries, no dates "now" unless given. The API layer owns permission
 * gating (spend never leaves the server without assets:cost:read) — this
 * module just computes honestly, including the empty cases.
 */

/** Whole days between two instants, floored; negative when to < from. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Median of a numeric list; null for the empty list — never a fabricated 0. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** p-th percentile (0..100), nearest-rank; null for the empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 100) throw new Error(`percentile p must be 0..100, got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export interface CycleStats {
  count: number;
  avgDays: number | null;
  medianDays: number | null;
  p90Days: number | null;
}

/** Summary of a set of cycle durations (in days). Empty set → nulls, count 0. */
export function cycleStats(durationsDays: readonly number[]): CycleStats {
  if (durationsDays.length === 0) {
    return { count: 0, avgDays: null, medianDays: null, p90Days: null };
  }
  const sum = durationsDays.reduce((a, b) => a + b, 0);
  return {
    count: durationsDays.length,
    avgDays: Math.round((sum / durationsDays.length) * 10) / 10,
    medianDays: median(durationsDays),
    p90Days: percentile(durationsDays, 90),
  };
}

export const AGING_BUCKETS = ['0-7', '8-30', '31-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Age in days → reporting bucket. Negative ages clamp to the first bucket. */
export function agingBucket(days: number): AgingBucket {
  if (days <= 7) return '0-7';
  if (days <= 30) return '8-30';
  if (days <= 90) return '31-90';
  return '90+';
}

/** Count items per aging bucket, keeping every bucket present (zeroes included). */
export function agingDistribution(ages: readonly number[]): Record<AgingBucket, number> {
  const out: Record<AgingBucket, number> = { '0-7': 0, '8-30': 0, '31-90': 0, '90+': 0 };
  for (const age of ages) out[agingBucket(age)] += 1;
  return out;
}

/** Used/total as a whole percentage; null when total is 0 (no pool, no ratio). */
export function utilizationPct(used: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((used / total) * 100);
}

/**
 * Rate as a whole percentage; null when the denominator is 0. Used for SLA
 * breach rate (escalated / orders-with-an-SLA) and discovery coverage.
 */
export function ratePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/** YYYY-MM key for month grouping, in UTC — stable regardless of server TZ. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The last n month keys ending at `end` (inclusive), oldest first — so charts
 * show empty months as zeroes instead of silently skipping them.
 */
export function lastMonths(end: Date, n: number): string[] {
  if (n < 1) return [];
  const out: string[] = [];
  let year = end.getUTCFullYear();
  let month = end.getUTCMonth();
  for (let i = 0; i < n; i++) {
    out.unshift(`${year}-${String(month + 1).padStart(2, '0')}`);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return out;
}
