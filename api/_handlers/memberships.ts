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

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  deny,
  fail,
  isoOrNull,
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
export const hashIdentifier = (value: string) =>
  createHash('sha256').update(value).digest('hex');

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
    createdAt: isoOrNull(row.created_at) ?? '',
  };
};

const SELECT_MEMBERSHIP =
  '*, customers!inner(first_name, middle_name, last_name, suffix), card_plans!inner(name)';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    /* ---------------- resolve an identifier ---------------- */
    if (subPath(req) === 'resolve' && method(req) === 'GET') {
      // Three staff responsibilities may look a card up: redemption, activation,
      // and customer service. All are audited elsewhere; this is a read.
      const auth =
        (await authorizeAfHomes(req, 'operations.redemption')) ??
        (await authorizeAfHomes(req, 'finance.card_activation')) ??
        (await authorizeAfHomes(req, 'sales.customers'));
      if ('error' in auth) return deny(res, auth);

      const identifier = String(req.query.identifier ?? '').trim();
      if (identifier.length < 4 || identifier.length > 200)
        return fail(res, 'VALIDATION_ERROR', 'An identifier is required', 400);

      const hash = hashIdentifier(identifier);
      // A single lookup: the value is either a QR token or a fallback code.
      const { data, error } = await db
        .from('memberships')
        .select('id, membership_number, status, points_balance, expires_at, qr_token_hash, fallback_code_hash')
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
      const auth = await authorizeAfHomes(req, 'operations.redemption');
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
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => toMembership(row)),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    /* ---------------- detail ---------------- */
    const detail = route(req, 'GET', /^memberships\/([0-9a-f-]+)$/);
    if (detail) {
      const auth = await authorizeAfHomes(req, 'operations.redemption');
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
    const account = route(req, 'GET', /^points\/accounts\/([0-9a-f-]+)$/);
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
    const ledger = route(req, 'GET', /^points\/ledger\/([0-9a-f-]+)$/);
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

    return fail(res, 'NOT_FOUND', 'Membership endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] memberships:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
