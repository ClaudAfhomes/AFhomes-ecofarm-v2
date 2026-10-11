/**
 * Customer portal reads: `GET /customer/*`.
 *
 * Every route resolves the customer principal from OWNERSHIP
 * (`customers.auth_user_id`), never from the staff permission model, and then
 * scopes every query to that one customer id. The staff resolver is not
 * imported here, so there is no code path by which a customer reaches a staff
 * capability.
 *
 * The read models are built field by field rather than by spreading a row, so a
 * column added to a table later cannot silently leak into the customer portal.
 * That is the same reason the migration narrowed the browser column grants.
 */
import {
  fail,
  isoOrNull,
  type Db,
  list,
  mapRpcError,
  method,
  route,
  subPath,
} from '../_lib/handler-kit.js';
import {
  isActiveCustomer,
  resolveCustomerPrincipal,
  type CustomerPrincipal,
} from '../_lib/customer-access.js';
import { cardQrPayload } from '../_lib/identifier.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Membership credential policy, stated once.
 *
 * Two identifier families exist for one membership:
 *
 * - The PERSISTENT card identifiers: the membership number (`memberCode`)
 *   and the `AFHOMES:` QR payload (`qrPayload`). Stable, displayable and
 *   re-scannable for the life of the membership. Possession authorizes
 *   nothing: every redemption re-validates membership status, expiry, points
 *   and staff permission server-side.
 * - The ONE-TIME secrets: the QR token and fallback member code minted at
 *   activation. Only SHA-256 hashes are stored, so neither can be
 *   reconstructed for display. They are ROTATED, never recovered:
 *   `POST /customer/membership/credentials` mints fresh values, invalidates
 *   the old ones immediately, and returns the new plaintext exactly once.
 */
const CREDENTIALS_NOTE =
  'Your member code and QR below never change - show them at any AF Homes Ecofarm desk. ' +
  'Only a SHA-256 hash of the separate one-time card secret is stored, so that secret cannot be displayed again; ' +
  'request a new one only if the printed secret is lost, and the previous secret stops working immediately.';

const CREDENTIALS_NEED_REASON =
  'Your member code and QR below never change - show them at any AF Homes Ecofarm desk. ' +
  'The separate one-time card secret is shown once at issuance; request a new pair only if it is lost.';

const activeMembershipOf = async (db: Db, customerId: string) => {
  const { data, error } = await db
    .from('memberships')
    .select(
      'id, sale_id, membership_number, status, product_id, activated_at, expires_at, renewal_due_at, yearly_points_allocated, points_balance, card_plans!inner(name, code)',
    )
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Record<string, unknown> | null;
};

/**
 * The member's OWN agreed scheme + frozen validity, resolved from their sale.
 * Only this one scheme is ever exposed - never the move playbook, never
 * prices, never other tiers. A second, narrow sale read (service role, inside
 * the ownership-established principal) keeps the membership select minimal.
 */
const schemeOfSale = async (
  db: Db,
  saleId: unknown,
): Promise<{ paymentScheme: string; validityMonths: number | null }> => {
  const fallback = { paymentScheme: 'spot_cash', validityMonths: null as number | null };
  if (typeof saleId !== 'string' || !saleId) return fallback;
  const { data, error } = await db
    .from('card_sales')
    .select('payment_scheme,validity_months_snapshot')
    .eq('id', saleId)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const months =
    row.validity_months_snapshot === null || row.validity_months_snapshot === undefined
      ? null
      : Number(row.validity_months_snapshot);
  return {
    paymentScheme: typeof row.payment_scheme === 'string' ? row.payment_scheme : 'spot_cash',
    validityMonths: months,
  };
};

const toMembership = (
  row: Record<string, unknown>,
  hasIssued: boolean,
  scheme: { paymentScheme: string; validityMonths: number | null },
) => {
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  const months = scheme.validityMonths;
  const membershipNumber = String(row.membership_number ?? '');
  return {
    id: row.id,
    membershipNumber,
    productName: isoOrNull(product.name),
    productCode: isoOrNull(product.code),
    status: row.status,
    activatedAt: isoOrNull(row.activated_at),
    expiresAt: isoOrNull(row.expires_at),
    renewalDueAt: isoOrNull(row.renewal_due_at),
    yearlyPointsAllocated: Number(row.yearly_points_allocated ?? 0),
    pointsBalance: Number(row.points_balance ?? 0),
    paymentScheme: scheme.paymentScheme,
    validityYears: months !== null && months > 0 && months % 12 === 0 ? months / 12 : null,
    // Always false by design: a one-time secret is never available on demand.
    // The persistent card identifiers below are always available instead.
    credentialsAvailable: false as const,
    credentialsNote: hasIssued ? CREDENTIALS_NOTE : CREDENTIALS_NEED_REASON,
    memberCode: membershipNumber,
    qrPayload: cardQrPayload(membershipNumber),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Server configuration is incomplete', 500);

  try {
    if (method(req) !== 'GET' && method(req) !== 'POST') {
      return fail(res, 'NOT_FOUND', 'Not found', 404);
    }

    const resolved = await resolveCustomerPrincipal(req);
    if ('error' in resolved) {
      return res.status(resolved.error.status).json({ error: resolved.error.error });
    }
    const principal: CustomerPrincipal = resolved;
    const path = subPath(req);

    /* ---------------- profile ---------------- */
    if (path === '' && method(req) === 'GET') {
      const { data, error } = await db
        .from('customers')
        .select(
          'id, customer_number, customer_code, first_name, middle_name, last_name, suffix, email, phone, birth_date, address, status, created_at, updated_at',
        )
        .eq('id', principal.customerId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Profile not found', 404);
      const row = data as Record<string, unknown>;
      const address = (row.address ?? {}) as Record<string, unknown>;

      return res.status(200).json({
        id: row.id,
        customerNumber: row.customer_number,
        // Own code only: the principal is resolved from the session, so this
        // cannot be pointed at another customer.
        customerCode: row.customer_code ?? null,
        firstName: row.first_name,
        middleName: isoOrNull(row.middle_name),
        lastName: row.last_name,
        suffix: isoOrNull(row.suffix),
        fullName: [row.first_name, row.middle_name, row.last_name, row.suffix]
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
          .join(' '),
        email: row.email,
        phone: row.phone,
        dateOfBirth: isoOrNull(row.birth_date),
        addressLine1: isoOrNull(address.line1),
        addressLine2: isoOrNull(address.line2),
        city: isoOrNull(address.city),
        province: isoOrNull(address.province),
        countryCode: isoOrNull(address.countryCode ?? address.country_code),
        status: row.status,
        activatedAt: isoOrNull(row.updated_at),
        updatedAt: isoOrNull(row.updated_at) ?? '',
      });
    }

    /* ---------------- membership ---------------- */
    if (path === 'membership' && method(req) === 'GET') {
      // A suspended or cancelled member may still read their profile, but must
      // not read membership or points. Enforced here AND by RLS ownership.
      if (!isActiveCustomer(principal)) {
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${principal.status}. Contact AF Homes Ecofarm to restore access.`,
          403,
        );
      }
      const row = await activeMembershipOf(db, principal.customerId);
      if (!row) return fail(res, 'NOT_FOUND', 'No active membership found', 404);

      const { count } = await db
        .from('customer_onboarding_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', principal.customerId);
      void count;

      return res.status(200).json(toMembership(row, true, await schemeOfSale(db, row.sale_id)));
    }

    /* ---------------- points summary (LEGACY SHAPE, UNCHANGED) ----------------
     *
     * This response is FROZEN. It is what deployed clients already validate
     * against, so its fields and their meanings must not change:
     *   balance          - the raw account balance
     *   lifetimeAllocated / lifetimeRedeemed - the historical totals
     *   updatedAt        - when the account row last changed
     *
     * The richer position - spendable, remaining annual earning capacity and
     * reversal debt - lives at `points/position`, a SEPARATE endpoint, because
     * `balance` alone cannot express them and changing this shape would break a
     * client that is already deployed.
     *
     * Deliberately NOT "fixed" here: a member at their annual cap still sees a
     * healthy `balance` here. That is correct for this endpoint, and the portal
     * reads `points/position` for anything that needs to distinguish the three.
     * -------------------------------------------------------------- */
    if (path === 'points' && method(req) === 'GET') {
      if (!isActiveCustomer(principal)) {
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${principal.status}. Contact AF Homes Ecofarm to restore access.`,
          403,
        );
      }
      const membership = await activeMembershipOf(db, principal.customerId);
      if (!membership) return fail(res, 'NOT_FOUND', 'No active membership found', 404);

      const { data, error } = await db
        .from('points_accounts')
        .select('id, membership_id, balance, lifetime_allocated, lifetime_redeemed, updated_at')
        .eq('membership_id', membership.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(200).json({
          membershipId: membership.id,
          balance: 0,
          lifetimeAllocated: 0,
          lifetimeRedeemed: 0,
          updatedAt: '',
        });
      }
      const account = data as Record<string, unknown>;
      return res.status(200).json({
        membershipId: account.membership_id,
        balance: Number(account.balance ?? 0),
        lifetimeAllocated: Number(account.lifetime_allocated ?? 0),
        lifetimeRedeemed: Number(account.lifetime_redeemed ?? 0),
        updatedAt: isoOrNull(account.updated_at) ?? '',
      });
    }

    /* ---------------- points position (NEW, additive) ----------------
     *
     * The same ownership, the same active-customer gate and the same membership
     * lookup as `points` - this is an ADDITIVE endpoint, not a replacement, and it
     * authorizes identically.
     *
     * Three figures, never collapsed: balance, what is SPENDABLE now, and what may
     * still be EARNED this period. The last is a CEILING, not money: a member who
     * has hit their annual limit has capacity 0 and a healthy spendable balance,
     * and rendering that as one number would tell them they have run out when they
     * have not. Reversal debt is reported on its own because it reduces only what
     * may be spent - never what may be earned.
     *
     * Every figure is computed by public.customer_points_position, which calls
     * the SAME ensure_points_period the earning path uses. The browser never does
     * this arithmetic.
     * -------------------------------------------------------------- */
    if (path === 'points/position' && method(req) === 'GET') {
      if (!isActiveCustomer(principal)) {
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${principal.status}. Contact AF Homes Ecofarm to restore access.`,
          403,
        );
      }
      const membership = await activeMembershipOf(db, principal.customerId);
      if (!membership) return fail(res, 'NOT_FOUND', 'No active membership found', 404);

      const { data, error } = await db.rpc('customer_points_position', {
        p_membership_id: membership.id,
      });
      if (error) {
        // A membership with no points account yet is a real state, not a failure:
        // a brand-new card has nothing accrued, so the member sees zeroes.
        if (/POINTS_ACCOUNT_NOT_FOUND/.test(error.message ?? '')) {
          return res.status(200).json({
            membershipId: membership.id,
            balance: 0,
            annualCap: 0,
            remainingEarningCapacity: 0,
            spendable: 0,
            reversalDebt: 0,
            periodStart: '',
            periodEnd: '',
            tier: 'BRONZE',
            earnedThisPeriod: 0,
            redeemedThisPeriod: 0,
          });
        }
        throw error;
      }
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'NOT_FOUND', 'No points account found', 404);
      return res.status(200).json({
        membershipId: row.membership_id,
        balance: Number(row.balance ?? 0),
        annualCap: Number(row.annual_cap ?? 0),
        remainingEarningCapacity: Number(row.remaining_earning_capacity ?? 0),
        spendable: Number(row.spendable ?? 0),
        reversalDebt: Number(row.reversal_debt ?? 0),
        periodStart: isoOrNull(row.period_start) ?? '',
        periodEnd: isoOrNull(row.period_end) ?? '',
        tier: row.tier ?? 'BRONZE',
        earnedThisPeriod: Number(row.earned_this_period ?? 0),
        redeemedThisPeriod: Number(row.redeemed_this_period ?? 0),
      });
    }

    /* ---------------- points ledger ---------------- */
    if (path === 'points/ledger' && method(req) === 'GET') {
      if (!isActiveCustomer(principal)) {
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${principal.status}. Contact AF Homes Ecofarm to restore access.`,
          403,
        );
      }
      const membership = await activeMembershipOf(db, principal.customerId);
      if (!membership) return fail(res, 'NOT_FOUND', 'No active membership found', 404);

      const { data: account } = await db
        .from('points_accounts')
        .select('id')
        .eq('membership_id', membership.id)
        .maybeSingle();
      if (!account) return list(res, []);

      const { data, error } = await db
        .from('points_ledger')
        // actor_id and metadata are deliberately not selected.
        .select('id, entry_type, amount, balance_after, reason, reference_type, reference_id, created_at')
        .eq('account_id', (account as { id: string }).id)
        .order('id', { ascending: false })
        .limit(100);
      if (error) throw error;

      const rows = (data ?? []) as Record<string, unknown>[];

      /* Redemption rows are joined in so the member sees WHAT they spent points
       * on, not just a number going down. The driving set is already this
       * customer's own ledger, and the redemption is additionally pinned to the
       * same customer id, so the join cannot widen anything. */
      const redemptionRefs = [
        ...new Set(
          rows
            .filter((r) => r.entry_type === 'redemption' && typeof r.reference_id === 'string')
            .map((r) => String(r.reference_id)),
        ),
      ];
      const redemptionByRef = new Map<string, Record<string, unknown>>();
      if (redemptionRefs.length > 0) {
        const { data: redemptions } = await db
          .from('redemptions')
          .select('id, redemption_number, item_name_snapshot, item_code_snapshot, quantity, total_points, customer_id')
          .in('id', redemptionRefs)
          .eq('customer_id', principal.customerId);
        for (const row of (redemptions ?? []) as Record<string, unknown>[]) {
          redemptionByRef.set(String(row.id), row);
        }
      }

      return list(
        res,
        rows.map((row) => {
          const redemption =
            row.entry_type === 'redemption' && typeof row.reference_id === 'string'
              ? redemptionByRef.get(String(row.reference_id))
              : undefined;
          return {
            id: String(row.id),
            entryType: row.entry_type,
            amount: Number(row.amount),
            balanceAfter: Number(row.balance_after),
            reason: isoOrNull(row.reason),
            occurredAt: isoOrNull(row.created_at) ?? '',
            // Present only on a redemption, and only ever for this member.
            ...(redemption
              ? {
                  redemptionNumber: String(redemption.redemption_number),
                  itemName: String(redemption.item_name_snapshot),
                  itemCode: String(redemption.item_code_snapshot),
                  quantity: Number(redemption.quantity ?? 1),
                }
              : {}),
          };
        }),
      );
    }

    /* ---------------- payment history ---------------- */
    if (path === 'payments' && method(req) === 'GET') {
      if (!isActiveCustomer(principal)) {
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${principal.status}. Contact AF Homes Ecofarm to restore access.`,
          403,
        );
      }
      // Only this customer's own card sales, then only those sales' payments.
      // Staff ids, receipt paths, rejection reasons and notes are deliberately
      // never selected, so finance internals cannot reach the portal.
      const { data: sales, error: salesError } = await db
        .from('card_sales')
        .select('id')
        .eq('customer_id', principal.customerId);
      if (salesError) throw salesError;
      const saleIds = ((sales ?? []) as Record<string, unknown>[]).map((s) => String(s.id));
      if (saleIds.length === 0) return list(res, []);
      const { data, error } = await db
        .from('payments')
        .select('id, sale_id, payment_number, amount, payment_type, method, reference, status, recorded_at, verified_at')
        .in('sale_id', saleIds)
        .order('recorded_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          paymentNumber: (row.payment_number as string | null | undefined) ?? null,
          saleId: row.sale_id,
          amount: row.amount,
          paymentType: isoOrNull(row.payment_type),
          method: row.method,
          reference: isoOrNull(row.reference),
          status: row.status,
          recordedAt: isoOrNull(row.recorded_at) ?? '',
          verifiedAt: isoOrNull(row.verified_at),
        })),
      );
    }

    /* ---------------- re-issue card credentials ---------------- */
    const credentials = route(req, 'POST', /^membership\/credentials$/);
    if (credentials) {
      if (!isActiveCustomer(principal)) {
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${principal.status}. Contact AF Homes Ecofarm to restore access.`,
          403,
        );
      }
      const membership = await activeMembershipOf(db, principal.customerId);
      if (!membership) return fail(res, 'NOT_FOUND', 'No active membership found', 404);

      const { data, error } = await db.rpc('reissue_membership_credentials', {
        p_membership_id: membership.id,
        p_customer_id: principal.customerId,
        p_actor_id: principal.userId,
      });
      if (error) return mapRpcError(res, error);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { membership_id: string; fallback_code: string; qr_token: string }
        | undefined;
      if (!row) return fail(res, 'INTERNAL', 'Could not issue a new card code', 500);

      // Returned exactly once. It is never stored in readable form, so this
      // response is the only time the member will ever see it.
      return res.status(201).json({
        membershipId: row.membership_id,
        membershipNumber: membership.membership_number,
        fallbackCode: row.fallback_code,
        qrToken: row.qr_token,
        issuedAt: new Date().toISOString(),
        previousCodesInvalidated: true as const,
      });
    }

    void credentials;
    return fail(res, 'NOT_FOUND', 'Not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] customer portal:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
