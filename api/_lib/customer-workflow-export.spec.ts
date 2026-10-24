import { describe, it, expect } from 'vitest';
import { WORKFLOW_COLUMNS } from '@afhomes/contracts';
import { customerWorkflowTemplate } from './customer-workflow-export.js';
import { parseCustomerWorkbookV2 } from './customer-workbook-v2.js';
import { readWorkbookParts } from './customer-xlsx.js';
describe('workflow template download', () => {
  it('provides registered AA choices and writes untrusted names as literal text', () => {
    const bytes = customerWorkflowTemplate([
      {
        staff_id: 'synthetic',
        full_name: '=HYPERLINK("unsafe")',
        role_slug: 'ost',
        ancestor_ids: [],
        match_count: 1,
        aa_number: 'AAO26100001',
      },
    ]);
    expect(parseCustomerWorkbookV2(bytes)?.rows).toEqual([]);
    const parts = readWorkbookParts(bytes);
    const workbookXml = new TextDecoder().decode(parts.get('xl/workbook.xml'));
    expect(workbookXml.match(/<definedNames(?:\s|>)/g)).toHaveLength(1);
    expect(workbookXml).not.toMatch(/<definedNames\s*\/>/);
    const refs = new TextDecoder().decode(parts.get('xl/worksheets/sheet6.xml'));
    expect(refs).toContain('AAO26100001');
    expect(refs).toContain('<c r="D1" t="inlineStr"><is><t xml:space="preserve">OST</t>');
    expect(refs).toContain(
      '<c r="L1" t="inlineStr"><is><t xml:space="preserve">Contact number</t>',
    );
    expect(refs).toContain('t="inlineStr"');
    expect(refs).not.toContain('<f>=HYPERLINK');
    expect(refs).toContain('Customer link: VIP ID / Customer ID / email');
    const rows = [...refs.matchAll(/<row r="(\d+)"/g)].map(m => m[1]);
    expect(new Set(rows).size).toBe(rows.length);
    expect(new TextDecoder().decode(parts.get('xl/worksheets/sheet4.xml'))).toContain(
      'AFHomesStaff3',
    );
    const team = new TextDecoder().decode(parts.get('xl/worksheets/sheet4.xml'));
    expect(team.indexOf('<dataValidations')).toBeLessThan(team.indexOf('<pageMargins'));
  });
  it('round trips the real blank asset and retains automatic calculations and version metadata', () => {
    const bytes = customerWorkflowTemplate();
    expect(parseCustomerWorkbookV2(bytes)?.rows).toEqual([]);
    const parts = readWorkbookParts(bytes);
    expect(new TextDecoder().decode(parts.get('docProps/custom.xml'))).toContain('company_v2');
    expect(new TextDecoder().decode(parts.get('[Content_Types].xml'))).toContain(
      '/docProps/custom.xml',
    );
    expect(new TextDecoder().decode(parts.get('_rels/.rels'))).toContain('custom-properties');
    expect(new TextDecoder().decode(parts.get('xl/worksheets/sheet2.xml'))).toContain('SUMIF');
    const customers = new TextDecoder().decode(parts.get('xl/worksheets/sheet2.xml'));
    for (const row of customers.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
      const positions = [...row[0].matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].map(match =>
        [...match[1]!].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0),
      );
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
    }
  });
  it('offers dependent addresses, suffix choices, one date per event and optional payment references', () => {
    const parts = readWorkbookParts(customerWorkflowTemplate());
    const decode = (path: string) => new TextDecoder().decode(parts.get(path));
    const customers = decode('xl/worksheets/sheet2.xml');
    expect(customers).toContain('AFHomesProvinces');
    expect(customers).toContain('INDIRECT');
    expect(customers).toContain('Jr.');
    expect(customers).toContain('type="date"');
    expect(customers).toContain('DATEDIF');
    expect(customers).not.toContain('Birth day');
    expect(customers).not.toContain('Birth month');
    expect(customers).not.toContain('Birth year');
    expect(WORKFLOW_COLUMNS.Customers.some((c) => c.key === 'customer_key')).toBe(false);
    expect(WORKFLOW_COLUMNS.Customers.find((c) => c.key === 'landline')!.header).toContain(
      'optional',
    );
    expect(WORKFLOW_COLUMNS.Payments.find((c) => c.key === 'payment_key')!.header).toContain(
      'optional',
    );
    expect(WORKFLOW_COLUMNS.Payments.some((c) => c.disposition === 'helper')).toBe(false);
    expect(decode('xl/worksheets/sheet4.xml')).toContain('VIP Recommender');
    expect(decode('xl/worksheets/sheet4.xml')).toContain('Referrer');
    expect(decode('docProps/custom.xml')).toContain('<vt:lpwstr>6</vt:lpwstr>');
    expect(decode('xl/worksheets/sheet4.xml')).not.toContain('Referrer VD');
    expect(decode('xl/worksheets/sheet4.xml')).not.toContain('Recommender VD');
    expect(decode('xl/tables/table3.xml')).not.toContain('Referrer VD');
    expect(WORKFLOW_COLUMNS['Sales Team']).toHaveLength(8);
  });
});
