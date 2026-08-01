import { describe, expect, it } from 'vitest';
import {
  availableQuantity,
  canTakeStock,
  insufficientStockMessage,
  isLowStock,
  ledgerBalance,
  movementDelta,
  threeWayMatch,
} from './stock';

describe('movement math', () => {
  it('signs each movement by its type', () => {
    expect(movementDelta('RECEIPT', 5)).toBe(5);
    expect(movementDelta('ISSUE', 3)).toBe(-3);
    expect(movementDelta('TRANSFER_OUT', 2)).toBe(-2);
    expect(movementDelta('TRANSFER_IN', 2)).toBe(2);
    expect(movementDelta('CONVERT_TO_ASSET', 1)).toBe(-1);
  });

  it('refuses non-positive quantities — the type carries the sign', () => {
    expect(() => movementDelta('ISSUE', 0)).toThrow();
    expect(() => movementDelta('RECEIPT', -4)).toThrow();
  });

  it('refuses COUNT_CORRECTION, which has no inherent direction', () => {
    expect(() => movementDelta('COUNT_CORRECTION', 1)).toThrow(/ADJUST_UP or ADJUST_DOWN/);
  });

  it('the ledger balance is the signed sum — the cache must equal it', () => {
    expect(
      ledgerBalance([
        { type: 'RECEIPT', quantity: 10 },
        { type: 'ISSUE', quantity: 3 },
        { type: 'ADJUST_DOWN', quantity: 1 },
        { type: 'TRANSFER_IN', quantity: 2 },
      ]),
    ).toBe(8);
    expect(ledgerBalance([])).toBe(0);
  });
});

describe('availability guards', () => {
  it('available = on hand minus reserved, never negative', () => {
    expect(availableQuantity(10, 4)).toBe(6);
    expect(availableQuantity(3, 5)).toBe(0);
  });

  it('taking stock is limited to what is free', () => {
    expect(canTakeStock(10, 4, 6)).toBe(true);
    expect(canTakeStock(10, 4, 7)).toBe(false);
    expect(canTakeStock(10, 4, 0)).toBe(false);
  });

  it('refusals carry honest numbers', () => {
    const message = insufficientStockMessage(10, 4, 7);
    expect(message).toContain('Cannot take 7');
    expect(message).toContain('only 6 available');
    expect(message).toContain('4 reserved');
  });

  it('low stock triggers at or below the minimum, and never without one', () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
    expect(isLowStock(0, null)).toBe(false);
  });
});

describe('three-way match', () => {
  const line = (ordered: number, received: number, unitPrice: number) => ({
    ordered,
    received,
    unitPrice,
  });

  it('matches when the invoice equals the received value', () => {
    const result = threeWayMatch([line(10, 10, 100)], 1000);
    expect(result.outcome).toBe('MATCHED');
    expect(result.details.receivedValue).toBe(1000);
  });

  it('tolerates small deltas (2% of received value)', () => {
    expect(threeWayMatch([line(10, 10, 100)], 1019).outcome).toBe('MATCHED');
    expect(threeWayMatch([line(10, 10, 100)], 1021).outcome).toBe('PRICE_MISMATCH');
  });

  it('catches billing ahead of delivery — invoice vs RECEIVED value, not ordered', () => {
    // Ordered 10, received 4, but the vendor bills the full order.
    const result = threeWayMatch([line(10, 4, 100)], 1000);
    expect(result.outcome).toBe('PRICE_MISMATCH');
    expect(result.details.receivedValue).toBe(400);
    expect(result.details.delta).toBe(600);
  });

  it('flags an invoice with no receipt at all', () => {
    expect(threeWayMatch([line(10, 0, 100)], 1000).outcome).toBe('NO_RECEIPT');
  });

  it('flags a missing PO', () => {
    expect(threeWayMatch([], 500).outcome).toBe('NO_PO');
  });

  it('exposes the honest numbers behind every verdict', () => {
    const { details } = threeWayMatch([line(5, 5, 10), line(2, 1, 20)], 80);
    expect(details.receivedValue).toBe(70);
    expect(details.invoiceTotal).toBe(80);
    expect(details.delta).toBe(10);
    expect(details.lines).toEqual([
      { ordered: 5, received: 5 },
      { ordered: 2, received: 1 },
    ]);
  });
});
