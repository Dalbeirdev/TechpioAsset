import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  money,
  roundMoney,
  sumMoney,
  computeLineTotal,
  computeInvoiceTotal,
  totalsAgree,
  assertCurrencyCode,
  MoneyError,
} from './money';

describe('money', () => {
  it('parses strings, numbers and Decimals', () => {
    expect(money('10.05').toString()).toBe('10.05');
    expect(money(10.05).toFixed(2)).toBe('10.05');
    expect(money(new Decimal('10.05')).toString()).toBe('10.05');
  });

  it('rejects non-finite values', () => {
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => money(Number.NaN)).toThrow(MoneyError);
  });

  it('rounds half up at two decimal places', () => {
    expect(roundMoney('1.005').toString()).toBe('1.01');
    expect(roundMoney('1.004').toString()).toBe('1');
    expect(roundMoney('2.675').toString()).toBe('2.68');
  });

  it('sums without binary floating point drift', () => {
    // The canonical failure: 0.1 + 0.2 !== 0.3 in IEEE-754.
    expect(sumMoney(['0.1', '0.2']).toString()).toBe('0.3');
    const hundredCents = Array.from({ length: 100 }, () => '0.01');
    expect(sumMoney(hundredCents).toString()).toBe('1');
  });
});

describe('computeLineTotal', () => {
  it('multiplies quantity by unit price', () => {
    expect(computeLineTotal(3, '449.99').toString()).toBe('1349.97');
  });

  it('supports fractional quantities for consumables', () => {
    expect(computeLineTotal('2.5', '12.40').toString()).toBe('31');
  });

  it('rejects negative quantity or price', () => {
    expect(() => computeLineTotal(-1, '10')).toThrow(MoneyError);
    expect(() => computeLineTotal(1, '-10')).toThrow(MoneyError);
  });
});

describe('computeInvoiceTotal', () => {
  it('applies subtotal minus discount plus tax, shipping and other charges', () => {
    const total = computeInvoiceTotal({
      subtotal: '1000.00',
      discount: '50.00',
      tax: '171.00',
      shipping: '25.00',
      otherCharges: '4.00',
    });
    expect(total.toString()).toBe('1150');
  });

  it('treats omitted components as zero', () => {
    expect(computeInvoiceTotal({ subtotal: '99.99' }).toString()).toBe('99.99');
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() => computeInvoiceTotal({ subtotal: '10.00', discount: '10.01' })).toThrow(MoneyError);
  });

  it('rejects negative components', () => {
    expect(() => computeInvoiceTotal({ subtotal: '-1' })).toThrow(MoneyError);
    expect(() => computeInvoiceTotal({ subtotal: '10', discount: '-1' })).toThrow(MoneyError);
  });

  it('is exact across a long line-item invoice', () => {
    const lines = Array.from({ length: 37 }, () => computeLineTotal(3, '19.99'));
    const subtotal = sumMoney(lines);
    expect(subtotal.toString()).toBe('2218.89');
    expect(computeInvoiceTotal({ subtotal, tax: '0' }).toString()).toBe('2218.89');
  });
});

describe('totalsAgree', () => {
  it('accepts a one-cent per-line rounding divergence', () => {
    expect(totalsAgree('100.00', '100.01')).toBe(true);
    expect(totalsAgree('100.01', '100.00')).toBe(true);
  });

  it('rejects anything larger than the tolerance', () => {
    expect(totalsAgree('100.00', '100.02')).toBe(false);
    expect(totalsAgree('100.00', '99.00')).toBe(false);
  });

  it('honours a caller-supplied tolerance', () => {
    expect(totalsAgree('100.00', '100.05', 5)).toBe(true);
    expect(totalsAgree('100.00', '100.06', 5)).toBe(false);
  });
});

describe('assertCurrencyCode', () => {
  it('accepts ISO-4217 shaped codes', () => {
    expect(() => assertCurrencyCode('USD')).not.toThrow();
    expect(() => assertCurrencyCode('INR')).not.toThrow();
  });

  it('rejects malformed codes', () => {
    expect(() => assertCurrencyCode('usd')).toThrow(MoneyError);
    expect(() => assertCurrencyCode('DOLLAR')).toThrow(MoneyError);
    expect(() => assertCurrencyCode('')).toThrow(MoneyError);
  });
});
