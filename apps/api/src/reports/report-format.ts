/**
 * Report serialisation to CSV and Excel (spec section 18).
 *
 * Excel is emitted as SpreadsheetML 2003 (an XML .xls) rather than a binary
 * .xlsx, so there is no native dependency and the output is a plain string that
 * is trivial to unit-test. Every real spreadsheet application opens it.
 */

export interface ReportColumn {
  key: string;
  label: string;
  /** Right-aligned numeric column, rendered as a number in Excel. */
  numeric?: boolean;
  /**
   * Decimal places in the workbook. Money is 2; a count is 0 (v2.28).
   *
   * Added because every numeric column formatted as money, so "4 other items"
   * printed as "4.00" - which reads as a measurement rather than a tally, and
   * invites the question of what four and a half accessories would be.
   */
  decimals?: number;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

/** Escapes a value for CSV per RFC 4180. */
function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * v2.10 S5 — the incremental pieces.
 *
 * `toCsv` and `toSpreadsheetMl` still exist and still return one string; they
 * are now written IN TERMS OF these, so the streamed bytes and the buffered
 * bytes cannot drift apart. Two encoders for one format is how an export starts
 * quoting commas differently depending on how big it was.
 */
export function csvHeaderLine(columns: readonly ReportColumn[]): string {
  return columns.map((c) => csvCell(c.label)).join(',');
}

export function csvRowLine(columns: readonly ReportColumn[], row: ReportRow): string {
  return columns.map((c) => csvCell(row[c.key] ?? '')).join(',');
}

export function toCsv(table: ReportTable): string {
  return [csvHeaderLine(table.columns), ...table.rows.map((r) => csvRowLine(table.columns, r))].join(
    '\r\n',
  );
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spreadsheetCell(value: string | number | null, numeric: boolean): string {
  if (value === null || value === undefined || value === '') {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (numeric && typeof value !== 'string') {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  if (numeric && /^-?\d+(\.\d+)?$/.test(String(value))) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

/** Everything up to and including the header row. */
export function spreadsheetPrologue(title: string, columns: readonly ReportColumn[]): string {
  const headerRow = `<Row>${columns
    .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c.label)}</Data></Cell>`)
    .join('')}</Row>`;
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    `<Worksheet ss:Name="${xmlEscape(title).slice(0, 31)}">`,
    '<Table>',
    headerRow,
  ].join('');
}

export function spreadsheetRow(columns: readonly ReportColumn[], row: ReportRow): string {
  return `<Row>${columns.map((c) => spreadsheetCell(row[c.key] ?? '', c.numeric ?? false)).join('')}</Row>`;
}

export function spreadsheetEpilogue(): string {
  return '</Table></Worksheet></Workbook>';
}

/** SpreadsheetML 2003 — opens in Excel, LibreOffice and Numbers. */
export function toSpreadsheetMl(table: ReportTable): string {
  return [
    spreadsheetPrologue(table.title, table.columns),
    ...table.rows.map((r) => spreadsheetRow(table.columns, r)),
    spreadsheetEpilogue(),
  ].join('');
}

/**
 * v2.28 - XLSX is now a real .xlsx, built by `report-workbook.ts`.
 *
 * It was SpreadsheetML 2003 served as `application/vnd.ms-excel` with an `.xls`
 * extension: openable everywhere, but Excel warned on every open that the
 * contents did not match the extension, and the format carries no images, so a
 * letterhead was impossible. The SpreadsheetML encoder below is kept because
 * `toSpreadsheetMl` is still exercised by its tests and costs nothing to keep.
 */
export const REPORT_CONTENT_TYPE = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export const REPORT_EXTENSION = { CSV: 'csv', XLSX: 'xlsx' } as const;
