/**
 * Admin status presentation: every lifecycle state has a label (contracts)
 * and a semantic tone (admin), derived from the lifecycle schemas so a new
 * state cannot render unstyled or as snake_case.
 */
import { describe, expect, it } from 'vitest';
import {
  SALE_STATUS_LABELS,
  activationBlockerSchema,
  membershipStatusSchema,
  paymentStatusSchema,
  reservationAgreementStatusSchema,
  saleStatusSchema,
} from '@afhomes/contracts';
import type { StatusTone } from '@afhomes/ui';

import {
  ACTIVATION_BLOCKER_TONE,
  MEMBERSHIP_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  RESERVATION_AGREEMENT_STATUS_TONE,
  SALE_STATUS_TONE,
  activationBadge,
  membershipStatusBadge,
  paymentProgress,
  paymentProgressBadge,
  paymentStatusBadge,
  reservationAgreementStatusBadge,
  saleStatusBadge,
} from './format';

const TONES: readonly StatusTone[] = ['neutral', 'success', 'warning', 'danger', 'info'];

const cases = [
  ['sale', saleStatusSchema.options, SALE_STATUS_TONE, saleStatusBadge],
  ['payment', paymentStatusSchema.options, PAYMENT_STATUS_TONE, paymentStatusBadge],
  [
    'reservation agreement',
    reservationAgreementStatusSchema.options,
    RESERVATION_AGREEMENT_STATUS_TONE,
    reservationAgreementStatusBadge,
  ],
  ['membership', membershipStatusSchema.options, MEMBERSHIP_STATUS_TONE, membershipStatusBadge],
  ['activation blocker', activationBlockerSchema.options, ACTIVATION_BLOCKER_TONE, activationBadge],
] as const;

describe('status badge coverage', () => {
  it.each(cases)('every %s state has a label and a semantic tone', (_n, options, tones, badge) => {
    expect(Object.keys(tones).sort()).toEqual([...options].sort());
    for (const code of options) {
      const { label, tone } = (badge as (c: string) => { label: string; tone: StatusTone })(code);
      expect(label.trim()).not.toBe('');
      expect(label).not.toContain('_');
      expect(TONES).toContain(tone);
    }
  });
});

describe('status badge semantics', () => {
  it('shows overdue as danger and cancelled as Cancelled', () => {
    expect(saleStatusBadge('overdue')).toEqual({ label: 'Overdue', tone: 'danger' });
    expect(saleStatusBadge('cancelled')).toEqual({ label: 'Cancelled', tone: 'neutral' });
  });

  it('shows a rejected payment as danger and a verified one as success', () => {
    expect(paymentStatusBadge('rejected')).toEqual({ label: 'Rejected', tone: 'danger' });
    expect(paymentStatusBadge('verified')).toEqual({ label: 'Verified', tone: 'success' });
  });

  it('labels reservation execution from its own map, not the sale map', () => {
    expect(reservationAgreementStatusBadge('executed')).toEqual({
      label: 'Executed',
      tone: 'success',
    });
    expect(Object.keys(SALE_STATUS_LABELS)).not.toContain('executed');
    expect(Object.keys(SALE_STATUS_TONE)).not.toContain('executed');
  });

  it('separates eligibility reasons from underpayment', () => {
    expect(activationBadge(null)).toEqual({ label: 'Eligible', tone: 'success' });
    expect(activationBadge('not_ready').label).toBe('Sale Not Ready');
    expect(activationBadge('already_active').label).toBe('Already Activated');
    expect(activationBadge('outstanding_balance').label).toBe('Outstanding Balance');
  });
});

describe('payment progress', () => {
  it('compares exact cents, not literal zero strings', () => {
    expect(paymentProgress('0.00', '60000.00')).toBe('none');
    expect(paymentProgress('0', '60000.00')).toBe('none');
    expect(paymentProgress('0.0', '60000.00')).toBe('none');
    expect(paymentProgress('0.01', '60000.00')).toBe('partial');
    expect(paymentProgress('59999.99', '60000.00')).toBe('partial');
    expect(paymentProgress('60000', '60000.00')).toBe('full');
  });

  it('labels each milestone', () => {
    expect(paymentProgressBadge('none').label).toBe('No Verified Payments');
    expect(paymentProgressBadge('partial').label).toBe('Partially Paid');
    expect(paymentProgressBadge('full')).toEqual({ label: 'Fully Paid', tone: 'success' });
  });
});
