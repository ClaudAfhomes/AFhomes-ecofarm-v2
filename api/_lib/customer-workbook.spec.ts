import { describe, it, expect } from 'vitest';
import { CUSTOMER_WORKBOOK_HEADERS, normalizeWorkbookName, completedAge } from '@afhomes/contracts';
import { zipStored } from './report-export.js';
import { parseCustomerWorkbook, workbookDate } from './customer-workbook.js';
import {
  validateWorkbookFields,
  resolveWorkbookGeography,
  workbookApplicationPrefill,
  resolveWorkbookStaff,
} from './customer-workbook.js';
import { companyTemplate, companyWorkbook } from './customer-workbook-export.js';
import { readWorkbookParts } from './customer-xlsx.js';
import { validateImportRow, type ImportContext } from './customer-import.js';
import type { AddressProvider } from './address-provider.js';

function book(data: Record<string, Record<number, Record<string, string>>> = {}) {
  const sheets = Object.entries(CUSTOMER_WORKBOOK_HEADERS);
  const parts: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets>${sheets.map(([name], i) => `<sheet name="${name}" r:id="r${i}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="r${i}" Type="urn:/worksheet" Target="worksheets/s${i}.xml"/>`).join('')}</Relationships>`,
  };
  sheets.forEach(([name, headers], i) => {
    const cells = (values: Record<string, string>, row: number) =>
      Object.entries(values)
        .map(([col, value]) => `<c r="${col}${row}" t="inlineStr"><is><t>${value}</t></is></c>`)
        .join('');
    const letter = (n: number) => String.fromCharCode(65 + n);
    parts[`xl/worksheets/s${i}.xml`] =
      `<worksheet><sheetData><row r="1">${cells(Object.fromEntries(headers.map((h, j) => [letter(j), h])), 1)}</row>${Object.entries(
        data[name] ?? {},
      )
        .map(([row, values]) => `<row r="${row}">${cells(values, Number(row))}</row>`)
        .join('')}</sheetData></worksheet>`;
  });
  return zipStored(
    Object.entries(parts).map(([name, data]) => ({ name, data: new TextEncoder().encode(data) })),
    true,
  );
}

describe('company workbook adapter', () => {
  it('ships all ten source sheets without customer data, macros, cached shared strings or author metadata', () => {
    const bytes = companyTemplate();
    const parts = readWorkbookParts(bytes);
    expect(
      [...parts.keys()].some((name) => /vba|docProps|sharedStrings|calcChain/.test(name)),
    ).toBe(false);
    expect(parseCustomerWorkbook(bytes)?.rows).toEqual([]);
    expect([...parts.keys()].filter((name) => /worksheets\//.test(name))).toHaveLength(10);
  });
  it('ignores 20,000 prefilled derived formulas and round trips one aligned Gold customer', () => {
    const input = {
      first_name: 'Claud',
      last_name: 'Test',
      email: 'synthetic@example.invalid',
      mobile: '09123456789',
      birth_date: '2000-02-29',
      vip_tier: 'GOLD',
      stated_status: 'Fully Paid',
      secondary_first_name: 'Maria',
      secondary_last_name: 'Test',
      stated_total: '60000.00',
    };
    const first = parseCustomerWorkbook(companyWorkbook([input]))!;
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]?.fields).toMatchObject(input);
    const second = parseCustomerWorkbook(companyWorkbook(first.rows.map((r) => r.fields)))!;
    expect(second.rows).toEqual(first.rows);
  });
  it('accepts exactly 5,000 populated records within the archive budgets', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      first_name: 'Synthetic',
      last_name: 'Test',
      email: `synthetic${i}@example.invalid`,
      mobile: '09123456789',
    }));
    expect(parseCustomerWorkbook(companyWorkbook(rows))?.rows).toHaveLength(5000);
    expect(() => companyWorkbook([...rows, rows[0]!])).toThrow(/5000/);
  }, 30000);
  it('merges sparse sheets by Excel row number, never array position', () => {
    const result = parseCustomerWorkbook(
      book({
        Primary: { 4: { C: 'ana', D: 'Cruz', U: '09123456789' } },
        Supplementary: { 4: { A: 'Ben' } },
        Package: { 4: { A: 'GOLD' } },
      }),
    );
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({
      rowNumber: 4,
      fields: {
        first_name: 'Ana',
        secondary_first_name: 'Ben',
        vip_tier: 'GOLD',
        mobile: '09123456789',
      },
    });
  });
  it('empty aligned sheets produce zero records', () =>
    expect(parseCustomerWorkbook(book())?.rows).toEqual([]));
  it('rejects malformed headers', () => {
    expect(() => parseCustomerWorkbook(book({ Primary: { 1: { A: 'WRONG' } } }))).toThrow();
  });
  it('supports Excel dates and rejects Excel leap-day fiction and bad text dates', () => {
    expect(workbookDate('36526')).toBe('2000-01-01');
    expect(workbookDate('36526.5')).toBe('2000-01-01');
    expect(workbookDate('0', true)).toBe('1904-01-01');
    expect(workbookDate('02/29/2000')).toBe('2000-02-29');
    expect(workbookDate('60')).toBe('INVALID DATE');
    expect(workbookDate('02/29/2001')).toBe('INVALID DATE');
    expect(
      parseCustomerWorkbook(companyWorkbook([{ stated_date: '1900-01-01' }]))?.rows[0]?.fields
        .stated_date,
    ).toBe('1900-01-01');
  });
  it('preserves name exceptions and calculates completed years', () => {
    expect(normalizeWorkbookName('maria dela cruz')).toBe('Maria Dela Cruz');
    expect(normalizeWorkbookName("McDonald O'NEIL III")).toBe("McDonald O'Neil III");
    expect(completedAge('2000-02-29', '2026-02-28')).toBe(25);
    expect(completedAge('2000-02-29', '2026-03-01')).toBe(26);
  });
});

const context: ImportContext = {
  plansByTier: new Map(),
  customerByNumber: new Map(),
  customerByEmail: new Map(),
  membershipByNumber: new Map(),
  referralStaffByCode: new Map(),
  seenMembershipNumbers: new Map(),
};
const validFields = () => ({
  first_name: 'Synthetic',
  last_name: 'Test',
  mobile: '09123456789',
  email: 'synthetic@example.invalid',
  source_status: 'Pending',
  workbook_format: 'company_v1',
});
const provider: AddressProvider = {
  name: 'test',
  provinces: async () => [{ code: '0403400000', name: 'Laguna' }],
  localities: async () => [
    { code: '0403434000', name: 'Victoria', type: 'municipality', provinceCode: '0403400000' },
  ],
  barangays: async () => [
    { code: '0403434001', name: 'San Francisco', localityCode: '0403434000' },
  ],
};
describe('company row rules', () => {
  it.each([
    '0912345678',
    '9171234567',
    '0912-3456789',
    '09123456789 ',
    '09a23456789',
    '091234567890',
  ])('rejects invalid exact phone %s', (mobile) => {
    const fields = { ...validFields(), mobile };
    const row = validateImportRow(2, fields, context, '2026-10-16');
    validateWorkbookFields(fields, row);
    expect(row.errors.some((e) => e.field === 'mobile')).toBe(true);
  });
  it('holds hierarchy name-only matches and never turns claims into money or activation', () => {
    const fields = {
      ...validFields(),
      stated_status: 'Fully Paid',
      stated_total: '60000.00',
      stated_rf: '5000.00',
      stated_reference: 'SYNTHETIC',
      vd_name: 'Ambiguous Seller',
    };
    const row = validateImportRow(2, fields, context, '2026-10-16');
    validateWorkbookFields(fields, row);
    resolveWorkbookStaff(fields, [], row);
    expect(row.normalized).toMatchObject({
      payment: null,
      requireMember: false,
      customerStatus: 'prospect',
    });
    expect(row.errors.some((e) => e.field === 'vd_name')).toBe(true);
  });
  it('resolves a registered manager chain and permits a referrer directly attached to a VD', () => {
    const matches = [
      {
        staff_id: 'vd',
        full_name: 'Registered VD',
        role_slug: 'vice_director',
        ancestor_ids: [],
        match_count: 1,
      },
      {
        staff_id: 'ost',
        full_name: 'Registered OST',
        role_slug: 'ost',
        ancestor_ids: ['vd'],
        match_count: 1,
      },
    ];
    const fields = { ...validFields(), vd_name: 'registered vd', referrer_name: 'Registered OST' };
    const row = validateImportRow(2, fields, context, '2026-10-16');
    resolveWorkbookStaff(fields, matches, row);
    expect(row.errors).toEqual([]);
    expect(fields).toMatchObject({ vd_staff_id: 'vd', referrer_staff_id: 'ost' });
    const ambiguous = validateImportRow(2, fields, context, '2026-10-16');
    resolveWorkbookStaff(
      fields,
      matches.map((m) => ({ ...m, match_count: 2 })),
      ambiguous,
    );
    expect(ambiguous.errors.some((e) => e.field === 'vd_name')).toBe(true);
    const wrongChain = validateImportRow(2, fields, context, '2026-10-16');
    resolveWorkbookStaff(
      fields,
      matches.map((m) => ({ ...m, ancestor_ids: [] })),
      wrongChain,
    );
    expect(wrongChain.errors.some((e) => e.field === 'referrer_name')).toBe(true);
  });
  it('keeps authoritative status readouts in README separate from re-imported company claims', () => {
    const bytes = companyWorkbook([
      {
        ...validFields(),
        stated_status: 'Fully Paid',
        system_customer_number: 'AF-CUS-ABCDE',
        system_customer_status: 'prospect',
        system_membership_status: 'none',
        system_payment_status: 'no_payment',
      },
    ]);
    const readme = new TextDecoder().decode(
      readWorkbookParts(bytes).get('xl/worksheets/sheet1.xml'),
    );
    expect(readme).toContain('System verification');
    expect(readme).toContain('no_payment');
    const records = parseCustomerWorkbook(bytes)!.rows;
    expect(records).toHaveLength(1);
    expect(records[0]!.fields.stated_status).toBe('Fully Paid');
    expect(records[0]!.fields).not.toHaveProperty('system_customer_number');
  });
  it('resolves geographic and national postal references while holding conflicting candidates', async () => {
    for (const [overrides, field] of [
      [{}, null],
      [{ city: 'Other' }, 'city'],
      [{ barangay: 'Other' }, 'barangay'],
      [{ postal_code: '9999' }, 'postal_code'],
    ] as const) {
      const fields = {
        ...validFields(),
        province: 'Laguna',
        city: 'Victoria',
        barangay: 'San Francisco',
        postal_code: '4011',
        ...overrides,
      };
      const row = validateImportRow(2, fields, context, '2026-10-16');
      await resolveWorkbookGeography(fields, provider, row);
      if (field) expect(row.errors.some((e) => e.field === field)).toBe(true);
      else
        expect(fields).toMatchObject({
          postal_code: '4011',
          province_code: '0403400000',
          barangay_code: '0403434001',
        });
      if (!field || field === 'postal_code') {
        expect(fields.postal_code).toBe(
          'postal_code' in overrides ? overrides.postal_code : '4011',
        );
        expect(row.errors.some((e) => e.field === 'postal_code')).toBe(field === 'postal_code');
        if (!field) expect(fields).toMatchObject({ verified_postal_code: '4011' });
      }
    }
  });
  it('populates editable application holders without fabricated consent or evidence', () => {
    const result = workbookApplicationPrefill({
      ...validFields(),
      birth_date: '2000-02-29',
      civil_status: 'Seperated',
      vip_tier: 'GOLD',
      secondary_first_name: 'Maria',
      secondary_last_name: 'Test',
    });
    expect(result.primary).toMatchObject({ firstName: 'Synthetic', civilStatus: 'Separated' });
    expect(result.secondary).toMatchObject({ firstName: 'Maria', lastName: 'Test' });
    expect(result).not.toHaveProperty('consentAcknowledged');
    expect(result.missingFields).toContain('Customer consent');
  });
});
