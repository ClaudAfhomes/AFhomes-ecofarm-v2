/**
 * AF Homes card sales, payments, and activation.
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
  createSaleSchema,
  recordPaymentSchema,
  verifyPaymentSchema,
  activateSaleSchema,
  hierarchyAllowsUpline,
  SALE_ACTIVATABLE,
} from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { productSaleRejection, resolveSeller, snapshotSaleTerms } from '../_lib/commerce.js';
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
  subPath,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const listQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const parseListQuery = (req: VercelRequest) => listQuerySchema.safeParse(req.query);

/** Staff ids the actor may sell on behalf of: themselves plus their downline. */
async function downlineOf(db: Db, uplineId: string): Promise<string[]> {
  const { data } = await db
    .from('referral_relationships')
    .select('subject_staff_id')
    .eq('upline_staff_id', uplineId)
    .eq('is_active', true);
  const direct = (data ?? []).map((row: { subject_staff_id: string }) => row.subject_staff_id);
  // One level deep is enough for Phase 2 selling scope; deeper chains resolve
  // through the same table in the Genealogy phase.
  const out = new Set<string>([uplineId, ...direct]);
  for (const id of direct) {
    const { data: deeper } = await db
      .from('referral_relationships')
      .select('subject_staff_id')
      .eq('upline_staff_id', id)
      .eq('is_active', true);
    for (const row of (deeper ?? []) as { subject_staff_id: string }[])
      out.add(row.subject_staff_id);
  }
  return [...out];
}

async function loadSaleView(db: Db, id: string) {
  const { data, error } = await db
    .from('card_sales')
    .select(
      '*, customers!inner(full_name, first_name, middle_name, last_name, suffix), card_plans!inner(name, code), staff_users!card_sales_seller_staff_id_fkey(full_name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
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

const toSale = (row: Record<string, unknown>) => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  const seller = (row.staff_users ?? {}) as Record<string, unknown>;
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
    yearlyPoints: row.yearly_points_snapshot ?? 0,
    commissionRate: row.commission_rate_snapshot ?? '0.0400',
    expectedCommission: row.expected_commission_snapshot ?? '0.00',
    spotCashDeadline: isoOrNull(row.spot_cash_deadline),
    submittedAt: isoOrNull(row.submitted_at),
    paymentVerifiedAt: isoOrNull(row.payment_verified_at),
    activatedAt: isoOrNull(row.activated_at),
    createdAt: isoOrNull(row.created_at) ?? '',
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    /* ---------------- list ---------------- */
    if (subPath(req) === '' && method(req) === 'GET') {
      const parsed = parseListQuery(req);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, customerId, limit, offset } = parsed.data;

      // A seller sees only their own sales. Finance/activation staff see every
      // sale. RLS already narrows this; the explicit seller filter makes the
      // intent obvious and keeps the two paths independent.
      const { canSeeAll, auth } = await resolveSaleScope(req);
      if ('error' in auth) return deny(res, auth);

      let query = db
        .from('card_sales')
        .select(
          '*, customers!inner(full_name, first_name, middle_name, last_name, suffix), card_plans!inner(name, code), staff_users!card_sales_seller_staff_id_fkey(full_name)',
          { count: 'exact' },
        );
      if (status) query = query.eq('status', status);
      if (customerId) query = query.eq('customer_id', customerId);
      if (!canSeeAll) query = query.eq('seller_staff_id', auth.userId);

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => toSale(row)),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    /* ---------------- create ---------------- */
    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = createSaleSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid sale request', 400);
      const input = parsed.data;

      const { data: product, error: productError } = await db
        .from('card_plans')
        .select('*')
        .eq('id', input.productId)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return fail(res, 'NOT_FOUND', 'Card product not found', 404);

      const rejection = productSaleRejection({
        isActive: product.is_active === true,
        cashPrice: product.cash_price,
        minimumDownPayment: product.minimum_down_payment,
      });
      if (rejection) return fail(res, 'CONFLICT', rejection.replace(/_/g, ' ').toLowerCase(), 409);

      const { data: customer, error: customerError } = await db
        .from('customers')
        .select('id, status')
        .eq('id', input.customerId)
        .maybeSingle();
      if (customerError) throw customerError;
      if (!customer) return fail(res, 'NOT_FOUND', 'Customer not found', 404);
      if (customer.status === 'cancelled')
        return fail(res, 'CONFLICT', 'A cancelled customer cannot buy a card', 409);

      // Seller resolution - the anti-spoofing gate.
      const downline = await downlineOf(db, auth.userId);
      let target: { staffId: string; roleSlug: string; status: string } | null = null;
      if (input.sellerStaffId && input.sellerStaffId !== auth.userId) {
        const { data: sellerRow } = await db
          .from('staff_users')
          .select('id, status')
          .eq('id', input.sellerStaffId)
          .maybeSingle();
        if (sellerRow) {
          const { data: assignment } = await db
            .from('staff_role_assignments')
            .select('role_id')
            .eq('staff_id', sellerRow.id)
            .maybeSingle();
          const { data: role } = assignment
            ? await db.from('roles').select('slug').eq('id', assignment.role_id).maybeSingle()
            : { data: null };
          target = {
            staffId: sellerRow.id,
            roleSlug: String((role as { slug?: string } | null)?.slug ?? ''),
            status: String(sellerRow.status ?? ''),
          };
        }
      }
      const seller = resolveSeller({
        actorId: auth.userId,
        actorRole: auth.roleSlug,
        requestedSellerId: input.sellerStaffId,
        target,
        downlineIds: downline,
      });
      if ('error' in seller) {
        return fail(res, 'FORBIDDEN', seller.error.replace(/_/g, ' ').toLowerCase(), 403);
      }

      // Upline comes from the seller's own authoritative relationship, never
      // from the request body.
      const { data: relationship } = await db
        .from('referral_relationships')
        .select('*')
        .eq('subject_staff_id', seller.staffId)
        .eq('is_active', true)
        .maybeSingle();

      const { data: sequence, error: seqError } = await db.rpc('next_sale_number');
      if (seqError) return mapRpcError(res, seqError);
      const saleNumber = String((sequence as { sale_number?: string })?.sale_number ?? '');

      const terms = snapshotSaleTerms({
        id: product.id,
        isActive: product.is_active === true,
        cashPrice: product.cash_price,
        minimumDownPayment: product.minimum_down_payment,
        yearlyPoints: product.yearly_points,
        commissionRate: product.commission_rate,
      });
      const now = new Date().toISOString();

      const { data: sale, error: saleError } = await db
        .from('card_sales')
        .insert({
          sale_number: saleNumber,
          customer_id: input.customerId,
          plan_id: input.productId,
          seller_type: 'staff',
          seller_staff_id: seller.staffId,
          seller_ost_id: null,
          // Snapshot columns are written explicitly, never spread: the commercial
          // terms must be frozen on the sale at creation.
          cash_price: terms.cashPriceSnapshot,
          cash_price_snapshot: terms.cashPriceSnapshot,
          minimum_down_payment_snapshot: terms.minimumDownPaymentSnapshot,
          yearly_points_snapshot: terms.yearlyPointsSnapshot,
          commission_rate_snapshot: terms.commissionRateSnapshot,
          expected_commission_snapshot: terms.expectedCommissionSnapshot,
          status: 'submitted',
          submitted_at: now,
          balance_due_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          referral_relationship_id: relationship?.id ?? null,
          created_by: auth.userId,
        })
        .select('*')
        .single();
      if (saleError) {
        if ((saleError as { code?: string }).code === '23505')
          return fail(
            res,
            'CONFLICT',
            'This customer already has an open application for this card',
            409,
          );
        throw saleError;
      }

      // One commission per sale, created pending. Never earned here.
      const { error: commissionError } = await db.from('commissions').insert({
        sale_id: sale.id,
        ost_id: null,
        beneficiary_type: 'staff',
        beneficiary_staff_id: seller.staffId,
        amount: terms.expectedCommissionSnapshot,
        rate_snapshot: terms.commissionRateSnapshot,
        basis_amount_snapshot: terms.cashPriceSnapshot,
        status: 'pending',
      });
      if (commissionError) throw commissionError;

      await audit(db, auth.userId, 'APPLICATION_SUBMITTED', 'card_sale', String(sale.id), null, {
        saleNumber,
        customerId: input.customerId,
        productId: input.productId,
        sellerStaffId: seller.staffId,
        expectedCommission: terms.expectedCommissionSnapshot,
      });

      const view = await loadSaleView(db, String(sale.id));
      if (!view) return fail(res, 'INTERNAL', 'Sale was created but could not be read back', 500);
      return res.status(201).json(toSale(view));
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
      return res.status(200).json(toSale(row));
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
          'id, status, seller_staff_id, seller_ost_id, cash_price_snapshot, minimum_down_payment_snapshot, spot_cash_started_at, spot_cash_deadline',
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

      const totals = summarizePayments({
        cashPrice: sale.cash_price_snapshot ?? '0.00',
        minimumDownPayment: sale.minimum_down_payment_snapshot ?? '0.00',
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
      return list(
        res,
        (data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id,
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
          recordedAt: isoOrNull(row.recorded_at) ?? '',
          verifiedAt: isoOrNull(row.verified_at),
        })),
      );
    }

    /* ---------------- record a payment ---------------- */
    const addPayment = route(req, 'POST', /^([0-9a-f-]+)\/payments$/);
    if (addPayment) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = recordPaymentSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid payment', 400);
      const input = parsed.data;

      const { data, error } = await db.rpc('record_card_payment', {
        p_sale_id: addPayment[1]!,
        p_amount: input.amount,
        p_payment_type: input.paymentType,
        p_method: input.method,
        p_reference: input.reference ?? null,
        p_notes: input.notes ?? null,
        p_receipt_storage_path: input.receiptStoragePath ?? null,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
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

      const { data, error } = await db.rpc('verify_card_payment', {
        p_payment_id: verify[1]!,
        p_decision: parsed.data.decision,
        p_reason: parsed.data.reason ?? null,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
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

      const { data, error } = await db.rpc('activate_card_sale', {
        p_sale_id: activate[1]!,
        p_actor_id: auth.userId,
        p_validity_months: parsed.data.validityMonths,
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) return fail(res, 'INTERNAL', 'Activation returned no result', 500);

      // Server-side pre-check for a clearer message; the RPC re-verifies inside
      // the transaction, so this is UX only and can never be the gate.
      const { data: sale } = await db
        .from('card_sales')
        .select('status')
        .eq('id', activate[1]!)
        .maybeSingle();
      const status = String((sale as { status?: string } | null)?.status ?? '');
      if (!SALE_ACTIVATABLE.includes(status as never) && row.already_active !== true) {
        return fail(res, 'CONFLICT', `Sale is not activatable from status "${status}"`, 409);
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

      return res.status(200).json({
        membershipId: row.membership_id,
        membershipNumber: row.membership_number,
        fallbackCode: row.fallback_code,
        qrToken: row.qr_token,
        pointsAllocated: Number(row.points_allocated ?? 0),
        alreadyActive: row.already_active === true,
      });
    }

    return fail(res, 'NOT_FOUND', 'Sale endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] sales:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}

export { hierarchyAllowsUpline };
