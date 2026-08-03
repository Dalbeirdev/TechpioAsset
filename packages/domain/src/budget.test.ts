import { describe, expect, it } from 'vitest';
import {
  assertValidPeriod,
  budgetLimitMessage,
  budgetRemaining,
  budgetUtilisationPercent,
  canCommitToBudget,
  periodCovers,
  periodsOverlap,
} from './budget.js';

/**
 * v2.9 C2. The arithmetic of a hard limit, provable without a database.
 */

describe('budgetRemaining', () => {
  it('is exact at the cent, not floating point', () => {
    expect(budgetRemaining({ amount: '1000.10', committed: '999.20' }).toFixed(2)).toBe('0.90');
    // 0.1 + 0.2 is the classic float trap; Decimal keeps it honest.
    expect(budgetRemaining({ amount: '0.30', committed: '0.10' }).toFixed(2)).toBe('0.20');
  });

  it('never reports below zero, however the row got there', () => {
    // A pre-existing overspend must not read as negative headroom.
    expect(budgetRemaining({ amount: '100.00', committed: '150.00' }).toFixed(2)).toBe('0.00');
  });
});

describe('canCommitToBudget', () => {
  it('allows spending the budget down to exactly zero', () => {
    expect(canCommitToBudget({ amount: '1000.00', committed: '750.00' }, '250.00')).toBe(true);
  });

  it('refuses the cent that would exceed it', () => {
    expect(canCommitToBudget({ amount: '1000.00', committed: '750.00' }, '250.01')).toBe(false);
  });

  it('refuses a negative request rather than crediting the budget', () => {
    expect(canCommitToBudget({ amount: '1000.00', committed: '0' }, '-50.00')).toBe(false);
  });

  it('refuses everything once the budget is fully committed', () => {
    expect(canCommitToBudget({ amount: '500.00', committed: '500.00' }, '0.01')).toBe(false);
    expect(canCommitToBudget({ amount: '500.00', committed: '500.00' }, '0')).toBe(true);
  });
});

describe('budgetLimitMessage', () => {
  it('states what was asked, what is left, what is committed and the shortfall', () => {
    const message = budgetLimitMessage(
      { name: 'FY26 Q1 — IT', currency: 'USD', amount: '2000.00', committed: '1880.00' },
      '250.00',
    );
    expect(message).toContain('250.00 USD');
    expect(message).toContain('Remaining: 120.00');
    expect(message).toContain('Committed: 1880.00 of 2000.00');
    expect(message).toContain('Short by 130.00');
    // A refusal has to leave the reader with something to do.
    expect(message).toMatch(/Raise the budget|release a commitment|reduce the request/);
  });
});

describe('budgetUtilisationPercent', () => {
  it('reports consumption to one decimal place', () => {
    expect(budgetUtilisationPercent({ amount: '2000.00', committed: '1500.00' })).toBe(75);
    expect(budgetUtilisationPercent({ amount: '3000.00', committed: '1000.00' })).toBe(33.3);
  });

  it('does not divide by a zero budget', () => {
    expect(budgetUtilisationPercent({ amount: '0', committed: '0' })).toBe(0);
  });
});

describe('budget periods', () => {
  const q1 = { periodStart: '2026-01-01', periodEnd: '2026-03-31' };

  it('covers its last day, inclusive', () => {
    expect(periodCovers(q1, '2026-03-31')).toBe(true);
    expect(periodCovers(q1, '2026-04-01')).toBe(false);
    expect(periodCovers(q1, '2025-12-31')).toBe(false);
  });

  it('detects overlap in either direction, including touching ends', () => {
    expect(periodsOverlap(q1, { periodStart: '2026-03-31', periodEnd: '2026-06-30' })).toBe(true);
    expect(periodsOverlap({ periodStart: '2026-04-01', periodEnd: '2026-06-30' }, q1)).toBe(false);
    // Fully contained is still overlap.
    expect(periodsOverlap(q1, { periodStart: '2026-02-01', periodEnd: '2026-02-28' })).toBe(true);
  });

  it('refuses a period that ends before it starts', () => {
    expect(() => assertValidPeriod({ periodStart: '2026-03-31', periodEnd: '2026-01-01' })).toThrow();
    expect(() => assertValidPeriod({ periodStart: '2026-01-01', periodEnd: '2026-01-01' })).not.toThrow();
  });
});
