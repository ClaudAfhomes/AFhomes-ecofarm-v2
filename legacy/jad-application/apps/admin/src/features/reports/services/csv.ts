/**
 * CSV export utilities (client-side). The API stays JSON-only (all responses
 * go through the typed Zod-validated client), so file generation happens in
 * the browser: build the string, hand it to a Blob, trigger a download.
 */

/** A CSV column maps one report row to one cell value. */
export interface CsvColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string;
}

function escapeCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Render rows as RFC 4180-ish CSV (CRLF line endings, quoted when a cell
 * contains a comma, quote, or newline). Money stays a raw exact-decimal
 * string - never a float or a locale-formatted display string.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCell(c.value(row) ?? '')).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/** Download `csv` as `filename` (Excel-friendly UTF-8 BOM prefix). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
