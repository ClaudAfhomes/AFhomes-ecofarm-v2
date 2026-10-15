import { describe, expect, it } from 'vitest';

import { escapeCsvCell, toCsv, toPdf, toXlsx, toXlsxMulti } from './report-export.js';
import { readXlsxSheets } from './customer-xlsx.js';

describe('CSV export', () => {
  it('emits stable headers, a BOM, and CRLF rows', () => {
    const csv = toCsv(['Sale number', 'Amount'], [['SALE-1', '60000.00']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Sale number,Amount');
    expect(csv).toContain('SALE-1,60000.00');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(60000)).toBe('60000');
    const csv = toCsv(['Note'], [['a,"b"\nc']]);
    expect(csv).toContain('"a,""b""\nc"');
  });

  it('neutralizes spreadsheet formula injection on every lead character', () => {
    for (const lead of ['=', '+', '-', '@']) {
      const cell = escapeCsvCell(`${lead}SUM(A1:A2)`);
      expect(cell.startsWith("'")).toBe(true);
      expect(cell).toBe(`'${lead}SUM(A1:A2)`);
    }
    // Tabs and carriage returns are also Excel formula vectors. A cell that
    // also needs RFC 4180 quoting is still safe: the quote wraps a value
    // whose first content character is the text-forcing apostrophe.
    const tabbed = escapeCsvCell('\tHYPERLINK("x")');
    expect(tabbed.startsWith(`"'`)).toBe(true);
    expect(tabbed).toContain(`'\tHYPERLINK`);
    // Ordinary text is untouched - the guard only fires on the first char.
    expect(escapeCsvCell('Total 100')).toBe('Total 100');
    expect(escapeCsvCell(' - spaced').startsWith("'")).toBe(false);
  });

  it('is safe for an empty dataset (headers only)', () => {
    const csv = toCsv(['A', 'B'], []);
    expect(csv).toContain('A,B');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('XLSX export', () => {
  const columns = [
    { label: 'Sale', type: 'text' as const },
    { label: 'Amount', type: 'money' as const },
    { label: 'Points', type: 'number' as const },
    { label: 'Date', type: 'date' as const },
  ];

  it('produces a stored-ZIP package with the workbook parts', () => {
    const bytes = toXlsx('Sales', columns, [['SALE-1', '60000.00', 5, '2026-09-01T00:00:00.000Z']]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('xl/styles.xml');
  });

  it('carries header labels, text values, and exact numerics uncompressed', () => {
    const bytes = toXlsx('Sales', columns, [['SALE-1', '60000.00', 5, '2026-09-01T00:00:00.000Z']]);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('>Sale<');
    expect(text).toContain('>SALE-1<');
    expect(text).toContain('<v>60000</v>');
    expect(text).toContain('<v>5</v>');
  });

  it('escapes XML metacharacters in text cells', () => {
    const bytes = toXlsx('R', [{ label: 'N', type: 'text' }], [['a&b<c>"d"']]);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('a&amp;b&lt;c&gt;&quot;d&quot;');
  });

  it('renders an empty dataset as a header-only sheet', () => {
    const bytes = toXlsx('Empty', columns, []);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('dimension ref="A1:D1"');
  });
});

describe('multi-sheet XLSX export', () => {
  it('writes named tabs with per-sheet header tints, filters, and frozen panes', () => {
    const bytes = toXlsxMulti('Template', [
      {
        name: 'Primary',
        columns: [{ label: 'RA NO', type: 'text' }],
        rows: [[]],
        headerTone: 'blue',
      },
      {
        name: 'Package',
        columns: [{ label: 'RF', type: 'text' }],
        rows: [[]],
        headerTone: 'purple',
      },
    ]);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('name="Primary"');
    expect(text).toContain('name="Package"');
    expect(text).toContain('xl/worksheets/sheet2.xml');
    // Section tints plus frozen panes plus auto-filters per tab.
    expect(text).toContain('FF4472C4');
    expect(text).toContain('FF7030A0');
    expect(text).toContain('state="frozen"');
    expect(text).toContain('<autoFilter ref="A1:A1"/>');
  });

  it('paints tab colors and a prepared zebra grid with honored widths', () => {
    const bytes = toXlsxMulti('Template', [
      {
        name: 'Primary',
        columns: [{ label: 'ADDRESS', type: 'text', width: 32 }],
        rows: [[], []],
        headerTone: 'blue',
        tabColor: 'FF4472C4',
        zebra: true,
      },
    ]);
    const text = Buffer.from(bytes).toString('utf8');
    // Tab color rides in sheetPr, first in the worksheet sequence.
    expect(text).toContain('<sheetPr><tabColor rgb="FF4472C4"/></sheetPr>');
    // White bold header text sits on the saturated section fill (font 2,
    // cellXfs 1), so the column-name row reads as colored at a glance.
    expect(text).toContain('<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>');
    expect(text).toContain('fontId="2" fillId="2"');
    // Prepared grid: headers get a taller bordered row, blanks are styled,
    // and rows alternate plain / zebra fills (cellXfs 9 and 10).
    expect(text).toContain('ht="26" customHeight="1"');
    expect(text).toContain('<c r="A2" s="9"/>');
    expect(text).toContain('<c r="A3" s="10"/>');
    expect(text).toContain('FFF2F2F2');
    expect(text).toContain('style="thin"');
    // The explicit width wins over the empty-content best fit.
    expect(text).toContain('<col min="1" max="1" width="32" customWidth="1"/>');
  });

  it('ignores a malformed tab color instead of writing bad XML', () => {
    const bytes = toXlsxMulti('Template', [
      {
        name: 'Primary',
        columns: [{ label: 'RA NO', type: 'text' }],
        rows: [[]],
        tabColor: '"><bad/>',
      },
    ]);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).not.toContain('tabColor');
    expect(text).not.toContain('<bad/>');
  });

  it('rejects duplicate sheet names and empty specs', () => {
    const sheet = {
      name: 'Primary',
      columns: [{ label: 'RA NO', type: 'text' as const }],
      rows: [[]] as unknown[][],
    };
    expect(() => toXlsxMulti('T', [sheet, { ...sheet }])).toThrow(/duplicate/i);
    expect(() => toXlsxMulti('T', [])).toThrow(/1 to 16/);
  });

  it('keeps sheetData before autoFilter so strict readers keep the rows', () => {
    // The worksheet XSD sequences sheetData before autoFilter. A filter
    // before the data made strict Excel readers drop the rows it annotated,
    // leaving tabs with no visible column names while lenient parsers (and
    // our own reader) still saw them.
    const bytes = toXlsxMulti('Template', [
      {
        name: 'Primary',
        columns: [{ label: 'RA NO', type: 'text' }],
        rows: [['x']],
      },
    ]);
    const sheets = readXlsxSheets(bytes);
    expect(sheets[0]!.matrix[0]).toEqual(['RA NO']);
    const text = Buffer.from(bytes).toString('utf8');
    const sheetStart = text.indexOf('<worksheet');
    const sheetEnd = text.indexOf('</worksheet>', sheetStart);
    const sheet = text.substring(sheetStart, sheetEnd);
    expect(sheet.indexOf('<sheetData>')).toBeLessThan(sheet.indexOf('<autoFilter'));
    expect(sheet.indexOf('<autoFilter')).toBeGreaterThan(-1);
  });
});

describe('PDF export', () => {
  it('produces a valid PDF with title, scope, summary, and table', () => {
    const bytes = toPdf({
      title: 'AFHomes - sales report',
      generatedAt: '2026-09-28T00:00:00.000Z',
      scopeLabel: 'Global (super_admin)',
      windowLabel: '2026-09-01 to 2026-09-30',
      summaryLines: ['Sales: 2  |  Gross frozen value: 100000.00'],
      headers: ['Sale number', 'Amount'],
      rows: [['SALE-1', '60000.00']],
    });
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('AFHomes - sales report');
    // PDF literal strings escape parentheses - the scope label is present,
    // just PDF-escaped.
    expect(text).toContain('Global \\(super_admin\\)');
    expect(text).toContain('SALE-1');
    expect(text).toContain('Page 1 of 1');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('caps rows explicitly instead of truncating silently', () => {
    const rows = Array.from({ length: 900 }, (_, i) => [`SALE-${i}`, '1.00']);
    const bytes = toPdf({
      title: 'T',
      generatedAt: 'now',
      scopeLabel: 's',
      windowLabel: 'w',
      summaryLines: [],
      headers: ['A', 'B'],
      rows,
    });
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toContain('use CSV or XLSX for the full set');
    expect(text).toContain('Page 1 of');
  });

  it('renders an empty dataset without error', () => {
    const bytes = toPdf({
      title: 'AFHomes - sales report',
      generatedAt: 'now',
      scopeLabel: 's',
      windowLabel: 'w',
      summaryLines: ['Sales: 0'],
      headers: ['A'],
      rows: [],
    });
    expect(Buffer.from(bytes).toString('latin1').startsWith('%PDF')).toBe(true);
  });
});
