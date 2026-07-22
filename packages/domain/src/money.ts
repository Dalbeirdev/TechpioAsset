import Decimal from 'decimal.js';

/**
 * Exact monetary arithmetic.
 *
 * Spec section 9 requires deterministic backend verification of subtotal, tax,
 * discount, shipping and total, and explicitly forbids delegating that to AI.
 * Binary floating point cannot represent 0.1 exactly, so every figure here stays
 * in Decimal from parse to persist. Prisma stores these as Decimal(14,2).
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const MONEY_SCALE = 2;

export type MoneyInput = string | number | Decimal;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * `number` is accepted because JSON bodies deliver it, but anything that arrives
 * as a number has already passed through IEEE-754. Callers handling values from
 * an invoice document should pass the original string.
 */
export function money(value: MoneyInput): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) throw new MoneyError(`Not a finite monetary value: ${String(value)}`);
  return d;
}

export function roundMoney(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function sumMoney(values: readonly MoneyInput[]): Decimal {
  return roundMoney(values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0)));
}

export function isNegative(value: MoneyInput): boolean {
  return money(value).isNegative();
}

/** Quantity may be fractional (2.5 kg of cleaning product), so it is Decimal too. */
export function computeLineTotal(quantity: MoneyInput, unitPrice: MoneyInput): Decimal {
  const q = money(quantity);
  const p = money(unitPrice);
  if (q.isNegative()) throw new MoneyError('Quantity may not be negative');
  if (p.isNegative()) throw new MoneyError('Unit price may not be negative');
  return roundMoney(q.times(p));
}

export interface InvoiceTotalParts {
  subtotal: MoneyInput;
  discount?: MoneyInput;
  tax?: MoneyInput;
  shipping?: MoneyInput;
  otherCharges?: MoneyInput;
}

/** total = subtotal - discount + tax + shipping + otherCharges */
export function computeInvoiceTotal(parts: InvoiceTotalParts): Decimal {
  const subtotal = money(parts.subtotal);
  const discount = money(parts.discount ?? 0);
  const tax = money(parts.tax ?? 0);
  const shipping = money(parts.shipping ?? 0);
  const other = money(parts.otherCharges ?? 0);

  if (subtotal.isNegative()) throw new MoneyError('Subtotal may not be negative');
  if (discount.isNegative()) throw new MoneyError('Discount may not be negative');
  if (discount.greaterThan(subtotal)) {
    throw new MoneyError('Discount may not exceed subtotal');
  }

  return roundMoney(subtotal.minus(discount).plus(tax).plus(shipping).plus(other));
}

/**
 * Compares a stated total against a computed one within a tolerance.
 *
 * Tolerance exists because vendor systems round per-line while others round the
 * invoice once at the end; a one-cent divergence on a 40-line invoice is a
 * rounding artefact, not a cost mismatch worth a reviewer's attention. Anything
 * larger is reported as COST_MISMATCH.
 */
export function totalsAgree(
  stated: MoneyInput,
  computed: MoneyInput,
  toleranceMinorUnits = 1,
): boolean {
  const tolerance = new Decimal(toleranceMinorUnits).dividedBy(10 ** MONEY_SCALE);
  return roundMoney(stated).minus(roundMoney(computed)).abs().lessThanOrEqualTo(tolerance);
}

/** ISO-4217 shape check only; the configured currency list is a per-company setting. */
export function assertCurrencyCode(code: string): void {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new MoneyError(`Invalid ISO-4217 currency code: ${code}`);
  }
}
