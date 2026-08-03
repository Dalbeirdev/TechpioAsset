import { describe, it, expect } from 'vitest';
import { buildReceiveLines, canSubmitReceipt } from './receive';

/** v2.9 C5 — the dock's payload, provable without a phone. */

const category = 'cat-it';

describe('buildReceiveLines', () => {
  it('drops blank, zero and unparseable quantities', () => {
    const lines = buildReceiveLines({
      quantities: { a: '2', b: '', c: '0', d: 'abc' },
      categoryId: category,
      serials: {},
    });
    expect(lines.map((l) => l.purchaseOrderLineId)).toEqual(['a']);
    expect(lines[0]).toMatchObject({ quantity: 2, intake: 'ASSET', categoryId: category });
  });

  it('carries only the serials actually typed, in unit order', () => {
    const lines = buildReceiveLines({
      quantities: { a: '3' },
      categoryId: category,
      serials: { a: ['SER-1', '  ', 'SER-3'] },
    });
    // The blank middle unit is skipped, not sent as an empty string - it would
    // otherwise be stored as a serial nobody can match to a box.
    expect(lines[0]!.serialNumbers).toEqual(['SER-1', 'SER-3']);
  });

  it('never sends more serials than units received', () => {
    // Typed four, then changed the quantity to two: the last two units did not
    // arrive, so their serials must not travel with the receipt.
    const lines = buildReceiveLines({
      quantities: { a: '2' },
      categoryId: category,
      serials: { a: ['S1', 'S2', 'S3', 'S4'] },
    });
    expect(lines[0]!.serialNumbers).toEqual(['S1', 'S2']);
  });

  it('omits the serial field entirely when nothing was read', () => {
    const lines = buildReceiveLines({
      quantities: { a: '1' },
      categoryId: category,
      serials: { a: ['   '] },
    });
    expect(lines[0]).not.toHaveProperty('serialNumbers');
  });

  it('trims what was typed, because a scanner sometimes adds whitespace', () => {
    const lines = buildReceiveLines({
      quantities: { a: '1' },
      categoryId: category,
      serials: { a: ['  SER-9  '] },
    });
    expect(lines[0]!.serialNumbers).toEqual(['SER-9']);
  });
});

describe('canSubmitReceipt', () => {
  it('refuses without a category - the API would refuse it too', () => {
    const lines = buildReceiveLines({ quantities: { a: '1' }, categoryId: '', serials: {} });
    expect(canSubmitReceipt(lines, '')).toBe(false);
    expect(canSubmitReceipt(lines, category)).toBe(true);
  });

  it('refuses when no line has a quantity', () => {
    expect(canSubmitReceipt([], category)).toBe(false);
  });
});
