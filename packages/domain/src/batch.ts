import Decimal from 'decimal.js';

/**
 * v2.9 C4 — lot tracking and expiry.
 *
 * Two rules, both of which have to be provable rather than asserted:
 *
 *  1. **Issue is FIFO by expiry.** The stock closest to being unusable leaves
 *     first, so nothing quietly rots at the back of the shelf while newer
 *     stock is handed out in front of it.
 *  2. **Expired stock is never issued silently.** It can be issued - somebody
 *     may have a good reason, and refusing outright would just push the work
 *     off the system - but only with a reason, which is recorded.
 *
 * The planning lives here, as pure arithmetic over a batch list, so the FIFO
 * order and the shortfall maths can be proven without a warehouse.
 */

export interface IssuableBatch {
  id: string;
  batchNumber: string;
  quantity: Decimal | string | number;
  expiryDate: Date | string | null;
  receivedAt: Date | string;
}

export interface BatchPick {
  batchId: string;
  batchNumber: string;
  quantity: string;
  expired: boolean;
}

export interface BatchIssuePlan {
  picks: BatchPick[];
  /** How much of the request could not be covered by usable stock. */
  shortfall: string;
  /** Quantity skipped because it had expired and no override was given. */
  expiredSkipped: string;
  /** True when the plan only works because expired stock was allowed. */
  usedExpired: boolean;
}

const asDay = (value: Date | string): string =>
  (value instanceof Date ? value.toISOString() : new Date(value).toISOString()).slice(0, 10);

const asTime = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

/** Expiry is inclusive of its last day: stock is usable ON its expiry date. */
export function isExpired(batch: { expiryDate: Date | string | null }, on: Date | string): boolean {
  return batch.expiryDate !== null && asDay(batch.expiryDate) < asDay(on);
}

export type ExpiryState = 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';

export function expiryState(
  batch: { expiryDate: Date | string | null },
  on: Date | string,
  warnWithinDays: number,
): ExpiryState {
  if (batch.expiryDate === null) return 'NO_EXPIRY';
  if (isExpired(batch, on)) return 'EXPIRED';
  const days = Math.floor((asTime(batch.expiryDate) - asTime(on)) / 86_400_000);
  return days <= warnWithinDays ? 'EXPIRING_SOON' : 'OK';
}

/**
 * FIFO by expiry: soonest expiry first. Batches with no expiry date sort last,
 * because a batch that cannot go off is never the urgent one to use up; among
 * equals the older receipt goes first, which is FIFO in the plain sense.
 */
export function sortBatchesForIssue<T extends IssuableBatch>(batches: readonly T[]): T[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return asTime(a.receivedAt) - asTime(b.receivedAt);
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    const byExpiry = asTime(a.expiryDate) - asTime(b.expiryDate);
    return byExpiry !== 0 ? byExpiry : asTime(a.receivedAt) - asTime(b.receivedAt);
  });
}

/**
 * Works out which batches cover `quantity`, in issue order.
 *
 * Returns a plan rather than throwing: the caller decides whether a shortfall
 * is a refusal (it always is, today) and the plan carries what it would have
 * taken, which is what makes the refusal message useful.
 */
export function planBatchIssue(
  batches: readonly IssuableBatch[],
  quantity: Decimal | string | number,
  options: { on: Date | string; allowExpired?: boolean },
): BatchIssuePlan {
  let remaining = new Decimal(quantity.toString());
  const picks: BatchPick[] = [];
  let expiredSkipped = new Decimal(0);
  let usedExpired = false;

  const ordered = sortBatchesForIssue(batches).filter((b) => new Decimal(b.quantity.toString()).greaterThan(0));
  const usable = ordered.filter((b) => !isExpired(b, options.on));
  const expiredBatches = ordered.filter((b) => isExpired(b, options.on));

  // Usable stock first, ALWAYS. Permission to issue expired stock is permission
  // to fall back on it, not an instruction to reach for it - and expired stock
  // sorts earliest, so a single FIFO pass would hand it out in front of good
  // stock the moment the override was given.
  for (const batch of [...usable, ...(options.allowExpired ? expiredBatches : [])]) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const available = new Decimal(batch.quantity.toString());
    const expired = isExpired(batch, options.on);
    const take = Decimal.min(available, remaining);
    picks.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: take.toString(),
      expired,
    });
    if (expired) usedExpired = true;
    remaining = remaining.minus(take);
  }
  // Everything that had gone off and was not drawn on, whether because the
  // override was absent or because usable stock covered the request.
  for (const batch of expiredBatches) {
    const taken = picks.find((p) => p.batchId === batch.id);
    const untouched = new Decimal(batch.quantity.toString()).minus(taken ? new Decimal(taken.quantity) : 0);
    expiredSkipped = expiredSkipped.plus(untouched);
  }

  return {
    picks,
    shortfall: (remaining.isNegative() ? new Decimal(0) : remaining).toString(),
    expiredSkipped: expiredSkipped.toString(),
    usedExpired,
  };
}

/**
 * The refusal. It separates "you do not have this much" from "you have it, but
 * it has gone off", because those are different problems with different fixes.
 */
export function batchShortfallMessage(
  itemName: string,
  requested: Decimal | string | number,
  plan: BatchIssuePlan,
): string {
  const covered = plan.picks.reduce((sum, p) => sum.plus(new Decimal(p.quantity)), new Decimal(0));
  const base =
    `Cannot issue ${new Decimal(requested.toString()).toString()} of ${itemName}: ` +
    `only ${covered.toString()} available in usable batches.`;
  return new Decimal(plan.expiredSkipped).greaterThan(0)
    ? `${base} A further ${new Decimal(plan.expiredSkipped).toString()} has expired - issue it explicitly with a reason if it is still fit for use.`
    : base;
}
