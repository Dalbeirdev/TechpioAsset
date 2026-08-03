import Decimal from 'decimal.js';
import { money, roundMoney, type MoneyInput } from './money.js';

/**
 * v2.9 C2 — budgets as hard limits.
 *
 * A budget is not a warning. The number a department may spend is a limit, and
 * the API enforces it the same way licence seats are enforced: the arithmetic
 * lives here so it is provable in isolation, the enforcement is an atomic
 * conditional UPDATE whose WHERE clause IS the limit, and a DB CHECK is the
 * backstop for anything that reaches the table another way.
 *
 * "Committed" is money promised but not yet invoiced: an approved purchase
 * request holds its estimate against the budget until it is cancelled. That is
 * deliberately conservative — a department that has approved its whole budget
 * has spent it, whether or not the invoices have arrived.
 */

export interface BudgetSnapshot {
  amount: MoneyInput;
  committed: MoneyInput;
}

/** What is left to promise. Never reported below zero, however the row got there. */
export function budgetRemaining(snapshot: BudgetSnapshot): Decimal {
  const remaining = roundMoney(money(snapshot.amount).minus(money(snapshot.committed)));
  return remaining.isNegative() ? new Decimal(0) : remaining;
}

export function budgetUtilisationPercent(snapshot: BudgetSnapshot): number {
  const amount = money(snapshot.amount);
  if (amount.lessThanOrEqualTo(0)) return 0;
  return Number(
    money(snapshot.committed).dividedBy(amount).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP),
  );
}

/**
 * The predicate the guarded UPDATE mirrors. Kept exact (no tolerance): a budget
 * is a decision about money somebody is accountable for, not a reconciliation
 * of two systems' rounding.
 */
export function canCommitToBudget(snapshot: BudgetSnapshot, requested: MoneyInput): boolean {
  const want = money(requested);
  if (want.isNegative()) return false;
  return roundMoney(money(snapshot.committed).plus(want)).lessThanOrEqualTo(roundMoney(money(snapshot.amount)));
}

/**
 * The refusal. It states remaining, committed, the limit and what was asked,
 * because "budget exceeded" tells the requester nothing they can act on — the
 * useful question is always "by how much, and who spent the rest?".
 */
export function budgetLimitMessage(
  snapshot: BudgetSnapshot & { name: string; currency: string },
  requested: MoneyInput,
): string {
  const remaining = budgetRemaining(snapshot);
  const shortfall = roundMoney(money(requested).minus(remaining));
  return (
    `Budget ${snapshot.name} cannot cover this request. ` +
    `Requested: ${roundMoney(requested).toFixed(2)} ${snapshot.currency} / ` +
    `Remaining: ${remaining.toFixed(2)} / ` +
    `Committed: ${roundMoney(snapshot.committed).toFixed(2)} of ${roundMoney(snapshot.amount).toFixed(2)}. ` +
    `Short by ${shortfall.toFixed(2)}. Raise the budget, release a commitment, or reduce the request.`
  );
}

export interface BudgetPeriod {
  periodStart: Date | string;
  periodEnd: Date | string;
}

const asDay = (value: Date | string): string =>
  (value instanceof Date ? value.toISOString() : new Date(value).toISOString()).slice(0, 10);

/** Inclusive on both ends: a budget covers its last day. */
export function periodCovers(period: BudgetPeriod, when: Date | string): boolean {
  const day = asDay(when);
  return asDay(period.periodStart) <= day && day <= asDay(period.periodEnd);
}

/**
 * Two budgets for one cost centre covering the same day would make "which
 * budget does this request charge?" ambiguous, so overlap is refused at
 * creation rather than resolved by a tie-break nobody could predict.
 */
export function periodsOverlap(a: BudgetPeriod, b: BudgetPeriod): boolean {
  return asDay(a.periodStart) <= asDay(b.periodEnd) && asDay(b.periodStart) <= asDay(a.periodEnd);
}

export function assertValidPeriod(period: BudgetPeriod): void {
  if (asDay(period.periodEnd) < asDay(period.periodStart)) {
    throw new Error('A budget period cannot end before it starts');
  }
}
