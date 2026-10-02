import { inflateRawSync } from 'node:zlib';
import { SaxesParser } from 'saxes';

/** Resource budgets apply before allocation/decompression, not after row parsing. */
export const XLSX_LIMITS = {
  upload: 8_000_000,
  expanded: 24_000_000,
  part: 6_000_000,
  sharedBytes: 4_000_000,
  strings: 100_000,
  cells: 250_000,
  columns: 64,
  text: 4096,
  rows: 5001,
  entries: 128,
} as const;
type Node = { name: string; attrs: Record<string, string>; text: string; children: Node[] };
function xml(bytes: Uint8Array): Node {
  const parser = new SaxesParser({ xmlns: false });
  const stack: Node[] = [];
  let root: Node | undefined;
  let count = 0;
  parser.on('doctype', () => {
    throw new Error('XML document types are unsupported');
  });
  parser.on('error', (e) => {
    throw new Error('Malformed spreadsheet XML: ' + e.message);
  });
  parser.on('opentag', (tag) => {
    if (++count > 600_000 || stack.length > 32)
      throw new Error('Spreadsheet XML structure limit exceeded');
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag.attributes)) attrs[k] = String(v);
    const node = { name: tag.name.split(':').pop()!, attrs, text: '', children: [] };
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  const append = (text: string) => {
    if (!text.trim()) return;
    const node = stack.at(-1);
    if (node) {
      if (node.text.length + text.length > XLSX_LIMITS.text)
        throw new Error('Spreadsheet cell text limit exceeded');
      node.text += text;
    }
  };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close();
  if (!root) throw new Error('Spreadsheet XML is empty');
  return root;
}
const children = (node: Node, name: string) => node.children.filter((n) => n.name === name);
const descendants = (node: Node, name: string): Node[] =>
  node.children.flatMap((n) => [...(n.name === name ? [n] : []), ...descendants(n, name)]);
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > XLSX_LIMITS.upload) throw new Error('Spreadsheet upload limit exceeded');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Malformed spreadsheet ZIP directory');
  const count = v.getUint16(end + 10, true);
  if (
    count > XLSX_LIMITS.entries ||
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0
  )
    throw new Error('Unsupported spreadsheet ZIP structure');
  let at = v.getUint32(end + 16, true),
    total = 0;
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50)
      throw new Error('Malformed ZIP entry');
    const flags = v.getUint16(at + 8, true),
      method = v.getUint16(at + 10, true),
      compressed = v.getUint32(at + 20, true),
      expanded = v.getUint32(at + 24, true),
      len = v.getUint16(at + 28, true),
      extra = v.getUint16(at + 30, true),
      comment = v.getUint16(at + 32, true),
      offset = v.getUint32(at + 42, true);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.slice(at + 46, at + 46 + len),
    );
    if (flags & 1 || ![0, 8].includes(method))
      throw new Error('Unsupported ZIP compression or encryption');
    if (
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((p) => p === '..' || p === '.') ||
      out.has(name)
    )
      throw new Error('Unsafe or duplicate ZIP path');
    const cap = name === 'xl/sharedStrings.xml' ? XLSX_LIMITS.sharedBytes : XLSX_LIMITS.part;
    if (expanded > cap || (total += expanded) > XLSX_LIMITS.expanded)
      throw new Error('Spreadsheet decompression limit exceeded');
    if (offset + 30 > bytes.length || v.getUint32(offset, true) !== 0x04034b50)
      throw new Error('Malformed local ZIP entry');
    const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    if (start + compressed > bytes.length) throw new Error('Truncated ZIP entry');
    const raw = bytes.slice(start, start + compressed);
    const value =
      method === 0
        ? raw
        : inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(cap, expanded)) });
    if (value.length !== expanded) throw new Error('ZIP size mismatch');
    if (crc32(value) !== v.getUint32(at + 16, true)) throw new Error('ZIP checksum mismatch');
    out.set(name, value);
    at += 46 + len + extra + comment;
  }
  return out;
}
export function readXlsx(bytes: Uint8Array): string[][] {
  const parts = zip(bytes);
  const part = (name: string) => {
    const p = parts.get(name);
    if (!p) throw new Error('Spreadsheet part is missing: ' + name);
    return xml(p);
  };
  const book = part('xl/workbook.xml'),
    rels = part('xl/_rels/workbook.xml.rels');
  const sheets = descendants(book, 'sheet');
  if (sheets.length !== 1)
    throw new Error(
      'Import requires exactly one worksheet; multiple payment sheets are not supported',
    );
  const id = sheets[0]!.attrs['r:id'];
  const rel = children(rels, 'Relationship').find((r) => r.attrs.Id === id);
  if (!rel || rel.attrs.TargetMode === 'External' || !rel.attrs.Type?.endsWith('/worksheet'))
    throw new Error('Unsupported worksheet relationship');
  const target = rel.attrs.Target ?? '';
  if (target.startsWith('/') || target.includes('..') || target.includes('\\'))
    throw new Error('Unsafe worksheet target');
  const strings = parts.has('xl/sharedStrings.xml')
    ? children(part('xl/sharedStrings.xml'), 'si').map((si) =>
        descendants(si, 't')
          .map((t) => t.text)
          .join(''),
      )
    : [];
  if (strings.length > XLSX_LIMITS.strings || strings.some((s) => s.length > XLSX_LIMITS.text))
    throw new Error('Shared strings limit exceeded');
  const sheet = part('xl/' + target);
  if (sheet.name !== 'worksheet' || children(sheet, 'sheetData').length !== 1)
    throw new Error('Unsupported worksheet structure');
  const rows = children(children(sheet, 'sheetData')[0]!, 'row');
  if (rows.length > XLSX_LIMITS.rows) throw new Error('Spreadsheet row limit exceeded');
  let cellCount = 0;
  const matrix: string[][] = [];
  for (const row of rows) {
    const cells: string[] = [];
    for (const c of children(row, 'c')) {
      if (++cellCount > XLSX_LIMITS.cells) throw new Error('Worksheet cell limit exceeded');
      const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(c.attrs.r ?? '');
      if (!match) throw new Error('Malformed worksheet cell reference');
      let col = 0;
      for (const l of match[1]!) col = col * 26 + l.charCodeAt(0) - 64;
      if (col > XLSX_LIMITS.columns) throw new Error('Worksheet column limit exceeded');
      if (cells[col - 1] !== undefined) throw new Error('Duplicate worksheet cell');
      if (children(c, 'f').length)
        throw new Error('Formula cells are unsupported; export values only');
      const value = children(c, 'v')[0]?.text ?? '';
      if (c.attrs.t === 's' && !/^(0|[1-9][0-9]*)$/.test(value))
        throw new Error('Invalid shared-string index');
      let text =
        c.attrs.t === 's'
          ? strings[Number(value)]
          : c.attrs.t === 'inlineStr'
            ? descendants(c, 't')
                .map((t) => t.text)
                .join('')
            : value;
      if (text === undefined || text.length > XLSX_LIMITS.text)
        throw new Error('Invalid or oversized worksheet value');
      cells[col - 1] = text.trim();
    }
    matrix.push(Array.from({ length: cells.length }, (_, i) => cells[i] ?? ''));
  }
  if (!matrix.length) throw new Error('Spreadsheet has no rows');
  return matrix;
}
