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
  purchaseReceiptInputSchema,
  reversePurchaseInputSchema,
  purchaseReceiptDecisionSchema,
  serviceTierDiscountInputSchema,
  servicePolicyStatusSchema,
  operationalSettlementSchema,
} from '@afhomes/contracts';

import { authorizeAfHomes, resolveAfHomesPrincipal } from '../_lib/afhomes-access.js';
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
import { hashIdentifier, normalizeIdentifier } from '../_lib/identifier.js';
import { handleServiceCatalog } from './_service-catalog.js';
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
  NO_REDEMPTION_RATE: ['CONFLICT', 'No current promotion price is available for these items.', 409],
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
  maxPoints:
    row.max_points === null || row.max_points === undefined ? null : Number(row.max_points),
  minPurchaseAmount:
    row.min_purchase_amount === null || row.min_purchase_amount === undefined
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
      'id, purchase_number, customer_id, membership_id, status, gross_amount, tier_discount_amount, tier_snapshot, points_discount_amount, net_amount, created_by, completed_at, reversed_at, reversal_reason, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const customerIds = [...new Set(rows.map((r) => String(r.customer_id)))];
  const actorIds = [...new Set(rows.map((r) => String(r.created_by)).filter(Boolean))];

  // Everything below is BATCHED: one query per related table for the whole page,
  // never one per row. A list that issued a query per purchase would be slow at
  // exactly the moment Finance is busiest.
  const [paymentsRes, customersRes, staffRes, claimsRes] = await Promise.all([
    db.from('purchase_payments').select('purchase_id, amount, status').in('purchase_id', ids),
    db.from('customers').select('id, first_name, middle_name, last_name').in('id', customerIds),
    actorIds.length
      ? db.from('staff_users').select('id, full_name').in('id', actorIds)
      : Promise.resolve({ data: [] as unknown[] }),
    db.from('earning_claims').select('purchase_id, status').in('purchase_id', ids),
  ]);

  // Money is summed as exact decimals in SQL-free code by integer minor units,
  // never by Number(): a peso figure must not pass through a float.
  const sumMoney = (values: string[]): string => {
    let total = 0n;
    for (const v of values) {
      const [whole, frac = ''] = String(v).split('.');
      total += BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2) || '0');
    }
    const sign = total < 0n ? '-' : '';
    const abs = total < 0n ? -total : total;
    return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  };

  // Money is compared in integer minor units. A STRING comparison of decimals
  // is wrong the moment a figure gains a digit ("100.00" vs "99.00"), so both
  // sides go through the same exact conversion first.
  const minorUnits = (value: string): bigint => {
    const [whole, frac = ''] = String(value).split('.');
    return BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2) || '0');
  };

  const recordedBy = new Map<string, string[]>();
  const verifiedBy = new Map<string, string[]>();
  for (const p of (paymentsRes.data ?? []) as Record<string, unknown>[]) {
    const pid = String(p.purchase_id);
    const bucket =
      p.status === 'verified' ? verifiedBy : p.status === 'recorded' ? recordedBy : null;
    if (!bucket) continue;
    bucket.set(pid, [...(bucket.get(pid) ?? []), String(p.amount)]);
  }

  const customerName = new Map<string, string>();
  for (const c of (customersRes.data ?? []) as Record<string, unknown>[]) {
    customerName.set(
      String(c.id),
      [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ').trim() ||
        'Unknown customer',
    );
  }

  const staffName = new Map<string, string>();
  for (const s of (staffRes.data ?? []) as Record<string, unknown>[]) {
    staffName.set(String(s.id), String(s.full_name ?? ''));
  }

  const claimBy = new Map<string, string>();
  for (const c of (claimsRes.data ?? []) as Record<string, unknown>[]) {
    claimBy.set(String(c.purchase_id), String(c.status));
  }
  const { data: lines } = await db
    .from('purchase_lines')
    .select(
      'id, purchase_id, service_id, service_name_snapshot, pricing_unit_snapshot, quantity, unit_amount, line_total, tier_discount_amount, tier_discount_rate, tier',
    )
    .in('purchase_id', ids);
  const byPurchase = new Map<string, Record<string, unknown>[]>();
  for (const line of (lines ?? []) as Record<string, unknown>[]) {
    const key = String(line.purchase_id);
    const bucket = byPurchase.get(key) ?? [];
    bucket.push({
      id: line.id,
      serviceId: line.service_id,
      serviceName: line.service_name_snapshot ?? null,
      pricingUnit: line.pricing_unit_snapshot ?? null,
      quantity: Number(line.quantity),
      unitAmount: String(line.unit_amount),
      lineTotal: String(line.line_total),
      // The SNAPSHOT, so the list shows the rate that was actually applied
      // rather than whatever the rule says today.
      tierDiscountAmount: String(line.tier_discount_amount ?? '0.00'),
      tierDiscountRate:
        line.tier_discount_rate === null || line.tier_discount_rate === undefined
          ? undefined
          : Number(line.tier_discount_rate),
      tier: line.tier ?? undefined,
    });
    byPurchase.set(key, bucket);
  }
  return rows.map((row) => {
    const id = String(row.id);
    const verified = sumMoney(verifiedBy.get(id) ?? []);
    const net = String(row.net_amount);
    const claimStatus = claimBy.get(id) ?? null;
    return {
      id: row.id,
      purchaseNumber: row.purchase_number,
      customerId: row.customer_id,
      membershipId: row.membership_id,
      status: row.status,
      grossAmount: String(row.gross_amount),
      tierDiscountAmount: String(row.tier_discount_amount ?? '0.00'),
      tierSnapshot: (row.tier_snapshot ?? null) as 'BRONZE' | 'SILVER' | 'GOLD' | null,
      pointsDiscountAmount: String(row.points_discount_amount),
      netAmount: net,
      recordedTotal: sumMoney(recordedBy.get(id) ?? []),
      verifiedTotal: verified,
      createdByName: staffName.get(String(row.created_by)) ?? null,
      customerName: customerName.get(String(row.customer_id)) ?? null,
      claimStatus,
      // Claimable is the same conjunction the database uses: completed AND
      // verified money covering the net AND an available claim.
      claimable:
        row.status === 'completed' &&
        minorUnits(verified) >= minorUnits(net) &&
        claimStatus === 'available',
      completedAt: isoOrNull(row.completed_at),
      reversedAt: isoOrNull(row.reversed_at),
      reversalReason: row.reversal_reason ?? null,
      createdAt: isoOrNull(row.created_at),
      lines: byPurchase.get(id) ?? [],
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Server configuration is incomplete', 500);

  const verb = method(req);
  const path = subPath(req);

  try {
    if (path === 'services' || path.startsWith('services/') || path === 'public/services')
      return await handleServiceCatalog(req, res, path);
    /* ================================================================
     * THE CUSTOMER PATH: POST /points/claim
     *
     * This is the QR scan. It is reached by the customer, authenticated as
     * themselves, and the identity is resolved SERVER-SIDE from the session.
     * It requires no staff permission at all: a member redeeming their own
     * claim is a customer action, not a staff one.
     * ================================================================ */
    if ((path === 'claim' || path === 'claim/preview') && verb === 'POST') {
      const resolved = await resolveCustomerPrincipal(req);
      if ('error' in resolved) {
        return res.status(resolved.error.status).json({ error: resolved.error.error });
      }
      const parsed = claimEarningPointsRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Check the claim code and try again.', 400);
      }
      if (resolved.status !== 'active')
        return fail(res, 'FORBIDDEN', 'Your customer account is not active.', 403);
      let credential = parsed.data.token;
      if (/^https?:\/\//i.test(credential)) {
        try {
          const url = new URL(credential);
          if (url.pathname !== '/customer/points' || !url.searchParams.get('c'))
            throw new Error('Not a claim URL');
          credential = url.searchParams.get('c')!;
        } catch {
          return fail(res, 'VALIDATION_ERROR', 'Use a purchase claim QR or typed claim code.', 400);
        }
      }
      credential = normalizeIdentifier(credential);
      if (path === 'claim/preview') {
        const hash = hashIdentifier(credential);
        const { data, error } = await db
          .from('earning_claims')
          .select(
            'claim_number, status, points_requested, points_awarded, points_capped, expires_at, purchases(purchase_number), service_catalog(name)',
          )
          .eq('customer_id', resolved.customerId)
          .or(`qr_token_hash.eq.${hash},fallback_code_hash.eq.${hash}`)
          .maybeSingle();
        if (error) return mapRpcError(res, error);
        if (!data) return fail(res, 'NOT_FOUND', 'That claim code cannot be used.', 404);
        const row = data as Record<string, unknown>;
        if (row.status !== 'available' || new Date(String(row.expires_at)).getTime() <= Date.now())
          return fail(
            res,
            'CONFLICT',
            'This claim is already used or expired. Ask the branch for help.',
            409,
          );
        return res.status(200).json({
          claimNumber: row.claim_number,
          purchaseNumber:
            (row.purchases as Record<string, unknown> | null)?.purchase_number ?? null,
          serviceName: (row.service_catalog as Record<string, unknown> | null)?.name ?? null,
          pointsRequested: Number(row.points_requested),
          pointsReserved: Number(row.points_awarded),
          pointsCapped: Number(row.points_capped),
          expiresAt: isoOrNull(row.expires_at),
        });
      }
      // p_customer_id comes from the session, never from the body. The schema is
      // strict, so a forged customerId in the payload was already rejected.
      const { data, error } = await db.rpc('claim_earning_points', {
        p_token: credential,
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
    const auth = await resolveAfHomesPrincipal(req);
    if ('error' in auth) return deny(res, auth);

    /* ---------------- GET /points/purchases ----------------
     *
     * The Sales Records list, so it is gated on `sales.customers` VIEW rather
     * than on `operations.sales`. That is the deliberate separation: being able
     * to RECORD a sale must not hand a GSD the whole company's sales history.
     * `employee` holds no `sales.customers` row at all, so the operational
     * screen can read back its own sale through the per-purchase summary below
     * without ever seeing the ledger of everyone else's. */
    if ((path === 'purchases' || path === 'finance/purchases') && verb === 'GET') {
      const records = await authorizeAfHomes(
        req,
        path === 'finance/purchases' ? 'operations.payments' : 'sales.customers',
        'view',
      );
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
      // SQL prices the selected services from the catalog and freezes the result.
      const { data, error } = await db.rpc('create_purchase', {
        p_membership_id: parsed.data.membershipId,
        p_gross_amount: '0.00',
        p_lines: parsed.data.lines.map((l) => ({
          serviceId: l.serviceId,
          quantity: l.quantity,
        })),
        // The idempotency key. Without it a retried request creates a SECOND
        // real purchase that could earn points.
        p_reference: parsed.data.reference,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (
        !row?.purchase_id ||
        typeof row.gross_amount !== 'string' ||
        typeof row.net_amount !== 'string'
      )
        return fail(
          res,
          'INTERNAL',
          'The recorded sale could not be read. Check Sales Records before retrying.',
          500,
        );
      return res.status(201).json({
        purchaseId: row?.purchase_id ?? row?.id,
        purchaseNumber: String(row?.purchase_number ?? ''),
        grossAmount: String(row?.gross_amount),
        // The SERVER resolved and applied this. The browser may display it and
        // may not influence it: a rate is never sent up, only read back down.
        tierDiscountAmount: String(row?.tier_discount_amount ?? '0.00'),
        netAmount: String(row?.net_amount),
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
        return fail(
          res,
          'VALIDATION_ERROR',
          'Choose verify or reject, with a reason if rejecting.',
          400,
        );
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
      const reader = await authorizeAfHomes(req, 'operations.payments', 'view');
      if ('error' in reader) return deny(res, reader);
      const { data, error } = await db
        .from('purchase_payments')
        .select(
          'id, payment_number, amount, method, reference, status, recorded_by, verified_by, recorded_at, verified_at, rejection_reason',
        )
        .eq('purchase_id', payListRoute[1])
        .order('recorded_at', { ascending: false });
      if (error) throw error;
      // Scoped in JS because the fake has no PostgREST nested-filter support; the
      // result set is tiny and the security boundary is the permission above, not
      // the filter.
      const rows = (data ?? []) as Record<string, unknown>[];
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
      const reader = await authorizeAfHomes(req, 'operations.redemption', 'view');
      if ('error' in reader) return deny(res, reader);
      const { data, error } = await db
        .from('earning_claims')
        .select(
          'id, claim_number, customer_id, purchase_id, account_id, status, points_requested, points_awarded, points_capped, period_id, expires_at, claimed_at, created_at',
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
        pointsReserved:
          row.status === 'available' && new Date(String(row.expires_at)).getTime() > Date.now()
            ? Number(row.points_awarded ?? 0)
            : 0,
        pointsAwarded: row.claimed_at ? Number(row.points_awarded ?? 0) : 0,
        pointsCapped: Number(row.points_capped ?? 0),
        expiresAt: isoOrNull(row.expires_at),
        claimedAt: isoOrNull(row.claimed_at),
        reversedAt: isoOrNull(row.reversed_at),
        createdAt: isoOrNull(row.created_at),
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
      const reader = await authorizeAfHomes(
        req,
        auth.permissions.some((p) => p.moduleKey === 'operations.payments' && p.canView)
          ? 'operations.payments'
          : 'operations.sales',
        'view',
      );
      if ('error' in reader) return deny(res, reader);
      const { data, error } = await db.rpc('purchase_financial_summary_purchases', {
        p_purchase_id: summaryRoute[1],
      });
      if (error) return refuse(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'NOT_FOUND', 'No purchase matches that reference', 404);
      return res.status(200).json({
        purchaseId: row.purchase_id,
        grossAmount: String(row.gross_amount),
        // The VIP service-tier discount, reported as its OWN figure. It was
        // missing here while the database already returned it and the contract
        // already declared it optional - so the Finance screen silently showed a
        // gross and a net with no explanation of the gap between them.
        tierDiscountAmount: String(row.tier_discount_amount ?? '0.00'),
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
      const write = await authorizeAfHomes(req, 'operations.redemption', 'update');
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

    const policyStatus = route(req, 'PATCH', /^(rules|tier-discounts)\/([^/]+)$/);
    if (policyStatus) {
      const writer = await authorizeAfHomes(req, 'operations.catalog', 'update');
      if ('error' in writer) return deny(res, writer);
      const parsed = servicePolicyStatusSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Choose an active status.', 400);
      const { error } = await db.rpc('set_service_policy_active', {
        p_kind: policyStatus[1] === 'rules' ? 'earning_rule' : 'tier_discount',
        p_id: policyStatus[2],
        p_active: parsed.data.isActive,
        p_actor_id: writer.userId,
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json(parsed.data);
    }

    /* ---------------- GET /earning/tier-discounts ----------------
     *
     * The Operational Services VIP rate table. Readable by anyone who may sell,
     * because the sale screen has to SHOW the member what rate applies; only
     * `operations.catalog` may change one, so a GSD can read the price and
     * never write it.
     * -------------------------------------------------------------- */
    if (path === 'tier-discounts' && verb === 'GET') {
      const reader = await authorizeAfHomes(req, 'operations.catalog', 'view');
      if ('error' in reader) return deny(res, reader);
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
        {
          reason: `Operational Services tier rate ${String(row.discount_rate)}% for ${String(row.tier)}`,
        },
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

    if (path === 'rules' && verb === 'GET') {
      const reader = await authorizeAfHomes(req, 'operations.catalog', 'view');
      if ('error' in reader) return deny(res, reader);
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
          maxAward:
            row.max_award === null || row.max_award === undefined ? null : Number(row.max_award),
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
          created_by: auth.userId,
        })
        .select('id, points_amount, effective_start, effective_end, is_active')
        .single();
      if (error) return mapRpcError(res, error);
      const row = data as Record<string, unknown>;
      await audit(
        db,
        auth.userId,
        'EARNING_RULE_CREATED',
        'point_earning_rules',
        String(row.id),
        null,
        {
          serviceId: rule.serviceId,
          pointsAmount: rule.pointsAmount,
          eligibleTiers: rule.eligibleTiers,
        },
      );
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

    /* ---------------- GET /points/purchases/:id/settlement ----------------
     *
     * The ONE settlement answer, for both the GSD screen and the Finance screen.
     * Read only: it never completes a purchase, verifies a receipt or creates a
     * claim, so refreshing it cannot advance the transaction by itself.
     * -------------------------------------------------------------- */
    const settlementRoute = route(req, 'GET', /^purchases\/([^/]+)\/settlement$/);
    if (settlementRoute) {
      const read = await authorizeAfHomes(
        req,
        auth.permissions.some((p) => p.moduleKey === 'operations.payments' && p.canView)
          ? 'operations.payments'
          : 'operations.sales',
        'view',
      );
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
      const write = await authorizeAfHomes(req, 'operations.redemption', 'update');
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
      const reader = await authorizeAfHomes(req, 'operations.redemption', 'view');
      if ('error' in reader) return deny(res, reader);
      const { data, error } = await db
        .from('earning_claims')
        .select(
          'id, claim_number, customer_id, purchase_id, status, points_requested, points_awarded, points_capped, expires_at, claimed_at, created_at, customers(customer_number, first_name, middle_name, last_name), memberships(membership_number), purchases(purchase_number), service_catalog(name)',
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
          customerNumber:
            (row.customers as Record<string, unknown> | null)?.customer_number ?? null,
          customerName: row.customers
            ? ['first_name', 'middle_name', 'last_name']
                .map((key) => (row.customers as Record<string, unknown>)[key])
                .filter(Boolean)
                .join(' ')
            : null,
          membershipNumber:
            (row.memberships as Record<string, unknown> | null)?.membership_number ?? null,
          purchaseNumber:
            (row.purchases as Record<string, unknown> | null)?.purchase_number ?? null,
          serviceName: (row.service_catalog as Record<string, unknown> | null)?.name ?? null,
          status:
            row.status === 'available' && new Date(String(row.expires_at)).getTime() <= Date.now()
              ? 'expired'
              : row.status,
          pointsRequested: Number(row.points_requested),
          pointsReserved:
            row.status === 'available' && new Date(String(row.expires_at)).getTime() > Date.now()
              ? Number(row.points_awarded ?? 0)
              : 0,
          pointsAwarded:
            row.claimed_at && (row.status === 'claimed' || row.status === 'reversed')
              ? Number(row.points_awarded)
              : 0,
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
