/**
 * AF Homes card categories (the `card_plans.category_id` vocabulary).
 *
 * Read: anyone who may sell needs the active categories to interpret the
 * catalogue. Non-privileged roles always see active-only; the Super Admin
 * may also list inactive categories for catalogue management.
 * Write: `sales.card_plans` create (new categories) and update (edits plus
 * activate/deactivate via `isActive`) - the same family that owns plans, so
 * no new permission module is required. There is deliberately no DELETE:
 * a category referenced by plans deactivates instead, and deactivation never
 * deletes plans, sales, memberships or snapshots.
 */
import {
  createCardCategorySchema,
  normalizeCategorySlug,
  updateCardCategorySchema,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
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

const toCategory = (row: Record<string, unknown>, planCount?: number) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: (row.description as string | null | undefined) ?? null,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  ...(planCount === undefined ? {} : { planCount }),
});

type CategoryVisibility = 'active' | 'inactive' | 'all';

/** Same permission-aware rule as the plan catalogue: management sees more. */
function categoryVisibility(req: VercelRequest, roleSlug: string): CategoryVisibility {
  if (roleSlug !== 'super_admin') return 'active';
  const query = (req.query ?? {}) as Record<string, unknown>;
  const active = String(query.active ?? '').toLowerCase();
  if (active === 'false' || active === 'inactive') return 'inactive';
  if (active === 'all' || String(query.includeInactive ?? '') === 'true') return 'all';
  return 'active';
}

function applyCategoryFilters(
  rows: Record<string, unknown>[],
  visibility: CategoryVisibility,
  search: string,
): Record<string, unknown>[] {
  const visible =
    visibility === 'all'
      ? rows
      : rows.filter((row) =>
          visibility === 'active' ? row.is_active === true : row.is_active !== true,
        );
  const needle = search.trim().toLowerCase();
  if (!needle) return visible;
  return visible.filter((row) =>
    `${String(row.slug ?? '')} ${String(row.name ?? '')}`.toLowerCase().includes(needle),
  );
}

async function planCounts(db: Db): Promise<Map<string, number>> {
  const { data, error } = await db.from('card_plans').select('id,category_id');
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const key = String(row.category_id ?? '');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth =
        (await authorizeAfHomes(req, 'sales.card_sales')) ??
        (await authorizeAfHomes(req, 'sales.card_plans'));
      if ('error' in auth) return deny(res, auth);

      const { data, error } = await db
        .from('card_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      const query = (req.query ?? {}) as Record<string, unknown>;
      const rows = applyCategoryFilters(
        (data ?? []) as Record<string, unknown>[],
        categoryVisibility(req, auth.roleSlug),
        String(query.search ?? ''),
      );
      const counts = await planCounts(db);
      return list(
        res,
        rows.map((row) => toCategory(row, counts.get(String(row.id)) ?? 0)),
      );
    }

    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.card_plans', 'create');
      if ('error' in auth) return deny(res, auth);

      const parsed = createCardCategorySchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid card category', 400);
      const slug = normalizeCategorySlug(parsed.data.slug);

      const row = {
        slug,
        name: parsed.data.name,
        description: parsed.data.description?.trim() ? parsed.data.description.trim() : null,
        is_active: parsed.data.isActive ?? true,
        sort_order: parsed.data.sortOrder ?? 0,
      };
      const { data, error } = await db.from('card_categories').insert(row).select('*').single();
      if (error) {
        if ((error as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'A category with that slug or name already exists', 409);
        throw error;
      }

      await audit(
        db,
        auth.userId,
        'CARD_CATEGORY_CREATED',
        'card_category',
        String((data as { id: string }).id),
        null,
        { slug, name: parsed.data.name },
      );
      return res.status(201).json(toCategory(data as Record<string, unknown>));
    }

    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const auth =
        (await authorizeAfHomes(req, 'sales.card_sales')) ??
        (await authorizeAfHomes(req, 'sales.card_plans'));
      if ('error' in auth) return deny(res, auth);

      const { data, error } = await db
        .from('card_categories')
        .select('*')
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Card category not found', 404);
      const row = data as Record<string, unknown>;
      if (auth.roleSlug !== 'super_admin' && row.is_active !== true)
        return fail(res, 'NOT_FOUND', 'Card category not found', 404);
      const counts = await planCounts(db);
      return res.status(200).json(toCategory(row, counts.get(String(row.id)) ?? 0));
    }

    const update = route(req, 'PATCH', /^([0-9a-f-]+)$/);
    if (update) {
      const auth = await authorizeAfHomes(req, 'sales.card_plans', 'update');
      if ('error' in auth) return deny(res, auth);

      const id = update[1]!;
      const parsed = updateCardCategorySchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid card category', 400);

      const { data: before, error: readError } = await db
        .from('card_categories')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Card category not found', 404);

      // Snapshot pre-update state NOW: a row reference may be live (the
      // in-memory double mutates it in place on update).
      const wasActive = before.is_active === true;

      const patch: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.slug !== undefined) patch.slug = normalizeCategorySlug(parsed.data.slug);
      if (parsed.data.description !== undefined)
        patch.description = parsed.data.description?.trim() ? parsed.data.description.trim() : null;
      if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
      if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

      const { error: writeError } = await db.from('card_categories').update(patch).eq('id', id);
      if (writeError) {
        if ((writeError as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'A category with that slug or name already exists', 409);
        throw writeError;
      }

      const activating = parsed.data.isActive === true && !wasActive;
      const deactivating = parsed.data.isActive === false && wasActive;
      await audit(
        db,
        auth.userId,
        activating
          ? 'CARD_CATEGORY_ACTIVATED'
          : deactivating
            ? 'CARD_CATEGORY_DEACTIVATED'
            : 'CARD_CATEGORY_UPDATED',
        'card_category',
        id,
        before,
        { ...parsed.data },
      );
      const { data: after, error: afterError } = await db
        .from('card_categories')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (afterError) throw afterError;
      const counts = await planCounts(db);
      const row = after as Record<string, unknown>;
      return res.status(200).json(toCategory(row, counts.get(String(row.id)) ?? 0));
    }

    return fail(res, 'NOT_FOUND', 'Card category endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] card-categories:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
