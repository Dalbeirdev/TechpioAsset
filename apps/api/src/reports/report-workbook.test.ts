import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ReportColumn, ReportRow } from './report-format.js';
import { buildWorkbook, HEADER_ROW, MAX_WORKBOOK_ROWS } from './report-workbook.js';

/**
 * The workbook is checked by reading it back with the same library that opens
 * it, rather than by asserting on the bytes. What matters is what a person sees
 * when they double-click the file, and every defect this file has caught so far
 * - a count formatted as money, a heading hidden behind its own filter button -
 * was invisible in the source and obvious in the opened sheet.
 */

const columns: ReportColumn[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'otherCount', label: 'Other items', numeric: true },
  { key: 'cost', label: 'Purchase cost', numeric: true, decimals: 2 },
  { key: 'otherItems', label: 'Other items held' },
];

const header = {
  companyName: 'TechPIO Services LLP',
  reportTitle: 'Employee assets',
  preparedBy: 'Harry Singh',
  preparedByPhone: '9876819230',
  generatedAt: new Date('2026-08-31T14:32:00Z'),
  filters: ['Office: Mohali'],
};

async function open(rows: ReportRow[], cols = columns) {
  const buffer = await buildWorkbook(header, cols, rows);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}

const oneRow: ReportRow[] = [
  { employee: 'Deepak Bhatt', otherCount: 4, cost: 68000, otherItems: 'ACC-1\nACC-2' },
];

describe('the branded workbook', () => {
  it('carries the letterhead: company, who prepared it and their number', async () => {
    const ws = await open(oneRow);
    const text = [5, 6, 7].map((r) => String(ws.getRow(r).getCell(1).value ?? '')).join(' | ');

    expect(text).toContain('Employee assets');
    expect(text).toContain('TechPIO Services LLP');
    expect(text).toContain('Harry Singh');
    expect(text).toContain('9876819230');
  });

  it('says which filters were applied, so a partial export cannot pass as a full one', async () => {
    const ws = await open(oneRow);
    expect(String(ws.getRow(7).getCell(1).value)).toContain('Office: Mohali');
  });

  it('embeds the logo', async () => {
    const buffer = await buildWorkbook(header, columns, oneRow);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    // The image lives on the workbook; the placement lives on the sheet.
    expect(wb.model.media.length).toBeGreaterThan(0);
    expect(wb.worksheets[0].getImages()).toHaveLength(1);
  });

  it('counts whole items and money to two places', async () => {
    const ws = await open(oneRow);
    const row = ws.getRow(HEADER_ROW + 1);
    expect(row.getCell(2).numFmt).toBe('#,##0');
    expect(row.getCell(3).numFmt).toBe('#,##0.00');
  });

  it('keeps headings clear of the filter button that sits on their right edge', async () => {
    const ws = await open(oneRow);
    const heading = ws.getRow(HEADER_ROW).getCell(2);
    // Right-aligned heading text ends exactly under the dropdown, so no width
    // can rescue it. Left alignment is the fix, and the reason it is asserted.
    expect(heading.alignment?.horizontal).toBe('left');
    expect(ws.getColumn(2).width ?? 0).toBeGreaterThan('Other items'.length);
  });

  it('gives a multi-line cell the height to show every line', async () => {
    const ws = await open(oneRow);
    // Two items listed in one cell; a single-line height would hide the second,
    // which is the whole point of consolidating them onto the row.
    expect(ws.getRow(HEADER_ROW + 1).height ?? 0).toBeGreaterThan(20);
  });

  it('freezes the headings and offers filters', async () => {
    const ws = await open(oneRow);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: HEADER_ROW });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('writes a blank, not a zero, where a figure was never recorded', async () => {
    const ws = await open([{ employee: 'Nobody', otherCount: 0, cost: null, otherItems: '' }]);
    const cost = ws.getRow(HEADER_ROW + 1).getCell(3).value;
    // The distinction the whole cost column turns on: unpriced is not free.
    expect(cost === null || cost === '').toBe(true);
  });

  it('refuses a report too large for a spreadsheet, naming CSV instead', async () => {
    const many = Array.from({ length: MAX_WORKBOOK_ROWS + 1 }, () => ({
      employee: 'x',
      otherCount: 0,
      cost: null,
      otherItems: '',
    }));
    await expect(buildWorkbook(header, columns, many)).rejects.toThrow(/CSV/);
  });

  it('survives a report with no rows at all', async () => {
    const ws = await open([]);
    // An empty autoFilter range is invalid and makes Excel refuse the file, so
    // the filter is omitted rather than pointed at nothing.
    expect(ws.autoFilter).toBeFalsy();
    expect(String(ws.getRow(7).getCell(1).value)).toContain('0 rows');
  });
});
