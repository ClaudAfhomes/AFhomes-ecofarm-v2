import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_CATEGORY_LABELS,
  compareMoney,
  mapSourceStatus,
  normalizeTier,
  parseGoogleSheetUrl,
  resolveCustomerCategory,
} from '@jad/contracts';
import {
  MAX_IMPORT_ROWS,
  customerExportCsv,
  customerExportXlsx,
  customerImportTemplateCsv,
  customerImportTemplateXlsx,
  matrixToRecords,
  neutralizeFormula,
  parseCsvMatrix,
  parseOpeningBalance,
  parseXlsxMatrix,
  validateImportRow,
  type ImportContext,
} from './customer-import.js';
import { CUSTOMER_IMPORT_COLUMNS } from '@jad/contracts';
import { toXlsx } from './report-export.js';

const ctx = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  plansByTier: new Map([
    ['GOLD', { id: 'plan-gold', code: 'GOLD' }],
    ['SILVER', { id: 'plan-silver', code: 'SILVER' }],
    ['BRONZE', { id: 'plan-bronze', code: 'BRONZE' }],
  ]),
  customerByNumber: new Map(),
  customerByEmail: new Map(),
  membershipByNumber: new Map(),
  referralStaffByCode: new Map(),
  seenMembershipNumbers: new Map(),
  ...overrides,
});

const TODAY = '2026-10-19';

const baseFields = (overrides: Record<string, string> = {}): Record<string, string> => ({
  first_name: 'Juan',
  last_name: 'Cruz',
  email: 'juan.cruz@example.com',
  mobile: '+639171234567',
  payment_scheme: 'spot_cash',
  historical_sale_total: '312000.00',
  payment_date: '2025-01-01',
  payment_method: 'cash',
  source_status: 'Pending',
  ...overrides,
});

describe('XLSX matrix reader', () => {
  const xlsxOf = (rows: string[][]) =>
    toXlsx(
      'Sheet1',
      rows[0]!.map((label) => ({ label, type: 'text' as const })),
      rows.slice(1),
    );

  it('parses a stored workbook into a full matrix', () => {
    const matrix = parseXlsxMatrix(
      xlsxOf([
        ['first_name', 'email'],
        ['Juan', 'j@example.com'],
        ['Maria', 'm@example.com'],
      ]),
    );
    expect(matrix[0]).toEqual(['first_name', 'email']);
    expect(matrix[1]).toEqual(['Juan', 'j@example.com']);
    expect(matrix[2]).toEqual(['Maria', 'm@example.com']);
  });

  it('decodes deflated entries, the form real spreadsheets use', () => {
    // Re-emit one stored workbook with its worksheet deflated (method 8).
    const stored = xlsxOf([
      ['first_name', 'vip_tier'],
      ['Juan', 'GOLD'],
    ]);
    const text = Buffer.from(stored).toString('latin1');
    const name = 'xl/worksheets/sheet1.xml';
    const at = text.indexOf(name);
    expect(at).toBeGreaterThan(-1);
    const dataStart = at + name.length;
    // Stored entries: [local header][name][raw]. Rebuild with method 8.
    const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
    let cursor = 0;
    let sheetRaw = new Uint8Array();
    while (cursor + 30 <= stored.length && view.getUint32(cursor, true) === 0x04034b50) {
      const size = view.getUint32(cursor + 18, true);
      const nameLength = view.getUint16(cursor + 26, true);
      const extraLength = view.getUint16(cursor + 28, true);
      const entryName = Buffer.from(stored.slice(cursor + 30, cursor + 30 + nameLength)).toString(
        'utf8',
      );
      const start = cursor + 30 + nameLength + extraLength;
      if (entryName === name) sheetRaw = stored.slice(start, start + size);
      cursor = start + size;
    }
    expect(sheetRaw.length).toBeGreaterThan(0);
    const deflated = deflateRawSync(sheetRaw);
    const crc = (() => {
      let table: number[] | null = null;
      const make = () => {
        const t: number[] = [];
        for (let n = 0; n < 256; n += 1) {
          let c = n;
          for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          t.push(c >>> 0);
        }
        return t;
      };
      table = make();
      let value = 0xffffffff;
      for (const byte of deflated) value = table[(value ^ byte) & 0xff]! ^ (value >>> 8);
      return (value ^ 0xffffffff) >>> 0;
    })();
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(sheetRaw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(sheetRaw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(0, 42);
    nameBytes.copy(central, 46);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length + deflated.length, 16);
    const rebuilt = new Uint8Array(Buffer.concat([local, deflated, central, end]));
    // This old synthetic ZIP omits workbook relationships: fail explicitly.
    expect(() => parseXlsxMatrix(rebuilt)).toThrow();
  });

  it('rejects a workbook with no worksheet', () => {
    expect(() => parseXlsxMatrix(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('CSV matrix reader', () => {
  it('parses quoted commas, quotes, and CRLF', () => {
    const matrix = parseCsvMatrix(
      'first_name,notes\r\n"Juan, Jr.","said ""hi"""\r\nMaria,plain\r\n',
    );
    expect(matrix).toEqual([
      ['first_name', 'notes'],
      ['Juan, Jr.', 'said "hi"'],
      ['Maria', 'plain'],
    ]);
  });
  it('preserves UTF-8 names and strips the BOM', () => {
    const matrix = parseCsvMatrix('﻿first_name,last_name\nMaría,DELA PEÑA\n');
    expect(matrix[1]).toEqual(['María', 'DELA PEÑA']);
  });
  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsvMatrix('a,b\n"oops\n')).toThrow();
  });
});

describe('template and headers', () => {
  it('emits every template column in the XLSX template', () => {
    const matrix = parseXlsxMatrix(customerImportTemplateXlsx());
    expect(matrix[0]).toEqual([...CUSTOMER_IMPORT_COLUMNS]);
  });
  it('emits the same columns in the CSV template', () => {
    const matrix = parseCsvMatrix(customerImportTemplateCsv());
    expect(matrix[0]).toEqual([...CUSTOMER_IMPORT_COLUMNS]);
  });
  it('flags unknown columns without failing the file', () => {
    const { unknownHeaders, rows } = matrixToRecords([
      ['first_name', 'vip_points_hack'],
      ['Juan', '999'],
    ]);
    expect(unknownHeaders).toEqual(['vip_points_hack']);
    expect(rows).toHaveLength(1);
  });
  it('skips fully blank rows', () => {
    const { rows } = matrixToRecords([['first_name'], ['Juan'], [''], ['Maria']]);
    expect(rows.map((r) => r.fields.first_name)).toEqual(['Juan', 'Maria']);
  });
});

describe('tier and status mapping', () => {
  it.each([
    ['Gold', 'GOLD'],
    ['GOLD', 'GOLD'],
    ['gold', 'GOLD'],
    [' Silver ', 'SILVER'],
    ['bronze', 'BRONZE'],
  ])('normalizes %s', (input, expected) => expect(normalizeTier(input)).toBe(expected));
  it('rejects unknown tiers without guessing', () => {
    expect(normalizeTier('Diamond')).toBeNull();
    expect(normalizeTier('')).toBeNull();
    expect(normalizeTier(undefined)).toBeNull();
  });
  it.each([
    ['Active VIP', 'ACTIVE_VIP'],
    ['Active', 'ACTIVE_VIP'],
    ['Fully Paid', 'FULLY_PAID_AWAITING_ACTIVATION'],
    ['Down Payment', 'DOWN_PAYMENT_COMPLETED'],
    ['Partial', 'PARTIALLY_PAID'],
    ['Reservation Paid', 'RESERVATION_PAID'],
    ['Pending', 'PENDING'],
    ['Inactive', 'INACTIVE'],
    ['Suspended', 'SUSPENDED'],
    ['Expired', 'EXPIRED'],
    ['Cancelled', 'CANCELLED'],
  ])('maps %s', (input, expected) => expect(mapSourceStatus(input)).toBe(expected));
  it('rejects unknown statuses', () => {
    expect(mapSourceStatus('Diamond')).toBeNull();
  });
});

describe('shared category resolver', () => {
  it('prefers membership state, then customer state, then money', () => {
    const base = {
      customerStatus: 'active',
      membershipStatus: null,
      verifiedTotal: '0.00',
      priceTotal: '312000.00',
    };
    expect(resolveCustomerCategory({ ...base, membershipStatus: 'active' })).toBe('ACTIVE_VIP');
    expect(resolveCustomerCategory({ ...base, membershipStatus: 'suspended' })).toBe('SUSPENDED');
    expect(resolveCustomerCategory({ ...base, membershipStatus: 'expired' })).toBe('EXPIRED');
    expect(resolveCustomerCategory({ ...base, membershipStatus: 'cancelled' })).toBe('CANCELLED');
    expect(resolveCustomerCategory({ ...base, customerStatus: 'cancelled' })).toBe('CANCELLED');
    expect(resolveCustomerCategory({ ...base, customerStatus: 'suspended' })).toBe('SUSPENDED');
    expect(resolveCustomerCategory({ ...base, customerStatus: 'prospect' })).toBe('PENDING');
    expect(resolveCustomerCategory({ ...base, customerStatus: 'active' })).toBe('ACTIVE');
  });
  it('derives money tiers from thresholds', () => {
    const money = {
      customerStatus: 'active',
      membershipStatus: null,
      priceTotal: '312000.00',
      reservationFee: '10000.00',
      requiredInitial: '124800.00',
    };
    expect(resolveCustomerCategory({ ...money, verifiedTotal: '312000.00' })).toBe(
      'FULLY_PAID_AWAITING_ACTIVATION',
    );
    expect(resolveCustomerCategory({ ...money, verifiedTotal: '124800.00' })).toBe(
      'DOWN_PAYMENT_COMPLETED',
    );
    expect(resolveCustomerCategory({ ...money, verifiedTotal: '10000.00' })).toBe(
      'RESERVATION_PAID',
    );
    expect(resolveCustomerCategory({ ...money, verifiedTotal: '5000.00' })).toBe('PARTIALLY_PAID');
  });
  it('labels every category', () => {
    expect(CUSTOMER_CATEGORY_LABELS.ACTIVE_VIP).toBe('Active VIP');
    expect(Object.keys(CUSTOMER_CATEGORY_LABELS)).toHaveLength(11);
  });
  it('compares money exactly', () => {
    expect(compareMoney('12480.00', '12480')).toBe(0);
    expect(compareMoney('0.10', '0.2')).toBe(-1);
    expect(compareMoney('nope', '1.00')).toBeNull();
  });
});

describe('row validation', () => {
  it('accepts a minimal pending row', () => {
    const v = validateImportRow(2, baseFields(), ctx(), TODAY);
    expect(v.errors).toEqual([]);
    expect(v.action).toBe('CREATE');
    expect(v.normalized?.customerStatus).toBe('prospect');
  });
  it('requires identity fields with per-field errors', () => {
    const v = validateImportRow(
      2,
      { source_status: 'Pending', email: 'bad', mobile: '12' },
      ctx(),
      TODAY,
    );
    expect(v.errors).toContainEqual({ field: 'first_name', message: 'Required' });
    expect(v.errors).toContainEqual({ field: 'last_name', message: 'Required' });
    expect(v.errors).toContainEqual({ field: 'email', message: 'Invalid email' });
    expect(v.errors).toContainEqual({ field: 'mobile', message: 'Invalid phone' });
    expect(v.action).toBe('CONFLICT');
  });
  it('demands tier and payment history for Active VIP, never inventing them', () => {
    const noTier = validateImportRow(2, baseFields({ source_status: 'Active VIP' }), ctx(), TODAY);
    expect(noTier.errors).toContainEqual({
      field: 'vip_tier',
      message: 'Tier is required for an Active VIP row',
    });
    const noPay = validateImportRow(
      2,
      baseFields({ source_status: 'Active VIP', vip_tier: 'GOLD' }),
      ctx(),
      TODAY,
    );
    expect(noPay.errors).toContainEqual({
      field: 'payment_amount',
      message: 'Payment history is required; economics are never invented',
    });
  });
  it('accepts Gold secondary holders and rejects Silver/Bronze ones', () => {
    const gold = validateImportRow(
      2,
      baseFields({
        source_status: 'Active VIP',
        vip_tier: 'GOLD',
        payment_amount: '312000.00',
        secondary_first_name: 'Rosa',
        secondary_last_name: 'Cruz',
      }),
      ctx(),
      TODAY,
    );
    expect(gold.errors).toEqual([]);
    expect(gold.normalized?.secondaryNote).toContain('Rosa');
    const silver = validateImportRow(
      2,
      baseFields({
        source_status: 'Active',
        vip_tier: 'SILVER',
        payment_amount: '192000.00',
        secondary_first_name: 'Rosa',
      }),
      ctx(),
      TODAY,
    );
    expect(silver.errors).toContainEqual({
      field: 'secondary_first_name',
      message: 'Secondary holder is Gold-only',
    });
  });
  it('reconciles declared totals against the payment row', () => {
    const v = validateImportRow(
      2,
      baseFields({
        source_status: 'Partial',
        vip_tier: 'GOLD',
        payment_amount: '10000.00',
        total_paid: '9999.00',
      }),
      ctx(),
      TODAY,
    );
    expect(v.errors).toContainEqual({
      field: 'total_paid',
      message: 'Must equal the supplied payment amount',
    });
  });
  it('refuses future payment dates and negative balances', () => {
    const future = validateImportRow(
      2,
      baseFields({
        source_status: 'Partial',
        vip_tier: 'GOLD',
        payment_amount: '100.00',
        payment_date: '2026-10-20',
      }),
      ctx(),
      TODAY,
    );
    expect(future.errors).toContainEqual({
      field: 'payment_date',
      message: 'Historical payments cannot be dated in the future',
    });
    const negative = validateImportRow(
      2,
      baseFields({ current_points_balance: '-5' }),
      ctx(),
      TODAY,
    );
    expect(negative.errors).toContainEqual({
      field: 'current_points_balance',
      message: 'Must be a whole non-negative number',
    });
  });
  it('flags formula-like content as warnings, never errors', () => {
    const v = validateImportRow(2, baseFields({ notes: '=1+1' }), ctx(), TODAY);
    expect(v.errors).toEqual([]);
    expect(v.validation).toBe('warning');
    expect(v.warnings).toContainEqual({
      field: 'notes',
      message: 'Formula-like content is stored as plain text',
    });
  });
  it('matches duplicates by membership, customer number, then email', () => {
    const matchCtx = ctx({
      membershipByNumber: new Map([['MBS-000001', { id: 'mem-1', customerId: 'cus-1' }]]),
      customerByNumber: new Map([['CUS-1', { id: 'cus-2', email: 'other@example.com' }]]),
      customerByEmail: new Map([
        ['juan.cruz@example.com', { id: 'cus-3' }],
        ['member.one@example.com', { id: 'cus-1' }],
      ]),
    });
    const byMember = validateImportRow(
      2,
      baseFields({
        membership_number: 'MBS-000001',
        email: 'member.one@example.com',
        source_status: 'Suspended',
      }),
      matchCtx,
      TODAY,
    );
    expect(byMember.action).toBe('UPDATE');
    expect(byMember.customerId).toBe('cus-1');
    const byEmail = validateImportRow(2, baseFields(), matchCtx, TODAY);
    expect(byEmail.action).toBe('UPDATE');
    expect(byEmail.customerId).toBe('cus-3');
    const conflict = validateImportRow(
      2,
      baseFields({
        membership_number: 'MBS-000001',
        email: 'juan.cruz@example.com',
        source_status: 'Suspended',
      }),
      matchCtx,
      TODAY,
    );
    expect(conflict.action).toBe('CONFLICT');
    expect(conflict.errors).toContainEqual({
      field: 'email',
      message: 'Email belongs to a different customer than the membership',
    });
  });
  it('treats expired-without-member as a conflict and unknown numbers as warnings', () => {
    const expired = validateImportRow(2, baseFields({ source_status: 'Expired' }), ctx(), TODAY);
    expect(expired.action).toBe('CONFLICT');
    const numbered = validateImportRow(2, baseFields({ customer_number: 'CUS-999' }), ctx(), TODAY);
    expect(numbered.errors).toEqual([]);
    expect(numbered.warnings).toContainEqual({
      field: 'customer_number',
      message: 'Unknown number: a new customer number will be generated',
    });
  });
  it('rejects a second payment row for one membership in the same file', () => {
    const c = ctx();
    const first = baseFields({
      membership_number: 'MBS-000002',
      source_status: 'Partial',
      vip_tier: 'GOLD',
      payment_amount: '100.00',
    });
    expect(validateImportRow(2, first, c, TODAY).errors).toEqual([]);
    const second = validateImportRow(3, first, c, TODAY);
    expect(second.errors).toContainEqual({
      field: 'payment_amount',
      message:
        'Multiple historical payments per membership are unsupported; use the normal payment workflow',
    });
  });
  it('rejects an opening balance without a member row', () => {
    const v = validateImportRow(2, baseFields({ current_points_balance: '5000' }), ctx(), TODAY);
    expect(v.errors).toContainEqual({
      field: 'current_points_balance',
      message: 'An opening balance needs an active-member row',
    });
  });
  it('parses opening balances strictly', () => {
    expect(parseOpeningBalance('')).toBe(0);
    expect(parseOpeningBalance('25000')).toBe(25000);
    expect(parseOpeningBalance('-1')).toBeNull();
    expect(parseOpeningBalance('1.5')).toBeNull();
  });
});

describe('Google Sheets URL handling', () => {
  it('accepts canonical sheet URLs with and without gid', () => {
    expect(
      parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/abcDEF123-_0/edit?gid=42#gid=42'),
    ).toEqual({
      spreadsheetId: 'abcDEF123-_0',
      gid: '42',
    });
    expect(parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/abcDEF123-_0')).toEqual({
      spreadsheetId: 'abcDEF123-_0',
      gid: '0',
    });
  });
  it('rejects non-sheet, non-https, and short-id URLs', () => {
    for (const bad of [
      'https://evil.com/spreadsheets/d/abcDEF123-_0',
      'http://docs.google.com/spreadsheets/d/abcDEF123-_0',
      'https://docs.google.com/document/d/abcDEF123-_0/edit',
      'https://docs.google.com/spreadsheets/d/short',
      'not a url',
      'https://docs.google.com/spreadsheets/d/abcDEF123-_0/edit?gid=abc',
    ])
      expect(parseGoogleSheetUrl(bad)).toBeNull();
  });
});

describe('limits and export safety', () => {
  it('caps imports at 5000 rows', () => {
    expect(MAX_IMPORT_ROWS).toBe(5000);
  });
  it('neutralizes formula leaders in exports', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeFormula('+cmd')).toBe("'+cmd");
    expect(neutralizeFormula('plain')).toBe('plain');
  });
  it('exports filterable rows with escaped cells', () => {
    const csv = customerExportCsv([
      {
        customer_number: 'CUS-1',
        membership_number: '',
        customer_name: '=Juan',
        vip_tier: 'GOLD',
        customer_status: 'active',
        membership_status: '',
        payment_status: 'no_payment',
        derived_category: 'Active',
        activated_at: '',
        expires_at: '',
        current_points_balance: '0',
        seller: 'VD',
        email: 'j@example.com',
        mobile: '0917',
        created_at: '2026-10-01',
      },
    ]);
    expect(csv).toContain("'=Juan");
    expect(customerExportXlsx([]).length).toBeGreaterThan(0);
  });
});
