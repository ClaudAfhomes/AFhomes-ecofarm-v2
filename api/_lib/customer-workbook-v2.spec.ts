import { describe, it, expect } from 'vitest';
import { WORKFLOW_COLUMNS, type WorkflowSheet } from '@afhomes/contracts';
import { zipStored } from './report-export.js';
import { parseCustomerWorkbookV2 } from './customer-workbook-v2.js';

const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const col = (n: number): string =>
  n > 26
    ? col(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26))
    : String.fromCharCode(64 + n);
function book(
  rows: Partial<Record<WorkflowSheet, Record<string, string>[]>> = {},
  extra: Record<string, string> = {},
) {
  const sheets = Object.keys(WORKFLOW_COLUMNS) as WorkflowSheet[];
  const parts: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets>${sheets.map((s, i) => `<sheet name="${s}" r:id="r${i}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((s, i) => `<Relationship Id="r${i}" Type="urn:/worksheet" Target="worksheets/s${i}.xml"/>`).join('')}</Relationships>`,
    'docProps/custom.xml':
      '<Properties><property name="AFHomesTemplate"><v>company_v2</v></property><property name="AFHomesMappingVersion"><v>1</v></property></Properties>',
  };
  sheets.forEach((s, i) => {
    const columns = WORKFLOW_COLUMNS[s];
    const table = [Object.fromEntries(columns.map((c) => [c.key, c.header])), ...(rows[s] ?? [])];
    parts[`xl/worksheets/s${i}.xml`] = `<worksheet><sheetData>${table
      .map(
        (row, r) =>
          `<row r="${r + 1}">${columns
            .map((c, j) => {
              const value = row[c.key] ?? '';
              return `<c r="${col(j + 1)}${r + 1}" t="inlineStr">${value.startsWith('FORMULA:') ? `<f>${escape(value.slice(8))}</f><v>999999</v>` : `<is><t>${escape(value)}</t></is>`}</c>`;
            })
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  });
  return zipStored(
    Object.entries({ ...parts, ...extra }).map(([name, data]) => ({
      name,
      data: new TextEncoder().encode(data),
    })),
  );
}
const customer = (key = 'Person 1', purchase = 'Purchase 1') => ({
  customer_key: key,
  purchase_reference: purchase,
  first_name: 'Synthetic',
  last_name: 'Customer',
  email: 'synthetic@example.invalid',
  mobile: '09123456789',
  vip_tier: 'Gold',
  stated_payment_scheme: 'Move A',
  stated_regular_price: '312000',
  stated_discount: '0',
  stated_rf: '10000',
});
const payment = (key = 'Person 1', claim = 'Receipt 1') => ({
  customer_key: key,
  payment_key: claim,
  purpose: 'Reservation fee',
  amount: '10000',
  date: '2026-10-16',
  method: 'Cash',
  reference: 'Receipt 1',
});

describe('workflow workbook v2', () => {
  it('accepts namespaced Excel custom properties and rejects duplicate version metadata', () => {
    expect(
      parseCustomerWorkbookV2(
        book(
          {},
          {
            'docProps/custom.xml':
              '<c:Properties xmlns:c="urn:custom" xmlns:vt="urn:types"><c:property name="AFHomesTemplate"><vt:lpwstr>company_v2</vt:lpwstr></c:property><c:property name="AFHomesMappingVersion"><vt:lpwstr>1</vt:lpwstr></c:property></c:Properties>',
          },
        ),
      )?.rows,
    ).toEqual([]);
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          {},
          {
            'docProps/custom.xml':
              '<Properties><property name="AFHomesTemplate"><v>company_v2</v></property><property name="AFHomesTemplate"><v>company_v2</v></property></Properties>',
          },
        ),
      ),
    ).toThrow(/Duplicate.*property/i);
  });
  it('resolves friendly staff choices to their AA identity while retaining the expected name', () => {
    const row = parseCustomerWorkbookV2(
      book({
        Customers: [customer()],
        'Sales Team': [{ customer_key: 'Person 1', referrer_name: 'Synthetic OST [AAO26100001]' }],
      }),
    )!.rows[0]!;
    expect(row.fields).toMatchObject({
      referrer_name: 'AAO26100001',
      referrer_expected_name: 'Synthetic OST',
    });
  });
  it('allows internal payment calculations but rejects unknown sheet references', () => {
    expect(
      parseCustomerWorkbookV2(
        book({
          Customers: [
            {
              ...customer(),
              claimed_payment_total:
                "FORMULA:SUMIF('Payments'!$A$2:$A$5001,A2,'Payments'!$D$2:$D$5001)",
            },
          ],
        }),
      )!.rows,
    ).toHaveLength(1);
    expect(() =>
      parseCustomerWorkbookV2(
        book({
          Customers: [
            { ...customer(), claimed_payment_total: "FORMULA:SUMIF('Unapproved'!A2,A2,B2)" },
          ],
        }),
      ),
    ).toThrow(/formula/i);
  });
  it('ignores a blank template and calculated-only customer rows', () => {
    expect(parseCustomerWorkbookV2(book())?.rows).toEqual([]);
    expect(
      parseCustomerWorkbookV2(book({ Customers: [{ age: 'FORMULA:TODAY()' }] }))?.rows,
    ).toEqual([]);
  });
  it('joins independently sorted sheets by customer purchase key', () => {
    const result = parseCustomerWorkbookV2(
      book({
        Customers: [customer('A', 'Sale A'), customer('B', 'Sale B')],
        Payments: [payment('B', 'B1'), payment('A', 'A1')],
        'Sales Team': [
          { customer_key: 'B', referrer_name: 'Second Seller' },
          { customer_key: 'A', referrer_name: 'First Seller' },
        ],
      }),
    )!;
    expect(
      result.rows.map((r) => [r.customerKey, r.payments[0]?.paymentKey, r.fields.referrer_name]),
    ).toEqual([
      ['A', 'A1', 'First Seller'],
      ['B', 'B1', 'Second Seller'],
    ]);
  });
  it('recomputes Gold totals and keeps payments as claims', () => {
    const row = parseCustomerWorkbookV2(
      book({
        Customers: [{ ...customer(), stated_total: 'FORMULA:1+1', claimed_balance: 'FORMULA:1+1' }],
        Payments: [payment()],
      }),
    )!.rows[0]!;
    expect(row.fields).toMatchObject({
      vip_tier: 'GOLD',
      stated_total: '312000.00',
      claimed_payment_total: '10000.00',
      claimed_balance: '302000.00',
      workbook_format: 'company_v2',
      source_status: 'Pending',
    });
    expect(row.payments[0]).toMatchObject({
      amount: '10000.00',
      purpose: 'reservation',
      method: 'cash',
    });
    expect(row.fields).not.toHaveProperty('payment_amount');
  });
  it('supports two separate purchases for one customer without reusing the source', () => {
    const first = { ...customer('A', 'First purchase'), customer_id: 'AF-CUS-ABCDE' };
    const second = { ...customer('B', 'Second purchase'), customer_id: 'AF-CUS-ABCDE' };
    expect(parseCustomerWorkbookV2(book({ Customers: [first, second] }))!.rows).toHaveLength(2);
  });
  it.each([
    [{ Customers: [customer(), customer()] }, 'Duplicate customer key'],
    [{ Customers: [customer()], Payments: [payment('Missing')] }, 'Unknown customer key'],
    [{ Customers: [customer()], Payments: [payment(), payment()] }, 'Duplicate payment claim'],
    [{ Customers: [customer('A', 'Same'), customer('B', 'Same')] }, 'Duplicate purchase reference'],
  ])('rejects ambiguous and orphan source keys', (rows, message) =>
    expect(() => parseCustomerWorkbookV2(book(rows as any))).toThrow(message),
  );
  it('rejects input formulas, external links and unsafe calculated formulas', () => {
    expect(() =>
      parseCustomerWorkbookV2(book({ Customers: [{ ...customer(), first_name: 'FORMULA:1+1' }] })),
    ).toThrow(/Formula/);
    expect(() =>
      parseCustomerWorkbookV2(
        book({
          Customers: [{ ...customer(), age: 'FORMULA:WEBSERVICE("https://example.invalid")' }],
        }),
      ),
    ).toThrow(/formula/i);
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          {},
          {
            'xl/_rels/external.xml.rels':
              '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>',
          },
        ),
      ),
    ).toThrow(/External/);
  });
  it('rejects overpayment and negative or inexact amounts', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book({ Customers: [customer()], Payments: [{ ...payment(), amount: '400000' }] }),
      ),
    ).toThrow(/exceed/);
    for (const amount of ['-1', '10.001', '1e5'])
      expect(() =>
        parseCustomerWorkbookV2(
          book({ Customers: [customer()], Payments: [{ ...payment(), amount }] }),
        ),
      ).toThrow(/amount/i);
  });
  it('uses real date helpers and rejects conflicting dates', () => {
    const row = parseCustomerWorkbookV2(
      book({
        Customers: [{ ...customer(), birth_day: '29', birth_month: '2', birth_year: '2000' }],
      }),
    )!.rows[0]!;
    expect(row.fields.birth_date).toBe('2000-02-29');
    expect(() =>
      parseCustomerWorkbookV2(
        book({
          Customers: [
            {
              ...customer(),
              birth_date: '2000-02-28',
              birth_day: '29',
              birth_month: '2',
              birth_year: '2000',
            },
          ],
        }),
      ),
    ).toThrow(/conflict/i);
  });
  it('accepts a safe date-helper formula without trusting its cache', () => {
    const row = parseCustomerWorkbookV2(
      book({
        Customers: [
          {
            ...customer(),
            birth_date: 'FORMULA:DATE(2000,2,29)',
            birth_day: '29',
            birth_month: '2',
            birth_year: '2000',
          },
        ],
      }),
    )!.rows[0]!;
    expect(row.fields.birth_date).toBe('2000-02-29');
  });
  it('rejects hidden input formulas on reference sheets', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          {},
          {
            'xl/workbook.xml':
              '<workbook xmlns:r="urn:r"><sheets><sheet name="Customers" r:id="r0"/><sheet name="Supplementary Holders" r:id="r1"/><sheet name="Sales Team" r:id="r2"/><sheet name="Payments" r:id="r3"/><sheet name="Reference Lists" r:id="r4"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels':
              '<Relationships>' +
              ['r0', 'r1', 'r2', 'r3', 'r4']
                .map(
                  (id, i) =>
                    `<Relationship Id="${id}" Type="urn:/worksheet" Target="worksheets/s${i}.xml"/>`,
                )
                .join('') +
              '</Relationships>',
            'xl/worksheets/s4.xml':
              '<worksheet><sheetData><row r="1"><c r="A1"><f>WEBSERVICE("https://example.invalid")</f></c></row></sheetData></worksheet>',
          },
        ),
      ),
    ).toThrow(/Formula/);
  });
  it('rejects populated unmapped headers', () => {
    const bytes = book({ Customers: [customer()] });
    // The required header shape is validated independently of protected metadata.
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          {},
          {
            'xl/worksheets/s0.xml':
              '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Unmapped private field</t></is></c></row></sheetData></worksheet>',
          },
        ),
      ),
    ).toThrow(/header/i);
    expect(bytes.length).toBeGreaterThan(0);
  });
  it('rejects workbook with missing or mismatched template version', () => {
    // Empty workbook with v2 sheet names but missing metadata throws (not legacy fallback)
    expect(() =>
      parseCustomerWorkbookV2(book({}, { 'docProps/custom.xml': '<Properties/>' })),
    ).toThrow(/Missing workbook template version/);
    // Wrong template version throws
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          {},
          {
            'docProps/custom.xml':
              '<Properties><property name="AFHomesTemplate"><v>wrong_version</v></property></Properties>',
          },
        ),
      ),
    ).toThrow(/Unsupported workbook template version/);
  });
  it('rejects v2-shaped workbook with missing metadata instead of falling back to legacy parser', () => {
    // A workbook with v2 sheet structure but missing metadata should not be treated as legacy
    const v2Workbook = book(
      {
        Customers: [
          {
            customer_key: 'Person 1',
            purchase_reference: 'PURCHASE-1',
            first_name: 'Test',
            last_name: 'User',
            email: 'test@example.com',
            mobile: '09123456789',
            vip_tier: 'Gold',
            stated_payment_scheme: 'Move A',
            stated_regular_price: '312000',
            stated_discount: '0',
            stated_rf: '10000',
          },
        ],
      },
      { 'docProps/custom.xml': '<Properties/>' },
    );
    // Missing metadata entirely - should throw, not return null
    expect(() => parseCustomerWorkbookV2(v2Workbook)).toThrow(/Missing workbook template version/);
    // Empty AFHomesTemplate property - should throw
    const v2WorkbookEmpty = book(
      {
        Customers: [
          {
            customer_key: 'Person 1',
            purchase_reference: 'PURCHASE-1',
            first_name: 'Test',
            last_name: 'User',
            email: 'test@example.com',
            mobile: '09123456789',
            vip_tier: 'Gold',
            stated_payment_scheme: 'Move A',
            stated_regular_price: '312000',
            stated_discount: '0',
            stated_rf: '10000',
          },
        ],
      },
      {
        'docProps/custom.xml':
          '<Properties><property name="AFHomesTemplate"><v></v></property><property name="AFHomesMappingVersion"><v>1</v></property></Properties>',
      },
    );
    // Empty AFHomesTemplate property - should throw
    expect(() => parseCustomerWorkbookV2(v2WorkbookEmpty)).toThrow(
      /Missing workbook template version/,
    );
  });
  it('rejects v2 workbook with incorrect mapping version', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          { Customers: [{ ...customer(), purchase_reference: 'PURCHASE-1' }] },
          {
            'docProps/custom.xml':
              '<Properties><property name="AFHomesTemplate"><v>company_v2</v></property><property name="AFHomesMappingVersion"><v>999</v></property></Properties>',
          },
        ),
      ),
    ).toThrow(/Unsupported workbook mapping version/);
  });
  it('rejects v2 workbook with missing AFHomesMappingVersion', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          { Customers: [{ ...customer(), purchase_reference: 'PURCHASE-1' }] },
          {
            'docProps/custom.xml':
              '<Properties><property name="AFHomesTemplate"><v>company_v2</v></property></Properties>',
          },
        ),
      ),
    ).toThrow(/Unsupported workbook mapping version/);
  });
  it('rejects v2 workbook with extra sheets not in v2 schema', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          { Customers: [{ ...customer(), purchase_reference: 'PURCHASE-1' }] },
          {
            'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets><sheet name="Customers" r:id="r0"/><sheet name="Supplementary Holders" r:id="r1"/><sheet name="Sales Team" r:id="r2"/><sheet name="Payments" r:id="r3"/><sheet name="Reference Lists" r:id="r4"/><sheet name="Start Here" r:id="r5"/><sheet name="Evil Sheet" r:id="r6"/></sheets></workbook>`,
          },
        ),
      ),
    ).toThrow(/Unknown worksheet/);
  });
  it('rejects v2 workbook with renamed v2 sheet', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          { Customers: [{ ...customer(), purchase_reference: 'PURCHASE-1' }] },
          {
            'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets><sheet name="Customers" r:id="r0"/><sheet name="Supplementary Holders" r:id="r1"/><sheet name="Sales Team" r:id="r2"/><sheet name="Payments" r:id="r3"/><sheet name="Reference Lists" r:id="r4"/><sheet name="Start Here" r:id="r5"/><sheet name="Customers Renamed" r:id="r6"/></sheets></workbook>`,
          },
        ),
      ),
    ).toThrow(/Unknown worksheet/);
  });
  it('rejects v2 workbook with missing required v2 sheet', () => {
    expect(() =>
      parseCustomerWorkbookV2(
        book(
          { Customers: [{ ...customer(), purchase_reference: 'PURCHASE-1' }] },
          {
            'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets><sheet name="Customers" r:id="r0"/><sheet name="Supplementary Holders" r:id="r1"/></sheets></workbook>`,
          },
        ),
      ),
    ).toThrow();
  });
  it('legacy workbook with overlapping sheet names is not classified as v2', () => {
    // Legacy company workbook has sheets like Primary, Supplementary, Related, Package
    // which overlap with v2 names - should fall through to legacy parser (return null)
    const legacySheets = ['Primary', 'Supplementary', 'Related', 'Package'];
    const parts = {
      'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets>${legacySheets.map((s, i) => `<sheet name="${s}" r:id="r${i}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships>${legacySheets.map((s, i) => `<Relationship Id="r${i}" Type="urn:/worksheet" Target="worksheets/s${i}.xml"/>`).join('')}</Relationships>`,
      'docProps/custom.xml': '<Properties/>',
    };
    const sheets = legacySheets;
    const extra: Record<string, string> = {};
    sheets.forEach((s, i) => {
      extra[`xl/worksheets/s${i}.xml`] =
        `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row></sheetData></worksheet>`;
    });
    const legacyWorkbook = zipStored(
      Object.entries({ ...parts, ...extra }).map(([name, data]) => ({
        name,
        data: new TextEncoder().encode(data),
      })),
    );
    // Should return null for legacy parser to handle, not throw
    expect(parseCustomerWorkbookV2(legacyWorkbook)).toBeNull();
  });
  it('v2 workbook with v2 metadata but legacy sheet names is rejected', () => {
    const legacySheets = ['Primary', 'Supplementary', 'Related', 'Package'];
    const parts = {
      'xl/workbook.xml': `<workbook xmlns:r="urn:r"><sheets>${legacySheets.map((s, i) => `<sheet name="${s}" r:id="r${i}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships>${legacySheets.map((s, i) => `<Relationship Id="r${i}" Type="urn:/worksheet" Target="worksheets/s${i}.xml"/>`).join('')}</Relationships>`,
      'docProps/custom.xml':
        '<Properties><property name="AFHomesTemplate"><v>company_v2</v></property><property name="AFHomesMappingVersion"><v>1</v></property></Properties>',
    };
    const sheets = legacySheets;
    const extra: Record<string, string> = {};
    sheets.forEach((s, i) => {
      extra[`xl/worksheets/s${i}.xml`] =
        `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row></sheetData></worksheet>`;
    });
    const mixedWorkbook = zipStored(
      Object.entries({ ...parts, ...extra }).map(([name, data]) => ({
        name,
        data: new TextEncoder().encode(data),
      })),
    );
    // Has v2 metadata but legacy sheets - should throw because sheet structure doesn't match
    expect(() => parseCustomerWorkbookV2(mixedWorkbook)).toThrow(
      /incorrect or unmapped required headers|Unknown worksheet/,
    );
  });
});
