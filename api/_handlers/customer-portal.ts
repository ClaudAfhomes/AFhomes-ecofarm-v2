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
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Membership credential policy, stated once.
 *
 * Only a SHA-256 hash of the QR token and of the fallback member code is stored,
 * so neither can be reconstructed for display. Rather than storing them in
 * plaintext or adding an encrypted column plus a new secret, they are ROTATED:
 * `POST /customer/membership/credentials` mints fresh values, invalidates the old
 * ones immediately, and returns the new plaintext exactly once.
 *
 * The consequence for the UI is deliberate and visible to the member: a code is
 * never displayed on demand, only issued on request, with a warning that the
 * previous one stops working.
 */
const CREDENTIALS_NOTE =
  'Your card code is stored only as a one-way hash, so it cannot be displayed again. ' +
  'Request a new one to receive it; the previous code stops working immediately.';

const CREDENTIALS_NEED_REASON =
  'Request a new card code to receive your QR code and fallback member code. ' +
  'They are shown once and the previous ones stop working.';

const activeMembershipOf = async (db: Db, customerId: string) => {
  const { data, error } = await db
    .from('memberships')
    .select(
      'id, membership_number, status, product_id, activated_at, expires_at, renewal_due_at, yearly_points_allocated, points_balance, card_plans!inner(name, code)',
    )
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Record<string, unknown> | null;
};

const toMembership = (row: Record<string, unknown>, hasIssued: boolean) => {
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    membershipNumber: row.membership_number,
    productName: isoOrNull(product.name),
    productCode: isoOrNull(product.code),
    status: row.status,
    activatedAt: isoOrNull(row.activated_at),
    expiresAt: isoOrNull(row.expires_at),
    renewalDueAt: isoOrNull(row.renewal_due_at),
    yearlyPointsAllocated: Number(row.yearly_points_allocated ?? 0),
    pointsBalance: Number(row.points_balance ?? 0),
    // Always false by design: a readable code is never available on demand.
    credentialsAvailable: false as const,
    credentialsNote: hasIssued ? CREDENTIALS_NOTE : CREDENTIALS_NEED_REASON,
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
          'id, customer_number, first_name, middle_name, last_name, suffix, email, phone, birth_date, address, status, created_at, updated_at',
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

      return res.status(200).json(toMembership(row, true));
    }

    /* ---------------- points summary ---------------- */
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
        .select('id, sale_id, amount, payment_type, method, reference, status, recorded_at, verified_at')
        .in('sale_id', saleIds)
        .order('recorded_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: row.id,
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
