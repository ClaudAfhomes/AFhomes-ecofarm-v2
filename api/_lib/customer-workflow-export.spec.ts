import { describe, it, expect } from 'vitest';
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
    const refs = new TextDecoder().decode(parts.get('xl/worksheets/sheet6.xml'));
    expect(refs).toContain('AAO26100001');
    expect(refs).toContain('t="inlineStr"');
    expect(refs).not.toContain('<f>');
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
  });
});
