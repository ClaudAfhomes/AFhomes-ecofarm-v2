import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import {
  assertCardPlanEconomicsSane,
  assertCommissionRateInRange,
  assertProductEconomicsSane,
  createCardProductSchema,
  updateCardProductSchema,
  normalizePlanCode,
  createCardCategorySchema,
  updateCardCategorySchema,
  normalizeCategorySlug,
} from '@afhomes/contracts';
import { compareMoney } from '@afhomes/shared';
import type { authorizeAfHomes } from './afhomes-access.js';
import {
  toProduct,
  toCategory,
  applyPlanFilters,
  planVisibility,
  applyCategoryFilters,
  categoryVisibility,
  PLAN_BENEFIT_DEFAULTS,
} from './catalog-model.js';
import { deny, fail, jsonBody, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';

const planFields = {
  name: 'name',
  code: 'code',
  description: 'description',
  categoryId: 'category_id',
  cashPrice: 'cash_price',
  installmentPrice: 'installment_price',
  reservationFee: 'reservation_fee',
  spotCashDays: 'spot_cash_days',
  standardInstallmentMonths: 'standard_installment_months',
  validityYears: 'validity_years',
  moveAEnabled: 'move_a_enabled',
  moveB1Enabled: 'move_b1_enabled',
  moveB2Enabled: 'move_b2_enabled',
  minimumDownPayment: 'minimum_down_payment',
  yearlyPoints: 'yearly_points',
  commissionRate: 'commission_rate',
  isActive: 'is_active',
  sortOrder: 'sort_order',
};
class CatalogError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const check = (message: string | null) => {
  if (message) throw new CatalogError(400, message);
};
export async function setupMongoCatalog(db: Db) {
  await db.collection('card_categories').createIndex({ slug: 1 }, { unique: true });
  await db.collection('card_categories').createIndex({ name: 1 }, { unique: true });
  await db.collection('card_plans').createIndex({ code: 1 }, { unique: true });
  await db.collection('card_plans').createIndex({ category_id: 1, is_active: 1, sort_order: 1 });
}

/** Explicit unmounted factory; authorization is supplied by the server, never the browser. */
export function createMongoCatalogHandlers(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  if (db.client !== client) throw new Error('Catalog requires its matching MongoDB client');
  const collection = (name: string) => db.collection<MongoRow>(name);
  const directory = async () =>
    new Map(
      (await collection('card_categories').find().toArray()).map((row) => [
        row._id,
        { name: String(row.name), isActive: row.is_active === true },
      ]),
    );
  const handler = (category: boolean) => async (req: VercelRequest, res: VercelResponse) => {
    try {
      const path = subPath(req),
        verb = method(req),
        read = verb === 'GET';
      if (!(
        (path === '' && ['GET', 'POST'].includes(verb)) ||
        (/^[0-9a-f-]{36}$/.test(path) && ['GET', 'PATCH'].includes(verb))
      ))
        return fail(res, 'NOT_FOUND', 'Catalog endpoint not found', 404);
      let auth = await authorize(
        req,
        read ? 'sales.card_sales' : 'sales.card_plans',
        read ? 'view' : verb === 'POST' ? 'create' : 'update',
      );
      if (read && 'error' in auth) auth = await authorize(req, 'sales.card_plans', 'view');
      if ('error' in auth) return deny(res, auth);
      const actorId = auth.userId,
        role = auth.roleSlug;
      const name = category ? 'card_categories' : 'card_plans';
      const categories = await directory();
      const counts = new Map<string, number>();
      if (category)
        for (const plan of await collection('card_plans')
          .find({}, { projection: { category_id: 1 } })
          .toArray()) {
          const key = String(plan.category_id);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      const display = (row: MongoRow) =>
        category
          ? toCategory({ ...row, id: row._id }, counts.get(row._id) ?? 0)
          : toProduct({ ...row, id: row._id }, categories);
      if (read) {
        const raw = await collection(name)
          .find(path ? { _id: path } : {})
          .sort({ sort_order: 1, name: 1 })
          .toArray();
        const search = path ? '' : String(req.query?.search ?? '');
        const visible = category
          ? applyCategoryFilters(raw, categoryVisibility(req, role), search)
          : applyPlanFilters(raw, categories, planVisibility(req, role), search, role);
        if (path) {
          const row = role === 'super_admin' ? raw[0] : visible[0];
          if (!row) return fail(res, 'NOT_FOUND', 'Catalog record not found', 404);
          return res.status(200).json(display(row as MongoRow));
        }
        return list(
          res,
          visible.map((row) => display(row as MongoRow)),
        );
      }
      const schema = category
        ? verb === 'POST'
          ? createCardCategorySchema
          : updateCardCategorySchema
        : verb === 'POST'
          ? createCardProductSchema
          : updateCardProductSchema;
      const parsed = schema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid catalog details', 400);
      const input = parsed.data as Record<string, unknown>,
        id = path || randomUUID();
      const session = client.startSession();
      let saved: MongoRow;
      try {
        saved = await session.withTransaction(async () => {
          const before = path ? await collection(name).findOne({ _id: id }, { session }) : null;
          if (path && !before) throw new CatalogError(404, 'Catalog record not found');
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          const mapping = category
            ? {
                slug: 'slug',
                name: 'name',
                description: 'description',
                isActive: 'is_active',
                sortOrder: 'sort_order',
              }
            : planFields;
          for (const [key, field] of Object.entries(mapping))
            if (input[key] !== undefined) patch[field] = input[key];
          if (input.description !== undefined)
            patch.description =
              typeof input.description === 'string' && input.description.trim()
                ? input.description.trim()
                : null;
          if (category && input.slug !== undefined)
            patch.slug = normalizeCategorySlug(String(input.slug));
          if (!category) {
            if (input.code !== undefined) {
              patch.code = normalizePlanCode(String(input.code));
              if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(String(patch.code)))
                throw new CatalogError(400, 'Plan code may only contain letters, digits, _ and -');
            }
            if (!before)
              Object.assign(patch, {
                installment_price: input.installmentPrice ?? '0.00',
                reservation_fee: input.reservationFee ?? '10000.00',
                spot_cash_days: input.spotCashDays ?? 7,
                standard_installment_months: input.standardInstallmentMonths ?? 4,
                validity_years: input.validityYears ?? 1,
                move_a_enabled: input.moveAEnabled ?? true,
                move_b1_enabled: input.moveB1Enabled ?? true,
                move_b2_enabled: input.moveB2Enabled ?? true,
                minimum_down_payment:
                  input.minimumDownPayment ?? input.reservationFee ?? '10000.00',
              });
            if (!before || input.categoryId !== undefined) {
              const target = input.categoryId
                ? await collection('card_categories').findOne(
                    { _id: String(input.categoryId) },
                    { session },
                  )
                : await collection('card_categories').findOne({ slug: 'membership' }, { session });
              if (!target) throw new CatalogError(400, 'Unknown card category');
              if (!target.is_active) throw new CatalogError(400, 'Card category is not active');
              await collection('card_categories').updateOne(
                { _id: target._id, is_active: true },
                { $set: { catalog_version: randomUUID() } },
                { session },
              );
              patch.category_id = target._id;
            }
            const next = { ...before, ...patch };
            check(
              assertProductEconomicsSane({
                cashPrice: String(next.cash_price),
                minimumDownPayment: String(next.minimum_down_payment),
              }),
            );
            check(assertCommissionRateInRange(String(next.commission_rate)));
            if (input.cashPrice !== undefined && compareMoney(String(input.cashPrice), '0.00') <= 0)
              throw new CatalogError(400, 'Cash price must be greater than zero');
            check(
              assertCardPlanEconomicsSane({
                cashPrice: String(next.cash_price),
                minimumDownPayment: String(next.minimum_down_payment),
                yearlyPoints: Number(next.yearly_points),
                commissionRate: String(next.commission_rate),
                installmentPrice: input.installmentPrice as string | undefined,
                reservationFee: input.reservationFee as string | undefined,
                spotCashDays: input.spotCashDays as number | undefined,
                standardInstallmentMonths: input.standardInstallmentMonths as number | undefined,
                validityYears: input.validityYears as number | undefined,
              }),
            );
          }
          if (before) await collection(name).updateOne({ _id: id }, { $set: patch }, { session });
          else
            await collection(name).insertOne(
              {
                _id: id,
                description: null,
                is_active: true,
                sort_order: 0,
                created_at: new Date().toISOString(),
                ...(!category ? PLAN_BENEFIT_DEFAULTS : {}),
                ...patch,
              },
              { session },
            );
          const action = !before
            ? 'CREATED'
            : input.isActive === true && !before.is_active
              ? 'ACTIVATED'
              : input.isActive === false && before.is_active
                ? 'DEACTIVATED'
                : 'UPDATED';
          await collection('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: actorId,
              action: `${category ? 'CARD_CATEGORY' : 'CARD_PLAN'}_${action}`,
              entity_type: category ? 'card_category' : 'card_plan',
              entity_id: id,
              before_data: before,
              after_data: input,
              created_at: new Date(),
            },
            { session },
          );
          return (await collection(name).findOne({ _id: id }, { session }))!;
        });
      } finally {
        await session.endSession();
      }
      return res.status(verb === 'POST' ? 201 : 200).json(display(saved));
    } catch (error) {
      if (error instanceof CatalogError)
        return fail(
          res,
          error.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(res, 'CONFLICT', 'A catalog record with these identifiers already exists', 409);
      return fail(res, 'INTERNAL', 'Card catalog is unavailable', 503);
    }
  };
  return { plans: handler(false), categories: handler(true) };
}
