import { describe, expect, it } from 'vitest';

import {
  calculateIstPayroll,
  creditedTotals,
  qualifyingPeriodEnd,
  type IstCompensationPolicy,
  type IstPayrollInput,
} from './ist-payroll.js';

/**
 * REFERENCE FIXTURES ONLY. These amounts, targets and rates come from the
 * historical service contracts and allowance workbook. They are NOT approved
 * current policy and must never be seeded as a payable configuration; they
 * exist so the engine can be checked against the documented worked examples.
 */
const HISTORICAL: Record<'SM' | 'SSM' | 'SVD', IstCompensationPolicy> = {
  SM: {
    version: 'historical-reference',
    rank: 'SM',
    monthlyBa: '15000.00',
    baTarget: '200000.00',
    monthlyPa: '15000.00',
    paTarget: '1000000.00',
    pbTarget: '2000000.00',
    pbRate: '0.01',
    collectionGate: '0.40',
  },
  SSM: {
    version: 'historical-reference',
    rank: 'SSM',
    monthlyBa: '25000.00',
    baTarget: '600000.00',
    monthlyPa: '25000.00',
    paTarget: '2000000.00',
    pbTarget: '4000000.00',
    pbRate: '0.03',
    collectionGate: '0.40',
  },
  SVD: {
    version: 'historical-reference',
    rank: 'SVD',
    monthlyBa: '50000.00',
    baTarget: '1800000.00',
    monthlyPa: '50000.00',
    paTarget: '5000000.00',
    pbTarget: '10000000.00',
    pbRate: '0.02',
    collectionGate: '0.40',
  },
};

const NONE = { kpi: '0.00', collection: '0.00' };

/** A full Extended-Period month for someone engaged long ago. */
const fullEp = (
  rank: 'SM' | 'SSM' | 'SVD',
  kpi: string,
  collection: string,
  extra: Partial<IstPayrollInput> = {},
): IstPayrollInput => ({
  month: '2026-10',
  rank,
  contractStart: '2026-01-01',
  policy: HISTORICAL[rank],
  qp: NONE,
  ep: { kpi, collection },
  qpBaApproved: null,
  ...extra,
});

describe('Qualifying Period dates come from the contract start', () => {
  it('ends one calendar month later, minus one day', () => {
    expect(qualifyingPeriodEnd('2026-07-16')).toBe('2026-08-15');
    expect(qualifyingPeriodEnd('2026-04-01')).toBe('2026-04-30');
    expect(qualifyingPeriodEnd('2026-12-16')).toBe('2027-01-15');
  });

  it('ends on the last day of a shorter following month', () => {
    expect(qualifyingPeriodEnd('2026-01-31')).toBe('2026-02-28');
  });

  it('rejects a date that does not exist', () => {
    expect(() => qualifyingPeriodEnd('2026-02-30')).toThrow();
  });
});

describe('partial months use actual calendar days', () => {
  it('SM starting 16 July: QP BA 7,741.94 with no production test, no PA or PB', () => {
    const r = calculateIstPayroll({
      month: '2026-07',
      rank: 'SM',
      contractStart: '2026-07-16',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: NONE,
      qpBaApproved: true,
    });
    expect(r.status).toBe('CALCULATED');
    expect(r.qp).toMatchObject({ from: '2026-07-16', to: '2026-07-31', days: 16 });
    expect(r.ep.days).toBe(0);
    expect(r.ba).toBe('7741.94');
    expect(r.pa).toBe('0.00');
    expect(r.pb).toBe('0.00');
    expect(r.gross).toBe('7741.94');
  });

  it('SM engaged 16-30 April: QP BA 7,500.00 (15/30)', () => {
    const r = calculateIstPayroll({
      month: '2026-04',
      rank: 'SM',
      contractStart: '2026-04-16',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: NONE,
      qpBaApproved: true,
    });
    expect(r.qp.days).toBe(15);
    expect(r.ba).toBe('7500.00');
  });

  it('transition month: QP 15/31 and EP 16/31 are tested separately, BA totals 15,000', () => {
    const r = calculateIstPayroll({
      month: '2026-08',
      rank: 'SM',
      contractStart: '2026-07-16',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: { kpi: '150000.00', collection: '60000.00' },
      qpBaApproved: true,
    });
    expect(r.qp).toMatchObject({ from: '2026-08-01', to: '2026-08-15', days: 15 });
    expect(r.ep).toMatchObject({ from: '2026-08-16', to: '2026-08-31', days: 16, baPass: true });
    expect(r.ba).toBe('15000.00');
    // The higher PA and PB lines are not met in either stretch.
    expect(r.pa).toBe('0.00');
    expect(r.pb).toBe('0.00');
  });

  it('does not let strong EP production rescue a QP stretch that failed its own PA gate', () => {
    const r = calculateIstPayroll({
      month: '2026-08',
      rank: 'SM',
      contractStart: '2026-07-16',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: { kpi: '5000000.00', collection: '2000000.00' },
      qpBaApproved: true,
    });
    expect(r.qp.paPass).toBe(false);
    expect(r.ep.paPass).toBe(true);
    // PA for the EP days only: 15,000 x 16/31.
    expect(r.pa).toBe('7741.94');
  });

  it('pays QP PA when the QP stretch passes its pro-rated gates (QA pack: 7,258.06)', () => {
    const r = calculateIstPayroll({
      month: '2026-05',
      rank: 'SM',
      contractStart: '2026-04-16',
      policy: HISTORICAL.SM,
      qp: { kpi: '600000.00', collection: '250000.00' },
      ep: NONE,
      qpBaApproved: true,
    });
    expect(r.qp).toMatchObject({ days: 15, paPass: true });
    expect(r.pa).toBe('7258.06');
    // QP BA 15/31 only: the EP stretch produced nothing, so its BA gate fails.
    expect(r.ba).toBe('7258.06');
  });

  it('a suspension stops pay the day before it takes effect', () => {
    const r = calculateIstPayroll(
      fullEp('SM', '1200000.00', '500000.00', { suspendedFrom: '2026-10-11' }),
    );
    expect(r.ep).toMatchObject({ from: '2026-10-01', to: '2026-10-10', days: 10 });
    expect(r.ba).toBe('4838.71'); // 15,000 x 10/31
  });

  it('a contract end inside the month counts through the last eligible day', () => {
    const r = calculateIstPayroll(
      fullEp('SM', '1200000.00', '500000.00', { contractEnd: '2026-10-20' }),
    );
    expect(r.ep.days).toBe(20);
  });

  it('flags a start day other than the 1st or 16th without blocking', () => {
    const r = calculateIstPayroll({
      month: '2026-07',
      rank: 'SM',
      contractStart: '2026-07-10',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: NONE,
      qpBaApproved: true,
    });
    expect(r.status).toBe('CALCULATED');
    expect(r.exceptions).toContain('NON_STANDARD_START_DAY');
  });
});

describe('gates and Equivalent TCP', () => {
  it('SM full EP, KPI 1.2M and collections 500K: BA 15K, PA 15K, PB zero', () => {
    const r = calculateIstPayroll(fullEp('SM', '1200000.00', '500000.00'));
    expect([r.ba, r.pa, r.pb, r.gross]).toEqual(['15000.00', '15000.00', '0.00', '30000.00']);
  });

  it('PA needs the collection gate too: 300K collected fails it', () => {
    const r = calculateIstPayroll(fullEp('SM', '1200000.00', '300000.00'));
    expect(r.pa).toBe('0.00');
    expect(r.ba).toBe('15000.00');
  });

  it('SM KPI 5M, collections 1M: PB 25,000 on Equivalent TCP 2.5M, not on the full KPI', () => {
    const r = calculateIstPayroll(fullEp('SM', '5000000.00', '1000000.00'));
    expect(r.ep.equivalentTcp).toBe('2500000.00');
    expect(r.pb).toBe('25000.00');
  });

  it('SSM KPI 20M, collections 1.8M: PB 135,000 despite a 9% collection rate (no rate floor)', () => {
    const r = calculateIstPayroll(fullEp('SSM', '20000000.00', '1800000.00'));
    expect(r.ep.equivalentTcp).toBe('4500000.00');
    expect(r.pb).toBe('135000.00');
  });

  it('SVD on the same figures fails its collection quota: PB zero', () => {
    const r = calculateIstPayroll(fullEp('SVD', '20000000.00', '1800000.00'));
    expect(r.ep.pbPass).toBe(false);
    expect(r.pb).toBe('0.00');
  });

  it('caps Equivalent TCP at the KPI when collections run ahead', () => {
    const r = calculateIstPayroll(fullEp('SM', '2000000.00', '2000000.00'));
    expect(r.ep.equivalentTcp).toBe('2000000.00');
    expect(r.pb).toBe('20000.00');
  });

  it('PB is not pro-rated a second time in a partial month', () => {
    // 16 EP days of 31: the PB gate is pro-rated, the bonus itself is not.
    const r = calculateIstPayroll({
      month: '2026-08',
      rank: 'SM',
      contractStart: '2026-07-16',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: { kpi: '2000000.00', collection: '800000.00' },
      qpBaApproved: true,
    });
    expect(r.ep.pbPass).toBe(true);
    expect(r.ep.equivalentTcp).toBe('2000000.00');
    expect(r.pb).toBe('20000.00'); // 1% of 2M, not 1% x 16/31
  });

  it('a passing gate is exact at the boundary and fails one centavo short', () => {
    expect(calculateIstPayroll(fullEp('SM', '200000.00', '80000.00')).ep.baPass).toBe(true);
    expect(calculateIstPayroll(fullEp('SM', '199999.99', '80000.00')).ep.baPass).toBe(false);
    expect(calculateIstPayroll(fullEp('SM', '200000.00', '79999.99')).ep.baPass).toBe(false);
  });
});

describe('nothing is payable without approved configuration and decisions', () => {
  it('a missing compensation policy blocks the result instead of showing zero', () => {
    const r = calculateIstPayroll(fullEp('SM', '5000000.00', '2000000.00', { policy: null }));
    expect(r.status).toBe('BLOCKED');
    expect(r.exceptions).toEqual(['MISSING_POLICY']);
    expect([r.ba, r.pa, r.pb, r.gross, r.net]).toEqual([null, null, null, null, null]);
  });

  it('a missing contract start blocks rather than assuming a full month', () => {
    const r = calculateIstPayroll(fullEp('SM', '1200000.00', '500000.00', { contractStart: null }));
    expect(r.status).toBe('BLOCKED');
    expect(r.exceptions).toContain('MISSING_CONTRACT_START');
  });

  it('a policy for another rank is refused', () => {
    const r = calculateIstPayroll(
      fullEp('SM', '1200000.00', '500000.00', { policy: HISTORICAL.SSM }),
    );
    expect(r.status).toBe('BLOCKED');
    expect(r.exceptions).toEqual(['POLICY_RANK_MISMATCH']);
  });

  it('an OST never receives IST allowances, whatever the production', () => {
    const r = calculateIstPayroll({ ...fullEp('SM', '9000000.00', '9000000.00'), rank: 'OST' });
    expect(r.status).toBe('BLOCKED');
    expect(r.exceptions).toEqual(['NOT_AN_IST_POSITION']);
    expect(r.gross).toBeNull();
  });

  it('QP BA waits for the compliance decision: undecided pays nothing and is flagged', () => {
    const base: IstPayrollInput = {
      month: '2026-07',
      rank: 'SM',
      contractStart: '2026-07-16',
      policy: HISTORICAL.SM,
      qp: NONE,
      ep: NONE,
      qpBaApproved: null,
    };
    const pending = calculateIstPayroll(base);
    expect(pending.ba).toBe('0.00');
    expect(pending.exceptions).toContain('QP_BA_DECISION_PENDING');
    const refused = calculateIstPayroll({ ...base, qpBaApproved: false });
    expect(refused.ba).toBe('0.00');
    expect(refused.exceptions).not.toContain('QP_BA_DECISION_PENDING');
  });

  it('an approved BA hold removes BA only; PA and PB stay', () => {
    const r = calculateIstPayroll(fullEp('SM', '5000000.00', '2000000.00', { baWithheld: true }));
    expect(r.gross).toBe('80000.00'); // 15K + 15K + 50K
    expect(r.baWithheldAmount).toBe('15000.00');
    expect(r.net).toBe('65000.00');
  });

  it('only authorized adjustments reduce net pay, and never below zero', () => {
    const none = calculateIstPayroll(fullEp('SM', '1200000.00', '500000.00'));
    expect(none.net).toBe('30000.00');
    const some = calculateIstPayroll(
      fullEp('SM', '1200000.00', '500000.00', { authorizedAdjustments: '50000.00' }),
    );
    expect(some.gross).toBe('30000.00');
    expect(some.net).toBe('0.00');
  });

  it('records the policy version that produced the figures', () => {
    expect(calculateIstPayroll(fullEp('SM', '1.00', '1.00')).policyVersion).toBe(
      'historical-reference',
    );
  });
});

describe('assumed collection credit is a performance metric, not cash', () => {
  it('raises credited KPI and collection but leaves verified cash unchanged', () => {
    const t = creditedTotals({
      closedDealTcp: '0.00',
      verifiedCollections: '1000000.00',
      assumedAccountCollections: '1000000.00',
      assumedCreditRate: '0.40',
    });
    expect(t.assumedCredit).toBe('400000.00');
    expect(t.kpi).toBe('400000.00');
    expect(t.collection).toBe('1400000.00');
    expect(t.verifiedCash).toBe('1000000.00');
  });

  it('a zero rate disables the credit entirely', () => {
    const t = creditedTotals({
      closedDealTcp: '500000.00',
      verifiedCollections: '200000.00',
      assumedAccountCollections: '900000.00',
      assumedCreditRate: '0',
    });
    expect(t).toEqual({
      kpi: '500000.00',
      collection: '200000.00',
      assumedCredit: '0.00',
      verifiedCash: '200000.00',
    });
  });
});

describe('inputs are exact decimals', () => {
  it('refuses a float-looking or malformed amount', () => {
    expect(() => calculateIstPayroll(fullEp('SM', '1e6', '500000.00'))).toThrow();
    expect(() => calculateIstPayroll(fullEp('SM', '1200000.005', '500000.00'))).toThrow();
  });
});
