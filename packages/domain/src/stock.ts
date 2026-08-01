/**
 * Warehouse stock logic — v2.4 (blueprint Volume III, Module 2). Pure: signed
 * movement math over the append-only ledger, availability guards, low-stock
 * detection, and the three-way match (PO <-> receipts <-> invoice).
 *
 * The ledger is the truth: StockLevel rows are cached rollups, and this module
 * is where cache and ledger are compared. Movement quantities are always
 * positive; the movement TYPE carries the sign.
 */

export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT',
  'ISSUE',
  'ADJUST_UP',
  'ADJUST_DOWN',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'COUNT_CORRECTION',
  'CONVERT_TO_ASSET',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * The sign each movement type applies to a location's balance.
 * COUNT_CORRECTION is deliberately absent: a count difference has no inherent
 * direction, so services must post ADJUST_UP / ADJUST_DOWN (with the count
 * session as refType) instead — `movementDelta` throws to enforce that.
 */
const MOVEMENT_SIGN: Readonly<Partial<Record<StockMovementType, 1 | -1>>> = {
  RECEIPT: 1,
  ISSUE: -1,
  ADJUST_UP: 1,
  ADJUST_DOWN: -1,
  TRANSFER_IN: 1,
  TRANSFER_OUT: -1,
  CONVERT_TO_ASSET: -1,
};

/** Signed effect of one movement on a location balance. */
export function movementDelta(type: StockMovementType, quantity: string | number): number {
  const sign = MOVEMENT_SIGN[type];
  if (sign === undefined) {
    throw new Error(
      'COUNT_CORRECTION has no inherent direction - post ADJUST_UP or ADJUST_DOWN with the count session as the reference',
    );
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Movement quantities must be positive; the type carries the sign');
  }
  return sign * qty;
}

/** What the ledger says the balance is. The cache must always equal this. */
export function ledgerBalance(
  movements: readonly { type: StockMovementType; quantity: string | number }[],
): number {
  return movements.reduce((sum, m) => sum + movementDelta(m.type, m.quantity), 0);
}

/** Units free to issue: on-hand minus reservations. Never negative. */
export function availableQuantity(quantity: string | number, reserved: string | number): number {
  return Math.max(0, Number(quantity) - Number(reserved));
}

/** An issue/transfer/conversion may take at most what is free. */
export function canTakeStock(
  quantity: string | number,
  reserved: string | number,
  take: number,
): boolean {
  return take > 0 && take <= availableQuantity(quantity, reserved);
}

/** Honest refusal for an over-issue attempt. */
export function insufficientStockMessage(
  quantity: string | number,
  reserved: string | number,
  attempted: number,
): string {
  return (
    `Cannot take ${attempted}: only ${availableQuantity(quantity, reserved)} available ` +
    `(${Number(quantity)} on hand, ${Number(reserved)} reserved).`
  );
}

export function isLowStock(
  quantity: string | number,
  minStock: string | number | null | undefined,
): boolean {
  if (minStock === null || minStock === undefined) return false;
  return Number(quantity) <= Number(minStock);
}

// ── three-way match ──────────────────────────────────────────────────────────

/** Fixed v2.4 tolerance: 2% of the received value, floored at 0.01 absolute. */
export const MATCH_TOLERANCE_PCT = 0.02;
export const MATCH_TOLERANCE_ABS = 0.01;

export interface MatchableLine {
  ordered: string | number;
  received: string | number;
  unitPrice: string | number;
}

export interface ThreeWayMatchResult {
  outcome: 'MATCHED' | 'QTY_MISMATCH' | 'PRICE_MISMATCH' | 'NO_RECEIPT' | 'NO_PO';
  /** Honest numbers behind the verdict, surfaced verbatim to the verifier. */
  details: {
    receivedValue: number;
    invoiceTotal: number;
    delta: number;
    tolerance: number;
    lines: { ordered: number; received: number }[];
  };
}

/**
 * The three-way match: the invoice is compared to the value of what was
 * actually RECEIVED (received x unit price), not to what was ordered - billing
 * ahead of delivery is exactly what the match exists to catch.
 */
export function threeWayMatch(
  lines: readonly MatchableLine[],
  invoiceTotal: string | number,
): ThreeWayMatchResult {
  const total = Number(invoiceTotal);
  const detailLines = lines.map((l) => ({ ordered: Number(l.ordered), received: Number(l.received) }));
  const receivedValue = lines.reduce(
    (sum, l) => sum + Number(l.received) * Number(l.unitPrice),
    0,
  );
  const tolerance = Math.max(MATCH_TOLERANCE_ABS, receivedValue * MATCH_TOLERANCE_PCT);
  const delta = Number((total - receivedValue).toFixed(2));
  const details = { receivedValue: Number(receivedValue.toFixed(2)), invoiceTotal: total, delta, tolerance: Number(tolerance.toFixed(2)), lines: detailLines };

  if (lines.length === 0) return { outcome: 'NO_PO', details };
  if (detailLines.every((l) => l.received === 0)) return { outcome: 'NO_RECEIPT', details };
  if (detailLines.some((l) => l.received > l.ordered)) return { outcome: 'QTY_MISMATCH', details };
  if (Math.abs(delta) > tolerance) return { outcome: 'PRICE_MISMATCH', details };
  return { outcome: 'MATCHED', details };
}
