import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { companyWorkbook } from './customer-workbook-export.js';
import { manilaToday } from './sale-team.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { CUSTOMER_SSOT_SECTIONS } from '@afhomes/contracts';
import { toXlsx } from './report-export.js';
import { hashIdentifier } from './identifier.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let server: http.Server,
  base = '',
  cookie = '',
  customer = '',
  main: Awaited<ReturnType<typeof reviewRow>>;
const col = (table: string) => replica.db.collection<MongoRow>(table);
async function request(path: string, body?: unknown, auth = cookie) {
  return fetch(base + '/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: auth } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response: Response, status = 200) {
  const body = await response.json();
  expect({ status: response.status, body }).toMatchObject({ status });
  return body;
}
async function reviewRow(email: string, extra: Record<string, unknown> = {}) {
  const job = randomUUID(),
    row = randomUUID();
  const raw = {
    workbook_format: 'company_v2',
    customer_key: email,
    purchase_reference: `Synthetic ${email}`,
    first_name: 'Synthetic',
    last_name: 'Imported',
    email,
    mobile: '09171234567',
    birth_date: '1990-01-01',
    vip_tier: 'BRONZE',
    stated_total: '100000.00',
    stated_rf: '10000.00',
    stated_payment_scheme_code: 'spot_cash',
    referrer_name: 'SYNTHETIC OST MEMBER',
    referrer_staff_id: fixture.ost.id,
    ...extra,
  };
  await col('customer_import_jobs').insertOne({
    _id: job,
    job_number: 'SYNTHETIC-' + job,
    source_type: 'excel',
    source_name: 'Synthetic reviewed workbook',
    status: 'ready',
    total_rows: 1,
    valid_rows: 1,
    invalid_rows: 0,
    created_by: fixture.admin.id,
    created_at: new Date().toISOString(),
  });
  const normalized = {
    category: 'PENDING',
    customerStatus: 'prospect',
    requireMember: false,
    payment: null,
    customerFacts: {
      person: {
        firstName: 'Synthetic',
        lastName: 'Imported',
        email,
        phone: '09171234567',
        birthDate: '1990-01-01',
        address: { line1: 'Synthetic Street', city: 'Quezon City', province: 'Metro Manila' },
      },
      company: {
        tinNumber: '123-456-789',
        statedVipPackage: 'BRONZE',
        statedTotalAmount: '100000.00',
        statedRf: '10000.00',
      },
    },
    paymentClaims: [
      {
        customerKey: email,
        paymentKey: 'AUTO-synthetic',
        purpose: 'reservation',
        amount: '10000.00',
        date: '2026-01-01',
        method: 'cash',
        reference: 'SYNTHETIC RECEIPT',
        notes: 'Synthetic source claim',
      },
    ],
  };
  await col('customer_import_rows').insertOne({
    _id: row,
    import_job_id: job,
    row_number: 2,
    raw_data: raw,
    normalized_data: normalized,
    validation_status: 'warning',
    validation_errors: [],
    validation_warnings: [],
    action: 'CREATE',
    customer_id: null,
    membership_id: null,
    committed_at: null,
  });
  const preview = await json(await request(`customer-imports/rows/${row}/continuation`));
  await col('customer_import_rows').updateOne(
    { _id: row },
    { $set: { 'normalized_data.continuationPreview': preview } },
  );
  return { job, row, preview, raw };
}
const confirm = (job: string) => request(`customer-imports/jobs/${job}/confirm`, {});
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-import-commit-only'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticCommit123!');
  server.on('request', createMongoPhase5Runtime(replica.db, replica.client, env));
  const login = await request(
    'auth/identity/sign-in/email',
    { email: fixture.admin.email, password: 'SyntheticCommit123!' },
    '',
  );
  await json(login);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  await json(
    await request('admin/afhomes/session/password', {
      currentPassword: 'SyntheticCommit123!',
      newPassword: 'SyntheticCommitReady123!',
      confirmPassword: 'SyntheticCommitReady123!',
    }),
  );
  await col('card_plans').updateOne(
    { _id: fixture.plan },
    {
      $set: {
        reservation_fee: '10000.00',
        cash_price: '100000.00',
        minimum_down_payment: '10000.00',
        validity_years: 1,
        spot_cash_days: 7,
        annual_points_tranches: 1,
        cardholder_limit: 1,
        discount_percent: 0,
        move_a_enabled: true,
      },
    },
  );
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await replica?.stop();
});

it('confirms one reviewed purchase under concurrent retries without money, membership or account creation', async () => {
  main = await reviewRow('synthetic-import-main@example.invalid', {
    existing_vip_control_number: '',
    contract_classification: 'Standard',
    payment_term_months: '1',
  });
  const before = await Promise.all(
    ['payments', 'memberships', 'auth_users'].map((t) => col(t).countDocuments()),
  );
  const results = await Promise.all([confirm(main.job), confirm(main.job)]).then((rs) =>
    Promise.all(rs.map((r) => json(r))),
  );
  expect(results[0].failed).toBe(0);
  expect(results[0].job.status).toBe('completed');
  customer = results[0].rowResults[0].customerId;
  const person = await col('customers').findOne({ _id: customer });
  expect(person).toMatchObject({
    status: 'prospect',
    auth_user_id: null,
    tin_number: '123-456-789',
    referred_by_staff_id: fixture.ost.id,
  });
  expect(person?.vip_card_number).toMatch(/^\d{11}B1C01S$/);
  expect(await col('customers').countDocuments({ email: main.raw.email })).toBe(1);
  expect(
    await col('customer_import_purchase_sources').countDocuments({ customer_id: customer }),
  ).toBe(1);
  expect(await col('customer_import_payment_claims').countDocuments()).toBe(1);
  expect(
    await Promise.all(
      ['payments', 'memberships', 'auth_users'].map((t) => col(t).countDocuments()),
    ),
  ).toEqual(before);
  expect(
    JSON.stringify(
      await col('audit_events').find({ entity_type: 'customer_import_row' }).toArray(),
    ),
  ).not.toContain('123-456-789');
});

it('returns source receipts for exact retries and refuses stale or conflicting customer/source edits', async () => {
  const after = await json(await request(`customer-imports/rows/${main.row}/continuation`));
  const payload = {
    requestId: randomUUID(),
    expectedSourceHash: after.expectedSourceHash,
    expectedTargetVersion: after.expectedTargetVersion,
  };
  await json(await request(`customer-imports/rows/${main.row}/continuation`, payload));
  const conflicting = await reviewRow(main.raw.email, {
    purchase_reference: 'Synthetic different purchase',
  });
  await col('customers').updateOne(
    { _id: customer },
    { $set: { first_name: 'A Changed Identity' } },
  );
  const result = await json(await confirm(conflicting.job));
  expect(result.failed).toBe(1);
  expect(await col('customer_import_source_rows').countDocuments({ row_id: conflicting.row })).toBe(
    0,
  );
  await col('customers').updateOne({ _id: customer }, { $set: { first_name: 'Synthetic' } });
  expect((await col('customers').findOne({ _id: customer }))?.tin_number).toBe('123-456-789');
});

async function flatPending(email: string, extra: Record<string, string> = {}) {
  const fields = {
    first_name: 'Synthetic',
    last_name: 'Flat',
    email,
    mobile: '09171234567',
    source_status: 'Pending',
    ...extra,
  };
  return json(
    await request('customer-imports/parse', {
      source: 'csv',
      contentBase64: Buffer.from(
        Object.keys(fields).join(',') + '\n' + Object.values(fields).join(','),
      ).toString('base64'),
    }),
    201,
  );
}

let legacyMemberSequence = 820000;
async function legacyMemberUpload(extra: Record<string, string> = {}) {
  return flatPending(`legacy-create-${randomUUID()}@example.invalid`, {
    source_status: 'Active VIP',
    vip_tier: 'BRONZE',
    historical_sale_total: '100000.01',
    payment_amount: '100000.01',
    payment_date: '2025-01-02',
    payment_method: 'cash',
    payment_reference: 'SYNTHETIC-HISTORY',
    payment_scheme: 'spot_cash',
    activation_date: '2025-01-03',
    membership_expiry_date: '2031-01-03',
    current_points_balance: '1234',
    ...extra,
  });
}

it('restores a legacy member with exact historical settlement, dates and remaining point allowances once', async () => {
  const parsed = await legacyMemberUpload();
  expect(parsed.job.invalidRows).toBe(0);
  const beforeAuth = await col('auth_users').countDocuments(),
    beforeCommissions = await col('commissions').countDocuments();
  const result = await json(await confirm(parsed.job.id));
  expect(result.failed).toBe(0);
  const row = result.rowResults[0];
  const saved = await col('customers').findOne({ _id: row.customerId });
  const member = await col('memberships').findOne({ _id: row.membershipId });
  expect(saved).toMatchObject({ status: 'active', auth_user_id: null });
  expect(saved!.vip_card_number).toMatch(/^[0-9]{11}B1C01S$/);
  expect(member).toMatchObject({
    status: 'active',
    activated_at: '2025-01-03T00:00:00.000Z',
    expires_at: '2031-01-03T00:00:00.000Z',
    points_balance: 1234,
  });
  expect(await col('card_sales').findOne({ _id: String(member!.sale_id) })).toMatchObject({
    origin: 'legacy_import',
    status: 'active',
    cash_price_snapshot: '100000.01',
    commission_rate_snapshot: '0',
    expected_commission_snapshot: '0.00',
    import_row_id: row.rowId,
  });
  expect(await col('payments').findOne({ sale_id: member!.sale_id })).toMatchObject({
    status: 'verified',
    amount: '100000.01',
    method: 'cash',
    reference: 'SYNTHETIC-HISTORY',
    recorded_at: '2025-01-02T00:00:00.000Z',
  });
  const account = (await col('points_accounts').findOne({ membership_id: member!._id }))!;
  expect(account).toMatchObject({
    balance: 1234,
    lifetime_allocated: 1234,
    weekday_balance: 864,
    weekend_balance: 370,
  });
  expect(await col('points_ledger').countDocuments({ account_id: account._id })).toBe(1);
  await col('points_accounts').updateOne(
    { _id: account._id },
    { $set: { balance: 1000, weekday_balance: 700, weekend_balance: 300 } },
  );
  await col('memberships').updateOne({ _id: member!._id }, { $set: { points_balance: 1000 } });
  await col('points_ledger').insertOne({
    _id: randomUUID(),
    account_id: account._id,
    entry_type: 'adjustment',
    amount: -234,
    balance_before: 1234,
    balance_after: 1000,
    weekday_delta: -164,
    weekend_delta: -70,
    counts_toward_cap: false,
  });
  expect((await json(await confirm(parsed.job.id))).failed).toBe(0);
  expect(await col('points_accounts').findOne({ _id: account._id })).toMatchObject({
    balance: 1000,
  });
  expect(await col('points_ledger').countDocuments({ account_id: account._id })).toBe(2);
  expect(await col('auth_users').countDocuments()).toBe(beforeAuth);
  expect(await col('commissions').countDocuments()).toBe(beforeCommissions);
});

it('preserves zero points and supplied member identity for suspended and expired legacy histories', async () => {
  for (const status of ['Suspended', 'Expired']) {
    const number = `MBS-${legacyMemberSequence++}`;
    const parsed = await legacyMemberUpload({
      source_status: status,
      membership_number: number,
      current_points_balance: '0',
      membership_expiry_date: status === 'Expired' ? '2026-01-03' : '2031-01-03',
    });
    expect(parsed.job.invalidRows).toBe(0);
    const result = await json(await confirm(parsed.job.id));
    expect(result.failed).toBe(0);
    const member = await col('memberships').findOne({ _id: result.rowResults[0].membershipId });
    expect(member).toMatchObject({
      membership_number: number,
      status: status.toLowerCase(),
      points_balance: 0,
    });
    const account = await col('points_accounts').findOne({ membership_id: member!._id });
    expect(account).toMatchObject({ balance: 0, lifetime_allocated: 0 });
    expect(await col('points_ledger').countDocuments({ account_id: account!._id })).toBe(0);
  }
});

it('rolls legacy financial/member/points creation back on audit failure and rejects changed settlement facts', async () => {
  const parsed = await legacyMemberUpload();
  const tables = [
    'customers',
    'card_sales',
    'payments',
    'memberships',
    'points_accounts',
    'points_ledger',
    'points_periods',
  ];
  const counts = () => Promise.all(tables.map((table) => col(table).countDocuments()));
  const before = await counts();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_IMPORT_ROW_COMMITTED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await json(await confirm(parsed.job.id))).failed).toBe(1);
    expect(await counts()).toEqual(before);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  for (const extra of [{ payment_amount: '99999.99' }, { payment_date: '2099-01-01' }] as Record<string, string>[]) {
    const invalid = await legacyMemberUpload(extra);
    const result = await json(await confirm(invalid.job.id));
    expect(result.failed).toBe(1);
    expect(await counts()).toEqual(before);
  }
  const stale = await legacyMemberUpload();
  await col('card_plans').updateOne({ _id: fixture.plan }, { $set: { is_active: false } });
  try {
    expect((await json(await confirm(stale.job.id))).failed).toBe(1);
    expect(await counts()).toEqual(before);
  } finally {
    await col('card_plans').updateOne({ _id: fixture.plan }, { $set: { is_active: true } });
  }
});

it('serializes legacy member creation and detects a supplied membership claimed after preview', async () => {
  const number = `MBS-${legacyMemberSequence++}`;
  const first = await legacyMemberUpload({ membership_number: number });
  const competing = await legacyMemberUpload({ membership_number: number });
  const replies = await Promise.all([confirm(first.job.id), confirm(first.job.id)]).then((rs) =>
    Promise.all(rs.map((r) => json(r))),
  );
  expect(replies.every((result) => result.failed === 0)).toBe(true);
  expect(await col('memberships').countDocuments({ membership_number: number })).toBe(1);
  const saved = await col('memberships').findOne({ membership_number: number });
  expect(await col('payments').countDocuments({ sale_id: saved!.sale_id })).toBe(1);
  expect((await json(await confirm(competing.job.id))).failed).toBe(1);
  expect(await col('memberships').countDocuments({ membership_number: number })).toBe(1);
});
async function legacyMemberFixture() {
  const email = `legacy-member-${randomUUID()}@example.invalid`;
  const parsed = await flatPending(email);
  await json(await confirm(parsed.job.id));
  const person = (await col('customers').findOne({ email }))!;
  const sale = randomUUID(),
    member = randomUUID(),
    number = `MBS-${legacyMemberSequence++}`;
  await col('customers').updateOne({ _id: person._id }, { $set: { status: 'active' } });
  await col('card_sales').insertOne({
    _id: sale,
    sale_number: `SYNTHETIC-${sale}`,
    customer_id: person._id,
    plan_id: fixture.plan,
    status: 'active',
    origin: 'legacy_import',
    cash_price_snapshot: '100000.00',
  });
  await col('memberships').insertOne({
    _id: member,
    customer_id: person._id,
    sale_id: sale,
    membership_number: number,
    qr_token_hash: randomUUID(),
    fallback_code_hash: randomUUID(),
    status: 'active',
    activated_at: '2025-01-01',
    expires_at: '2030-01-01',
    points_balance: 1234,
  });
  await col('points_accounts').insertOne({
    _id: randomUUID(),
    membership_id: member,
    balance: 1234,
  });
  const upload = (source_status: string, extra: Record<string, string> = {}) =>
    flatPending(email, { membership_number: number, source_status, vip_tier: 'BRONZE', ...extra });
  return { person, sale, member, upload };
}

it('confirms legacy member suspension atomically without rewriting financial, activation or points history', async () => {
  const f = await legacyMemberFixture();
  const points = await col('points_accounts').findOne({ membership_id: f.member });
  const savedSale = await col('card_sales').findOne({ _id: f.sale });
  const parsed = await f.upload('Suspended', { address_line_2: 'Member Unit' });
  expect(parsed.job.invalidRows).toBe(0);
  const [first, retry] = await Promise.all([confirm(parsed.job.id), confirm(parsed.job.id)]).then(
    (rs) => Promise.all(rs.map((r) => json(r))),
  );
  expect(first).toMatchObject({ failed: 0, job: { updatedRows: 1 } });
  expect(retry.failed).toBe(0);
  expect(first.rowResults[0]).toMatchObject({ customerId: f.person._id, membershipId: f.member });
  expect(await col('customers').findOne({ _id: f.person._id })).toMatchObject({
    status: 'suspended',
    address: { line2: 'Member Unit' },
  });
  expect(await col('memberships').findOne({ _id: f.member })).toMatchObject({
    status: 'suspended',
    activated_at: '2025-01-01',
    expires_at: '2030-01-01',
    points_balance: 1234,
  });
  expect(await col('points_accounts').findOne({ membership_id: f.member })).toEqual(points);
  expect(await col('card_sales').findOne({ _id: f.sale })).toEqual({
    ...savedSale,
    import_row_id: first.rowResults[0].rowId,
  });
  expect(
    await col('audit_events').countDocuments({
      action: 'CUSTOMER_IMPORT_ROW_COMMITTED',
      entity_id: first.rowResults[0].rowId,
    }),
  ).toBe(1);
});

it('preserves source member expiry/cancellation semantics and refuses reactivation or inactive transitions', async () => {
  for (const [category, target, customerStatus] of [
    ['Expired', 'expired', 'active'],
    ['Cancelled', 'cancelled', 'cancelled'],
  ]) {
    const f = await legacyMemberFixture();
    const parsed = await f.upload(category!);
    expect(parsed.job.invalidRows).toBe(0);
    expect((await json(await confirm(parsed.job.id))).failed).toBe(0);
    expect(await col('memberships').findOne({ _id: f.member })).toMatchObject({ status: target });
    expect(await col('customers').findOne({ _id: f.person._id })).toMatchObject({
      status: customerStatus,
    });
    for (const requested of ['Active VIP', 'Suspended']) {
      const invalid = await f.upload(requested);
      expect(invalid.job.invalidRows).toBe(0);
      expect((await json(await confirm(invalid.job.id))).failed).toBe(1);
      expect(await col('memberships').findOne({ _id: f.member })).toMatchObject({ status: target });
    }
  }
});

it('rejects stale member ownership/tier and rolls a member status change back if its audit fails', async () => {
  const f = await legacyMemberFixture();
  const parsed = await f.upload('Suspended');
  await col('card_sales').updateOne({ _id: f.sale }, { $set: { plan_id: randomUUID() } });
  expect((await json(await confirm(parsed.job.id))).failed).toBe(1);
  expect(await col('memberships').findOne({ _id: f.member })).toMatchObject({ status: 'active' });
  await col('card_sales').updateOne({ _id: f.sale }, { $set: { plan_id: fixture.plan } });
  const rollback = await f.upload('Suspended');
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_IMPORT_ROW_COMMITTED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await json(await confirm(rollback.job.id))).failed).toBe(1);
    expect(await col('memberships').findOne({ _id: f.member })).toMatchObject({ status: 'active' });
    expect(await col('customers').findOne({ _id: f.person._id })).toMatchObject({
      status: 'active',
    });
    expect(
      (await col('customer_import_rows').findOne({ _id: rollback.rows[0].id }))?.committed_at,
    ).toBeNull();
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
});

it('keeps active member financial/points evidence intact and enforces denied member import permissions', async () => {
  const f = await legacyMemberFixture();
  await col('card_sales').updateOne({ _id: f.sale }, { $set: { origin: 'application' } });
  const sale = await col('card_sales').findOne({ _id: f.sale });
  const member = await col('memberships').findOne({ _id: f.member });
  const points = await col('points_accounts').findOne({ membership_id: f.member });
  const parsed = await f.upload('Active VIP', {
    current_points_balance: '9999',
    membership_expiry_date: '2032-01-01',
    notes: 'Reviewed metadata',
  });
  expect(parsed.job.invalidRows).toBe(0);
  const module = await col('modules').findOne({ key: 'governance.customer_import' }),
    restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_view: true,
  });
  try {
    await json(await confirm(parsed.job.id), 403);
    expect(await col('customer_import_jobs').findOne({ _id: parsed.job.id })).toMatchObject({
      status: 'ready',
    });
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
  expect((await json(await confirm(parsed.job.id))).failed).toBe(0);
  expect(await col('memberships').findOne({ _id: f.member })).toEqual(member);
  expect(await col('card_sales').findOne({ _id: f.sale })).toEqual(sale);
  expect(await col('points_accounts').findOne({ membership_id: f.member })).toEqual(points);
  expect(await col('customers').findOne({ _id: f.person._id })).toMatchObject({
    notes: 'Reviewed metadata',
    status: 'active',
  });
  const stale = await f.upload('Suspended');
  await col('memberships').updateOne({ _id: f.member }, { $set: { customer_id: randomUUID() } });
  expect((await json(await confirm(stale.job.id))).failed).toBe(1);
  expect(await col('memberships').findOne({ _id: f.member })).toMatchObject({ status: 'active' });
});

it('confirms plain Pending CSV prospects natively without creating financial or authentication records', async () => {
  const email = 'flat-prospect@example.invalid';
  const before = await Promise.all(
    ['card_sales', 'payments', 'memberships', 'auth_users'].map((table) =>
      col(table).countDocuments(),
    ),
  );
  const parsed = await flatPending(email, {
    tin_number: '123456789000',
    address_line_1: 'Synthetic Street',
    address_line_2: 'Unit Two',
  });
  expect(parsed.job).toMatchObject({ validRows: 1, invalidRows: 0 });
  const result = await json(await confirm(parsed.job.id));
  expect(result).toMatchObject({ failed: 0, committed: 1, job: { status: 'completed' } });
  const saved = await col('customers').findOne({ email });
  expect(saved).toMatchObject({
    status: 'prospect',
    auth_user_id: null,
    tin_number: '123456789000',
    address: { line1: 'Synthetic Street', line2: 'Unit Two' },
  });
  expect(saved!.customer_number).toMatch(/^AF-CUS-/);
  await json(await confirm(parsed.job.id));
  expect(await col('customers').countDocuments({ email })).toBe(1);
  expect(
    await Promise.all(
      ['card_sales', 'payments', 'memberships', 'auth_users'].map((table) =>
        col(table).countDocuments(),
      ),
    ),
  ).toEqual(before);
});

it('imports non-member Inactive/Cancelled intake without financial records and preserves source update semantics', async () => {
  const before = await Promise.all(
    ['card_sales', 'payments', 'memberships', 'auth_users'].map((table) =>
      col(table).countDocuments(),
    ),
  );
  for (const [label, status] of [
    ['Inactive', 'suspended'],
    ['Cancelled', 'cancelled'],
  ]) {
    const email = `legacy-intake-${randomUUID()}@example.invalid`;
    const parsed = await flatPending(email, {
      source_status: label!,
      address_line_1: 'Retained source address',
    });
    expect(parsed.job.invalidRows).toBe(0);
    expect((await json(await confirm(parsed.job.id))).failed).toBe(0);
    expect(await col('customers').findOne({ email })).toMatchObject({ status, auth_user_id: null });
    const update = await flatPending(email, {
      source_status: label!,
      address_line_2: 'Source update',
    });
    expect((await json(await confirm(update.job.id))).failed).toBe(0);
    expect(await col('customers').findOne({ email })).toMatchObject({
      status,
      address: { line1: 'Retained source address', line2: 'Source update' },
    });
  }
  const email = `legacy-inactive-update-${randomUUID()}@example.invalid`;
  const pending = await flatPending(email);
  await json(await confirm(pending.job.id));
  await col('customers').updateOne({ email }, { $set: { status: 'active' } });
  const update = await flatPending(email, { source_status: 'Inactive' });
  expect((await json(await confirm(update.job.id))).failed).toBe(0);
  // Source INACTIVE metadata updates do not suspend an existing customer.
  expect(await col('customers').findOne({ email })).toMatchObject({ status: 'active' });
  expect(
    await Promise.all(
      ['card_sales', 'payments', 'memberships', 'auth_users'].map((table) =>
        col(table).countDocuments(),
      ),
    ),
  ).toEqual(before);
});

it('preserves blank legacy update fields and refuses identity drift after review', async () => {
  const email = 'flat-prospect@example.invalid';
  await col('customers').updateOne({ email }, { $set: { status: 'suspended' } });
  const parsed = await flatPending(email, { address_line_2: 'Unit Three' });
  expect(parsed.job.invalidRows).toBe(0);
  expect(await json(await confirm(parsed.job.id))).toMatchObject({ failed: 0 });
  expect(await col('customers').findOne({ email })).toMatchObject({
    status: 'suspended',
    tin_number: '123456789000',
    address: { line1: 'Synthetic Street', line2: 'Unit Three' },
  });
  const stale = await flatPending(email);
  await col('customers').updateOne({ email }, { $set: { first_name: 'CHANGED' } });
  const failed = await json(await confirm(stale.job.id));
  expect(failed.failed).toBe(1);
  expect(await col('customers').findOne({ email })).toMatchObject({ first_name: 'CHANGED' });
});

it('confirms a standard-column XLSX and the downloaded Pending CSV template', async () => {
  const fields: Record<string, string> = {
    first_name: 'Synthetic',
    last_name: 'Spreadsheet',
    email: 'flat-xlsx@example.invalid',
    mobile: '09171234567',
    source_status: 'Pending',
  };
  const bytes = toXlsx(
    'Customer Import',
    Object.keys(fields).map((label) => ({ label, type: 'text' as const })),
    [Object.values(fields)],
  );
  const excel = await json(
    await request('customer-imports/parse', {
      source: 'excel',
      contentBase64: Buffer.from(bytes).toString('base64'),
    }),
    201,
  );
  expect(excel.job.invalidRows).toBe(0);
  expect(await json(await confirm(excel.job.id))).toMatchObject({ failed: 0 });
  const template = await json(await request('customer-imports/template/csv'));
  fields.email = 'flat-template@example.invalid';
  const csvRow = CUSTOMER_SSOT_SECTIONS.flatMap((section) => section.columns)
    .map((column) => (column.target ? (fields[column.target] ?? '') : ''))
    .join(',');
  const contents =
    Buffer.from(template.content, 'base64').toString('utf8').trimEnd() + '\r\n' + csvRow + '\r\n';
  const csv = await json(
    await request('customer-imports/parse', {
      source: 'csv',
      contentBase64: Buffer.from(contents).toString('base64'),
    }),
    201,
  );
  expect(csv.job).toMatchObject({ validRows: 1, invalidRows: 0 });
  expect(await json(await confirm(csv.job.id))).toMatchObject({ failed: 0 });
  for (const email of ['flat-xlsx@example.invalid', 'flat-template@example.invalid'])
    expect(await col('customers').countDocuments({ email, status: 'prospect' })).toBe(1);
});

it('rolls Pending CSV customer/row writes back on audit failure and respects denied import access', async () => {
  const email = 'flat-audit@example.invalid',
    parsed = await flatPending(email);
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_IMPORT_ROW_COMMITTED' } },
  });
  try {
    expect(await json(await confirm(parsed.job.id))).toMatchObject({ failed: 1 });
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(await col('customers').countDocuments({ email })).toBe(0);
  expect(await col('customer_import_rows').findOne({ _id: parsed.rows[0].id })).toMatchObject({
    committed_at: null,
  });
  const denied = await flatPending('flat-denied@example.invalid');
  const module = await col('modules').findOne({ key: 'governance.customer_import' }),
    id = randomUUID();
  for (const action of ['update', 'view']) {
    await col('staff_permission_restrictions').insertOne({
      _id: id,
      staff_id: fixture.admin.id,
      module_id: module!._id,
      [`deny_${action}`]: true,
    });
    try {
      await json(await confirm(denied.job.id), 403);
    } finally {
      await col('staff_permission_restrictions').deleteOne({ _id: id });
    }
  }
  expect(await col('customer_import_jobs').findOne({ _id: denied.job.id })).toMatchObject({
    status: 'ready',
  });
  expect(await col('customers').countDocuments({ email: 'flat-denied@example.invalid' })).toBe(0);
});

it('coalesces concurrent Pending CSV confirmation and refuses newly conflicting identities across jobs', async () => {
  const email = 'flat-concurrent@example.invalid',
    first = await flatPending(email),
    second = await flatPending(email);
  const results = await Promise.all(
    [confirm(first.job.id), confirm(first.job.id)].map(async (value) => json(await value)),
  );
  expect(results.every((result) => result.failed === 0)).toBe(true);
  expect(await col('customers').countDocuments({ email })).toBe(1);
  expect(await json(await confirm(second.job.id))).toMatchObject({ failed: 1 });
  expect(await col('customers').countDocuments({ email })).toBe(1);
});

it('imports fully paid legacy financial history into the activation queue without prematurely creating a membership', async () => {
  const email = 'flat-finance@example.invalid';
  const parsed = await flatPending(email, {
    source_status: 'Fully Paid',
    vip_tier: 'BRONZE',
    historical_sale_total: '100000.00',
    payment_scheme: 'spot_cash',
    payment_amount: '100000.00',
    payment_method: 'cash',
    payment_date: '2025-01-01',
  });
  expect(parsed.job.invalidRows).toBe(0);
  const result = await json(await confirm(parsed.job.id));
  expect(result.failed).toBe(0);
  const customerId = result.rowResults[0].customerId;
  const sale = (await col('card_sales').findOne({ customer_id: customerId }))!;
  expect(sale).toMatchObject({
    status: 'payment_verified',
    origin: 'legacy_import',
    cash_price_snapshot: '100000.00',
  });
  expect(await col('memberships').countDocuments({ customer_id: customerId })).toBe(0);
  const queue = await json(await request('queues/activation'));
  expect(JSON.stringify(queue)).toContain(sale._id);
  const activated = await json(
    await request(`sales/${sale._id}/activate`, { requestId: randomUUID(), validityMonths: 12 }),
  );
  expect(await col('memberships').countDocuments({ customer_id: customerId })).toBe(1);
  expect(activated).toBeDefined();
  await json(await confirm(parsed.job.id));
  expect(await col('payments').countDocuments({ sale_id: sale._id })).toBe(1);
});

it('imports reservation/down-payment/partial history and completes Finance verification before activation', async () => {
  for (const [category, paid, scheme, initial] of [
    ['Reservation Paid', '10000.00', 'spot_cash', '0.00'],
    ['Down Payment Completed', '25000.00', 'move_b2_25_12', '25000.00'],
    ['Partially Paid', '30000.00', 'spot_cash', '0.00'],
  ]) {
    const parsed = await flatPending(`legacy-finance-${randomUUID()}@example.invalid`, {
      source_status: category!,
      vip_tier: 'BRONZE',
      historical_sale_total: '100000.00',
      payment_amount: paid!,
      payment_date: '2025-01-01',
      payment_method: 'cash',
      payment_scheme: scheme!,
      historical_reservation_fee: '10000.00',
      historical_required_initial: initial!,
    });
    expect(parsed.job.invalidRows).toBe(0);
    const result = await json(await confirm(parsed.job.id));
    expect(result.failed).toBe(0);
    const sale = (await col('card_sales').findOne({
      customer_id: result.rowResults[0].customerId,
    }))!;
    expect(sale).toMatchObject({
      status: 'payment_in_progress',
      cash_price_snapshot: '100000.00',
      payment_scheme: scheme,
      reservation_fee_snapshot: '10000.00',
      required_initial_snapshot: initial,
    });
    expect(await col('memberships').countDocuments({ sale_id: sale._id })).toBe(0);
    expect(JSON.stringify(await json(await request('queues/finance')))).toContain(sale._id);
    await json(await request(`sales/${sale._id}/activate`, { validityMonths: 12 }), 409);
    if (category === 'Partially Paid') {
      const recorded = await json(
        await request(`sales/${sale._id}/payments`, {
          requestId: randomUUID(),
          amount: '70000.00',
          method: 'cash',
          paymentType: 'full',
          reference: 'SYNTHETIC-LATER-BALANCE',
        }),
        201,
      );
      await json(await request(`sales/${sale._id}/activate`, { validityMonths: 12 }), 409);
      await json(await request(`sales/${recorded.id}/verify`, { decision: 'verified' }));
      await json(await request(`sales/${sale._id}/activate`, { validityMonths: 12 }));
      expect(await col('memberships').countDocuments({ sale_id: sale._id })).toBe(1);
      expect(await col('payments').countDocuments({ sale_id: sale._id })).toBe(2);
      await json(await confirm(parsed.job.id));
      expect(await col('payments').countDocuments({ sale_id: sale._id })).toBe(2);
    }
  }
});

it('rolls a non-member financial import back on audit failure and refuses overpayment', async () => {
  const upload = (amount: string) =>
    flatPending(`legacy-financial-fail-${randomUUID()}@example.invalid`, {
      source_status: 'Partially Paid',
      vip_tier: 'BRONZE',
      historical_sale_total: '100000.00',
      payment_amount: amount,
      payment_method: 'cash',
      payment_date: '2025-01-01',
      payment_scheme: 'spot_cash',
    });
  const counts = () =>
    Promise.all(
      ['customers', 'card_sales', 'payments', 'memberships', 'points_accounts'].map((table) =>
        col(table).countDocuments(),
      ),
    );
  const before = await counts(),
    parsed = await upload('10000.00');
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_IMPORT_ROW_COMMITTED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await json(await confirm(parsed.job.id))).failed).toBe(1);
    expect(await counts()).toEqual(before);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  const excessive = await upload('100000.01');
  expect((await json(await confirm(excessive.job.id))).failed).toBe(1);
  expect(await counts()).toEqual(before);
});

it('rechecks referral expiry at confirmation and preserves a valid registered sponsor', async () => {
  const code = 'SYNTHETIC-LEGACY-CODE',
    id = randomUUID();
  await col('referral_codes').insertOne({
    _id: id,
    code_hash: hashIdentifier(code),
    sponsor_staff_id: fixture.ost.id,
    is_active: true,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    use_count: 0,
    max_uses: 1,
  });
  const accepted = await flatPending('flat-referral@example.invalid', { referral_code: code });
  expect(accepted.job.invalidRows).toBe(0);
  expect(await json(await confirm(accepted.job.id))).toMatchObject({ failed: 0 });
  expect(await col('customers').findOne({ email: 'flat-referral@example.invalid' })).toMatchObject({
    referred_by_staff_id: fixture.ost.id,
  });
  const stale = await flatPending('flat-referral-stale@example.invalid', { referral_code: code });
  expect(stale.job.invalidRows).toBe(0);
  await col('referral_codes').updateOne(
    { _id: id },
    { $set: { expires_at: '2020-01-01T00:00:00.000Z' } },
  );
  expect(await json(await confirm(stale.job.id))).toMatchObject({ failed: 1 });
  expect(
    await col('customers').countDocuments({ email: 'flat-referral-stale@example.invalid' }),
  ).toBe(0);
});

const applicationInput = () => ({
  requestId: randomUUID(),
  customerId: customer,
  planId: fixture.plan,
  tier: 'BRONZE',
  paymentScheme: 'spot_cash',
  referrerStaffId: fixture.ost.id,
  primary: {
    holderType: 'PRIMARY',
    firstName: 'Synthetic',
    lastName: 'Imported',
    birthDate: '1990-01-01',
    permanentAddressLine1: 'Synthetic Street',
    cityMunicipality: 'Quezon City',
    province: 'Metro Manila',
    mobile: '09171234567',
    email: main.raw.email,
    printedName: 'Synthetic Imported',
  },
  acquisitionChannels: ['Walk-In'],
  consentAcknowledged: true,
  acknowledgedAt: '2026-01-01',
  primarySignatureStatus: 'received',
  validIdReceived: true,
  reservationPaymentProofReceived: true,
});
it('completes the imported application in the existing purchase workflow with one source link and frozen-term checks', async () => {
  const preview = await json(await request(`customer-imports/rows/${main.row}/continuation`));
  const body = {
    ...applicationInput(),
    importContext: {
      rowId: main.row,
      requestId: randomUUID(),
      expectedSourceHash: preview.expectedSourceHash,
      expectedTargetVersion: preview.expectedTargetVersion,
    },
  };
  const result = await json(await request('official-forms/customer-applications', body), 201);
  expect(result).toMatchObject({ customerId: customer, status: 'draft' });
  expect(
    (await col('customer_import_purchase_sources').findOne({ original_row_id: main.row }))
      ?.application_id,
  ).toBe(result.id);
  expect(
    await json(await request('official-forms/customer-applications', body), 201),
  ).toMatchObject({ id: result.id });
  expect(await col('customer_applications').countDocuments({ customer_id: customer })).toBe(1);
  const changed = {
    ...body,
    requestId: randomUUID(),
    primary: { ...body.primary, firstName: 'Changed' },
  };
  await json(await request('official-forms/customer-applications', changed), 409);
});

it('rolls back customer/source/claim creation on audit failure and leaves invalid claims out of accounting', async () => {
  const item = await reviewRow('synthetic-import-rollback@example.invalid', {
    existing_vip_control_number: '',
    contract_classification: 'Standard',
    payment_term_months: '1',
  });
  const counters = await col('counters')
    .find({ _id: { $ne: 'organization-write' } })
    .sort({ _id: 1 })
    .toArray();
  const counts = await Promise.all(
    [
      'customers',
      'customer_import_purchase_sources',
      'customer_import_payment_claims',
      'payments',
    ].map((t) => col(t).countDocuments()),
  );
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_IMPORT_CONTINUED' } },
  });
  try {
    expect((await json(await confirm(item.job))).failed).toBe(1);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(
    await Promise.all(
      [
        'customers',
        'customer_import_purchase_sources',
        'customer_import_payment_claims',
        'payments',
      ].map((t) => col(t).countDocuments()),
    ),
  ).toEqual(counts);
  expect(
    await col('counters')
      .find({ _id: { $ne: 'organization-write' } })
      .sort({ _id: 1 })
      .toArray(),
  ).toEqual(counters);
  expect((await col('customer_import_rows').findOne({ _id: item.row }))?.committed_at).toBeNull();
  const invalid = await reviewRow('synthetic-import-future@example.invalid');
  await col('customer_import_rows').updateOne(
    { _id: invalid.row },
    { $set: { 'normalized_data.paymentClaims.0.date': '2999-01-01' } },
  );
  expect((await json(await confirm(invalid.job))).failed).toBe(1);
  expect(await col('customers').countDocuments({ email: invalid.raw.email })).toBe(0);
});

it('requires import/customer permissions, blocks cancelled jobs and retains certified-history gates', async () => {
  const item = await reviewRow('synthetic-import-denied@example.invalid'),
    module = await col('modules').findOne({ key: 'sales.customers' }),
    restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_create: true,
  });
  try {
    expect((await json(await confirm(item.job))).failed).toBe(1);
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
  await col('customer_import_jobs').updateOne({ _id: item.job }, { $set: { status: 'cancelled' } });
  await json(await confirm(item.job), 409);
  await json(await request(`customer-imports/jobs/${main.job}/confirm`, {}, ''), 401);
});

it('refuses imported application terms that differ from the normal plan and rolls draft/mirrors back', async () => {
  const item = await reviewRow('synthetic-import-terms@example.invalid');
  await col('customer_import_rows').updateOne(
    { _id: item.row },
    { $set: { 'normalized_data.customerFacts.company.statedTotalAmount': '110000.00' } },
  );
  const review = await json(await request(`customer-imports/rows/${item.row}/continuation`));
  await col('customer_import_rows').updateOne(
    { _id: item.row },
    { $set: { 'normalized_data.continuationPreview': review } },
  );
  const result = await json(await confirm(item.job));
  expect(result.failed).toBe(0);
  const id = result.rowResults[0].customerId,
    before = await col('customers').findOne({ _id: id });
  const fresh = await json(await request(`customer-imports/rows/${item.row}/continuation`));
  const input = applicationInput();
  await json(
    await request('official-forms/customer-applications', {
      ...input,
      customerId: id,
      primary: { ...input.primary, email: item.raw.email },
      importContext: {
        rowId: item.row,
        requestId: randomUUID(),
        expectedSourceHash: fresh.expectedSourceHash,
        expectedTargetVersion: fresh.expectedTargetVersion,
      },
    }),
    409,
  );
  expect(await col('customer_applications').countDocuments({ customer_id: id })).toBe(0);
  expect(
    (await col('customer_import_purchase_sources').findOne({ original_row_id: item.row }))
      ?.application_id,
  ).toBeNull();
  expect(await col('customers').findOne({ _id: id })).toEqual(before);
});

it('confirms an actual company workbook from native upload through customer/source intake', async () => {
  const email = 'synthetic-import-file@example.invalid';
  const bytes = companyWorkbook([
    {
      first_name: 'Synthetic',
      last_name: 'Workbook',
      email,
      mobile: '09171234567',
      birth_date: '1990-01-01',
      sex: 'Male',
      citizenship: 'Filipino',
      civil_status: 'Single',
    },
  ]);
  const parsed = await json(
    await request('customer-imports/parse', {
      source: 'excel',
      sourceName: 'Synthetic company workbook',
      contentBase64: Buffer.from(bytes).toString('base64'),
    }),
    201,
  );
  expect(parsed.job).toMatchObject({ validRows: 1, invalidRows: 0 });
  const result = await json(await confirm(parsed.job.id));
  expect(result.failed).toBe(0);
  const id = result.rowResults[0].customerId;
  expect(await col('customers').findOne({ _id: id })).toMatchObject({ email, status: 'prospect' });
  expect(await col('customer_import_purchase_sources').countDocuments({ customer_id: id })).toBe(1);
  expect(await col('payments').countDocuments({ customer_id: id })).toBe(0);
});

it('coalesces equivalent source aliases and automatically keyed claims without another customer, source or application', async () => {
  const source = await col('customer_import_purchase_sources').findOne({
    original_row_id: main.row,
  });
  const alias = await reviewRow(main.raw.email, {
    purchase_reference: main.raw.purchase_reference,
    customer_key: 'A new workbook key',
    existing_vip_control_number: '',
    contract_classification: 'Standard',
    payment_term_months: '1',
  });
  await col('customer_import_rows').updateOne(
    { _id: alias.row },
    {
      $set: {
        'normalized_data.paymentClaims.0.customerKey': 'A new workbook key',
        'normalized_data.paymentClaims.0.paymentKey': 'AUTO-another-key',
      },
    },
  );
  const preview = await json(await request(`customer-imports/rows/${alias.row}/continuation`));
  await col('customer_import_rows').updateOne(
    { _id: alias.row },
    { $set: { 'normalized_data.continuationPreview': preview } },
  );
  const result = await json(await confirm(alias.job));
  expect(result.failed).toBe(0);
  expect(result.rowResults[0].customerId).toBe(customer);
  expect((await col('customer_import_source_rows').findOne({ row_id: alias.row }))?.source_id).toBe(
    source!._id,
  );
  expect(
    await col('customer_import_payment_claims').countDocuments({ source_id: source!._id }),
  ).toBe(1);
  expect(await col('customer_applications').countDocuments({ customer_id: customer })).toBe(1);
});

it('revalidates an inactive ancestor after review even if the recorded ancestor IDs did not change', async () => {
  const item = await reviewRow('synthetic-import-hierarchy@example.invalid');
  await col('staff_users').updateOne({ _id: fixture.staff.id }, { $set: { status: 'suspended' } });
  try {
    expect((await json(await confirm(item.job))).failed).toBe(1);
  } finally {
    await col('staff_users').updateOne({ _id: fixture.staff.id }, { $set: { status: 'active' } });
  }
  expect(await col('customers').countDocuments({ email: item.raw.email })).toBe(0);
});

it('allocates installment control numbers without reusing a manually occupied sequence value', async () => {
  const counter = await col('counters').findOne({ _id: 'vip-card-number' }),
    next = Number(counter?.seq ?? 0) + 1;
  const prefix = manilaToday().replaceAll('-', '').slice(2),
    reserved = `${prefix}${String(next).padStart(5, '0')}B1T04S`;
  await col('customers').insertOne({
    _id: randomUUID(),
    email: 'synthetic-reserved-control@example.invalid',
    vip_card_number: reserved,
    status: 'prospect',
  });
  const item = await reviewRow('synthetic-import-installment@example.invalid', {
    existing_vip_control_number: '',
    contract_classification: 'Standard',
    payment_term_months: '4',
    stated_payment_scheme_code: 'installment_4_month',
  });
  const result = await json(await confirm(item.job));
  expect(result.failed).toBe(0);
  const person = await col('customers').findOne({ _id: result.rowResults[0].customerId });
  expect(person?.vip_card_number).toBe(`${prefix}${String(next + 1).padStart(5, '0')}B1T04S`);
});

it('continues the imported application through Finance reconciliation, full verified payment and activation', async () => {
  const source = await col('customer_import_purchase_sources').findOne({
    original_row_id: main.row,
  });
  const app = String(source!.application_id);
  const authCount = await col('auth_users').countDocuments();
  const proposal = await json(
    await request(`official-forms/customer-applications/${app}/purchase-terms/proposal`),
  );
  await json(
    await request(`official-forms/customer-applications/${app}/submit`, {
      requestId: randomUUID(),
      expectedProposalHash: proposal.expectedProposalHash,
    }),
  );
  const frozen = await col('customer_application_purchase_terms').findOne({ application_id: app });
  await json(
    await request(`official-forms/customer-applications/${app}/decision`, {
      requestId: randomUUID(),
      decision: 'approved',
    }),
  );
  const reservation = await col('reservation_agreements').findOne({ customer_application_id: app });
  expect(reservation?.status).toBe('executed');
  const route = `official-forms/reservations/${reservation!._id}`;
  const deposit = await col('payments').findOne({ reservation_id: reservation!._id });
  expect(deposit).toMatchObject({ amount: '10000.00', status: 'recorded' });
  const claims = await json(
    await request(`customer-imports/reservations/${reservation!._id}/claims`),
  );
  expect(claims).toHaveLength(1);
  const claim = claims[0];
  await json(
    await request(`customer-imports/payment-claims/${claim.id}/reconcile`, {
      requestId: randomUUID(),
      expectedClaimVersion: claim.expectedClaimVersion,
      expectedTargetVersion: claim.expectedTargetVersion,
      decision: {
        kind: 'match',
        paymentId: deposit!._id,
        reason: 'Synthetic matching reservation receipt',
      },
    }),
  );
  expect(await col('payments').countDocuments({ reservation_id: reservation!._id })).toBe(1);
  expect(await json(await request(`${route}/finance`))).toMatchObject({
    verifiedTotal: '0.00',
    remainingBalance: '100000.00',
  });
  await json(await request(`${route}/finalize`, { requestId: randomUUID() }), 409);
  await json(
    await request(`${route}/payments/${deposit!._id}/verify`, {
      requestId: randomUUID(),
      decision: 'verified',
    }),
  );
  await json(await request(`${route}/finalize`, { requestId: randomUUID() }), 409);
  await json(
    await request(`${route}/payments`, {
      requestId: randomUUID(),
      amount: '90000.00',
      paymentType: 'installment',
      method: 'cash',
    }),
    201,
  );
  const balance = await col('payments').findOne({
    reservation_id: reservation!._id,
    amount: '90000.00',
  });
  await json(await request(`${route}/finalize`, { requestId: randomUUID() }), 409);
  await json(
    await request(`${route}/payments/${balance!._id}/verify`, {
      requestId: randomUUID(),
      decision: 'verified',
    }),
  );
  const finalized = await json(await request(`${route}/finalize`, { requestId: randomUUID() }));
  const activated = await json(await request(`sales/${finalized.saleId}/activate`, {}));
  expect(await col('memberships').findOne({ _id: activated.membershipId })).toMatchObject({
    customer_id: customer,
    status: 'active',
  });
  expect(await col('customer_application_purchase_terms').findOne({ _id: frozen!._id })).toEqual(
    frozen,
  );
  expect(await col('customer_import_payment_claims').findOne({ _id: claim.id })).toMatchObject({
    status: 'matched',
    payment_id: deposit!._id,
  });
  expect(await col('auth_users').countDocuments()).toBe(authCount);
  expect((await col('customers').findOne({ _id: customer }))?.auth_user_id).toBeNull();
}, 15000);
