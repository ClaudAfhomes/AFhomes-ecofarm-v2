/**
 * Membership template endpoints and import mapping (BR-RATE-06 area:
 * issuance integrity starts with a correct template; mapping in
 * `customer-import.ts`).
 *
 * - The CURRENT download is the guided workbook: README + Primary/
 *   Supplementary/Related/Package tabs modelled on the customer-application
 *   form - split names, split address, and fixed-value dropdowns. It merges
 *   to the canonical guided flat matrix and remaps positionally.
 * - The previous company layout (44 verbatim headers, OST/IST NAME removed at
 *   position 28) still parses: files filled from those downloads keep
 *   importing, and the legacy tests below pin that.
 * - Company headers with no import target warn by exact name and merge
 *   nothing; duplicated headers (ADDRESS x2, EMAIL ADDRESS x3) never collide
 *   because both remaps are POSITIONAL.
 * - The supplementary name/address are entered as parts and JOINED into the
 *   one text column the customer record actually has; FULL NAME is gone from
 *   the download, so nothing is ever split by code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_COLUMN,
  LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX,
  MEMBERSHIP_TEMPLATE_COLUMNS,
} from '@afhomes/contracts';
import {
  INTERIM_V2_COLUMNS,
  MEMBERSHIP_TEMPLATE_SECTION_BANDS,
  MEMBERSHIP_TEMPLATE_SECTIONS,
  MEMBERSHIP_TEMPLATE_V2_COLUMNS,
  MEMBERSHIP_TEMPLATE_V2_SECTION_BANDS,
  MEMBERSHIP_TEMPLATE_V2_SECTIONS,
  isInterimV2Flat,
  mergeSectionedTemplateSheets,
} from '../_lib/customer-import.js';
import { readWorkbook, readWorkbookParts } from '../_lib/customer-xlsx.js';
import { toCsv, toXlsxMulti } from '../_lib/report-export.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (
    req: { headers?: Record<string, string> },
    moduleKey?: string,
    _action?: string,
  ) => {
    const token = req.headers?.authorization ?? '';
    const denied = (status: number, code: string) => ({
      error: { error: { code, message: 'Denied' }, status },
    });
    if (!token.replace(/^Bearer\s*/, '').trim()) return denied(401, 'UNAUTHORIZED');
    if (moduleKey === 'governance.customer_import')
      return token.includes('import-admin')
        ? { userId: 'aaaaaaaa-0000-4000-8000-000000000001', roleSlug: 'admin' }
        : denied(403, 'FORBIDDEN');
    return denied(403, 'FORBIDDEN');
  },
}));

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const imports = (await import('./customer-imports.js')).default;

function install(tables: Record<string, unknown[]> = {}) {
  holder.db = new FakeSupabase({
    tables: {
      card_plans: [],
      customers: [],
      memberships: [],
      card_sales: [],
      payments: [],
      staff_users: [],
      referral_codes: [],
      customer_import_jobs: [],
      customer_import_rows: [],
      audit_events: [],
      ...tables,
    } as never,
  });
  return holder.db as FakeSupabase;
}

async function call(opts: {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const { res, state } = makeRes();
  await (imports as (req: unknown, res: unknown) => Promise<void>)(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      query: opts.query,
      headers: { authorization: `Bearer ${opts.token ?? 'import-admin-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** One company-template data row, values aligned to the 44 positions. */
const companyRow = (): string[] => [
  'RA-001', // RA NO
  'Pending', // STATUS
  'JUAN DELA CRUZ', // FULL NAME
  '123 Sampaguita St', // ADDRESS (primary)
  '1990-05-04', // BIRTHDAY
  '36', // AGE
  'Male', // GENDER
  'Filipino', // CITIZENSHIP
  'Single', // CIVIL STATUS
  '123-456-789', // TIN NO.
  '09171234567', // MOBILE NO.
  'juan@example.com', // EMAIL ADDRESS
  'Engineer', // OCCUPATION / BUSINESS NAME
  'Makati', // OFFICE / BUSINESS ADDRESS
  'Engineer', // EMPLOYED POSITION
  'MARIA CLARA', // SUPPLEMENTARY FULL NAME
  '456 Acacia Ave', // ADDRESS (supplementary)
  '1992-08-10', // BIRTHDAY
  '34', // AGE
  'Female', // GENDER
  'Filipino', // CITIZENSHIP
  'Married', // CIVIL STATUS
  '987-654-321', // TIN NO.
  '09181234567', // MOBILE NO.
  'maria@example.com', // EMAIL ADDRESS
  'Doctor', // OCCUPATION / BUSINESS NAME
  'Quezon City', // OFFICE / BUSINESS ADDRESS
  'Doctor', // EMPLOYED POSITION
  'SVD Name', // SVD
  'SSM Name', // SSM
  'SM Name', // SM
  'Ref Name', // REFERRER
  'VIP Name', // VIP RECOMMENDER
  '09191111111', // CONTACT NO.
  'related@example.com', // EMAIL ADDRESS (related persons)
  'GOLD', // VIP PACKAGE
  'spot_cash', // PAYMENT TERMS
  '60000.00', // REGULAR PRICE
  '', // DISCOUNT
  '', // TOTAL AMOUNT
  'RF-001', // RF
  'cash', // PAYMENT TYPE
  'REF-1', // REF NO
  '2026-01-01', // DATE
];

const companyCsv = (): string => {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return (
    [...MEMBERSHIP_TEMPLATE_COLUMNS].map(quote).join(',') +
    '\n' +
    companyRow().map(quote).join(',') +
    '\n'
  );
};

describe('company membership template', () => {
  beforeEach(() => {
    install();
  });

  it('refuses anonymous and unauthorized callers before reading anything', async () => {
    expect((await call({ path: 'template/xlsx', token: '' })).status).toBe(401);
    expect((await call({ path: 'template/xlsx', token: 'seller-token' })).status).toBe(403);
    expect((await call({ path: 'template/csv', token: '' })).status).toBe(401);
    expect((await call({ path: 'template/csv', token: 'seller-token' })).status).toBe(403);
  });

  it('serves the guided README plus four tabs with dropdowns and split names', async () => {
    const xlsx = await call({ path: 'template/xlsx' });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as { mime: string }).mime).toContain('spreadsheetml');
    const bytes = Buffer.from((xlsx.body as { content: string }).content, 'base64');
    const parts = readWorkbookParts(new Uint8Array(bytes));
    const meta = new TextDecoder().decode(parts.get('xl/workbook.xml'));
    // The download is the sanitized company workbook: the README guide, the
    // four entry tabs, and the five PSGC reference tabs its postal lookup
    // reads. The reference lists exceed the import row budget by design, so
    // entry tabs are read by name - exactly as a filled download is imported.
    expect([...meta.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'README',
      'Primary',
      'Supplementary',
      'Related',
      'Package',
      'PSGC_ProvinceList',
      'PSGC_CityList',
      'PSGC_BarangayList',
      'PSGC_ProvinceIndex',
      'PSGC_CityIndex',
    ]);
    const sheets = [
      ...readWorkbook(
        parts,
        ['README', ...MEMBERSHIP_TEMPLATE_V2_SECTIONS.map((section) => section.sheet)],
      ),
    ].map(([name, matrix]) => ({ name, matrix }));
    const byName = new Map(sheets.map((s) => [s.name, s.matrix[0]]));
    for (const section of MEMBERSHIP_TEMPLATE_V2_SECTIONS)
      expect(byName.get(section.sheet)).toEqual([
        ...section.columns.map((column) => column.header),
      ]);
    // FULL NAME left the download: names are the operator's own split.
    for (const sheet of sheets) expect(sheet.matrix[0]).not.toContain('FULL NAME');
    // Dropdowns live in the worksheet XML. The company download is a real
    // Excel file (deflated parts), so the validation list is read from the
    // decompressed worksheets rather than the raw archive bytes.
    const worksheetXml = [...parts]
      .filter(([name]) => name.startsWith('xl/worksheets/'))
      .map(([, data]) => new TextDecoder().decode(data))
      .join('\n');
    expect(worksheetXml).toContain('<dataValidation type="list"');
    expect(worksheetXml).toContain('GOLD,SILVER,BRONZE');

    const csv = await call({ path: 'template/csv' });
    expect(csv.status).toBe(200);
    expect((csv.body as { mime: string }).mime).toBe('text/csv');
    expect((csv.body as { filename: string }).filename).toBe('membership-template.csv');
    const csvText = Buffer.from((csv.body as { content: string }).content, 'base64').toString(
      'utf8',
    );
    const csvMatrix = csvText
      .replace(/^\ufeff/, '')
      .split('\r\n')
      .filter((line) => line.trim() !== '')
      .map((line) => line.split(','));
    // Row 1 groups the columns by section; row 2 is the guided headers.
    expect(csvMatrix[0]).toEqual([...MEMBERSHIP_TEMPLATE_V2_SECTION_BANDS]);
    expect(csvMatrix[1]).toEqual([...MEMBERSHIP_TEMPLATE_V2_COLUMNS]);
    expect(csvMatrix[1]).toHaveLength(62);
    expect(csvMatrix[1]![0]).toBe('RA NO');
    // Names split on the Primary tab; the Supplementary tab carries the same
    // headers (they are section-separated, never SUPPLEMENTARY-prefixed).
    expect(csvMatrix[1]).toContain('BARANGGAY');
    expect(csvMatrix[1]).toContain('PERMANENT ADDRESS LINE 1');
    expect(csvMatrix[1]!.filter((header) => header === 'FIRST NAME')).toHaveLength(2);
  });

  it('keeps serving the previous company layout for already-filled files', async () => {
    // The legacy download is no longer offered by the endpoint, but files
    // filled from it still merge and remap exactly as before.
    expect(MEMBERSHIP_TEMPLATE_COLUMNS).toHaveLength(44);
    const legacy = [
      ...MEMBERSHIP_TEMPLATE_COLUMNS.slice(0, LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX),
      LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_COLUMN,
      ...MEMBERSHIP_TEMPLATE_COLUMNS.slice(LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX),
    ];
    expect(legacy).toHaveLength(45);
    const { matrix } = mergeSectionedTemplateSheets(
      MEMBERSHIP_TEMPLATE_SECTIONS.map((section) => ({
        name: section.sheet,
        matrix: [[...section.headers]],
      })),
    );
    expect(matrix[0]).toEqual([...MEMBERSHIP_TEMPLATE_COLUMNS]);
    expect(MEMBERSHIP_TEMPLATE_SECTION_BANDS).toHaveLength(44);
  });

  it('remaps company headers positionally without merging duplicates', async () => {
    install();
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(Buffer.from(companyCsv(), 'utf8')),
        sourceName: 'members.csv',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      rows: {
        fields: Record<string, string>;
        errors: { field: string }[];
        warnings: { field: string; message: string }[];
      }[];
    };
    const row = body.rows[0]!;
    // Positional mapping: primary vs supplementary vs related stay distinct.
    expect(row.fields.email).toBe('juan@example.com');
    expect(row.fields.mobile).toBe('09171234567');
    expect(row.fields.birth_date).toBe('1990-05-04');
    expect(row.fields.address_line_1).toBe('123 Sampaguita St');
    expect(row.fields.secondary_email).toBe('maria@example.com');
    expect(row.fields.secondary_mobile).toBe('09181234567');
    // The legacy layout's supplementary BIRTHDAY now lands on the dedicated
    // column instead of being validated and dropped.
    expect(row.fields.supplementary_birthday).toBe('1992-08-10');
    expect(row.fields.source_status).toBe('Pending');
    expect(row.fields.vip_tier).toBe('GOLD');
    expect(row.fields.payment_scheme).toBe('spot_cash');
    expect(row.fields.payment_method).toBe('cash');
    expect(row.fields.payment_reference).toBe('REF-1');
    expect(row.fields.payment_date).toBe('2026-01-01');
    // Company-stated verbatim fields land on their import keys.
    expect(row.fields.ra_number).toBe('RA-001');
    expect(row.fields.citizenship).toBe('Filipino');
    expect(row.fields.civil_status).toBe('Single');
    expect(row.fields.tin_number).toBe('123-456-789');
    expect(row.fields.occupation_business_name).toBe('Engineer');
    expect(row.fields.office_business_address).toBe('Makati');
    expect(row.fields.employed_position).toBe('Engineer');
    expect(row.fields.supplementary_full_name).toBe('MARIA CLARA');
    expect(row.fields.supplementary_address).toBe('456 Acacia Ave');
    expect(row.fields.svd_name).toBe('SVD Name');
    expect(row.fields.referrer_name).toBe('Ref Name');
    expect(row.fields.related_email).toBe('related@example.com');
    expect(row.fields.stated_regular_price).toBe('60000.00');
    expect(row.fields.stated_rf).toBe('RF-001');
    // Unmapped company headers warn by exact name instead of merging.
    const warned = row.warnings.map((w) => w.field);
    expect(warned).toContain('FULL NAME');
    expect(warned).toContain('AGE');
    expect(warned).not.toContain('RA NO');
    expect(warned).not.toContain('RF');
    expect(warned).not.toContain('CITIZENSHIP');
    expect(warned).not.toContain('SUPPLEMENTARY FULL NAME');
    // FULL NAME is never split: required names fail with clear errors.
    expect(row.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['first_name', 'last_name']),
    );
  });

  it('parses a filled guided workbook into split names, joins and dropdown values', async () => {
    install();
    const tabs = (values: Record<string, Record<string, string>>) =>
      MEMBERSHIP_TEMPLATE_V2_SECTIONS.map((entry) => {
        const filled = values[entry.sheet] ?? {};
        const hasRow = Object.keys(filled).length > 0;
        return {
          name: entry.sheet,
          columns: entry.columns.map((column) => ({ label: column.header, type: 'text' as const })),
          rows: (hasRow
            ? [entry.columns.map((column) => filled[column.header] ?? '')]
            : []) as unknown[][],
          headerTone: entry.tone,
        };
      });
    const bytes = toXlsxMulti('Membership Template', [
      {
        name: 'README',
        columns: [
          { label: 'Tab', type: 'text' as const },
          { label: 'Fill guide', type: 'text' as const },
        ],
        rows: [['Primary', 'Fill it']],
        headerTone: 'slate' as const,
        filter: false,
      },
      ...tabs({
        Primary: {
          'FIRST NAME': 'Juan',
          'LAST NAME': 'Cruz',
          SUFFIX: 'Jr.',
          GENDER: 'Male',
          STATUS: 'Pending',
          EMAIL: 'juan@example.com',
          'MOBILE NO.': '09171234567',
          'PERMANENT ADDRESS LINE 1': '1 QA Street',
          'PERMANENT ADDRESS LINE 2': 'Brgy San Roque',
          CITY: 'Calauan',
          PROVINCE: 'Laguna',
          BARANGGAY: 'Santo Tomas',
          'POSTAL CODE': '4012',
          LANDLINE: '(049) 555-1234',
          'RA NO': 'RA-001',
        },
        Supplementary: {
          'FIRST NAME': 'Maria',
          'LAST NAME': 'Santos',
          'PERMANENT ADDRESS LINE 1': '456 Acacia Ave',
          'PERMANENT ADDRESS LINE 2': 'Quezon City',
          BIRTHDAY: '1992-08-10',
          'MOBILE NO.': '09181234567',
          EMAIL: 'maria@example.com',
          LANDLINE: '(02) 8123-4567',
        },
        Related: { 'REFERRER (NAME)': 'Thanos' },
        Package: { 'VIP PACKAGE': 'GOLD', RF: 'RF-001', 'REF NO': 'REF-001' },
      }),
    ]);
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'excel',
        contentBase64: b64(bytes),
        sourceName: 'members.xlsx',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      rows: { fields: Record<string, string>; warnings: { field: string }[] }[];
    };
    const parsed = body.rows[0]!;
    // Split columns land on the established person fields.
    expect(parsed.fields.first_name).toBe('Juan');
    expect(parsed.fields.last_name).toBe('Cruz');
    expect(parsed.fields.suffix).toBe('Jr.');
    expect(parsed.fields.address_line_1).toBe('1 QA Street');
    expect(parsed.fields.address_line_2).toBe('Brgy San Roque');
    expect(parsed.fields.city).toBe('Calauan');
    expect(parsed.fields.province).toBe('Laguna');
    expect(parsed.fields.barangay).toBe('Santo Tomas');
    expect(parsed.fields.postal_code).toBe('4012');
    expect(parsed.fields.landline).toBe('(049) 555-1234');
    expect(parsed.fields.email).toBe('juan@example.com');
    expect(parsed.fields.ra_number).toBe('RA-001');
    expect(parsed.fields.stated_rf).toBe('RF-001');
    // Part columns joined into the one text column the record has; the
    // supplementary singles land on their dedicated columns (the old
    // notes-blob targets are gone).
    expect(parsed.fields.supplementary_full_name).toBe('Maria Santos');
    expect(parsed.fields.supplementary_address).toBe('456 Acacia Ave, Quezon City');
    expect(parsed.fields.supplementary_birthday).toBe('1992-08-10');
    expect(parsed.fields.supplementary_mobile).toBe('09181234567');
    expect(parsed.fields.supplementary_email).toBe('maria@example.com');
    expect(parsed.fields.supplementary_landline).toBe('(02) 8123-4567');
    // Only the reference-only AGE columns warn; nothing else is unknown.
    const warned = parsed.warnings.map((w) => w.field);
    expect(warned).toContain('AGE');
    expect(warned).not.toContain('FIRST NAME');
    expect(warned).not.toContain('PERMANENT ADDRESS LINE 1');
  });

  it('rejects a flat file filled from the superseded interim template with the fix message', async () => {
    install();
    expect(isInterimV2Flat([...INTERIM_V2_COLUMNS])).toBe(true);
    const row = INTERIM_V2_COLUMNS.map((header) =>
      header === 'FIRST NAME' ? 'Juan' : header === 'LAST NAME' ? 'Cruz' : '',
    );
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv =
      [...INTERIM_V2_COLUMNS].map(quote).join(',') + '\n' + row.map(quote).join(',') + '\n';
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(Buffer.from(csv, 'utf8')),
        sourceName: 'members-interim.csv',
      },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toContain('older template');
  });

  it('rejects a sectioned workbook from the superseded interim template with the fix message', async () => {
    install();
    const interimPrimary = INTERIM_V2_COLUMNS.slice(0, 20);
    const interimSupplementary = INTERIM_V2_COLUMNS.slice(20, 36);
    const interimRelated = INTERIM_V2_COLUMNS.slice(36, 43);
    const interimPackage = INTERIM_V2_COLUMNS.slice(43);
    const tab = (name: string, headers: readonly string[]) => ({
      name,
      columns: headers.map((label) => ({ label, type: 'text' as const })),
      rows: [],
      headerTone: 'blue' as const,
    });
    const bytes = toXlsxMulti('Membership Template', [
      {
        name: 'README',
        columns: [
          { label: 'Tab', type: 'text' as const },
          { label: 'Fill guide', type: 'text' as const },
        ],
        rows: [['Primary', 'Fill it']],
        headerTone: 'slate' as const,
        filter: false,
      },
      tab('Primary', interimPrimary),
      tab('Supplementary', interimSupplementary),
      tab('Related', interimRelated),
      tab('Package', interimPackage),
    ]);
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: b64(bytes), sourceName: 'members-interim.xlsx' },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toContain('older template');
  });

  it('parses sectioned legacy tabs into the same fields as the single sheet', async () => {
    install();
    const row = companyRow();
    const section = (from: number, to: number) => ({
      headers: [...MEMBERSHIP_TEMPLATE_COLUMNS.slice(from, to)],
      values: row.slice(from, to),
    });
    const primary = section(0, 15);
    const supplementary = section(15, 28);
    const related = section(28, 35);
    const pkg = section(35, 44);
    const bytes = toXlsxMulti('Membership Template', [
      {
        name: 'README',
        columns: [
          { label: 'Section', type: 'text' as const },
          { label: 'What to do', type: 'text' as const },
        ],
        rows: [['Primary', 'Fill it']],
        headerTone: 'slate' as const,
        filter: false,
      },
      {
        name: 'Primary',
        columns: primary.headers.map((label) => ({ label, type: 'text' as const })),
        rows: [primary.values],
        headerTone: 'blue' as const,
      },
      {
        name: 'Supplementary',
        columns: supplementary.headers.map((label) => ({ label, type: 'text' as const })),
        rows: [supplementary.values],
        headerTone: 'green' as const,
      },
      {
        name: 'Related',
        columns: related.headers.map((label) => ({ label, type: 'text' as const })),
        rows: [related.values],
        headerTone: 'amber' as const,
      },
      {
        name: 'Package',
        columns: pkg.headers.map((label) => ({ label, type: 'text' as const })),
        rows: [pkg.values],
        headerTone: 'purple' as const,
      },
    ]);
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'excel',
        contentBase64: b64(bytes),
        sourceName: 'members.xlsx',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      rows: { fields: Record<string, string>; warnings: { field: string }[] }[];
    };
    const parsed = body.rows[0]!;
    expect(parsed.fields.email).toBe('juan@example.com');
    expect(parsed.fields.secondary_email).toBe('maria@example.com');
    expect(parsed.fields.ra_number).toBe('RA-001');
    expect(parsed.fields.stated_rf).toBe('RF-001');
    expect(parsed.warnings.map((w) => w.field)).toContain('FULL NAME');
  });

  it('parses a filled banded CSV into the same fields as the single sheet', async () => {
    install();
    const banded = [...MEMBERSHIP_TEMPLATE_SECTION_BANDS].join(',') + '\n' + companyCsv();
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(Buffer.from(banded, 'utf8')),
        sourceName: 'members.csv',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      rows: { fields: Record<string, string>; warnings: { field: string }[] }[];
    };
    const parsed = body.rows[0]!;
    expect(parsed.fields.email).toBe('juan@example.com');
    expect(parsed.fields.secondary_email).toBe('maria@example.com');
    expect(parsed.fields.ra_number).toBe('RA-001');
    expect(parsed.fields.stated_rf).toBe('RF-001');
    expect(parsed.warnings.map((w) => w.field)).toContain('FULL NAME');
  });

  it('keeps a plain 44-column CSV working without the band row', async () => {
    install();
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(Buffer.from(companyCsv(), 'utf8')),
        sourceName: 'members.csv',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { rows: { fields: Record<string, string> }[] };
    expect(body.rows[0]!.fields.email).toBe('juan@example.com');
  });

  it('still imports a superseded 45-column file with its OST/IST NAME preserved', async () => {
    install();
    // Headers and values of an older download: the removed column back at its
    // old position. The row must parse and keep its value on the existing
    // customer-record pipeline instead of failing as 45 unknown headers.
    const legacyHeaders = [
      ...MEMBERSHIP_TEMPLATE_COLUMNS.slice(0, LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX),
      LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_COLUMN,
      ...MEMBERSHIP_TEMPLATE_COLUMNS.slice(LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX),
    ];
    expect(legacyHeaders).toHaveLength(45);
    const legacyRow = [
      ...companyRow().slice(0, LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX),
      'OST Name',
      ...companyRow().slice(LEGACY_MEMBERSHIP_TEMPLATE_OST_IST_INDEX),
    ];
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = legacyHeaders.map(quote).join(',') + '\n' + legacyRow.map(quote).join(',') + '\n';
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(Buffer.from(csv, 'utf8')),
        sourceName: 'members-legacy.csv',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      rows: {
        fields: Record<string, string>;
        warnings: { field: string; message: string }[];
      }[];
    };
    const row = body.rows[0]!;
    expect(row.fields.ost_ist_name).toBe('OST Name');
    expect(row.fields.svd_name).toBe('SVD Name');
    expect(row.fields.email).toBe('juan@example.com');
    // The removed column has a real target, so it is preserved rather than
    // reported among the ignored-column warnings.
    expect(row.warnings.map((w) => w.field)).not.toContain('OST/IST NAME');
  });

  it('rejects foreign multi-sheet workbooks instead of guessing a tab', async () => {
    install();
    const bytes = toXlsxMulti('Foreign', [
      {
        name: 'Tab A',
        columns: [{ label: 'first_name', type: 'text' as const }],
        rows: [['Juan']],
      },
      {
        name: 'Tab B',
        columns: [{ label: 'last_name', type: 'text' as const }],
        rows: [['Cruz']],
      },
    ]);
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: b64(bytes), sourceName: 'foreign.xlsx' },
    });
    expect(res.status).toBe(400);
  });
});
