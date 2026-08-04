import { describe, expect, it } from 'vitest';
import {
  batchShortfallMessage,
  expiryState,
  isExpired,
  planBatchIssue,
  sortBatchesForIssue,
} from './batch.js';

/**
 * v2.9 C4. FIFO-by-expiry and the expired-stock refusal, provable without a
 * warehouse.
 */

const on = '2026-06-15';

const batch = (
  id: string,
  quantity: number,
  expiryDate: string | null,
  receivedAt = '2026-01-01',
) => ({ id, batchNumber: `LOT-${id}`, quantity, expiryDate, receivedAt });

describe('isExpired', () => {
  it('treats the expiry date itself as still usable', () => {
    expect(isExpired({ expiryDate: '2026-06-15' }, on)).toBe(false);
    expect(isExpired({ expiryDate: '2026-06-14' }, on)).toBe(true);
    expect(isExpired({ expiryDate: null }, on)).toBe(false);
  });
});

describe('expiryState', () => {
  it('separates fine, going off soon, and gone off', () => {
    expect(expiryState({ expiryDate: '2026-12-31' }, on, 30)).toBe('OK');
    expect(expiryState({ expiryDate: '2026-07-01' }, on, 30)).toBe('EXPIRING_SOON');
    expect(expiryState({ expiryDate: '2026-01-01' }, on, 30)).toBe('EXPIRED');
    expect(expiryState({ expiryDate: null }, on, 30)).toBe('NO_EXPIRY');
  });
});

describe('sortBatchesForIssue', () => {
  it('puts the soonest expiry first', () => {
    const order = sortBatchesForIssue([
      batch('c', 5, '2027-01-01'),
      batch('a', 5, '2026-07-01'),
      batch('b', 5, '2026-09-01'),
    ]).map((b) => b.id);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('sorts undated stock last - it is never the urgent one to use up', () => {
    const order = sortBatchesForIssue([
      batch('undated', 5, null),
      batch('dated', 5, '2030-01-01'),
    ]).map((b) => b.id);
    expect(order).toEqual(['dated', 'undated']);
  });

  it('breaks ties by receipt date, which is FIFO in the plain sense', () => {
    const order = sortBatchesForIssue([
      batch('newer', 5, '2026-08-01', '2026-05-01'),
      batch('older', 5, '2026-08-01', '2026-02-01'),
    ]).map((b) => b.id);
    expect(order).toEqual(['older', 'newer']);
  });
});

describe('planBatchIssue', () => {
  it('consumes the earliest expiry first and stops when covered', () => {
    const plan = planBatchIssue([batch('late', 10, '2027-01-01'), batch('soon', 4, '2026-07-01')], 6, { on });
    expect(plan.picks.map((p) => [p.batchId, p.quantity])).toEqual([
      ['soon', '4'],
      ['late', '2'],
    ]);
    expect(plan.shortfall).toBe('0');
  });

  it('skips expired stock and reports how much it skipped', () => {
    const plan = planBatchIssue([batch('gone', 100, '2026-01-01'), batch('good', 3, '2027-01-01')], 5, { on });
    expect(plan.picks.map((p) => p.batchId)).toEqual(['good']);
    expect(plan.shortfall).toBe('2');
    expect(plan.expiredSkipped).toBe('100');
    expect(plan.usedExpired).toBe(false);
  });

  it('uses expired stock only when explicitly allowed, and says that it did', () => {
    const plan = planBatchIssue([batch('gone', 100, '2026-01-01')], 5, { on, allowExpired: true });
    expect(plan.picks).toHaveLength(1);
    expect(plan.picks[0]!.expired).toBe(true);
    expect(plan.usedExpired).toBe(true);
    expect(plan.shortfall).toBe('0');
  });

  it('does not report using expired stock when fresh stock covered the request', () => {
    // The override was given but never needed - the reason should not read as
    // if somebody handed out expired goods.
    const plan = planBatchIssue([batch('good', 10, '2027-01-01'), batch('gone', 10, '2026-01-01')], 5, {
      on,
      allowExpired: true,
    });
    expect(plan.usedExpired).toBe(false);
    expect(plan.picks.map((p) => p.batchId)).toEqual(['good']);
  });

  it('ignores emptied batches rather than planning zero-quantity picks', () => {
    const plan = planBatchIssue([batch('empty', 0, '2026-07-01'), batch('full', 5, '2026-08-01')], 3, { on });
    expect(plan.picks.map((p) => p.batchId)).toEqual(['full']);
  });

  it('reports the whole request as shortfall when there is nothing at all', () => {
    const plan = planBatchIssue([], 7, { on });
    expect(plan.picks).toEqual([]);
    expect(plan.shortfall).toBe('7');
  });

  it('splits fractional quantities exactly', () => {
    const plan = planBatchIssue([batch('a', 1.5, '2026-07-01'), batch('b', 2, '2026-08-01')], 2.25, { on });
    expect(plan.picks.map((p) => p.quantity)).toEqual(['1.5', '0.75']);
    expect(plan.shortfall).toBe('0');
  });
});

describe('batchShortfallMessage', () => {
  it('separates "you do not have it" from "you have it but it has gone off"', () => {
    const plan = planBatchIssue([batch('gone', 100, '2026-01-01'), batch('good', 3, '2027-01-01')], 5, { on });
    const message = batchShortfallMessage('Printer toner', 5, plan);
    expect(message).toContain('only 3 available');
    expect(message).toContain('further 100 has expired');
    expect(message).toMatch(/issue it explicitly with a reason/i);
  });

  it('does not mention expiry when expiry was not the problem', () => {
    const plan = planBatchIssue([batch('good', 1, '2027-01-01')], 5, { on });
    expect(batchShortfallMessage('Printer toner', 5, plan)).not.toMatch(/expired/i);
  });
});
