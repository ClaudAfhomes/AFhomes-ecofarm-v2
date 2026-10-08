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
  canTransitionSale,
  hierarchyAllowsUpline,
  paymentSchemeLabel,
  SALE_ACTIVATABLE,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  calculateCommission,
  productSaleRejection,
  resolveSeller,
  resolveSchemeEconomics,
  snapshotSaleTerms,
  snapshotSchemeTerms,
} from '../_lib/commerce.js';
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
import { sendCustomerOnboardingEmail } from '../_lib/customer-onboarding-email.js';
import { customerActivationUrl } from '../_lib/customer-onboarding-url.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const listQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  customerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
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

/**
 * A plan's category must be active for a NEW application. A missing category
 * row fails closed (not sellable) rather than assumed.
 */
async function categoryIsActive(db: Db, categoryId: unknown): Promise<boolean> {
  const { data, error } = await db
    .from('card_categories')
    .select('is_active')
    .eq('id', String(categoryId ?? ''))
    .maybeSingle();
  if (error) throw error;
  return (data as { is_active?: unknown } | null)?.is_active === true;
}

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

type SaleMoney = { paidAmount: string; balance: string };

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

const toSale = (row: Record<string, unknown>, money?: SaleMoney) => {
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

      const rejection = productSaleRejection(
        {
          isActive: product.is_active === true,
          cashPrice: product.cash_price,
          minimumDownPayment: product.minimum_down_payment,
        },
        // A plan is selectable for a NEW application only when its category
        // is active too. A missing category fails closed: not sellable.
        (await categoryIsActive(db, product.category_id)) === true,
      );
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

      // Launch restriction D-12: one membership per customer. The schema
      // enforces a single membership row per customer, so without this
      // creation-time guard a second sale could reach full payment and then
      // strand at activation with money attached. Refuse before any sale row
      // (and therefore any payment) exists. Any status counts: even a
      // non-active membership row would still collide at activation.
      const { data: existingMembership, error: membershipError } = await db
        .from('memberships')
        .select('id')
        .eq('customer_id', input.customerId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (existingMembership)
        return fail(
          res,
          'CONFLICT',
          'This customer already has an active membership. Only one membership per customer is supported at launch.',
          409,
        );

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
      // next_sale_number() is RETURNS TABLE, so live PostgREST answers with a
      // one-row array. A missing or blank number is a generation failure: the
      // sale must fail BEFORE the row is inserted, never persist a blank.
      const saleNumber = singleRpcText(sequence, 'sale_number');
      if (!saleNumber) return fail(res, 'INTERNAL', 'Sale number generation failed', 500);

      const saleDate = new Date().toISOString().slice(0, 10);
      const { data: resolvedRule, error: ruleError } = await db.rpc('resolve_commission_rule', {
        p_seller_type: 'staff',
        p_seller_id: seller.staffId,
        p_sale_date: saleDate,
      });
      // Deployment compatibility only: code may briefly run before the
      // unapplied migration exists. Once the resolver exists, its explicit
      // account -> role -> zero result is authoritative. Other RPC failures
      // still fail closed.
      if (ruleError && (ruleError as { code?: string }).code !== '42883')
        return mapRpcError(res, ruleError);
      const commissionRule = singleRpcRow(resolvedRule) as Record<string, unknown> | null;
      const resolvedCommissionRate = String(
        commissionRule?.rate ?? (ruleError ? product.commission_rate : '0'),
      );
      const commissionRuleId =
        typeof commissionRule?.rule_id === 'string' ? commissionRule.rule_id : null;

      const terms = snapshotSaleTerms({
        id: product.id,
        isActive: product.is_active === true,
        cashPrice: product.cash_price,
        minimumDownPayment: product.minimum_down_payment,
        yearlyPoints: product.yearly_points,
        commissionRate: resolvedCommissionRate,
      });
      // VIP Stage 1: the client selects only the scheme code. Every figure is
      // resolved server-side from the plan row and frozen below, so a tampered
      // body cannot change what a sale costs. Bronze B1/B2 is rejected here -
      // the UI hiding those options is never the control.
      const scheme = resolveSchemeEconomics(
        {
          cashPrice: product.cash_price,
          installmentPrice: product.installment_price,
          reservationFee: product.reservation_fee,
          spotCashDays: product.spot_cash_days,
          standardInstallmentMonths: product.standard_installment_months,
          validityYears: product.validity_years,
          moveAEnabled: product.move_a_enabled,
          moveB1Enabled: product.move_b1_enabled,
          moveB2Enabled: product.move_b2_enabled,
        },
        input.paymentScheme,
      );
      if ('error' in scheme) {
        if (scheme.error === 'SCHEME_NOT_ALLOWED_FOR_TIER') {
          return fail(
            res,
            'CONFLICT',
            `${paymentSchemeLabel(input.paymentScheme)} is not available for the ${product.name} tier`,
            409,
          );
        }
        if (scheme.error === 'INSTALLMENT_PRICE_NOT_SET') {
          return fail(
            res,
            'CONFLICT',
            'The installment price is not configured for this card plan',
            409,
          );
        }
        return fail(res, 'CONFLICT', 'The payment schedule is not available for this sale', 409);
      }
      const schemeTerms = snapshotSchemeTerms(scheme.economics);
      // The frozen SELECTED total is the commercial record: commission basis
      // and every payment threshold derive from it, never from the live plan.
      const frozenTotal = schemeTerms.schemeTotalSnapshot;
      const expectedCommission = calculateCommission(frozenTotal, resolvedCommissionRate);
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
          cash_price: frozenTotal,
          cash_price_snapshot: frozenTotal,
          minimum_down_payment_snapshot: terms.minimumDownPaymentSnapshot,
          payment_scheme: schemeTerms.paymentScheme,
          reservation_fee_snapshot: schemeTerms.reservationFeeSnapshot,
          required_initial_snapshot: schemeTerms.requiredInitialSnapshot,
          installment_months_snapshot: schemeTerms.installmentMonthsSnapshot,
          monthly_amount_snapshot: schemeTerms.monthlyAmountSnapshot,
          validity_months_snapshot: schemeTerms.validityMonthsSnapshot,
          yearly_points_snapshot: terms.yearlyPointsSnapshot,
          commission_rate_snapshot: terms.commissionRateSnapshot,
          commission_rule_id: commissionRuleId,
          commission_base_snapshot: frozenTotal,
          expected_commission_snapshot: expectedCommission,
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

      // One commission per sale, created pending. Never earned here. The basis
      // is the frozen SELECTED total (Stage 1 §19), not the live plan price.
      const { error: commissionError } = await db.from('commissions').insert({
        sale_id: sale.id,
        ost_id: null,
        beneficiary_type: 'staff',
        beneficiary_staff_id: seller.staffId,
        amount: expectedCommission,
        rate_snapshot: terms.commissionRateSnapshot,
        basis_amount_snapshot: frozenTotal,
        commission_rule_id: commissionRuleId,
        status: 'pending',
      });
      if (commissionError) throw commissionError;

      await audit(db, auth.userId, 'APPLICATION_SUBMITTED', 'card_sale', String(sale.id), null, {
        saleNumber,
        customerId: input.customerId,
        productId: input.productId,
        sellerStaffId: seller.staffId,
        paymentScheme: schemeTerms.paymentScheme,
        frozenTotal,
        expectedCommission,
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
          rows.flatMap((row) => [row.recorded_by, row.verified_by]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
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
      // token issuance or SMTP delivery fails. A fresh activation issues once;
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
          const { data: customer, error: customerError } = await db
            .from('customers')
            .select('email, first_name, middle_name, last_name, suffix')
            .eq('id', customerId)
            .maybeSingle();
          const customerRecord = (customer ?? {}) as Record<string, unknown>;
          const customerName = [
            customerRecord.first_name,
            customerRecord.middle_name,
            customerRecord.last_name,
            customerRecord.suffix,
          ]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join(' ');
          const email = typeof customerRecord.email === 'string' ? customerRecord.email : '';
          const delivery =
            !customerError && email && activationUrl
              ? await sendCustomerOnboardingEmail({
                  to: email,
                  customerName,
                  membershipNumber: String(row.membership_number ?? ''),
                  activationUrl,
                  expiresAt,
                })
              : { status: 'failed' as const, reason: 'not_configured' as const };

          onboarding = {
            status: delivery.status === 'sent' ? 'email_sent' : 'manual_required',
            emailStatus: delivery.status === 'sent' ? 'sent' : 'failed',
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
            await audit(
              db,
              auth.userId,
              onboarding.emailStatus === 'sent'
                ? 'CUSTOMER_ACTIVATION_EMAIL_SENT'
                : 'CUSTOMER_ACTIVATION_EMAIL_FAILED',
              'customer',
              customerId,
              null,
              {
                membershipId: row.membership_id,
                deliveryStatus: onboarding.emailStatus,
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
      const { error: cancelError } = await db
        .from('card_sales')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (cancelError) throw cancelError;
      await audit(db, auth.userId, 'SALE_CANCELLED', 'sale', id, { status }, { status: 'cancelled' });
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
