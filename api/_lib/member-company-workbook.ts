import { randomUUID } from 'node:crypto';
import {
  MEMBER_WORKBOOK_ROWS,
  memberWorkbookDisplayName,
  type Member,
  type MemberWorkbookKind,
} from '@afhomes/contracts';
import { readWorkbook, readWorkbookParts } from './customer-xlsx.js';
import { workbookDate } from './customer-workbook.js';
import { zipStored } from './report-export.js';
import { companyLayout, COMPANY_ID_TYPES, COMPANY_ROLES } from './member-workbook-layout.js';
import { readRuntimeAsset } from './runtime-assets.js';

const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const encode = (text: string) => new TextEncoder().encode(text);
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const normalized = (s: string) => s.trim().replace(/\s+/g, ' ').normalize('NFKC').toLowerCase();
export const memberHeadLabel = (m: Member) =>
  `${memberWorkbookDisplayName(m.fullName)} [${m.aaNumber || m.id}]`;

/** Populate reference choices without changing the official visible layout. */
export function companyMemberWorkbook(
  kind: MemberWorkbookKind,
  members: Member[],
  entries: Record<string, string>[] = [],
  history: string[] = [],
): Uint8Array {
  if (entries.length > MEMBER_WORKBOOK_ROWS)
    throw new Error('Narrow the roster to at most 500 members before exporting.');
  const parts = readWorkbookParts(
    readRuntimeAsset(`member-${kind.toLowerCase()}-template-v2.xlsx`),
  );
  const teams = kind === 'IST' ? 5 : 6;
  const path = `xl/worksheets/sheet${teams}.xml`;
  let text = decode(parts.get(path));
  const groups = ['vice_director', 'senior_sales_manager', 'sales_manager'].map((role) =>
    members
      .filter((m) => m.status === 'active' && m.position === role)
      .sort((a, b) => memberHeadLabel(a).localeCompare(memberHeadLabel(b))),
  );
  // The original IST rows 2..501 derive same-workbook candidates; registered heads follow.
  const start = kind === 'IST' ? 502 : 2;
  if (groups.some((group) => group.length > 500))
    throw new Error(
      'More than 500 head choices in a role; narrow the authorized roster before downloading.',
    );
  text = text.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, raw) =>
    Number(raw) >= start ? '' : row,
  );
  const rows = Array.from(
    { length: Math.max(0, ...groups.map((g) => g.length)) },
    (_, i) =>
      `<row r="${start + i}">${groups.map((group, c) => (group[i] ? `<c r="${'ABC'[c]}${start + i}" t="inlineStr"><is><t xml:space="preserve">${escape(memberHeadLabel(group[i]!))}</t></is></c>` : '')).join('')}</row>`,
  ).join('');
  parts.set(
    path,
    encode(
      text
        .replace('</sheetData>', () => rows + '</sheetData>')
        .replace(
          /<dimension\b[^>]*\/>/,
          `<dimension ref="A1:C${Math.max(start, start + Math.max(0, ...groups.map((g) => g.length)) - 1)}"/>`,
        ),
    ),
  );
  Object.entries(companyLayout(kind)).forEach(([name, columns], index) => {
    const sheet = `xl/worksheets/sheet${index + 2}.xml`;
    const contents = decode(parts.get(sheet)).replace(
      /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g,
      (row, raw) => {
        const i = Number(raw) - 2,
          entry = entries[i];
        if (!entry) return row;
        columns.forEach(([, field], c) => {
          if (
            [
              'applicant_name',
              'age',
              'head_check',
              'head_search',
              'expires_on',
              'postal_code',
            ].includes(field) ||
            !entry[field]
          )
            return;
          const ref = `${String.fromCharCode(65 + c)}${i + 2}`;
          const pattern = new RegExp(`<c\\b([^>]*?\\br="${ref}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
          const cell = pattern.exec(row);
          const attrs = (cell?.[1] ?? ` r="${ref}"`).replace(/\s+t="[^"]*"/g, '');
          const date = [
            'birth_date',
            'starts_on',
            'date_applied',
            'applicant_signed_on',
            'referrer_signed_on',
          ].includes(field);
          const value = date
            ? Date.parse(entry[field]! + 'T00:00:00Z') / 86400000 + 25569
            : entry[field]!;
          const rendered = date
            ? `<c${attrs}><v>${value}</v></c>`
            : `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escape(String(value))}</t></is></c>`;
          row = cell
            ? row.replace(pattern, () => rendered)
            : row.replace('</row>', () => rendered + '</row>');
        });
        const cells = [...row.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(
          (match) => match[0],
        );
        const column = (s: string) => /\br="([A-Z]+)/.exec(s)?.[1] ?? '';
        cells.sort(
          (a, b) => column(a).length - column(b).length || column(a).localeCompare(column(b)),
        );
        return row.replace(
          /(^<row\b[^>]*>)[\s\S]*(<\/row>$)/,
          (_all, open: string, close: string) => open + cells.join('') + close,
        );
      },
    );
    parts.set(sheet, encode(contents));
  });
  if (entries.length) {
    const notes = [
      'Authorized roster export. Restricted TIN/ID numbers omitted. Re-import must MATCH existing records; it never updates, renews or transfers them.',
      'For legacy IST records with only a full name, the name is split for presentation only; the combined canonical name is retained and must be reviewed. No legal name components are inferred for persistence.',
      ...history,
    ];
    parts.set(
      'xl/worksheets/sheet1.xml',
      encode(
        decode(parts.get('xl/worksheets/sheet1.xml'))
          .replace(
            '</sheetData>',
            () =>
              notes
                .map(
                  (note, i) =>
                    `<row r="${101 + i}"><c r="A${101 + i}" t="inlineStr"><is><t xml:space="preserve">${escape(note)}</t></is></c></row>`,
                )
                .join('') + '</sheetData>',
          )
          .replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:F${100 + notes.length}"/>`),
      ),
    );
  }
  return zipStored(
    [...parts].map(([name, data]) => ({ name, data })),
    true,
  );
}

/** Formula results are candidates only. Never evaluate any uploaded expression. */
export function readCompanyMemberWorkbook(
  parts: Map<string, Uint8Array>,
  kind: MemberWorkbookKind,
) {
  const layout = companyLayout(kind);
  const formulaNames = new Set<string>();
  const date1904 = /\bdate1904=["'](?:1|true)["']/.test(decode(parts.get('xl/workbook.xml')));
  const sheets = readWorkbook(
    parts,
    Object.keys(layout),
    false,
    { Identity: [8, 15], Team: [1, 4], Details: [1], Accreditation: [1, 3] },
    (sheet, col, row, formula, cached) => {
      if (col === 1 && sheet !== 'Identity') {
        // A strict known formula is the row-alignment evidence, never its cached name.
        const expected = `IF(OR(Identity!B${row}="",Identity!D${row}=""),"",TRIM(Identity!B${row}&" "&Identity!C${row}&" "&Identity!D${row}))`;
        if (formula.replaceAll('$', '').replaceAll("'Identity'", 'Identity') !== expected)
          throw new Error(
            `Row alignment cannot be verified: ${sheet}!A${row}. Restore the same-row applicant formula or a matching literal name.`,
          );
        formulaNames.add(`${sheet}:${row}`);
      }
      return (sheet === 'Accreditation' && col === 3) || (sheet === 'Identity' && col === 15)
        ? cached
        : '';
    },
  );
  for (const [name, columns] of Object.entries(layout)) {
    if (JSON.stringify(sheets.get(name)?.[0]) !== JSON.stringify(columns.map((c) => c[0])))
      throw new Error(
        `Unsupported company-v2 ${kind} headers on ${name}. Download the official template.`,
      );
  }
  const length = Math.max(...[...sheets.values()].map((rows) => rows.length));
  const rows = [];
  for (let index = 1; index < length; index++) {
    const fields: Record<string, string> = {
      source_layout: 'company-v2',
      source_kind: kind,
      row_key: `EXCEL-${index + 1}`,
    };
    const names: [string, string][] = [];
    for (const [name, columns] of Object.entries(layout)) {
      const cells = sheets.get(name)![index] ?? [];
      if (cells.slice(columns.length).some(Boolean))
        throw new Error(`Unexpected extra columns on ${name}, row ${index + 1}.`);
      columns.forEach(([, field], col) => {
        const value = cells[col]?.trim() ?? '';
        if (field === 'applicant_name') names.push([name, value]);
        else if (!['age', 'head_check', 'head_search'].includes(field)) fields[field] = value;
      });
    }
    // Search helper, names, age and derived values alone are never a member.
    if (
      !Object.entries(fields).some(
        ([field, value]) =>
          !['source_layout', 'source_kind', 'row_key', 'postal_code', 'expires_on'].includes(
            field,
          ) && value,
      )
    )
      continue;
    if (index > MEMBER_WORKBOOK_ROWS)
      throw new Error(`Maximum ${MEMBER_WORKBOOK_ROWS} rows per import.`);
    if (!fields.first_name || !fields.last_name)
      throw new Error(
        `Identity row ${index + 1} is missing a first/last name; do not sort tabs independently.`,
      );
    const name = [fields.first_name, fields.middle_name, fields.last_name]
      .filter(Boolean)
      .join(' ');
    for (const [sheet, applicant] of names) {
      if (!formulaNames.has(`${sheet}:${index + 1}`) && normalized(applicant) !== normalized(name))
        throw new Error(
          `Row alignment cannot be verified: ${sheet}!A${index + 1} must identify the same applicant as Identity.`,
        );
    }
    for (const field of [
      'birth_date',
      'starts_on',
      'expires_on',
      'date_applied',
      'applicant_signed_on',
      'referrer_signed_on',
    ])
      if (fields[field]) fields[field] = workbookDate(fields[field]!, date1904);
    fields.position =
      kind === 'OST' ? 'ost' : (COMPANY_ROLES[fields.position ?? ''] ?? fields.position ?? '');
    if (fields.head_role) fields.head_role = COMPANY_ROLES[fields.head_role] ?? fields.head_role;
    if (fields.government_id_type)
      fields.government_id_type =
        COMPANY_ID_TYPES[fields.government_id_type] ?? fields.government_id_type;
    fields.aa_number = (fields.aa_number ?? '').toUpperCase();
    fields.aa_mode = fields.aa_number ? 'manual' : 'auto';
    fields.request_id = randomUUID();
    rows.push({ rowNumber: index + 1, fields });
  }
  if (!rows.length) throw new Error('The workbook contains no member rows.');
  return rows;
}
