/**
 * AF Homes points: purchases, earning claims, and the customer's QR claim.
 *
 * Authorization, and it is the EXISTING vocabulary - no new module keys:
 *
 *   sales.customers        view    -> the Sales Records list. Deliberately NOT
 *                                       operations.sales: recording a sale must
 *                                       not hand a GSD everyone's sales history.
 *   operations.sales       create  -> record an operational service sale and a
 *                                       cash receipt for it. Does NOT verify, and
 *                                       grants no catalog, rule or customer access.
 *   operations.payments       update  -> verify or reject an OPERATIONAL receipt.
 *                                       Its own key, deliberately NOT the VIP-card
 *                                       finance.payment_verification, so the two
 *                                       payment workflows authorise each other for
 *                                       nothing. Finance/Admin only: a GSD can
 *                                       never make their own recorded money real.
 *   operations.redemption  view    -> see claims and history
 *   operations.redemption  create  -> create / reissue / reverse a claim, and for
 *                                     a CUSTOMER to redeem their own claim
 *   operations.catalog     view/update -> maintain services and earning rules
 *
 * Two rules this file exists to enforce:
 *
 * 1. The acting staff member is ALWAYS `principal.userId`, resolved from the
 *    session. There is no body field for a staff id, and the database function
 *    re-validates the actor independently. A tampered body cannot award points
 *    to somebody else, cannot state a points figure, and cannot name a cap.
 * 2. SCANNING SPENDS NOTHING on its own. Creating a claim only RESERVES cap
 *    capacity. Points move only when the customer redeems, inside
 *    public.claim_earning_points, in one database transaction with a
 *    compare-and-set on claim status.
 */
import {
  adjustPointsInputSchema,
  claimEarningPointsRequestSchema,
  createEarningClaimRequestSchema,
  createPurchaseInputSchema,
  pointEarningRuleInputSchema,
  pointRedemptionRuleInputSchema,
  pointRedemptionRulePatchSchema,
  quotePointDiscountSchema,
  purchaseReceiptInputSchema,
  reversePurchaseInputSchema,
  purchaseReceiptDecisionSchema,
  serviceCatalogItemInputSchema,
  serviceTierDiscountInputSchema,
  applyPointsDiscountInputSchema,
  appliedPointsDiscountSchema,
  operationalSettlementSchema,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  audit as handlerKitAudit,
  deny,
  fail,
  type Db,
  isoOrNull,
  jsonBody,
  list,
  mapRpcError,
  method,
  route,
  subPath,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import { resolveCustomerPrincipal } from '../_lib/customer-access.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/** A database refusal -> a stable, safe client message. */
const REFUSALS: Record<string, [string, string, number]> = {
  ACTOR_REQUIRED: ['UNAUTHORIZED', 'Sign in to continue', 401],
  ACTOR_NOT_ACTIVE: ['FORBIDDEN', 'Your staff account is not active.', 403],
  PURCHASE_NOT_FOUND: ['NOT_FOUND', 'No purchase matches that reference', 404],
  PURCHASE_NOT_COMPLETED: ['CONFLICT', 'This purchase is not completed.', 409],
  PURCHASE_ALREADY_REVERSED: ['CONFLICT', 'This purchase was already reversed.', 409],
  PURCHASE_NOT_SETTLED: ['CONFLICT', 'Verified receipts must cover the net amount first.', 409],
  PURCHASE_HAS_NO_LINES: ['CONFLICT', 'This purchase has no service line.', 409],
  NO_ELIGIBLE_EARNING_RULE: [
    'CONFLICT',
    'No earning rule applies to this purchase for this member today.',
    409,
  ],
  CLAIM_ALREADY_EXISTS: ['CONFLICT', 'This purchase already has an earning claim.', 409],
  CLAIM_NOT_FOUND: ['NOT_FOUND', 'No claim matches that reference', 404],
  CLAIM_NOT_REISSUABLE: ['CONFLICT', 'This claim can no longer be reissued.', 409],
  CLAIM_NO_LONGER_ELIGIBLE: ['CONFLICT', 'This claim is no longer eligible.', 409],
  CUSTOMER_NOT_ACTIVE: ['CONFLICT', 'This customer account is not active.', 409],
  MEMBERSHIP_NOT_ACTIVE: ['CONFLICT', 'This membership is not active.', 409],
  REVERSAL_REASON_REQUIRED: ['VALIDATION_ERROR', 'A reason is required.', 400],
  ADJUSTMENT_AMOUNT_REQUIRED: ['VALIDATION_ERROR', 'A non-zero amount is required.', 400],
  ADJUSTMENT_REASON_REQUIRED: ['VALIDATION_ERROR', 'A reason is required.', 400],
  ADJUSTMENT_EXCEEDS_BALANCE: [
    'CONFLICT',
    'That adjustment would take the balance below zero.',
    409,
  ],
  POINTS_ACCOUNT_NOT_FOUND: ['CONFLICT', 'This member has no points account yet.', 409],
  // Spending refusals. Phrased for the member, and deliberately vague about WHY
  // a promotion did not apply: naming the rule would let a caller probe which
  // services are promoted.
  NO_DISCOUNT_ELIGIBLE_LINES: [
    'CONFLICT',
    'Points can only be used on accommodation and staycation purchases, unless a current promotion applies.',
    409,
  ],
  NO_REDEMPTION_RATE: [
    'CONFLICT',
    'No current promotion price is available for these items.',
    409,
  ],
  REVERSAL_DEBT_OUTSTANDING: [
    'CONFLICT',
    'Points cannot be spent while a reversal is outstanding. Earning is not affected.',
    409,
  ],
  INSUFFICIENT_POINTS: ['CONFLICT', 'This member does not have that many points.', 409],
  PURCHASE_NOT_DISCOUNTABLE: [
    'CONFLICT',
    'Only a purchase that has not been settled can take a points discount.',
    409,
  ],
  QUOTE_NOT_FOUND: ['NOT_FOUND', 'No quote matches that reference', 404],
  QUOTE_NOT_OPEN: ['CONFLICT', 'That quote has already been used.', 409],
  QUOTE_EXPIRED: ['CONFLICT', 'That quote has expired. Please request a new one.', 409],
  DISCOUNT_EXCEEDS_GROSS: ['CONFLICT', 'That discount is larger than the purchase.', 409],
  POINTS_AMOUNT_REQUIRED: ['VALIDATION_ERROR', 'Enter how many points to use.', 400],
  PAYMENT_METHOD_REQUIRED: ['VALIDATION_ERROR', 'Choose a payment method.', 400],
  PAYMENT_AMOUNT_INVALID: ['VALIDATION_ERROR', 'Enter a valid amount, greater than zero.', 400],
  PAYMENT_DECISION_INVALID: ['VALIDATION_ERROR', 'Choose verify or reject.', 400],
  PAYMENT_NOT_FOUND: ['NOT_FOUND', 'No payment matches that reference', 404],
  PAYMENT_NOT_RECORDED: ['CONFLICT', 'That payment has already been decided.', 409],
  REJECTION_REASON_REQUIRED: ['VALIDATION_ERROR', 'Give a reason for rejecting this payment.', 400],
  PURCHASE_REVERSED: ['CONFLICT', 'This purchase has been reversed.', 409],
  MEMBERSHIP_NOT_FOUND: ['NOT_FOUND', 'No membership matches that reference', 404],
  // Deliberately the SAME TUPLE as the unknown-claim refusal below, not merely the
  // same status. A caller must not be able to learn whether a claim exists, only
  // that they cannot claim it - a different message here is an existence oracle.
  CLAIM_NOT_OWNER: ['NOT_FOUND', 'No claim matches that reference', 404],
  CLAIM_ALREADY_CLAIMED: ['CONFLICT', 'This claim has already been used.', 409],
  CLAIM_NOT_AVAILABLE: ['CONFLICT', 'This claim is no longer available.', 409],
  CLAIM_EXPIRED: ['CONFLICT', 'This claim has expired.', 409],
  NO_REMAINING_CAPACITY: ['CONFLICT', 'This member has no remaining earning capacity.', 409],
  CUSTOMER_NOT_IDENTIFIED: ['UNAUTHORIZED', 'Sign in to continue', 401],
  SERVICE_NOT_FOUND: ['NOT_FOUND', 'No service matches that reference', 404],
  CUSTOMER_NOT_FOUND: ['NOT_FOUND', 'No customer matches that membership', 404],
};

const splitCode = (message: string) => (message.split(':')[0] ?? '').trim();

/**
 * The promotion columns, named once. A promotion never carries a cap-exemption
 * and never carries an "applies to all services" flag, so neither can appear in a
 * select by accident.
 */
const REDEMPTION_RULE_COLUMNS =
  'id, service_id, peso_value_per_point, eligible_tiers, min_points, max_points, ' +
  'min_purchase_amount, effective_start, effective_end, is_active, promotion_reference';

/** Row -> response. Fields are PICKED, never spread. */
const toRedemptionRule = (row: Record<string, unknown>) => ({
  id: row.id,
  serviceId: row.service_id,
  pesoValuePerPoint: String(row.peso_value_per_point ?? '0'),
  eligibleTiers: (row.eligible_tiers ?? []) as string[],
  minPoints: Number(row.min_points ?? 0),
  maxPoints: row.max_points === null || row.max_points === undefined ? null : Number(row.max_points),
  minPurchaseAmount: row.min_purchase_amount === null || row.min_purchase_amount === undefined
    ? null
    : String(row.min_purchase_amount),
  effectiveStart: isoOrNull(row.effective_start),
  effectiveEnd: isoOrNull(row.effective_end),
  isActive: row.is_active === true,
  promotionReference: row.promotion_reference ?? null,
});

/** Map a SQL refusal onto the client's error envelope. */
function refuse(res: VercelResponse, error: { message?: string } | null): void {
  const code = splitCode(String(error?.message ?? ''));
  const mapped = REFUSALS[code];
  if (mapped) return fail(res, mapped[0] as never, mapped[1], mapped[2]);
  return mapRpcError(res, error);
}

/**
 * The purchase rows a staff member is allowed to see, with their lines.
 *
 * Fields are PICKED, never spread. A spread would emit whatever the driver
 * returned, which turns a future column addition into a silent leak; picking
 * also keeps the response camelCase, matching every other AF Homes handler and
 * the contracts the client validates against.
 */
async function listPurchases(db: Db, customerId: string | null) {
  let query = db
    .from('purchases')
    .select(
      'id, purchase_number, customer_id, membership_id, status, gross_amount, points_discount_amount, net_amount, completed_at, reversed_at, reversal_reason, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const { data: lines } = await db
    .from('purchase_lines')
    .select('id, purchase_id, service_id, quantity, unit_amount, line_total')
    .in('purchase_id', ids);
  const byPurchase = new Map<string, Record<string, unknown>[]>();
  for (const line of (lines ?? []) as Record<string, unknown>[]) {
    const key = String(line.purchase_id);
    const bucket = byPurchase.get(key) ?? [];
    bucket.push({
      id: line.id,
      serviceId: line.service_id,
      quantity: Number(line.quantity),
      unitAmount: String(line.unit_amount),
      lineTotal: String(line.line_total),
    });
    byPurchase.set(key, bucket);
  }
  return rows.map((row) => ({
    id: row.id,
    purchaseNumber: row.purchase_number,
    customerId: row.customer_id,
    membershipId: row.membership_id,
    status: row.status,
    grossAmount: String(row.gross_amount),
    pointsDiscountAmount: String(row.points_discount_amount),
    netAmount: String(row.net_amount),
    completedAt: isoOrNull(row.completed_at),
    reversedAt: isoOrNull(row.reversed_at),
    reversalReason: row.reversal_reason ?? null,
    createdAt: isoOrNull(row.created_at),
    lines: byPurchase.get(String(row.id)) ?? [],
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Server configuration is incomplete', 500);

  const verb = method(req);
  const path = subPath(req);

  try {
    /* ================================================================
     * THE CUSTOMER PATH: POST /points/claim
     *
     * This is the QR scan. It is reached by the customer, authenticated as
     * themselves, and the identity is resolved SERVER-SIDE from the session.
     * It requires no staff permission at all: a member redeeming their own
     * claim is a customer action, not a staff one.
     * ================================================================ */
    if (path === 'claim' && verb === 'POST') {
      const resolved = await resolveCustomerPrincipal(req);
      if ('error' in resolved) {
        return res.status(resolved.error.status).json({ error: resolved.error.error });
      }
      const parsed = claimEarningPointsRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the claim code and try again.', 400);
      }
      // p_customer_id comes from the session, never from the body. The schema is
      // strict, so a forged customerId in the payload was already rejected.
      const { data, error } = await db.rpc('claim_earning_points', {
        p_token: parsed.data.token,
        p_customer_id: resolved.customerId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'CONFLICT', 'This claim could not be redeemed.', 409);
      return res.status(200).json({
        claimNumber: String(row.claim_number ?? ''),
        pointsAwarded: Number(row.points_awarded ?? 0),
        pointsCapped: Number(row.points_capped ?? 0),
        balanceAfter: Number(row.balance_after ?? 0),
      });
    }

    /* ================================================================
     * Everything below is staff-only.
     * ================================================================ */
    const auth = await authorizeAfHomes(req, 'operations.redemption', 'view');
    if ('error' in auth) return deny(res, auth);

    /* ---------------- GET /points/purchases ----------------
     *
     * The Sales Records list, so it is gated on `sales.customers` VIEW rather
     * than on `operations.sales`. That is the deliberate separation: being able
     * to RECORD a sale must not hand a GSD the whole company's sales history.
     * `employee` holds no `sales.customers` row at all, so the operational
     * screen can read back its own sale through the per-purchase summary below
     * without ever seeing the ledger of everyone else's. */
    if (path === 'purchases' && verb === 'GET') {
      const records = await authorizeAfHomes(req, 'sales.customers', 'view');
      if ('error' in records) return deny(res, records);
      const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : null;
      return res.status(200).json({ data: await listPurchases(db, customerId) });
    }

    /* ---------------- POST /points/purchases ---------------- */
    if (path === 'purchases' && verb === 'POST') {
      const write = await authorizeAfHomes(req, 'operations.sales', 'create');
      if ('error' in write) return deny(res, write);

      const parsed = createPurchaseInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the purchase details and try again.', 400);
      }
      // The gross is computed HERE from the lines, never accepted from the
      // client, so a tampered total cannot be persisted.
      const gross = parsed.data.lines.reduce(
        (sum, line) => sum + Number(line.unitAmount) * line.quantity,
        0,
      );
      const { data, error } = await db.rpc('create_purchase', {
        p_membership_id: parsed.data.membershipId,
        p_gross_amount: gross.toFixed(2),
        p_lines: parsed.data.lines.map((l) => ({
          serviceId: l.serviceId,
          quantity: l.quantity,
          unitAmount: l.unitAmount,
        })),
        // The idempotency key. Without it a retried request creates a SECOND
        // real purchase that could earn points.
        p_reference: parsed.data.reference,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(201).json({
        purchaseId: row?.purchase_id ?? row?.id,
        purchaseNumber: String(row?.purchase_number ?? ''),
        grossAmount: String(row?.gross_amount ?? gross.toFixed(2)),
        // The SERVER resolved and applied this. The browser may display it and
        // may not influence it: a rate is never sent up, only read back down.
        tierDiscountAmount: String(row?.tier_discount_amount ?? '0.00'),
        netAmount: String(row?.net_amount ?? gross.toFixed(2)),
      });
    }

    /* ---------------- POST /points/purchases/:id/payments ----------------
     *
     * Records a CASH RECEIPT. This is the only place money enters a purchase.
     *
     * A receipt is recorded as 'recorded', which is NOT yet money: it does not
     * count toward net_amount until a verifier accepts it. That split is why a
     * staff member cannot settle their own purchase by typing a figure in - the
     * same `recorded_by` and `verified_by` columns are separate, and the database
     * refuses to move a receipt out of 'recorded' twice.
     * -------------------------------------------------------------- */
    const payRoute = route(req, 'POST', /^purchases\/([^/]+)\/payments$/);
    if (payRoute) {
      // Recording a receipt is part of MAKING the Operational Services sale, so
      // it rides on the same narrowly scoped key. It is not verification: the
      // receipt stays unverified until Finance acts, and a GSD can never be the
      // person who makes their own money real (see the verify route below).
      const write = await authorizeAfHomes(req, 'operations.sales', 'create');
      if ('error' in write) return deny(res, write);

      const parsed = purchaseReceiptInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Enter a valid amount and a payment method.', 400);
      }
      const { data, error } = await db.rpc('record_purchase_payment', {
        p_purchase_id: payRoute[1],
        p_amount: parsed.data.amount,
        p_method: parsed.data.method,
        p_reference: parsed.data.reference,
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(201).json({
        paymentId: row?.payment_id ?? '',
        paymentNumber: String(row?.payment_number ?? ''),
        amount: String(row?.amount ?? parsed.data.amount),
        status: String(row?.status ?? 'recorded'),
      });
    }

    /* ---------------- POST /points/payments/:id/verify ----------------
     *
     * The moment recorded cash becomes real. A rejection REQUIRES a reason:
     * an unexplained rejection is unreviewable, and a rejected receipt with a
     * blank reason is how a refund turns into an unexplained hole in a report.
     * -------------------------------------------------------------- */
    const verifyRoute = route(req, 'POST', /^payments\/([^/]+)\/verify$/);
    if (verifyRoute) {
      // OPERATIONAL SERVICES FINANCE ONLY, on its OWN key. Not the VIP-card
      // `finance.payment_verification`, and not `operations.sales` either:
      // `employee` holds neither, so the person who records a receipt can never
      // be the person who makes it money. Keeping the two verification keys
      // separate is what makes these two payment workflows independent rather
      // than merely adjacent.
      const write = await authorizeAfHomes(req, 'operations.payments', 'update');
      if ('error' in write) return deny(res, write);

      const parsed = purchaseReceiptDecisionSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Choose verify or reject, with a reason if rejecting.', 400);
      }
      const { data, error } = await db.rpc('verify_purchase_payment', {
        p_payment_id: verifyRoute[1],
        p_decision: parsed.data.decision,
        p_rejection_reason: parsed.data.rejectionReason,
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(200).json({
        paymentId: verifyRoute[1],
        status: String(row?.status ?? parsed.data.decision),
        verifiedTotal: String(row?.verified_total ?? '0.00'),
      });
    }

    /* ---------------- GET /points/purchases/:id/payments ---------------- */
    const payListRoute = route(req, 'GET', /^purchases\/([^/]+)\/payments$/);
    if (payListRoute) {
      const { data, error } = await db
        .from('purchase_payments')
        .select('id, payment_number, amount, method, reference, status, recorded_by, verified_by, recorded_at, verified_at, rejection_reason')
        .order('recorded_at', { ascending: false });
      if (error) throw error;
      // Scoped in JS because the fake has no PostgREST nested-filter support; the
      // result set is tiny and the security boundary is the permission above, not
      // the filter.
      const rows = ((data ?? []) as Record<string, unknown>[]).filter(
        (row) => row.purchase_id === payListRoute[1],
      );
      return list(
        res,
        rows.map((row) => ({
          id: row.id,
          paymentNumber: row.payment_number,
          amount: String(row.amount),
          method: row.method,
          reference: row.reference ?? null,
          status: row.status,
          recordedBy: row.recorded_by,
          verifiedBy: row.verified_by ?? null,
          recordedAt: isoOrNull(row.recorded_at),
          verifiedAt: isoOrNull(row.verified_at),
          rejectionReason: row.rejection_reason ?? null,
        })),
      );
    }

    /* ---------------- GET /points/claims/:id ----------------
     *
     * One claim in full, for investigation. READ-ONLY by construction: there is
     * no PATCH, no DELETE and no verb that edits a ledger row anywhere in this
     * file. Staff can see status, expiry, what it reserved, what it awarded, and
     * what it cost to reverse - and can change none of it.
     * -------------------------------------------------------------- */
    const claimRoute = route(req, 'GET', /^claims\/([^/]+)$/);
    if (claimRoute) {
      const { data, error } = await db
        .from('earning_claims')
        .select(
          'id, claim_number, customer_id, purchase_id, account_id, status, points_requested, points_reserved, points_awarded, points_capped, period_id, expires_at, claimed_at, reversed_at, created_at',
        )
        .eq('id', claimRoute[1])
        .maybeSingle();
      if (error) return mapRpcError(res, error);
      if (!data) return fail(res, 'NOT_FOUND', 'No claim matches that reference', 404);
      const row = data as Record<string, unknown>;
      return res.status(200).json({
        id: row.id,
        claimNumber: row.claim_number,
        customerId: row.customer_id,
        purchaseId: row.purchase_id,
        status: row.status,
        pointsRequested: Number(row.points_requested ?? 0),
        pointsReserved: Number(row.points_reserved ?? 0),
        pointsAwarded: Number(row.points_awarded ?? 0),
        pointsCapped: Number(row.points_capped ?? 0),
        expiresAt: isoOrNull(row.expires_at),
        claimedAt: isoOrNull(row.claimed_at),
        reversedAt: isoOrNull(row.reversed_at),
        createdAt: isoOrNull(row.created_at),
      });
    }

    /* ---------------- POST /points/purchases/:id/quote ----------------
     *
     * Prices a points discount and SPENDS NOTHING. The request names the purchase
     * and a point COUNT; it never states a peso value, a rate, or a resulting
     * balance. Every peso figure below is the server's, from the matched
     * promotion and the eligible line total.
     * -------------------------------------------------------------- */
    const quoteRoute = route(req, 'POST', /^purchases\/([^/]+)\/quote$/);
    if (quoteRoute) {
      const write = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in write) return deny(res, write);

      const parsed = quotePointDiscountSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Enter how many points to use.', 400);
      }
      const { data, error } = await db.rpc('quote_point_discount', {
        p_purchase_id: quoteRoute[1],
        p_points_requested: parsed.data.pointsRequested,
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'CONFLICT', 'That discount is not available.', 409);
      return res.status(200).json({
        quoteId: row.quote_id,
        quoteNumber: String(row.quote_number ?? ''),
        pointsRequested: Number(row.points_requested ?? 0),
        pesoValue: String(row.peso_value ?? '0.00'),
        eligibleLineTotal: String(row.eligible_line_total ?? '0.00'),
        remainingPointsAfter: Number(row.remaining_points_after ?? 0),
        expiresAt: isoOrNull(row.expires_at) ?? '',
      });
    }

    /* ---------------- POST /points/quotes/:id/commit ----------------
     *
     * The single place points are spent and a purchase figure changes. One
     * transaction in SQL: the ledger row, the account balance, the membership
     * cache, the per-line discount allocation and the purchase net all land
     * together or not at all.
     * -------------------------------------------------------------- */
    const commitRoute = route(req, 'POST', /^quotes\/([^/]+)\/commit$/);
    if (commitRoute) {
      const write = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in write) return deny(res, write);

      const { data, error } = await db.rpc('commit_point_discount', {
        p_quote_id: commitRoute[1],
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(200).json({
        purchaseId: row?.purchase_id ?? '',
        pointsSpent: Number(row?.points_spent ?? 0),
        discountApplied: String(row?.discount_applied ?? '0.00'),
        netAmount: String(row?.net_amount ?? '0.00'),
        balanceAfter: Number(row?.balance_after ?? 0),
      });
    }

    /* ---------------- GET /points/purchases/:id/summary ----------------
     *
     * Finance. Returns gross, discount, net and the ACTUAL verified receipts as
     * four separate figures, because they are not interchangeable and a report
     * that collapsed them would make a discounted purchase look like cash.
     * -------------------------------------------------------------- */
    const summaryRoute = route(req, 'GET', /^purchases\/([^/]+)\/summary$/);
    if (summaryRoute) {
      const { data, error } = await db.rpc('purchase_financial_summary_purchases', {
        p_purchase_id: summaryRoute[1],
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'NOT_FOUND', 'No purchase matches that reference', 404);
      return res.status(200).json({
        purchaseId: row.purchase_id,
        grossAmount: String(row.gross_amount),
        pointsDiscountAmount: String(row.points_discount_amount),
        netAmount: String(row.net_amount),
        recordedTotal: String(row.recorded_total),
        verifiedTotal: String(row.verified_total),
        rejectedTotal: String(row.rejected_total),
        remainingBalance: String(row.remaining_balance),
        overpaidAmount: String(row.overpaid_amount),
        fullyPaid: row.fully_paid === true,
      });
    }

    /* ---------------- POST /points/adjust ----------------
     *
     * The ONLY way points may be minted or removed outside an earning claim, and
     * it is deliberately clumsy: a mandatory reason, a permanent ledger row, and
     * no cap credit. The client states a delta and a reason and nothing else -
     * never the resulting balance, which SQL owns.
     * -------------------------------------------------------------- */
    if (path === 'adjust' && verb === 'POST') {
      const write = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in write) return deny(res, write);

      const parsed = adjustPointsInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'A non-zero amount and a reason are required.', 400);
      }
      const { data, error } = await db.rpc('adjust_membership_points', {
        p_membership_id: parsed.data.membershipId,
        p_amount: parsed.data.amount,
        p_reason: parsed.data.reason,
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(200).json({
        membershipId: parsed.data.membershipId,
        amount: parsed.data.amount,
        balanceAfter: Number(row?.balance_after ?? 0),
        reversalDebt: Number(row?.reversal_debt ?? 0),
      });
    }

    /* ---------------- GET /points/services ----------------
     *
     * The catalog is what makes a purchase eligible at all, so it is readable by
     * anyone who may read points - and writable only by the catalog maintainer.
     * -------------------------------------------------------------- */
    if (path === 'services' && verb === 'GET') {
      const { data, error } = await db
        .from('service_catalog')
        .select('id, code, name, description, base_price, is_active, created_at, updated_at')
        .order('code');
      if (error) throw error;
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description ?? null,
          basePrice: String(row.base_price),
          isActive: row.is_active === true,
          createdAt: isoOrNull(row.created_at),
          updatedAt: isoOrNull(row.updated_at),
        })),
      );
    }

    /* ---------------- GET /earning/tier-discounts ----------------
     *
     * The Operational Services VIP rate table. Readable by anyone who may sell,
     * because the sale screen has to SHOW the member what rate applies; only
     * `operations.catalog` may change one, so a GSD can read the price and
     * never write it.
     * -------------------------------------------------------------- */
    if (path === 'tier-discounts' && verb === 'GET') {
      const { data, error } = await db
        .from('service_tier_discounts')
        .select('id, service_id, tier, discount_rate, effective_start, effective_end, is_active')
        .order('service_id')
        .order('tier');
      if (error) throw error;
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          serviceId: row.service_id,
          tier: row.tier,
          discountRate: Number(row.discount_rate),
          effectiveStart: String(row.effective_start).slice(0, 10),
          effectiveEnd: String(row.effective_end).slice(0, 10),
          isActive: row.is_active === true,
        })),
      );
    }

    /* ---------------- POST /earning/tier-discounts ---------------- */
    if (path === 'tier-discounts' && verb === 'POST') {
      // Catalog ADMIN, never operations.sales: configuring a rate is a
      // commercial change, and the whole point of the narrow GSD capability is
      // that selling cannot reach it.
      const write = await authorizeAfHomes(req, 'operations.catalog', 'create');
      if ('error' in write) return deny(res, write);
      const parsed = serviceTierDiscountInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the discount details and try again.', 400);
      }
      if (parsed.data.effectiveStart >= parsed.data.effectiveEnd) {
        return fail(res, 'VALIDATION_ERROR', 'The end date must be after the start date.', 400);
      }
      // The overlap trigger refuses two simultaneously-active rules for one
      // service and tier. That is a DATABASE refusal on purpose: a handler bug
      // must not be able to create an ambiguous rate.
      const { data, error } = await db
        .from('service_tier_discounts')
        .insert({
          service_id: parsed.data.serviceId,
          tier: parsed.data.tier,
          discount_rate: parsed.data.discountRate,
          effective_start: parsed.data.effectiveStart,
          effective_end: parsed.data.effectiveEnd,
          is_active: true,
          created_by: auth.userId,
        })
        .select('id, service_id, tier, discount_rate, effective_start, effective_end, is_active')
        .single();
      if (error) return mapRpcError(res, error);
      const row = data as Record<string, unknown>;
      await handlerKitAudit(
        db,
        auth.userId,
        'SERVICE_TIER_DISCOUNT_CREATED',
        'service_tier_discount',
        String(row.id),
        undefined,
        {
          serviceId: row.service_id,
          tier: row.tier,
          discountRate: Number(row.discount_rate),
        },
        { reason: `Operational Services tier rate ${String(row.discount_rate)}% for ${String(row.tier)}` },
      );
      return res.status(201).json({
        id: row.id,
        serviceId: row.service_id,
        tier: row.tier,
        discountRate: Number(row.discount_rate),
        effectiveStart: String(row.effective_start).slice(0, 10),
        effectiveEnd: String(row.effective_end).slice(0, 10),
        isActive: true,
      });
    }

    if (path === 'services' && verb === 'POST') {
      const write = await authorizeAfHomes(req, 'operations.catalog', 'create');
      if ('error' in write) return deny(res, write);
      const parsed = serviceCatalogItemInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the service details and try again.', 400);
      }
      const { data, error } = await db
        .from('service_catalog')
        .insert({
          code: parsed.data.code,
          name: parsed.data.name,
          description: parsed.data.description,
          base_price: parsed.data.basePrice,
          is_active: parsed.data.isActive,
        })
        .select('id, code, name, description, base_price, is_active')
        .single();
      if (error) {
        if (/duplicate key|already exists/i.test(error.message ?? '')) {
          return fail(res, 'CONFLICT', 'That service code is already in use.', 409);
        }
        return mapRpcError(res, error);
      }
      const row = data as Record<string, unknown>;
      // Audited on purpose: the catalog decides what earns points, so a change to
      // it is a commercial event, not housekeeping.
      await audit(db, auth.userId, 'SERVICE_CREATED', 'service_catalog', String(row.id), null, {
        code: row.code,
        basePrice: String(row.base_price),
      });
      return res.status(201).json({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description ?? null,
        basePrice: String(row.base_price),
        isActive: row.is_active === true,
      });
    }

/* ---------------- POST /points/redemption-rules ----------------
     *
     * Creates a PROMOTION: what makes a non-staycation service discountable, and
     * at what conversion.
     *
     * The mandatory bits are enforced by the TABLE as well as here, so a direct
     * SQL insert cannot produce an indefinite promotion either:
     *   - effective_start AND effective_end are NOT NULL (no open-ended promo)
     *   - effective_start < effective_end (half-open interval)
     *   - promotion_reference is NOT NULL and non-blank (it must be reviewable)
     *   - eligible_tiers is a non-empty subset of the three known tiers
     *
     * There is deliberately NO cap-exemption and no "applies to everything"
     * option: a promotion names ONE service, and every award still counts toward
     * the annual cap.
     * -------------------------------------------------------------- */
    if (path === 'redemption-rules' && verb === 'POST') {
      const write = await authorizeAfHomes(req, 'operations.catalog', 'create');
      if ('error' in write) return deny(res, write);

      const parsed = pointRedemptionRuleInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the promotion details and try again.', 400);
      }
      const rule = parsed.data;
      if (rule.maxPoints !== null && rule.minPoints > rule.maxPoints) {
        return fail(res, 'VALIDATION_ERROR', 'The minimum points must not exceed the maximum.', 400);
      }

      // A promotion pointing at a deactivated service would earn nothing and
      // discount nothing, forever, in silence.
      const service = await db
        .from('service_catalog')
        .select('id, is_active')
        .eq('id', rule.serviceId)
        .maybeSingle();
      if (service.error) return mapRpcError(res, service.error);
      if (!service.data) return fail(res, 'NOT_FOUND', 'No service matches that reference', 404);
      if (service.data.is_active !== true) {
        return fail(res, 'CONFLICT', 'That service is deactivated.', 409);
      }

      const { data, error } = await db
        .from('point_redemption_rules')
        .insert({
          service_id: rule.serviceId,
          peso_value_per_point: rule.pesoValuePerPoint,
          eligible_tiers: rule.eligibleTiers,
          min_points: rule.minPoints,
          max_points: rule.maxPoints,
          min_purchase_amount: rule.minPurchaseAmount,
          effective_start: rule.effectiveStart,
          effective_end: rule.effectiveEnd,
          is_active: rule.isActive,
          promotion_reference: rule.promotionReference,
          created_by: auth.userId,
        })
        .select(REDEMPTION_RULE_COLUMNS)
        .single();
      if (error) return mapRpcError(res, error);
      const row = data as Record<string, unknown>;
      // Audited with the actor: a promotion changes what members may SPEND points
      // on, so it is a commercial event and never a silent configuration change.
      await audit(db, auth.userId, 'REDEMPTION_RULE_CREATED', 'point_redemption_rules', String(row.id), null, {
        serviceId: rule.serviceId,
        pesoValuePerPoint: rule.pesoValuePerPoint,
        eligibleTiers: rule.eligibleTiers,
        effectiveStart: rule.effectiveStart,
        effectiveEnd: rule.effectiveEnd,
        promotionReference: rule.promotionReference,
      });
      return res.status(201).json(toRedemptionRule(row));
    }

    /* ---------------- PATCH /points/redemption-rules/:id ---------------- */
    const patchRule = route(req, 'PATCH', /^redemption-rules\/([^/]+)$/);
    if (patchRule) {
      const write = await authorizeAfHomes(req, 'operations.catalog', 'update');
      if ('error' in write) return deny(res, write);

      const parsed = pointRedemptionRulePatchSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the promotion details and try again.', 400);
      }
      const patch = parsed.data;
      if (
        patch.minPoints !== undefined &&
        patch.maxPoints !== undefined &&
        patch.maxPoints !== null &&
        patch.minPoints > patch.maxPoints
      ) {
        return fail(res, 'VALIDATION_ERROR', 'The minimum points must not exceed the maximum.', 400);
      }

      // The CURRENT row is read first because the table CHECKs apply to the FINAL
      // state. Without this, toggling `is_active` on a row whose window already
      // closed would be refused for a reason the admin cannot see or fix.
      const existing = await db
        .from('point_redemption_rules')
        .select('id, effective_start, effective_end, is_active')
        .eq('id', patchRule[1])
        .maybeSingle();
      if (existing.error) return mapRpcError(res, existing.error);
      if (!existing.data) return fail(res, 'NOT_FOUND', 'No promotion matches that reference', 404);

      const nextStart = patch.effectiveStart ?? String(existing.data.effective_start);
      const nextEnd = patch.effectiveEnd ?? String(existing.data.effective_end);
      if (nextStart >= nextEnd) {
        return fail(res, 'VALIDATION_ERROR', 'The end date must be after the start date.', 400);
      }

      const update: Record<string, unknown> = {};
      if (patch.pesoValuePerPoint !== undefined) {
        update.peso_value_per_point = patch.pesoValuePerPoint;
      }
      if (patch.eligibleTiers !== undefined) update.eligible_tiers = patch.eligibleTiers;
      if (patch.minPoints !== undefined) update.min_points = patch.minPoints;
      if (patch.maxPoints !== undefined) update.max_points = patch.maxPoints;
      if (patch.minPurchaseAmount !== undefined) update.min_purchase_amount = patch.minPurchaseAmount;
      if (patch.effectiveStart !== undefined) update.effective_start = patch.effectiveStart;
      if (patch.effectiveEnd !== undefined) update.effective_end = patch.effectiveEnd;
      if (patch.isActive !== undefined) update.is_active = patch.isActive;
      if (patch.promotionReference !== undefined) {
        update.promotion_reference = patch.promotionReference;
      }
      update.updated_at = new Date().toISOString();

      const { data, error } = await db
        .from('point_redemption_rules')
        .update(update)
        .eq('id', patchRule[1])
        .select(REDEMPTION_RULE_COLUMNS)
        .single();
      if (error) return mapRpcError(res, error);
      const row = data as Record<string, unknown>;
      await audit(
        db,
        auth.userId,
        'REDEMPTION_RULE_UPDATED',
        'point_redemption_rules',
        patchRule[1],
        existing.data,
        row,
      );
      return res.status(200).json(toRedemptionRule(row));
    }

    /* ---------------- GET /points/redemption-rules ----------------
     *
     * Readable by anyone who may read points, because choosing what a member can
     * spend on requires seeing the current promotions. Writable only through the
     * two authorized routes above; the browser holds no table privilege at all.
     * -------------------------------------------------------------- */
    if (path === 'redemption-rules' && verb === 'GET') {
      const { data, error } = await db
        .from('point_redemption_rules')
        .select(REDEMPTION_RULE_COLUMNS)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return list(res, ((data ?? []) as Record<string, unknown>[]).map(toRedemptionRule));
    }
    /* ---------------- GET|POST /points/rules ---------------- */
    if (path === 'rules' && verb === 'GET') {
      const { data, error } = await db
        .from('point_earning_rules')
        .select(
          'id, service_id, points_amount, eligible_tiers, effective_start, effective_end, is_active, min_quantity, max_award, promotion_reference, created_at, updated_at',
        )
        .order('created_at', { ascending: false });
      if (error) throw error;
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          serviceId: row.service_id,
          pointsAmount: Number(row.points_amount),
          eligibleTiers: row.eligible_tiers ?? [],
          effectiveStart: isoOrNull(row.effective_start),
          effectiveEnd: isoOrNull(row.effective_end),
          isActive: row.is_active === true,
          minQuantity: Number(row.min_quantity ?? 1),
          maxAward: row.max_award === null || row.max_award === undefined ? null : Number(row.max_award),
          promotionReference: row.promotion_reference ?? null,
          createdAt: isoOrNull(row.created_at),
          updatedAt: isoOrNull(row.updated_at),
        })),
      );
    }

    if (path === 'rules' && verb === 'POST') {
      const write = await authorizeAfHomes(req, 'operations.catalog', 'create');
      if ('error' in write) return deny(res, write);
      const parsed = pointEarningRuleInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the earning rule and try again.', 400);
      }
      const rule = parsed.data;
      // The service must exist and be active, so a rule can never point at
      // nothing and silently earn nothing for every purchase of it.
      const service = await db
        .from('service_catalog')
        .select('id, is_active')
        .eq('id', rule.serviceId)
        .maybeSingle();
      if (service.error) return mapRpcError(res, service.error);
      if (!service.data) return fail(res, 'NOT_FOUND', 'No service matches that reference', 404);
      if (service.data.is_active !== true) {
        return fail(res, 'CONFLICT', 'That service is deactivated.', 409);
      }
      const { data, error } = await db
        .from('point_earning_rules')
        .insert({
          service_id: rule.serviceId,
          points_amount: rule.pointsAmount,
          eligible_tiers: rule.eligibleTiers,
          effective_start: rule.effectiveStart,
          effective_end: rule.effectiveEnd,
          is_active: rule.isActive,
          min_quantity: rule.minQuantity,
          max_award: rule.maxAward,
          promotion_reference: rule.promotionReference,
        })
        .select('id, points_amount, effective_start, effective_end, is_active')
        .single();
      if (error) return mapRpcError(res, error);
      const row = data as Record<string, unknown>;
      await audit(db, auth.userId, 'EARNING_RULE_CREATED', 'point_earning_rules', String(row.id), null, {
        serviceId: rule.serviceId,
        pointsAmount: rule.pointsAmount,
        eligibleTiers: rule.eligibleTiers,
      });
      return res.status(201).json({
        id: row.id,
        serviceId: rule.serviceId,
        pointsAmount: Number(row.points_amount),
        eligibleTiers: rule.eligibleTiers,
        effectiveStart: isoOrNull(row.effective_start),
        effectiveEnd: isoOrNull(row.effective_end),
        isActive: row.is_active === true,
      });
    }

    /* ---------------- POST /points/purchases/:id/points-discount ----------------
     *
     * THE TILL. A GSD spends a member's points as part of the sale, in one step.
     *
     * The body carries a points figure and a POS reference and NOTHING else: no
     * peso value, no rate, no balance, no resulting net. The server resolves the
     * CONFIGURED conversion rate from point_redemption_rules and prices it, so a
     * tampered body cannot change what the member pays.
     *
     * The reference is the idempotency key. A retried request returns the
     * original figures instead of spending the points twice, and the database
     * enforces that as well.
     * -------------------------------------------------------------- */
    const applyDiscount = route(req, 'POST', /^purchases\/([^/]+)\/points-discount$/);
    if (applyDiscount) {
      const write = await authorizeAfHomes(req, 'operations.sales', 'create');
      if ('error' in write) return deny(res, write);
      const parsed = applyPointsDiscountInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Enter how many points to use.', 400);
      }
      const { data, error } = await db.rpc('apply_purchase_points_discount', {
        p_purchase_id: applyDiscount[1],
        p_points_requested: parsed.data.pointsRequested,
        p_reference: parsed.data.reference,
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      const result = appliedPointsDiscountSchema.parse({
        purchaseId: row?.purchase_id ?? applyDiscount[1],
        pointsSpent: Number(row?.points_spent ?? 0),
        discountApplied: String(row?.discount_applied ?? '0.00'),
        netAmount: String(row?.net_amount ?? '0.00'),
        balanceAfter: Number(row?.balance_after ?? 0),
        alreadyApplied: row?.already_applied === true,
      });
      return res.status(200).json(result);
    }

    /* ---------------- GET /points/purchases/:id/settlement ----------------
     *
     * The ONE settlement answer, for both the GSD screen and the Finance screen.
     * Read only: it never completes a purchase, verifies a receipt or creates a
     * claim, so refreshing it cannot advance the transaction by itself.
     * -------------------------------------------------------------- */
    const settlementRoute = route(req, 'GET', /^purchases\/([^/]+)\/settlement$/);
    if (settlementRoute) {
      const read = await authorizeAfHomes(req, 'operations.sales', 'view');
      if ('error' in read) return deny(res, read);
      const { data, error } = await db.rpc('operational_purchase_settlement', {
        p_purchase_id: settlementRoute[1],
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'NOT_FOUND', 'Purchase not found', 404);
      return res.status(200).json(
        operationalSettlementSchema.parse({
          purchaseId: row.purchase_id,
          purchaseNumber: row.purchase_number,
          status: row.status,
          grossAmount: row.gross_amount,
          tierDiscountAmount: row.tier_discount_amount,
          pointsDiscountAmount: row.points_discount_amount,
          netAmount: row.net_amount,
          recordedTotal: row.recorded_total,
          verifiedTotal: row.verified_total,
          rejectedTotal: row.rejected_total,
          remainingAmount: row.remaining_amount,
          verifiedReceipts: Number(row.verified_receipts ?? 0),
          rejectedReceipts: Number(row.rejected_receipts ?? 0),
          pendingReceipts: Number(row.pending_receipts ?? 0),
          fullyPaid: row.fully_paid === true,
          claimable: row.claimable === true,
          claimId: (row.claim_id as string | null) ?? null,
          claimStatus: (row.claim_status as string | null) ?? null,
        }),
      );
    }

    /* ---------------- POST /points/purchases/:id/complete ---------------- */
    const complete = route(req, 'POST', /^purchases\/([^/]+)\/complete$/);
    if (complete) {
      // Completing is safe for the seller to call, because the DATABASE refuses
      // it unless verified receipts already cover the net: this verb cannot
      // manufacture settlement. What it must not do is verify, and it does not.
      const write = await authorizeAfHomes(req, 'operations.sales', 'create');
      if ('error' in write) return deny(res, write);
      const { data, error } = await db.rpc('complete_purchase', {
        p_purchase_id: complete[1],
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(200).json({
        purchaseId: complete[1],
        netAmount: String(row?.net_amount ?? ''),
        verifiedTotal: String(row?.verified_total ?? ''),
        fullyPaid: true,
      });
    }

    /* ---------------- POST /points/purchases/:id/reverse ---------------- */
    const reverse = route(req, 'POST', /^purchases\/([^/]+)\/reverse$/);
    if (reverse) {
      const write = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in write) return deny(res, write);
      const parsed = reversePurchaseInputSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'A reason is required to reverse a purchase.', 400);
      }
      const { data, error } = await db.rpc('reverse_purchase_points', {
        p_purchase_id: reverse[1],
        p_actor_id: auth.userId,
        p_reason: parsed.data.reason,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(200).json({
        reversedPoints: Number(row?.reversed_points ?? 0),
        reversalDebt: Number(row?.reversal_debt ?? 0),
        balanceAfter: Number(row?.balance_after ?? 0),
      });
    }

    /* ---------------- GET /points/claims ---------------- */
    if (path === 'claims' && verb === 'GET') {
      const { data, error } = await db
        .from('earning_claims')
        .select(
          'id, claim_number, customer_id, purchase_id, status, points_requested, points_reserved, points_awarded, points_capped, expires_at, claimed_at, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      // Token hashes are NEVER selected, and fields are picked rather than
      // spread, so neither the driver nor a future column can leak one.
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          claimNumber: row.claim_number,
          customerId: row.customer_id,
          purchaseId: row.purchase_id,
          status: row.status,
          pointsRequested: Number(row.points_requested),
          pointsReserved: Number(row.points_reserved ?? 0),
          pointsAwarded: Number(row.points_awarded),
          pointsCapped: Number(row.points_capped),
          expiresAt: isoOrNull(row.expires_at),
          claimedAt: isoOrNull(row.claimed_at),
          createdAt: isoOrNull(row.created_at),
        })),
      );
    }

    /* ---------------- POST /points/claims ---------------- */
    if (path === 'claims' && verb === 'POST') {
      const write = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in write) return deny(res, write);

      const parsed = createEarningClaimRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'A purchase reference is required.', 400);
      }
      // No points figure is read from the body. The rule, the cap and the amount
      // are all resolved inside the database function.
      const { data, error } = await db.rpc('create_earning_claim', {
        p_purchase_id: parsed.data.purchaseId,
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(201).json({
        claimId: row?.claim_id,
        claimNumber: String(row?.claim_number ?? ''),
        // The ONLY time these plaintexts exist. They are stored hashed, so a
        // lost credential is reissued, never looked up.
        qrToken: String(row?.qr_token ?? ''),
        fallbackCode: String(row?.fallback_code ?? ''),
        pointsRequested: Number(row?.points_requested ?? 0),
        pointsReserved: Number(row?.points_reserved ?? 0),
        pointsCapped: Number(row?.points_capped ?? 0),
        expiresAt: isoOrNull(row?.expires_at),
      });
    }

    /* ---------------- POST /points/claims/:id/reissue ---------------- */
    const reissue = route(req, 'POST', /^claims\/([^/]+)\/reissue$/);
    if (reissue) {
      const write = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in write) return deny(res, write);
      const { data, error } = await db.rpc('reissue_earning_claim', {
        p_claim_id: reissue[1],
        p_actor_id: auth.userId,
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      return res.status(200).json({
        claimId: reissue[1],
        claimNumber: String(row?.claim_number ?? ''),
        qrToken: String(row?.qr_token ?? ''),
        fallbackCode: String(row?.fallback_code ?? ''),
        expiresAt: isoOrNull(row?.expires_at),
      });
    }

    return fail(res, 'NOT_FOUND', 'Not found', 404);
  } catch (error) {
    return mapRpcError(res, error as { message?: string });
  }
}
