/**
 * Minimal, dependency-free CSV serialisation for list exports.
 *
 * Values containing a comma, quote, or newline are wrapped in double quotes with
 * embedded quotes doubled, per RFC 4180. Rows use CRLF so the file opens cleanly
 * in Excel. A leading BOM makes Excel read it as UTF-8 (so accented names and
 * non-Latin scripts survive the round-trip).
 */
export interface CsvColumn {
  key: string;
  label: string;
}

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(columns: CsvColumn[], rows: Record<string, string>[]): string {
  const header = columns.map((c) => cell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(row[c.key] ?? '')).join(','));
  return '﻿' + [header, ...lines].join('\r\n');
}
