import { expect, it } from 'vitest';
import { importedSalesQuerySchema, importedSalesListSchema } from './imported-sales.js';
it('validates account views, bounded pages and chronological date filters', () => {
  expect(importedSalesQuerySchema.parse({})).toEqual({ view: 'my-sales', page: 1 });
  for (const invalid of [
    { view: 'all-sales' },
    { page: 0 },
    { page: 10001 },
    { from: '2026-10-24', to: '2026-10-23' },
  ])
    expect(importedSalesQuerySchema.safeParse(invalid).success).toBe(false);
});
it('keeps commission cutover separate from sales amounts', () => {
  const record = {
    id: '33333333-3333-4333-8333-333333333333',
    reference: '26011500841G1C01S',
    customerName: null,
    customerNumber: '2025-0786',
    tier: 'GOLD',
    status: 'active',
    roles: ['Referrer'],
    amount: '312000.00',
    commissionPolicy: 'settled_before_system',
  };
  const response = { data: [record], meta: { page: 1, pageSize: 25, total: 1 } };
  expect(importedSalesListSchema.parse(response)).toEqual(response);
  expect(
    importedSalesListSchema.parse({ ...response, data: [{ ...record, amount: null }] }).data[0]!
      .amount,
  ).toBeNull();
  expect(
    importedSalesListSchema.safeParse({
      ...response,
      data: [{ ...record, commissionPolicy: 'earned' }],
    }).success,
  ).toBe(false);
});
