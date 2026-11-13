import type { PaymentType, RecordPaymentRequest } from '@afhomes/contracts';
import { addMoney, compareMoney, subtractMoney } from '@afhomes/shared';

/**
 * Which payment purposes are still valid for a purchase, derived ONLY from
 * data the Payment Queue already loads (frozen terms + the payment ledger).
 * UX guidance: the server re-checks every rule (RESERVATION_FEE_ALREADY_RECORDED,
 * DOWN_PAYMENT_ALREADY_RECORDED, FULL_PAYMENT_MUST_SETTLE_BALANCE,
 * OVERPAYMENT_NOT_ALLOWED, PURCHASE_FULLY_PAID).
 */

export type PaymentPurpose = NonNullable<RecordPaymentRequest['paymentPurpose']>;

export const PAYMENT_PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  reservation_fee: 'Reservation payment',
  contractual_down_payment: 'Down payment',
  contractual_installment: 'Monthly installment',
  contractual_full: 'Full payment (remaining balance)',
};

/** The ledger type is derived from the purpose (the server enforces the same map). */
export const PURPOSE_PAYMENT_TYPE: Record<PaymentPurpose, PaymentType> = {
  reservation_fee: 'installment',
  contractual_down_payment: 'down_payment',
  contractual_installment: 'installment',
  contractual_full: 'full',
};

export interface PurchaseTerms {
  total: string;
  reservationFee: string;
  requiredInitial: string;
  monthlyAmount?: string | null;
  installmentMonths?: number | null;
}

export interface LedgerPayment {
  amount: string;
  status: string;
  paymentPurpose: PaymentPurpose | null;
}

export interface PurposeOption {
  purpose: PaymentPurpose;
  label: string;
  /** Next amount due for this purpose (the pre-fill). */
  amount: string;
  /** Largest amount the form accepts. */
  max: string;
  /** True when the amount is fixed (full payment = exact remaining balance). */
  locked: boolean;
}

const ZERO = '0.00';
const isActive = (payment: LedgerPayment) =>
  payment.status === 'recorded' || payment.status === 'verified';
const sum = (payments: LedgerPayment[]) =>
  payments.reduce((total, payment) => addMoney(total, payment.amount), ZERO);
const min = (a: string, b: string) => (compareMoney(a, b) <= 0 ? a : b);

/** Money still payable: total minus verified AND pending (recorded) payments. */
export function payableBalance(terms: PurchaseTerms, payments: LedgerPayment[]): string {
  const remaining = subtractMoney(terms.total, sum(payments.filter(isActive)));
  return compareMoney(remaining, ZERO) > 0 ? remaining : ZERO;
}

export interface NextStep {
  key: 'reservation' | 'down' | 'installment' | 'full' | 'finalize' | 'activate' | 'none';
  label: string;
  /** The purpose to pre-select when the record dialog opens for this step. */
  purpose?: PaymentPurpose;
}

/**
 * The single next step for a queue row, from figures the list already has
 * (verified money against the frozen terms). Pending, unverified payments are
 * not visible here; the record dialog re-derives validity from the ledger.
 */
export function nextPaymentStep(item: {
  origin: 'sale' | 'reservation';
  reservationFee: string;
  requiredInitial: string;
  monthlyAmount: string | null;
  verifiedTotal: string;
  remainingBalance: string;
  fullyPaid: boolean;
  activatable?: boolean;
}): NextStep {
  if (item.fullyPaid || compareMoney(item.remainingBalance, ZERO) <= 0) {
    if (item.origin === 'reservation') return { key: 'finalize', label: 'Finalize purchase' };
    return item.activatable
      ? { key: 'activate', label: 'Activate' }
      : { key: 'none', label: 'Awaiting activation' };
  }
  if (
    compareMoney(item.reservationFee, ZERO) > 0 &&
    compareMoney(item.verifiedTotal, item.reservationFee) < 0
  )
    return { key: 'reservation', label: 'Record reservation payment', purpose: 'reservation_fee' };
  if (compareMoney(item.verifiedTotal, item.requiredInitial) < 0)
    return { key: 'down', label: 'Record down payment', purpose: 'contractual_down_payment' };
  return item.monthlyAmount
    ? { key: 'installment', label: 'Record installment', purpose: 'contractual_installment' }
    : { key: 'full', label: 'Record full payment', purpose: 'contractual_full' };
}

export function availablePurposes(terms: PurchaseTerms, payments: LedgerPayment[]): PurposeOption[] {
  const active = payments.filter(isActive);
  const remaining = payableBalance(terms, payments);
  if (compareMoney(remaining, ZERO) <= 0) return [];
  const feePayments = active.filter((p) => p.paymentPurpose === 'reservation_fee');
  // A payment with no recorded purpose is a legacy contractual payment.
  const contractual = active.filter((p) => p.paymentPurpose !== 'reservation_fee');
  const hasDown = contractual.some(
    (p) => p.paymentPurpose === 'contractual_down_payment' || p.paymentPurpose === null,
  );
  const options: PurposeOption[] = [];

  if (
    feePayments.length === 0 &&
    contractual.length === 0 &&
    compareMoney(terms.reservationFee, ZERO) > 0 &&
    compareMoney(terms.reservationFee, remaining) <= 0
  ) {
    options.push({
      purpose: 'reservation_fee',
      label: PAYMENT_PURPOSE_LABEL.reservation_fee,
      amount: terms.reservationFee,
      max: terms.reservationFee,
      locked: false,
    });
  }
  if (contractual.length === 0) {
    // The required initial includes the reservation fee already collected.
    const owed = subtractMoney(terms.requiredInitial, sum(feePayments));
    const due = compareMoney(owed, ZERO) > 0 ? min(owed, remaining) : ZERO;
    if (compareMoney(due, ZERO) > 0)
      options.push({
        purpose: 'contractual_down_payment',
        label: PAYMENT_PURPOSE_LABEL.contractual_down_payment,
        amount: due,
        max: remaining,
        locked: false,
      });
  }
  if (hasDown && terms.monthlyAmount && terms.installmentMonths) {
    options.push({
      purpose: 'contractual_installment',
      label: PAYMENT_PURPOSE_LABEL.contractual_installment,
      amount: min(terms.monthlyAmount, remaining),
      max: remaining,
      locked: false,
    });
  }
  if (contractual.length > 0 || !terms.monthlyAmount) {
    options.push({
      purpose: 'contractual_full',
      label: PAYMENT_PURPOSE_LABEL.contractual_full,
      amount: remaining,
      max: remaining,
      locked: true,
    });
  }
  return options;
}
