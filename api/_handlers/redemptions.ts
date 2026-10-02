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
import {
  createRedemptionItemRequestSchema,
  createRedemptionRequestSchema,
  updateRedemptionItemRequestSchema,
} from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  deny,
  fail,
  isoOrNull,
  type Db,
  jsonBody,
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

/** A database refusal -> a stable, safe client message. */
const REFUSALS: Record<string, [string, string, number]> = {
  ACTOR_REQUIRED: ['UNAUTHORIZED', 'Sign in to continue', 401],
  ACTOR_NOT_STAFF: ['FORBIDDEN', 'This is not a staff account.', 403],
  ACTOR_NOT_ACTIVE: ['FORBIDDEN', 'Your staff account is not active.', 403],
  IDEMPOTENCY_KEY_REQUIRED: ['VALIDATION_ERROR', 'A transaction reference is required.', 400],
  INVALID_QUANTITY: ['VALIDATION_ERROR', 'Check the quantity.', 400],
  INVALID_TOTAL_POINTS: ['VALIDATION_ERROR', 'Check the quantity.', 400],
  MEMBERSHIP_NOT_FOUND: ['NOT_FOUND', 'No membership matches that identifier', 404],
  CUSTOMER_NOT_FOUND: ['NOT_FOUND', 'No membership matches that identifier', 404],
  CUSTOMER_NOT_ACTIVE: ['CONFLICT', 'This customer account is not active.', 409],
  MEMBERSHIP_NOT_ACTIVE: ['CONFLICT', 'This membership is not active.', 409],
  MEMBERSHIP_EXPIRED: ['CONFLICT', 'This membership has expired.', 409],
  REDEMPTION_ITEM_NOT_FOUND: ['NOT_FOUND', 'That redemption item does not exist', 404],
  REDEMPTION_ITEM_INACTIVE: ['CONFLICT', 'That redemption item is no longer available', 409],
  POINTS_ACCOUNT_NOT_FOUND: ['CONFLICT', 'This membership has no points account.', 409],
  // The detail after the colon (how many points are needed) is deliberately NOT
  // surfaced. It is a business-safe figure, but returning it lets a probing
  // caller confirm a balance they were not entitled to be told about. The preview
  // already shows the member their own balance to an authorized employee.
  INSUFFICIENT_POINTS: ['CONFLICT', 'The customer does not have enough points for this item.', 409],
};

const splitCode = (message: string) => (message.split(':')[0] ?? '').trim();

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
          p.moduleKey === 'operations.catalog' &&
          (p.canCreate === true || p.canUpdate === true),
      );
      const query = (req.query ?? {}) as Record<string, unknown>;
      const activeParam = String(query.active ?? '').toLowerCase();
      const legacyAll = String(query.includeInactive ?? '') === 'true';
      const mode =
        activeParam === 'all' || legacyAll ? 'all' : activeParam === 'false' ||
          activeParam === 'inactive' ? 'inactive' : 'active';
      const effective = mode === 'active' || !canSeeInactive ? 'active' : mode;
      let itemsQuery = db.from('redemption_items').select(ITEM_SELECT);
      if (effective === 'active') itemsQuery = itemsQuery.eq('is_active', true);
      if (effective === 'inactive') itemsQuery = itemsQuery.eq('is_active', false);
      const { data, error } = await itemsQuery.order('sort_order').order('name');
      if (error) throw error;
      const needle = String(query.search ?? '').trim().toLowerCase();
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
          p.moduleKey === 'operations.catalog' &&
          (p.canCreate === true || p.canUpdate === true),
      );
      if (row.is_active !== true && !canSeeInactive)
        return fail(res, 'NOT_FOUND', 'That redemption item does not exist', 404);
      return res.status(200).json(toItem(row));
    }

    /* ================================================================
     * POST /redemptions/items  - create
     * ================================================================ */
    if (path === 'items' && verb === 'POST') {
      const auth = await authorizeAfHomes(req, 'operations.catalog', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = createRedemptionItemRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the item details.', 400);
      const now = new Date().toISOString();

      const { data, error } = await db
        .from('redemption_items')
        .insert({
          code: parsed.data.code,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          category: parsed.data.category,
          points_cost: parsed.data.pointsCost,
          sort_order: parsed.data.sortOrder,
          is_active: true,
          created_at: now,
          updated_at: now,
        })
        .select(ITEM_SELECT)
        .single();
      if (error) {
        if (/duplicate key|already exists/i.test(error.message ?? '')) {
          return fail(res, 'CONFLICT', 'An item with that code already exists', 409);
        }
        throw error;
      }
      await audit(db, auth.userId, 'REDEMPTION_ITEM_CREATED', 'redemption_item', data.id, {
        code: data.code,
        pointsCost: Number(data.points_cost),
      });
      return res.status(201).json(toItem(data as Record<string, unknown>));
    }

    /* ================================================================ */
    const itemRoute = route(req, 'PATCH', /^items\/([0-9a-f-]+)$/);
    const itemPut = route(req, 'PUT', /^items\/([0-9a-f-]+)$/);
    if (itemRoute || itemPut) {
      const id = (itemRoute ?? itemPut)![1]!;
      const auth = await authorizeAfHomes(req, 'operations.catalog', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = updateRedemptionItemRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the item details.', 400);

      const { data: before, error: readError } = await db
        .from('redemption_items')
        .select('id,is_active')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'That redemption item does not exist', 404);
      // Snapshot pre-update state NOW: a row reference may be live (the
      // in-memory double mutates it in place on update).
      const wasActive = (before as Record<string, unknown>).is_active === true;

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.description !== undefined) patch.description = parsed.data.description;
      if (parsed.data.category !== undefined) patch.category = parsed.data.category;
      if (parsed.data.pointsCost !== undefined) patch.points_cost = parsed.data.pointsCost;
      if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
      if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;

      const { data, error } = await db
        .from('redemption_items')
        .update(patch)
        .eq('id', id)
        .select(ITEM_SELECT)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'That redemption item does not exist', 404);

      // Deactivation and reactivation are their own audited events:
      // deactivation stops the item being usable without removing it from
      // history, and reactivation returns it to the sellable set.
      const deactivated = parsed.data.isActive === false;
      const activated = parsed.data.isActive === true && !wasActive;
      await audit(
        db,
        auth.userId,
        deactivated
          ? 'REDEMPTION_ITEM_DEACTIVATED'
          : activated
            ? 'REDEMPTION_ITEM_ACTIVATED'
            : 'REDEMPTION_ITEM_UPDATED',
        'redemption_item',
        id,
        { code: data.code, ...(deactivated ? {} : { pointsCost: Number(data.points_cost) }) },
      );
      return res.status(200).json(toItem(data as Record<string, unknown>));
    }

    /* ================================================================
     * POST /redemptions  - the redemption transaction
     * ================================================================ */
    if ((path === '' || path === 'commit') && verb === 'POST') {
      const auth = await authorizeAfHomes(req, 'operations.redemption', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = createRedemptionRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Check the redemption details.', 400);

      const { membershipId, redemptionItemId, quantity, clientTransactionId } = parsed.data;

      // Was this reference already used by this staff member BEFORE this call?
      // Asking first is the only way to tell a genuine retry from a fresh
      // redemption, because after the transaction both look identical: the row
      // exists either way. It also lets the UI say "already recorded" instead of
      // printing a second receipt for a double click.
      const { data: priorRows } = await db
        .from('redemptions')
        .select('id')
        .eq('redeemed_by', auth.userId)
        .eq('idempotency_key', clientTransactionId)
        .limit(1);
      const replayed = (priorRows ?? []).length > 0;

      // `auth.userId` is the ONLY actor. The body has no staff field to forge.
      const { data, error } = await db.rpc('redeem_membership_points', {
        p_membership_id: membershipId,
        p_redemption_item_id: redemptionItemId,
        p_quantity: quantity,
        p_idempotency_key: clientTransactionId,
        p_actor_id: auth.userId,
      });
      if (error) {
        const mapped = REFUSALS[splitCode(error.message ?? '')];
        if (mapped) return fail(res, mapped[0], mapped[1], mapped[2]);
        return mapRpcError(res, error);
      }

      const row = (Array.isArray(data) ? data[0] : data) as
        Record<string, string | number> | undefined;
      if (!row) return fail(res, 'INTERNAL', 'The redemption could not be completed.', 500);

      return res.status(201).json({
        redemptionId: String(row.redemption_id),
        redemptionNumber: String(row.redemption_number),
        membershipId,
        membershipNumber: String(row.membership_number ?? ''),
        customerDisplayName: String(row.customer_name ?? ''),
        itemCode: String(row.item_code ?? ''),
        itemName: String(row.item_name ?? ''),
        unitPoints: Number(row.unit_points ?? 0),
        quantity: Number(row.quantity ?? quantity),
        totalPoints: Number(row.total_points ?? 0),
        balanceBefore: Number(row.balance_before ?? 0),
        balanceAfter: Number(row.balance_after ?? 0),
        redeemedByName: auth.fullName,
        completedAt: new Date(String(row.completed_at ?? Date.now())).toISOString(),
        replayed,
      });
    }

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
const audit = async (
  db: Db,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
) => {
  const { error } = await db.from('audit_events').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_data: data,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[api] redemption audit write failed:', error.message);
  }
};

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
