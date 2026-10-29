import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';
import { installMongoCoreSetup } from './mongo-core-setup.js';
import { createAfHomesAdminAuth } from './auth.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '';
const people = new Map<string, { id: string; email: string; cookie: string }>(),
  password = 'SyntheticPortalOnly123!';
const col = (name: string) => test.db.collection<MongoRow>(name);
const request = (path: string, cookie = '', body?: unknown) =>
  fetch(base + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'synthetic-participation-only-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  const fixture = await seedPhase7Fixture(test.db, test.client, env, password);
  await installMongoCoreSetup(test.db, test.client, fixture.admin.id);
  people.set('sales_manager', { id: fixture.staff.id, email: fixture.staff.email, cookie: '' });
  const auth = createAfHomesAdminAuth(test.db, test.client, env);
  for (const slug of ['vice_director', 'senior_sales_manager', 'ost', 'employee']) {
    const identity = await auth.api.createUser({
      body: {
        email: `portal-${slug}@example.invalid`,
        password,
        name: 'Synthetic Participant',
        data: { emailVerified: true },
      },
    });
    const role = await col('roles').findOne({ slug });
    if (slug !== 'employee') {
      for (const key of ['dashboard.view','sales.card_sales','sales.customers']) {
        const module=await col('modules').findOne({key});
        await col('role_permissions').updateOne({role_id:role!._id,module_id:module!._id},{$setOnInsert:{_id:randomUUID(),can_view:true,can_create:false,can_update:false,can_delete:false}},{upsert:true});
      }
    }
    await col('staff_users').insertOne({
      _id: identity.user.id,
      email: identity.user.email,
      full_name: 'Synthetic Participant',
      status: 'active',
      must_change_password: false,
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: identity.user.id,
      role_id: role!._id,
    });
    people.set(slug, { id: identity.user.id, email: identity.user.email, cookie: '' });
  }
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { must_change_password: false } },
  );
  const participantFields = {
    svd_staff_id: people.get('vice_director')!.id,
    ssm_staff_id: people.get('senior_sales_manager')!.id,
    sm_staff_id: fixture.staff.id,
    referrer_staff_id: people.get('ost')!.id,
  };
  for (const [status, ref] of [
    ['submitted', 'SYNTHETIC-PENDING'],
    ['approved', 'SYNTHETIC-FINAL'],
  ] as const) {
    const customer = randomUUID(),
      app = randomUUID(),
      sale = status === 'approved' ? randomUUID() : null;
    await col('customers').insertOne({
      _id: customer,
      first_name: 'Synthetic',
      last_name: 'Purchase',
      customer_number: `AF-CUS-${ref}`,
      customer_code: `AF-CC-${ref}`,
      email: `${ref.toLowerCase()}@example.invalid`,
    });
    if (sale)
      await col('card_sales').insertOne({
        _id: sale,
        customer_id: customer,
        plan_id: fixture.plan,
        seller_staff_id: fixture.admin.id,
        origin: 'normal',
        status: 'payment_verified',
        sale_number: ref,
        created_at: new Date().toISOString(),
      });
    await col('customer_applications').insertOne({
      _id: app,
      customer_id: customer,
      ...participantFields,
      sale_id: sale,
      application_number: ref,
      tier_snapshot: 'BRONZE',
      status,
      created_at: new Date().toISOString(),
    });
  }
  await col('customer_applications').insertOne({
    _id: randomUUID(),
    customer_id: fixture.customer.id,
    svd_staff_id: randomUUID(),
    application_number: 'UNRELATED-PRIVATE',
    status: 'submitted',
    created_at: new Date().toISOString(),
  });
  server.on(
    'request',
    createMongoDevelopmentHandler(createMongoPhase5Runtime(test.db, test.client, env), {
      coreWritesEnabled: true,
    }),
  );
  for (const person of people.values()) {
    // Independent fixture principals must not share the login-attempt budget.
    await col('auth_rate_limits').deleteMany({});
    const login = await request('/auth/identity/sign-in/email', '', {
      email: person.email,
      password,
    });
    expect(login.status).toBe(200);
    person.cookie = cookieOf(login);
  }
}, 45000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await test?.stop();
});
it.each(['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'])(
  'shows only the recorded %s participation and lifecycle status, without reassigning the seller',
  async (role) => {
    const result = await request(
      '/sales-involvement?staffId=' + randomUUID(),
      people.get(role)!.cookie,
    );
    expect(result.status).toBe(200);
    const records = (await result.json()).data;
    expect(records).toContainEqual(
      expect.objectContaining({ reference: 'SYNTHETIC-PENDING', status: 'submitted' }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ reference: 'SYNTHETIC-FINAL', status: 'payment_verified' }),
    );
    expect(JSON.stringify(records)).not.toContain('UNRELATED-PRIVATE');
    expect(await col('card_sale_hierarchy_snapshots').countDocuments({})).toBe(0);
  },
);
it('serves imported own/team purchases through real cookies and rechecks deny restrictions per request', async () => {
  const ost = people.get('ost')!, manager = people.get('sales_manager')!;
  const row = randomUUID(), source = randomUUID(), application = randomUUID(), sale = randomUUID(), customer = randomUUID();
  const now = new Date().toISOString();
  await col('customers').insertOne({ _id: customer, first_name: 'Synthetic', last_name: 'Imported Buyer', customer_number: 'SYNTHETIC-IMPORT' });
  await col('customer_import_rows').insertOne({ _id: row, committed_at: now, raw_data: { referrer_staff_id: ost.id, sm_staff_id: manager.id, vip_tier: 'GOLD' } });
  await col('customer_import_purchase_sources').insertOne({ _id: source, issuer_scope: 'afhomes', normalized_reference: 'synthetic-cookie-import', purchase_reference: 'SYNTHETIC-COOKIE-IMPORT', original_row_id: row, application_id: application, customer_id: customer, created_at: now });
  await col('customer_applications').insertOne({ _id: application, customer_id: customer, sale_id: sale, tier_snapshot: 'GOLD' });
  await col('card_sales').insertOne({ _id: sale, customer_id: customer, seller_staff_id: ost.id, sale_number: 'SYNTHETIC-COOKIE-IMPORT', origin: 'legacy_import', cash_price_snapshot: '312000.00', status: 'active', created_at: now });
  await col('memberships').insertOne({ _id: randomUUID(), customer_id: customer, sale_id: sale, status: 'expired' });
  await col('referral_relationships').insertOne({ _id: randomUUID(), upline_staff_id: manager.id, subject_staff_id: ost.id, is_active: true, is_authoritative: true });
  const own = await request('/ist-portal/imported-sales', ost.cookie);
  expect(own.status).toBe(200);
  expect(own.headers.get('cache-control')).toBe('no-store');
  expect((await own.json()).data).toContainEqual(expect.objectContaining({ id: source, status: 'expired', customerName: 'Synthetic Imported Buyer' }));
  const team = await request('/ist-portal/imported-sales?view=team-sales', manager.cookie);
  expect(team.status).toBe(200);
  expect((await team.json()).data).toContainEqual(expect.objectContaining({ id: source }));
  expect((await request('/ist-portal/imported-sales?view=team-sales', ost.cookie)).status).toBe(403);
  expect((await request('/ist-portal/imported-sales')).status).toBe(401);
  const module = await col('modules').findOne({ key: 'sales.card_sales' });
  const restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({ _id: restriction, staff_id: ost.id, module_id: module!._id, deny_view: true });
  try {
    expect((await request('/ist-portal/imported-sales', ost.cookie)).status).toBe(403);
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
});
it('denies anonymous, non-sales and restricted staff, disables Reports/CMS and keeps analytics available', async () => {
  expect((await request('/sales-involvement')).status).toBe(401);
  expect((await request('/sales-involvement', people.get('employee')!.cookie)).status).toBe(403);
  const module = await col('modules').findOne({ key: 'sales.customers' });
  await col('staff_permission_restrictions').insertOne({
    _id: randomUUID(),
    staff_id: people.get('ost')!.id,
    module_id: module!._id,
    deny_view: true,
  });
  expect((await request('/sales-involvement', people.get('ost')!.cookie)).status).toBe(403);
  const cookie = people.get('vice_director')!.cookie;
  expect((await request('/reports/sales', cookie)).status).toBe(403);
  expect((await request('/cms/pages', cookie)).status).toBe(403);
  expect((await request('/analytics/team-sales', cookie)).status).toBe(200);
});
it('keeps first-login business access gated, then revokes the cookie on sign-out and accepts only the new password',async()=>{
  const person=people.get('ost')!;
  await col('staff_users').updateOne({_id:person.id},{$set:{must_change_password:true}});
  expect((await request('/sales-involvement',person.cookie)).status).toBe(403);
  expect((await request('/admin/afhomes/session/password',person.cookie,{currentPassword:password,newPassword:'SyntheticPermanentPortal123!'})).status).toBe(200);
  expect((await request('/auth/identity/sign-out',person.cookie,{})).status).toBe(200);
  expect((await request('/admin/afhomes/session',person.cookie)).status).toBe(401);
  await col('auth_rate_limits').deleteMany({});
  expect((await request('/auth/identity/sign-in/email','',{email:person.email,password})).status).toBe(401);
  const login=await request('/auth/identity/sign-in/email','',{email:person.email,password:'SyntheticPermanentPortal123!'});
  expect(login.status).toBe(200);
  expect(await (await request('/admin/afhomes/session',cookieOf(login))).json()).toMatchObject({mustChangePassword:false});
});
