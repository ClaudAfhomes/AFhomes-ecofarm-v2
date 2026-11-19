import type { IstPerformanceEvidenceItem, IstPerformanceStaff } from '@afhomes/contracts';
import { describe, expect, it } from 'vitest';

import { splitStretches } from './payroll-ist.js';

// TEST FIXTURE figures only; no approved policy value is implied.
const ENG = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const perf: IstPerformanceStaff = {
  staffId: STAFF,
  rank: 'SM',
  contractStart: '2026-01-01',
  contractEnd: null,
  suspendedFrom: null,
  kpi: '0.00',
  collection: '1000.00',
  verifiedCash: '1000.00',
  assumedCredit: '0.00',
  approvedAdjustmentsTotal: '0.00',
  proposedAdjustmentsTotal: '0.00',
  status: 'CALCULABLE',
  blockers: [],
  evidenceHash: 'h',
  evidenceCount: 1,
  ruleId: null,
  ruleVersion: 1,
  engagementId: ENG,
};
const item = (countDate: string): IstPerformanceEvidenceItem => ({
  staffId: STAFF,
  period: '2026-03',
  saleId: null,
  reservationId: null,
  paymentId: '33333333-3333-4333-8333-333333333333',
  amount: '1000.00',
  postingPeriod: '2026-03-01',
  paidOn: countDate,
  verifiedAt: null,
  paymentPurpose: 'installment',
  sellerStaffId: STAFF,
  contractPriceSnapshot: '50000.00',
  cumulativeVerifiedAtPeriodEnd: '1000.00',
  evidenceClass: 'staff_sale',
  eligibility: 'ELIGIBLE',
  reasonCode: null,
  countPeriod: '2026-03',
  countDate,
  isClosingPayment: false,
  closedDealThresholdAmount: null,
  approvedAdjustmentsTotal: '0.00',
  proposedAdjustmentsTotal: '0.00',
  assumedCredit: '0.00',
  ruleId: null,
  engagementId: ENG,
});

describe('splitStretches count-date month check (review M3)', () => {
  it('accepts a count date inside the payroll month', () => {
    const out = splitStretches('2026-03', perf, [item('2026-03-15')], 'h');
    expect(out.blocked).toBe(false);
  });

  it('retains the source summary and payment facts with the stored calculation inputs', () => {
    const payment = item('2026-03-15');
    const out = splitStretches('2026-03', perf, [payment], 'h');
    const persisted = JSON.parse(JSON.stringify(out.inputs));
    expect(persisted.performanceEvidence).toEqual({ summary: perf, items: [payment] });
    expect(persisted.performanceEvidence.items[0]).toMatchObject({
      paymentId: payment.paymentId,
      countPeriod: '2026-03',
      countDate: '2026-03-15',
      amount: '1000.00',
      contractPriceSnapshot: '50000.00',
    });
  });

  it('blocks a count date outside the payroll month instead of dropping it', () => {
    const out = splitStretches('2026-03', perf, [item('2026-02-28')], 'h');
    expect(out).toMatchObject({ blocked: true, blockers: ['COUNT_DATE_OUTSIDE_MONTH'] });
  });
});
