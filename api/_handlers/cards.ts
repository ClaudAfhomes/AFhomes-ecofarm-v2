/**
 * AF Homes card plans (the `card_plans` catalogue, served as `card-products`).
 *
 * Read: anyone who may sell needs the active catalogue. Non-privileged roles
 * always see active plans only; the Super Admin may also list inactive plans
 * for catalogue management.
 * Write: `sales.card_plans` create (new plans) and update (edits plus
 * activate/deactivate via `isActive`). There is deliberately no DELETE:
 * referenced plans deactivate instead, so history never loses its plan.
 * Editing a plan never alters a historical sale, because every sale stores
 * its own commercial snapshot.
 */
import {
  assertCardPlanEconomicsSane,
  assertCommissionRateInRange,
  assertProductEconomicsSane,
  createCardProductSchema,
  normalizePlanCode,
  updateCardProductSchema,
} from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { compareMoney } from '@jad/shared';
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

const toProduct = (
  row: Record<string, unknown>,
  categories: Map<string, { name: string | null; isActive: boolean }>,
) => {
  const category = categories.get(String(row.category_id ?? ''));
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: category?.name ?? null,
    categoryIsActive: category?.isActive ?? false,
    code: row.code,
    name: row.name,
    description: (row.description as string | null | undefined) ?? null,
    cashPrice: row.cash_price,
    minimumDownPayment: row.minimum_down_payment,
    yearlyPoints: row.yearly_points,
    commissionRate: row.commission_rate,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
  };
};

/** Category directory for eligibility checks and display names. */
async function categoryDirectory(db: Db): Promise<Map<string, { name: string | null; isActive: boolean }>> {
  const { data, error } = await db.from('card_categories').select('id,name,is_active');
  if (error) throw error;
  const out = new Map<string, { name: string | null; isActive: boolean }>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    out.set(String(row.id), {
      name: (row.name as string | null) ?? null,
      isActive: row.is_active === true,
    });
  }
  return out;
}

type PlanVisibility = 'active' | 'inactive' | 'all';

/**
 * Permission-aware visibility. Catalogue management is a Super Admin (and
 * update-granted Admin) concern; every other role only ever sees the active
 * catalogue it may sell from. The legacy `?includeInactive=true` flag keeps
 * working for the Super Admin.
 */
function planVisibility(req: VercelRequest, roleSlug: string): PlanVisibility {
  if (roleSlug !== 'super_admin') return 'active';
  const query = (req.query ?? {}) as Record<string, unknown>;
  const active = String(query.active ?? '').toLowerCase();
  if (active === 'false' || active === 'inactive') return 'inactive';
  if (active === 'all' || String(query.includeInactive ?? '') === 'true') return 'all';
  return 'active';
}

function applyPlanFilters(
  rows: Record<string, unknown>[],
  categories: Map<string, { name: string | null; isActive: boolean }>,
  visibility: PlanVisibility,
  search: string,
  roleSlug: string,
): Record<string, unknown>[] {
  // A plan is selectable for a NEW application only when the plan itself is
  // active AND its category is active. Non-privileged roles never see an
  // ineligible plan; the Super Admin sees the full catalogue for management
  // unless they explicitly ask for the sellable view.
  const eligible = (row: Record<string, unknown>) =>
    row.is_active === true && (categories.get(String(row.category_id))?.isActive ?? false);
  const byVisibility =
    visibility === 'all'
      ? rows
      : rows.filter((row) =>
          visibility === 'active' ? eligible(row) : row.is_active !== true,
        );
  const visible =
    roleSlug === 'super_admin' ? byVisibility : byVisibility.filter((row) => eligible(row));
  const needle = search.trim().toLowerCase();
  if (!needle) return visible;
  return visible.filter((row) =>
    `${String(row.code ?? '')} ${String(row.name ?? '')}`.toLowerCase().includes(needle),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === '' && method(req) === 'GET') {
      // A seller needs the catalogue to sell; catalogue management is a subset.
      const auth =
        (await authorizeAfHomes(req, 'sales.card_sales')) ??
        (await authorizeAfHomes(req, 'sales.card_plans'));
      if ('error' in auth) return deny(res, auth);

      const { data, error } = await db
        .from('card_plans')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      const query = (req.query ?? {}) as Record<string, unknown>;
      const categories = await categoryDirectory(db);
      const rows = applyPlanFilters(
        (data ?? []) as Record<string, unknown>[],
        categories,
        planVisibility(req, auth.roleSlug),
        String(query.search ?? ''),
        auth.roleSlug,
      );
      return list(
        res,
        rows.map((row) => toProduct(row, categories)),
      );
    }

    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.card_plans', 'create');
      if ('error' in auth) return deny(res, auth);

      const parsed = createCardProductSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid card plan', 400);
      const code = normalizePlanCode(parsed.data.code);
      if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))
        return fail(
          res,
          'VALIDATION_ERROR',
          'Plan code may only contain letters, digits, _ and -',
          400,
        );
      const sane = assertCardPlanEconomicsSane({
        cashPrice: parsed.data.cashPrice,
        minimumDownPayment: parsed.data.minimumDownPayment,
        yearlyPoints: parsed.data.yearlyPoints,
        commissionRate: parsed.data.commissionRate,
      });
      if (sane) return fail(res, 'VALIDATION_ERROR', sane, 400);

      let categoryId = parsed.data.categoryId;
      if (!categoryId) {
        const { data: category, error: categoryError } = await db
          .from('card_categories')
          .select('id')
          .eq('slug', 'membership')
          .maybeSingle();
        if (categoryError) throw categoryError;
        categoryId = (category as { id: string } | null)?.id;
        if (!categoryId)
          return fail(res, 'INTERNAL', 'Default card category is not seeded', 500);
      } else {
        const { data: category, error: categoryError } = await db
          .from('card_categories')
          .select('id,is_active')
          .eq('id', categoryId)
          .maybeSingle();
        if (categoryError) throw categoryError;
        if (!category)
          return fail(res, 'VALIDATION_ERROR', 'Unknown card category', 400);
        // New plans may only be filed under an active category.
        if ((category as { is_active?: unknown }).is_active !== true)
          return fail(res, 'VALIDATION_ERROR', 'Card category is not active', 400);
      }

      const row = {
        category_id: categoryId,
        code,
        name: parsed.data.name,
        description: parsed.data.description?.trim() ? parsed.data.description.trim() : null,
        cash_price: parsed.data.cashPrice,
        minimum_down_payment: parsed.data.minimumDownPayment,
        yearly_points: parsed.data.yearlyPoints,
        commission_rate: parsed.data.commissionRate,
        is_active: parsed.data.isActive ?? true,
        sort_order: parsed.data.sortOrder ?? 0,
      };
      const { data, error } = await db.from('card_plans').insert(row).select('*').single();
      if (error) {
        if ((error as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'A product with that code or name already exists', 409);
        throw error;
      }

      await audit(db, auth.userId, 'CARD_PLAN_CREATED', 'card_plan', String((data as { id: string }).id), null, {
        code,
        name: parsed.data.name,
        cashPrice: parsed.data.cashPrice,
      });
      const categories = await categoryDirectory(db);
      return res.status(201).json(toProduct(data as Record<string, unknown>, categories));
    }

    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const auth =
        (await authorizeAfHomes(req, 'sales.card_sales')) ??
        (await authorizeAfHomes(req, 'sales.card_plans'));
      if ('error' in auth) return deny(res, auth);

      const { data, error } = await db
        .from('card_plans')
        .select('*')
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Card plan not found', 404);
      const row = data as Record<string, unknown>;
      // The sellable catalogue is management-only beyond this point: sellers
      // asking for a retired plan - or a plan under a retired category - by
      // id get the same 404 as for an unknown id.
      const categories = await categoryDirectory(db);
      const sellable =
        row.is_active === true &&
        (categories.get(String(row.category_id))?.isActive ?? false);
      if (auth.roleSlug !== 'super_admin' && !sellable)
        return fail(res, 'NOT_FOUND', 'Card plan not found', 404);
      return res.status(200).json(toProduct(row, categories));
    }

    const update = route(req, 'PATCH', /^([0-9a-f-]+)$/);
    if (update) {
      const auth = await authorizeAfHomes(req, 'sales.card_plans', 'update');
      if ('error' in auth) return deny(res, auth);

      const id = update[1]!;
      const parsed = updateCardProductSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid product update', 400);

      const { data: before, error: readError } = await db
        .from('card_plans')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Card product not found', 404);

      const nextPrice = parsed.data.cashPrice ?? before.cash_price;
      const nextDown = parsed.data.minimumDownPayment ?? before.minimum_down_payment;
      const incoherent = assertProductEconomicsSane({
        cashPrice: nextPrice,
        minimumDownPayment: nextDown,
      });
      if (incoherent) return fail(res, 'VALIDATION_ERROR', incoherent, 400);
      if (parsed.data.cashPrice !== undefined && compareMoney(parsed.data.cashPrice, '0.00') <= 0)
        return fail(res, 'VALIDATION_ERROR', 'Cash price must be greater than zero', 400);
      const nextRate = parsed.data.commissionRate ?? (before.commission_rate as string);
      const rateError = assertCommissionRateInRange(nextRate);
      if (rateError) return fail(res, 'VALIDATION_ERROR', rateError, 400);

      // Snapshot pre-update state NOW: the row reference may be live (the
      // in-memory double mutates it in place on update), so anything read
      // from `before` after the write below cannot be trusted.
      const wasActive = before.is_active === true;
      const previousPrice = before.cash_price;

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.categoryId !== undefined) {
        const { data: target, error: targetError } = await db
          .from('card_categories')
          .select('id,is_active')
          .eq('id', parsed.data.categoryId)
          .maybeSingle();
        if (targetError) throw targetError;
        if (!target) return fail(res, 'VALIDATION_ERROR', 'Unknown card category', 400);
        // Plans may only be (re)assigned to an active category. Editing any
        // other field of a plan that already sits under an inactive category
        // stays allowed: history is managed, never stranded.
        if ((target as { is_active?: unknown }).is_active !== true)
          return fail(res, 'VALIDATION_ERROR', 'Card category is not active', 400);
        patch.category_id = parsed.data.categoryId;
      }
      if (parsed.data.code !== undefined) {
        const code = normalizePlanCode(parsed.data.code);
        if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))
          return fail(
            res,
            'VALIDATION_ERROR',
            'Plan code may only contain letters, digits, _ and -',
            400,
          );
        patch.code = code;
      }
      if (parsed.data.description !== undefined)
        patch.description = parsed.data.description?.trim() ? parsed.data.description.trim() : null;
      if (parsed.data.cashPrice !== undefined) patch.cash_price = parsed.data.cashPrice;
      if (parsed.data.minimumDownPayment !== undefined)
        patch.minimum_down_payment = parsed.data.minimumDownPayment;
      if (parsed.data.yearlyPoints !== undefined) patch.yearly_points = parsed.data.yearlyPoints;
      if (parsed.data.commissionRate !== undefined)
        patch.commission_rate = parsed.data.commissionRate;
      if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
      if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

      const { error: writeError } = await db.from('card_plans').update(patch).eq('id', id);
      if (writeError) {
        if ((writeError as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'A product with that code or name already exists', 409);
        throw writeError;
      }

      const activating = parsed.data.isActive === true && !wasActive;
      const deactivating = parsed.data.isActive === false && wasActive;
      await audit(
        db,
        auth.userId,
        activating ? 'CARD_PLAN_ACTIVATED' : deactivating ? 'CARD_PLAN_DEACTIVATED' : 'CARD_PLAN_UPDATED',
        'card_plan',
        id,
        before,
        {
          ...parsed.data,
          previousPrice,
        },
      );
      const { data: after, error: afterError } = await db
        .from('card_plans')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (afterError) throw afterError;
      const categories = await categoryDirectory(db);
      return res.status(200).json(toProduct(after as Record<string, unknown>, categories));
    }

    return fail(res, 'NOT_FOUND', 'Card product endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] card-products:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}

/** Exposed for the sale handler: reject a product whose economics cannot be sold. */
export function productDownPaymentExceedsPrice(price: string, down: string): boolean {
  return compareMoney(down, price) > 0;
}
