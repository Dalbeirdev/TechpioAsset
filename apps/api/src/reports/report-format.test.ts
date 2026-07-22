import { describe, it, expect } from 'vitest';
import { toCsv, toSpreadsheetMl, type ReportTable } from './report-format.js';

const table: ReportTable = {
  title: 'Spending by vendor',
  columns: [
    { key: 'name', label: 'Vendor' },
    { key: 'count', label: 'Assets', numeric: true },
    { key: 'total', label: 'Total spend', numeric: true },
  ],
  rows: [
    { name: 'Dell', count: 3, total: 4999.97 },
    { name: 'Apple, Inc.', count: 2, total: 3898.0 },
  ],
};

describe('toCsv', () => {
  it('renders a header and rows', () => {
    const csv = toCsv(table);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Vendor,Assets,Total spend');
    expect(lines[1]).toBe('Dell,3,4999.97');
  });

  it('quotes a value containing a comma (RFC 4180)', () => {
    const csv = toCsv(table);
    expect(csv).toContain('"Apple, Inc."');
  });

  it('escapes embedded quotes by doubling them', () => {
    const csv = toCsv({
      title: 't',
      columns: [{ key: 'x', label: 'X' }],
      rows: [{ x: 'a "quoted" value' }],
    });
    expect(csv).toContain('"a ""quoted"" value"');
  });
});

describe('toSpreadsheetMl', () => {
  it('produces an Excel-openable workbook with numeric cells typed as numbers', () => {
    const xml = toSpreadsheetMl(table);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('ss:Type="Number">4999.97');
    expect(xml).toContain('ss:Type="String">Dell');
  });

  it('XML-escapes special characters', () => {
    const xml = toSpreadsheetMl({
      title: 't',
      columns: [{ key: 'x', label: 'X' }],
      rows: [{ x: 'a & b < c' }],
    });
    expect(xml).toContain('a &amp; b &lt; c');
  });
});
