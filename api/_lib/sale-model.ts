import { z } from 'zod';
import { isoOrNull } from './handler-kit.js';
export type SaleMoney = { paidAmount: string; balance: string };
export const saleListQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  customerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const toSale = (row: Record<string, unknown>, money?: SaleMoney) => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  const seller = (row.staff_users ?? {}) as Record<string, unknown>;
  const months =
    row.installment_months_snapshot === null || row.installment_months_snapshot === undefined
      ? null
      : Number(row.installment_months_snapshot);
  const validity =
    row.validity_months_snapshot === null || row.validity_months_snapshot === undefined
      ? null
      : Number(row.validity_months_snapshot);
  return {
    id: row.id,
    saleNumber: row.sale_number,
    customerId: row.customer_id,
    customerName:
      [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
        .filter((p) => typeof p === 'string' && p)
        .join(' ') || 'Unknown customer',
    productId: row.plan_id,
    productName: product.name ?? 'Unknown product',
    productCode: product.code ?? '',
    status: row.status,
    sellerStaffId: isoOrNull(row.seller_staff_id),
    sellerName: isoOrNull(seller.full_name),
    cashPrice: row.cash_price_snapshot ?? row.cash_price ?? '0.00',
    minimumDownPayment: row.minimum_down_payment_snapshot ?? '0.00',
    paymentScheme: row.payment_scheme ?? 'spot_cash',
    reservationFee: row.reservation_fee_snapshot ?? '0.00',
    requiredInitial: row.required_initial_snapshot ?? row.minimum_down_payment_snapshot ?? '0.00',
    installmentMonths: months,
    monthlyAmount: (row.monthly_amount_snapshot as string | null | undefined) ?? null,
    validityMonths: validity,
    yearlyPoints: row.yearly_points_snapshot ?? 0,
    commissionRate: row.commission_rate_snapshot ?? '0.0400',
    expectedCommission: row.expected_commission_snapshot ?? '0.00',
    paidAmount: money?.paidAmount ?? '0.00',
    balance: money?.balance ?? String(row.cash_price_snapshot ?? row.cash_price ?? '0.00'),
    spotCashDeadline: isoOrNull(row.spot_cash_deadline),
    submittedAt: isoOrNull(row.submitted_at),
    paymentVerifiedAt: isoOrNull(row.payment_verified_at),
    activatedAt: isoOrNull(row.activated_at),
    createdAt: isoOrNull(row.created_at) ?? '',
  };
};
