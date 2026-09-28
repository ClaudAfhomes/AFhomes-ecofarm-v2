/**
 * AF Homes memberships (cards), identifier resolution, and the points ledger.
 *
 * An identifier NEVER authorizes anything. `GET /memberships/resolve` is the one
 * place a scanned QR token or a typed fallback code becomes a membership row,
 * and it returns only status/points - the caller must still be authorized and
 * must still check status and balance. The QR token is a 256-bit random value
 * with no customer data of any kind encoded in it.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  markedPrintedSchema,
  membershipCardSchema,
  reissueMembershipCardSchema,
  reissuedMembershipCardSchema,
} from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
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

/** Must match private.hash_token() in the migration exactly. */
export const hashIdentifier = (value: string) => createHash('sha256').update(value).digest('hex');

const toMembership = (row: Record<string, unknown>) => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName:
      [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
        .filter((p) => typeof p === 'string' && p)
        .join(' ') || 'Unknown customer',
    saleId: row.sale_id,
    membershipNumber: row.membership_number,
    productId: isoOrNull(row.product_id),
    productName: isoOrNull(product.name),
    status: row.status,
    pointsBalance: Number(row.points_balance ?? 0),
    yearlyPointsAllocated: Number(row.yearly_points_allocated ?? 0),
    activatedAt: isoOrNull(row.activated_at),
    expiresAt: isoOrNull(row.expires_at),
    renewalDueAt: isoOrNull(row.renewal_due_at),
    // Memberships are born at activation and have no separate created_at.
    createdAt: isoOrNull(row.activated_at) ?? '',
  };
};

const SELECT_MEMBERSHIP =
  '*, customers!inner(first_name, middle_name, last_name, suffix), card_plans!inner(name)';

const SELECT_CARD =
  '*, customers!inner(first_name, middle_name, last_name, suffix), card_plans!inner(name, code)';

/**
 * Staff who may READ a card: redemption, activation, and customer service.
 *
 * NOTE: this must try each grant in turn. `a ?? b` on two objects never falls
 * through (both are truthy), so a chain written that way silently keeps only
 * the first module and denies the other two responsibilities.
 */
async function authorizeCardStaff(req: VercelRequest) {
  const redemption = await authorizeAfHomes(req, 'operations.redemption');
  if (!('error' in redemption)) return redemption;
  const activation = await authorizeAfHomes(req, 'finance.card_activation');
  if (!('error' in activation)) return activation;
  return authorizeAfHomes(req, 'sales.customers');
}

/**
 * Printable card data. No hashes, no customer/staff UUIDs: the membership id
 * is already in the URL, the member is a display name, and the tier comes
 * from the product catalogue. Credential codes are NEVER here - hash-only
 * storage means they cannot be recovered, only rotated.
 */
const toCard = (row: Record<string, unknown>) => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  return {
    membershipId: row.id,
    membershipNumber: row.membership_number,
    memberName:
      [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
        .filter((p) => typeof p === 'string' && p)
        .join(' ') || 'Unknown customer',
    tierName: typeof product.name === 'string' && product.name ? product.name : 'AF Homes card',
    tierCode: typeof product.code === 'string' ? product.code : '',
    status: row.status,
    pointsBalance: Number(row.points_balance ?? 0),
    activatedAt: isoOrNull(row.activated_at),
    expiresAt: isoOrNull(row.expires_at),
    cardIssuedAt: isoOrNull(row.card_issued_at),
    lastPrintedAt: isoOrNull(row.last_printed_at),
    printCount: Number(row.print_count ?? 0),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    /* ---------------- resolve an identifier ---------------- */
    if (subPath(req) === 'resolve' && method(req) === 'GET') {
      // Three staff responsibilities may look a card up: redemption, activation,
      // and customer service. All are audited elsewhere; this is a read.
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);

      const identifier = String(req.query.identifier ?? '').trim();
      if (identifier.length < 4 || identifier.length > 200)
        return fail(res, 'VALIDATION_ERROR', 'An identifier is required', 400);

      const hash = hashIdentifier(identifier);
      // A single lookup: the value is either a QR token or a fallback code.
      const { data, error } = await db
        .from('memberships')
        .select(
          'id, membership_number, status, points_balance, expires_at, qr_token_hash, fallback_code_hash',
        )
        .or(`qr_token_hash.eq.${hash},fallback_code_hash.eq.${hash}`)
        .limit(1);
      if (error) throw error;

      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) return fail(res, 'NOT_FOUND', 'No membership matches that identifier', 404);

      const expiresAt = isoOrNull(row.expires_at);
      const expired = expiresAt !== null && new Date(expiresAt).valueOf() <= Date.now();
      // Deliberately no customer name, email, or government data in this shape:
      // a lookup response travels to a staff device and must stay minimal.
      return res.status(200).json({
        membershipId: row.id,
        membershipNumber: row.membership_number,
        status: row.status,
        pointsBalance: Number(row.points_balance ?? 0),
        expired,
      });
    }

    /* ---------------- list ---------------- */
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const parsed = z
        .object({
          status: z.string().trim().max(30).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, limit, offset } = parsed.data;

      let query = db.from('memberships').select(SELECT_MEMBERSHIP, { count: 'exact' });
      if (status) query = query.eq('status', status);
      const { data, error, count } = await query
        .order('activated_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => toMembership(row)),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    /* ---------------- detail ---------------- */
    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('memberships')
        .select(SELECT_MEMBERSHIP)
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      return res.status(200).json(toMembership(data as Record<string, unknown>));
    }

    /* ---------------- points account ---------------- */
    const account = route(req, 'GET', /^accounts\/([0-9a-f-]+)$/);
    if (account) {
      const auth = await authorizeAfHomes(req, 'finance.points');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('points_accounts')
        .select('*')
        .eq('membership_id', account[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Points account not found', 404);
      return res.status(200).json({
        id: data.id,
        membershipId: data.membership_id,
        balance: Number(data.balance),
        lifetimeAllocated: Number(data.lifetime_allocated),
        lifetimeRedeemed: Number(data.lifetime_redeemed),
        updatedAt: isoOrNull(data.updated_at) ?? '',
      });
    }

    /* ---------------- points ledger ---------------- */
    const ledger = route(req, 'GET', /^ledger\/([0-9a-f-]+)$/);
    if (ledger) {
      const auth = await authorizeAfHomes(req, 'finance.points');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('points_ledger')
        .select('*')
        .eq('account_id', ledger[1]!)
        .order('id', { ascending: false })
        .limit(200);
      if (error) throw error;
      return list(
        res,
        (data ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          accountId: row.account_id,
          entryType: row.entry_type,
          amount: Number(row.amount),
          balanceAfter: Number(row.balance_after),
          referenceType: isoOrNull(row.reference_type),
          referenceId: isoOrNull(row.reference_id),
          reason: isoOrNull(row.reason),
          createdAt: isoOrNull(row.created_at) ?? '',
        })),
      );
    }

    /* ---------------- printable card data ---------------- */
    const card = route(req, 'GET', /^([0-9a-f-]+)\/card$/);
    if (card) {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('memberships')
        .select(SELECT_CARD)
        .eq('id', card[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      // Contract-validated: the card shape can never drift to include a hash
      // or an internal id, because the schema rejects it here first.
      const parsed = membershipCardSchema.safeParse(toCard(data as Record<string, unknown>));
      if (!parsed.success) return fail(res, 'INTERNAL', 'Card data is unavailable', 500);
      return res.status(200).json(parsed.data);
    }

    /* ---------------- rotate credentials (privileged reissue) ---------------- */
    const reissue = route(req, 'POST', /^([0-9a-f-]+)\/reissue$/);
    if (reissue) {
      // Card activation staff only: redemption redeems, customer service
      // reads, but neither rotates credentials. Sellers never reach this.
      const auth = await authorizeAfHomes(req, 'finance.card_activation', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = reissueMembershipCardSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'A reissue requires a reason', 400);
      const id = reissue[1]!;
      const { data: membership, error: readError } = await db
        .from('memberships')
        .select('id, customer_id, membership_number, status, points_balance')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!membership) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      const beforeBalance = Number(membership.points_balance ?? 0);

      // The same rotation the portal uses for self-service: row-locked, the
      // old hashes are replaced so previous codes die immediately, balances
      // and identity are untouched, and exactly one membership remains.
      const { data: rotated, error: rpcError } = await db.rpc('reissue_membership_credentials', {
        p_membership_id: id,
        p_customer_id: membership.customer_id,
        p_actor_id: auth.userId,
      });
      if (rpcError) return mapRpcError(res, rpcError);
      const rotatedRow = (Array.isArray(rotated) ? rotated[0] : rotated) as Record<
        string,
        unknown
      > | null;
      if (!rotatedRow?.fallback_code || !rotatedRow?.qr_token)
        return fail(res, 'INTERNAL', 'Reissue returned no credentials', 500);

      // The rotation itself is audited inside the RPC. This second event is
      // the privileged-reason record: actor, membership, reason, timestamp.
      // Plaintext codes appear in NEITHER payload.
      await audit(
        db,
        auth.userId,
        'MEMBERSHIP_CREDENTIALS_REISSUED',
        'membership',
        id,
        { previousCodesInvalidated: true },
        {
          membershipNumber: membership.membership_number,
          reason: parsed.data.reason,
          pointsBalanceUnchanged: beforeBalance,
        },
      );
      const response = reissuedMembershipCardSchema.safeParse({
        membershipId: id,
        membershipNumber: membership.membership_number,
        fallbackCode: rotatedRow.fallback_code,
        qrToken: rotatedRow.qr_token,
        issuedAt: new Date().toISOString(),
        previousCodesInvalidated: true,
      });
      if (!response.success) return fail(res, 'INTERNAL', 'Reissue returned no credentials', 500);
      return res.status(201).json(response.data);
    }

    /* ---------------- record a print (never a rotation) ---------------- */
    const markPrinted = route(req, 'POST', /^([0-9a-f-]+)\/mark-printed$/);
    if (markPrinted) {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const id = markPrinted[1]!;
      const { data: membership, error: readError } = await db
        .from('memberships')
        .select('id, membership_number, print_count')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!membership) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      const reprint = Number(membership.print_count ?? 0) > 0;
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db
        .from('memberships')
        .update({ last_printed_at: now, print_count: Number(membership.print_count ?? 0) + 1 })
        .eq('id', id)
        .select('print_count, last_printed_at')
        .single();
      if (updateError) throw updateError;
      const stamped = updated as Record<string, unknown>;
      await audit(
        db,
        auth.userId,
        reprint ? 'MEMBERSHIP_CARD_REPRINTED' : 'MEMBERSHIP_CARD_PRINTED',
        'membership',
        id,
        null,
        {
          membershipNumber: membership.membership_number,
          printCount: Number(stamped.print_count ?? 0),
        },
      );
      const response = markedPrintedSchema.safeParse({
        membershipId: id,
        printCount: Number(stamped.print_count ?? 0),
        lastPrintedAt: isoOrNull(stamped.last_printed_at) ?? now,
        reprint,
      });
      if (!response.success) return fail(res, 'INTERNAL', 'Print could not be recorded', 500);
      return res.status(200).json(response.data);
    }

    return fail(res, 'NOT_FOUND', 'Membership endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] memberships:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
