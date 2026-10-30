import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import * as addressSource from '../_lib/address-source.js';
import { MongoClient } from 'mongodb';
import { createMongoOfficialFormsHandler } from '../_lib/official-forms.mongo.js';
import type { authorizeAfHomes } from '../_lib/afhomes-access.js';
import type { VercelRequest } from '../_lib/http.js';
import { makeRes } from '../_lib/testing/supabase-fake.js';
import {
  MODULE_CATALOG,
  istPortalReportSchema,
  saleTeamLookupSchema,
  DEFAULT_ROLE_BASELINE,
  customerApplicationSchema,
  purchaseTermsProposalSchema,
  purchaseReservationSchema,
  reservationFinanceSummarySchema,
  activationResultSchema,
  purchaseDocumentEvidenceSchema,
  reservationAgreementListItemSchema,
  customerApplicationListItemSchema,
} from '@afhomes/contracts';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { installTestCoreValidators } from '../_lib/testing/core-validators.js';
import { seedPhase5Fixture } from '../_lib/testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from '../_lib/mongo-runtime.js';
import { createAfHomesAdminAuth } from '../_lib/auth.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  seller = '',
  finance = '';
let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;
let applicationId = '',
  reservationId = '',
  saleId = '',
  membershipId = '',
  customerId = '';
const col = (name: string) => test.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown, cookie = seller, method?: string) {
  return fetch(base + '/api/v1' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response: Response, status = 200) {
  const body = await response.json();
  expect({ status: response.status, body }).toMatchObject({ status });
  return body;
}
const jar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((row) => row.split(';')[0])
    .join('; ');
beforeAll(async () => {
  test = await createTestReplica({ timeoutMS: 15000 });
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'purchase-native-synthetic-only-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_WEB_URL: base,
  };
  fixture = await seedPhase5Fixture(test.db, test.client, env);
  const assignment = await col('staff_role_assignments').findOne({ staff_id: fixture.staff.id });
  for (const descriptor of MODULE_CATALOG)
    if (!(await col('modules').findOne({ key: descriptor.key })))
      await col('modules').insertOne({ _id: randomUUID(), key: descriptor.key, is_active: true });
  await col('role_permissions').deleteMany({ role_id: assignment!.role_id });
  async function grants(roleId: string, slug: 'sales_manager' | 'finance') {
    for (const grant of DEFAULT_ROLE_BASELINE[slug]) {
      const module = await col('modules').findOne({ key: grant.moduleKey });
      await col('role_permissions').insertOne({
        _id: randomUUID(),
        role_id: roleId,
        module_id: module!._id,
        can_view: grant.canView,
        can_create: grant.canCreate,
        can_update: grant.canUpdate,
        can_delete: grant.canDelete,
      });
    }
  }
  await grants(String(assignment!.role_id), 'sales_manager');
  const financeRole = randomUUID(),
    internal = createAfHomesAdminAuth(test.db, test.client, env);
  const identity = await internal.api.createUser({
    body: {
      email: 'purchase-finance@example.invalid',
      name: 'Synthetic Finance',
      password: 'TemporaryFinance123!',
      data: { emailVerified: true },
    },
  });
  await col('roles').insertOne({
    _id: financeRole,
    slug: 'finance',
    name: 'Finance',
    is_active: true,
  });
  await col('staff_users').insertOne({
    _id: identity.user.id,
    email: identity.user.email,
    full_name: 'Synthetic Finance',
    status: 'active',
    must_change_password: true,
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: identity.user.id,
    role_id: financeRole,
  });
  await grants(financeRole, 'finance');
  let head = '';
  for (const slug of ['vice_director', 'senior_sales_manager']) {
    const id = randomUUID(),
      roleId = randomUUID();
    await col('roles').insertOne({ _id: roleId, slug, name: slug, is_active: true });
    await col('staff_users').insertOne({
      _id: id,
      email: `${id}@example.invalid`,
      full_name: 'Synthetic Head',
      status: 'active',
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: roleId,
    });
    if (head)
      await col('referral_relationships').insertOne({
        _id: randomUUID(),
        subject_staff_id: id,
        upline_staff_id: head,
        is_active: true,
        is_authoritative: true,
        hierarchy_role: slug,
      });
    head = id;
  }
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: fixture.staff.id,
    upline_staff_id: head,
    is_active: true,
    is_authoritative: true,
    hierarchy_role: 'sales_manager',
  });
  await col('card_plans').updateOne(
    { _id: fixture.plan },
    {
      $set: {
        reservation_fee: '10000.00',
        cash_price: '100000.03',
        minimum_down_payment: '10000.00',
        validity_years: 1,
        spot_cash_days: 7,
        discount_percent: 0,
        annual_points_tranches: 1,
        cardholder_limit: 1,
        priority_reservation: true,
        no_monthly_annual_dues: true,
        total_loyalty_value: '100000.00',
      },
    },
  );
  await col('commission_rules').insertOne({
    _id: randomUUID(),
    target_type: 'staff',
    target_id: fixture.staff.id,
    rate: '0.03',
    is_active: true,
    effective_from: '2000-01-01',
    effective_until: null,
    accredited_on_or_after: null,
  });
  await installTestCoreValidators(test.db);
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  seller = jar(login);
  await json(
    await request('/admin/afhomes/session/password', {
      currentPassword: fixture.staff.password,
      newPassword: 'SyntheticSellerNew123!',
      confirmPassword: 'SyntheticSellerNew123!',
    }),
  );
  const signed = await request(
    '/auth/identity/sign-in/email',
    { email: identity.user.email, password: 'TemporaryFinance123!' },
    '',
  );
  expect(signed.status).toBe(200);
  finance = jar(signed);
  await json(
    await request(
      '/admin/afhomes/session/password',
      {
        currentPassword: 'TemporaryFinance123!',
        newPassword: 'SyntheticFinanceNew123!',
        confirmPassword: 'SyntheticFinanceNew123!',
      },
      finance,
    ),
  );
}, 120000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await test?.stop();
});
it('executes a native purchase over HTTP with frozen economics, automatic approval reservation and VIP activation', async () => {
  const customer = await json(
    await request('/customers', {
      firstName: 'Synthetic',
      lastName: 'Buyer',
      dateOfBirth: '1990-01-15',
      email: 'purchase-buyer@example.invalid',
      phone: '09185551234',
      address: { line1: 'Synthetic Street', city: 'Quezon City', province: 'Metro Manila' },
    }),
    201,
  );
  customerId = customer.id;
  const lookupModule = await col('modules').findOne({ key: 'operations.customer_lookup' });
  const financeStaff = await col('staff_users').findOne({ email: 'purchase-finance@example.invalid' });
  const financeAssignment = await col('staff_role_assignments').findOne({ staff_id: financeStaff!._id });
  await col('role_permissions').updateOne({ role_id: financeAssignment!.role_id, module_id: lookupModule!._id }, {
    $set: { can_view: true, can_create: false, can_update: false, can_delete: false },
    $setOnInsert: { _id: randomUUID() },
  }, { upsert: true });
  const beforeActivation = await json(await request('/memberships/customer-lookup?search=purchase-buyer', undefined, finance));
  expect(beforeActivation.data).toEqual([]);
  const primary = {
    holderType: 'PRIMARY',
    firstName: 'Synthetic',
    lastName: 'Buyer',
    birthDate: '1990-01-15',
    permanentAddressLine1: 'Synthetic Street',
    cityMunicipality: 'Quezon City',
    province: 'Metro Manila',
    mobile: '09185551234',
    email: 'purchase-buyer@example.invalid',
    printedName: 'Synthetic Buyer',
  };
  const created = await json(
    await request('/official-forms/customer-applications', {
      requestId: randomUUID(),
      customerId,
      planId: fixture.plan,
      tier: 'BRONZE',
      paymentScheme: 'spot_cash',
      primary,
      acquisitionChannels: ['Walk-In'],
      consentAcknowledged: true,
      acknowledgedAt: '2026-10-01',
      primarySignatureStatus: 'received',
      validIdReceived: true,
      reservationPaymentProofReceived: true,
    }),
    201,
  );
  applicationId = customerApplicationSchema.parse(created).id;
  expect(created.vipAmount).toBe('100000.03');
  expect(created.yearlyPoints).toBe(25000);
  const proposal = purchaseTermsProposalSchema.parse(
    await json(
      await request(
        `/official-forms/customer-applications/${applicationId}/purchase-terms/proposal`,
      ),
    ),
  );
  expect(proposal.terms).toMatchObject({
    totalPrice: '100000.03',
    commissionRate: '0.03',
    expectedCommission: '3000.00',
  });
  const submit = { requestId: randomUUID(), expectedProposalHash: proposal.expectedProposalHash };
  await json(
    await request(`/official-forms/customer-applications/${applicationId}/submit`, submit),
  );
  await json(
    await request(`/official-forms/customer-applications/${applicationId}/submit`, submit),
  );
  const termsBefore = await col('customer_application_purchase_terms').findOne({
    application_id: applicationId,
  });
  const approve = { requestId: randomUUID(), decision: 'approved' };
  await json(
    await request(`/official-forms/customer-applications/${applicationId}/decision`, approve),
  );
  await json(
    await request(`/official-forms/customer-applications/${applicationId}/decision`, approve),
  );
  const reservation = await col('reservation_agreements').findOne({
    customer_application_id: applicationId,
  });
  expect(reservation).toMatchObject({ status: 'executed' });
  reservationId = reservation!._id;
  const listedReservations = await json(await request(`/official-forms/reservations?application=${applicationId}`));
  expect(reservationAgreementListItemSchema.parse(listedReservations.data[0])).toMatchObject({id:reservationId,status:'executed'});
  const listedApplications = await json(await request('/official-forms/customer-applications'));
  expect(listedApplications.data.map((item:unknown)=>customerApplicationListItemSchema.parse(item).id)).toContain(applicationId);
  const agreement = purchaseReservationSchema.parse(
    await json(await request(`/official-forms/reservations/${reservationId}`)),
  );
  expect(agreement.totalPrice).toBe('100000.03');
  let summary = reservationFinanceSummarySchema.parse(
    await json(
      await request(`/official-forms/reservations/${reservationId}/finance`, undefined, finance),
    ),
  );
  expect(summary).toMatchObject({
    recordedPaymentCount: 1,
    verifiedTotal: '0.00',
    remainingBalance: '100000.03',
  });
  const deposit = await col('payments').findOne({ reservation_id: reservationId });
  expect(deposit).toMatchObject({ amount: '10000.00', status: 'recorded' });
  await json(
    await request(
      `/official-forms/reservations/${reservationId}/payments/${deposit!._id}/verify`,
      { requestId: randomUUID(), decision: 'verified' },
      finance,
    ),
  );
  expect(
    (
      await request(
        `/official-forms/reservations/${reservationId}/finalize`,
        { requestId: randomUUID() },
        finance,
      )
    ).status,
  ).toBe(409);
  const payment = await json(
    await request(
      `/official-forms/reservations/${reservationId}/payments`,
      { requestId: randomUUID(), amount: '90000.03', paymentType: 'installment', method: 'cash' },
      finance,
    ),
    201,
  );
  const paymentId =
    payment.id ??
    payment.payments?.find((row: { amount: string }) => row.amount === '90000.03')?.id;
  expect(paymentId).toBeTruthy();
  await json(
    await request(
      `/official-forms/reservations/${reservationId}/payments/${paymentId}/verify`,
      { requestId: randomUUID(), decision: 'verified' },
      finance,
    ),
  );
  await col('card_plans').updateOne({ _id: fixture.plan }, { $set: { cash_price: '999999.00' } });
  await col('commission_rules').updateMany(
    { target_id: fixture.staff.id },
    { $set: { rate: '0.99' } },
  );
  const finalizations = await Promise.all([
    request(
      `/official-forms/reservations/${reservationId}/finalize`,
      { requestId: randomUUID() },
      finance,
    ),
    request(
      `/official-forms/reservations/${reservationId}/finalize`,
      { requestId: randomUUID() },
      finance,
    ),
  ]);
  const results = await Promise.all(finalizations.map((row) => json(row)));
  expect(new Set(results.map((row) => row.saleId))).toHaveProperty('size', 1);
  saleId = results[0].saleId;
  expect(await col('commissions').findOne({ sale_id: saleId })).toMatchObject({
    status: 'payment_verified',
    amount: '3000.00',
    rate_snapshot: '0.03',
  });
  expect(await col('card_sale_hierarchy_snapshots').countDocuments({ sale_id: saleId })).toBe(3);
  expect(
    await col('customer_application_purchase_terms').findOne({ _id: termsBefore!._id }),
  ).toEqual(termsBefore);
  const activated = activationResultSchema.parse(
    await json(await request(`/sales/${saleId}/activate`, {}, finance)),
  );
  membershipId = activated.membershipId;
  const lookup = await json(await request('/memberships/customer-lookup?search=purchase-buyer', undefined, finance));
  expect(lookup.data).toHaveLength(1);
  expect(lookup.data[0]).toMatchObject({ firstName: 'Synthetic', lastName: 'Buyer', vipTier: 'BRONZE' });
  const lookupCustomer = await col('customers').findOne({ _id: customerId });
  expect(lookup.data[0].vipCardNumber).toBe(lookupCustomer!.vip_card_number ?? null);
  expect(lookup.data[0].raNumber).toBeTruthy();
  expect(JSON.stringify(lookup.data)).not.toContain('government_id_number');
  await json(await request('/memberships/customer-lookup?search=purchase-buyer', undefined, ''), 401);
  expect(activated.pointsAllocated).toBe(0);
  expect(await col('commissions').findOne({ sale_id: saleId })).toHaveProperty(
    'status',
    'final_qualification_pending',
  );
  summary = reservationFinanceSummarySchema.parse(
    await json(
      await request(`/official-forms/reservations/${reservationId}/finance`, undefined, finance),
    ),
  );
  expect(summary).toMatchObject({
    verifiedTotal: '100000.03',
    remainingBalance: '0.00',
    saleId,
    membership: { id: membershipId },
  });
  const issued = await json(await request(`/customers/${customerId}/onboarding-token`, {}), 201);
  const token = new URLSearchParams(new URL(issued.activationUrl).hash.slice(1)).get('token');
  const password = 'SyntheticVipChosen123!';
  await json(
    await request(
      '/auth/customer/activate',
      { onboardingToken: token, password, passwordConfirmation: password },
      '',
    ),
    201,
  );
  const vip = await request(
    '/auth/identity/sign-in/email',
    { email: 'purchase-buyer@example.invalid', password },
    '',
  );
  expect(vip.status).toBe(200);
  await json(await request('/customer', undefined, jar(vip)));
}, 120000);

async function applicationFor(email: string, location: Record<string, string> = {}) {
  await col('card_plans').updateOne({ _id: fixture.plan }, { $set: { cash_price: '100000.03' } });
  const customer = await json(
    await request('/customers', {
      firstName: 'Synthetic',
      lastName: 'Buyer',
      dateOfBirth: '1990-01-15',
      email,
      phone: '09185551234',
      address: { line1: 'Synthetic Street', city: 'Quezon City', province: 'Metro Manila' },
    }),
    201,
  );
  const body = {
    requestId: randomUUID(),
    customerId: customer.id,
    planId: fixture.plan,
    tier: 'BRONZE',
    paymentScheme: 'spot_cash',
    primary: {
      holderType: 'PRIMARY',
      firstName: 'Synthetic',
      lastName: 'Buyer',
      birthDate: '1990-01-15',
      permanentAddressLine1: 'Synthetic Street',
      cityMunicipality: 'Quezon City',
      province: 'Metro Manila',
      mobile: '09185551234',
      email,
      printedName: 'Synthetic Buyer',
      ...location,
    },
    acquisitionChannels: ['Walk-In'],
    consentAcknowledged: true,
    acknowledgedAt: '2026-10-01',
    primarySignatureStatus: 'received',
    validIdReceived: true,
    reservationPaymentProofReceived: true,
  };
  const app = await json(await request('/official-forms/customer-applications', body), 201);
  const proposal = await json(
    await request(`/official-forms/customer-applications/${app.id}/purchase-terms/proposal`),
  );
  await json(
    await request(`/official-forms/customer-applications/${app.id}/submit`, {
      requestId: randomUUID(),
      expectedProposalHash: proposal.expectedProposalHash,
    }),
  );
  return { id: String(app.id), customerId: String(customer.id), body };
}

it('submits verified Nagtipunan geography and persists the reference ZIP instead of a supplied value', async () => {
  const provider = vi.spyOn(addressSource, 'addressProvider').mockReturnValue({
    name: 'synthetic-nagtipunan',
    provinces: async () => [{ code: '0205700000', name: 'Quirino' }],
    localities: async () => [
      {
        code: '0205706000',
        name: 'Nagtipunan',
        type: 'municipality',
        provinceCode: '0205700000',
        postalCode: '',
      },
    ],
    barangays: async () => [{ code: '0205706001', name: 'Anak', localityCode: '0205706000' }],
  });
  try {
    const created = await applicationFor('synthetic-nagtipunan@example.invalid', {
      province: 'Quirino',
      cityMunicipality: 'Nagtipunan',
      barangay: 'Anak',
      provinceCode: '0205700000',
      cityMunicipalityCode: '0205706000',
      barangayCode: '0205706001',
      postalCode: '9999',
    });
    const holder = await col('customer_application_holders').findOne({
      application_id: created.id,
      holder_type: 'PRIMARY',
    });
    expect(holder).toMatchObject({
      province: 'Quirino',
      city_municipality: 'Nagtipunan',
      barangay: 'Anak',
      postal_code: '3405',
    });
    expect(
      (await json(await request(`/official-forms/customer-applications/${created.id}`))).primary
        .postalCode,
    ).toBe('3405');
  } finally {
    provider.mockRestore();
  }
}, 15000);

it('approves atomically beyond the ordinary client deadline and replays without duplicate reservations or deposits', async () => {
  const app = await applicationFor('synthetic-approval-deadline@example.invalid');
  const host = test.client.options.hosts[0]!.toString();
  const client = new MongoClient(
    `mongodb://${host}/?replicaSet=${test.client.options.replicaSet}`,
    { timeoutMS: 200 },
  );
  let calls = 0;
  const authorize: typeof authorizeAfHomes = async () => {
    if (++calls === 2) await new Promise((resolve) => setTimeout(resolve, 350));
    return {
      userId: fixture.staff.id,
      email: fixture.staff.email,
      fullName: 'Synthetic Approver',
      status: 'active',
      roleId: randomUUID(),
      roleSlug: 'super_admin',
      roleName: 'Super Admin',
      mustChangePassword: false,
      permissions: [],
    };
  };
  try {
    await client.connect();
    const handler = createMongoOfficialFormsHandler(client.db('afhomes_dev'), client, authorize);
    const input = {
      method: 'POST',
      query: { familyPath: `customer-applications/${app.id}/decision` },
      headers: {},
      body: { requestId: randomUUID(), decision: 'approved' },
    } as VercelRequest;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = makeRes();
      await handler(input, result.res);
      expect(result.state.status, JSON.stringify(result.state.body)).toBe(200);
    }
    expect((await col('customer_applications').findOne({ _id: app.id }))?.status).toBe('approved');
    expect(
      await col('reservation_agreements').countDocuments({ customer_application_id: app.id }),
    ).toBe(1);
    const reservation = await col('reservation_agreements').findOne({
      customer_application_id: app.id,
    });
    expect(reservation?.status).toBe('executed');
    expect(await col('payments').countDocuments({ reservation_id: reservation!._id })).toBe(1);
    expect(await col('payments').findOne({ reservation_id: reservation!._id })).toMatchObject({
      amount: '10000.00',
      status: 'recorded',
    });
  } finally {
    await client.close();
  }
}, 15000);
it('denies unauthenticated and wrong-role Finance mutations before changing persisted money', async () => {
  const before = await col('payments').countDocuments();
  expect(
    (
      await request(
        `/official-forms/reservations/${reservationId}/payments`,
        { requestId: randomUUID(), amount: '1.00', paymentType: 'installment', method: 'cash' },
        seller,
      )
    ).status,
  ).toBe(403);
  expect(
    (await request(`/official-forms/reservations/${reservationId}/finance`, undefined, '')).status,
  ).toBe(401);
  expect(
    (
      await request(
        `/official-forms/customer-applications/${applicationId}/submit`,
        { requestId: randomUUID(), expectedProposalHash: '0'.repeat(64) },
        finance,
      )
    ).status,
  ).toBe(403);
  expect(await col('payments').countDocuments()).toBe(before);
});
it('rolls back automatic reservation, recorded deposit, evidence and decision when approval auditing fails', async () => {
  const app = await applicationFor('approval-rollback@example.invalid');
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_APPLICATION_APPROVED' } },
    validationLevel: 'strict',
  });
  const decision = { requestId: randomUUID(), decision: 'approved' };
  try {
    expect(
      (await request(`/official-forms/customer-applications/${app.id}/decision`, decision)).status,
    ).toBe(503);
    expect(await col('customer_applications').findOne({ _id: app.id })).toHaveProperty(
      'status',
      'submitted',
    );
    expect(
      await col('reservation_agreements').countDocuments({ customer_application_id: app.id }),
    ).toBe(0);
    expect(await col('payments').countDocuments({ customer_id: app.customerId })).toBe(0);
    expect(await col('mutation_requests').countDocuments({ request_id: decision.requestId })).toBe(
      0,
    );
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {}, validationLevel: 'off' });
  }
  await json(await request(`/official-forms/customer-applications/${app.id}/decision`, decision));
  const reservation = await col('reservation_agreements').findOne({
    customer_application_id: app.id,
  });
  expect(reservation).toHaveProperty('status', 'executed');
  const original = await col('purchase_document_evidence').findOne({
    kind: 'reservation',
    source_id: reservation!._id,
    revision: 1,
  });
  const edit = { requestId: randomUUID(), revisionNumber: 'SYNTHETIC-REVISION', scheduleNotes: [] };
  await json(
    await request(`/official-forms/reservations/${reservation!._id}`, edit, seller, 'PATCH'),
  );
  await json(
    await request(`/official-forms/reservations/${reservation!._id}`, edit, seller, 'PATCH'),
  );
  expect(await col('purchase_document_evidence').findOne({ _id: original!._id })).toEqual(original);
  expect(
    await col('purchase_document_evidence').countDocuments({
      kind: 'reservation',
      source_id: reservation!._id,
    }),
  ).toBe(4);
});
it('records concurrent retries once and rolls verification back when immutable evidence cannot be captured', async () => {
  const app = await applicationFor('payment-rollback@example.invalid');
  await json(
    await request(`/official-forms/customer-applications/${app.id}/decision`, {
      requestId: randomUUID(),
      decision: 'approved',
    }),
  );
  const reservation = await col('reservation_agreements').findOne({
    customer_application_id: app.id,
  });
  const id = reservation!._id;
  const input = {
    requestId: randomUUID(),
    amount: '0.03',
    paymentType: 'installment',
    method: 'cash',
    reference: 'SYNTHETIC-CENTS',
  };
  const responses = await Promise.all([
    request(`/official-forms/reservations/${id}/payments`, input, finance),
    request(`/official-forms/reservations/${id}/payments`, input, finance),
  ]);
  for (const response of responses) await json(response, 201);
  expect(
    await col('payments').countDocuments({ reservation_id: id, reference: input.reference }),
  ).toBe(1);
  expect(
    (
      await request(
        `/official-forms/reservations/${id}/payments`,
        { ...input, amount: '0.04' },
        finance,
      )
    ).status,
  ).toBe(409);
  const payment = await col('payments').findOne({ reservation_id: id, reference: input.reference });
  const verify = { requestId: randomUUID(), decision: 'verified' };
  await test.db.command({
    collMod: 'purchase_document_evidence',
    validator: { kind: { $ne: 'payment_verified' } },
    validationLevel: 'strict',
  });
  try {
    expect(
      (
        await request(
          `/official-forms/reservations/${id}/payments/${payment!._id}/verify`,
          verify,
          finance,
        )
      ).status,
    ).toBe(503);
    expect(await col('payments').findOne({ _id: payment!._id })).toHaveProperty(
      'status',
      'recorded',
    );
    expect(await col('reservation_agreements').findOne({ _id: id })).not.toHaveProperty(
      'spot_cash_started_at',
    );
    expect(
      await col('audit_events').countDocuments({
        entity_id: payment!._id,
        action: 'PAYMENT_VERIFIED',
      }),
    ).toBe(0);
    expect(await col('mutation_requests').countDocuments({ request_id: verify.requestId })).toBe(0);
  } finally {
    await test.db.command({
      collMod: 'purchase_document_evidence',
      validator: {},
      validationLevel: 'off',
    });
  }
  await json(
    await request(
      `/official-forms/reservations/${id}/payments/${payment!._id}/verify`,
      verify,
      finance,
    ),
  );
  await json(
    await request(
      `/official-forms/reservations/${id}/payments/${payment!._id}/verify`,
      verify,
      finance,
    ),
  );
  expect(
    await col('audit_events').countDocuments({
      entity_id: payment!._id,
      action: 'PAYMENT_VERIFIED',
    }),
  ).toBe(1);
  expect(
    await json(await request(`/official-forms/reservations/${id}/finance`, undefined, finance)),
  ).toMatchObject({ verifiedTotal: '0.03', remainingBalance: '100000.00' });
});
it('validates all five immutable evidence contracts and renders authorized historical PDF documents', async () => {
  const sources: Record<string, string> = {
    reservation: reservationId,
    purchase_finalized: saleId,
    membership_activated: membershipId,
  };
  const payment = await col('payments').findOne({
    reservation_id: reservationId,
    status: 'verified',
  });
  sources.payment_recorded = payment!._id;
  sources.payment_verified = payment!._id;
  for (const [kind, id] of Object.entries(sources)) {
    const evidence = await col('purchase_document_evidence').findOne(
      { kind, source_id: id },
      { sort: { revision: -1 } },
    );
    expect(evidence).toBeTruthy();
    purchaseDocumentEvidenceSchema.parse({
      id: evidence!._id,
      kind,
      sourceId: id,
      revision: evidence!.revision,
      schemaVersion: evidence!.schema_version,
      actorId: evidence!.actor_id,
      capturedAt: evidence!.captured_at,
      fields: evidence!.fields,
    });
    expect(JSON.stringify(evidence!.fields)).not.toMatch(
      /password|government_id|qr_token|fallback_code|storage_path/i,
    );
    const file = await json(
      await request(
        `/official-forms/reservations/${id}/documents/${kind}/latest`,
        undefined,
        kind === 'reservation' ? seller : finance,
      ),
    );
    expect(file.mime).toBe('application/pdf');
    expect(Buffer.from(file.content, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(Buffer.from(file.content, 'base64').toString()).toContain('100000.03');
    expect(Buffer.from(file.content, 'base64').toString()).not.toContain(
      'No immutable document evidence',
    );
  }
  expect(
    (
      await request(
        `/official-forms/reservations/${saleId}/documents/purchase_finalized/latest`,
        undefined,
        seller,
      )
    ).status,
  ).toBe(403);
});
it('preserves the legacy sale-origin draft, update, submit, reopen and execute workflow without signature gates', async () => {
  const body = {
    origin: 'sale',
    requestId: randomUUID(),
    saleId,
    reservationDate: '2026-10-26',
    agreementDate: '2026-10-26',
    primary: {
      holderType: 'PRIMARY',
      name: 'Synthetic Buyer',
      address: 'Synthetic Street, Quezon City',
      contactNumber: '09185551234',
      email: 'purchase-buyer@example.invalid',
    },
    scheduleNotes: [],
  };
  const created = purchaseReservationSchema.parse(
    await json(await request('/official-forms/reservations', body), 201),
  );
  expect(created).toMatchObject({
    origin: 'sale',
    saleId,
    totalPrice: '100000.03',
    totalPaymentReceived: '100000.03',
    balance: '0.00',
  });
  const id = created.id;
  const edited = purchaseReservationSchema.parse(
    await json(
      await request(
        `/official-forms/reservations/${id}`,
        { ...body, revisionNumber: 'LEGACY-REVISION' },
        seller,
        'PATCH',
      ),
    ),
  );
  expect(edited.revisionNumber).toBe('LEGACY-REVISION');
  expect(edited.totalPrice).toBe(created.totalPrice);
  await json(
    await request(`/official-forms/reservations/${id}/submit`, { requestId: randomUUID() }),
  );
  await json(
    await request(`/official-forms/reservations/${id}/reopen`, { requestId: randomUUID() }),
  );
  await json(
    await request(`/official-forms/reservations/${id}/submit`, { requestId: randomUUID() }),
  );
  const executed = await json(
    await request(`/official-forms/reservations/${id}/decision`, {
      requestId: randomUUID(),
      decision: 'executed',
    }),
  );
  expect(executed.status).toBe('executed');
  expect((await request(`/official-forms/reservations/${id}`, body, seller, 'PATCH')).status).toBe(
    409,
  );
  expect(
    (
      await request(`/official-forms/reservations/${id}/decision`, {
        requestId: randomUUID(),
        decision: 'cancelled',
      })
    ).status,
  ).toBe(409);
});

it('registers one prospect on retries, preserves catalog snapshots and mirrors company data without exposing government IDs', async () => {
  const body = {
    registerNewCustomer: true,
    requestId: randomUUID(),
    planId: fixture.plan,
    tier: 'BRONZE',
    paymentScheme: 'spot_cash',
    primary: {
      holderType: 'PRIMARY',
      firstName: 'Synthetic',
      lastName: 'Registration',
      birthDate: '1990-01-15',
      permanentAddressLine1: 'Synthetic Street',
      cityMunicipality: 'Quezon City',
      province: 'Metro Manila',
      mobile: '09185551234',
      email: 'native-registration@example.invalid',
      printedName: 'Synthetic Registration',
      citizenship: 'Filipino',
      civilStatus: 'Single',
      tinNumber: '123-456-789',
    },
    acquisitionChannels: ['Walk-In'],
    consentAcknowledged: false,
    acknowledgedAt: '2026-10-26',
    primarySignatureStatus: 'pending',
    statedTotalAmount: '1.00',
    validIdReceived: false,
    reservationPaymentProofReceived: false,
    statedVipPackage: 'COMPANY STATED',
    governmentIdNumber: 'SYNTHETIC-GOVERNMENT-ID',
  };
  const first = customerApplicationSchema.parse(
    await json(await request('/official-forms/customer-applications', body), 201),
  );
  const second = await json(await request('/official-forms/customer-applications', body), 201);
  expect(second.id).toBe(first.id);
  expect(await col('customers').countDocuments({ email: body.primary.email })).toBe(1);
  const customer = await col('customers').findOne({ _id: first.customerId });
  expect(customer?.vip_card_number).toMatch(/^\d{11}B1C01S$/);
  expect(customer).toMatchObject({
    status: 'prospect',
    citizenship: 'Filipino',
    civil_status: 'Single',
    tin_number: '123-456-789',
    stated_total_amount: '1.00',
    government_id_number: 'SYNTHETIC-GOVERNMENT-ID',
  });
  expect(customer!.customer_number).toMatch(/^AF-CUS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  expect(customer!.customer_code).toMatch(/^AF-CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  expect(customer!.ra_number).toMatch(/^\d{4}-\d{4,}$/);
  expect(first.vipAmount).toBe('100000.03');
  expect(JSON.stringify(await json(await request('/customers/' + first.customerId)))).not.toContain(
    'SYNTHETIC-GOVERNMENT-ID',
  );
  expect(
    (await request('/official-forms/customer-applications', { ...body, statedTotalAmount: '2.00' }))
      .status,
  ).toBe(409);
  const proposal = purchaseTermsProposalSchema.parse(
    await json(
      await request(`/official-forms/customer-applications/${first.id}/purchase-terms/proposal`),
    ),
  );
  expect(
    (
      await request(`/official-forms/customer-applications/${first.id}/submit`, {
        requestId: randomUUID(),
        expectedProposalHash: proposal.expectedProposalHash,
      })
    ).status,
  ).toBe(409);
  expect((await col('customer_applications').findOne({ _id: first.id }))!.status).toBe('draft');
  expect(
    await col('customer_application_purchase_terms').countDocuments({ application_id: first.id }),
  ).toBe(0);
});

it('serves the IST dashboard with module denials and frozen team attribution plus current membership scope', async () => {
  const url = '/ist-portal?from=2000-01-01&to=2100-01-01';
  expect((await request(url, undefined, '')).status).toBe(401);
  expect((await request(url, undefined, finance)).status).toBe(403);
  const initial = istPortalReportSchema.parse(await json(await request(url)));
  expect(initial.personal).toMatchObject({
    salesCount: 2,
    salesAmount: '200000.03',
    toEarn: '3000.00',
  });
  expect(initial.team.salesCount).toBe(0);
  const ostId = randomUUID(),
    roleId = randomUUID(),
    edgeId = randomUUID(),
    teamSaleId = randomUUID();
  await col('roles').insertOne({ _id: roleId, slug: 'ost', name: 'OST', is_active: true });
  await col('staff_users').insertOne({
    _id: ostId,
    full_name: 'SYNTHETIC DOWNLINE',
    status: 'active',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: ostId,
    role_id: roleId,
  });
  await col('ost_members').insertOne({ _id: ostId, status: 'active' });
  await col('referral_relationships').insertOne({
    _id: edgeId,
    subject_staff_id: ostId,
    upline_staff_id: fixture.staff.id,
    is_active: true,
    is_authoritative: true,
  });
  const original = await col('card_sales').findOne({ _id: saleId });
  await col('card_sales').insertOne({
    ...original!,
    _id: teamSaleId,
    sale_number: 'SYNTHETIC-TEAM-SALE',
    seller_staff_id: null,
    seller_ost_id: ostId,
    cash_price_snapshot: '0.03',
  });
  expect((await json(await request(url))).team.salesCount).toBe(0);
  await col('card_sale_hierarchy_snapshots').insertOne({
    _id: randomUUID(),
    sale_id: teamSaleId,
    ancestor_staff_id: fixture.staff.id,
    hierarchy_role: 'sales_manager',
    depth: 2,
  });
  const scoped = istPortalReportSchema.parse(await json(await request(url + '&view=team-sales')));
  expect(scoped.team).toMatchObject({
    total: 1,
    salesCount: 1,
    salesAmount: '0.03',
    withSales: 1,
    withoutSales: 0,
  });
  expect(scoped.sales.map((row) => row.id)).toEqual([teamSaleId]);
  expect(scoped.sales[0]!.customerName).toBe('Synthetic Buyer');
  const module = await col('modules').findOne({ key: 'sales.card_sales' });
  const assignment = await col('staff_role_assignments').findOne({ staff_id: fixture.staff.id });
  await col('role_permissions').updateOne(
    { role_id: assignment!.role_id, module_id: module!._id },
    { $set: { can_view: false } },
  );
  const denied = istPortalReportSchema.parse(await json(await request(url)));
  expect(denied.personal.salesAmount).toBeNull();
  expect((await request(url + '&view=team-sales')).status).toBe(403);
  await col('role_permissions').updateOne(
    { role_id: assignment!.role_id, module_id: module!._id },
    { $set: { can_view: true } },
  );
  await col('referral_relationships').updateOne({ _id: edgeId }, { $set: { is_active: false } });
  const otherManager = randomUUID();
  await col('staff_users').insertOne({
    _id: otherManager,
    email: 'synthetic-other-manager@example.invalid',
    full_name: 'SYNTHETIC OTHER MANAGER',
    status: 'active',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: otherManager,
    role_id: assignment!.role_id,
  });
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: ostId,
    upline_staff_id: otherManager,
    is_active: true,
    is_authoritative: true,
  });
  expect((await json(await request(url))).team.salesCount).toBe(0);
  expect(await col('card_sale_hierarchy_snapshots').countDocuments({ sale_id: teamSaleId })).toBe(
    1,
  );
});

it('reads only the signed-in accreditation identity, including enrollment-safe null and revoked states', async () => {
  expect((await request('/sale-team/me', undefined, '')).status).toBe(401);
  expect(await json(await request('/sale-team/me'))).toBeNull();
  await col('sale_team_accreditations').insertOne({
    _id: randomUUID(),
    staff_id: randomUUID(),
    aa_number: 'AAI26100002',
    kind: 'IST',
    public_name: 'ANOTHER PRIVATE IDENTITY',
    status: 'active',
  });
  expect(await json(await request('/sale-team/me'))).toBeNull();
  const identityId = randomUUID();
  await col('sale_team_accreditations').insertOne({
    _id: identityId,
    staff_id: fixture.staff.id,
    aa_number: 'AAI26100001',
    kind: 'IST',
    public_name: 'SYNTHETIC SALES MANAGER',
    status: 'active',
  });
  const own = saleTeamLookupSchema.parse(await json(await request('/sale-team/me')));
  expect(own).toMatchObject({
    aaNumber: 'AAI26100001',
    kind: 'IST',
    status: 'accredited',
    startsOn: null,
    expiresOn: null,
    photoUrl: null,
  });
  expect(JSON.stringify(own)).not.toContain(fixture.staff.id);
  await col('sale_team_accreditations').updateOne(
    { _id: identityId },
    { $set: { status: 'revoked' } },
  );
  expect((await json(await request('/sale-team/me'))).status).toBe('revoked');
  expect((await request('/sale-team/search?aaNumber=AAI26100002', undefined, '')).status).toBe(401);
});
