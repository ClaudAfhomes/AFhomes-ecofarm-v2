import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { activationResultSchema, saleSchema, customerSchema, paymentSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { installTestCoreValidators } from './testing/core-validators.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { installMongoReferenceCatalog } from './reference-catalog.mongo.js';
import { MONGO_CORE_SETUP_VERSION } from './mongo-core-setup.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  cookie = '';
let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>,
  saleId = '',
  customerId = '',
  paymentId = '';
let membershipId = '',
  originalQr = '';
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'sales-fixture-only-random-secret-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_WEB_URL: base,
  };
  fixture = await seedPhase5Fixture(test.db, test.client, env);
  const assignment = await test.db
    .collection('staff_role_assignments')
    .findOne({ staff_id: fixture.staff.id });
  await test.db
    .collection('roles')
    .updateOne({ _id: assignment!.role_id }, { $set: { slug: 'super_admin', is_system: true } });
  await test.db
    .collection('staff_users')
    .updateOne({ email: fixture.staff.email }, { $set: { must_change_password: false } });
  await test.db
    .collection('mfa_policy')
    .updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  for (const key of [
    'sales.card_sales',
    'finance.payment_verification',
    'finance.card_activation',
    'finance.points',
    'operations.customer_lookup',
    'network.commissions',
    'organization.staff',
    'organization.roles',
    'organization.departments',
  ])
    await test.db
      .collection<{ _id: string; key: string; is_active: boolean }>('modules')
      .insertOne({ _id: randomUUID(), key, is_active: true });
  await test.db.collection('card_plans').updateOne(
    {},
    {
      $set: {
        cash_price: '60000.03',
        minimum_down_payment: '10000.00',
        yearly_points: 99999,
        validity_years: 1,
      },
    },
  );
  await installTestCoreValidators(test.db);
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}, 120_000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await test?.stop();
});
async function request(path: string, body?: unknown, session = cookie, method?: string) {
  return fetch(`${base}/api/v1${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it('returns contract-valid seeded payment history for the disposable browser membership', async () => {
  const response = await request(`/sales/${fixture.customer.sale}/payments`);
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toHaveLength(1);
  expect(paymentSchema.safeParse(data[0]).success).toBe(true);
  expect(data[0]).toMatchObject({
    amount: '100000.00',
    paymentType: 'full',
    status: 'verified',
    recordedBy: fixture.staff.id,
    verifiedBy: fixture.staff.id,
  });
});
it('creates frozen commercial terms and pending commission using the actual native customer and catalog routes', async () => {
  const customer = await request('/customers', {
    firstName: 'Sales',
    lastName: 'Fixture',
    dateOfBirth: '1990-01-01',
    email: 'sales-customer@example.invalid',
    phone: '09185551234',
    address: { line1: 'Synthetic address', city: 'Quezon City', province: 'Metro Manila' },
  });
  expect({ status: customer.status, body: await customer.clone().json() }).toMatchObject({
    status: 201,
  });
  customerId = customerSchema.parse(await customer.json()).id;
  const sale = await request('/sales', {
    customerId,
    productId: fixture.plan,
    cashPrice: '0.01',
    sellerStaffId: fixture.staff.id,
  });
  expect({ status: sale.status, body: await sale.clone().json() }).toMatchObject({ status: 201 });
  const value = saleSchema.parse(await sale.json());
  saleId = value.id;
  expect(value.cashPrice).toBe('60000.03');
  expect(value.commissionRate).toBe('0');
  expect(value.saleNumber).toMatch(/^AF-CSALE-[A-Z0-9]{5}$/);
  expect((await request('/sales', { customerId, productId: fixture.plan })).status).toBe(409);
  expect(await test.db.collection('commissions').findOne({ sale_id: saleId })).toMatchObject({
    status: 'pending',
    amount: '0.00',
    basis_amount_snapshot: '60000.03',
  });
  await test.db.collection('card_plans').updateOne({}, { $set: { cash_price: '999999.00' } });
  expect((await (await request(`/sales/${saleId}`)).json()).cashPrice).toBe('60000.03');
  const queue = await request('/queues/finance');
  expect(queue.status).toBe(200);
  expect((await queue.json()).data).toEqual([
    expect.objectContaining({
      origin: 'sale',
      saleId,
      verifiedTotal: '0.00',
      remainingBalance: '60000.03',
      activatable: false,
    }),
  ]);
});
it('records money idempotently, refuses changed retries and never activates recorded-only money', async () => {
  const body = { requestId: randomUUID(), amount: '60000.03', method: 'cash', paymentType: 'full' };
  const results = await Promise.all([
    request(`/sales/${saleId}/payments`, body),
    request(`/sales/${saleId}/payments`, body),
  ]);
  expect(results.map((result) => result.status)).toEqual([201, 201]);
  const values = await Promise.all(results.map((result) => result.json()));
  expect(values[0]).toEqual(values[1]);
  paymentId = values[0].id;
  expect((await request(`/sales/${saleId}/payments`, { ...body, amount: '1.00' })).status).toBe(
    409,
  );
  expect((await request(`/sales/${saleId}/activate`, {})).status).toBe(409);
  expect(await test.db.collection('memberships').countDocuments({ customer_id: customerId })).toBe(
    0,
  );
  expect((await (await request(`/sales/${saleId}/summary`)).json()).verifiedTotal).toBe('0.00');
});
it('verifies once under concurrent retries and rechecks full verified payment before activating once', async () => {
  await test.db.command({ collMod: 'audit_events', validator: { action: { $ne: 'PAYMENT_VERIFIED' } }, validationLevel: 'strict' });
  try {
    expect((await request(`/sales/${paymentId}/verify`, { decision: 'verified' })).status).toBe(503);
    expect(await test.db.collection('payments').findOne({ sale_id: saleId })).toHaveProperty('status', 'recorded');
    expect((await (await request(`/sales/${saleId}/summary`)).json()).verifiedTotal).toBe('0.00');
  } finally { await test.db.command({ collMod: 'audit_events', validator: {}, validationLevel: 'off' }); }
  const verified = await Promise.all([
    request(`/sales/${paymentId}/verify`, { decision: 'verified' }),
    request(`/sales/${paymentId}/verify`, { decision: 'verified' }),
  ]);
  expect(verified.map((result) => result.status)).toEqual([200, 200]);
  expect(
    await test.db
      .collection('audit_events')
      .countDocuments({ action: 'PAYMENT_VERIFIED', entity_id: paymentId }),
  ).toBe(1);
  expect((await (await request(`/sales/${saleId}/summary`)).json()).verifiedTotal).toBe('60000.03');
  const queue = await request('/queues/activation');
  expect(queue.status).toBe(200);
  expect((await queue.json()).data).toEqual([
    expect.objectContaining({ saleId, fullyPaid: true, activatable: true }),
  ]);
  const beforeMissingConfig = await test.db.collection('customers').findOne({_id:customerId as never});
  await test.db.collection('tier_points_config').deleteMany({});
  const missingConfig = await request(`/sales/${saleId}/activate`, {});
  expect(missingConfig.status).toBe(503);
  expect((await missingConfig.json()).error.message).toBe('Points tier configuration is unavailable');
  expect(await test.db.collection('memberships').countDocuments({sale_id:saleId})).toBe(0);
  expect(await test.db.collection('customers').findOne({_id:customerId as never})).toEqual(beforeMissingConfig);
  await test.db.collection('admin_bootstrap').insertOne({_id:'initial-super-admin' as never,user_id:fixture.staff.id});
  await test.db.collection('mongo_conversion_setup').insertOne({_id:'core' as never,version:MONGO_CORE_SETUP_VERSION,database:'afhomes_dev'});
  expect((await installMongoReferenceCatalog(test.db,test.client,fixture.staff.id,{pointsOnly:true}))!.added).toHaveLength(3);
  await test.db.command({ collMod: 'audit_events', validator: { action: { $ne: 'MEMBERSHIP_ACTIVATED' } }, validationLevel: 'strict' });
  try {
    expect((await request(`/sales/${saleId}/activate`, {})).status).toBe(503);
    expect(await test.db.collection('memberships').countDocuments({ sale_id: saleId })).toBe(0);
    expect(await test.db.collection('card_sales').findOne({ customer_id: customerId })).toHaveProperty('status', 'payment_verified');
    expect(await test.db.collection('commissions').findOne({ sale_id: saleId })).toHaveProperty('status', 'payment_verified');
  } finally { await test.db.command({ collMod: 'audit_events', validator: {}, validationLevel: 'off' }); }
  const activated = await Promise.all([
    request(`/sales/${saleId}/activate`, {}),
    request(`/sales/${saleId}/activate`, {}),
  ]);
  expect(activated.map((result) => result.status)).toEqual([200, 200]);
  const numbered = await test.db.collection<MongoRow>('customers').findOne({ _id: customerId });
  expect(numbered?.vip_card_number).toMatch(/^\d{11}B1C01S$/);
  const lookup = await request('/memberships/customer-lookup?search=Sales');
  expect(lookup.status).toBe(200);
  expect((await lookup.json()).data).toContainEqual(expect.objectContaining({ vipCardNumber: numbered?.vip_card_number }));
  expect((await request(`/sales/${saleId}/activate`, {})).status).toBe(200);
  expect((await test.db.collection<MongoRow>('customers').findOne({ _id: customerId }))?.vip_card_number).toBe(numbered?.vip_card_number);
  const responses = (await Promise.all(activated.map((result) => result.json()))).map((row) =>
    activationResultSchema.parse(row),
  );
  expect(responses.filter((row) => row.alreadyActive)).toHaveLength(1);
  expect(responses.filter((row) => !row.alreadyActive)[0]).toMatchObject({
    pointsAllocated: 0,
    onboarding: { status: 'manual_required' },
  });
  expect(responses.filter((row) => row.alreadyActive)[0]).toMatchObject({
    qrToken: null,
    fallbackCode: null,
  });
  membershipId = responses[0]!.membershipId;
  originalQr = responses.find((row) => !row.alreadyActive)!.qrToken!;
  const membership = await test.db.collection('memberships').findOne({ customer_id: customerId });
  expect(membership?.membership_number).toMatch(/^MBS-([A-F0-9]{8}-){3}[A-F0-9]{8}$/);
  expect(
    await test.db.collection('points_accounts').findOne({ membership_id: membership!._id }),
  ).toMatchObject({ balance: 0 });
  expect(await test.db.collection('points_periods').countDocuments()).toBeGreaterThan(0);
  expect(
    await test.db.collection('points_ledger').countDocuments({
      account_id: (await test.db
        .collection('points_accounts')
        .findOne({ membership_id: membership!._id }))!._id,
    }),
  ).toBe(0);
  expect(await test.db.collection('commissions').findOne({ sale_id: saleId })).toHaveProperty(
    'status',
    'final_qualification_pending',
  );
});
it('does not disclose another seller sale or permit Finance mutations to a view-only seller', async () => {
  const department = await request('/admin/afhomes/departments', { name: 'Sales Scope Fixture' });
  const departmentId = (await department.json()).id;
  const role = await request('/admin/afhomes/roles', {
    name: 'Read Only Seller',
    departmentId,
    permissions: [
      {
        moduleKey: 'sales.card_sales',
        canView: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      },
    ],
  });
  expect(role.status).toBe(201);
  const roleId = (await role.json()).id;
  const staff = await request('/admin/afhomes/staff', {
    email: 'other-seller@example.invalid',
    fullName: 'Other Seller',
    departmentId,
    roleId,
    temporaryPassword: 'SyntheticOther123',
  });
  expect(staff.status).toBe(201);
  const staffId = (await staff.json()).id;
  await test.db
    .collection('staff_users')
    .updateOne(
      { email: 'other-seller@example.invalid' },
      { $set: { must_change_password: false } },
    );
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: 'other-seller@example.invalid', password: 'SyntheticOther123' },
    '',
  );
  expect(login.status).toBe(200);
  const other = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect((await (await request('/sales', undefined, other)).json()).meta.total).toBe(0);
  expect((await request(`/sales/${saleId}`, undefined, other)).status).toBe(404);
  expect(
    (
      await request(
        `/sales/${saleId}/payments`,
        { requestId: randomUUID(), amount: '1.00', paymentType: 'full', method: 'cash' },
        other,
      )
    ).status,
  ).toBe(403);
  expect((await request(`/sales/${saleId}/activate`, {}, other)).status).toBe(403);
  expect(
    await test.db.collection('staff_users').findOne({ email: 'other-seller@example.invalid' }),
  ).toHaveProperty('_id', staffId);
  expect((await request('/queues/finance', undefined, other)).status).toBe(403);
});
it('keeps qualification manual and marks paid once without changing frozen amounts or beneficiaries', async () => {
  const commission = await test.db.collection('commissions').findOne({ sale_id: saleId });
  const id = commission!._id;
  expect((await request(`/commissions/${id}/pay`, {})).status).toBe(409);
  expect(
    (await request(`/commissions/${id}/qualify`, { decision: 'earned', notes: 'bad' })).status,
  ).toBe(400);
  expect(
    (
      await request(`/commissions/${id}/qualify`, {
        decision: 'earned',
        notes: 'Manual synthetic qualification approved',
      })
    ).status,
  ).toBe(200);
  const paid = await Promise.all([
    request(`/commissions/${id}/pay`, { reference: 'SYNTHETIC-PAID' }),
    request(`/commissions/${id}/pay`, { reference: 'SYNTHETIC-PAID' }),
  ]);
  expect(paid.map((row) => row.status)).toEqual([200, 200]);
  const after = await test.db.collection('commissions').findOne({ _id: id });
  expect(after).toMatchObject({
    amount: commission!.amount,
    rate_snapshot: commission!.rate_snapshot,
    basis_amount_snapshot: commission!.basis_amount_snapshot,
    beneficiary_staff_id: commission!.beneficiary_staff_id,
    status: 'paid',
  });
  expect(
    await test.db
      .collection('audit_events')
      .countDocuments({ entity_id: String(id), action: 'COMMISSION_PAID' }),
  ).toBe(1);
});
it('resolves account rules before role defaults for new sales without rewriting prior snapshots', async () => {
  const assignment = await test.db
    .collection('staff_role_assignments')
    .findOne({ staff_id: fixture.staff.id });
  const date = new Date().toISOString().slice(0, 10);
  const roleRule = {
    targetType: 'role',
    targetId: assignment!.role_id,
    rate: '0.04',
    effectiveFrom: date,
  };
  expect((await request('/commissions/rules', roleRule)).status).toBe(201);
  expect((await request('/commissions/rules', roleRule)).status).toBe(409);
  expect(
    (await request('/commissions/rules', { ...roleRule, targetId: randomUUID() })).status,
  ).toBe(400);
  const account = await request('/commissions/rules', {
    targetType: 'staff',
    targetId: fixture.staff.id,
    rate: '0.03',
    effectiveFrom: date,
  });
  expect(account.status).toBe(201);
  const accountId = (await account.json()).id;
  const customer = await request('/customers', {
    firstName: 'Prospective',
    lastName: 'Rules',
    dateOfBirth: '1991-01-01',
    email: 'prospective@example.invalid',
    phone: '09185551235',
    address: { line1: 'Synthetic address', city: 'Quezon City', province: 'Metro Manila' },
  });
  expect(customer.status).toBe(201);
  const sale = await request('/sales', {
    customerId: (await customer.json()).id,
    productId: fixture.plan,
  });
  expect(sale.status).toBe(201);
  const value = saleSchema.parse(await sale.json());
  expect(value).toMatchObject({ commissionRate: '0.03', expectedCommission: '29999.97' });
  expect((await (await request(`/sales/${saleId}`)).json()).commissionRate).toBe('0');
  expect(
    (await request(`/commissions/rules/${accountId}`, { isActive: false }, cookie, 'PATCH')).status,
  ).toBe(200);
  expect((await request(`/commissions/rules/${accountId}/history`)).status).toBe(200);
});
it('merges reservation and sale Finance queues with exact verified totals, joined search and stable pagination', async () => {
  const applicationId = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  await test.db
    .collection<{ _id: string; application_number: string; status: string }>(
      'customer_applications',
    )
    .insertOne({ _id: applicationId, application_number: 'AF-APP-SYNTH', status: 'approved' });
  await test.db
    .collection<{ _id: string } & Record<string, unknown>>('reservation_agreements')
    .insertMany(
      [first, second].map((id, index) => ({
        _id: id,
        reservation_number: index ? 'AF-RES-SECOND' : 'AF-RES-FIRST',
        customer_application_id: applicationId,
        customer_id: fixture.customer.id,
        seller_staff_id: fixture.staff.id,
        purchase_terms_id: randomUUID(),
        origin: 'application',
        status: 'executed',
        sale_id: null,
        tier_snapshot: 'BRONZE',
        total_price_snapshot: '150.00',
        required_initial_snapshot: '50.00',
        reservation_fee_snapshot: '50.00',
        validity_months_snapshot: 12,
      })),
    );
  await test.db.collection<MongoRow>('payments').insertMany([
    { _id: randomUUID(), reservation_id: first, amount: '50.02', status: 'verified' },
    { _id: randomUUID(), reservation_id: first, amount: '99999.00', status: 'recorded' },
    { _id: randomUUID(), reservation_id: second, amount: '151.00', status: 'verified' },
  ]);
  const page = await request('/queues/finance?limit=1&offset=1');
  expect(page.status).toBe(200);
  expect(await page.json()).toMatchObject({
    meta: { total: 3, limit: 1, offset: 1 },
    data: [expect.anything()],
  });
  const firstSearch = await request('/queues/finance?search=FIRST');
  expect(firstSearch.status).toBe(200);
  expect(await firstSearch.json()).toMatchObject({
    meta: { total: 1 },
    data: [
      {
        reservationId: first,
        verifiedTotal: '50.02',
        remainingBalance: '99.98',
        recordedPaymentCount: 1,
        activatable: false,
      },
    ],
  });
  expect(await (await request('/queues/finance?search=SECOND')).json()).toMatchObject({
    data: [{ reservationId: second, overpaidAmount: '1.00', fullyPaid: true, activatable: false }],
  });
});
it('filters active VIP lookup before pagination and returns only the approved staff display fields', async () => {
  const rows = Array.from({ length: 55 }, (_, index) => ({
    _id: randomUUID(),
    first_name: 'Lookup',
    last_name: `Inactive ${index}`,
    status: 'suspended',
    email: `lookup-inactive-${index}@example.invalid`,
    created_at: new Date().toISOString(),
  }));
  const activeId = randomUUID(),
    memberId = randomUUID();
  const active = {
    _id: activeId,
    first_name: 'Lookup',
    last_name: 'Valid VIP',
    status: 'active',
    email: 'lookup-active@example.invalid',
    created_at: new Date().toISOString(),
    ra_number: '2026-9001',
    vip_card_number: 'B-90001',
    government_id_number: 'LOOKUP-PRIVATE-ID',
    phone: 'PRIVATE-PHONE',
  };
  await test.db
    .collection<{ _id: string } & Record<string, unknown>>('customers')
    .insertMany([...rows, active]);
  const lookupSale = randomUUID();
  const sourceSale = await test.db.collection<MongoRow>('card_sales').findOne({ _id: fixture.customer.sale });
  const sourcePayment = await test.db.collection<MongoRow>('payments').findOne({ sale_id: fixture.customer.sale });
  await test.db.collection<MongoRow>('card_sales').insertOne({
    ...sourceSale!, _id: lookupSale, customer_id: activeId, sale_number: `SYNTHETIC-LOOKUP-${lookupSale}`,
  });
  await test.db.collection<MongoRow>('payments').insertOne({
    ...sourcePayment!, _id: randomUUID(), sale_id: lookupSale, customer_id: activeId,
    payment_number: `SYNTHETIC-LOOKUP-${lookupSale}`,
  });
  await test.db.collection<{ _id: string } & Record<string, unknown>>('memberships').insertOne({
    _id: memberId,
    customer_id: activeId,
    sale_id: lookupSale,
    points_balance: 0,
    product_id: fixture.plan,
    status: 'active',
    membership_number: 'MBS-12345678-12345678-12345678-12345678',
    activated_at: new Date().toISOString(),
    expires_at: '2099-01-01T00:00:00.000Z',
  });
  await test.db.collection<{ _id: string } & Record<string, unknown>>('points_accounts').insertOne({
    _id: randomUUID(),
    membership_id: memberId,
    balance: 25,
    weekday_balance: 40,
    weekend_balance: 10,
  });
  const response = await request('/memberships/customer-lookup?search=Lookup');
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.meta).toMatchObject({ total: 1, limit: 50 });
  expect(body.data).toEqual([
    {
      firstName: 'Lookup',
      lastName: 'Valid VIP',
      raNumber: '2026-9001',
      vipCardNumber: 'B-90001',
      vipTier: 'BRONZE',
      validUntil: '2099-01-01',
      totalAvailablePoints: 25,
      weekdayAvailablePoints: 25,
      weekendAvailablePoints: 10,
      governmentIdImageUrl: null,
    },
  ]);
  expect(JSON.stringify(body)).not.toMatch(
    /MBS-|PRIVATE|example.invalid|membershipNumber|customerId/,
  );
  expect(
    (await (await request('/memberships/customer-lookup?search=MBS-12345678')).json()).data,
  ).toEqual([]);
  expect((await request('/memberships/customer-lookup?search=L')).status).toBe(400);
  expect((await request('/memberships/customer-lookup?search=Lookup', {})).status).toBe(404);
  expect((await request('/memberships/customer-lookup?search=Lookup', undefined, '')).status).toBe(
    401,
  );
  for (const update of [
    { expires_at: '2000-01-01T00:00:00.000Z' },
    { expires_at: null },
    { expires_at: '2099-01-01T00:00:00.000Z', status: 'suspended' },
  ]) {
    await test.db.collection('memberships').updateOne({ _id: memberId as never }, { $set: update });
    expect(
      (await (await request('/memberships/customer-lookup?search=Lookup')).json()).meta.total,
    ).toBe(0);
  }
});
it('reads a printable safe card, counts concurrent prints atomically and rotates secrets without changing identity or points', async () => {
  const card = await request(`/memberships/${membershipId}/card`);
  expect(card.status).toBe(200);
  const value = await card.json();
  expect(value).toMatchObject({
    membershipId,
    memberCode: expect.stringMatching(/^MBS-/),
    pointsBalance: 0,
  });
  expect(JSON.stringify(value)).not.toContain(originalQr);
  expect(
    (await request(`/memberships/resolve?identifier=${encodeURIComponent(originalQr)}`)).status,
  ).toBe(200);
  const printed = await Promise.all([
    request(`/memberships/${membershipId}/mark-printed`, {}),
    request(`/memberships/${membershipId}/mark-printed`, {}),
  ]);
  expect(printed.map((row) => row.status)).toEqual([200, 200]);
  expect(
    (await Promise.all(printed.map((row) => row.json()))).map((row) => row.printCount).sort(),
  ).toEqual([1, 2]);
  const rotated = await request(`/memberships/${membershipId}/reissue`, {
    reason: 'Synthetic lost printed credential',
  });
  expect(rotated.status).toBe(201);
  const next = await rotated.json();
  expect(next.membershipNumber).toBe(value.membershipNumber);
  expect(
    (await request(`/memberships/resolve?identifier=${encodeURIComponent(originalQr)}`)).status,
  ).toBe(404);
  expect(
    (await request(`/memberships/resolve?identifier=${encodeURIComponent(next.qrToken)}`)).status,
  ).toBe(200);
  expect(
    (await request(`/memberships/resolve?identifier=${encodeURIComponent(value.qrPayload)}`))
      .status,
  ).toBe(200);
  expect(
    await test.db.collection('memberships').findOne({ customer_id: customerId }),
  ).toMatchObject({ points_balance: 0, membership_number: value.membershipNumber, print_count: 2 });
  const audits = JSON.stringify(
    await test.db.collection('audit_events').find({ entity_id: membershipId }).toArray(),
  );
  expect(audits).not.toContain(next.qrToken);
  expect(audits).not.toContain(next.fallbackCode);
  expect((await request(`/memberships/accounts/${membershipId}`)).status).toBe(200);
});
it('activates a VIP through its code then removes login atomically on deactivation without deleting financial history', async () => {
  const issued = await request(`/customers/${customerId}/onboarding-token`, {});
  expect(issued.status).toBe(201);
  const link = new URL((await issued.json()).activationUrl),
    token = new URLSearchParams(link.hash.slice(1)).get('token');
  const password = 'SyntheticCustomerOwn123';
  const activated = await request(
    '/auth/customer/activate',
    { onboardingToken: token, password, passwordConfirmation: password },
    '',
  );
  expect(activated.status).toBe(201);
  const identity = await activated.json();
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: identity.email, password },
    '',
  );
  expect(login.status).toBe(200);
  const portalCookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect((await request('/customer', undefined, portalCookie)).status).toBe(200);
  const before = await test.db.collection('customers').findOne({ _id: customerId as never });
  const financial = await test.db.collection('payments').find({ sale_id: saleId }).toArray();
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_DEACTIVATED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await request(`/customers/${customerId}/deactivate`, {})).status).toBe(503);
    expect(
      await test.db.collection('customers').findOne({ _id: customerId as never }),
    ).toMatchObject({ status: 'active', auth_user_id: before!.auth_user_id });
    expect((await request('/customer', undefined, portalCookie)).status).toBe(200);
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {}, validationLevel: 'off' });
  }
  expect((await request(`/customers/${customerId}/deactivate`, {})).status).toBe(200);
  expect((await request('/customer', undefined, portalCookie)).status).toBe(401);
  expect(await test.db.collection('auth_users').countDocuments({ _id: before!.auth_user_id })).toBe(
    0,
  );
  expect(
    await test.db.collection('auth_accounts').countDocuments({ userId: before!.auth_user_id }),
  ).toBe(0);
  expect(
    await test.db
      .collection('customer_onboarding_tokens')
      .countDocuments({ customer_id: customerId }),
  ).toBe(0);
  expect(await test.db.collection('payments').find({ sale_id: saleId }).toArray()).toEqual(
    financial,
  );
  expect(await test.db.collection('memberships').countDocuments({ customer_id: customerId })).toBe(
    1,
  );
  expect(
    (
      await request(`/memberships/${membershipId}/reissue`, {
        reason: 'Suspended customer cannot rotate credentials',
      })
    ).status,
  ).toBe(409);
  expect((await request('/admin/afhomes/session')).status).toBe(200);
});
