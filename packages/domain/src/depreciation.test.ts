import { describe, it, expect } from 'vitest';
import { computeDepreciation, monthsBetween } from './depreciation';

/**
 * Depreciation is exact money math, so it is tested like the invoice engine:
 * every method, the salvage floor, the end-of-life boundary, and the age
 * calculation, all proven with fixed dates.
 */

describe('monthsBetween', () => {
  it('counts whole elapsed months', () => {
    expect(monthsBetween(new Date('2026-01-15'), new Date('2026-04-15'))).toBe(3);
  });

  it('does not count a month until its day is reached', () => {
    expect(monthsBetween(new Date('2026-01-15'), new Date('2026-04-14'))).toBe(2);
  });

  it('is zero for a future-or-equal from date', () => {
    expect(monthsBetween(new Date('2026-04-15'), new Date('2026-01-15'))).toBe(0);
    expect(monthsBetween(new Date('2026-01-15'), new Date('2026-01-15'))).toBe(0);
  });
});

describe('straight-line depreciation', () => {
  const base = {
    method: 'STRAIGHT_LINE' as const,
    purchaseCost: '1200.00',
    salvageValue: '0.00',
    usefulLifeMonths: 12,
    purchaseDate: new Date('2026-01-01'),
  };

  it('holds full value at purchase', () => {
    const r = computeDepreciation({ ...base, asOf: new Date('2026-01-01') });
    expect(r.currentValue).toBe('1200.00');
    expect(r.accumulatedDepreciation).toBe('0.00');
    expect(r.monthlyDepreciation).toBe('100.00');
  });

  it('depreciates linearly at the halfway point', () => {
    const r = computeDepreciation({ ...base, asOf: new Date('2026-07-01') });
    // 6 of 12 months, 100/month → 600 taken, 600 left.
    expect(r.accumulatedDepreciation).toBe('600.00');
    expect(r.currentValue).toBe('600.00');
    expect(r.ageMonths).toBe(6);
  });

  it('reaches zero (or salvage) at end of life and stops', () => {
    const r = computeDepreciation({ ...base, asOf: new Date('2027-06-01') });
    expect(r.currentValue).toBe('0.00');
    expect(r.accumulatedDepreciation).toBe('1200.00');
    expect(r.fullyDepreciated).toBe(true);
    // Nothing more is taken once fully depreciated.
    expect(r.monthlyDepreciation).toBe('0.00');
  });

  it('never depreciates below salvage value', () => {
    const r = computeDepreciation({
      ...base,
      salvageValue: '200.00',
      asOf: new Date('2028-01-01'),
    });
    expect(r.currentValue).toBe('200.00');
    expect(r.accumulatedDepreciation).toBe('1000.00');
  });

  it('depreciates the base above salvage, not the whole cost', () => {
    const r = computeDepreciation({
      ...base,
      salvageValue: '240.00',
      asOf: new Date('2026-07-01'),
    });
    // Base = 1200 - 240 = 960 over 12 months = 80/month. 6 months → 480 taken.
    expect(r.accumulatedDepreciation).toBe('480.00');
    expect(r.currentValue).toBe('720.00');
  });
});

describe('declining-balance depreciation', () => {
  const base = {
    method: 'DECLINING_BALANCE' as const,
    purchaseCost: '1000.00',
    salvageValue: '100.00',
    usefulLifeMonths: 24,
    purchaseDate: new Date('2026-01-01'),
  };

  it('takes more in early life than straight-line would', () => {
    const decliningAt6 = computeDepreciation({ ...base, asOf: new Date('2026-07-01') });
    const straightAt6 = computeDepreciation({
      ...base,
      method: 'STRAIGHT_LINE',
      asOf: new Date('2026-07-01'),
    });
    expect(Number(decliningAt6.accumulatedDepreciation)).toBeGreaterThan(
      Number(straightAt6.accumulatedDepreciation),
    );
  });

  it('floors at salvage value and marks fully depreciated', () => {
    const r = computeDepreciation({ ...base, asOf: new Date('2035-01-01') });
    expect(r.currentValue).toBe('100.00');
    expect(r.fullyDepreciated).toBe(true);
  });

  it('respects an explicit decline rate', () => {
    const r = computeDepreciation({
      ...base,
      decliningRate: 0.5,
      asOf: new Date('2026-02-01'),
    });
    // One month at 50%/yr ≈ 4.1667%/month on (1000-100)=900 → ~37.50 taken.
    expect(Number(r.accumulatedDepreciation)).toBeGreaterThan(30);
    expect(Number(r.accumulatedDepreciation)).toBeLessThan(45);
  });
});

describe('edge cases', () => {
  it('holds value for method NONE', () => {
    const r = computeDepreciation({
      method: 'NONE',
      purchaseCost: '500.00',
      usefulLifeMonths: 12,
      purchaseDate: new Date('2026-01-01'),
      asOf: new Date('2027-01-01'),
    });
    expect(r.currentValue).toBe('500.00');
    expect(r.accumulatedDepreciation).toBe('0.00');
  });

  it('holds value when useful life is missing or zero', () => {
    const r = computeDepreciation({
      method: 'STRAIGHT_LINE',
      purchaseCost: '500.00',
      usefulLifeMonths: 0,
      purchaseDate: new Date('2026-01-01'),
      asOf: new Date('2027-01-01'),
    });
    expect(r.currentValue).toBe('500.00');
  });

  it('does not go negative when cost is at or below salvage', () => {
    const r = computeDepreciation({
      method: 'STRAIGHT_LINE',
      purchaseCost: '100.00',
      salvageValue: '150.00',
      usefulLifeMonths: 12,
      purchaseDate: new Date('2026-01-01'),
      asOf: new Date('2027-01-01'),
    });
    expect(r.currentValue).toBe('100.00');
    expect(r.accumulatedDepreciation).toBe('0.00');
  });
});
