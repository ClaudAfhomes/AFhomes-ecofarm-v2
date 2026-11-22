import {
  handlePaymentExtras,
  receiptDetailsOf,
  saveReceiptDetails,
} from '../_lib/payment-extras.js';
import {
  issuePaymentReceiptUploadGrant,
  receiptBelongsTo,
  UUID_PATTERN,
} from '../_lib/payment-receipts.js';
import { saleListQuerySchema, toSale, type SaleMoney } from '../_lib/sale-model.js';
/**
 * AFHomes card sales, payments, and activation.
 *
 * Three rules this handler exists to enforce:
 *  1. Seller identity comes from the resolved principal. `sellerStaffId` in the
 *     body is a REQUEST, honoured only for a target inside the caller's own
 *     downline - never an identity assertion.
 *  2. Money is never accepted from the client. Totals, balances and the sale
 *     status all come from the payment rows via the transactional RPCs.
 *  3. Activation requires full VERIFIED payment, re-checked inside the RPC.
 */
import { z } from 'zod';
import {
  canCreateVipSale,
  recordPaymentSchema,
  verifyPaymentSchema,
  activateSaleSchema,
  canTransitionSale,
  hierarchyAllowsUpline,
  SALE_ACTIVATABLE,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { summarizePayments } from '../_lib/commerce.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
  list,
  mapRpcError,
  method,
  route,
  singleRpcRow,
  singleRpcText,
  subPath,
} from '../_lib/handler-kit.js';
import { DEFAULT_ONBOARDING_TOKEN_VALID_HOURS } from '../_lib/constants.js';
import { customerActivationUrl } from '../_lib/customer-onboarding-url.js';
import { notifyCustomer } from '../_lib/notify.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const parseListQuery = (req: VercelRequest) => saleListQuerySchema.safeParse(req.query);



async function loadSaleView(db: Db, id: string) {
  const { data, error } = await db
    .from('card_sales')
    .select(
      '*, customers!inner(first_name, middle_name, last_name, suffix), card_plans!inner(name, code), staff_users!card_sales_seller_staff_id_fkey(full_name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

async function moneyBySale(
  db: Db,
  rows: Record<string, unknown>[],
): Promise<Map<string, SaleMoney>> {
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from('payments')
    .select('sale_id, amount, status, recorded_at, verified_at')
    .in('sale_id', ids);
  if (error) throw error;

  type Payment = {
    amount: string;
    status: 'recorded' | 'verified' | 'rejected' | 'voided';
    recordedAt?: string;
    verifiedAt?: string | null;
  };
  const payments = new Map<string, Payment[]>();
  for (const payment of (data ?? []) as Record<string, unknown>[]) {
    const saleId = String(payment.sale_id);
    const bucket = payments.get(saleId) ?? [];
    bucket.push({
      amount: String(payment.amount),
      status: String(payment.status) as Payment['status'],
      recordedAt: isoOrNull(payment.recorded_at) ?? undefined,
      verifiedAt: isoOrNull(payment.verified_at),
    });
    payments.set(saleId, bucket);
  }

  return new Map(
    rows.map((row) => {
      const id = String(row.id);
      const summary = summarizePayments({
        cashPrice: String(row.cash_price_snapshot ?? row.cash_price ?? '0.00'),
        minimumDownPayment: String(row.minimum_down_payment_snapshot ?? '0.00'),
        payments: payments.get(id) ?? [],
        spotCashStartedAt: isoOrNull(row.spot_cash_started_at),
        spotCashDeadline: isoOrNull(row.spot_cash_deadline),
      });
      return [id, { paidAmount: summary.verifiedTotal, balance: summary.remainingBalance }];
    }),
  );
}

/**
 * Scope for sale reads (Phase 9 §E).
 *
 * Either finance grant sees every sale. A seller sees only sales where they
 * are the seller of record (`seller_staff_id` or `seller_ost_id`). Anything
 * else is denied by the resolver, so unrelated seller data can never leak
 * through a direct URL - frontend filtering is not the control.
 */
async function resolveSaleScope(req: VercelRequest) {
  const finance = await authorizeAfHomes(req, 'finance.payment_verification');
  const activation = await authorizeAfHomes(req, 'finance.card_activation');
  const canSeeAll = !('error' in finance) || !('error' in activation);
  const auth = canSeeAll
    ? !('error' in finance)
      ? finance
      : activation
    : await authorizeAfHomes(req, 'sales.card_sales');
  return { canSeeAll, auth };
}

/** True when the scoped caller may read this sale row. */
function saleInScope(
  scope: { canSeeAll: boolean; auth: Awaited<ReturnType<typeof authorizeAfHomes>> },
  row: Record<string, unknown>,
): boolean {
  if (scope.canSeeAll) return true;
  if ('error' in scope.auth) return false;
  return row.seller_staff_id === scope.auth.userId || row.seller_ost_id === scope.auth.userId;
}

/** Current money state for an idempotent verification retry (no RPC, no audit). */
async function idempotentVerifyResult(db: Db, saleId: string) {
  const { data: sale, error } = await db
    .from('card_sales')
    .select(
      'id, status, cash_price_snapshot, minimum_down_payment_snapshot, spot_cash_started_at, spot_cash_deadline',
    )
    .eq('id', saleId)
    .maybeSingle();
  if (error) throw error;
  if (!sale) return null;
  const { data: payments, error: payError } = await db
    .from('payments')
    .select('amount, status')
    .eq('sale_id', saleId);
  if (payError) throw payError;
  const totals = summarizePayments({
    cashPrice: (sale as Record<string, unknown>).cash_price_snapshot as string,
    minimumDownPayment: (sale as Record<string, unknown>).minimum_down_payment_snapshot as string,
    requiredInitial:
      ((sale as Record<string, unknown>).required_initial_snapshot as string | null | undefined) ??
      null,
    payments: (payments ?? []) as {
      amount: string;
      status: 'recorded' | 'verified' | 'rejected' | 'voided';
    }[],
    spotCashStartedAt: isoOrNull((sale as Record<string, unknown>).spot_cash_started_at),
    spotCashDeadline: isoOrNull((sale as Record<string, unknown>).spot_cash_deadline),
  });
  return {
    saleId,
    status: (sale as Record<string, unknown>).status,
    verifiedTotal: totals.verifiedTotal,
    remainingBalance: totals.remainingBalance,
    fullyPaid: totals.fullyPaid,
    spotCashDeadline: totals.spotCashDeadline,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (await handlePaymentExtras(req, res, db)) return;
    /* ---------------- list ---------------- */
    if (subPath(req) === '' && method(req) === 'GET') {
      const parsed = parseListQuery(req);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, customerId, productId, limit, offset } = parsed.data;

      // A seller sees only their own sales. Finance/activation staff see every
      // sale. RLS already narrows this; the explicit seller filter makes the
      // intent obvious and keeps the two paths independent.
      const { canSeeAll, auth } = await resolveSaleScope(req);
      if ('error' in auth) return deny(res, auth);

      let query = db
        .from('card_sales')
        .select(
          '*, customers!inner(first_name, middle_name, last_name, suffix), card_plans!inner(name, code), staff_users!card_sales_seller_staff_id_fkey(full_name)',
          { count: 'exact' },
        );
      if (status) query = query.eq('status', status);
      if (customerId) query = query.eq('customer_id', customerId);
      if (productId) query = query.eq('plan_id', productId);
      if (!canSeeAll) query = query.eq('seller_staff_id', auth.userId);

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const money = await moneyBySale(db, rows);
      return res.status(200).json({
        data: rows.map((row) => toSale(row, money.get(String(row.id)))),
        meta: { total: count ?? rows.length, limit, offset },
      });
    }

    /* ---------------- legacy creation ---------------- */
    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'create');
      if ('error' in auth) return deny(res, auth);
      if (!canCreateVipSale(auth))
        return fail(res, 'FORBIDDEN', 'Only an active SM, Admin or Super Admin may originate an application and RA.', 403);
      return fail(
        res,
        'PURCHASE_WORKFLOW_REQUIRED',
        'Create an Application & RA, obtain approval, then finalize the fully verified purchase.',
        409,
      );
    }

    /* ---------------- detail ---------------- */
    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const scope = await resolveSaleScope(req);
      if ('error' in scope.auth) return deny(res, scope.auth);
      const row = await loadSaleView(db, detail[1]!);
      if (!row) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      // A direct URL never bypasses the seller scope: an unrelated sale reads
      // as missing rather than forbidden, so ids cannot be probed.
      if (!saleInScope(scope, row)) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      const money = await moneyBySale(db, [row]);
      return res.status(200).json(toSale(row, money.get(String(row.id))));
    }

    /* ---------------- financial summary ---------------- */
    const summary = route(req, 'GET', /^([0-9a-f-]+)\/summary$/);
    if (summary) {
      const scope = await resolveSaleScope(req);
      if ('error' in scope.auth) return deny(res, scope.auth);
      const id = summary[1]!;
      const { data: sale, error } = await db
        .from('card_sales')
        .select(
          'id, status, seller_staff_id, seller_ost_id, cash_price_snapshot, minimum_down_payment_snapshot, payment_scheme, reservation_fee_snapshot, required_initial_snapshot, installment_months_snapshot, monthly_amount_snapshot, spot_cash_started_at, spot_cash_deadline',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!sale) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      if (!saleInScope(scope, sale)) return fail(res, 'NOT_FOUND', 'Sale not found', 404);

      const { data: payments, error: payError } = await db
        .from('payments')
        .select('amount, status')
        .eq('sale_id', id);
      if (payError) throw payError;

      const months =
        sale.installment_months_snapshot === null || sale.installment_months_snapshot === undefined
          ? null
          : Number(sale.installment_months_snapshot);
      const totals = summarizePayments({
        cashPrice: sale.cash_price_snapshot ?? '0.00',
        minimumDownPayment: sale.minimum_down_payment_snapshot ?? '0.00',
        requiredInitial: (sale.required_initial_snapshot as string | null | undefined) ?? null,
        payments: (payments ?? []) as {
          amount: string;
          status: 'recorded' | 'verified' | 'rejected' | 'voided';
        }[],
        spotCashStartedAt: isoOrNull(sale.spot_cash_started_at),
        spotCashDeadline: isoOrNull(sale.spot_cash_deadline),
      });
      return res.status(200).json({
        saleId: id,
        status: sale.status,
        cashPrice: sale.cash_price_snapshot ?? '0.00',
        minimumDownPayment: sale.minimum_down_payment_snapshot ?? '0.00',
        paymentScheme: (sale.payment_scheme as string | null | undefined) ?? 'spot_cash',
        reservationFee: (sale.reservation_fee_snapshot as string | null | undefined) ?? '0.00',
        requiredInitial:
          (sale.required_initial_snapshot as string | null | undefined) ??
          sale.minimum_down_payment_snapshot ??
          '0.00',
        installmentMonths: months,
        monthlyAmount: (sale.monthly_amount_snapshot as string | null | undefined) ?? null,
        ...totals,
      });
    }

    /* ---------------- payments for a sale ---------------- */
    const salePayments = route(req, 'GET', /^([0-9a-f-]+)\/payments$/);
    if (salePayments) {
      const scope = await resolveSaleScope(req);
      if ('error' in scope.auth) return deny(res, scope.auth);
      const { data: sale, error: saleError } = await db
        .from('card_sales')
        .select('id, seller_staff_id, seller_ost_id')
        .eq('id', salePayments[1]!)
        .maybeSingle();
      if (saleError) throw saleError;
      if (!sale) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      if (!saleInScope(scope, sale)) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      const { data, error } = await db
        .from('payments')
        .select('*')
        .eq('sale_id', salePayments[1]!)
        .order('recorded_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      // Resolve actor UUIDs to display names in one lookup. IDs stay the
      // source of truth; unknown or removed staff read as null upstream.
      const actorIds = [
        ...new Set(
          rows
            .flatMap((row) => [row.recorded_by, row.verified_by])
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      let names = new Map<string, string>();
      if (actorIds.length > 0) {
        const { data: staff, error: staffError } = await db
          .from('staff_users')
          .select('id, full_name')
          .in('id', actorIds);
        if (staffError) throw staffError;
        names = new Map(
          ((staff ?? []) as Record<string, unknown>[]).map((member) => [
            String(member.id),
            String(member.full_name ?? ''),
          ]),
        );
      }
      return list(
        res,
        rows.map((row: Record<string, unknown>) => ({
          id: row.id,
          paymentNumber: (row.payment_number as string | null | undefined) ?? null,
          saleId: row.sale_id,
          customerId: isoOrNull(row.customer_id),
          amount: row.amount,
          paymentType: row.payment_type,
          method: row.method,
          reference: isoOrNull(row.reference),
          notes: isoOrNull(row.notes),
          status: row.status,
          rejectionReason: isoOrNull(row.rejection_reason),
          recordedBy: row.recorded_by,
          verifiedBy: isoOrNull(row.verified_by),
          recordedByName: names.get(String(row.recorded_by)) ?? null,
          verifiedByName:
            typeof row.verified_by === 'string' ? (names.get(row.verified_by) ?? null) : null,
          recordedAt: isoOrNull(row.recorded_at) ?? '',
          verifiedAt: isoOrNull(row.verified_at),
          orNumber: isoOrNull(row.or_number),
          paidOn: row.paid_on ? String(row.paid_on).slice(0, 10) : null,
          paidByName: isoOrNull(row.paid_by_name),
          postingPeriod: isoOrNull(row.posting_period),
          // Required by paymentSchema; the reservation list already emits it.
          paymentPurpose: isoOrNull(row.payment_purpose),
        })),
      );
    }

    /* ---------------- receipt upload grant (before recording) ---------------- */
    const receiptUpload = route(req, 'POST', /^([0-9a-f-]+)\/payments\/receipt-upload$/);
    if (receiptUpload) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      if (!UUID_PATTERN.test(receiptUpload[1]!))
        return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      const { data: sale, error } = await db
        .from('card_sales')
        .select('id')
        .eq('id', receiptUpload[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!sale) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      return issuePaymentReceiptUploadGrant(res, 'sale', String(sale.id), jsonBody(req));
    }

    /* ---------------- record a payment ---------------- */
    const addPayment = route(req, 'POST', /^([0-9a-f-]+)\/payments$/);
    if (addPayment) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = recordPaymentSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid payment', 400);
      const input = parsed.data;
      if (!receiptBelongsTo(input.receiptStoragePath, 'sale', addPayment[1]!))
        return fail(
          res,
          'VALIDATION_ERROR',
          'Upload the receipt for this sale, then record the payment.',
          400,
        );
      if (!input.reference?.trim() && !input.requestId)
        return fail(
          res,
          'VALIDATION_ERROR',
          'A request UUID is required for reference-less payments',
          400,
        );
      const { data, error } = await db.rpc(
        input.requestId ? 'record_card_payment_once' : 'record_card_payment',
        {
          ...(input.requestId ? { p_request_id: input.requestId } : {}),
          p_sale_id: addPayment[1]!,
          p_amount: input.amount,
          p_payment_type: input.paymentType,
          p_method: input.method,
          p_reference: input.reference ?? null,
          p_notes: input.notes ?? null,
          p_receipt_storage_path: input.receiptStoragePath ?? null,
          p_actor_id: auth.userId,
        },
      );
      if (error) return mapRpcError(res, error);
      // OR number, actual payment date and payer are stored on the pending payment.
      const detailsError = await saveReceiptDetails(db, data, auth.userId, receiptDetailsOf(input));
      if (detailsError) return mapRpcError(res, detailsError);
      return res.status(201).json({ id: data });
    }

    /* ---------------- verify / reject a payment ---------------- */
    const verify = route(req, 'POST', /^([0-9a-f-]+)\/verify$/);
    if (verify) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = verifyPaymentSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid verification decision', 400);

      const paymentId = verify[1]!;
      const decision = parsed.data.decision;

      // Idempotency: when the payment row is visible and already carries the
      // requested decision, return the current totals without re-running the
      // RPC (which would double-count, reset the spot-cash window, or duplicate
      // the audit event). A mismatched decision on a decided payment is still
      // a conflict. When the row is not visible here, fall through to the RPC:
      // it remains authoritative for existence (PAYMENT_NOT_FOUND) and for the
      // first transition, so scripted doubles and real races behave alike.
      const { data: existing, error: readError } = await db
        .from('payments')
        .select('id, sale_id, status')
        .eq('id', paymentId)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const existingStatus = String((existing as Record<string, unknown>).status ?? '');
        const existingSaleId = String((existing as Record<string, unknown>).sale_id ?? '');
        if (existingStatus === decision) {
          const current = await idempotentVerifyResult(db, existingSaleId);
          if (current) return res.status(200).json(current);
          // The sale vanished between reads: fall through to the RPC so its
          // authoritative error (SALE_NOT_FOUND) is what the caller sees.
        } else if (existingStatus !== 'recorded') {
          return fail(res, 'CONFLICT', 'payment not pending', 409);
        }
      }

      const { data, error } = await db.rpc('verify_card_payment', {
        p_payment_id: paymentId,
        p_decision: decision,
        p_reason: parsed.data.reason ?? null,
        p_actor_id: auth.userId,
      });
      if (error) {
        // A concurrent verifier may have decided the payment first. If the
        // stored decision now matches the request, the retry is a success.
        if (
          String((error as { message?: string }).message ?? '').startsWith('PAYMENT_NOT_PENDING')
        ) {
          const { data: raced } = await db
            .from('payments')
            .select('id, sale_id, status')
            .eq('id', paymentId)
            .maybeSingle();
          if (raced && String((raced as Record<string, unknown>).status ?? '') === decision) {
            const current = await idempotentVerifyResult(
              db,
              String((raced as Record<string, unknown>).sale_id ?? ''),
            );
            if (current) return res.status(200).json(current);
          }
        }
        return mapRpcError(res, error);
      }
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      // Tell the member once, on the first decision only (retries returned above).
      // No amounts and no rejection reason: the reason is written for staff.
      if (row?.sale_id) {
        const { data: decided } = await db
          .from('card_sales')
          .select('customer_id')
          .eq('id', String(row.sale_id))
          .maybeSingle();
        const customerId = (decided as { customer_id?: string } | null)?.customer_id;
        if (customerId)
          await notifyCustomer(
            db,
            customerId,
            decision === 'verified'
              ? {
                  kind: 'account',
                  title: 'Payment verified',
                  body: 'AF Homes has verified a payment on your card purchase. Thank you.',
                  link: '/customer',
                }
              : {
                  kind: 'account',
                  title: 'A payment could not be verified',
                  body: 'AF Homes could not verify a payment on your card purchase. Please contact AF Homes for details.',
                  link: '/customer',
                },
          );
      }
      return res.status(200).json({
        saleId: row?.sale_id,
        status: row?.status,
        verifiedTotal: row?.verified_total,
        remainingBalance: row?.remaining_balance,
        fullyPaid: row?.fully_paid,
        spotCashDeadline: row?.spot_cash_deadline,
      });
    }

    /* ---------------- activate ---------------- */
    const activate = route(req, 'POST', /^([0-9a-f-]+)\/activate$/);
    if (activate) {
      const auth = await authorizeAfHomes(req, 'finance.card_activation', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = activateSaleSchema.safeParse(jsonBody(req) ?? {});
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid activation request', 400);

      // Read only what the delivery step needs before the transactional RPC.
      // An active sale is allowed through so the RPC can return its idempotent
      // already_active result; every other illegal transition is refused here
      // for a clear message and re-checked authoritatively inside the RPC.
      const { data: sale, error: saleReadError } = await db
        .from('card_sales')
        .select('status, customer_id')
        .eq('id', activate[1]!)
        .maybeSingle();
      if (saleReadError) throw saleReadError;
      if (!sale) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      const status = String((sale as Record<string, unknown>).status ?? '');
      if (status !== 'active' && !SALE_ACTIVATABLE.includes(status as never)) {
        return fail(res, 'CONFLICT', `Sale is not activatable from status "${status}"`, 409);
      }

      const { data, error } = await db.rpc('activate_card_sale', {
        p_sale_id: activate[1]!,
        p_actor_id: auth.userId,
        p_validity_months: parsed.data.validityMonths,
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) return fail(res, 'INTERNAL', 'Activation returned no result', 500);

      type OnboardingDelivery = {
        status: 'email_sent' | 'manual_required' | 'not_issued' | 'already_active';
        emailStatus: 'sent' | 'failed' | 'not_attempted';
        token: string | null;
        activationUrl: string | null;
        expiresAt: string | null;
      };
      let onboarding: OnboardingDelivery = {
        status: row.already_active === true ? 'already_active' : 'not_issued',
        emailStatus: 'not_attempted',
        token: null,
        activationUrl: null,
        expiresAt: null,
      };

      // Customer onboarding is deliberately outside the financial transaction:
      // membership/points/commission activation must remain successful even if
      // token issuance fails. A fresh activation issues once;
      // an idempotent retry never silently rotates or replaces a credential.
      if (row.already_active !== true) {
        const customerId = String((sale as Record<string, unknown>).customer_id ?? '');
        const issued = await db.rpc('issue_customer_onboarding_token', {
          p_customer_id: customerId,
          p_purpose: 'account_activation',
          p_valid_hours: DEFAULT_ONBOARDING_TOKEN_VALID_HOURS,
          p_actor_id: auth.userId,
        });
        const issuedRow = issued.error ? null : singleRpcRow(issued.data);
        const rawToken = issuedRow?.token;
        const expiresAt = issuedRow?.expires_at;

        if (
          typeof rawToken === 'string' &&
          rawToken.length >= 20 &&
          typeof expiresAt === 'string'
        ) {
          const activationUrl = customerActivationUrl(rawToken);
          // In-system only (owner 2026-11-22): the link is never emailed. Finance
          // hands the one-time code or link to the member from this response.
          onboarding = {
            status: 'manual_required',
            emailStatus: 'not_attempted',
            token: rawToken,
            activationUrl,
            expiresAt,
          };

          // The audit payload intentionally contains only lifecycle metadata.
          // Never include the token, token hash, recipient, or activation URL.
          try {
            await audit(
              db,
              auth.userId,
              'CUSTOMER_ONBOARDING_TOKEN_ISSUED',
              'customer',
              customerId,
              null,
              {
                purpose: 'account_activation',
                validHours: DEFAULT_ONBOARDING_TOKEN_VALID_HOURS,
                expiresAt,
                emailStatus: onboarding.emailStatus,
              },
            );
          } catch {
            // Activation and token issuance are already committed. Do not turn
            // a safe one-time response into a false failure or lose the token.
            console.error('[api] sales: onboarding audit write failed');
          }
        } else {
          // Do not log the RPC error: it could contain database detail. The UI
          // receives a safe status and can report that activation still worked.
          console.error('[api] sales: onboarding token issuance failed');
        }
      }

      // Phase 10 card issuance stamp. Informational only and best-effort: the
      // activation above is already committed, so a stamp failure is logged
      // and never fails the activation. Only fresh activations stamp; a repeat
      // (already_active) leaves the original issuance moment untouched.
      if (row.already_active !== true && row.membership_id) {
        const { error: stampError } = await db
          .from('memberships')
          .update({ card_issued_at: new Date().toISOString(), card_issued_by: auth.userId })
          .eq('id', row.membership_id);
        if (stampError) {
          // eslint-disable-next-line no-console
          console.error(
            '[api] sales: card issuance stamp failed:',
            stampError instanceof Error ? stampError.message : stampError,
          );
        }
      }

      // In-app notice for the member (no email is sent from notifications).
      if (row.already_active !== true)
        await notifyCustomer(db, String((sale as Record<string, unknown>).customer_id ?? ''), {
          kind: 'account',
          title: 'Your AF Homes card is active',
          body: 'Your membership is now active. Your card and points are ready in your account.',
          link: '/customer',
        });

      return res.status(200).json({
        membershipId: row.membership_id,
        membershipNumber: row.membership_number,
        fallbackCode: row.fallback_code,
        qrToken: row.qr_token,
        pointsAllocated: Number(row.points_allocated ?? 0),
        alreadyActive: row.already_active === true,
        onboarding,
      });
    }

    /* ---------------- cancel (draft only, never destroy) ---------------- */
    const cancel = route(req, 'POST', /^([0-9a-f-]+)\/cancel$/);
    if (cancel) {
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'update');
      if ('error' in auth) return deny(res, auth);
      const scope = await resolveSaleScope(req);
      const id = cancel[1]!;
      const { data: sale, error: saleError } = await db
        .from('card_sales')
        .select('id, status, seller_staff_id, seller_ost_id')
        .eq('id', id)
        .maybeSingle();
      if (saleError) throw saleError;
      if (!sale) return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      const row = sale as Record<string, unknown>;
      // Same no-probe convention as the detail read: an out-of-scope sale
      // reads as missing rather than forbidden.
      if (
        !scope.canSeeAll &&
        row.seller_staff_id !== auth.userId &&
        row.seller_ost_id !== auth.userId
      )
        return fail(res, 'NOT_FOUND', 'Sale not found', 404);
      const status = String(row.status ?? '');
      // Draft-only by business rule: a sale that has moved is corrected
      // through payments/activation flows, never by cancelling.
      if (status !== 'draft')
        return fail(res, 'CONFLICT', `Only draft sales can be cancelled (status "${status}")`, 409);
      if (!canTransitionSale(status as never, 'cancelled'))
        return fail(res, 'CONFLICT', `Sale cannot move to cancelled from "${status}"`, 409);
      for (const paymentStatus of ['recorded', 'verified']) {
        const { data: payment, error: paymentError } = await db
          .from('payments')
          .select('id')
          .eq('sale_id', id)
          .eq('status', paymentStatus)
          .limit(1);
        if (paymentError) throw paymentError;
        if ((payment ?? []).length > 0)
          return fail(res, 'CONFLICT', 'Sale has payments and cannot be cancelled', 409);
      }
      const { data: membership, error: membershipError } = await db
        .from('memberships')
        .select('id')
        .eq('sale_id', id)
        .limit(1);
      if (membershipError) throw membershipError;
      if ((membership ?? []).length > 0)
        return fail(res, 'CONFLICT', 'Sale has a membership and cannot be cancelled', 409);
      const { data: commissions, error: commissionsError } = await db
        .from('commissions')
        .select('id')
        .eq('sale_id', id)
        .neq('status', 'cancelled')
        .limit(1);
      if (commissionsError) throw commissionsError;
      if ((commissions ?? []).length > 0)
        return fail(res, 'CONFLICT', 'Sale has commissions and cannot be cancelled', 409);
      const { data: cancelled, error: cancelError } = await db
        .from('card_sales')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle();
      if (cancelError) throw cancelError;
      if (!cancelled)
        return fail(
          res,
          'CONFLICT',
          'Sale changed during cancellation. Refresh and try again.',
          409,
        );
      await audit(
        db,
        auth.userId,
        'SALE_CANCELLED',
        'sale',
        id,
        { status },
        { status: 'cancelled' },
      );
      const view = await loadSaleView(db, id);
      if (!view) return fail(res, 'INTERNAL', 'Sale was cancelled but could not be read back', 500);
      const money = await moneyBySale(db, [view]);
      return res.status(200).json(toSale(view, money.get(id)));
    }

    return fail(res, 'NOT_FOUND', 'Sale endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] sales:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}

export { hierarchyAllowsUpline };
