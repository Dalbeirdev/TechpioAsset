import { describe, expect, it } from 'vitest';
import { compareQuotes, losingQuoteMessage, quoteSubtotal } from './rfq.js';

/**
 * v2.9 C3. The comparison a buyer defends their choice with.
 */

const quotes = [
  { id: 'q1', vendorName: 'Northwind', total: '1200.00', leadTimeDays: 14, status: 'RECEIVED' },
  { id: 'q2', vendorName: 'Contoso', total: '1100.00', leadTimeDays: 30, status: 'RECEIVED' },
  { id: 'q3', vendorName: 'Fabrikam', total: null, leadTimeDays: null, status: 'INVITED' },
];

describe('compareQuotes', () => {
  it('ranks responses by price and leaves the silent vendor unranked', () => {
    const c = compareQuotes(quotes);
    expect(c.responded).toBe(2);
    expect(c.awaiting).toBe(1);
    expect(c.rows.find((r) => r.id === 'q2')!.rank).toBe(1);
    expect(c.rows.find((r) => r.id === 'q1')!.rank).toBe(2);
    expect(c.rows.find((r) => r.id === 'q3')!.rank).toBeNull();
  });

  it('names the cheapest and the fastest, and says when they differ', () => {
    const c = compareQuotes(quotes);
    expect(c.cheapestQuoteId).toBe('q2');
    expect(c.fastestQuoteId).toBe('q1');
    // The moment the award reason earns its keep.
    expect(c.cheapestIsNotFastest).toBe(true);
  });

  it('states the premium over the cheapest, exactly', () => {
    const c = compareQuotes(quotes);
    expect(c.rows.find((r) => r.id === 'q1')!.premiumOverCheapest).toBe('100.00');
    expect(c.rows.find((r) => r.id === 'q2')!.premiumOverCheapest).toBe('0.00');
    expect(c.rows.find((r) => r.id === 'q3')!.premiumOverCheapest).toBeNull();
  });

  it('does not claim a trade-off when one vendor is both cheapest and fastest', () => {
    const c = compareQuotes([
      { id: 'a', vendorName: 'A', total: '100.00', leadTimeDays: 2, status: 'RECEIVED' },
      { id: 'b', vendorName: 'B', total: '200.00', leadTimeDays: 9, status: 'RECEIVED' },
    ]);
    expect(c.cheapestIsNotFastest).toBe(false);
  });

  it('handles an RFQ nobody has answered yet', () => {
    const c = compareQuotes([{ id: 'a', vendorName: 'A', total: null, status: 'INVITED' }]);
    expect(c.responded).toBe(0);
    expect(c.cheapestQuoteId).toBeNull();
    expect(c.cheapestIsNotFastest).toBe(false);
  });

  it('still ranks a decided RFQ, so the record reads the same afterwards', () => {
    const c = compareQuotes([
      { id: 'a', vendorName: 'A', total: '100.00', leadTimeDays: 5, status: 'AWARDED' },
      { id: 'b', vendorName: 'B', total: '90.00', leadTimeDays: 20, status: 'LOST' },
      { id: 'c', vendorName: 'C', total: null, leadTimeDays: null, status: 'DECLINED' },
    ]);
    expect(c.responded).toBe(2);
    expect(c.cheapestQuoteId).toBe('b');
    expect(c.rows.find((r) => r.id === 'a')!.premiumOverCheapest).toBe('10.00');
  });
});

describe('quoteSubtotal', () => {
  it('rounds each line once, then sums', () => {
    expect(quoteSubtotal([{ quantity: '3', unitPrice: '19.99' }]).toFixed(2)).toBe('59.97');
    expect(
      quoteSubtotal([
        { quantity: '2', unitPrice: '0.1' },
        { quantity: '1', unitPrice: '0.2' },
      ]).toFixed(2),
    ).toBe('0.40');
  });
});

describe('losingQuoteMessage', () => {
  it('names the winner so the next step is obvious', () => {
    expect(losingQuoteMessage({ vendorName: 'Contoso' }, { vendorName: 'Northwind' })).toContain('Northwind was');
    expect(losingQuoteMessage({ vendorName: 'Contoso' }, null)).toMatch(/Award one first/);
  });
});
