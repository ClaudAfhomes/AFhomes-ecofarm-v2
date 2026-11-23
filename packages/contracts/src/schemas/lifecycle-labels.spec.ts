/**
 * Lifecycle display labels and the activation-readiness rule.
 *
 * Coverage is derived from the lifecycle schemas themselves, never from a
 * hand-written key list, so a new state cannot ship unlabeled.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_BLOCKER_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RESERVATION_AGREEMENT_STATUS_LABELS,
  SALE_ACTIVATABLE,
  SALE_STATUS_LABELS,
  activationBlocker,
  activationBlockerSchema,
  membershipStatusSchema,
  paymentStatusSchema,
  reservationAgreementStatusSchema,
  saleStatusSchema,
} from './lifecycle.js';
import { financeQueueItemSchema } from './finance.js';

const cases = [
  ['sale', saleStatusSchema.options, SALE_STATUS_LABELS],
  ['payment', paymentStatusSchema.options, PAYMENT_STATUS_LABELS],
  ['reservation agreement', reservationAgreementStatusSchema.options, RESERVATION_AGREEMENT_STATUS_LABELS],
  ['membership', membershipStatusSchema.options, MEMBERSHIP_STATUS_LABELS],
  ['activation blocker', activationBlockerSchema.options, ACTIVATION_BLOCKER_LABELS],
] as const;

describe('lifecycle display labels', () => {
  it.each(cases)('every %s state has a human label and no stray keys', (_name, options, labels) => {
    expect(Object.keys(labels).sort()).toEqual([...options].sort());
    for (const code of options) {
      const label = (labels as Record<string, string>)[code]!;
      expect(label.trim()).not.toBe('');
      expect(label).not.toContain('_');
    }
  });

  it('labels overdue and cancelled sales by their lifecycle state', () => {
    expect(SALE_STATUS_LABELS.overdue).toBe('Overdue');
    expect(SALE_STATUS_LABELS.cancelled).toBe('Cancelled');
    // payment_verified is a lifecycle state, not a payment-progress claim.
    expect(SALE_STATUS_LABELS.payment_verified).toBe('Payment Verified');
  });
});

describe('activationBlocker', () => {
  it('is null exactly when the sale is in SALE_ACTIVATABLE and fully paid', () => {
    for (const status of saleStatusSchema.options) {
      for (const fullyPaid of [true, false]) {
        expect(activationBlocker(status, fullyPaid) === null).toBe(
          SALE_ACTIVATABLE.includes(status) && fullyPaid,
        );
      }
    }
  });

  it('names the real reason instead of calling every blocked sale underpaid', () => {
    expect(activationBlocker('payment_in_progress', true)).toBe('not_ready');
    expect(activationBlocker('payment_verified', false)).toBe('outstanding_balance');
    expect(activationBlocker('active', true)).toBe('already_active');
    expect(activationBlocker('cancelled', true)).toBe('cancelled');
  });
});

describe('financeQueueItemSchema status and tier', () => {
  const base = {
    saleId: 'bbbbbbbb-0000-4000-8000-000000000001',
    saleNumber: 'SALE-1',
    customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
    customerName: 'Ana',
    productName: 'Plan',
    tier: 'GOLD',
    status: 'payment_verified',
    cashPrice: '60000.00',
    paymentScheme: 'spot_cash',
    reservationFee: '0.00',
    requiredInitial: '0.00',
    installmentMonths: null,
    monthlyAmount: null,
    validityMonths: null,
    verifiedTotal: '60000.00',
    remainingBalance: '0.00',
    downPaymentSatisfied: true,
    fullyPaid: true,
    spotCashState: 'fully_paid',
    spotCashDeadline: null,
    firstVerifiedPayment: null,
    activatable: true,
    activationBlocker: null,
  };

  it('accepts every lifecycle sale status', () => {
    for (const status of saleStatusSchema.options) {
      expect(financeQueueItemSchema.safeParse({ ...base, status }).success).toBe(true);
    }
  });

  it.each(['paid', 'PAYMENT_VERIFIED', '', 'fully_paid'])(
    'rejects unsupported sale status %j instead of coercing it',
    (status) => {
      expect(financeQueueItemSchema.safeParse({ ...base, status }).success).toBe(false);
    },
  );

  it('accepts a null tier but rejects a tier outside the VIP enum', () => {
    expect(financeQueueItemSchema.safeParse({ ...base, tier: null }).success).toBe(true);
    expect(financeQueueItemSchema.safeParse({ ...base, tier: 'PLATINUM' }).success).toBe(false);
  });

  it('rejects an unknown activation blocker', () => {
    expect(
      financeQueueItemSchema.safeParse({ ...base, activationBlocker: 'short' }).success,
    ).toBe(false);
  });
});
