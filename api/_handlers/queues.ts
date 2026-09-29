/**
 * AF Homes operational queues: Finance payment handling and activation readiness.
 *
 * Every total here is computed server-side from the payment rows. No client can
 * supply or influence a paid total, a balance, or an activation decision.
 */
import { z } from 'zod';
import { summarizePayments } from '../_lib/commerce.js';
import { SALE_ACTIVATABLE } from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  deny,
  fail,
  isoOrNull,
  type Db,
  mapRpcError,
  method,
  subPath,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const parseListQuery = (req: VercelRequest) =>
  z
    .object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse(req.query);

type QueueRow = {
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

const SELECT_QUEUE =
  'id, sale_number, status, cash_price_snapshot, minimum_down_payment_snapshot, payment_scheme, reservation_fee_snapshot, required_initial_snapshot, installment_months_snapshot, monthly_amount_snapshot, validity_months_snapshot, spot_cash_started_at, spot_cash_deadline, customer_id, customers!inner(first_name, middle_name, last_name, suffix), card_plans!inner(name)';

function shape(row: QueueRow) {
  const totals = summarizePayments({
    cashPrice: row.cash_price_snapshot ?? '0.00',
    minimumDownPayment: row.minimum_down_payment_snapshot ?? '0.00',
    requiredInitial: row.required_initial_snapshot ?? null,
    payments: row.payments,
    spotCashStartedAt: isoOrNull(row.spot_cash_started_at),
    spotCashDeadline: isoOrNull(row.spot_cash_deadline),
  });
  return {
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

async function buildQueue(db: Db, statuses: string[], limit: number, offset: number) {
  const { data, error, count } = await db
    .from('card_sales')
    .select(SELECT_QUEUE, { count: 'exact' })
    .in('status', statuses)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const saleIds = (data ?? []).map((row: { id: string }) => row.id);
  const paymentsBySale = new Map<string, QueueRow['payments']>();
  if (saleIds.length > 0) {
    const { data: payments, error: payError } = await db
      .from('payments')
      .select('sale_id, amount, status')
      .in('sale_id', saleIds);
    if (payError) throw payError;
    for (const payment of (payments ?? []) as {
      sale_id: string;
      amount: string;
      status: 'recorded' | 'verified' | 'rejected' | 'voided';
    }[]) {
      const bucket = paymentsBySale.get(payment.sale_id) ?? [];
      bucket.push({ amount: payment.amount, status: payment.status });
      paymentsBySale.set(payment.sale_id, bucket);
    }
  }

  const rows: QueueRow[] = (data ?? []).map((row: Record<string, unknown>) => {
    const customer = (row.customers ?? {}) as Record<string, unknown>;
    const product = (row.card_plans ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      sale_number: String(row.sale_number),
      status: String(row.status),
      cash_price_snapshot: (row.cash_price_snapshot as string | null) ?? null,
      minimum_down_payment_snapshot: (row.minimum_down_payment_snapshot as string | null) ?? null,
      payment_scheme: (row.payment_scheme as string | null) ?? null,
      reservation_fee_snapshot: (row.reservation_fee_snapshot as string | null) ?? null,
      required_initial_snapshot: (row.required_initial_snapshot as string | null) ?? null,
      installment_months_snapshot:
        row.installment_months_snapshot === null || row.installment_months_snapshot === undefined
          ? null
          : Number(row.installment_months_snapshot),
      monthly_amount_snapshot: (row.monthly_amount_snapshot as string | null) ?? null,
      validity_months_snapshot:
        row.validity_months_snapshot === null || row.validity_months_snapshot === undefined
          ? null
          : Number(row.validity_months_snapshot),
      spot_cash_started_at: isoOrNull(row.spot_cash_started_at),
      spot_cash_deadline: isoOrNull(row.spot_cash_deadline),
      customer_id: String(row.customer_id),
      customerName:
        [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
          .filter((p) => typeof p === 'string' && p)
          .join(' ') || 'Unknown customer',
      productName: String(product.name ?? 'Unknown product'),
      payments: paymentsBySale.get(String(row.id)) ?? [],
    };
  });

  return {
    data: rows.map(shape),
    meta: { total: count ?? rows.length, limit, offset },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Queue endpoint not found', 404);
    const parsed = parseListQuery(req);
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
    const { limit, offset } = parsed.data;

    if (subPath(req) === 'finance') {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification');
      if ('error' in auth) return deny(res, auth);
      // Awaiting money, or money that has been recorded but not yet verified.
      const queue = await buildQueue(
        db,
        ['submitted', 'payment_pending', 'payment_in_progress', 'overdue'],
        limit,
        offset,
      );
      return res.status(200).json(queue);
    }

    if (subPath(req) === 'activation') {
      const auth = await authorizeAfHomes(req, 'finance.card_activation');
      if ('error' in auth) return deny(res, auth);
      // Fully paid, awaiting activation.
      const queue = await buildQueue(db, ['payment_verified', 'activation_pending'], limit, offset);
      return res.status(200).json(queue);
    }

    return fail(res, 'NOT_FOUND', 'Queue endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] queues:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
