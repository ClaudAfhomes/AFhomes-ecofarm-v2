import { describe, expect, it } from 'vitest';
import { policyDraftInputSchema } from './payroll.js';

const draft = {
  rank: 'SM',
  monthlyBa: '15000.00',
  baTarget: '200000.00',
  monthlyPa: '15000.00',
  paTarget: '1000000.00',
  pbTarget: '2000000.00',
  pbRate: '0.0100',
  collectionGate: '0.4000',
  effectiveFrom: '2027-01-01',
  basisNote: 'Synthetic reference draft only',
};
describe('compensation draft contract matches the governed RPC', () => {
  it('accepts exact fractions and future effective windows', () => {
    expect(
      policyDraftInputSchema.safeParse({ ...draft, effectiveUntil: '2027-06-30' }).success,
    ).toBe(true);
    expect(
      policyDraftInputSchema.safeParse({ ...draft, pbRate: '1.0000', collectionGate: '1.0000' })
        .success,
    ).toBe(true);
  });
  it.each([
    { monthlyBa: '-1' },
    { monthlyBa: '1,000' },
    { monthlyBa: '001' },
    { monthlyBa: '1000000000000000' },
    { pbRate: '1.0001' },
    { pbRate: '1.5' },
    { pbRate: '0.00001' },
    { collectionGate: '0' },
    { collectionGate: '0.0000' },
    { collectionGate: '40' },
    { effectiveUntil: '2026-12-31' },
    { effectiveFrom: '2027-02-30' },
    { rank: 'OST' },
    { approvedBy: 'injected' },
  ])('refuses invalid draft %j', (invalid) =>
    expect(policyDraftInputSchema.safeParse({ ...draft, ...invalid }).success).toBe(false),
  );
});
