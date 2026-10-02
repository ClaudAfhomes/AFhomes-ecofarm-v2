/**
 * Phase 15 export renderers - pure, deterministic, dependency-free.
 *
 * CSV, XLSX and PDF are all rendered from the same in-memory row matrix the
 * JSON report returns, so an export can never disagree with the screen. No
 * third-party library is used on purpose: the spreadsheet and PDF writers are
 * small, exact, and have no native code, no font downloads, and no network.
 */

export type XlsxColumnType = 'text' | 'number' | 'money' | 'date';
export type XlsxColumn = { label: string; type: XlsxColumnType; width?: number };

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * RFC 4180 escaping plus spreadsheet-formula protection. Any text cell whose
 * first character is `=`, `+`, `-`, `@` (or a tab/CR, which Excel also
 * evaluates) is prefixed with a single quote so the spreadsheet treats it as
 * text. The quote is the OWASP-recommended guard; the value is otherwise
 * byte-identical.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** UTF-8 with BOM (so Excel opens it as UTF-8), CRLF line endings. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ */
/* XLSX (Office Open XML, stored ZIP entries - no compression library) */
/* ------------------------------------------------------------------ */

const xmlEscape = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function colLetter(index: number): string {
  let out = '';
  let n = index;
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/* CRC-32 (ISO 3309) for the ZIP entries. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal stored (method 0) ZIP writer - valid for any reader. */
function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fixed DOS timestamp (2026-01-01) - determinism matters more than mtime.
  const dosTime = (12 << 11) | 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const u16 = (v: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    return b;
  };
  const u32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    return b;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    const headerOffset = offset;
    push(local);
    push(file.data);
    const head = new Uint8Array(46 + name.length);
    const cview = new DataView(head.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0x0800, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, dosTime, true);
    cview.setUint16(14, dosDate, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, file.data.length, true);
    cview.setUint32(24, file.data.length, true);
    cview.setUint16(28, name.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, headerOffset, true);
    head.set(name, 46);
    central.push(head);
  }
  const centralStart = offset;
  for (const c of central) push(c);
  const centralSize = offset - centralStart;
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(8, central.length, true);
  eview.setUint16(10, central.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, centralStart, true);
  push(end);
  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const toSerial = (iso: string): number | null => {
  const ms = new Date(iso).valueOf();
  if (!Number.isFinite(ms)) return null;
  return ms / 86_400_000 + 25569;
};

/**
 * One worksheet, frozen header row, sensible column widths, typed cells:
 * text as inline strings, numbers/points as numeric cells, money as numeric
 * cells with a two-decimal format (the exact-decimal string is parsed, never
 * float-rounded by the caller), ISO timestamps as date cells.
 */
export function toXlsx(sheetName: string, columns: XlsxColumn[], rows: unknown[][]): Uint8Array {
  const encoder = new TextEncoder();
  const safeName = sheetName.slice(0, 31).replace(/[:\\/?*[\]]/g, ' ') || 'Report';
  const widths = columns.map((col, i) => {
    const longest = Math.max(col.label.length, ...rows.map((row) => String(row[i] ?? '').length));
    return Math.min(48, Math.max(12, Math.min(col.width ?? 18, longest + 2)));
  });
  const lastCol = colLetter(columns.length - 1);
  const cellRefs: string[] = [];
  for (let r = 0; r <= rows.length; r += 1) {
    const isHeader = r === 0;
    const cells: string[] = [];
    for (let c = 0; c < columns.length; c += 1) {
      const ref = `${colLetter(c)}${r + 1}`;
      const raw = isHeader ? columns[c]!.label : rows[r - 1]![c];
      const type = columns[c]!.type;
      if (isHeader) {
        cells.push(
          `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(String(raw ?? ''))}</t></is></c>`,
        );
        continue;
      }
      if (raw === null || raw === undefined || raw === '') {
        cells.push(`<c r="${ref}"/>`);
        continue;
      }
      if (type === 'number' || type === 'money') {
        const num = Number(raw);
        if (!Number.isFinite(num)) {
          cells.push(`<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(raw))}</t></is></c>`);
          continue;
        }
        cells.push(`<c r="${ref}" s="${type === 'money' ? 2 : 0}"><v>${String(num)}</v></c>`);
        continue;
      }
      if (type === 'date') {
        const serial = toSerial(String(raw));
        if (serial === null) {
          cells.push(`<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(raw))}</t></is></c>`);
          continue;
        }
        cells.push(`<c r="${ref}" s="3"><v>${serial}</v></c>`);
        continue;
      }
      cells.push(`<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(raw))}</t></is></c>`);
    }
    cellRefs.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCol}${rows.length + 1}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${cellRefs.join('')}</sheetData></worksheet>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>` +
    `<borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs></styleSheet>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-package.extended-properties+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(safeName)}</dc:title><dc:creator>AF Homes</dc:creator></cp:coreProperties>`;
  const app =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AF Homes Reports</Application></Properties>`;
  return zipStored([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(wbRels) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet) },
    { name: 'xl/styles.xml', data: encoder.encode(styles) },
    { name: 'docProps/core.xml', data: encoder.encode(core) },
    { name: 'docProps/app.xml', data: encoder.encode(app) },
  ]);
}

/* ------------------------------------------------------------------ */
/* PDF (minimal valid PDF 1.4, Helvetica base-14 - no embedded fonts)  */
/* ------------------------------------------------------------------ */

export type PdfDoc = {
  title: string;
  generatedAt: string;
  scopeLabel: string;
  windowLabel: string;
  summaryLines: string[];
  headers: string[];
  rows: string[][];
  cappedNote?: string;
};

const pdfText = (text: string): string =>
  text
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === '(' || ch === ')' || ch === '\\') return `\\${ch}`;
      if (code < 32 || code > 255) return '?';
      return ch;
    })
    .join('');

const textWidth = (text: string, size: number): number => text.length * size * 0.55;

export const PDF_MAX_ROWS = 800;

/**
 * Title, scope/window metadata, summary totals, then a paginated table with a
 * repeated header row and page numbers. Rows beyond PDF_MAX_ROWS are dropped
 * with an explicit on-page note (never silently) - the full set stays
 * available as CSV/XLSX.
 */
export function toPdf(doc: PdfDoc): Uint8Array {
  const pageW = 595;
  const pageH = 842;
  const margin = 36;
  const usableW = pageW - margin * 2;
  const titleSize = 15;
  const metaSize = 9;
  const tableSize = 7.5;
  const rowH = 12;

  const colCount = Math.max(1, doc.headers.length);
  const maxChars = doc.headers.map((header, i) => {
    let longest = header.length;
    for (const row of doc.rows.slice(0, PDF_MAX_ROWS)) {
      longest = Math.max(longest, String(row[i] ?? '').length);
    }
    return Math.min(42, longest);
  });
  const totalChars = maxChars.reduce((sum, n) => sum + n, 0) || 1;
  const colWidths = maxChars.map((n) => Math.max(36, (n / totalChars) * usableW));

  const pages: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
  };
  const op = (s: string) => current.push(s);
  const text = (x: number, y: number, size: number, bold: boolean, value: string) =>
    op(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(value)}) Tj ET`,
    );

  // Page 1 header block; every page repeats the table header instead.
  let y = pageH - margin;
  text(margin, y, titleSize, true, doc.title);
  y -= 20;
  text(margin, y, metaSize, false, `Generated ${doc.generatedAt}  |  Scope: ${doc.scopeLabel}`);
  y -= 13;
  text(margin, y, metaSize, false, `Window: ${doc.windowLabel}`);
  y -= 16;
  for (const line of doc.summaryLines.slice(0, 12)) {
    text(margin, y, metaSize, false, line.slice(0, 130));
    y -= 12;
  }
  y -= 6;

  const rows = doc.rows.slice(0, PDF_MAX_ROWS);
  const drawTableHeader = () => {
    op(
      `${(0.85).toFixed(2)} g ${margin.toFixed(1)} ${(y - 3).toFixed(1)} ${usableW.toFixed(1)} ${rowH.toFixed(1)} re f 0 g`,
    );
    let x = margin;
    doc.headers.forEach((header, i) => {
      text(x + 2, y, tableSize, true, header.slice(0, 44));
      x += colWidths[i]!;
    });
    y -= rowH;
  };
  drawTableHeader();
  for (const row of rows) {
    if (y < margin + rowH + 14) {
      flush();
      y = pageH - margin;
      drawTableHeader();
    }
    let x = margin;
    row.forEach((cell, i) => {
      text(x + 2, y, tableSize, false, String(cell ?? '').slice(0, 44));
      x += colWidths[i]!;
    });
    y -= rowH;
  }
  const note =
    doc.cappedNote ??
    (doc.rows.length > PDF_MAX_ROWS
      ? `Showing the first ${PDF_MAX_ROWS} of ${doc.rows.length} rows - use CSV or XLSX for the full set.`
      : '');
  if (note) {
    if (y < margin + 26) {
      flush();
      y = pageH - margin;
    }
    y -= 6;
    text(margin, y, metaSize, false, note.slice(0, 130));
  }
  flush();

  const totalPages = Math.max(1, pages.length);
  const objects: string[] = [];
  // 1: catalog, 2: pages, 3: Helvetica, 4: Helvetica-Bold, then per page
  // (page object + content stream).
  const pageObjNums: number[] = [];
  const streamObjNums: number[] = [];
  let next = 5;
  for (let i = 0; i < totalPages; i += 1) {
    pageObjNums.push(next);
    streamObjNums.push(next + 1);
    next += 2;
  }
  objects[1] = `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`;
  objects[2] = `2 0 obj<</Type/Pages/Kids[${pageObjNums.map((n) => `${n} 0 R`).join(' ')}]/Count ${totalPages}>>endobj`;
  objects[3] = `3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`;
  objects[4] = `4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>endobj`;
  pages.forEach((ops, i) => {
    const footer = `BT /F1 8 Tf ${margin.toFixed(1)} ${(margin - 14).toFixed(1)} Td (Page ${i + 1} of ${totalPages} - AF Homes) Tj ET`;
    const stream = `${ops.join('\n')}\n${footer}\n`;
    const len = Buffer.byteLength(stream, 'latin1');
    objects[pageObjNums[i]!] =
      `${pageObjNums[i]!} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageW} ${pageH}]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${streamObjNums[i]!} 0 R>>endobj`;
    objects[streamObjNums[i]!] =
      `${streamObjNums[i]!} 0 obj<</Length ${len}>>stream\n${stream}endstream\nendobj`;
  });

  let out = `%PDF-1.4\n`;
  const offsets: number[] = [0];
  for (let n = 1; n < next; n += 1) {
    offsets[n] = Buffer.byteLength(out, 'latin1');
    out += `${objects[n]!}\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let n = 1; n < next; n += 1) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer<</Size ${next}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
