import { describe, expect, it } from 'vitest';
import { IST_POLICY_REFERENCE, IST_POLICY_TEMPLATES } from './ist-policy-templates.js';
import { calculateIstPayroll } from './ist-payroll.js';

describe('historical IST reference templates', () => {
  it.each([
    ['SM', '15000.00', '200000.00', '1000000.00', '2000000.00', '0.01'],
    ['SSM', '25000.00', '600000.00', '2000000.00', '4000000.00', '0.03'],
    ['SVD', '50000.00', '1800000.00', '5000000.00', '10000000.00', '0.02'],
  ] as const)(
    'preserves documented %s values without financial authority',
    (rank, allowance, ba, pa, pb, rate) => {
      expect(IST_POLICY_TEMPLATES[rank]).toEqual({
        rank,
        version: IST_POLICY_REFERENCE.version,
        monthlyBa: allowance,
        monthlyPa: allowance,
        baTarget: ba,
        paTarget: pa,
        pbTarget: pb,
        pbRate: rate,
        collectionGate: '0.40',
      });
      expect(IST_POLICY_TEMPLATES[rank]).not.toHaveProperty('approvedBy');
      expect(IST_POLICY_TEMPLATES[rank]).not.toHaveProperty('effectiveFrom');
    },
  );
  it('is immutable, repeatable and excludes OST', () => {
    expect(Object.keys(IST_POLICY_TEMPLATES)).toEqual(['SM', 'SSM', 'SVD']);
    const draft = { ...IST_POLICY_TEMPLATES.SM };
    draft.monthlyBa = '18000.00';
    expect(IST_POLICY_TEMPLATES.SM.monthlyBa).toBe('15000.00');
    expect(Object.isFrozen(IST_POLICY_TEMPLATES.SM)).toBe(true);
    expect(Object.isFrozen(IST_POLICY_TEMPLATES)).toBe(true);
  });
  it('calculates an edited test policy independently without rewriting its reference', () => {
    const input = {
      month: '2027-07',
      rank: 'SM',
      contractStart: '2027-01-01',
      qp: { kpi: '0.00', collection: '0.00' },
      ep: { kpi: '5000000.00', collection: '1000000.00' },
      qpBaApproved: null,
    };
    const historical = calculateIstPayroll({ ...input, policy: IST_POLICY_TEMPLATES.SM });
    const future = calculateIstPayroll({
      ...input,
      policy: {
        ...IST_POLICY_TEMPLATES.SM,
        version: 'TEST ONLY v2',
        monthlyBa: '18000.00',
        monthlyPa: '20000.00',
        pbRate: '0.0150',
      },
    });
    expect([historical.ba, historical.pa, historical.pb, historical.net]).toEqual([
      '15000.00',
      '15000.00',
      '25000.00',
      '55000.00',
    ]);
    expect([future.ba, future.pa, future.pb, future.net]).toEqual([
      '18000.00',
      '20000.00',
      '37500.00',
      '75500.00',
    ]);
    expect(future.ep.equivalentTcp).toBe('2500000.00');
    expect(future.policyVersion).toBe('TEST ONLY v2');
    expect(IST_POLICY_TEMPLATES.SM.monthlyBa).toBe('15000.00');
  });
});
