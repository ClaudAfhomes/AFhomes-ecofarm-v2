import { describe, expect, it } from 'vitest';

import { bulkCommissionRuleSchema, commissionRosterQuerySchema } from './finance.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('bulkCommissionRuleSchema', () => {
  const valid = { memberIds: [id(1), id(2)], rate: '0.0400', effectiveFrom: '2026-11-05' };

  it('accepts unique members with an exact rate and a start date', () => {
    expect(bulkCommissionRuleSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects empty, duplicate and oversized member lists', () => {
    expect(bulkCommissionRuleSchema.safeParse({ ...valid, memberIds: [] }).success).toBe(false);
    expect(bulkCommissionRuleSchema.safeParse({ ...valid, memberIds: [id(1), id(1)] }).success).toBe(
      false,
    );
    const many = Array.from({ length: 201 }, (_, i) => id(i + 1));
    expect(bulkCommissionRuleSchema.safeParse({ ...valid, memberIds: many }).success).toBe(false);
  });

  it('rejects a float-style or out-of-range rate', () => {
    for (const rate of ['4', '1.5', '0.04999', '-0.1'])
      expect(bulkCommissionRuleSchema.safeParse({ ...valid, rate }).success).toBe(false);
  });
});

describe('commissionRosterQuerySchema', () => {
  it('defaults to every seller, first page', () => {
    expect(commissionRosterQuerySchema.parse({})).toMatchObject({
      sales: 'all',
      needsRate: 'false',
      limit: 50,
      offset: 0,
    });
  });

  it('caps the page size', () => {
    expect(commissionRosterQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
