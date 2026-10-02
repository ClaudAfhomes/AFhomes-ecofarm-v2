import { deflateRawSync } from 'node:zlib';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readXlsx, XLSX_LIMITS } from './customer-xlsx.js';
import { fetchGoogleSheetCsv, validateImportRow, type ImportContext } from './customer-import.js';
import { escapeCsvCell } from './report-export.js';
import { resolveCustomerCategory } from '@jad/contracts';
function crc(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const b of bytes) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function workbook(sheet: string, extra: Record<string, string> = {}, method = 8) {
  const parts = {
    'xl/workbook.xml':
      '<workbook xmlns:r="urn:r"><sheets><sheet name="Members" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/members.xml"/></Relationships>',
    'xl/worksheets/members.xml': sheet,
    ...extra,
  };
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(parts)) {
    const name = Buffer.from(path),
      raw = Buffer.from(text),
      data = method === 0 ? raw : deflateRawSync(raw),
      h = Buffer.alloc(30),
      c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc(raw), 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc(raw), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, name, data);
    central.push(c, name);
    offset += h.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
const sheet = (text: string) =>
  '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>' +
  text +
  '</t></is></c></row></sheetData></worksheet>';
describe('bounded workbook structure', () => {
  it('resolves a deflated worksheet named members.xml', () =>
    expect(readXlsx(workbook(sheet('Member')))).toEqual([['Member']]));
  it('rejects a tiny ZIP expanding to a giant XML cell', () => {
    const bytes = workbook(sheet('x'.repeat(9_000_000)));
    expect(bytes.length).toBeLessThan(20000);
    expect(() => readXlsx(bytes)).toThrow(/decompression/);
  });
  it('rejects oversized cell values', () =>
    expect(() => readXlsx(workbook(sheet('x'.repeat(XLSX_LIMITS.text + 1))))).toThrow(
      /text limit/,
    ));
  it('rejects excessive shared strings', () =>
    expect(() =>
      readXlsx(
        workbook(sheet('ok'), {
          'xl/sharedStrings.xml':
            '<sst>' + '<si><t>x</t></si>'.repeat(XLSX_LIMITS.strings + 1) + '</sst>',
        }),
      ),
    ).toThrow(/Shared strings/));
  it('rejects unsupported compression', () =>
    expect(() => readXlsx(workbook(sheet('ok'), {}, 12))).toThrow(/compression/));
  it('rejects malformed XML', () =>
    expect(() => readXlsx(workbook('<worksheet><sheetData></worksheet>'))).toThrow(/Malformed/));
  it('rejects cells without references', () =>
    expect(() =>
      readXlsx(
        workbook('<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>'),
      ),
    ).toThrow(/reference/));
  it('rejects path traversal', () =>
    expect(() => readXlsx(workbook(sheet('ok'), { '../escape.xml': '<x/>' }))).toThrow(/ZIP path/));
  it('rejects excessive columns', () =>
    expect(() =>
      readXlsx(
        workbook(
          '<worksheet><sheetData><row><c r="ZZ1"><v>1</v></c></row></sheetData></worksheet>',
        ),
      ),
    ).toThrow(/column/));
  it('rejects XML doctypes', () =>
    expect(() =>
      readXlsx(workbook('<!DOCTYPE worksheet><worksheet><sheetData/></worksheet>')),
    ).toThrow(/document types/));
});
describe('bounded Google fetching', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('rejects redirects without a follow-up request', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      fetchGoogleSheetCsv('https://docs.google.com/spreadsheets/d/abcdefghij123/edit'),
    ).rejects.toThrow(/redirect/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toBeDefined();
  });
  it('cancels the stream immediately beyond 5MB', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(1_000_001));
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/csv' } })),
    );
    await expect(
      fetchGoogleSheetCsv('https://docs.google.com/spreadsheets/d/abcdefghij123/edit'),
    ).rejects.toThrow(/size limit/);
    expect(cancel).toHaveBeenCalled();
    expect(pulls).toBeLessThanOrEqual(7);
  });
  it('reports private-sheet configuration explicitly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    await expect(
      fetchGoogleSheetCsv('https://docs.google.com/spreadsheets/d/abcdefghij123/edit'),
    ).rejects.toThrow(/OAuth/);
  });
});
it('account denial overrides active membership', () =>
  expect(
    resolveCustomerCategory({
      customerStatus: 'suspended',
      membershipStatus: 'active',
      verifiedTotal: '1.00',
      priceTotal: '1.00',
    }),
  ).toBe('SUSPENDED'));
it('numeric negative values stay numeric while formula-like text is protected', () => {
  expect(escapeCsvCell(-5)).toBe('-5');
  expect(escapeCsvCell('-5')).toBe("'-5");
});
const context: ImportContext = {
  plansByTier: new Map([['GOLD', { id: 'gold', code: 'GOLD' }]]),
  customerByNumber: new Map(),
  customerByEmail: new Map(),
  membershipByNumber: new Map(),
  referralStaffByCode: new Map(),
  seenMembershipNumbers: new Map(),
};
const fields = {
  first_name: 'Import',
  last_name: 'Member',
  email: 'review@example.invalid',
  mobile: '09170000000',
  source_status: 'Active VIP',
  vip_tier: 'GOLD',
  payment_scheme: 'spot_cash',
  historical_sale_total: '12000.00',
  payment_amount: '12000.00',
  payment_date: '2025-01-01',
  payment_method: 'cash',
};
it.each(['payment_date', 'payment_method'])('rejects missing historical %s in preview', (field) => {
  const result = validateImportRow(
    2,
    { ...fields, [field]: '' },
    { ...context, seenMembershipNumbers: new Map() },
    '2026-10-01',
  );
  expect(result.action).toBe('CONFLICT');
  expect(result.errors.some((e) => e.field === field)).toBe(true);
});
it('rejects contradictory membership/customer identifiers in preview', () => {
  const result = validateImportRow(
    2,
    {
      ...fields,
      payment_amount: '',
      source_status: 'Suspended',
      membership_number: 'MBS-000001',
      customer_number: 'CUS-B',
    },
    {
      ...context,
      membershipByNumber: new Map([['MBS-000001', { id: 'member-a', customerId: 'a' }]]),
      customerByNumber: new Map([['CUS-B', { id: 'b', email: 'other@example.invalid' }]]),
    },
    '2026-10-01',
  );
  expect(result.action).toBe('CONFLICT');
  expect(result.errors.some((e) => e.field === 'customer_number')).toBe(true);
});

it('does not classify a scheme reservation threshold as a down payment', () => {
  expect(
    resolveCustomerCategory({
      customerStatus: 'active',
      membershipStatus: null,
      verifiedTotal: '10000.00',
      priceTotal: '12000.00',
      requiredInitial: '10000.00',
      reservationFee: '10000.00',
    }),
  ).toBe('RESERVATION_PAID');
});
it('requires historical scheme snapshots for down-payment imports', () => {
  const result = validateImportRow(
    2,
    { ...fields, source_status: 'Down Payment', payment_scheme: 'move_b1_40_12' },
    { ...context, seenMembershipNumbers: new Map() },
    '2026-10-01',
  );
  expect(result.action).toBe('CONFLICT');
  expect(result.errors.some((e) => e.field === 'payment_scheme')).toBe(true);
});
