/**
 * AF Homes card products (the `card_plans` catalogue).
 *
 * Read: anyone who may sell needs the active catalogue.
 * Write: `sales.card_plans` update. Editing a product never alters a historical
 * sale, because every sale stores its own commercial snapshot.
 */
import { updateCardProductSchema, assertProductEconomicsSane } from '@jad/contracts';

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

const toProduct = (row: Record<string, unknown>) => ({
  id: row.id,
  categoryId: row.category_id,
  code: row.code,
  name: row.name,
  cashPrice: row.cash_price,
  minimumDownPayment: row.minimum_down_payment,
  yearlyPoints: row.yearly_points,
  commissionRate: row.commission_rate,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === '' && method(req) === 'GET') {
      // A seller needs the catalogue to sell; catalogue management is a subset.
      const auth =
        (await authorizeAfHomes(req, 'sales.card_sales')) ?? (await authorizeAfHomes(req, 'sales.card_plans'));
      if ('error' in auth) return deny(res, auth);

      const { data, error } = await db
        .from('card_plans')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      const onlyActive = String(req.query.includeInactive ?? '') !== 'true' || auth.roleSlug !== 'super_admin';
      const rows = (data ?? []).filter((row: Record<string, unknown>) =>
        onlyActive ? row.is_active === true : true,
      );
      return list(res, rows.map(toProduct));
    }

    const update = route(req, 'PATCH', /^card-products\/([0-9a-f-]+)$/);
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
      const incoherent = assertProductEconomicsSane({ cashPrice: nextPrice, minimumDownPayment: nextDown });
      if (incoherent) return fail(res, 'VALIDATION_ERROR', incoherent, 400);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.cashPrice !== undefined) patch.cash_price = parsed.data.cashPrice;
      if (parsed.data.minimumDownPayment !== undefined)
        patch.minimum_down_payment = parsed.data.minimumDownPayment;
      if (parsed.data.yearlyPoints !== undefined) patch.yearly_points = parsed.data.yearlyPoints;
      if (parsed.data.commissionRate !== undefined) patch.commission_rate = parsed.data.commissionRate;
      if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
      if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

      const { error: writeError } = await db.from('card_plans').update(patch).eq('id', id);
      if (writeError) {
        if ((writeError as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'A product with that code or name already exists', 409);
        throw writeError;
      }

      await audit(db, auth.userId, 'CARD_PRODUCT_CHANGED', 'card_plan', id, before, {
        ...parsed.data,
        previousPrice: before.cash_price,
      });
      const { data: after, error: afterError } = await db
        .from('card_plans')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (afterError) throw afterError;
      return res.status(200).json(toProduct(after as Record<string, unknown>));
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
