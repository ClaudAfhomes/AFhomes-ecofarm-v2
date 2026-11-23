/** Offline preparation only. Originals stay untouched; no data-entry values are retained. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readWorkbookParts } from '../api/_lib/customer-xlsx.js';
import { zipStored } from '../api/_lib/report-export.js';
const require = createRequire(new URL('../api/package.json', import.meta.url));
const { SaxesParser } = require('saxes') as typeof import('../api/node_modules/saxes/saxes.js');
const [kind, input] = process.argv.slice(2);
if (!['IST', 'OST'].includes(kind ?? '') || !input)
  throw new Error('Usage: sanitize-member-template.ts IST|OST source.xlsx');
const parts = readWorkbookParts(readFileSync(input));
const decode = (bytes: Uint8Array | undefined) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const encode = (s: string) => new TextEncoder().encode(s);
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const strings: string[] = [];
let current: string | null = null,
  inText = false;
const parser = new SaxesParser();
parser.on('doctype', () => {
  throw new Error('Document types forbidden');
});
parser.on('opentag', (tag) => {
  if (tag.name.split(':').pop() === 'si') current = '';
  if (tag.name.split(':').pop() === 't') inText = true;
});
parser.on('text', (text) => {
  if (current !== null && inText) current += text;
});
parser.on('closetag', (tag) => {
  if (tag.name.split(':').pop() === 't') inText = false;
  if (tag.name.split(':').pop() === 'si') {
    strings.push(current ?? '');
    current = null;
  }
});
if (parts.has('xl/sharedStrings.xml'))
  parser.write(decode(parts.get('xl/sharedStrings.xml'))).close();
const sheetNames = new Map<string, string>();
const relations = new Map<string, string>();
const relationships = new SaxesParser();
relationships.on('opentag', (tag) => {
  if (tag.name.split(':').pop() === 'Relationship')
    relations.set(String(tag.attributes.Id), String(tag.attributes.Target));
});
relationships.write(decode(parts.get('xl/_rels/workbook.xml.rels'))).close();
const workbook = new SaxesParser();
workbook.on('opentag', (tag) => {
  if (tag.name.split(':').pop() !== 'sheet') return;
  const id = Object.entries(tag.attributes).find(([key]) => key.endsWith(':id'))?.[1];
  const target = relations.get(String(id));
  if (!target) throw new Error('Missing sheet relationship');
  sheetNames.set(
    target.startsWith('/') ? target.slice(1) : 'xl/' + target,
    String(tag.attributes.name),
  );
});
workbook.write(decode(parts.get('xl/workbook.xml'))).close();
if (sheetNames.size < 10) throw new Error('Unexpected source layout');
const clean = [];
for (const [path, bytes] of parts) {
  if (/vba|externalLinks|connections|queryTables/i.test(path))
    throw new Error('Active/external content forbidden');
  if (/sharedStrings|calcChain|docProps\//.test(path)) continue;
  let text = decode(bytes);
  // Canonicalize only the spreadsheet namespace, preserving relationship namespaces.
  for (const match of text.matchAll(
    /xmlns:([A-Za-z0-9_]+)="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/g,
  )) {
    const prefix = match[1]!;
    text = text
      .replace(new RegExp(`<(/?)${prefix}:`, 'g'), '<$1')
      .replaceAll(match[0], 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
  }
  if (path.endsWith('.rels') && /TargetMode="External"/.test(text))
    throw new Error('External relationship forbidden');
  const name = sheetNames.get(path);
  if (name === 'Date Helper')
    text = text.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell) => {
      if (/\br="B[456]"/.test(cell))
        return cell.replace(/\bt="[^"]*"/g, '').replace(/(?:\/>|>[\s\S]*?<\/c>)$/, '/>');
      return /<f[\s>]/.test(cell)
        ? cell.replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>|<v\s*\/>/g, '')
        : cell;
    });
  if (
    name &&
    ['Identity', 'Team', 'Details', 'Accreditation', 'Teams', '_HeadMatches'].includes(name)
  ) {
    text = text.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, n) => {
      if (Number(n) === 1 && name !== '_HeadMatches') return row;
      return row.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell) => {
        if (/<f[\s>]/.test(cell))
          return cell
            .replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>|<v\s*\/>/g, '')
            .replace(/<is>[\s\S]*?<\/is>/g, '');
        // Retain the template's cell style/validation but no literal source values.
        return cell.replace(/\bt="[^"]*"/g, '').replace(/(?:\/>|>[\s\S]*?<\/c>)$/, '/>');
      });
    });
  }
  if (path.endsWith('.xml'))
    text = text.replace(
      /<c\b([^>]*\bt="s"[^>]*)>\s*<v>(\d+)<\/v>\s*<\/c>/g,
      (_cell, attrs: string, raw: string) => {
        const value = strings[Number(raw)];
        if (value === undefined) throw new Error('Invalid shared-string index');
        return `<c${attrs.replace('t="s"', 't="inlineStr"')}><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
      },
    );
  if (path.endsWith('.rels'))
    text = text.replace(/<Relationship\b[^>]*?(?:sharedStrings|calcChain|docProps)[^>]*\/>/g, '');
  if (path === '[Content_Types].xml')
    text = text.replace(/<Override\b[^>]*?(?:sharedStrings|calcChain|docProps)[^>]*\/>/g, '');
  if (name === 'README') {
    const row = 100;
    text = text.replace(
      '</sheetData>',
      () =>
        `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>AF HOMES IMPORT SAFETY</t></is></c><c r="B${row}" t="inlineStr"><is><t>Historical identities require authorized review. Keep all entry tabs aligned; never sort one alone. No passwords. Signatures are claims until independently verified. No account, approval or renewal is created by a spreadsheet formula. OST manual sponsorship requires an active Sales Manager. Desktop macro-free Excel cannot guarantee a calendar popup; use date cells / Date Helper. Keep this workbook private.</t></is></c></row></sheetData>`,
    );
    text = text.replace(/<dimension\b[^>]*\/>/, '<dimension ref="A1:F100"/>');
  }
  clean.push({ name: path, data: encode(text) });
}
const output = new URL(
  `../packages/contracts/assets/member-${kind!.toLowerCase()}-template-v2.xlsx`,
  import.meta.url,
);
writeFileSync(output, zipStored(clean, true));
console.log(
  `${kind}: sanitized blank template saved; source values, caches and shared-string pool removed.`,
);
