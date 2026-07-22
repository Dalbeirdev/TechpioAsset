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
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}

/** Escapes a value for CSV per RFC 4180. */
function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(table: ReportTable): string {
  const header = table.columns.map((c) => csvCell(c.label)).join(',');
  const lines = table.rows.map((row) =>
    table.columns.map((c) => csvCell(row[c.key] ?? '')).join(','),
  );
  return [header, ...lines].join('\r\n');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** SpreadsheetML 2003 — opens in Excel, LibreOffice and Numbers. */
export function toSpreadsheetMl(table: ReportTable): string {
  const cell = (value: string | number | null, numeric: boolean): string => {
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
  };

  const headerRow = `<Row>${table.columns
    .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c.label)}</Data></Cell>`)
    .join('')}</Row>`;

  const dataRows = table.rows
    .map(
      (row) =>
        `<Row>${table.columns.map((c) => cell(row[c.key] ?? '', c.numeric ?? false)).join('')}</Row>`,
    )
    .join('');

  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    `<Worksheet ss:Name="${xmlEscape(table.title).slice(0, 31)}">`,
    '<Table>',
    headerRow,
    dataRows,
    '</Table></Worksheet></Workbook>',
  ].join('');
}

export const REPORT_CONTENT_TYPE = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.ms-excel',
} as const;

export const REPORT_EXTENSION = { CSV: 'csv', XLSX: 'xls' } as const;
