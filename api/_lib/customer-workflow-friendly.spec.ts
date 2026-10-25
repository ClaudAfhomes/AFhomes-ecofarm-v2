import { expect, it } from 'vitest';
import { WORKFLOW_COLUMNS, WORKFLOW_MAPPING_VERSION } from '@afhomes/contracts';
import { customerWorkflowTemplate } from './customer-workflow-export.js';
import { parseCustomerWorkbookV2 } from './customer-workbook-v2.js';
import { readWorkbookParts } from './customer-xlsx.js';

it('downloads a clean, protected beginner template with no duplicate duration or manual totals', () => {
  expect(WORKFLOW_MAPPING_VERSION).toBe('7');
  for (const key of [
    'age',
    'payment_term_months',
    'stated_total',
    'claimed_payment_total',
    'claimed_balance',
  ])
    expect(WORKFLOW_COLUMNS.Customers.some((c) => c.key === key)).toBe(false);
  const parts = readWorkbookParts(customerWorkflowTemplate());
  const customers = new TextDecoder().decode(parts.get('xl/worksheets/sheet2.xml'));
  expect(customers).toContain('sheetProtection');
  expect(customers).toContain('dataValidations');
  expect(customers).toContain('Review status');
  const candidate = /<c\b[^>]*r="C2"[^>]*s="(\d+)"[^>]*>([\s\S]*?)<\/c>/.exec(customers)!;
  expect(candidate[2]).toContain('ROW()-1');
  const style = new TextDecoder().decode(parts.get('xl/styles.xml'));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(style)![1]!;
  const entries = [...xfs.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)];
  expect(entries[Number(candidate[1])]![0]).toContain('locked="0"');
  expect(parseCustomerWorkbookV2(customerWorkflowTemplate())?.rows).toEqual([]);
});
