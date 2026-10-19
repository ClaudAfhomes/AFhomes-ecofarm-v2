import { readFileSync } from 'node:fs';
import { readWorkbookParts } from './customer-xlsx.js';
import { zipStored } from './report-export.js';
import type { WorkbookStaffMatch } from './customer-workbook.js';
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const column = (n: number): string =>
  n > 26
    ? column(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26))
    : String.fromCharCode(64 + n);

/** Versioned metadata is independent of the Excel application used to fill the file. */
export function customerWorkflowTemplate(staff: WorkbookStaffMatch[] = []): Uint8Array {
  const parts = readWorkbookParts(
    readFileSync(
      new URL('../../packages/contracts/assets/customer-workflow-template.xlsx', import.meta.url),
    ),
  );
  const encode = (s: string) => new TextEncoder().encode(s);
  const decoder = new TextDecoder();
  for (const name of ['xl/workbook.xml', 'xl/worksheets/sheet4.xml', 'xl/worksheets/sheet6.xml']) {
    parts.set(
      name,
      encode(
        decoder
          .decode(parts.get(name)!)
          .replace(/(<\/?)x:/g, '$1')
          .replace('xmlns:x=', 'xmlns='),
      ),
    );
  }
  if (staff.length > 1000)
    throw new Error(
      'Registered staff roster is too large; narrow the template roster before download',
    );
  const roles = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
  const label = (m: WorkbookStaffMatch) =>
    m.aa_number ? `${m.full_name} [${m.aa_number}]` : m.full_name;
  const lists = roles.map((role) =>
    staff.filter((m) => m.role_slug === role && (m.aa_number || m.match_count === 1)),
  );
  const all = lists.flat();
  const lineage = (m: WorkbookStaffMatch, role: string) => {
    const id = m.ancestor_ids.find((id) =>
      staff.some((s) => s.staff_id === id && s.role_slug === role),
    );
    return staff.find((s) => s.staff_id === id)?.full_name ?? '';
  };
  const table = [
    [
      'VD / SVD',
      'SSM',
      'SM',
      'OST',
      '',
      'Registered staff',
      'Role',
      'AA number',
      'VD tree',
      'SSM',
      'SM',
    ],
    ...Array.from({ length: Math.max(1, all.length) }, (_, i) => {
      const m = all[i];
      return [
        ...lists.map((list) => (list[i] ? label(list[i]!) : '')),
        '',
        m ? label(m) : '',
        m?.role_slug.replaceAll('_', ' ') ?? '',
        m?.aa_number ?? '',
        m ? lineage(m, 'vice_director') : '',
        m ? lineage(m, 'senior_sales_manager') : '',
        m ? lineage(m, 'sales_manager') : '',
      ];
    }),
  ];
  const rows = table
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row.map((value, j) => `<c r="${column(j + 1)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`).join('')}</row>`,
    )
    .join('');
  let refs = decoder.decode(parts.get('xl/worksheets/sheet6.xml')!);
  refs = refs
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${rows}</sheetData>`)
    .replace(/<autoFilter\b[^>]*\/>/g, '')
    .replace('</sheetData>', `</sheetData><autoFilter ref="F1:K${table.length}"/>`);
  parts.set('xl/worksheets/sheet6.xml', encode(refs));
  let book = decoder.decode(parts.get('xl/workbook.xml')!);
  const defined = roles
    .map(
      (_, i) =>
        `<definedName name="AFHomesStaff${i}">'Reference Lists'!$${column(i + 1)}$2:$${column(i + 1)}$${Math.max(2, lists[i]!.length + 1)}</definedName>`,
    )
    .join('');
  book = book.includes('</definedNames>')
    ? book.replace('</definedNames>', defined + '</definedNames>')
    : book.replace('</workbook>', `<definedNames>${defined}</definedNames></workbook>`);
  parts.set('xl/workbook.xml', encode(book));
  let team = decoder.decode(parts.get('xl/worksheets/sheet4.xml')!);
  const validation = [0, 1, 2, 3, 3]
    .map(
      (list, i) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${column(i + 2)}2:${column(i + 2)}101"><formula1>AFHomesStaff${list}</formula1></dataValidation>`,
    )
    .join('');
  team = team
    .replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/, '')
    .replace(
      '</sheetData>',
      `</sheetData><dataValidations count="5">${validation}</dataValidations>`,
    );
  team = team.replace(
    /<row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g,
    (row: string, index: string) => {
      const r = Number(index);
      if (r < 2) return row;
      const formulas = Array.from({ length: 6 }, (_, i) => {
        const lookup = i < 3 ? 'E' : 'F';
        return `<c r="${column(i + 9)}${r}"><f>${escape(`IFERROR(VLOOKUP(${lookup}${r},'Reference Lists'!$F$2:$K$${Math.max(2, table.length)},${(i % 3) + 4},FALSE),"")`)}</f></c>`;
      }).join('');
      return row
        .replace(/<c\b[^>]*r="[I-N]\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, '')
        .replace('</row>', formulas + '</row>');
    },
  );
  parts.set('xl/worksheets/sheet4.xml', encode(team));
  parts.set(
    'docProps/custom.xml',
    encode(
      '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="AFHomesTemplate"><vt:lpwstr>company_v2</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="AFHomesMappingVersion"><vt:lpwstr>1</vt:lpwstr></property></Properties>',
    ),
  );
  const types = decoder.decode(parts.get('[Content_Types].xml')!);
  if (!types.includes('/docProps/custom.xml'))
    parts.set(
      '[Content_Types].xml',
      encode(
        types.replace(
          '</Types>',
          '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>',
        ),
      ),
    );
  const rels = decoder.decode(parts.get('_rels/.rels')!);
  if (!rels.includes('custom-properties'))
    parts.set(
      '_rels/.rels',
      encode(
        rels.replace(
          '</Relationships>',
          '<Relationship Id="afhomesCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>',
        ),
      ),
    );
  return zipStored([...parts].map(([name, data]) => ({ name, data })));
}
