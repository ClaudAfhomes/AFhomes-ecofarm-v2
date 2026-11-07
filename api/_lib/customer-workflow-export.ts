import { readWorkbookParts } from './customer-xlsx.js';
import { zipStored } from './report-export.js';
import type { WorkbookStaffMatch } from './customer-workbook.js';
import { WORKFLOW_COLUMNS, WORKFLOW_MAPPING_VERSION, WORKFLOW_TEMPLATE_ROWS } from '@afhomes/contracts';
import { workflowAddressLists } from './customer-workflow-addresses.js';
import { readRuntimeAsset } from './runtime-assets.js';
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
export function customerWorkflowTemplate(
  staff: WorkbookStaffMatch[] = [],
  source?: Uint8Array,
): Uint8Array {
  const parts = readWorkbookParts(source ?? readRuntimeAsset('customer-workflow-template.xlsx'));
  const encode = (s: string) => new TextEncoder().encode(s);
  const decoder = new TextDecoder();
  for (const name of [...parts.keys()].filter(
    (name) => name === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  )) {
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
      'Contact number',
      'Email',
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
        m?.phone ?? '',
        m?.email ?? '',
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
    .replace('</sheetData>', `</sheetData><autoFilter ref="F1:M${table.length}"/>`);
  const emailColumn = column(WORKFLOW_COLUMNS.Customers.findIndex(c => c.key === 'email') + 1);
  const links = Array.from({ length: WORKFLOW_TEMPLATE_ROWS + 1 }, (_, i) => i === 0
    ? '<c r="P1" t="inlineStr"><is><t>Customer link: VIP ID / Customer ID / email</t></is></c>'
    : `<c r="P${i+1}"><f>${escape(`IF('Customers'!B${i+1}<>"",'Customers'!B${i+1},IF('Customers'!A${i+1}<>"",'Customers'!A${i+1},IF('Customers'!${emailColumn}${i+1}<>"",'Customers'!${emailColumn}${i+1},"")))`)}</f></c>`);
  for (const [i, cell] of links.entries()) {
    const row = new RegExp(`<row r="${i+1}">([\\s\\S]*?)</row>`);
    refs = row.test(refs) ? refs.replace(row, `<row r="${i+1}">$1${cell}</row>`)
      : refs.replace('</sheetData>', `<row r="${i+1}">${cell}</row></sheetData>`);
  }
  parts.set('xl/worksheets/sheet6.xml', encode(refs));
  let book = decoder.decode(parts.get('xl/workbook.xml')!);
  const addresses = workflowAddressLists();
  for (const [sheetNumber, values] of [[7, addresses.rows], [8, addresses.postalRows]] as const) {
    const path = `xl/worksheets/sheet${sheetNumber}.xml`;
    const data = values.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${column(j + 1)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`).join('')}</row>`).join('');
    const width = Math.max(...values.map(row => row.length));
    parts.set(path, encode(decoder.decode(parts.get(path)!)
      .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${data}</sheetData>`)
      .replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${column(width)}${values.length}"/>`)));
  }
  const defined =
    roles
      .map(
        (_, i) =>
          `<definedName name="AFHomesStaff${i}">'Reference Lists'!$${column(i + 1)}$2:$${column(i + 1)}$${Math.max(2, lists[i]!.length + 1)}</definedName>`,
      )
      .join('') +
    addresses.definedNames
      .map((d) => `<definedName name="${d.name}">${escape(d.formula)}</definedName>`)
      .join('') +
    `<definedName name="AFHomesPurchases">'Reference Lists'!$P$2:$P${WORKFLOW_TEMPLATE_ROWS + 1}</definedName>`;
  const generatedNames = new Set(['AFHomesPurchases', ...roles.map((_, i) => `AFHomesStaff${i}`), ...addresses.definedNames.map(d => d.name)]);
  book = book.replace(/<definedName\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<\/definedName>/g, (value, name) => generatedNames.has(name) ? '' : value);
  book = book.replace(/<definedNames\b[^>]*\/>/g, '');
  book = book.includes('</definedNames>')
    ? book.replace('</definedNames>', defined + '</definedNames>')
    : book.includes('<calcPr') ? book.replace('<calcPr', `<definedNames>${defined}</definedNames><calcPr`) : book.replace('</workbook>', `<definedNames>${defined}</definedNames></workbook>`);
  parts.set('xl/workbook.xml', encode(book));
  let team = decoder.decode(parts.get('xl/worksheets/sheet4.xml')!);
  const validation = [0, 1, 2, 3, 3]
    .map(
      (list, i) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${column(i + 2)}2:${column(i + 2)}${WORKFLOW_TEMPLATE_ROWS + 1}"><formula1>AFHomesStaff${list}</formula1></dataValidation>`,
    )
    .join('');
  team = team
    .replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/, '')
    .replace(
      '<printOptions',
      `<dataValidations count="5">${validation}</dataValidations><printOptions`,
    );
  parts.set('xl/worksheets/sheet4.xml', encode(team));
  for (const [index, [name, columns]] of Object.entries(WORKFLOW_COLUMNS).entries()) {
    const path = `xl/worksheets/sheet${index + 2}.xml`;
    let sheet = decoder.decode(parts.get(path)!);
    const validations: string[] = [];
    const at = (key: string) => column(columns.findIndex((c) => c.key === key) + 1);
    const add = (key: string, formula: string) =>
      validations.push(
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${at(key)}2:${at(key)}${WORKFLOW_TEMPLATE_ROWS + 1}"><formula1>${escape(formula)}</formula1></dataValidation>`,
      );
    if (name !== 'Customers') add('customer_key', 'AFHomesPurchases');
    if (columns.some((c) => c.key === 'province')) {
      add('province', 'AFHomesProvinces');
      for (let r = 2; r <= WORKFLOW_TEMPLATE_ROWS + 1; r++) {
        const province = `$${at('province')}${r}`,
          city = `$${at('city')}${r}`;
        const list = (key: string, formula: string) =>
          validations.push(
            `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${at(key)}${r}"><formula1>${escape(formula)}</formula1></dataValidation>`,
          );
        list(
          'city',
          `INDIRECT(IFERROR(VLOOKUP(${province},AFHomesProvinceLookup,2,FALSE),"AFHomesEmpty"))`,
        );
        list(
          'barangay',
          `INDIRECT(IFERROR(VLOOKUP(${province}&"|"&${city},AFHomesLocalityLookup,2,FALSE),"AFHomesEmpty"))`,
        );
      }
    }
    // New VIP control / historical fields validations (Customers sheet only)
    if (name === 'Customers') {
      if (columns.some((c) => c.key === 'contract_classification')) {
        add('contract_classification', '"Standard,Non-Standard"');
      }
      if (columns.some((c) => c.key === 'payment_term_months')) {
        // Integer 1-36 validation
        validations.push(
          `<dataValidation type="whole" allowBlank="1" showErrorMessage="1" sqref="${at('payment_term_months')}2:${at('payment_term_months')}${WORKFLOW_TEMPLATE_ROWS + 1}"><formula1>1</formula1><formula2>36</formula2></dataValidation>`,
        );
      }
      if (columns.some((c) => c.key === 'existing_card_activation_status')) {
        add('existing_card_activation_status', '"Active,Inactive,Expired,Suspended,Cancelled,Pending Activation"');
      }
    }
    if (validations.length) {
      if (sheet.includes('</dataValidations>')) {
        sheet = sheet
          .replace(
            /<dataValidations count="(\d+)"/,
            (_, count) => `<dataValidations count="${Number(count) + validations.length}"`,
          )
          .replace('</dataValidations>', validations.join('') + '</dataValidations>');
      } else
        sheet = sheet.replace(
          '</sheetData>',
          `</sheetData><dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`,
        );
    }
    parts.set(path, encode(sheet));
  }
  parts.set(
    'docProps/custom.xml',
    encode(
      `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="AFHomesTemplate"><vt:lpwstr>company_v2</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="AFHomesMappingVersion"><vt:lpwstr>${WORKFLOW_MAPPING_VERSION}</vt:lpwstr></property></Properties>`,
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
  return zipStored([...parts].map(([name, data]) => ({ name, data })), true);
}
