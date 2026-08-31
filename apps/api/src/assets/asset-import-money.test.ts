import { describe, expect, it } from 'vitest';
import { AssetImportService } from './asset-import.service.js';

/**
 * Money parsing from a spreadsheet cell (v2.29).
 *
 * Tested on its own because the failure mode is silent: a cell that parses to
 * the WRONG number is worse than one that fails to parse, and the two are
 * indistinguishable in an import summary. Everything here is a value someone
 * has plausibly typed into a cost column.
 */

// The parser touches no injected dependency, so it is exercised directly rather
// than through a Nest module the assertions would not benefit from.
const parse = (value: string | number | Date | null) =>
  AssetImportService.prototype.parseMoney.call(null as never, value);

describe('parsing a price from a sheet', () => {
  it('reads a plain number, from text or a numeric cell', () => {
    expect(parse('68000')?.toString()).toBe('68000');
    expect(parse(68000)?.toString()).toBe('68000');
    expect(parse('68000.50')?.toString()).toBe('68000.5');
  });

  it('reads what people actually type', () => {
    // Thousands separators, a symbol, a code, and stray whitespace.
    expect(parse('68,000')?.toString()).toBe('68000');
    expect(parse('₹68,000')?.toString()).toBe('68000');
    expect(parse('  68000  ')?.toString()).toBe('68000');
    expect(parse('INR 68,000')?.toString()).toBe('68000');
    expect(parse('Rs. 68,000')?.toString()).toBe('68000');
  });

  it('reads Indian lakh grouping, which Number() alone cannot', () => {
    // 1,20,000 is how this is written locally, and the company's base currency
    // is INR. Plain Number('1,20,000') is NaN.
    expect(parse('1,20,000')?.toString()).toBe('120000');
    expect(parse('₹1,20,000.75')?.toString()).toBe('120000.75');
  });

  it('rounds to two places, the scale the column stores', () => {
    expect(parse('68000.456')?.toString()).toBe('68000.46');
  });

  it('returns null for an empty cell rather than a zero', () => {
    expect(parse(null)).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
  });

  it('refuses a literal zero', () => {
    // An asset does not cost nothing. A 0 here is an empty row, a formula that
    // produced no value, or a placeholder - and recording it as a real price
    // would turn a genuine gap into a settled fact.
    expect(parse('0')).toBeNull();
    expect(parse(0)).toBeNull();
    expect(parse('0.00')).toBeNull();
  });

  it('refuses a negative rather than silently taking its magnitude', () => {
    // A minus sign in a cost column means the sheet is not what we think it is.
    expect(parse('-500')).toBeNull();
    expect(parse(-500)).toBeNull();
  });

  it('refuses anything it cannot read with confidence', () => {
    // "12-15k" is a range, "TBD" is a note, "12/15" is probably a date that
    // landed in the wrong column. A guess at any of them would be a price
    // nobody typed.
    expect(parse('TBD')).toBeNull();
    expect(parse('12-15k')).toBeNull();
    expect(parse('12/15')).toBeNull();
    expect(parse('approx 50000')).toBeNull();
    expect(parse(new Date())).toBeNull();
    expect(parse(Number.NaN)).toBeNull();
  });
});
