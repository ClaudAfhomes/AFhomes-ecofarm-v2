import { summarizePayments } from './commerce.js';
import { SALE_ACTIVATABLE } from '@afhomes/contracts';
import { isoOrNull } from './handler-kit.js';
export type QueueRow = {
  id: string;
  sale_number: string;
  status: string;
  cash_price_snapshot: string | null;
  minimum_down_payment_snapshot: string | null;
  payment_scheme: string | null;
  reservation_fee_snapshot: string | null;
  required_initial_snapshot: string | null;
  installment_months_snapshot: number | null;
  monthly_amount_snapshot: string | null;
  validity_months_snapshot: number | null;
  spot_cash_started_at: string | null;
  spot_cash_deadline: string | null;
  customer_id: string;
  customerName: string;
  productName: string;
  payments: { amount: string; status: 'recorded' | 'verified' | 'rejected' | 'voided' }[];
};

export function shape(row: QueueRow) {
  const totals = summarizePayments({
    cashPrice: row.cash_price_snapshot ?? '0.00',
    minimumDownPayment: row.minimum_down_payment_snapshot ?? '0.00',
    requiredInitial: row.required_initial_snapshot ?? null,
    payments: row.payments,
    spotCashStartedAt: isoOrNull(row.spot_cash_started_at),
    spotCashDeadline: isoOrNull(row.spot_cash_deadline),
  });
  return {
    // The merged queue is a discriminated union; the sale branch keeps every
    // existing field untouched.
    origin: 'sale' as const,
    saleId: row.id,
    saleNumber: row.sale_number,
    customerId: row.customer_id,
    customerName: row.customerName,
    productName: row.productName,
    status: row.status,
    cashPrice: row.cash_price_snapshot ?? '0.00',
    paymentScheme: row.payment_scheme ?? 'spot_cash',
    reservationFee: row.reservation_fee_snapshot ?? '0.00',
    requiredInitial: row.required_initial_snapshot ?? row.minimum_down_payment_snapshot ?? '0.00',
    installmentMonths: row.installment_months_snapshot,
    monthlyAmount: row.monthly_amount_snapshot,
    validityMonths: row.validity_months_snapshot,
    ...totals,
    firstVerifiedPayment: isoOrNull(row.spot_cash_started_at),
    activatable: SALE_ACTIVATABLE.includes(row.status as never) && totals.fullyPaid,
  };
}
