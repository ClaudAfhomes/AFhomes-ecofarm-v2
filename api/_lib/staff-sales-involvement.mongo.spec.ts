import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { authorizeAfHomes } from './afhomes-access.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoStaffSalesInvolvementHandler } from './staff-sales-involvement.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import { toErrorEnvelope } from './envelope.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>;
let deny = '';
const staff = randomUUID(),
  customer = randomUUID(),
  plan = randomUUID(),
  sale = randomUUID(),
  app = randomUUID(),
  importRow = randomUUID(),
  source = randomUUID();
const col = (name: string) => replica.db.collection<MongoRow>(name);
const authorize: typeof authorizeAfHomes = async (_req, module) =>
  module === deny
    ? { error: toErrorEnvelope('FORBIDDEN', 'Denied', 403) }
    : {
        userId: randomUUID(),
        email: 'synthetic@example.invalid',
        fullName: 'Synthetic',
        status: 'active',
        roleId: randomUUID(),
        roleSlug: 'super_admin',
        roleName: 'Super Admin',
        mustChangePassword: false,
        permissions: [],
      };
async function call(query: Record<string, unknown> = {}, target: string = staff) {
  const response = makeRes();
  await createMongoStaffSalesInvolvementHandler(
    replica.db,
    replica.client,
    authorize,
  )(
    {
      method: 'GET',
      query: { familyPath: `staff/${target}/sales-involvement`, ...query },
      headers: {},
    } as VercelRequest,
    response.res,
  );
  return response.state;
}
beforeAll(async () => {
  replica = await createTestReplica();
  await col('staff_users').insertOne({ _id: staff });
  await col('customers').insertOne({
    _id: customer,
    first_name: 'Synthetic',
    last_name: 'Customer',
    customer_number: 'AF-CUS-SYNTH',
    ra_number: 'RA-SYNTH',
  });
  await col('card_plans').insertOne({ _id: plan, code: 'BRONZE' });
  await col('card_sales').insertOne({
    _id: sale,
    customer_id: customer,
    plan_id: plan,
    seller_staff_id: staff,
    sale_number: 'AF-SALE-SYNTH',
    status: 'active',
    created_at: '2026-10-01T00:00:00.000Z',
  });
  await col('card_sale_hierarchy_snapshots').insertOne({
    _id: randomUUID(),
    sale_id: sale,
    ancestor_staff_id: staff,
    ancestor_role: 'sales_manager',
  });
  await col('customer_applications').insertOne({
    _id: app,
    customer_id: customer,
    sale_id: sale,
    sm_staff_id: staff,
    referrer_staff_id: staff,
    application_number: 'AF-APP-SYNTH',
    tier_snapshot: 'BRONZE',
    status: 'approved',
    created_at: '2026-09-30T00:00:00.000Z',
  });
}, 120000);
afterAll(async () => replica?.stop());
it('merges recorded seller, application and frozen snapshot roles into one sorted result', async () => {
  const r = await call();
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    data: [
      {
        id: `sale:${sale}`,
        customerId: customer,
        customerNumber: 'RA-SYNTH',
        saleId: sale,
        applicationId: app,
        createdAt: '2026-09-30T00:00:00.000Z',
        roles: ['Referrer', 'SM', 'Seller', 'sales_manager'],
      },
    ],
  });
});
it('includes committed original import attribution but excludes aliases and superseded sources', async () => {
  await col('customer_import_rows').insertOne({
    _id: importRow,
    customer_id: customer,
    committed_at: '2026-09-01T00:00:00.000Z',
    raw_data: {
      purchase_reference: 'IMPORTED-SYNTH',
      vip_tier: 'SILVER',
      recommender_staff_id: staff,
    },
  });
  await col('customer_import_purchase_sources').insertOne({
    _id: source,
    original_row_id: importRow,
    purchase_reference: 'IMPORTED-SYNTH',
    created_at: '2026-09-01T00:00:00.000Z',
    superseded_by: null,
  });
  await col('customer_import_source_rows').insertOne({
    _id: randomUUID(),
    row_id: importRow,
    source_id: source,
  });
  const alias = randomUUID();
  await col('customer_import_rows').insertOne({
    _id: alias,
    customer_id: customer,
    committed_at: '2026-08-01T00:00:00.000Z',
    raw_data: { referrer_staff_id: staff, vip_tier: 'GOLD' },
  });
  await col('customer_import_source_rows').insertOne({
    _id: randomUUID(),
    row_id: alias,
    source_id: source,
  });
  let r = await call();
  expect((r.body as { data: unknown[] }).data).toHaveLength(2);
  expect(r.body).toMatchObject({
    data: expect.arrayContaining([
      expect.objectContaining({
        id: `import:${source}`,
        tier: 'SILVER',
        status: 'imported_pending_review',
        roles: ['VIP Recommender'],
      }),
    ]),
  });
  await col('customer_import_purchase_sources').updateOne(
    { _id: source },
    { $set: { superseded_by: randomUUID() } },
  );
  r = await call();
  expect((r.body as { data: unknown[] }).data).toHaveLength(1);
});
it('paginates after grouping and never derives sales from present genealogy', async () => {
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: randomUUID(),
    upline_staff_id: staff,
    is_active: true,
  });
  expect((await call({ limit: 1, offset: 1 })).body).toMatchObject({ data: [] });
  expect((await call({ limit: 1 })).body).toMatchObject({ data: [{ id: `sale:${sale}` }] });
});
it('checks both permissions and validates staff IDs and page boundaries', async () => {
  deny = 'organization.staff';
  expect((await call()).status).toBe(403);
  deny = 'sales.customers';
  expect((await call()).status).toBe(403);
  deny = '';
  expect((await call({}, randomUUID())).status).toBe(404);
  expect((await call({}, 'bad')).status).toBe(400);
  expect((await call({ limit: 101 })).status).toBe(400);
});
it('preserves JSON text references from committed workbook cells without marking uncommitted rows as sales', async () => {
  const row = randomUUID();
  await col('customer_import_rows').insertOne({
    _id: row,
    customer_id: customer,
    committed_at: '2026-07-01T00:00:00.000Z',
    raw_data: { referrer_staff_id: staff, purchase_reference: 123456, vip_tier: 'BRONZE' },
  });
  await col('customer_import_rows').insertOne({
    _id: randomUUID(),
    customer_id: customer,
    committed_at: null,
    raw_data: { referrer_staff_id: staff, purchase_reference: 'DO-NOT-DISPLAY', vip_tier: 'GOLD' },
  });
  const result = await call();
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    data: expect.arrayContaining([
      expect.objectContaining({
        id: `import:${row}`,
        reference: '123456',
        status: 'imported_pending_review',
      }),
    ]),
  });
  expect(JSON.stringify(result.body)).not.toContain('DO-NOT-DISPLAY');
});
