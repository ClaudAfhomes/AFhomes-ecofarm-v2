import type { Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import { staffSaleInvolvementSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { deny, fail, list, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const fields = {
  vd_staff_id: 'VD',
  ssm_staff_id: 'SSM',
  sm_staff_id: 'SM',
  referrer_staff_id: 'Referrer',
  recommender_staff_id: 'VIP Recommender',
  referrer_vd_staff_id: 'Referrer VD',
  referrer_ssm_staff_id: 'Referrer SSM',
  referrer_sm_staff_id: 'Referrer SM',
  recommender_vd_staff_id: 'Recommender VD',
  recommender_ssm_staff_id: 'Recommender SSM',
  recommender_sm_staff_id: 'Recommender SM',
};
const pageSchema = z.object({
  id: z.uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
const jsonText = (value: unknown) =>
  value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
const maximum = (a: unknown, b: unknown): string | null =>
  [a, b]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .sort()
    .at(-1) ?? null;

/** Native staff_sales_involvement: recorded facts only, including committed import provenance. */
export function createMongoStaffSalesInvolvementHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  scope: 'admin' | 'self' = 'admin',
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  return async (req: VercelRequest, res: VercelResponse) => {
    const route =
      scope === 'self' && subPath(req) === ''
        ? ['', 'self']
        : scope === 'admin'
          ? /^staff\/([^/]+)\/sales-involvement$/.exec(subPath(req))
          : null;
    if (req.method !== 'GET' || !route)
      return fail(res, 'NOT_FOUND', 'Staff involvement route not found', 404);
    let ownId = '';
    for (const module of [
      scope === 'self' ? 'sales.card_sales' : 'organization.staff',
      'sales.customers',
    ] as const) {
      const actor = await authorize(req, module, 'view');
      if ('error' in actor) return deny(res, actor);
      if (scope === 'self') {
        if (
          !['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(
            actor.roleSlug,
          )
        )
          return fail(res, 'FORBIDDEN', 'Sales participation requires a sales account', 403);
        ownId = actor.userId;
      }
    }
    const parsed = pageSchema.safeParse({ ...req.query, id: scope === 'self' ? ownId : route[1] });
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid involvement query', 400);
    const { id, limit, offset } = parsed.data;
    const session = client.startSession();
    try {
      const result = await session.withTransaction(
        async () => {
          if (!(await col('staff_users').findOne({ _id: id }, { session, projection: { _id: 1 } })))
            return null;
          const snapshots = await col('card_sale_hierarchy_snapshots')
            .find({ ancestor_staff_id: id }, { session })
            .toArray();
          const ownSales = await col('card_sales')
            .find({ $or: [{ seller_staff_id: id }, { seller_ost_id: id }] }, { session })
            .toArray();
          const applications = await col('customer_applications')
            .find(
              {
                $or: ['svd_staff_id', 'ssm_staff_id', 'sm_staff_id', 'referrer_staff_id'].map(
                  (field) => ({ [field]: id }),
                ),
              },
              { session },
            )
            .toArray();
          const imported = await col('customer_import_rows')
            .find(
              {
                committed_at: { $ne: null },
                customer_id: { $ne: null },
                $or: Object.keys(fields).map((field) => ({ [`raw_data.${field}`]: id })),
              },
              {
                session,
                projection: {
                  customer_id: 1,
                  committed_at: 1,
                  sale_id: 1,
                  ...Object.fromEntries(
                    [...Object.keys(fields), 'purchase_reference', 'vip_tier'].map((field) => [
                      `raw_data.${field}`,
                      1,
                    ]),
                  ),
                },
              },
            )
            .toArray();
          const links = await col('customer_import_source_rows')
            .find({ row_id: { $in: imported.map((row) => row._id) } }, { session })
            .toArray();
          const sources = await col('customer_import_purchase_sources')
            .find({ _id: { $in: links.map((row) => String(row.source_id)) } }, { session })
            .toArray();
          const importApps = await col('customer_applications')
            .find(
              {
                _id: {
                  $in: sources
                    .filter((row) => row.application_id)
                    .map((row) => String(row.application_id)),
                },
              },
              { session },
            )
            .toArray();
          const appById = new Map([...applications, ...importApps].map((row) => [row._id, row]));
          const reservations = await col('reservation_agreements')
            .find({ customer_application_id: { $in: [...appById.keys()] } }, { session })
            .toArray();
          const saleIds = new Set(ownSales.map((row) => row._id));
          for (const row of [...snapshots, ...appById.values(), ...reservations, ...imported])
            if (row.sale_id) saleIds.add(String(row.sale_id));
          const sales = await col('card_sales')
            .find(
              {
                _id: { $in: [...saleIds].filter((value) => typeof value === 'string') as string[] },
              },
              { session },
            )
            .toArray();
          const saleById = new Map(sales.map((row) => [row._id, row]));
          const plans = await col('card_plans')
            .find(
              { _id: { $in: [...new Set(sales.map((row) => String(row.plan_id)))] } },
              { session },
            )
            .toArray();
          const planById = new Map(plans.map((row) => [row._id, row]));
          type Participation = {
            key: string;
            customer: string;
            sale: unknown;
            application: unknown;
            reference: unknown;
            tier: unknown;
            status: unknown;
            created: unknown;
            role: string;
          };
          const contributions: Participation[] = [];
          const saleContribution = (sale: MongoRow | undefined, role: string) => {
            const plan = sale && planById.get(String(sale.plan_id));
            if (sale && plan)
              contributions.push({
                key: `sale:${sale._id}`,
                customer: String(sale.customer_id),
                sale: sale._id,
                application: null,
                reference: sale.sale_number,
                tier: plan.code,
                status: sale.status,
                created: sale.created_at,
                role,
              });
          };
          for (const row of ownSales) saleContribution(saleById.get(row._id), 'Seller');
          for (const row of snapshots)
            saleContribution(saleById.get(String(row.sale_id)), String(row.ancestor_role));
          const reservationsFor = (application: MongoRow | undefined): (MongoRow | undefined)[] => {
            const rows = application
              ? reservations.filter((row) => row.customer_application_id === application._id)
              : [];
            return rows.length ? rows : [undefined];
          };
          for (const application of applications)
            for (const reservation of reservationsFor(application)) {
              const saleId = application.sale_id ?? reservation?.sale_id ?? null;
              const sale = saleById.get(String(saleId));
              for (const [field, label] of [
                ['svd_staff_id', 'VD'],
                ['ssm_staff_id', 'SSM'],
                ['sm_staff_id', 'SM'],
                ['referrer_staff_id', 'Referrer'],
              ])
                if (application[field!] === id)
                  contributions.push({
                    key: saleId ? `sale:${saleId}` : `application:${application._id}`,
                    customer: String(application.customer_id),
                    sale: saleId,
                    application: application._id,
                    reference: sale?.sale_number ?? application.application_number,
                    tier: application.tier_snapshot,
                    status: sale?.status ?? application.status,
                    created: application.created_at,
                    role: label!,
                  });
            }
          for (const row of imported) {
            const rowLinks = links.filter((link) => link.row_id === row._id);
            for (const link of rowLinks.length ? rowLinks : [undefined]) {
              const source = sources.find((item) => item._id === link?.source_id);
              if (source && (source.superseded_by != null || source.original_row_id !== row._id))
                continue;
              const application = source ? appById.get(String(source.application_id)) : undefined;
              const raw = row.raw_data as Record<string, unknown>;
              for (const reservation of reservationsFor(application)) {
                const saleId = application?.sale_id ?? reservation?.sale_id ?? row.sale_id ?? null;
                const sale = saleById.get(String(saleId));
                for (const [field, label] of Object.entries(fields))
                  if (raw[field] === id)
                    contributions.push({
                      key: saleId
                        ? `sale:${saleId}`
                        : application
                          ? `application:${application._id}`
                          : `import:${source?._id ?? row._id}`,
                      customer: String(row.customer_id),
                      sale: saleId,
                      application: application?._id ?? null,
                      reference:
                        sale?.sale_number ??
                        application?.application_number ??
                        source?.purchase_reference ??
                        jsonText(raw.purchase_reference) ??
                        'Imported purchase',
                      tier: application?.tier_snapshot ?? jsonText(raw.vip_tier),
                      status: sale?.status ?? application?.status ?? 'imported_pending_review',
                      created: source?.created_at ?? row.committed_at,
                      role: label,
                    });
              }
            }
          }
          const customers = await col('customers')
            .find(
              { _id: { $in: [...new Set(contributions.map((row) => row.customer))] } },
              {
                session,
                projection: {
                  first_name: 1,
                  middle_name: 1,
                  last_name: 1,
                  suffix: 1,
                  ra_number: 1,
                  customer_number: 1,
                },
              },
            )
            .toArray();
          const customerById = new Map(customers.map((row) => [row._id, row]));
          const grouped = new Map<
            string,
            { value: Participation; roles: Set<string>; created: string }
          >();
          for (const row of contributions) {
            const key = `${row.key}:${row.customer}`,
              created = new Date(String(row.created)).toISOString(),
              previous = grouped.get(key);
            if (!previous)
              grouped.set(key, { value: { ...row }, roles: new Set([row.role]), created });
            else {
              previous.roles.add(row.role);
              if (created < previous.created) previous.created = created;
              for (const field of ['sale', 'application', 'reference', 'tier', 'status'] as const)
                previous.value[field] = maximum(previous.value[field], row[field]);
            }
          }
          return [...grouped.values()]
            .filter((row) => customerById.has(row.value.customer))
            .sort(
              (a, b) =>
                b.created.localeCompare(a.created) || a.value.key.localeCompare(b.value.key),
            )
            .slice(offset, offset + limit)
            .map(({ value, roles, created }) => {
              const customer = customerById.get(value.customer)!;
              return staffSaleInvolvementSchema.parse({
                id: value.key,
                customerId: value.customer,
                customerName: [
                  customer.first_name,
                  customer.middle_name,
                  customer.last_name,
                  customer.suffix,
                ]
                  .filter(Boolean)
                  .join(' '),
                customerNumber: customer.ra_number || customer.customer_number,
                saleId: value.sale ?? null,
                applicationId: value.application ?? null,
                reference: value.reference,
                tier: value.tier ?? 'Not recorded',
                status: value.status,
                createdAt: created,
                roles: [...roles].sort(),
              });
            });
        },
        { readConcern: { level: 'snapshot' } },
      );
      if (result === null) return fail(res, 'NOT_FOUND', 'Staff member not found', 404);
      return list(res, result);
    } catch {
      return fail(res, 'INTERNAL', 'Could not load recorded sales involvement', 500);
    } finally {
      await session.endSession();
    }
  };
}
