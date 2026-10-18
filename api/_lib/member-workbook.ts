import { randomUUID } from 'node:crypto';
import { MEMBER_WORKBOOK_ROWS, type Member, type MemberWorkbookKind } from '@afhomes/contracts';
import { companyTemplate } from './customer-workbook-export.js';
import { workbookDate } from './customer-workbook.js';
import { readWorkbook, readWorkbookParts } from './customer-xlsx.js';
import { toXlsxMulti, zipStored, type XlsxSheetSpec } from './report-export.js';

export const MEMBER_ENTRY_TABS = {
  Identity: [
    'row_key',
    'first_name',
    'middle_name',
    'last_name',
    'email',
    'mobile',
    'birth_date',
    'sex',
    'civil_status',
    'province',
    'city',
    'barangay',
    'address_line_1',
    'postal_code',
    'age',
  ],
  Team: ['row_key', 'position', 'head_member', 'aa_mode', 'aa_number'],
  Details: [
    'row_key',
    'government_id_type',
    'government_id_number',
    'tin',
    'telephone',
    'messenger',
    'employer_name',
    'employer_address',
    'job_position',
  ],
  Accreditation: [
    'row_key',
    'starts_on',
    'expires_on',
    'date_applied',
    'program_category',
    'vip_card_type',
    'applicant_signature',
    'referrer_signature',
    'applicant_signed_on',
    'referrer_signed_on',
  ],
} as const;
const DERIVED = { Identity: [14, 15], Accreditation: [3] };
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const decode = (s: Uint8Array | undefined) => new TextDecoder().decode(s);
const encode = (s: string) => new TextEncoder().encode(s);
function edit(parts: Map<string, Uint8Array>, path: string, fn: (s: string) => string) {
  parts.set(path, encode(fn(decode(parts.get(path)))));
}
const list = (range: string, formula: string) =>
  `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${range}"><formula1>${escape(formula)}</formula1></dataValidation>`;
function validations(parts: Map<string, Uint8Array>, sheet: number, extra: string[]) {
  edit(parts, `xl/worksheets/sheet${sheet}.xml`, (s) => {
    const match = /<dataValidations\b[^>]*>([\s\S]*?)<\/dataValidations>/.exec(s);
    const all = (match?.[1] ?? '') + extra.join('');
    const xml = `<dataValidations count="${(all.match(/<dataValidation /g) ?? []).length}">${all}</dataValidations>`;
    return match
      ? s.replace(match[0], () => xml)
      : s.replace('</worksheet>', () => xml + '</worksheet>');
  });
}

export function memberWorkbook(kind: MemberWorkbookKind, members: Member[]): Uint8Array {
  const roster = ['vice_director', 'senior_sales_manager', 'sales_manager'].map((role) =>
    members
      .filter((m) => m.status === 'active' && m.position === role)
      .sort((a, b) => a.email.localeCompare(b.email)),
  );
  const choices: Record<string, readonly string[]> = {
    sex: ['Male', 'Female'],
    civil_status: ['Single', 'Married', 'Widowed', 'Separated'],
    position: kind === 'IST' ? ['vice_director', 'senior_sales_manager', 'sales_manager'] : ['ost'],
    aa_mode: ['auto', 'manual'],
    government_id_type: ['philippine_id', 'drivers_license', 'passport', 'tax_id', 'other'],
    program_category: ['vip_holder', 'non_vip', 'future_vip'],
    vip_card_type: ['BRONZE', 'SILVER', 'GOLD'],
    applicant_signature: ['pending', 'received'],
    referrer_signature: ['pending', 'received'],
  };
  const original = readWorkbookParts(companyTemplate());
  const cities = readWorkbook(original, ['PSGC_CityList']).get('PSGC_CityList')!.slice(1);
  const guide = [
    ['Purpose', `AF Homes ${kind} NEW ACCOUNT IMPORT. Use a private company copy.`],
    [
      'Steps',
      'Fill matching rows on Identity, Team, Details and Accreditation; upload, preview, fix errors, then confirm.',
    ],
    [
      'Rows',
      `Up to ${MEMBER_WORKBOOK_ROWS} members per workbook. Keep generated row_key values unchanged. Mismatched keys block import; never sort one tab alone.`,
    ],
    [
      'Teams',
      'Heads must already exist and be active. Import VD first, then SSM, SM, OST. Pick the head email; never a name-only match.',
    ],
    [
      'IST',
      'VD has no head; SSM needs VD; SM needs SSM. Accreditation tab is not used for IST; normal creation issues its term.',
    ],
    [
      'OST',
      'Select an active SM with an existing complete SSM/VD chain. OST remains OST; no renewal or transfer occurs.',
    ],
    [
      'AA',
      'Select auto or manual. Leave aa_number blank for auto. Manual IST uses AAI; OST uses AAO. Existing AA numbers are never overwritten.',
    ],
    [
      'Signatures',
      'OST complete creation requires received signatures and their real dates, on/before date_applied. Never invent consent.',
    ],
    [
      'Dates',
      'Use YYYY-MM-DD. OST management selects starts_on; expires_on is calculated as one calendar year later.',
    ],
    [
      'Mobile',
      'Exactly 11 digits starting 09. Cells are text: keep the leading zero. No spaces, separators or formulas.',
    ],
    [
      'Address',
      'Choose province, city and barangay in order. Region is not requested. ZIP is a convenience lookup; server rechecks every location.',
    ],
    [
      'Automatic',
      'Age, ZIP and OST expiry are derived. Uploaded formula results are never trusted. All other formula cells are rejected.',
    ],
    [
      'Accounts',
      'Confirm generates an individual temporary password for each row; record the one-time credentials securely. No passwords in this workbook.',
    ],
    [
      'Safety',
      'New accounts only; no updates, renewals, conversions or team moves. Completed rows remain if a later row fails. Stop and inspect before retrying.',
    ],
    [
      'Google Sheets',
      'Upload this XLSX to a PRIVATE Sheet. Download as Microsoft Excel (.xlsx) to import. Never publish personal data or share publicly.',
    ],
    [
      'Compatibility',
      'Dropdown search/date pickers depend on Excel/Sheets version. Preview validation is mandatory even if dropdowns were lost.',
    ],
    [
      'Export',
      'Roster exports are read-only reports, not account-import templates. No passwords, TIN or ID numbers are exported.',
    ],
  ];
  const tones = ['blue', 'green', 'amber', 'purple'] as const;
  const sheets: XlsxSheetSpec[] = [
    {
      name: 'README',
      columns: [
        { label: 'Topic', type: 'text', width: 20 },
        { label: 'Instructions', type: 'text', width: 48 },
      ],
      rows: guide,
      headerTone: 'slate',
      filter: false,
      wrapBody: true,
    },
    ...Object.entries(MEMBER_ENTRY_TABS).map(([name, headers], i) => ({
      name,
      columns: headers.map((label) => ({
        label,
        type: 'text' as const,
        width: 24,
        ...(choices[label] ? { validation: choices[label] } : {}),
      })),
      rows: Array.from({ length: MEMBER_WORKBOOK_ROWS }, (_, i) => [
        `ROW-${String(i + 1).padStart(4, '0')}`,
      ]),
      headerTone: tones[i],
      zebra: true,
    })),
    {
      name: 'Teams',
      columns: ['VD email', 'VD name', 'SSM email', 'SSM name', 'SM email', 'SM name'].map(
        (label) => ({ label, type: 'text', width: 32 }),
      ),
      rows: Array.from({ length: Math.max(1, ...roster.map((r) => r.length)) }, (_, i) =>
        roster.flatMap((r) => [r[i]?.email ?? '', r[i]?.fullName ?? '']),
      ),
      headerTone: 'slate',
    },
    {
      name: 'Postal',
      columns: [
        { label: 'Province|City', type: 'text' },
        { label: 'ZIP', type: 'text' },
      ],
      rows: cities.map((r) => [r[0] + '|' + r[1], r[2] ?? '']),
      headerTone: 'slate',
    },
  ];
  const parts = readWorkbookParts(toXlsxMulti(`AF Homes ${kind} import`, sheets));
  // Blank entry cells must already be Text before Excel receives a leading-zero mobile.
  edit(parts, 'xl/styles.xml', (s) =>
    s.replace(
      /<xf numFmtId="0" fontId="0" fillId="(0|7)" borderId="1"/g,
      '<xf numFmtId="49" applyNumberFormat="1" fontId="0" fillId="$1" borderId="1"',
    ),
  );
  // Keep the customer's offline PSGC lists; retain no customer entry/sample data.
  const lookupNames = [
    'PSGC_ProvinceList',
    'PSGC_CityList',
    'PSGC_BarangayList',
    'PSGC_ProvinceIndex',
    'PSGC_CityIndex',
  ];
  lookupNames.forEach((name, i) => {
    const n = i + 8;
    parts.set(
      `xl/worksheets/sheet${n}.xml`,
      encode(decode(original.get(`xl/worksheets/sheet${i + 6}.xml`)).replace(/\ss="\d+"/g, '')),
    );
    edit(parts, 'xl/workbook.xml', (s) =>
      s.replace(
        '</sheets>',
        () => `<sheet name="${name}" sheetId="${n}" r:id="rIdLookup${n}"/></sheets>`,
      ),
    );
    edit(parts, 'xl/_rels/workbook.xml.rels', (s) =>
      s.replace(
        '</Relationships>',
        () =>
          `<Relationship Id="rIdLookup${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`,
      ),
    );
    edit(parts, '[Content_Types].xml', (s) =>
      s.replace(
        '</Types>',
        () =>
          `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
    );
  });
  const end = MEMBER_WORKBOOK_ROWS + 1;
  validations(parts, 2, [
    list(`J2:J${end}`, 'INDIRECT("PSGC_ProvinceList!$A$2:$A$99")'),
    list(
      `K2:K${end}`,
      'OFFSET(INDIRECT("PSGC_CityList!$B$2"),MATCH(J2,INDIRECT("PSGC_CityList!$A$2:$A$1643"),0)-1,0,COUNTIF(INDIRECT("PSGC_CityList!$A$2:$A$1643"),J2),1)',
    ),
    list(
      `L2:L${end}`,
      'OFFSET(INDIRECT("PSGC_BarangayList!$A$2"),VLOOKUP(J2&"|"&K2,INDIRECT("PSGC_CityIndex!$A$2:$C$1643"),2,0)-2,0,VLOOKUP(J2&"|"&K2,INDIRECT("PSGC_CityIndex!$A$2:$C$1643"),3,0),1)',
    ),
    `<dataValidation type="custom" allowBlank="1" showErrorMessage="1" error="Use 11 digits starting 09" sqref="F2:F${end}"><formula1>AND(ISTEXT(F2),LEN(F2)=11,LEFT(F2,2)="09",ISNUMBER(--F2))</formula1></dataValidation>`,
  ]);
  const ranges = roster.map(
    (r, i) =>
      `INDIRECT("Teams!$${['A', 'C', 'E'][i]}$2:$${['A', 'C', 'E'][i]}$${Math.max(2, r.length + 1)}")`,
  );
  validations(parts, 3, [
    list(
      `C2:C${end}`,
      kind === 'OST'
        ? ranges[2]!
        : `IF(B2="senior_sales_manager",${ranges[0]},IF(B2="sales_manager",${ranges[1]},INDIRECT("Teams!$G$2:$G$2")))`,
    ),
  ]);
  for (const [sheet, columns] of [
    [2, ['N', 'O']],
    [5, ['C']],
  ] as const)
    edit(parts, `xl/worksheets/sheet${sheet}.xml`, (s) =>
      s.replace(/<row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row: string, raw: string) => {
        const r = Number(raw);
        if (r === 1) return row;
        for (const col of columns) {
          const formula =
            col === 'N'
              ? `IF(J${r}="","",IFERROR(VLOOKUP(J${r}&"|"&K${r},Postal!$A$2:$B$1643,2,FALSE),""))`
              : col === 'O'
                ? `IF(G${r}="","",IFERROR(DATEDIF(DATEVALUE(G${r}),TODAY(),"Y"),""))`
                : `IF(B${r}="","",IFERROR(TEXT(EDATE(DATEVALUE(B${r}),12),"yyyy-mm-dd"),""))`;
          row = row.replace(
            new RegExp(`<c r="${col}${r}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`),
            () => `<c r="${col}${r}"><f>${escape(formula)}</f></c>`,
          );
        }
        return row;
      }),
    );
  return zipStored(
    [...parts].map(([name, data]) => ({ name, data })),
    true,
  );
}

export function readMemberWorkbook(bytes: Uint8Array) {
  const parts = readWorkbookParts(bytes);
  const date1904 = /\bdate1904=["'](?:1|true)["']/.test(decode(parts.get('xl/workbook.xml')));
  const sheets = readWorkbook(parts, Object.keys(MEMBER_ENTRY_TABS), false, DERIVED);
  const entries = Object.entries(MEMBER_ENTRY_TABS);
  for (const [name, headers] of entries) {
    const actual = sheets.get(name)![0] ?? [];
    if (JSON.stringify(actual) !== JSON.stringify(headers))
      throw new Error(`Use the current template headers on ${name}.`);
  }
  const rows = [];
  const usedKeys = new Set<string>();
  const length = Math.max(...[...sheets.values()].map((m) => m.length));
  if (length > MEMBER_WORKBOOK_ROWS + 1)
    throw new Error(`Maximum ${MEMBER_WORKBOOK_ROWS} rows per import.`);
  for (let r = 1; r < length; r++) {
    const fields: Record<string, string> = {};
    const keys = new Set<string>();
    for (const [name, headers] of entries) {
      const cells = sheets.get(name)![r] ?? [];
      keys.add(cells[0]?.trim() ?? '');
      if (cells.slice(headers.length).some(Boolean))
        throw new Error(`Unexpected extra columns on ${name}, row ${r + 1}.`);
      headers.forEach((h, i) => {
        fields[h] = cells[i]?.trim() ?? '';
      });
    }
    if (
      !Object.entries(fields).some(
        ([k, v]) => !['row_key', 'age', 'postal_code', 'expires_on'].includes(k) && v,
      )
    )
      continue;
    if (keys.size !== 1 || keys.has('') || usedKeys.has(fields.row_key!))
      throw new Error(
        `Matching unique row_key values are required across every tab at row ${r + 1}.`,
      );
    usedKeys.add(fields.row_key!);
    for (const field of [
      'birth_date',
      'starts_on',
      'date_applied',
      'applicant_signed_on',
      'referrer_signed_on',
    ])
      if (fields[field]) fields[field] = workbookDate(fields[field]!, date1904);
    fields.request_id = randomUUID();
    rows.push({ rowNumber: r + 1, fields });
  }
  if (!rows.length) throw new Error('The workbook contains no member rows.');
  return rows;
}
