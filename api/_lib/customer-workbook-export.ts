import { CUSTOMER_WORKBOOK_SHEETS } from '@afhomes/contracts';
import { readWorkbookParts } from './customer-xlsx.js';
import { WORKBOOK_FIELDS } from './customer-workbook.js';
import { zipStored } from './report-export.js';
import { readRuntimeAsset } from './runtime-assets.js';

export function companyTemplate(): Uint8Array {
  return readRuntimeAsset('customer-company-template.xlsx');
}
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Only literal text is inserted; untrusted values can never become spreadsheet formulas. */
export function companyWorkbook(rows: Record<string, string>[]): Uint8Array {
  if (rows.length > 5000) throw new Error('Company workbook supports at most 5000 customers');
  const parts = readWorkbookParts(companyTemplate());
  const styles = new TextDecoder().decode(parts.get('xl/styles.xml'));
  const dateStyle = Number(/<cellXfs\b[^>]*count="(\d+)"/.exec(styles)?.[1]) - 1;
  CUSTOMER_WORKBOOK_SHEETS.forEach((name, sheetIndex) => {
    const path = `xl/worksheets/sheet${sheetIndex + 2}.xml`;
    let text = new TextDecoder().decode(parts.get(path));
    const dataRows = rows.map((row, i) => {
      const cells = WORKBOOK_FIELDS[name]!.flatMap((field, j) => {
        if (['age', 'secondary_age'].includes(field) || !row[field]) return [];
        const col = String.fromCharCode(65 + j);
        if (
          ['birth_date', 'secondary_birth_date', 'stated_date'].includes(field) &&
          /^\d{4}-\d{2}-\d{2}$/.test(row[field]!)
        ) {
          let serial = Date.parse(row[field]! + 'T00:00:00Z') / 86400000 + 25569;
          if (serial < 61) serial--; // Excel's fictional 1900 leap day starts at serial 60.
          return [`<c r="${col}${i + 2}" s="${dateStyle}"><v>${serial}</v></c>`];
        }
        return [
          `<c r="${col}${i + 2}" t="inlineStr"><is><t xml:space="preserve">${escape(row[field]!)}</t></is></c>`,
        ];
      }).join('');
      return { index: i + 2, cells };
    });
    const existing = new Set<number>();
    text = text.replace(
      /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g,
      (row: string, raw: string) => {
        const n = Number(raw);
        existing.add(n);
        if (n <= 1 || !dataRows[n - 2]) return row;
        const populated = row.replace('</row>', dataRows[n - 2]!.cells + '</row>');
        const cells = [...populated.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)].map(
          (match) => match[0],
        );
        const column = (cell: string) => /\br="([A-Z]+)/.exec(cell)?.[1] ?? '';
        cells.sort(
          (a, b) => column(a).length - column(b).length || column(a).localeCompare(column(b)),
        );
        return populated.replace(
          /(<row\b[^>]*>)[\s\S]*(<\/row>)/,
          (_all, start: string, end: string) => start + cells.join('') + end,
        );
      },
    );
    const extra = dataRows
      .filter((row) => !existing.has(row.index))
      .map((row) => `<row r="${row.index}">${row.cells}</row>`)
      .join('');
    text = text.replace('</sheetData>', extra + '</sheetData>');
    const lastColumn = String.fromCharCode(64 + WORKBOOK_FIELDS[name]!.length);
    const lastRow = Math.max(rows.length + 1, ...existing);
    text = text.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${lastColumn}${lastRow}"/>`);
    parts.set(path, new TextEncoder().encode(text));
  });
  if (rows.some((row) => row.system_customer_number)) {
    const cells = (values: string[], index: number) =>
      `<row r="${index}">${values.map((value, i) => `<c r="${String.fromCharCode(65 + i)}${index}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
    const readout =
      cells(['System verification — read-only; entry-tab values remain company statements'], 122) +
      cells(
        [
          'Excel row',
          'Customer ID',
          'Customer status',
          'Membership status',
          'Payment status',
          'Derived category',
        ],
        123,
      ) +
      rows
        .map((row, i) =>
          cells(
            [
              String(i + 2),
              row.system_customer_number ?? '',
              row.system_customer_status ?? '',
              row.system_membership_status ?? '',
              row.system_payment_status ?? '',
              row.system_category ?? '',
            ],
            124 + i,
          ),
        )
        .join('');
    const path = 'xl/worksheets/sheet1.xml';
    const text = new TextDecoder()
      .decode(parts.get(path))
      .replace('</sheetData>', readout + '</sheetData>')
      .replace('</cols>', '<col min="4" max="6" width="30" customWidth="1"/></cols>')
      .replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:F${123 + rows.length}"/>`);
    parts.set(path, new TextEncoder().encode(text));
  }
  return zipStored(
    [...parts].map(([name, data]) => ({ name, data })),
    true,
  );
}
