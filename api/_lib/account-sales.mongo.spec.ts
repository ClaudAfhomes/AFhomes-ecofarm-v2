import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  mongoImportedAccountSales,
  mongoImportedCommissionSaleIds,
  mongoImportedSalesList,
} from './account-sales.mongo.js';
import { createMongoIstPortalHandler } from './ist-portal.mongo.js';
import { createMongoOstHandler } from './ost.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { AfHomesPrincipal, authorizeAfHomes } from './afhomes-access.js';
import type { MongoRow } from './customer-activation.mongo.js';
import type { VercelRequest } from './http.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
const manager = randomUUID(),
  seller = randomUUID(),
  outsider = randomUUID(),
  moved = randomUUID();
const principal = (userId = manager, roleSlug = 'sales_manager'): AfHomesPrincipal => ({
  userId,
  roleSlug,
  fullName: 'Synthetic',
  email: 'synthetic@example.invalid',
  status: 'active',
  roleId: randomUUID(),
  roleName: roleSlug,
  mustChangePassword: false,
  permissions: (['sales.card_sales', 'sales.customers', 'network.commissions'] as const).map(
    (moduleKey) => ({
      moduleKey,
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    }),
  ),
});
const col = (name: string) => test.db.collection<MongoRow>(name);
const ids: Record<string, string> = {};
async function purchase(
  key: string,
  raw: Record<string, unknown>,
  options: {
    committed?: boolean;
    superseded?: boolean;
    status?: string;
    settled?: boolean;
    sale?: string;
  } = {},
) {
  const source = randomUUID(),
    row = randomUUID(),
    application = randomUUID(),
    sale = options.sale ?? randomUUID(),
    customer = randomUUID();
  ids[key] = source;
  ids[`${key}Sale`] = sale;
  await col('customer_import_rows').insertOne({
    _id: row,
    raw_data: { ...raw, vip_tier: 'GOLD' },
    normalized_data: { externalSummary: { stage: 'active' } },
    committed_at: options.committed === false ? null : '2026-10-01T00:00:00.000Z',
  });
  await col('customer_import_purchase_sources').insertOne({
    _id: source,
    original_row_id: row,
    application_id: application,
    customer_id: customer,
    purchase_reference: key,
    created_at: '2026-10-01T00:00:00.000Z',
    superseded_by: options.superseded ? randomUUID() : null,
  });
  await col('customer_applications').insertOne({
    _id: application,
    sale_id: sale,
    tier_snapshot: 'GOLD',
  });
  await col('customers').insertOne({
    _id: customer,
    first_name: 'Private',
    last_name: key,
    customer_number: key,
  });
  if (!options.sale && options.committed !== false) {
    await col('card_sales').insertOne({
      _id: sale,
      origin: 'legacy_import',
      customer_id: customer,
      sale_number: key,
      seller_staff_id: seller,
      cash_price_snapshot: '9007199254740993.01',
      status: 'active',
      created_at: '2026-10-02T00:00:00.000Z',
    });
    await col('memberships').insertOne({
      _id: randomUUID(),
      sale_id: sale,
      status: options.status ?? 'active',
    });
  }
  if (options.settled !== undefined)
    await col('customer_import_commission_policies').insertOne({
      _id: randomUUID(),
      source_id: source,
      settled_before_system: options.settled,
    });
}
beforeAll(async () => {
  test = await createTestReplica();
  await col('referral_relationships').insertMany([
    {
      _id: randomUUID(),
      upline_staff_id: manager,
      subject_staff_id: seller,
      is_active: true,
      is_authoritative: true,
    },
    {
      _id: randomUUID(),
      upline_staff_id: seller,
      subject_staff_id: manager,
      is_active: true,
      is_authoritative: true,
    },
    {
      _id: randomUUID(),
      upline_staff_id: manager,
      subject_staff_id: moved,
      is_active: false,
      is_authoritative: true,
    },
    {
      _id: randomUUID(),
      upline_staff_id: manager,
      subject_staff_id: outsider,
      is_active: true,
      is_authoritative: false,
    },
  ]);
  await purchase(
    'visible',
    { referrer_staff_id: seller, recommender_staff_id: seller, sm_staff_id: manager },
    { settled: false },
  );
  await purchase(
    'same-sale',
    { referrer_staff_id: seller, sm_staff_id: manager },
    { sale: ids.visibleSale },
  );
  await purchase(
    'expired',
    { recommender_staff_id: seller, recommender_sm_staff_id: manager },
    { status: 'expired', settled: true },
  );
  await purchase('no-history', { referrer_staff_id: seller, sm_staff_id: outsider });
  await purchase('moved', { referrer_staff_id: moved, sm_staff_id: manager });
  await purchase('unauthoritative', { referrer_staff_id: outsider, sm_staff_id: manager });
  await purchase(
    'uncommitted',
    { referrer_staff_id: seller, sm_staff_id: manager },
    { committed: false },
  );
  await purchase(
    'superseded',
    { referrer_staff_id: seller, sm_staff_id: manager },
    { superseded: true },
  );
}, 30000);
afterAll(async () => test?.stop());
it('requires recorded historical participation and current authoritative visibility, with cycle protection', async () => {
  const sales = await mongoImportedAccountSales(test.db, principal(), true);
  expect(sales.map((s) => s.id).sort()).toEqual([ids.visibleSale, ids.expiredSale].sort());
  expect(sales.find((s) => s.id === ids.expiredSale)?.status).toBe('expired');
  expect(
    new Set(sales.find((s) => s.id === ids.visibleSale)?.attributed_staff_ids as string[]),
  ).toEqual(new Set([seller]));
  expect(sales[0].cash_price_snapshot).toBe('9007199254740993.01');
  expect(await mongoImportedAccountSales(test.db, principal(), false)).toEqual([]);
});
it('includes referrer/recommender own sales once, and uses sale dates for KPI windows', async () => {
  const sales = await mongoImportedAccountSales(test.db, principal(seller, 'ost'));
  expect(sales.map((s) => s.id)).toContain(ids.expiredSale);
  expect(sales.filter((s) => s.id === ids.visibleSale)).toHaveLength(1);
  expect(
    await mongoImportedAccountSales(
      test.db,
      principal(seller, 'ost'),
      false,
      '2026-10-01',
      '2026-10-01',
    ),
  ).toEqual([]);
});
it('keeps imported list source dates, name permissions and settled commission history', async () => {
  const p = principal(),
    list = await mongoImportedSalesList(test.db, p, {
      view: 'team-sales',
      page: 1,
      from: '2026-10-01',
      to: '2026-10-01',
    });
  expect(list.meta.total).toBe(3);
  expect(list.data.find((s) => s.id === ids.expired)).toMatchObject({
    status: 'expired',
    commissionPolicy: 'settled_before_system',
    roles: ['Recommender SM'],
  });
  p.permissions = p.permissions.filter((permission) => permission.moduleKey !== 'sales.customers');
  expect(
    (await mongoImportedSalesList(test.db, p, { view: 'team-sales', page: 1 })).data.every(
      (s) => s.customerName === null,
    ),
  ).toBe(true);
  expect(await mongoImportedCommissionSaleIds(test.db, principal())).toEqual([ids.visibleSale]);
});
it('rejects other roles, denied grants, OST team views and invalid ranges', async () => {
  await expect(
    mongoImportedAccountSales(test.db, principal(seller, 'ost'), true),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    mongoImportedAccountSales(test.db, principal(manager, 'admin')),
  ).rejects.toMatchObject({ status: 403 });
  const p = principal();
  p.permissions = [];
  await expect(
    mongoImportedSalesList(test.db, p, { view: 'my-sales', page: 1 }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    mongoImportedAccountSales(test.db, principal(), true, '2026-10-02', '2026-10-01'),
  ).rejects.toMatchObject({ status: 400 });
});
it('serves the native imported-sales API and denies OST team requests', async () => {
  let p = principal();
  const authorize: typeof authorizeAfHomes = async () => p;
  const handler = createMongoIstPortalHandler(test.db, authorize);
  const call = async (view: string) => {
    const response = makeRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { familyPath: 'imported-sales', view },
      } as VercelRequest,
      response.res,
    );
    return response.state;
  };
  expect((await call('team-sales')).status).toBe(200);
  p = principal(seller, 'ost');
  expect((await call('team-sales')).status).toBe(403);
  expect((await call('my-sales')).status).toBe(200);
});
it('includes imported purchases in the existing OST sales portal with membership status', async () => {
  await col('ost_members').insertOne({ _id: seller, status: 'active', sponsor_staff_id: manager });
  const handler = createMongoOstHandler(test.db, async () => principal(seller, 'ost'));
  const response = makeRes();
  await handler(
    { method: 'GET', headers: {}, query: { familyPath: 'me/sales' } } as VercelRequest,
    response.res,
  );
  expect(response.state.status).toBe(200);
  const body = response.state.body as { data: { id: string; status: string }[] };
  expect(body.data.find((sale) => sale.id === ids.expiredSale)?.status).toBe('expired');
  expect(body.data.filter((sale) => sale.id === ids.visibleSale)).toHaveLength(1);
});
it('paginates source purchases deterministically without counting duplicate sales twice in KPIs', async () => {
  const actor = randomUUID();
  for (let i = 0; i < 26; i++) await purchase(`page-${i}`, { referrer_staff_id: actor });
  const p = principal(actor, 'ost');
  const first = await mongoImportedSalesList(test.db, p, { view: 'my-sales', page: 1 });
  const second = await mongoImportedSalesList(test.db, p, { view: 'my-sales', page: 2 });
  expect(first.meta.total).toBe(26);
  expect(first.data).toHaveLength(25);
  expect(second.data).toHaveLength(1);
  expect(new Set([...first.data, ...second.data].map((sale) => sale.id)).size).toBe(26);
});
