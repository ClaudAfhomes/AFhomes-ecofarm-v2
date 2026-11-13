import { describe, expect, it } from 'vitest';
import {
  availablePurposes,
  payableBalance,
  type LedgerPayment,
  type PurchaseTerms,
} from './payment-purposes';

const installmentTerms: PurchaseTerms = {
  total: '100000.00',
  reservationFee: '10000.00',
  requiredInitial: '40000.00',
  monthlyAmount: '5000.00',
  installmentMonths: 12,
};
const pay = (
  purposeOrNull: LedgerPayment['paymentPurpose'],
  amount: string,
  status = 'verified',
): LedgerPayment => ({ paymentPurpose: purposeOrNull, amount, status });
const purposes = (payments: LedgerPayment[], terms = installmentTerms) =>
  availablePurposes(terms, payments).map((o) => o.purpose);

describe('payment purpose availability', () => {
  it('offers the reservation fee first, then the down payment', () => {
    expect(purposes([])).toEqual(['reservation_fee', 'contractual_down_payment']);
    const options = availablePurposes(installmentTerms, []);
    expect(options[0]).toMatchObject({ purpose: 'reservation_fee', amount: '10000.00' });
    expect(options[1]).toMatchObject({ purpose: 'contractual_down_payment', amount: '40000.00' });
  });

  it('never offers the reservation fee again once one is recorded or verified', () => {
    for (const status of ['recorded', 'verified']) {
      expect(purposes([pay('reservation_fee', '10000.00', status)])).not.toContain('reservation_fee');
    }
    // A rejected/voided fee frees it again.
    for (const status of ['rejected', 'voided']) {
      expect(purposes([pay('reservation_fee', '10000.00', status)])).toContain('reservation_fee');
    }
  });

  it('down payment excludes the fee already collected and disappears once one exists', () => {
    const afterFee = availablePurposes(installmentTerms, [pay('reservation_fee', '10000.00')]);
    expect(afterFee.map((o) => o.purpose)).toEqual(['contractual_down_payment']);
    expect(afterFee[0]!.amount).toBe('30000.00');
    const afterDown = [
      pay('reservation_fee', '10000.00'),
      pay('contractual_down_payment', '30000.00', 'recorded'),
    ];
    expect(purposes(afterDown)).not.toContain('contractual_down_payment');
  });

  it('offers installments (monthly amount) and full (exact balance) after the down payment', () => {
    const ledger = [
      pay('reservation_fee', '10000.00'),
      pay('contractual_down_payment', '30000.00'),
    ];
    const options = availablePurposes(installmentTerms, ledger);
    expect(options.map((o) => o.purpose)).toEqual(['contractual_installment', 'contractual_full']);
    expect(options[0]).toMatchObject({ amount: '5000.00', locked: false });
    expect(options[1]).toMatchObject({ amount: '60000.00', locked: true });
  });

  it('counts pending money against the balance and caps the installment', () => {
    const ledger = [
      pay('contractual_down_payment', '40000.00'),
      pay('contractual_installment', '57000.00', 'recorded'),
    ];
    expect(payableBalance(installmentTerms, ledger)).toBe('3000.00');
    const options = availablePurposes(installmentTerms, ledger);
    expect(options.find((o) => o.purpose === 'contractual_installment')).toMatchObject({
      amount: '3000.00',
      max: '3000.00',
    });
    expect(options.find((o) => o.purpose === 'contractual_full')?.amount).toBe('3000.00');
  });

  it('offers nothing once the purchase is fully paid or fully committed', () => {
    expect(purposes([pay('contractual_full', '100000.00')])).toEqual([]);
    expect(purposes([pay('contractual_down_payment', '100000.00', 'recorded')])).toEqual([]);
  });

  it('a spot-cash purchase (no monthly amount) never offers installments', () => {
    const spot = { ...installmentTerms, monthlyAmount: null, installmentMonths: null };
    expect(purposes([pay('reservation_fee', '10000.00')], spot)).toEqual([
      'contractual_down_payment',
      'contractual_full',
    ]);
    expect(purposes([pay('contractual_down_payment', '40000.00')], spot)).toEqual([
      'contractual_full',
    ]);
  });

  it('treats a legacy payment with no purpose as contractual', () => {
    const options = purposes([pay(null, '40000.00')]);
    expect(options).toEqual(['contractual_installment', 'contractual_full']);
  });
});
