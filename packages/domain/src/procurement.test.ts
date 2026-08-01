import { describe, expect, it } from 'vitest';
import {
  canApprovePurchaseRequest,
  canReceive,
  canTransitionPurchaseRequest,
  needsFinanceApproval,
  overReceiptMessage,
  remainingQuantity,
  rollupPurchaseOrderStatus,
} from './procurement';

describe('PR status machine', () => {
  it('follows the legal path draft → submitted → approved → converted', () => {
    expect(canTransitionPurchaseRequest('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionPurchaseRequest('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionPurchaseRequest('APPROVED', 'CONVERTED')).toBe(true);
  });

  it('allows fix-and-resubmit after rejection', () => {
    expect(canTransitionPurchaseRequest('SUBMITTED', 'REJECTED')).toBe(true);
    expect(canTransitionPurchaseRequest('REJECTED', 'SUBMITTED')).toBe(true);
  });

  it('treats CONVERTED and CANCELLED as terminal', () => {
    expect(canTransitionPurchaseRequest('CONVERTED', 'CANCELLED')).toBe(false);
    expect(canTransitionPurchaseRequest('CANCELLED', 'SUBMITTED')).toBe(false);
  });

  it('refuses skipping approval', () => {
    expect(canTransitionPurchaseRequest('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransitionPurchaseRequest('DRAFT', 'CONVERTED')).toBe(false);
  });
});

describe('SoD and the Finance threshold', () => {
  it('nobody approves their own purchase request', () => {
    expect(canApprovePurchaseRequest('u1', 'u1')).toBe(false);
    expect(canApprovePurchaseRequest('u2', 'u1')).toBe(true);
  });

  it('the threshold is inclusive at the boundary (BR-05 semantics)', () => {
    expect(needsFinanceApproval('249.99', '250.00')).toBe(false);
    expect(needsFinanceApproval('250.00', '250.00')).toBe(true);
    expect(needsFinanceApproval('250.01', '250.00')).toBe(true);
  });

  it('an unknown or unparseable estimate always goes to a human', () => {
    expect(needsFinanceApproval(null, '250.00')).toBe(true);
    expect(needsFinanceApproval(undefined, '250.00')).toBe(true);
    expect(needsFinanceApproval('abc', '250.00')).toBe(true);
  });
});

describe('receipt math', () => {
  const line = (quantity: number, received: number) => ({
    quantity,
    receivedQuantity: received,
  });

  it('tracks the outstanding remainder, never negative', () => {
    expect(remainingQuantity(line(10, 4))).toBe(6);
    expect(remainingQuantity(line(10, 12))).toBe(0);
  });

  it('accepts a receipt only up to the remainder', () => {
    expect(canReceive(line(10, 4), 6)).toBe(true);
    expect(canReceive(line(10, 4), 7)).toBe(false);
    expect(canReceive(line(10, 4), 0)).toBe(false);
  });

  it('rolls the PO status up from its lines', () => {
    expect(rollupPurchaseOrderStatus([line(10, 0), line(5, 0)])).toBe('ISSUED');
    expect(rollupPurchaseOrderStatus([line(10, 3), line(5, 0)])).toBe('PARTIALLY_RECEIVED');
    expect(rollupPurchaseOrderStatus([line(10, 10), line(5, 5)])).toBe('RECEIVED');
    expect(rollupPurchaseOrderStatus([])).toBe('ISSUED');
  });

  it('refuses over-receipt with honest numbers', () => {
    const message = overReceiptMessage(line(10, 8), 5);
    expect(message).toContain('Cannot receive 5');
    expect(message).toContain('only 2');
    expect(message).toContain('10 ordered');
  });
});
