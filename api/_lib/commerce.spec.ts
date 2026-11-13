/**
 * AFHomes Phase 2 - commerce rules.
 *
 * The financial rules that must never be wrong: exact-decimal commission, the
 * minimum down payment, the 7-day spot-cash window, product sellability, and
 * seller-identity resolution (the anti-spoofing rule).
 */
import { describe, expect, it } from 'vitest';

import {
  calculateCommission,
  deriveSpotCashState,
  productSaleRejection,
  resolveSeller,
  snapshotSaleTerms,
  spotCashDeadlineFrom,
  summarizePayments,
  toSummaryResponse,
} from './commerce.js';

const GOLD = {
  id: 'g',
  isActive: true,
  cashPrice: '60000.00',
  minimumDownPayment: '20000.00',
  yearlyPoints: 60000,
  commissionRate: '0.04',
};
const SILVER = {
  id: 's',
  isActive: true,
  cashPrice: '40000.00',
  minimumDownPayment: '15000.00',
  yearlyPoints: 40000,
  commissionRate: '0.04',
};
const BRONZE = {
  id: 'b',
  isActive: true,
  cashPrice: '30000.00',
  minimumDownPayment: '10000.00',
  yearlyPoints: 25000,
  commissionRate: '0.04',
};

const pay = (amount: string, status: 'recorded' | 'verified' | 'rejected' | 'voided') => ({
  amount,
  status,
});

describe('commission is 4% of the card price, exactly', () => {
  it.each([
    ['GOLD', GOLD, '2400.00'],
    ['SILVER', SILVER, '1600.00'],
    ['BRONZE', BRONZE, '1200.00'],
  ])('%s', (_name, product, expected) => {
    expect(calculateCommission(product.cashPrice, product.commissionRate)).toBe(expected);
  });

  it('rounds half away from zero like Postgres round(numeric, 2)', () => {
    // 0.125 -> 0.13 (half away), not 0.12 (banker rounding).
    expect(calculateCommission('2.50', '0.05')).toBe('0.13');
    // Large values keep full precision - no float drift.
    expect(calculateCommission('99999999.99', '0.0400')).toBe('4000000.00');
  });

  it('keeps two decimals and never emits exponent notation', () => {
    const value = calculateCommission('1000000.00', '0.04');
    expect(value).toBe('40000.00');
    expect(value).not.toMatch(/e/i);
  });
});

describe('sale terms are snapshotted at creation', () => {
  it('captures price, down payment, points, rate and expected commission', () => {
    expect(snapshotSaleTerms(GOLD)).toEqual({
      cashPriceSnapshot: '60000.00',
      minimumDownPaymentSnapshot: '20000.00',
      yearlyPointsSnapshot: 60000,
      commissionRateSnapshot: '0.04',
      expectedCommissionSnapshot: '2400.00',
    });
  });

  it('a later price change cannot alter an existing sale', () => {
    const captured = snapshotSaleTerms(GOLD);
    const repriced = { ...GOLD, cashPrice: '90000.00', yearlyPoints: 90000 };
    expect(snapshotSaleTerms(repriced).expectedCommissionSnapshot).toBe('3600.00');
    // The captured snapshot is a plain value and is unaffected.
    expect(captured.cashPriceSnapshot).toBe('60000.00');
    expect(captured.expectedCommissionSnapshot).toBe('2400.00');
  });
});

describe('only verified money counts', () => {
  it('ignores recorded, rejected and voided payments', () => {
    const totals = summarizePayments({
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      payments: [pay('20000.00', 'recorded'), pay('5000.00', 'rejected'), pay('1000.00', 'voided')],
    });
    expect(totals.verifiedTotal).toBe('0.00');
    expect(totals.recordedTotal).toBe('20000.00');
    expect(totals.rejectedTotal).toBe('5000.00');
    expect(totals.remainingBalance).toBe('60000.00');
    expect(totals.fullyPaid).toBe(false);
    // A recorded-but-unverified down payment does NOT satisfy the minimum.
    expect(totals.downPaymentSatisfied).toBe(false);
  });

  it('sums multiple payments without float drift', () => {
    const totals = summarizePayments({
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      payments: [pay('0.10', 'verified'), pay('0.20', 'verified'), pay('19999.70', 'verified')],
    });
    expect(totals.verifiedTotal).toBe('20000.00');
    expect(totals.downPaymentSatisfied).toBe(true);
    expect(totals.remainingBalance).toBe('40000.00');
  });

  it('satisfies the minimum only at or above the threshold', () => {
    const at = summarizePayments({
      cashPrice: '40000.00',
      minimumDownPayment: '15000.00',
      payments: [pay('14999.99', 'verified')],
    });
    expect(at.downPaymentSatisfied).toBe(false);
    const exact = summarizePayments({
      cashPrice: '40000.00',
      minimumDownPayment: '15000.00',
      payments: [pay('15000.00', 'verified')],
    });
    expect(exact.downPaymentSatisfied).toBe(true);
  });

  it('is fully paid only when verified money reaches the price', () => {
    const short = summarizePayments({
      cashPrice: '30000.00',
      minimumDownPayment: '10000.00',
      payments: [pay('29999.99', 'verified')],
    });
    expect(short.fullyPaid).toBe(false);
    expect(short.remainingBalance).toBe('0.01');

    const exact = summarizePayments({
      cashPrice: '30000.00',
      minimumDownPayment: '10000.00',
      payments: [pay('30000.00', 'verified')],
    });
    expect(exact.fullyPaid).toBe(true);
    expect(exact.remainingBalance).toBe('0.00');
  });

  it('reports overpayment without a negative balance', () => {
    const over = summarizePayments({
      cashPrice: '30000.00',
      minimumDownPayment: '10000.00',
      payments: [pay('35000.00', 'verified')],
    });
    expect(over.verifiedTotal).toBe('35000.00');
    expect(over.overpaidAmount).toBe('5000.00');
    expect(over.remainingBalance).toBe('0.00');
    expect(over.fullyPaid).toBe(true);
  });
});

describe('7-day spot cash', () => {
  const start = '2026-09-27T10:00:00.000Z';

  it('deadline is exactly 7 days after the first verified payment', () => {
    expect(spotCashDeadlineFrom(start)).toBe('2026-10-04T10:00:00.000Z');
  });

  it('is not started before any verified payment', () => {
    expect(
      deriveSpotCashState({ fullyPaid: false, spotCashStartedAt: null, spotCashDeadline: null }),
    ).toBe('not_started');
  });

  it('is within the deadline before and exactly at the boundary', () => {
    const deadline = spotCashDeadlineFrom(start);
    expect(
      deriveSpotCashState({
        fullyPaid: false,
        spotCashStartedAt: start,
        spotCashDeadline: deadline,
        now: new Date('2026-10-04T09:59:59.999Z'),
      }),
    ).toBe('within_deadline');
    // The boundary instant itself is still inside the window.
    expect(
      deriveSpotCashState({
        fullyPaid: false,
        spotCashStartedAt: start,
        spotCashDeadline: deadline,
        now: new Date(deadline),
      }),
    ).toBe('within_deadline');
  });

  it('expires one millisecond after the boundary', () => {
    const deadline = spotCashDeadlineFrom(start);
    expect(
      deriveSpotCashState({
        fullyPaid: false,
        spotCashStartedAt: start,
        spotCashDeadline: deadline,
        now: new Date(new Date(deadline).valueOf() + 1),
      }),
    ).toBe('expired');
  });

  it('full payment settles the window regardless of expiry', () => {
    expect(
      deriveSpotCashState({
        fullyPaid: true,
        spotCashStartedAt: start,
        spotCashDeadline: '2020-01-01T00:00:00.000Z',
        now: new Date('2030-01-01T00:00:00.000Z'),
      }),
    ).toBe('fully_paid');
  });

  it('computes in UTC regardless of the calendar month boundary', () => {
    // 27 Sep + 7 days crosses into October; the arithmetic must not drift.
    expect(spotCashDeadlineFrom('2026-09-28T23:59:59.999Z')).toBe('2026-10-05T23:59:59.999Z');
    // February in a leap year.
    expect(spotCashDeadlineFrom('2028-02-20T00:00:00.000Z')).toBe('2028-02-27T00:00:00.000Z');
  });

  it('surfaces the derived state through the summary', () => {
    const summary = toSummaryResponse({
      saleId: 's1',
      status: 'payment_in_progress',
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      payments: [pay('20000.00', 'verified')],
      spotCashStartedAt: start,
      spotCashDeadline: spotCashDeadlineFrom(start),
      now: new Date('2026-09-28T00:00:00.000Z'),
    });
    expect(summary.spotCashState).toBe('within_deadline');
    expect(summary.remainingBalance).toBe('40000.00');
  });
});

describe('a product can only be sold when it is active and coherent', () => {
  it('accepts an active product', () => {
    expect(productSaleRejection(GOLD)).toBeNull();
  });

  it('rejects an inactive product', () => {
    expect(productSaleRejection({ ...GOLD, isActive: false })).toBe('PRODUCT_INACTIVE');
  });

  it('rejects a zero price', () => {
    expect(productSaleRejection({ ...GOLD, cashPrice: '0.00' })).toBe('ZERO_PRICE');
  });

  it('rejects a down payment above the price (un-payable sale)', () => {
    expect(productSaleRejection({ ...GOLD, minimumDownPayment: '60000.01' })).toBe(
      'DOWN_PAYMENT_EXCEEDS_PRICE',
    );
  });

  it('accepts a down payment exactly equal to the price', () => {
    expect(productSaleRejection({ ...GOLD, minimumDownPayment: '60000.00' })).toBeNull();
  });
});

describe('seller of record: always an active SM, never spoofable by the request body', () => {
  const sm = { actorId: 'sm-1', actorRole: 'sales_manager' };
  const activeSm = (id: string) => ({ staffId: id, roleSlug: 'sales_manager', status: 'active' });

  it('an SM creator is the seller when no seller is named', () => {
    expect(resolveSeller({ ...sm, downlineIds: [] })).toEqual({ staffId: 'sm-1' });
  });

  it('treats an SM explicit self-reference as the caller', () => {
    expect(resolveSeller({ ...sm, requestedSellerId: 'sm-1', downlineIds: [] })).toEqual({
      staffId: 'sm-1',
    });
  });

  it('refuses an SM naming any other seller, even one in their downline', () => {
    expect(
      resolveSeller({
        ...sm,
        requestedSellerId: 'ost-1',
        target: { staffId: 'ost-1', roleSlug: 'ost', status: 'active' },
        downlineIds: ['ost-1'],
      }),
    ).toEqual({ error: 'SELLER_OF_RECORD_MUST_BE_CREATOR' });
  });

  it('refuses an OST creator outright', () => {
    expect(
      resolveSeller({
        actorId: 'ost-1',
        actorRole: 'ost',
        requestedSellerId: 'sm-1',
        target: activeSm('sm-1'),
        downlineIds: ['sm-1'],
      }),
    ).toEqual({ error: 'SELLER_ROLE_NOT_A_SELLER' });
  });

  for (const role of ['admin', 'super_admin'] as const) {
    it(`lets ${role} originate for any active SM, who is the seller of record`, () => {
      expect(
        resolveSeller({
          actorId: 'a-1',
          actorRole: role,
          requestedSellerId: 'sm-9',
          target: activeSm('sm-9'),
          downlineIds: [],
        }),
      ).toEqual({ staffId: 'sm-9' });
    });

    it(`refuses ${role} originating without naming an SM, or naming themselves`, () => {
      const admin = { actorId: 'a-1', actorRole: role, downlineIds: [] };
      expect(resolveSeller(admin)).toEqual({ error: 'SELLER_OF_RECORD_REQUIRED' });
      expect(resolveSeller({ ...admin, requestedSellerId: 'a-1' })).toEqual({
        error: 'SELLER_OF_RECORD_REQUIRED',
      });
    });
  }

  it('refuses a named seller who is not a Sales Manager (OST, admin, finance)', () => {
    for (const roleSlug of ['ost', 'admin', 'finance', 'senior_sales_manager']) {
      expect(
        resolveSeller({
          actorId: 'a-1',
          actorRole: 'admin',
          requestedSellerId: 'x-1',
          target: { staffId: 'x-1', roleSlug, status: 'active' },
          downlineIds: [],
        }),
      ).toEqual({ error: 'SELLER_ROLE_NOT_A_SELLER' });
    }
  });

  it('refuses an inactive SM', () => {
    expect(
      resolveSeller({
        actorId: 'a-1',
        actorRole: 'admin',
        requestedSellerId: 'sm-2',
        target: { staffId: 'sm-2', roleSlug: 'sales_manager', status: 'suspended' },
        downlineIds: [],
      }),
    ).toEqual({ error: 'SELLER_INACTIVE' });
  });

  it('refuses an unknown seller id', () => {
    expect(
      resolveSeller({
        actorId: 'a-1',
        actorRole: 'admin',
        requestedSellerId: 'ghost',
        target: null,
        downlineIds: [],
      }),
    ).toEqual({ error: 'SELLER_NOT_IN_YOUR_DOWNLINE' });
  });

  it('limits a non-privileged permitted creator (e.g. SSM) to an SM in their downline', () => {
    const ssm = { actorId: 'ssm-1', actorRole: 'senior_sales_manager' };
    expect(
      resolveSeller({
        ...ssm,
        requestedSellerId: 'sm-1',
        target: activeSm('sm-1'),
        downlineIds: ['sm-1'],
      }),
    ).toEqual({ staffId: 'sm-1' });
    expect(
      resolveSeller({
        ...ssm,
        requestedSellerId: 'sm-9',
        target: activeSm('sm-9'),
        downlineIds: ['sm-1'],
      }),
    ).toEqual({ error: 'SELLER_NOT_IN_YOUR_DOWNLINE' });
  });
});
