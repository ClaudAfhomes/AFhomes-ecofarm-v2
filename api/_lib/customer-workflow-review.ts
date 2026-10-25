import { WORKFLOW_COLUMNS, WORKFLOW_REVIEW_HEADERS } from '@afhomes/contracts';
import { readWorkbookParts } from './customer-xlsx.js';
import { zipStored, toXlsx } from './report-export.js';
type ReviewIssue = { sheet: string; row: number; field: string; column: number; message: string };
type ReviewSource = { sheet: string; row: number; fields: Record<string, string> };
type ReviewWorkbook = { issues: ReviewIssue[]; sources: ReviewSource[][] };

const xml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const col = (n: number): string =>
  n > 26
    ? col(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26))
    : String.fromCharCode(64 + n);
type PreviewRow = {
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
};
/** Original cells and worksheets are retained; only review outputs and cell styles change. */
export function annotateCustomerWorkbook(
  bytes: Uint8Array,
  workflow: ReviewWorkbook,
  rows: PreviewRow[],
): Uint8Array {
  const parts = readWorkbookParts(bytes),
    decode = new TextDecoder(),
    encode = new TextEncoder();
  const issues: Array<ReviewIssue & { warning?: boolean }> = [...workflow.issues];
  const sourceRows = workflow.sources.flat();

  for (const [i, row] of rows.entries()) {
    for (const [warning, messages] of [
      [false, row.errors],
      [true, row.warnings],
    ] as const)
      for (const issue of messages) {
        if (workflow.issues.some((v) => issue.message.includes(v.message))) continue;
        const sources = workflow.sources[i] ?? [];
        const secondary = issue.field.startsWith('secondary_');
        const field = issue.field.replace(/^secondary_/, '');
        const source =
          sources.find(
            (s) =>
              s.sheet ===
                (secondary
                  ? 'Supplementary Holders'
                  : [
                        'vd_name',
                        'ssm_name',
                        'sm_name',
                        'referrer_name',
                        'recommender_name',
                        'recommender_contact',
                        'recommender_email',
                      ].includes(field)
                    ? 'Sales Team'
                    : 'Customers') && Object.hasOwn(s.fields, field),
          ) ?? sources[0];
        if (!source) continue;

        // Source fields retain their original column order, including legacy layouts.
        const index = Object.keys(source.fields).indexOf(field);
        issues.push({
          sheet: source.sheet,
          row: source.row,
          field,
          column: index < 0 ? 0 : index + 1,
          message: issue.message,
          warning,
        });
      }
  }
  const stylePath = 'xl/styles.xml';
  let styles = decode.decode(parts.get(stylePath)!);
  const fills = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles)!;
  const fillCount = (fills[1]!.match(/<fill\b/g) ?? []).length;
  styles = styles.replace(
    fills[0],
    `<fills count="${fillCount + 2}">${fills[1]}<fill><patternFill patternType="solid"><fgColor rgb="FFFADBD8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE6A7"/><bgColor indexed="64"/></patternFill></fill></fills>`,
  );
  const xfs = /<cellXfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)!;
  const original = [...xfs[2]!.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
  const added: string[] = [];
  const cache = new Map<string, number>();
  const highlight = (old: number, warning: boolean) => {
    const key = old + ':' + warning;
    if (cache.has(key)) return cache.get(key)!;
    let xf = original[old] ?? original[0]!;
    xf = xf
      .replace(/fillId="\d+"/, `fillId="${fillCount + (warning ? 1 : 0)}"`)
      .replace(/applyFill="[^"]*"/, '');
    xf = xf.replace('<xf ', '<xf applyFill="1" ');
    const id = original.length + added.length;
    added.push(xf);
    cache.set(key, id);
    return id;
  };
  const book = decode.decode(parts.get('xl/workbook.xml')!);
  const rels = decode.decode(parts.get('xl/_rels/workbook.xml.rels')!);
  for (const name of new Set([...sourceRows.map((s) => s.sheet), ...issues.map((i) => i.sheet)])) {
    const columns =
      (WORKFLOW_COLUMNS as Record<string, { key: string; header: string }[]>)[name] ??
      Object.keys(sourceRows.find((s) => s.sheet === name)?.fields ?? {}).map((key) => ({
        key,
        header: key,
      }));
    const tag = [...book.matchAll(/<sheet\b[^>]*\/>/g)].find((m) =>
      new RegExp(`name="${name}"`).test(m[0]),
    )?.[0];
    if (!tag) continue;
    const id = /r:id="([^"]+)"/.exec(tag)?.[1];
    const relation = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].find((m) =>
      m[0].includes(`Id="${id}"`),
    )?.[0];
    const target = /Target="([^"]+)"/.exec(relation ?? '')?.[1];
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    let sheet = decode.decode(parts.get(path)!);
    const records = sourceRows.filter((s) => s.sheet === name);
    const sheetIssues = issues.filter((i) => i.sheet === name);
    if (!records.length && !sheetIssues.length) continue;
    const hasReview = records[0]
      ? Object.keys(records[0].fields).includes('review_status')
      : sheet.includes('Review status');
    const sourceKeys = records[0] ? Object.keys(records[0].fields) : columns.map((c) => c.key);
    const statusIndex = hasReview ? sourceKeys.indexOf('review_status') + 1 : sourceKeys.length + 1;
    const reviewKeys = ['review_status', 'review_errors', 'review_warnings'];
    const annotationIndexes = reviewKeys.map((k, i) =>
      hasReview ? sourceKeys.indexOf(k) + 1 : statusIndex + i,
    );
    const literal = (ref: string, value: string, style?: number) =>
      `<c r="${ref}"${style === undefined ? '' : ` s="${style}"`} t="inlineStr"><is><t xml:space="preserve">${xml(value.slice(0, 4000))}</t></is></c>`;
    sheet = sheet.replace(/<row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, n) => {
      const r = Number(n);
      const perRow = sheetIssues.filter((i) => i.row === r);
      const isData = records.some((v) => v.row === r);
      if (r !== 1 && !isData && !perRow.length) return row;
      const highlightColumns = new Map<number, boolean>();
      for (const issue of perRow)
        if (issue.column > 0)
          highlightColumns.set(
            issue.column,
            highlightColumns.has(issue.column)
              ? highlightColumns.get(issue.column)! && Boolean(issue.warning)
              : Boolean(issue.warning),
          );
      const cells = new Map<number, string>();
      for (const match of row.matchAll(/<c\b[^>]*r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const index = [...match[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
        let cell = match[0];
        if (highlightColumns.has(index)) {
          const old = Number(/\bs="(\d+)"/.exec(cell)?.[1] ?? 0);
          cell = cell
            .replace(/\s+s="\d+"/, '')
            .replace('<c ', `<c s="${highlight(old, highlightColumns.get(index)!)}" `);
        }
        cells.set(index, cell);
      }
      for (const [index, warning] of highlightColumns)
        if (!cells.has(index)) cells.set(index, literal(col(index) + r, '', highlight(0, warning)));
      if (r === 1) {
        if (!hasReview)
          WORKFLOW_REVIEW_HEADERS.forEach((h, i) =>
            cells.set(annotationIndexes[i]!, literal(col(annotationIndexes[i]!) + r, h)),
          );
      } else {
        const errors = perRow.filter((i) => !i.warning),
          warnings = perRow.filter((i) => i.warning);
        const describe = (v: typeof perRow) =>
          [
            ...new Set(
              v.map(
                (i) =>
                  `${i.column ? col(i.column) + r + ' / ' : ''}${sourceKeys[i.column - 1] ? (columns.find((c) => c.key === sourceKeys[i.column - 1])?.header ?? i.field) : i.field}: ${i.message}`,
              ),
            ),
          ].join('\n');
        const values = [
          errors.length
            ? 'Needs correction'
            : warnings.length
              ? 'Review warnings'
              : 'Ready for system review',
          describe(errors),
          describe(warnings),
        ];
        values.forEach((v, i) => {
          const style = errors.length
            ? highlight(0, false)
            : warnings.length
              ? highlight(0, true)
              : 0;
          const noteKey = 'note:' + style;
          let noteStyle = cache.get(noteKey);
          if (noteStyle === undefined) {
            noteStyle = original.length + added.length;
            added.push(
              `<xf numFmtId="49" fontId="0" fillId="${errors.length ? fillCount : warnings.length ? fillCount + 1 : 0}" borderId="0" xfId="0" applyAlignment="1" applyProtection="1"><alignment vertical="top" wrapText="1"/><protection locked="1"/></xf>`,
            );
            cache.set(noteKey, noteStyle);
          }
          cells.set(annotationIndexes[i]!, literal(col(annotationIndexes[i]!) + r, v, noteStyle));
        });
      }
      let result = row.replace(/<c\b[\s\S]*<\/c>|<c\b[^>]*\/>/g, '').replace(
        '</row>',
        [...cells]
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => v)
          .join('') + '</row>',
      );
      if (r > 1 && perRow.length) {
        const lines = Math.min(
          10,
          Math.max(
            2,
            perRow.reduce((n, i) => n + Math.ceil(i.message.length / 55), 0),
          ),
        );
        result = result
          .replace(/\s+(ht|customHeight)="[^"]*"/g, '')
          .replace('<row ', `<row ht="${lines * 18}" customHeight="1" `);
      }
      return result;
    });
    // Existing numeric identifiers and dates are untouched. Review columns are never source data.
    parts.set(path, encode.encode(sheet));
  }
  styles = styles.replace(
    xfs[0],
    `<cellXfs count="${original.length + added.length}">${xfs[2]}${added.join('')}</cellXfs>`,
  );
  parts.set(stylePath, encode.encode(styles));
  // Mark legacy review columns so the importer can ignore only these exact annotations.
  const customPath = 'docProps/custom.xml';
  let custom = parts.has(customPath)
    ? decode.decode(parts.get(customPath)!)
    : '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"></Properties>';
  if (!parts.has(customPath)) {
    const types = decode.decode(parts.get('[Content_Types].xml')!);
    parts.set(
      '[Content_Types].xml',
      encode.encode(
        types.replace(
          '</Types>',
          '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>',
        ),
      ),
    );
    const rels = decode.decode(parts.get('_rels/.rels')!);
    parts.set(
      '_rels/.rels',
      encode.encode(
        rels.replace(
          '</Relationships>',
          '<Relationship Id="afhomesReview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>',
        ),
      ),
    );
  }
  if (!/<Properties\b[^>]*xmlns:vt=/.test(custom))
    custom = custom.replace(
      '<Properties',
      '<Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"',
    );
  if (!custom.includes('name="AFHomesReviewWorkbook"'))
    custom = custom.replace(
      '</Properties>',
      '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="100" name="AFHomesReviewWorkbook"><vt:lpwstr>1</vt:lpwstr></property></Properties>',
    );
  parts.set(customPath, encode.encode(custom));
  return zipStored(
    [...parts].map(([name, data]) => ({ name, data })),
    true,
  );
}

export function annotateFlatCustomerImport(
  matrix: string[][],
  rows: Array<PreviewRow & { rowNumber: number }>,
): Uint8Array {
  const oldHeaders = matrix[0] ?? [];
  const keep = oldHeaders
    .map((h, i) => ({ h, i }))
    .filter(
      ({ h }) => !WORKFLOW_REVIEW_HEADERS.some((r) => r.toLowerCase() === h.trim().toLowerCase()),
    );
  matrix = [keep.map((c) => c.h), ...matrix.slice(1).map((row) => keep.map((c) => row[c.i] ?? ''))];
  const headers = matrix[0] ?? [];
  const keys = headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const bytes = toXlsx(
    'Customer Import',
    [...headers, ...WORKFLOW_REVIEW_HEADERS].map((label) => ({ label, type: 'text' as const })),
    matrix.slice(1).map((values) => [...headers.map((_, i) => values[i] ?? ''), '', '', '']),
  );
  const sources = rows.map((row) => [
    {
      sheet: 'Customer Import',
      row: row.rowNumber,
      fields: Object.fromEntries(
        [...keys, ...['review_status', 'review_errors', 'review_warnings']].map((key, i) => [
          key,
          matrix[row.rowNumber - 1]?.[i] ?? '',
        ]),
      ),
    },
  ]);
  return annotateCustomerWorkbook(bytes, { sources, issues: [] }, rows);
}
