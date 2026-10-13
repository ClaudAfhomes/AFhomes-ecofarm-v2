import { describe, expect, it } from 'vitest';
import { customerPointsEntrySchema } from './customer';

describe('customer points ledger database entry types', () => {
  it.each(['earned', 'annual_reset', 'promotional_bonus', 'cutover_baseline'])(
    'accepts %s from the existing points ledger',
    (entryType) => {
      expect(
        customerPointsEntrySchema.safeParse({
          id: '1',
          entryType,
          amount: 0,
          balanceAfter: 0,
          reason: null,
          occurredAt: '2026-10-11T00:00:00Z',
        }).success,
      ).toBe(true);
    },
  );
  it('still rejects an unknown ledger type', () => {
    expect(
      customerPointsEntrySchema.safeParse({
        id: '1',
        entryType: 'invented_credit',
        amount: 0,
        balanceAfter: 0,
        reason: null,
        occurredAt: '2026-10-11T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
