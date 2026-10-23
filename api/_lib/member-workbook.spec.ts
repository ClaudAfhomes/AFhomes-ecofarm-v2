import { beforeAll, describe, expect, it, vi } from 'vitest';
import { memberSchema, memberWorkbookInput } from '@afhomes/contracts';
import { MEMBER_ENTRY_TABS, memberWorkbook, readMemberWorkbook } from './member-workbook.js';
import { previewMemberWorkbook } from './member-workbook-preview.js';
import { readWorkbookParts } from './customer-xlsx.js';
import { zipStored } from './report-export.js';

const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const member = (
  n: number,
  position: 'vice_director' | 'senior_sales_manager' | 'sales_manager',
  head: number | null,
) =>
  memberSchema.parse({
    ...Object.fromEntries(Object.keys(memberSchema.shape).map((k) => [k, null])),
    id: id(n),
    fullName: 'EXISTING HEAD',
    email: `head${n}@example.invalid`,
    position,
    positionLabel: position,
    status: 'active',
    createdAt: '2020-01-01',
    referrerStaffId: head ? id(head) : null,
  });
const members = [
  member(1, 'vice_director', null),
  member(2, 'senior_sales_manager', 1),
  member(3, 'sales_manager', 2),
];
let template: Uint8Array;
beforeAll(() => {
  template = memberWorkbook('OST', members);
});
const fields: Record<string, string> = {
  first_name: 'Test',
  last_name: 'Seller',
  email: 'new@example.invalid',
  mobile: '09123456789',
  birth_date: '1990-01-01',
  sex: 'Male',
  civil_status: 'Single',
  province: 'Laguna',
  city: 'Calauan',
  barangay: 'Dayap',
  address_line_1: 'One Main Street',
  position: 'ost',
  head_member: 'head3@example.invalid',
  aa_mode: 'auto',
  government_id_type: 'passport',
  government_id_number: 'P1234567',
  employer_name: 'Example',
  employer_address: 'Calauan',
  job_position: 'Seller',
  starts_on: '2026-10-17',
  date_applied: '2026-10-17',
  program_category: 'non_vip',
  applicant_signature: 'received',
  referrer_signature: 'received',
  applicant_signed_on: '2026-10-17',
  referrer_signed_on: '2026-10-17',
};
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function filled(rows: Record<string, string>[], transform?: (s: string, n: number) => string) {
  const parts = readWorkbookParts(template);
  Object.values(MEMBER_ENTRY_TABS).forEach((headers, index) => {
    const path = `xl/worksheets/sheet${index + 2}.xml`;
    let text = new TextDecoder().decode(parts.get(path));
    rows.forEach((f, i) =>
      headers.forEach((h, c) => {
        if (f[h] === undefined) return;
        const ref = String.fromCharCode(65 + c) + (i + 2);
        text = text.replace(
          new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`),
          () => `<c r="${ref}" t="inlineStr"><is><t>${xml(f[h]!)}</t></is></c>`,
        );
      }),
    );
    if (transform) text = transform(text, index + 2);
    parts.set(path, new TextEncoder().encode(text));
  });
  return zipStored(
    [...parts].map(([name, data]) => ({ name, data })),
    true,
  );
}
const provider = {
  name: 'test',
  provinces: vi.fn(async () => [{ name: 'Laguna', code: '0403400000' }]),
  localities: vi.fn(async () => [
    {
      name: 'Calauan',
      code: '0403406000',
      type: 'municipality' as const,
      provinceCode: '0403400000',
      postalCode: '4012',
    },
  ]),
  barangays: vi.fn(async () => [{ name: 'Dayap', code: '0403406001', localityCode: '0403406000' }]),
};
const preview = (bytes: Uint8Array, list = members) =>
  previewMemberWorkbook(bytes, 'OST', list, id(4), provider, async () => []);

describe('member workbook', () => {
  it('has the customer-style tabs, offline lookups, choices and formulas without macros or customer data', () => {
    const p = readWorkbookParts(template),
      text = (path: string) => new TextDecoder().decode(p.get(path));
    expect(text('xl/workbook.xml')).toContain('PSGC_BarangayList');
    expect(text('xl/workbook.xml')).toContain('Identity');
    expect(text('xl/worksheets/sheet2.xml')).toContain('OFFSET(');
    expect(text('xl/worksheets/sheet2.xml')).toContain('LEN(F2)=11');
    expect(text('xl/styles.xml')).toContain('numFmtId="49" applyNumberFormat="1"');
    expect(text('xl/worksheets/sheet2.xml')).toContain('<f>IF(');
    expect(text('xl/worksheets/sheet3.xml')).toContain('Teams!$E$2');
    expect(text('xl/worksheets/sheet5.xml')).toContain('EDATE(');
    expect([...p.keys()].some((k) => k.includes('vba'))).toBe(false);
    expect(text('xl/worksheets/sheet1.xml')).toContain('PRIVATE');
  });
  it('does not interpret 500 formula-only prepared rows as members', () => {
    expect(() => readMemberWorkbook(template)).toThrow('no member rows');
  });
  it('honors the Excel 1904 date system instead of silently shifting birthdays', async () => {
    const serial = String((Date.UTC(1990, 0, 1) - Date.UTC(1904, 0, 1)) / 86400000);
    const parts = readWorkbookParts(filled([{ ...fields, birth_date: serial }]));
    const meta = new TextDecoder().decode(parts.get('xl/workbook.xml'));
    parts.set(
      'xl/workbook.xml',
      new TextEncoder().encode(meta.replace('<sheets>', '<workbookPr date1904="1"/><sheets>')),
    );
    const bytes = zipStored(
      [...parts].map(([name, data]) => ({ name, data })),
      true,
    );
    const result = await preview(bytes);
    expect(result.rows[0]!.fields.birth_date).toBe('1990-01-01');
    expect(result.rows[0]!.errors).toEqual([]);
  });
  it('blocks a single-tab sort or duplicated row key instead of mixing identities and teams', () => {
    expect(() =>
      readMemberWorkbook(
        filled([fields], (s, n) => (n === 3 ? s.replace('ROW-0001', 'ROW-0002') : s)),
      ),
    ).toThrow('row_key');
  });
  it('builds an IST through its existing creation contract without OST approval fields', async () => {
    const f: Record<string, string> = {
      ...fields,
      position: 'sales_manager',
      head_member: 'head2@example.invalid',
    };
    for (const h of MEMBER_ENTRY_TABS.Accreditation) delete f[h];
    const r = await previewMemberWorkbook(
      filled([f]),
      'IST',
      members,
      id(4),
      provider,
      async () => [],
    );
    expect(r.rows[0]!.errors).toEqual([]);
    const input = memberWorkbookInput(
      'IST',
      r.rows[0]!.fields,
      id(4),
      'Aa1!IndividualTemporaryPassword',
    );
    expect(input.success).toBe(true);
    if (input.success)
      expect(input.data).toMatchObject({
        position: 'sales_manager',
        referrerStaffId: id(2),
        aaNumberMode: 'auto',
      });
  });
  it('round-trips a completed OST through canonical creation with verified addresses and derived expiry', async () => {
    const result = await preview(filled([fields]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.errors).toEqual([]);
    const f = result.rows[0]!.fields;
    expect(f.mobile).toBe('09123456789');
    expect(f.head_staff_id).toBe(id(3));
    expect(f.postal_code).toBe('4012');
    expect(f.expires_on).toBe('2027-10-17');
    const parsed = memberWorkbookInput('OST', f, id(4), 'Aa1!IndividualTemporaryPassword');
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data).toMatchObject({ mode: 'complete', sponsorStaffId: id(3) });
  });
  it('marks every row participating in a duplicate and resolves address scopes once', async () => {
    provider.localities.mockClear();
    provider.barangays.mockClear();
    const result = await preview(filled([fields, { ...fields }]));
    expect(result.rows.every((r) => r.errors.some((e) => e.includes('duplicated')))).toBe(true);
    expect(provider.localities).toHaveBeenCalledTimes(1);
    expect(provider.barangays).toHaveBeenCalledTimes(1);
  });
  it('rejects arbitrary formulas while discarding untrusted derived formulas', async () => {
    expect(() =>
      readMemberWorkbook(
        filled([fields], (s, n) =>
          n === 2
            ? s.replace(
                /<c r="E2"[\s\S]*?<\/c>/,
                '<c r="E2"><f>WEBSERVICE("https://example.invalid")</f></c>',
              )
            : s,
        ),
      ),
    ).toThrow('Formula');
    const result = await preview(
      filled([fields], (s, n) =>
        n === 2 ? s.replace(/<c r="N2"[\s\S]*?<\/c>/, '<c r="N2"><f>1+1</f><v>9999</v></c>') : s,
      ),
    );
    expect(result.rows[0]!.fields.postal_code).toBe('4012');
  });
  it('rejects wrong-role heads, incomplete teams and conflicting manually entered ZIP', async () => {
    const wrong = await preview(
      filled([{ ...fields, head_member: 'head1@example.invalid', postal_code: '9999' }]),
    );
    expect(wrong.rows[0]!.errors.join(' ')).toMatch(/immediate head/);
    expect(wrong.rows[0]!.errors.join(' ')).toMatch(/ZIP disagrees/);
    const broken = await preview(
      filled([fields]),
      members.filter((m) => m.position !== 'vice_director'),
    );
    expect(broken.rows[0]!.errors.join(' ')).toContain('complete active SSM/VD');
  });
  it('fails on unavailable address authority and wrong headers, without producing ready rows', async () => {
    provider.provinces.mockRejectedValueOnce(new Error('unavailable'));
    await expect(preview(filled([fields]))).rejects.toThrow('unavailable');
    expect(() =>
      readMemberWorkbook(filled([fields], (s) => s.replace('first_name', 'customer_name'))),
    ).toThrow('headers');
  });
  it('rejects false signature claims and refuses to turn an IST row into OST', async () => {
    const r = await preview(
      filled([{ ...fields, position: 'sales_manager', applicant_signature: 'pending' }]),
    );
    expect(r.rows[0]!.errors.join(' ')).toContain('must be ost');
    expect(r.rows[0]!.errors.join(' ')).toContain('Both signatures');
  });
});
