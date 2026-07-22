import Decimal from 'decimal.js';
import { money, roundMoney } from './money';

/**
 * Asset depreciation (spec section 5: "View depreciation"; section 14 lifecycle).
 *
 * Pure, exact-decimal math. Like invoice verification, this is money and must
 * never be wrong, so it is a testable function rather than a formula buried in a
 * service. Two methods are supported, matching the schema's DepreciationMethod:
 * straight-line and declining-balance. An asset with method NONE simply holds its
 * value.
 */

export const DEPRECIATION_METHODS = ['NONE', 'STRAIGHT_LINE', 'DECLINING_BALANCE'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export interface DepreciationInput {
  method: DepreciationMethod;
  /** Original purchase cost. */
  purchaseCost: string | number;
  /** Residual value at end of life; never depreciate below this. */
  salvageValue?: string | number | null;
  /** Expected life in months. */
  usefulLifeMonths?: number | null;
  purchaseDate: Date;
  /** The date to value the asset at. Defaults to purchaseDate for a zero-age check. */
  asOf: Date;
  /** Declining-balance rate as a fraction per year, e.g. 0.2 for 20%. Optional. */
  decliningRate?: number;
}

export interface DepreciationResult {
  /** Book value at `asOf`, floored at salvage value. */
  currentValue: string;
  /** Total depreciation taken from purchase to `asOf`. */
  accumulatedDepreciation: string;
  /** Depreciation attributable to one month at the current point in life. */
  monthlyDepreciation: string;
  /** Whole months elapsed between purchase and `asOf`. */
  ageMonths: number;
  /** True once the asset has reached salvage value / end of life. */
  fullyDepreciated: boolean;
}

/** Whole months between two dates, never negative. */
export function monthsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  // Only count a month once its day-of-month has been reached.
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

export function computeDepreciation(input: DepreciationInput): DepreciationResult {
  const cost = money(input.purchaseCost);
  const salvage = money(input.salvageValue ?? 0);
  const ageMonths = monthsBetween(input.purchaseDate, input.asOf);

  // No method, no life, or nothing to depreciate below: value is unchanged.
  if (
    input.method === 'NONE' ||
    !input.usefulLifeMonths ||
    input.usefulLifeMonths <= 0 ||
    cost.lessThanOrEqualTo(salvage)
  ) {
    return {
      currentValue: roundMoney(cost).toFixed(2),
      accumulatedDepreciation: '0.00',
      monthlyDepreciation: '0.00',
      ageMonths,
      fullyDepreciated: false,
    };
  }

  const depreciableBase = cost.minus(salvage);

  if (input.method === 'STRAIGHT_LINE') {
    const perMonth = depreciableBase.dividedBy(input.usefulLifeMonths);
    const cappedAge = Math.min(ageMonths, input.usefulLifeMonths);
    const accumulated = Decimal.min(perMonth.times(cappedAge), depreciableBase);
    const value = cost.minus(accumulated);
    const fully = cappedAge >= input.usefulLifeMonths;
    return {
      currentValue: roundMoney(value).toFixed(2),
      accumulatedDepreciation: roundMoney(accumulated).toFixed(2),
      // Zero once fully depreciated: nothing more is taken.
      monthlyDepreciation: fully ? '0.00' : roundMoney(perMonth).toFixed(2),
      ageMonths,
      fullyDepreciated: fully,
    };
  }

  // Declining balance: a fixed rate applied to the *reducing* book value each
  // year, floored at salvage. The default rate is double the straight-line rate
  // (the common "double declining balance" convention) when none is supplied.
  const annualRate = input.decliningRate ?? Math.min(1, (12 / input.usefulLifeMonths) * 2);
  const monthlyRate = new Decimal(annualRate).dividedBy(12);

  let value = cost;
  for (let m = 0; m < Math.min(ageMonths, input.usefulLifeMonths); m += 1) {
    const step = value.minus(salvage).times(monthlyRate);
    value = value.minus(step);
    if (value.lessThanOrEqualTo(salvage)) {
      value = salvage;
      break;
    }
  }

  // Declining balance approaches but never reaches salvage. The accounting
  // convention is to write the remainder down to salvage at end of useful life,
  // so an asset past its life is carried at its residual value, not stranded
  // above it forever.
  if (ageMonths >= input.usefulLifeMonths) {
    value = salvage;
  }

  const accumulated = cost.minus(value);
  const nextStep = value.greaterThan(salvage)
    ? value.minus(salvage).times(monthlyRate)
    : new Decimal(0);

  return {
    currentValue: roundMoney(value).toFixed(2),
    accumulatedDepreciation: roundMoney(accumulated).toFixed(2),
    monthlyDepreciation: roundMoney(nextStep).toFixed(2),
    ageMonths,
    fullyDepreciated: value.lessThanOrEqualTo(salvage),
  };
}
