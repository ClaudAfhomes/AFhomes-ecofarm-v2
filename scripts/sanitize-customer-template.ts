/** One-time company-template preparation; reads OOXML only and never executes VBA. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { SaxesParser } from 'saxes';
import { readWorkbookParts } from '../api/_lib/customer-xlsx.js';
import { zipStored } from '../api/_lib/report-export.js';

const input = process.argv[2];
if (!input) throw new Error('Supply the original company XLSM path');
const parts = readWorkbookParts(readFileSync(input));
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strings: string[] = [];
let current: string | null = null;
let inText = false;
const parser = new SaxesParser();
parser.on('opentag', (tag) => {
  if (tag.name === 'si') current = '';
  if (tag.name === 't') inText = true;
});
parser.on('text', (s) => {
  if (current !== null && inText) current += s;
});
parser.on('closetag', (tag) => {
  if (tag.name === 't') inText = false;
  if (tag.name === 'si') {
    strings.push(current ?? '');
    current = null;
  }
});
parser.write(decoder.decode(parts.get('xl/sharedStrings.xml'))).close();
const clean: { name: string; data: Uint8Array }[] = [];
for (const [name, bytes] of parts) {
  if (/vbaProject|calcChain|sharedStrings|docProps\//i.test(name)) continue;
  let text = decoder.decode(bytes);
  if (name === 'xl/worksheets/sheet1.xml')
    text = text
      .replace(/<dimension\b[^>]*\/>/, '<dimension ref="A1:C120"/>')
      .replace(
        '</sheetData>',
        '<row r="120"><c r="A120" t="inlineStr"><is><t>SYSTEM IMPORT SAFEGUARDS</t></is></c><c r="B120" t="inlineStr"><is><t>STATUS and Package figures are company statements, not verified money or membership activation. Review in Finance. TIN is omitted from exports. Macros are removed and never run by the importer.</t></is></c></row></sheetData>',
      );
  if (name === 'xl/styles.xml')
    text = text.replace(
      /<cellXfs\b([^>]*\bcount="(\d+)"[^>]*)>([\s\S]*?)<\/cellXfs>/,
      (_match, attrs: string, count: string, styles: string) =>
        `<cellXfs${attrs.replace(`count="${count}"`, `count="${Number(count) + 1}"`)}>${styles}<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>`,
    );
  if (/^xl\/worksheets\/sheet[2-5]\.xml$/.test(name)) {
    text = text.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row: string, n: string) =>
      Number(n) === 1
        ? row
        : row.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, (cell: string) =>
            /<f[\s>]/.test(cell) ? cell.replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>/g, '<v/>') : '',
          ),
    );
  }
  if (name.endsWith('.xml'))
    text = text.replace(
      /<c\b([^>]*\bt="s"[^>]*)>\s*<v>(\d+)<\/v>\s*<\/c>/g,
      (_cell, attrs: string, index: string) =>
        `<c${attrs.replace('t="s"', 't="inlineStr"')}><is><t>${escape(strings[Number(index)] ?? '')}</t></is></c>`,
    );
  if (name.endsWith('.rels'))
    text = text.replace(
      /<Relationship\b[^>]*(?:vbaProject|calcChain|sharedStrings|docProps)[^>]*\/>/g,
      '',
    );
  if (name === '[Content_Types].xml')
    text = text
      .replace(/<Override\b[^>]*(?:vbaProject|calcChain|sharedStrings|docProps)[^>]*\/>/g, '')
      .replace(/<Default\b[^>]*Extension="bin"[^>]*\/>/g, '')
      .replace(
        'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      );
  clean.push({ name, data: encoder.encode(text) });
}
mkdirSync(new URL('../packages/contracts/assets/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../packages/contracts/assets/customer-company-template.xlsx', import.meta.url),
  zipStored(clean, true),
);
console.log(
  'Sanitized template saved; entry data, shared strings, VBA and author metadata removed.',
);
