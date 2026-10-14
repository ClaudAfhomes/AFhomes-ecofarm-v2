/**
 * Company 45-column membership template (BR-RATE-06 area: issuance integrity
 * starts with a correct template; import mapping in `customer-import.ts`).
 *
 * - Template endpoints serve the exact 45 headers in order, duplicates kept.
 * - The company layout remaps positionally onto import columns; unmapped
 *   company headers warn by exact name and merge nothing (ADDRESS ×2 and
 *   EMAIL ADDRESS ×2 must not collide).
 * - FULL NAME is never split: rows carry the name warning and fail on the
 *   required first/last names instead of inventing identity parse rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBERSHIP_TEMPLATE_COLUMNS } from '@afhomes/contracts';
import { parseXlsxMatrix } from '../_lib/customer-import.js';
import { toXlsxMulti } from '../_lib/report-export.js';

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

/** One company-template data row, values aligned to the 45 positions. */
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
  'OST Name', // OST/IST NAME
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
  });

  it('serves the exact 45 headers in order, duplicates kept', async () => {
    expect(MEMBERSHIP_TEMPLATE_COLUMNS).toHaveLength(45);
    const xlsx = await call({ path: 'template/xlsx' });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as { mime: string }).mime).toContain('spreadsheetml');
    const bytes = Buffer.from((xlsx.body as { content: string }).content, 'base64');
    const matrix = parseXlsxMatrix(new Uint8Array(bytes));
    expect(matrix[0]).toEqual([...MEMBERSHIP_TEMPLATE_COLUMNS]);
    // Spot-check the spec: first/last headers and the duplicated ADDRESS pair.
    expect(matrix[0]![0]).toBe('RA NO');
    expect(matrix[0]![44]).toBe('DATE');
    expect(matrix[0]![3]).toBe('ADDRESS');
    expect(matrix[0]![16]).toBe('ADDRESS');
    expect(matrix[0]![11]).toBe('EMAIL ADDRESS');
    expect(matrix[0]![35]).toBe('EMAIL ADDRESS');

    const csv = await call({ path: 'template/csv' });
    expect(csv.status).toBe(200);
    const firstLine = Buffer.from((csv.body as { content: string }).content, 'base64')
      .toString('utf8')
      .replace(/^\ufeff/, '')
      .split('\n')[0]!;
    const csvHeaders = firstLine.split(',');
    expect(csvHeaders).toHaveLength(45);
    expect(csvHeaders[0]).toBe('RA NO');
    expect(csvHeaders[44]!.trim()).toBe('DATE');
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
    expect(row.fields.secondary_birth_date).toBe('1992-08-10');
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
    expect(row.fields.ost_ist_name).toBe('OST Name');
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

  it('parses sectioned entry tabs into the same fields as the single sheet', async () => {
    install();
    const row = companyRow();
    const section = (from: number, to: number) => ({
      headers: [...MEMBERSHIP_TEMPLATE_COLUMNS.slice(from, to)],
      values: row.slice(from, to),
    });
    const primary = section(0, 15);
    const supplementary = section(15, 28);
    const related = section(28, 36);
    const pkg = section(36, 45);
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
