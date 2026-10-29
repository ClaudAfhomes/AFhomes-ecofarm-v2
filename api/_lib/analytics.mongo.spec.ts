import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { analyticsOverviewSchema, salesTrendReportSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoAnalyticsHandler } from './analytics.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { authorizeAfHomes, AfHomesPrincipal } from './afhomes-access.js';
import type { VercelRequest } from './http.js';
import { toErrorEnvelope } from './envelope.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>;
const actor = randomUUID(),
  other = randomUUID(),
  customer = randomUUID(),
  plan = randomUUID(),
  sale = randomUUID(),
  legacy = randomUUID(),
  foreign = randomUUID();
let allowed = true;
let principal: AfHomesPrincipal = {
  userId: actor,
  email: 'synthetic@example.invalid',
  fullName: 'Synthetic',
  status: 'active',
  roleId: randomUUID(),
  roleSlug: 'super_admin',
  roleName: 'Super Admin',
  mustChangePassword: false,
  permissions: [
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};
const authorize: typeof authorizeAfHomes = async () =>
  allowed ? principal : { error: toErrorEnvelope('FORBIDDEN', 'Denied', 403) };
let handler: ReturnType<typeof createMongoAnalyticsHandler>;
async function call(path = '', query: Record<string, unknown> = {}, method = 'GET') {
  const r = makeRes();
  await handler(
    { method, headers: {}, query: { familyPath: path, ...query } } as VercelRequest,
    r.res,
  );
  return r.state;
}
beforeAll(async () => {
  replica = await createTestReplica();
  handler = createMongoAnalyticsHandler(replica.db, authorize);
  const now = new Date().toISOString();
  await replica.db.collection('card_sales').insertMany([
    {
      _id: sale,
      origin: 'normal',
      customer_id: customer,
      plan_id: plan,
      seller_staff_id: actor,
      cash_price_snapshot: '9007199254740993.01',
      status: 'active',
      created_at: now,
      submitted_at: now,
      fully_paid_at: now,
    },
    {
      _id: legacy,
      origin: 'normal',
      customer_id: customer,
      plan_id: plan,
      cash_price_snapshot: '50.00',
      status: 'submitted',
      created_at: now,
      referral_relationship_id: 'legacy-edge',
    },
    {
      _id: foreign,
      origin: 'normal',
      customer_id: customer,
      plan_id: plan,
      seller_staff_id: other,
      cash_price_snapshot: '999.00',
      status: 'active',
      created_at: now,
      submitted_at: now,
    },
  ] as never);
  await replica.db
    .collection('card_sale_hierarchy_snapshots')
    .insertOne({ _id: randomUUID(), sale_id: sale, ancestor_staff_id: actor } as never);
  await replica.db
    .collection('referral_relationships')
    .insertMany([
      { _id: 'legacy-edge', subject_staff_id: other, upline_staff_id: actor, is_active: true },
    ] as never);
  await replica.db.collection('customers').insertOne({ _id: customer, created_at: now } as never);
  await replica.db.collection('card_plans').insertOne({ _id: plan, name: 'Synthetic' } as never);
  await replica.db.collection('payments').insertMany([
    { _id: randomUUID(), sale_id: sale, status: 'verified', amount: '100.01', verified_at: now },
    { _id: randomUUID(), sale_id: sale, status: 'recorded', amount: '700.00', recorded_at: now },
    { _id: randomUUID(), sale_id: foreign, status: 'verified', amount: '999.00', verified_at: now },
  ] as never);
  await replica.db
    .collection('memberships')
    .insertOne({ _id: randomUUID(), sale_id: sale, status: 'active', activated_at: now } as never);
}, 120000);
afterAll(async () => replica?.stop());
it('preserves the overview contract and exact totals, excluding unverified money', async () => {
  const r = await call();
  expect(r.status).toBe(200);
  const body = analyticsOverviewSchema.parse(r.body);
  expect(body.headline).toMatchObject({
    totalCardSales: 3,
    periodVerifiedPayments: '1099.01',
    grossFrozenSaleValue: '9007199254742042.01',
    activatedMemberships: 1,
  });
  expect(body.queues.pendingPaymentVerification).toBe(1);
});
it('uses frozen snapshot attribution even after a team move and separates legacy sales', async () => {
  principal = { ...principal, roleSlug: 'sales_manager' };
  const r = await call();
  expect(r.status).toBe(200);
  const body = analyticsOverviewSchema.parse(r.body);
  expect(body.headline.totalCardSales).toBe(1);
  expect(body.headline.periodVerifiedPayments).toBe('100.01');
  expect(body.scope).toMatchObject({
    kind: 'team',
    attributedSaleCount: 1,
    unattributedLegacySaleCount: 1,
    unattributedLegacySaleValue: '50.00',
  });
});
it('counts only recognized active sales in continuous trend buckets', async () => {
  const r = await call('sales-trend');
  expect(r.status).toBe(200);
  const trend = salesTrendReportSchema.parse(r.body);
  expect(trend.periods).toHaveLength(12);
  expect(trend.periods.reduce((s, p) => s + p.count, 0)).toBe(1);
  expect(trend.periods.at(-1)?.total).toBe('9007199254740993.01');
});
it('keeps self scope and deny-only permissions without financial leakage', async () => {
  principal = { ...principal, roleSlug: 'ost', permissions: [] };
  const r = await call();
  const body = analyticsOverviewSchema.parse(r.body);
  expect(body.scope.kind).toBe('self');
  expect(body.headline.totalCardSales).toBe(1);
  expect(body.headline.periodVerifiedPayments).toBe('0.00');
  expect(body.commissions).toBeNull();
  expect(body.organization).toBeNull();
});
it('rejects unsupported import attribution rather than understating totals', async () => {
  await replica.db
    .collection('card_sales')
    .insertOne({ _id: randomUUID(), origin: 'customer_import', seller_staff_id: actor } as never);
  expect((await call()).status).toBe(501);
  await replica.db.collection('card_sales').deleteMany({ origin: 'customer_import' });
});
it('refuses uncertified import sources even without a native seller field', async () => {
  await replica.db
    .collection('customer_import_purchase_sources')
    .insertOne({ _id: randomUUID(), superseded_by: null } as never);
  expect((await call()).status).toBe(501);
  await replica.db.collection('customer_import_purchase_sources').deleteMany({});
});
it('rejects denied access, malformed periods and unsupported routes', async () => {
  expect((await call('', { period: 'bad' })).status).toBe(400);
  expect((await call('sales-trend', { granularity: 'day' })).status).toBe(400);
  expect((await call('unexpected')).status).toBe(404);
  expect((await call('', {}, 'POST')).status).toBe(404);
  allowed = false;
  expect((await call()).status).toBe(403);
});
it('serves team activity from frozen attribution, validates roots and refuses cross-team requests', async () => {
  allowed = true;
  principal = { ...principal, roleSlug: 'sales_manager' };
  const col = (name: string) =>
    replica.db.collection<import('./customer-activation.mongo.js').MongoRow>(name);
  const sellerRole = randomUUID();
  await col('roles').insertOne({ _id: sellerRole, slug: 'ost', is_active: true });
  await col('staff_users').insertOne({
    _id: other,
    full_name: 'Synthetic Seller',
    status: 'active',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: other,
    role_id: sellerRole,
  });
  await col('ost_members').insertOne({ _id: other, status: 'active' });
  const first = await call('team-sales');
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ kpis: { totalTeamSales: 0, membersNoSales: 1 } });
  await col('card_sale_hierarchy_snapshots').insertOne({
    _id: randomUUID(),
    sale_id: foreign,
    ancestor_staff_id: actor,
  });
  expect((await call('team-sales')).body).toMatchObject({
    kpis: { totalTeamSales: 1, membersWithSales: 1 },
  });
  expect((await call('team-sales', { staffId: other })).status).toBe(403);
  expect((await call('team-sales', { from: '2026-10-28', to: '2026-10-01' })).status).toBe(400);
  expect((await call('team-sales', { period: 'bad' })).status).toBe(400);
  expect((await call('team-sales/overview')).status).toBe(403);
  const root = randomUUID(),
    rootRole = randomUUID(),
    managerRole = randomUUID();
  await col('roles').insertMany([
    { _id: rootRole, slug: 'vice_director', is_active: true },
    { _id: managerRole, slug: 'sales_manager', is_active: true },
  ]);
  await col('staff_users').insertMany([
    { _id: root, full_name: 'Synthetic Root', status: 'active' },
    { _id: actor, full_name: 'Synthetic Manager', status: 'active' },
  ]);
  await col('staff_role_assignments').insertMany([
    { _id: randomUUID(), staff_id: root, role_id: rootRole },
    { _id: randomUUID(), staff_id: actor, role_id: managerRole },
  ]);
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: actor,
    upline_staff_id: root,
    is_active: true,
  });
  principal = { ...principal, roleSlug: 'super_admin' };
  expect((await call('team-sales', { staffId: actor })).status).toBe(200);
  expect((await call('team-sales', { staffId: other })).status).toBe(403);
  expect((await call('team-sales/overview')).body).toMatchObject({ topTeam: { totalSales: 0 } });
  await col('card_sale_hierarchy_snapshots').insertOne({
    _id: randomUUID(),
    sale_id: foreign,
    ancestor_staff_id: root,
  });
  expect((await call('team-sales/overview')).body).toMatchObject({ topTeam: { totalSales: 1 } });
});
