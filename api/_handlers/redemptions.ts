/**
 * AF Homes staff redemption: identifier resolution, the catalog, the redemption
 * transaction, and redemption history.
 *
 * Authorization model, and it is the existing one - no new vocabulary:
 *
 *   operations.redemption  view    -> open the screen, resolve a member, read history
 *   operations.redemption  create  -> redeem points
 *   operations.catalog     view    -> see the catalog in order to redeem
 *   operations.catalog     create/update -> maintain the catalog
 *
 * The acting staff member is ALWAYS `principal.userId`, resolved from the
 * authenticated session. There is no body field for a staff id, and the database
 * function re-validates the actor independently.
 *
 * Scanning does NOT deduct anything. `GET /redemptions/resolve` returns a
 * preview; only `POST /redemptions` moves points, inside one database
 * transaction.
 */

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
import {
  authoritativeBalance,
  redemptionBlocker,
  resolveMembershipByIdentifier,
} from '../_lib/identifier.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/** The name a member is greeted by. No government data, ever. */
const displayNameOf = (row: Record<string, unknown>): string => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  return (
    [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join(' ') || 'Unknown customer'
  );
};

const toItem = (row: Record<string, unknown>) => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  description: isoOrNull(row.description),
  category: String(row.category ?? 'general'),
  pointsCost: Number(row.points_cost ?? 0),
  isActive: row.is_active === true,
  sortOrder: Number(row.sort_order ?? 0),
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});

const toRedemption = (row: Record<string, unknown>) => {
  const membership = (row.memberships ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    redemptionNumber: String(row.redemption_number),
    membershipId: String(row.membership_id),
    membershipNumber: String(membership.membership_number ?? ''),
    customerId: String(row.customer_id),
    customerDisplayName: displayNameOf(row),
    redemptionItemId: String(row.redemption_item_id),
    itemCodeSnapshot: String(row.item_code_snapshot),
    itemNameSnapshot: String(row.item_name_snapshot),
    pointsCostSnapshot: Number(row.points_cost_snapshot ?? 0),
    quantity: Number(row.quantity ?? 1),
    totalPoints: Number(row.total_points ?? 0),
    balanceBeforeSnapshot: Number(row.balance_before_snapshot ?? 0),
    balanceAfterSnapshot: Number(row.balance_after_snapshot ?? 0),
    status: String(row.status),
    redeemedBy: String(row.redeemed_by),
    redeemedByName: String(row.redeemed_by_name ?? ''),
    createdAt: isoOrNull(row.created_at) ?? '',
    completedAt: isoOrNull(row.completed_at) ?? '',
    voidedAt: isoOrNull(row.voided_at),
    voidReason: isoOrNull(row.void_reason),
  };
};

const SELECT_REDEMPTION =
  '*, customers!inner(first_name, middle_name, last_name, suffix), ' +
  'memberships!inner(membership_number)';

const ITEM_SELECT =
  'id, code, name, description, category, points_cost, is_active, sort_order, created_at, updated_at';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  const path = subPath(req);
  const verb = method(req);

  try {
    if ((path === 'items' && verb === 'POST') || (path.startsWith('items/') && verb === 'PATCH')) {
      const auth = await authorizeAfHomes(
        req,
        'operations.catalog',
        verb === 'POST' ? 'create' : 'update',
      );
      if ('error' in auth) return deny(res, auth);
      return fail(res, 'NOT_FOUND', 'Catalog points spending has been retired.', 404);
    }
    /* ================================================================
     * GET /redemptions/resolve?identifier=...
     *
     * Preview only. NOTHING is deducted, and no staff body field is read.
     * ================================================================ */
    if (path === 'resolve' && verb === 'GET') {
      const auth = await authorizeAfHomes(req, 'operations.redemption', 'view');
      if ('error' in auth) return deny(res, auth);

      const rate = consumeIdentifierAttempt(req, auth.userId);
      if (!rate.allowed) {
        return fail(
          res,
          'RATE_LIMITED',
          'Too many lookups. Please wait a moment and try again.',
          429,
        );
      }

      const identifier = String(req.query.identifier ?? '');
      if (!identifier.trim()) {
        return fail(res, 'VALIDATION_ERROR', 'An identifier is required', 400);
      }

      const resolved = await resolveMembershipByIdentifier(db, identifier);
      // One refusal for unknown, rotated-out and malformed alike. Distinguishing
      // them would let a caller probe which codes ever existed.
      if (!resolved) return fail(res, 'NOT_FOUND', 'No membership matches that identifier', 404);

      const blocker = redemptionBlocker(resolved.membership);
      return res.status(200).json({
        membershipId: resolved.membership.id,
        membershipNumber: resolved.membership.membership_number,
        customerDisplayName:
          (await displayNameFor(db, resolved.membership.customer_id)) ?? 'Unknown customer',
        productName: resolved.membership.product_name,
        membershipStatus: resolved.membership.status,
        expired:
          resolved.membership.expires_at !== null &&
          new Date(resolved.membership.expires_at).valueOf() <= Date.now(),
        redeemable: blocker === null,
        blockedReason: blocker,
        pointsBalance: authoritativeBalance(resolved.membership),
        matchedBy: resolved.matchedBy,
      });
    }

    /* ================================================================
     * GET /redemptions/items  - the catalog
     * ================================================================ */
    if (path === 'items' && verb === 'GET') {
      // Catalog viewing needs the redemption permission (to choose an item) OR
      // the catalog permission (to manage it).
      const auth =
        (await authorizeAfHomes(req, 'operations.redemption', 'view')) ??
        (await authorizeAfHomes(req, 'operations.catalog', 'view'));
      if ('error' in auth) return deny(res, auth);

      // Inactive items are management-only: redemption operators and the
      // Phase 22 POS fetch normally receive active items only. A caller that
      // holds catalog management (create or update - viewing alone is not
      // enough) may ask for the inactive or full set.
      const canSeeInactive = (auth.permissions ?? []).some(
        (p: { moduleKey?: string; canView?: boolean; canCreate?: boolean; canUpdate?: boolean }) =>
          p.moduleKey === 'operations.catalog' && (p.canCreate === true || p.canUpdate === true),
      );
      const query = (req.query ?? {}) as Record<string, unknown>;
      const activeParam = String(query.active ?? '').toLowerCase();
      const legacyAll = String(query.includeInactive ?? '') === 'true';
      const mode =
        activeParam === 'all' || legacyAll
          ? 'all'
          : activeParam === 'false' || activeParam === 'inactive'
            ? 'inactive'
            : 'active';
      const effective = mode === 'active' || !canSeeInactive ? 'active' : mode;
      let itemsQuery = db.from('redemption_items').select(ITEM_SELECT);
      if (effective === 'active') itemsQuery = itemsQuery.eq('is_active', true);
      if (effective === 'inactive') itemsQuery = itemsQuery.eq('is_active', false);
      const { data, error } = await itemsQuery.order('sort_order').order('name');
      if (error) throw error;
      const needle = String(query.search ?? '')
        .trim()
        .toLowerCase();
      const rows = ((data ?? []) as Record<string, unknown>[]).filter(
        (row) =>
          needle.length === 0 ||
          `${String(row.code ?? '')} ${String(row.name ?? '')} ${String(row.category ?? '')}`
            .toLowerCase()
            .includes(needle),
      );
      return list(
        res,
        rows.map((row) => toItem(row)),
      );
    }

    /* ================================================================
     * GET /redemptions/items/:id  - one catalog item
     * ================================================================ */
    const itemDetail = route(req, 'GET', /^items\/([0-9a-f-]+)$/);
    if (itemDetail) {
      const auth =
        (await authorizeAfHomes(req, 'operations.redemption', 'view')) ??
        (await authorizeAfHomes(req, 'operations.catalog', 'view'));
      if ('error' in auth) return deny(res, auth);

      const { data, error } = await db
        .from('redemption_items')
        .select(ITEM_SELECT)
        .eq('id', itemDetail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'That redemption item does not exist', 404);
      const row = data as Record<string, unknown>;
      // Inactive items are management-only: without catalog management
      // (create or update) a retired item reads exactly like an unknown id.
      const canSeeInactive = (auth.permissions ?? []).some(
        (p: { moduleKey?: string; canCreate?: boolean; canUpdate?: boolean }) =>
          p.moduleKey === 'operations.catalog' && (p.canCreate === true || p.canUpdate === true),
      );
      if (row.is_active !== true && !canSeeInactive)
        return fail(res, 'NOT_FOUND', 'That redemption item does not exist', 404);
      return res.status(200).json(toItem(row));
    }

    /* ================================================================
     * POST /redemptions  - RETIRED
     *
     * Points are EARNED on a purchase and CLAIMED by the customer in their own
     * account. Spending an existing balance against a catalog item is no longer
     * part of the product, so there is no route here at all.
     *
     * The rows a member redeemed before this change remain readable through the
     * GET below; nothing was deleted. public.redeem_membership_points was also
     * revoked in 20261108000001, so this cannot be reintroduced by adding a
     * button back without an explicit database change.
     *
     * Deliberately no fallback branch: returning a refusal here would keep the
     * endpoint alive and discoverable. A 404 is the honest answer.
     * ================================================================ */
    /* ================================================================
     * GET /redemptions  - history
     *
     * Employee ownership: anyone without a global view sees ONLY the rows
     * they handled (`redeemed_by` from the session). Only admin/super_admin
     * hold the global redemption view, so only they may list everyone.
     * ================================================================ */
    if ((path === '' || path === 'history') && verb === 'GET') {
      const auth = await authorizeAfHomes(req, 'operations.redemption', 'view');
      if ('error' in auth) return deny(res, auth);
      const parsed = historyQuery(req);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid history query', 400);
      const { limit, offset, status, itemId, membershipNumber, from, to } = parsed.data;

      const globalView = auth.roleSlug === 'super_admin' || auth.roleSlug === 'admin';
      let query = db.from('redemptions').select(SELECT_REDEMPTION, { count: 'exact' });
      if (!globalView) query = query.eq('redeemed_by', auth.userId);
      if (status) query = query.eq('status', status);
      if (itemId) query = query.eq('redemption_item_id', itemId);
      if (membershipNumber) {
        // Server-side filter on the joined membership number, not a client-side
        // filter over an already-fetched page.
        const { data: matches } = await db
          .from('memberships')
          .select('id')
          .ilike('membership_number', `%${membershipNumber}%`)
          .limit(200);
        const ids = (matches ?? []).map((m: Record<string, unknown>) => String(m.id));
        if (ids.length === 0) return list(res, []);
        query = query.in('membership_id', ids);
      }
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to);

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => toRedemption(row)),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    /* ================================================================
     * GET /redemptions/:id - one redemption (ownership applies: a scoped
     * caller who did not handle this row reads it as NOT_FOUND, so a caller
     * can never probe for another employee's receipt ids).
     * ================================================================ */
    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const auth = await authorizeAfHomes(req, 'operations.redemption', 'view');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('redemptions')
        .select(SELECT_REDEMPTION)
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Redemption not found', 404);
      const row = data as Record<string, unknown>;
      const globalView = auth.roleSlug === 'super_admin' || auth.roleSlug === 'admin';
      if (!globalView && String(row.redeemed_by ?? '') !== auth.userId) {
        return fail(res, 'NOT_FOUND', 'Redemption not found', 404);
      }
      return res.status(200).json(toRedemption(row));
    }

    return fail(res, 'NOT_FOUND', 'Redemption endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] redemptions:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const displayNameFor = async (db: Db, customerId: string): Promise<string | null> => {
  const { data } = await db
    .from('customers')
    .select('first_name, middle_name, last_name, suffix')
    .eq('id', customerId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return (
    [row.first_name, row.middle_name, row.last_name, row.suffix]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join(' ') || null
  );
};

/**
 * Catalog maintenance audit. The payload carries the code and the cost only -
 * never a QR token, a fallback code, a government ID or a credential.
 */

const historyQuery = (req: VercelRequest) => {
  const iso = (v: unknown) =>
    typeof v === 'string' && !Number.isNaN(new Date(v).valueOf())
      ? new Date(v).toISOString()
      : undefined;
  const status = ['completed', 'voided'].includes(String(req.query.status))
    ? (String(req.query.status) as 'completed' | 'voided')
    : undefined;
  return {
    success: true as const,
    data: {
      limit: Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200),
      offset: Math.max(Number(req.query.offset ?? 0) || 0, 0),
      status,
      itemId: /^[0-9a-f-]{36}$/i.test(String(req.query.itemId ?? ''))
        ? String(req.query.itemId)
        : undefined,
      membershipNumber:
        typeof req.query.membershipNumber === 'string' &&
        req.query.membershipNumber.length <= 40 &&
        req.query.membershipNumber.length > 0
          ? req.query.membershipNumber.trim()
          : undefined,
      from: iso(req.query.from),
      to: iso(req.query.to),
    },
  };
};
