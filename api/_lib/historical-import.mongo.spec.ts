import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { purchasePaymentSchema, type WorkbookPaymentClaim } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { externalImportSummary } from './external-customer-import.js';
import { buildImportedCustomerFacts } from './customer-import-continuation.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { setupMongoHistoricalImports } from './historical-import.mongo.js';

let replica: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let server: http.Server,
  base = '',
  cookie = '';
const col = (name: string) => replica.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown) {
  const response = await fetch(base + '/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-historical-only'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticHistorical123!');
  await col('commission_rules').insertOne({
    _id: randomUUID(),
    target_type: 'staff',
    target_id: fixture.ost.id,
    rate: '0.10',
    is_active: true,
    effective_from: '2020-01-01',
    effective_until: null,
    accredited_on_or_after: null,
  });
  server.on('request', createMongoPhase5Runtime(replica.db, replica.client, env));
  const response = await fetch(base + '/api/v1/auth/identity/sign-in/email', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.admin.email, password: 'SyntheticHistorical123!' }),
  });
  expect(response.status).toBe(200);
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(
    await request('admin/afhomes/session/password', {
      currentPassword: 'SyntheticHistorical123!',
      newPassword: 'SyntheticHistoryReady123!',
      confirmPassword: 'SyntheticHistoryReady123!',
    }),
  ).toMatchObject({ status: 200 });
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await replica?.stop();
});

async function reviewed(
  status: string,
  amount: string | null = null,
  extra: Record<string, string> = {},
) {
  const id = randomUUID(),
    job = randomUUID(),
    email = `${id}@example.invalid`;
  const raw = {
    workbook_format: 'company_v2',
    customer_key: email,
    purchase_reference: `Synthetic ${id}`,
    first_name: 'Synthetic',
    last_name: 'Historical',
    email,
    mobile: '09123456789',
    birth_date: '1990-01-01',
    address_line_1: 'Synthetic Street',
    city: 'Quezon City',
    province: 'Metro Manila',
    vip_tier: 'BRONZE',
    stated_payment_scheme_code: 'spot_cash',
    stated_total: '100000.00',
    stated_rf: '10000.00',
    stated_status: status,
    contract_date: '2024-01-01',
    referrer_name: 'SYNTHETIC OST MEMBER',
    referrer_staff_id: fixture.ost.id,
    existing_card_activation_date: '2024-01-02',
    existing_card_valid_until: status === 'Expired' ? '2025-01-02' : '2046-01-02',
    existing_stay_points_total: '101',
    existing_vip_control_number: '',
    ...extra,
  };
  const claims: WorkbookPaymentClaim[] = amount
    ? [
        {
          customerKey: email,
          paymentKey: 'synthetic-payment',
          purpose: 'full',
          amount,
          date: '2024-01-01',
          method: 'bank_transfer',
          reference: id,
          notes: 'Actual synthetic original receipt',
        },
      ]
    : [];
  await col('customer_import_jobs').insertOne({
    _id: job,
    job_number: `SYNTHETIC-${job}`,
    source_type: 'excel',
    source_name: 'Synthetic historical workbook',
    created_by: fixture.admin.id,
    created_at: new Date().toISOString(),
    status: 'ready',
    total_rows: 1,
    valid_rows: 1,
    invalid_rows: 0,
  });
  const normalized = {
    customerStatus: 'prospect',
    requireMember: false,
    payment: null,
    customerFacts: buildImportedCustomerFacts(raw),
    paymentClaims: claims,
    externalVerified: true,
    externalReason: 'Certified against synthetic original company records',
    externalSummary: externalImportSummary(raw, claims),
  };
  await col('customer_import_rows').insertOne({
    _id: id,
    import_job_id: job,
    row_number: 2,
    raw_data: raw,
    normalized_data: normalized,
    action: 'CREATE',
    validation_status: 'valid',
    committed_at: null,
  });
  const review = await request(`customer-imports/rows/${id}/continuation`);
  expect(review).toMatchObject({ status: 200 });
  await col('customer_import_rows').updateOne(
    { _id: id },
    { $set: { 'normalized_data.continuationPreview': review.body } },
  );
  return {
    id,
    job,
    raw,
    review: review.body,
    payload: {
      requestId: randomUUID(),
      expectedSourceHash: review.body.expectedSourceHash,
      expectedTargetVersion: review.body.expectedTargetVersion,
    },
  };
}

it.each([
  ['Pending', null, 'application'],
  ['Reservation Paid', '10000.00', 'reservation'],
  ['Partially Paid', '20000.00', 'finance'],
  ['Fully Paid', null, 'activation'],
  ['Active VIP', null, 'active'],
  ['Expired', null, 'inactive'],
])(
  'restores %s atomically through native HTTP with original settlement and lifecycle evidence',
  async (status, amount, stage) => {
    const item = await reviewed(status, amount),
      owner = await col('staff_users').findOne({ _id: fixture.admin.id });
    const result = await request(`customer-imports/rows/${item.id}/continuation`, item.payload);
    expect(result).toMatchObject({ status: 200, body: { stage, externallyVerified: true } });
    const source = await col('customer_import_purchase_sources').findOne({
        original_row_id: item.id,
      }),
      app = await col('customer_applications').findOne({ _id: String(source!.application_id) });
    expect(app).toMatchObject({
      consent_acknowledged: false,
      acknowledged_at: null,
      primary_signature_status: 'pending',
      valid_id_received: false,
    });
    expect(
      await col('customer_external_import_receipts').countDocuments({ source_id: source!._id }),
    ).toBe(1);
    if (stage !== 'application') {
      const reservation = await col('reservation_agreements').findOne({
        customer_application_id: app!._id,
      });
      expect(reservation?.reservation_date).toBe('2024-01-01');
      const payments = await col('payments').find({ reservation_id: reservation!._id }).toArray();
      const listed = await request(`official-forms/reservations/${reservation!._id}/payments`);
      expect(listed.status).toBe(200);
      expect(purchasePaymentSchema.array().parse(listed.body.data)).toHaveLength(1);
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        status: 'verified',
        method: amount ? 'bank_transfer' : 'historical_certification',
      });
      if (amount)
        expect(new Date(String(payments[0]!.recorded_at)).toISOString()).toBe(
          '2023-12-31T16:00:00.000Z',
        );
      if (['activation', 'active', 'inactive'].includes(stage)) {
        expect(
          await col('card_sales').findOne({ _id: String(reservation!.sale_id) }),
        ).toMatchObject({
          origin: 'legacy_import',
          import_row_id: item.id,
          referral_relationship_id: null,
        });
        expect(await col('commissions').countDocuments({ sale_id: reservation!.sale_id })).toBe(0);
        expect(
          await col('card_sale_hierarchy_snapshots').countDocuments({
            sale_id: reservation!.sale_id,
          }),
        ).toBe(0);
      }
      if (['active', 'inactive'].includes(stage)) {
        const membership = await col('memberships').findOne({ sale_id: reservation!.sale_id });
        expect(membership).toMatchObject({
          status: stage === 'active' ? 'active' : 'expired',
          activated_at: '2024-01-01T16:00:00.000Z',
          yearly_points_allocated: 0,
        });
        const account = await col('points_accounts').findOne({ membership_id: membership!._id });
        expect(account).toMatchObject({
          balance: stage === 'active' ? 101 : 0,
          weekday_balance: stage === 'active' ? 71 : 0,
          weekend_balance: stage === 'active' ? 30 : 0,
        });
        if (stage === 'active')
          expect(await col('points_ledger').findOne({ account_id: account!._id })).toMatchObject({
            entry_type: 'cutover_baseline',
            amount: 101,
            counts_toward_cap: false,
          });
      }
    }
    const counts = await Promise.all(
      ['payments', 'memberships', 'points_ledger', 'commissions'].map((table) =>
        col(table).countDocuments(),
      ),
    );
    expect(
      await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
    ).toMatchObject({ status: 200 });
    expect(
      await Promise.all(
        ['payments', 'memberships', 'points_ledger', 'commissions'].map((table) =>
          col(table).countDocuments(),
        ),
      ),
    ).toEqual(counts);
    expect(await col('staff_users').findOne({ _id: fixture.admin.id })).toEqual(owner);
  },
);

it('retains normal future commissions when an originally partial import is paid later', async () => {
  const item = await reviewed('Partially Paid', '20000.00');
  const imported = await request(`customer-imports/rows/${item.id}/continuation`, item.payload);
  expect(imported).toMatchObject({ status: 200, body: { stage: 'finance' } });
  const reservation = imported.body.reservationId as string,
    route = `official-forms/reservations/${reservation}`;
  expect(await request(`${route}/finalize`, { requestId: randomUUID() })).toMatchObject({
    status: 409,
  });
  expect(
    await request(`${route}/payments`, {
      requestId: randomUUID(),
      amount: '80000.00',
      paymentType: 'installment',
      method: 'cash',
    }),
  ).toMatchObject({ status: 201 });
  const payment = await col('payments').findOne({
    reservation_id: reservation,
    amount: '80000.00',
  });
  expect(
    await request(`${route}/payments/${payment!._id}/verify`, {
      requestId: randomUUID(),
      decision: 'verified',
    }),
  ).toMatchObject({ status: 200 });
  const finalized = await request(`${route}/finalize`, { requestId: randomUUID() });
  expect(finalized).toMatchObject({ status: 200 });
  expect(await col('commissions').findOne({ sale_id: finalized.body.saleId })).toMatchObject({
    amount: '10000.00',
    status: 'payment_verified',
  });
  expect(await col('card_sales').findOne({ _id: finalized.body.saleId })).toMatchObject({
    origin: 'legacy_import',
    import_row_id: item.id,
  });
  expect(
    await col('card_sale_hierarchy_snapshots').countDocuments({ sale_id: finalized.body.saleId }),
  ).toBe(0);
});

it('confirms certified jobs natively and coalesces concurrent retries into one settled purchase', async () => {
  const item = await reviewed('Fully Paid');
  const results = await Promise.all(
    [1, 2].map(() => request(`customer-imports/rows/${item.id}/continuation`, item.payload)),
  );
  for (const result of results) expect(result).toMatchObject({ status: 200 });
  const source = await col('customer_import_purchase_sources').findOne({
    original_row_id: item.id,
  });
  expect(await col('card_sales').countDocuments({ import_row_id: item.id })).toBe(1);
  expect(
    await col('customer_external_import_receipts').countDocuments({ source_id: source!._id }),
  ).toBe(1);
  const job = await reviewed('Active VIP');
  const confirmed = await request(`customer-imports/jobs/${job.job}/confirm`, {});
  expect(confirmed).toMatchObject({
    status: 200,
    body: { failed: 0 },
  });
  expect(confirmed.body.rowResults[0].membershipId).toEqual(expect.any(String));
  expect(
    await col('customer_external_import_receipts').countDocuments({
      application_id: { $type: 'string' },
    }),
  ).toBeGreaterThan(0);
});

it('rolls the entire certified transaction back if its audit cannot be written', async () => {
  const item = await reviewed('Active VIP');
  const tables = [
    'customers',
    'customer_applications',
    'reservation_agreements',
    'card_sales',
    'payments',
    'memberships',
    'points_accounts',
    'points_ledger',
    'customer_import_commission_policies',
    'customer_external_import_receipts',
    'customer_import_points_baselines',
  ];
  const counts = await Promise.all(tables.map((table) => col(table).countDocuments()));
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'EXTERNAL_CUSTOMER_HISTORY_CONFIRMED' } },
    validationLevel: 'strict',
    validationAction: 'error',
  });
  try {
    expect(
      (await request(`customer-imports/rows/${item.id}/continuation`, item.payload)).status,
    ).toBeGreaterThanOrEqual(400);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(await Promise.all(tables.map((table) => col(table).countDocuments()))).toEqual(counts);
  expect(await col('customer_import_rows').findOne({ _id: item.id })).toMatchObject({
    committed_at: null,
  });
  expect(
    await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
  ).toMatchObject({ status: 200 });
});

it('denies each historical write permission and stale reviews before any customer is created', async () => {
  const item = await reviewed('Active VIP');
  const before = await col('customers').countDocuments();
  for (const [moduleKey, action] of [
    ['sales.customers', 'create'],
    ['sales.card_sales', 'create'],
    ['finance.payment_verification', 'update'],
    ['finance.card_activation', 'update'],
  ] as const) {
    const module = await col('modules').findOne({ key: moduleKey }),
      id = randomUUID();
    await col('staff_permission_restrictions').insertOne({
      _id: id,
      staff_id: fixture.admin.id,
      module_id: module!._id,
      [`deny_${action}`]: true,
    });
    try {
      expect(
        await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
      ).toMatchObject({ status: 403 });
    } finally {
      await col('staff_permission_restrictions').deleteOne({ _id: id });
    }
  }
  await col('customer_import_rows').updateOne(
    { _id: item.id },
    { $set: { 'raw_data.first_name': 'Changed' } },
  );
  expect(
    await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
  ).toMatchObject({ status: 409 });
  expect(await col('customers').countDocuments()).toBe(before);
});

it('preserves the agreed historical price and supplied VIP number rather than today’s catalog price', async () => {
  const vip = '26010100002B1C01S';
  const item = await reviewed('Fully Paid', null, {
    stated_total: '90000.00',
    existing_vip_control_number: vip,
  });
  const result = await request(`customer-imports/rows/${item.id}/continuation`, item.payload);
  expect(result).toMatchObject({ status: 200 });
  expect(await col('card_sales').findOne({ import_row_id: item.id })).toMatchObject({
    cash_price_snapshot: '90000.00',
  });
  expect(await col('customers').findOne({ email: item.raw.email })).toMatchObject({
    vip_card_number: vip,
  });
});

it('refuses inexact historical installments and duplicate money without leaving partial records', async () => {
  const item = await reviewed('Fully Paid', null, {
    stated_payment_scheme_code: 'installment_4_month',
    stated_total: '100000.01',
  });
  expect(
    await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
  ).toMatchObject({ status: 409 });
  expect(await col('customers').countDocuments({ email: item.raw.email })).toBe(0);
  const duplicate = await reviewed('Partially Paid', '20000.00'),
    customer = randomUUID();
  await col('customers').insertOne({
    _id: customer,
    email: duplicate.raw.email,
    status: 'prospect',
  });
  const payment = {
    _id: randomUUID(),
    customer_id: customer,
    reservation_id: randomUUID(),
    origin: 'reservation',
    status: 'verified',
    method: 'bank_transfer',
    reference: duplicate.id,
    amount: '20000.00',
    recorded_at: '2023-12-31T16:00:00.000Z',
  };
  await col('payments').insertOne(payment);
  const review = await request(`customer-imports/rows/${duplicate.id}/continuation`);
  expect(review.status).toBe(200);
  expect(
    await request(`customer-imports/rows/${duplicate.id}/continuation`, {
      ...duplicate.payload,
      expectedSourceHash: review.body.expectedSourceHash,
      expectedTargetVersion: review.body.expectedTargetVersion,
    }),
  ).toMatchObject({ status: 409 });
  expect(await col('payments').findOne({ _id: payment._id })).toEqual(payment);
  expect(
    await col('customer_import_purchase_sources').countDocuments({ original_row_id: duplicate.id }),
  ).toBe(0);
});

it('never credits opening points twice after spending or an equivalent workbook reimport', async () => {
  const item = await reviewed('Active VIP');
  const result = await request(`customer-imports/rows/${item.id}/continuation`, item.payload);
  expect(result.status).toBe(200);
  const membership = await col('memberships').findOne({ sale_id: result.body.saleId }),
    account = await col('points_accounts').findOne({ membership_id: membership!._id });
  await col('points_accounts').updateOne(
    { _id: account!._id },
    { $set: { balance: 91, weekday_balance: 64, weekend_balance: 27 } },
  );
  await col('memberships').updateOne({ _id: membership!._id }, { $set: { points_balance: 91 } });
  expect(
    await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
  ).toMatchObject({ status: 200 });
  const alias = await reviewed('Active VIP', null, {
    email: item.raw.email,
    purchase_reference: item.raw.purchase_reference,
  });
  expect(
    await request(`customer-imports/rows/${alias.id}/continuation`, alias.payload),
  ).toMatchObject({ status: 200 });
  expect(await col('points_accounts').findOne({ _id: account!._id })).toMatchObject({
    balance: 91,
    weekday_balance: 64,
    weekend_balance: 27,
  });
  expect(
    await col('points_ledger').countDocuments({
      account_id: account!._id,
      entry_type: 'cutover_baseline',
    }),
  ).toBe(1);
});

it('fails closed for missing or incompatible historical unique indexes without creating them on request', async () => {
  const item = await reviewed('Fully Paid'),
    before = await col('customers').countDocuments();
  await col('customer_import_commission_policies').dropIndex('source_id_1');
  await col('customer_import_commission_policies').createIndex(
    { source_id: 1 },
    { unique: true, partialFilterExpression: { source_id: { $type: 'number' } } },
  );
  try {
    expect(
      await request(`customer-imports/rows/${item.id}/continuation`, item.payload),
    ).toMatchObject({ status: 501 });
    expect(await request(`customer-imports/jobs/${item.job}/confirm`, {})).toMatchObject({
      status: 501,
    });
    expect(await col('customers').countDocuments()).toBe(before);
  } finally {
    await col('customer_import_commission_policies').dropIndex('source_id_1');
    await setupMongoHistoricalImports(replica.db);
  }
});
