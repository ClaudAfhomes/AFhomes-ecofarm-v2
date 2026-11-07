import type { Db, Filter } from 'mongodb';
import { importedSalesListSchema, importedSalesQuerySchema, isIstRole } from '@afhomes/contracts';
import type { AfHomesPrincipal } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';

const participants = ['referrer_staff_id', 'recommender_staff_id'];
const participation = {
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
const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;
export const canReadMongoSales = (p: AfHomesPrincipal) =>
  p.permissions.some(
    (permission) => permission.moduleKey === 'sales.card_sales' && permission.canView,
  );
/** Distinguish hidden/retired imports from sales whose historical provenance is actually missing. */
export async function hasUnmappedMongoImportedSales(db: Db, filter: Filter<MongoRow>) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const sales = await col('card_sales')
    .find(filter, { projection: { _id: 1 } })
    .toArray();
  for (const sale of sales) {
    const apps = await col('customer_applications')
      .find({ sale_id: sale._id }, { projection: { _id: 1 } })
      .toArray();
    const rows = await col('customer_import_rows')
      .find({ sale_id: sale._id, committed_at: { $ne: null } }, { projection: { _id: 1 } })
      .toArray();
    const sources = await col('customer_import_purchase_sources')
      .find(
        {
          $or: [
            { application_id: { $in: apps.map((app) => app._id) } },
            { original_row_id: { $in: rows.map((row) => row._id) } },
          ],
        },
        { projection: { original_row_id: 1 } },
      )
      .toArray();
    if (
      !sources.length ||
      !(await col('customer_import_rows').findOne(
        {
          _id: { $in: sources.map((source) => String(source.original_row_id)) },
          committed_at: { $ne: null },
        },
        { projection: { _id: 1 } },
      ))
    )
      return true;
  }
  return false;
}
function allowed(p: AfHomesPrincipal, team: boolean, module = 'sales.card_sales') {
  if (
    (!isIstRole(p.roleSlug) && p.roleSlug !== 'ost') ||
    (team && !isIstRole(p.roleSlug)) ||
    !p.permissions.some((permission) => permission.moduleKey === module && permission.canView)
  )
    throw new CustomerActivationError(403, 'Imported sales are outside your scope');
}
function period(from?: string, to?: string): Filter<MongoRow> {
  if (!importedSalesQuerySchema.safeParse({ from, to }).success)
    throw new CustomerActivationError(400, 'Invalid imported sales period');
  return from || to
    ? {
        created_at: {
          ...(from ? { $gte: `${from}T00:00:00.000Z` } : {}),
          ...(to ? { $lte: `${to}T23:59:59.999Z` } : {}),
        },
      }
    : {};
}

/** Port of imported_purchase_scope: recorded participation AND current authoritative visibility. */
export async function mongoImportedPurchaseScope(db: Db, actor: string, team: boolean) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const downline = new Set([actor]);
  let frontier = [actor];
  while (team && frontier.length) {
    const edges = await col('referral_relationships')
      .find(
        {
          upline_staff_id: { $in: frontier },
          is_active: true,
          is_authoritative: true,
        },
        { projection: { subject_staff_id: 1 } },
      )
      .toArray();
    frontier = [];
    for (const edge of edges) {
      const id = String(edge.subject_staff_id);
      if (downline.has(id)) continue;
      if (downline.size >= 10000)
        throw new CustomerActivationError(409, 'Team visibility requires review');
      downline.add(id);
      frontier.push(id);
    }
  }
  downline.delete(actor);
  if (team && !downline.size) return [];
  const match = {
    $or: participants.map((key) => ({
      [`raw_data.${key}`]: team ? { $in: [...downline] } : actor,
    })),
  };
  const leader = {
    $or: Object.keys(participation)
      .filter((key) => !participants.includes(key))
      .map((key) => ({ [`raw_data.${key}`]: actor })),
  };
  const rows = await col('customer_import_rows')
    .find(
      {
        committed_at: { $ne: null },
        $and: team ? [match, leader] : [match],
      },
      { projection: { raw_data: 1, normalized_data: 1, sale_id: 1 } },
    )
    .toArray();
  if (!rows.length) return [];
  const sources = await col('customer_import_purchase_sources')
    .find({
      original_row_id: { $in: rows.map((row) => row._id) },
      superseded_by: null,
    })
    .sort({ created_at: 1, _id: 1 })
    .toArray();
  return sources.map((source) => ({
    source,
    row: rows.find((row) => row._id === source.original_row_id)!,
  }));
}

export async function mongoImportedAccountSales(
  db: Db,
  p: AfHomesPrincipal,
  team = false,
  from?: string,
  to?: string,
) {
  allowed(p, team);
  const filter = period(from, to),
    scope = await mongoImportedPurchaseScope(db, p.userId, team);
  if (!scope.length) return [];
  const col = (name: string) => db.collection<MongoRow>(name);
  const applications = await col('customer_applications')
    .find(
      { _id: { $in: scope.map(({ source }) => String(source.application_id)) } },
      { projection: { sale_id: 1 } },
    )
    .toArray();
  const linked = scope.map(({ source, row }) => ({
    source,
    row,
    saleId: applications.find((a) => a._id === source.application_id)?.sale_id ?? row.sale_id,
  }));
  const ids = linked
    .filter(({ source }) => applications.some((a) => a._id === source.application_id))
    .map(({ saleId }) => String(saleId));
  const sales = await col('card_sales')
    .find({ ...filter, _id: { $in: ids } })
    .toArray();
  const memberships = await col('memberships')
    .find(
      { sale_id: { $in: sales.map((sale) => sale._id) } },
      { projection: { sale_id: 1, status: 1 } },
    )
    .toArray();
  const result = new Map<string, Record<string, unknown>>();
  for (const { source, row, saleId } of linked) {
    const sale = sales.find((sale) => sale._id === saleId);
    if (!sale || result.has(sale._id)) continue;
    const raw = record(row.raw_data),
      members = memberships.filter((m) => m.sale_id === sale._id);
    if (members.length > 1)
      throw new CustomerActivationError(409, 'Imported membership history requires review');
    result.set(sale._id, {
      ...sale,
      id: sale._id,
      sale_number: source.purchase_reference ?? sale.sale_number,
      status: members[0]?.status ?? sale.status,
      attributed_staff_ids: participants.map((key) => raw[key]).filter((id) => id != null),
    });
  }
  return [...result.values()];
}

export async function mongoImportedCommissionSaleIds(db: Db, p: AfHomesPrincipal) {
  allowed(p, true, 'network.commissions');
  const scope = await mongoImportedPurchaseScope(db, p.userId, true),
    col = (name: string) => db.collection<MongoRow>(name);
  const policies = await col('customer_import_commission_policies')
    .find({
      source_id: { $in: scope.map(({ source }) => source._id) },
      settled_before_system: false,
    })
    .toArray();
  const appIds = scope
    .filter(({ source }) => policies.some((policy) => policy.source_id === source._id))
    .map(({ source }) => String(source.application_id));
  const apps = await col('customer_applications')
    .find({ _id: { $in: appIds }, sale_id: { $ne: null } }, { projection: { sale_id: 1 } })
    .toArray();
  return [...new Set(apps.map((app) => String(app.sale_id)))];
}

export async function mongoImportedSalesList(
  db: Db,
  p: AfHomesPrincipal,
  input: { view: 'my-sales' | 'team-sales'; page: number; from?: string; to?: string },
) {
  const team = input.view === 'team-sales';
  allowed(p, team);
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > 10000)
    throw new CustomerActivationError(400, 'Invalid imported sales page');
  const window = period(input.from, input.to),
    col = (name: string) => db.collection<MongoRow>(name);
  const scope = await mongoImportedPurchaseScope(db, p.userId, team);
  const sources = await col('customer_import_purchase_sources')
    .find({ ...window, _id: { $in: scope.map(({ source }) => source._id) } })
    .sort({ created_at: -1, _id: 1 })
    .toArray();
  const customers = await col('customers')
    .find(
      { _id: { $in: sources.map((s) => String(s.customer_id)) } },
      {
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
  const valid = sources.filter((s) => customers.some((c) => c._id === s.customer_id)),
    data = [];
  const names = p.permissions.some(
    (permission) => permission.moduleKey === 'sales.customers' && permission.canView,
  );
  for (const source of valid.slice((input.page - 1) * 25, input.page * 25)) {
    const row = scope.find((item) => item.source._id === source._id)!.row,
      raw = record(row.raw_data);
    const customer = customers.find((c) => c._id === source.customer_id)!;
    const app = await col('customer_applications').findOne({ _id: String(source.application_id) });
    const reservation = app
      ? await col('reservation_agreements')
          .find({ customer_application_id: app._id })
          .sort({ created_at: -1, _id: 1 })
          .limit(1)
          .next()
      : null;
    const saleId = app?.sale_id ?? reservation?.sale_id ?? row.sale_id;
    const sale = saleId ? await col('card_sales').findOne({ _id: String(saleId) }) : null;
    const membership = sale ? await col('memberships').findOne({ sale_id: sale._id }) : null;
    const policy = await col('customer_import_commission_policies').findOne({
      source_id: source._id,
    });
    const settled =
      policy?.settled_before_system ??
      ['activation', 'active', 'inactive'].includes(
        String(record(record(row.normalized_data).externalSummary).stage),
      );
    data.push({
      id: source._id,
      reference: source.purchase_reference,
      customerName: names
        ? [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
            .filter(Boolean)
            .join(' ')
        : null,
      customerNumber: customer.ra_number ?? customer.customer_number,
      tier: app?.tier_snapshot ?? raw.vip_tier ?? 'Not selected',
      status: membership?.status ?? sale?.status ?? reservation?.status ?? app?.status ?? 'draft',
      amount:
        sale?.cash_price_snapshot ?? reservation?.total_price_snapshot ?? raw.stated_total ?? null,
      roles: Object.entries(participation)
        .filter(([key]) => raw[key] === p.userId)
        .map(([, label]) => label)
        .sort(),
      commissionPolicy: settled ? 'settled_before_system' : 'normal_qualification',
    });
  }
  return importedSalesListSchema.parse({
    data,
    meta: { page: input.page, pageSize: 25, total: valid.length },
  });
}
