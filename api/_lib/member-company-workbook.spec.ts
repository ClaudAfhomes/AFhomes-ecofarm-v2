import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { companyMemberWorkbook } from './member-company-workbook.js';
import { companyLayout } from './member-workbook-layout.js';
import { readMemberWorkbook } from './member-workbook.js';
import { readWorkbook, readWorkbookParts } from './customer-xlsx.js';
import { zipStored } from './report-export.js';
import { memberSchema } from '@afhomes/contracts';
import { exportMemberWorkbook } from './member-workbook-export.js';
import { previewMemberWorkbook } from './member-workbook-preview.js';

const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function filled(
  kind: 'IST' | 'OST',
  count = 1,
  transform = (s: string, _sheet: string) => s,
  override = (_row: number): Record<string, string> => ({}),
) {
  const parts = readWorkbookParts(companyMemberWorkbook(kind, []));
  Object.entries(companyLayout(kind)).forEach(([name, columns], i) => {
    const path = `xl/worksheets/sheet${i + 2}.xml`;
    const text = new TextDecoder()
      .decode(parts.get(path))
      .replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, raw) => {
        const n = Number(raw);
        if (n < 2 || n >= count + 2) return row;
        const f: Record<string, string> = {
          first_name: 'Test',
          last_name: 'Seller',
          email: `test${n}@example.invalid`,
          mobile: '09123456789',
          birth_date: '1990-01-01',
          position: 'Vice Director',
          government_id_type: 'Passport',
          government_id_number: 'SYNTHETIC',
          starts_on: '2024-02-29',
          date_applied: '2024-02-29',
          sex: 'Male',
          civil_status: 'Single',
          province: 'Laguna',
          city: 'Calauan',
          barangay: 'Dayap',
          address_line_1: 'One Street',
          employer_name: 'Synthetic',
          employer_address: 'Calauan',
          job_position: 'Seller',
          ...override(n),
        };
        columns.forEach(([, field], c) => {
          if (!f[field]) return;
          const ref = `${String.fromCharCode(65 + c)}${n}`;
          const cell = `<c r="${ref}" t="inlineStr"><is><t>${xml(f[field]!)}</t></is></c>`;
          const pattern = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
          if (pattern.test(row)) row = row.replace(pattern, () => cell);
          else row = row.replace('</row>', () => cell + '</row>');
        });
        return row;
      });
    parts.set(path, new TextEncoder().encode(transform(text, name)));
  });
  return zipStored(
    [...parts].map(([name, data]) => ({ name, data })),
    true,
  );
}

describe('official company member workbook v2', () => {
  const provider = {
    name: 'synthetic',
    provinces: async () => [{ code: '0403400000', name: 'Laguna' }],
    localities: async () => [
      {
        code: '0403406000',
        name: 'Calauan',
        provinceCode: '0403400000',
        type: 'municipality' as const,
        postalCode: '4012',
      },
    ],
    barangays: async () => [{ code: '0403406001', name: 'Dayap', localityCode: '0403406000' }],
  };
  const department = '99999999-9999-4999-8999-999999999999';
  for (const kind of ['IST', 'OST'] as const) {
    it(`${kind} preserves official sheets and drops all entry values and cached names`, () => {
      const bytes = companyMemberWorkbook(kind, []);
      const parts = readWorkbookParts(bytes);
      expect(parts.has('xl/sharedStrings.xml')).toBe(false);
      const entry = readWorkbook(parts, Object.keys(companyLayout(kind)), false, {
        Identity: [8, 15],
        Team: [1, 4],
        Details: [1],
        Accreditation: [1, 3],
      });
      for (const [name, rows] of entry) {
        expect(rows[0]).toEqual(companyLayout(kind)[name]!.map((c) => c[0]));
        expect(rows.slice(1).flat().filter(Boolean)).toEqual([]);
      }
      const book = new TextDecoder().decode(parts.get('xl/workbook.xml'));
      expect(book.includes('Accreditation')).toBe(kind === 'OST');
      expect(book.includes('Date Helper')).toBe(true);
      expect(() => readMemberWorkbook(bytes, kind)).toThrow('no member rows');
      expect([...parts.keys()].some((p) => /vba|externalLink|docProps/.test(p))).toBe(false);
    });
    it(`${kind} maps readable headers with same-row formula alignment`, () => {
      const rows = readMemberWorkbook(filled(kind), kind);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.fields).toMatchObject({
        source_layout: 'company-v2',
        source_kind: kind,
        first_name: 'Test',
        mobile: '09123456789',
        government_id_type: 'passport',
        position: kind === 'IST' ? 'vice_director' : 'ost',
      });
    });
    it(`${kind} preserves every corrected template part except populated Teams choices`, () => {
      const member = memberSchema.parse({
        ...Object.fromEntries(Object.keys(memberSchema.shape).map((k) => [k, null])),
        id: '11111111-1111-4111-8111-111111111111',
        fullName: 'SYNTHETIC MANAGER',
        email: 'synthetic@example.invalid',
        position: 'sales_manager',
        positionLabel: 'Sales Manager',
        status: 'active',
        createdAt: '2020-01-01',
        aaNumber: 'AAI20010001',
        detailAuthorized: true,
      });
      const source = readWorkbookParts(
        readFileSync(
          new URL(
            `../../packages/contracts/assets/member-${kind.toLowerCase()}-template-v2.xlsx`,
            import.meta.url,
          ),
        ),
      );
      const rendered = readWorkbookParts(
        companyMemberWorkbook(kind, [
          member,
          {
            ...member,
            id: '22222222-2222-4222-8222-222222222222',
            fullName: 'INACTIVE HEAD',
            status: 'inactive',
          },
        ]),
      );
      const teamsPath = `xl/worksheets/sheet${kind === 'IST' ? 5 : 6}.xml`;
      expect([...rendered.keys()]).toEqual([...source.keys()]);
      for (const [path, bytes] of source)
        if (path !== teamsPath)
          expect(Buffer.from(rendered.get(path)!).equals(Buffer.from(bytes)), path).toBe(true);
      const teams = readWorkbook(rendered, ['Teams'], false, { Teams: [1, 2, 3] }).get('Teams')!;
      expect(teams[0]).toHaveLength(3);
      expect(teams[kind === 'IST' ? 501 : 1]?.[2]).toBe('Synthetic Manager [AAI20010001]');
      expect(new TextDecoder().decode(rendered.get(teamsPath))).not.toContain('INACTIVE HEAD');
      const helperPath = `xl/worksheets/sheet${kind === 'IST' ? 6 : 13}.xml`;
      const helper = new TextDecoder().decode(rendered.get(helperPath));
      expect(helper).toContain('r="D501"');
      expect(helper).toContain('COUNTIF(Identity!$A$2:$A$501');
      expect(helper).toContain('RIGHT(Identity!$A2,4)&lt;&gt;"0000"');
    });
    it(`${kind} rejects malformed identifiers and mobiles through the shared preview`, async () => {
      const members = ['vice_director', 'senior_sales_manager', 'sales_manager'].map(
        (position, i) =>
          memberSchema.parse({
            ...Object.fromEntries(Object.keys(memberSchema.shape).map((k) => [k, null])),
            id: `${i + 1}1111111-1111-4111-8111-111111111111`,
            fullName: `SYNTHETIC ${['VD', 'SSM', 'SM'][i]}`,
            email: `head${i}@example.invalid`,
            position,
            positionLabel: 'Synthetic head',
            status: 'active',
            createdAt: '2020-01-01',
            referrerStaffId: i ? `${i}1111111-1111-4111-8111-111111111111` : null,
            detailAuthorized: true,
          }),
      );
      const prefix = kind === 'IST' ? 'AAI' : 'AAO';
      const preview = (override: Record<string, string>) =>
        previewMemberWorkbook(
          filled(
            kind,
            1,
            (s) => s,
            () => ({
              ...(kind === 'OST'
                ? {
                    head_member: 'SYNTHETIC SM',
                    head_role: 'Sales Manager',
                    program_category: 'non_vip',
                    applicant_signature: 'received',
                    referrer_signature: 'received',
                    applicant_signed_on: '2024-02-29',
                    referrer_signed_on: '2024-02-29',
                  }
                : {}),
              ...override,
            }),
          ),
          kind,
          members,
          department,
          provider,
          async () => [],
        );
      for (const aa_number of [`${prefix}20010001`, 'AA-A1B2C3D4E5F6'])
        expect((await preview({ aa_number })).rows[0]!.errors).toEqual([]);
      for (const aa_number of [
        `${prefix}20130001`,
        `${prefix}20000001`,
        `${prefix}20010000`,
        `${prefix}200100001`,
        kind === 'IST' ? 'AAO20010001' : 'AAI20010001',
        'AA-ABCDEFGHIJKL',
      ])
        expect(
          (await preview({ aa_number })).rows[0]!.errors.some((e) => e.startsWith('aa_number:')),
        ).toBe(true);
      for (const mobile of [
        '0912345678x',
        '0912345678',
        '091234567890',
        '09123 456789',
        '9123456789',
      ])
        expect(
          (await preview({ mobile })).rows[0]!.errors.some((e) => e.startsWith('mobile:')),
        ).toBe(true);
      const valid = (await preview({ aa_number: `${prefix}20010001` })).rows[0]!;
      expect(valid.fields.display_name).toBe('Test Seller');
      expect(valid.fields.canonical_name).toBe('TEST SELLER');
      expect(valid.fields.canonical_mobile).toBe('+639123456789');
      expect(valid.fields.expires_on).toBe(kind === 'OST' ? '2025-02-28' : undefined);
      // This matrix parses full geography workbooks repeatedly, including under suite load.
    }, 30_000);
  }
  it('accepts all 500 prepared rows, not 501', () => {
    expect(readMemberWorkbook(filled('IST', 500), 'IST')).toHaveLength(500);
    expect(() =>
      readMemberWorkbook(
        filled('IST', 1, (s, name) =>
          name === 'Identity'
            ? s.replace(
                '</sheetData>',
                '<row r="502"><c r="B502" t="inlineStr"><is><t>Synthetic</t></is></c></row></sheetData>',
              )
            : s,
        ),
        'IST',
      ),
    ).toThrow('Maximum 500');
    const exported = companyMemberWorkbook(
      'IST',
      [],
      Array.from({ length: 500 }, (_, i) => ({
        first_name: 'Synthetic',
        last_name: 'Seller',
        email: `export${i}@example.invalid`,
        position: 'Vice Director',
        mobile: '09123456789',
      })),
    );
    expect(readMemberWorkbook(exported, 'IST')).toHaveLength(500);
    expect(
      readMemberWorkbook(
        filled('IST', 1, (s, name) =>
          name === 'Identity'
            ? s.replace('</sheetData>', '<row r="900"><c r="B900" s="1"/></row></sheetData>')
            : s,
        ),
        'IST',
      ),
    ).toHaveLength(1);
  });
  it('rejects wrong kind and independently sorted applicant formulas', () => {
    expect(() => readMemberWorkbook(filled('IST'), 'OST')).toThrow('select IST');
    expect(() =>
      readMemberWorkbook(
        filled('IST', 1, (s, name) =>
          name === 'Team' ? s.replaceAll('Identity!B2', 'Identity!B3') : s,
        ),
      ),
    ).toThrow('alignment');
  });
  it('retains the formula expiry only as an untrusted validation candidate', () => {
    const rows = readMemberWorkbook(
      filled('OST', 1, (s, name) =>
        name === 'Accreditation'
          ? s.replace(/(<c\b[^>]*r="C2"[^>]*>)([\s\S]*?)(<\/c>)/, '$1$2<v>45351</v>$3')
          : s,
      ),
    );
    expect(rows[0]!.fields.expires_on).toBeTruthy();
  });
  it('resolves a first-time VD → SSM → SM workbook before any persistence', async () => {
    const bytes = filled(
      'IST',
      3,
      (s) => s,
      (n) => ({
        first_name: ['Synthetic', 'Example', 'Sample'][n - 2]!,
        position: ['Vice Director', 'Senior Sales Manager', 'Sales Manager'][n - 2]!,
        mobile: `0912345678${n - 2}`,
        head_member: ['', 'Synthetic Seller', 'Example Seller'][n - 2]!,
      }),
    );
    const preview = await previewMemberWorkbook(
      bytes,
      'IST',
      [],
      department,
      provider,
      async () => [],
    );
    expect(preview.rows.map((r) => r.errors)).toEqual([[], [], []]);
    expect(preview.rows[1]!.fields.head_staff_id).toBe(preview.rows[0]!.fields.planned_staff_id);
    expect(preview.rows[2]!.fields.head_staff_id).toBe(preview.rows[1]!.fields.planned_staff_id);
    expect(preview.rows[0]!.fields.starts_on).toBeUndefined();
  });
  it('recognizes 09 and +63 mobiles as duplicates and presents both locally', async () => {
    const preview = await previewMemberWorkbook(
      filled(
        'IST',
        2,
        (s) => s,
        (n) => ({ mobile: n === 2 ? '09123456789' : '+639123456789' }),
      ),
      'IST',
      [],
      department,
      provider,
      async () => [],
    );
    expect(
      preview.rows.every((r) => r.errors.some((e) => e.startsWith('mobile: duplicated'))),
    ).toBe(true);
    expect(preview.rows.map((r) => r.fields.mobile)).toEqual(['09123456789', '09123456789']);
  });
  it('round-trips an IST export to its same identity without requiring omitted ID/TIN', async () => {
    const member = memberSchema.parse({
      ...Object.fromEntries(Object.keys(memberSchema.shape).map((k) => [k, null])),
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'SYNTHETIC EMPLOYEE',
      email: 'synthetic@example.invalid',
      position: 'vice_director',
      positionLabel: 'Vice Director',
      status: 'active',
      createdAt: '2020-01-01',
      aaNumber: 'AAI20010001',
      mobileNo: '+639123456789',
      dateOfBirth: '1990-01-01',
      sex: 'Male',
      civilStatus: 'Single',
      province: 'Laguna',
      cityMunicipality: 'Calauan',
      streetNo: 'One Street, Dayap',
      zipCode: '4012',
      employerName: 'Synthetic',
      employerAddress: 'Calauan',
      jobPosition: 'Seller',
      governmentIdType: 'passport',
      detailAuthorized: true,
    });
    const db = {
      rpc: async () => ({
        error: null,
        data: [
          {
            id: member.id,
            fields: {
              first_name: 'SYNTHETIC',
              last_name: 'EMPLOYEE',
              barangay: 'Dayap',
              address_line_1: 'One Street',
            },
            history: [],
          },
        ],
      }),
    };
    const bytes = await exportMemberWorkbook(db, department, 'IST', [member]);
    const rows = readMemberWorkbook(bytes, 'IST');
    expect(rows[0]!.fields).toMatchObject({
      first_name: 'Synthetic',
      last_name: 'Employee',
      mobile: '09123456789',
      aa_number: 'AAI20010001',
      government_id_number: '',
      tin: '',
    });
    const preview = await previewMemberWorkbook(
      bytes,
      'IST',
      [member],
      department,
      provider,
      async () => [],
    );
    expect(preview.rows[0]!.errors).toEqual([]);
    expect(preview.rows[0]!.fields.planned_staff_id).toBe(member.id);
    expect(member.fullName).toBe('SYNTHETIC EMPLOYEE');
  });
});
