import { describe, expect, it } from 'vitest';
import { applicationNextStep, reservationNextStep } from './next-step';
import { nextPaymentStep } from './payment-purposes';

describe('application next step', () => {
  it.each([
    ['draft', 'Submit for Approval', '/admin/customers/applications/a1'],
    ['submitted', 'Review Signed Documents', '/admin/customers/applications/a1'],
    ['approved', 'Continue in Finance', '/admin/finance/payments'],
    ['rejected', 'No action due', null],
    ['cancelled', 'No action due', null],
  ])('%s -> %s', (status, label, to) => {
    expect(applicationNextStep({ id: 'a1', status })).toEqual({ label, to });
  });
});

describe('reservation next step', () => {
  const base = { id: 'r1', reservationNumber: 'AF-RSV-1', saleId: null, fullyPaid: false };
  it('keeps linked draft and submitted RAs in the coordinated application workflow', () => {
    for (const status of ['draft', 'submitted'])
      expect(reservationNextStep({ ...base, status, customerApplicationId: 'a1' })).toEqual({
        label: 'Open Application & RA',
        to: '/admin/customers/applications/a1',
      });
  });
  it('walks draft -> submitted -> executed -> paid -> finalized', () => {
    expect(reservationNextStep({ ...base, status: 'draft' }).label).toBe('Continue draft');
    expect(reservationNextStep({ ...base, status: 'submitted' }).label).toBe('Review and execute');
    expect(reservationNextStep({ ...base, status: 'executed' })).toEqual({
      label: 'Record payment',
      to: '/admin/finance/payments?search=AF-RSV-1',
    });
    expect(reservationNextStep({ ...base, status: 'executed', fullyPaid: true }).label).toBe(
      'Finalize purchase',
    );
    expect(
      reservationNextStep({ ...base, status: 'executed', fullyPaid: true, saleId: 's1' }),
    ).toEqual({ label: 'Activate VIP Membership', to: '/admin/finance/activation' });
    expect(reservationNextStep({ ...base, status: 'cancelled' }).to).toBeNull();
  });
});

describe('payment queue next step', () => {
  const terms = {
    origin: 'sale' as const,
    reservationFee: '10000.00',
    requiredInitial: '40000.00',
    monthlyAmount: '5000.00',
    remainingBalance: '100000.00',
    fullyPaid: false,
  };
  it('moves reservation -> down payment -> installment -> activate', () => {
    expect(nextPaymentStep({ ...terms, verifiedTotal: '0.00' }).label).toBe(
      'Record reservation payment',
    );
    expect(nextPaymentStep({ ...terms, verifiedTotal: '10000.00' }).label).toBe(
      'Record down payment',
    );
    expect(nextPaymentStep({ ...terms, verifiedTotal: '40000.00' }).label).toBe(
      'Record installment',
    );
    expect(
      nextPaymentStep({
        ...terms,
        verifiedTotal: '100000.00',
        remainingBalance: '0.00',
        fullyPaid: true,
        activatable: true,
      }).label,
    ).toBe('Activate VIP Membership');
    expect(
      nextPaymentStep({
        ...terms,
        verifiedTotal: '100000.00',
        remainingBalance: '0.00',
        fullyPaid: true,
      }),
    ).toMatchObject({ key: 'none' });
    expect(
      nextPaymentStep({ ...terms, monthlyAmount: null, verifiedTotal: '40000.00' }).label,
    ).toBe('Record full payment');
    expect(
      nextPaymentStep({
        ...terms,
        origin: 'reservation',
        verifiedTotal: '100000.00',
        remainingBalance: '0.00',
        fullyPaid: true,
      }).label,
    ).toBe('Finalize purchase');
  });
});
