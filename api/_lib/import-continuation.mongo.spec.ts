import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { customerImportContinuationSchema, importSourceIntakeSchema, WORKFLOW_COLUMNS } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { buildImportedCustomerFacts } from './customer-import-continuation.js';
import { companyWorkbook } from './customer-workbook-export.js';
import { customerWorkflowTemplate } from './customer-workflow-export.js';
import { readWorkbookParts } from './customer-xlsx.js';
import { parseCustomerWorkbookV2 } from './customer-workbook-v2.js';
import { zipStored } from './report-export.js';
import type { MongoRow } from './customer-activation.mongo.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let server: http.Server,
  base = '',
  cookie = '',
  sellerCookie = '';
const job = randomUUID(),
  row = randomUUID(),
  source = randomUUID(),
  app = randomUUID(),
  reservation = randomUUID();
const col = (table: string) => replica.db.collection<MongoRow>(table);
async function request(route: string, auth = cookie, body?: unknown) {
  return fetch(base + '/api/v1/customer-imports/' + route, {
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
const preview = (id = row) => request(`rows/${id}/continuation`).then((r) => json(r));
const fields = (email: string) => ({
  workbook_format: 'company_v2',
  first_name: 'Synthetic',
  last_name: 'Buyer',
  email,
  mobile: '09123456789',
  birth_date: '1990-02-03',
  sex: 'Male',
  citizenship: 'Filipino',
  civil_status: 'Single',
  address_line_1: 'Synthetic Street',
  province: 'Laguna',
  city: 'Calamba',
  barangay: 'Synthetic Barangay',
  vip_tier: 'GOLD',
  stated_status: 'Pending',
  stated_payment_scheme: 'Move a',
  stated_total: '312000',
  stated_rf: '10000',
  purchase_reference: 'Synthetic purchase',
  tin: '123456789000',
  secondary_tin: '987654321000',
});
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-continuation-only'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticContinue123!');
  server.on('request', createMongoPhase5Runtime(replica.db, replica.client, env));
  for (const person of [fixture.admin, fixture.staff]) {
    const login = await fetch(base + '/api/v1/auth/identity/sign-in/email', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: person.email, password: 'SyntheticContinue123!' }),
    });
    await json(login);
    const jar = login.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    await json(
      await fetch(base + '/api/v1/admin/afhomes/session/password', {
        method: 'POST',
        headers: { Origin: base, Cookie: jar, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'SyntheticContinue123!',
          newPassword: 'SyntheticContinueReady123!',
          confirmPassword: 'SyntheticContinueReady123!',
        }),
      }),
    );
    if (person.id === fixture.admin.id) cookie = jar;
    else sellerCookie = jar;
  }
  await col('customer_import_jobs').insertOne({
    _id: job,
    created_by: fixture.admin.id,
    status: 'completed',
  });
  await col('customer_import_rows').insertOne({
    _id: row,
    import_job_id: job,
    customer_id: fixture.customer.id,
    raw_data: fields(fixture.customer.email),
    normalized_data: { customerFacts: { person: {}, company: {} }, paymentClaims: [] },
    committed_at: '2026-10-27T01:00:00.000Z',
  });
  await col('customer_import_purchase_sources').insertOne({
    _id: source,
    issuer_scope: 'afhomes',
    normalized_reference: 'synthetic purchase',
    purchase_reference: 'Synthetic purchase',
    original_row_id: row,
    customer_id: fixture.customer.id,
    application_id: app,
  });
  await col('customer_import_source_rows').insertOne({
    _id: randomUUID(),
    row_id: row,
    source_id: source,
  });
  await col('customer_applications').insertOne({
    _id: app,
    customer_id: fixture.customer.id,
    status: 'draft',
  });
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await replica?.stop();
});

it('reads native continuation stages without changing the imported evidence or customer', async () => {
  const original = await col('customer_import_rows').findOne({ _id: row }),
    customer = await col('customers').findOne({ _id: fixture.customer.id });
  const result = customerImportContinuationSchema.parse(await preview());
  expect(result).toMatchObject({
    rowId: row,
    sourceId: source,
    customerId: fixture.customer.id,
    applicationId: app,
    stage: 'application',
    nextAction: { path: `/admin/customers/applications/${app}` },
  });
  await col('reservation_agreements').insertOne({
    _id: reservation,
    customer_application_id: app,
    customer_id: fixture.customer.id,
    status: 'submitted',
    created_at: '2026-10-27T00:00:00.000Z',
  });
  expect(await preview()).toMatchObject({ stage: 'reservation', reservationId: reservation });
  await col('reservation_agreements').updateOne(
    { _id: reservation },
    { $set: { status: 'executed' } },
  );
  const finance = await preview();
  expect(finance).toMatchObject({
    stage: 'finance',
    nextAction: { path: '/admin/finance/payments' },
  });
  expect(finance.expectedTargetVersion).not.toBe(result.expectedTargetVersion);
  await col('card_sales').updateOne(
    { _id: fixture.customer.sale },
    { $set: { status: 'payment_verified' } },
  );
  await col('reservation_agreements').updateOne(
    { _id: reservation },
    { $set: { sale_id: fixture.customer.sale } },
  );
  expect(await preview()).toMatchObject({ stage: 'activation' });
  await col('card_sales').updateOne({ _id: fixture.customer.sale }, { $set: { status: 'active' } });
  expect(await preview()).toMatchObject({
    stage: 'complete',
    nextAction: { path: `/admin/customers/${fixture.customer.id}` },
  });
  await col('reservation_agreements').updateOne(
    { _id: reservation },
    { $set: { status: 'cancelled' } },
  );
  expect(await preview()).toMatchObject({
    stage: 'review',
    nextAction: { path: `/admin/sales/reservations/${reservation}` },
  });
  expect(await col('customer_import_rows').findOne({ _id: row })).toEqual(original);
  expect(await col('customers').findOne({ _id: fixture.customer.id })).toEqual(customer);
});

it('provides private-safe existing-form intake by row or source and preserves source revisions', async () => {
  const result = importSourceIntakeSchema.parse(await json(await request(`rows/${row}/intake`)));
  expect(result.prefill.primary).toMatchObject({ firstName: 'Synthetic', lastName: 'Buyer' });
  expect(result.prefill.primary.tinNumber).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('123456789000');
  expect(JSON.stringify(result)).not.toContain('987654321000');
  expect(await json(await request(`sources/${source}/intake`))).toEqual(result);
  const before = result.continuation.expectedSourceHash;
  await col('customer_import_rows').updateOne(
    { _id: row },
    { $set: { 'raw_data.occupation': 'Synthetic Employer' } },
  );
  expect((await preview()).expectedSourceHash).not.toBe(before);
});

it('deduplicates committed source rows before paginating and filters by customer', async () => {
  const sibling = randomUUID();
  await col('customer_import_rows').insertOne({
    _id: sibling,
    import_job_id: job,
    customer_id: fixture.customer.id,
    raw_data: fields(fixture.customer.email),
    normalized_data: { customerFacts: { person: {}, company: {} } },
    committed_at: '2026-10-27T02:00:00.000Z',
  });
  await col('customer_import_source_rows').insertOne({
    _id: randomUUID(),
    row_id: sibling,
    source_id: source,
  });
  const result = await json(
    await request(`continuations?customerId=${fixture.customer.id}&limit=1`),
  );
  expect(result).toHaveLength(1);
  expect(result[0].rowId).toBe(sibling);
  expect(await json(await request('continuations?limit=1&offset=1'))).toEqual([]);
  expect(await json(await request(`continuations?customerId=${randomUUID()}`))).toEqual([]);
});

it('enforces import/customer permissions, job ownership, pagination and unported write gates', async () => {
  await json(await request('continuations', ''), 401);
  await json(await request('continuations?limit=101'), 400);
  await json(await request('rows/not-a-uuid/intake'), 400);
  const assignment = await col('staff_role_assignments').findOne({ staff_id: fixture.staff.id });
  for (const key of [
    'governance.customer_import',
    'sales.customers',
    'finance.payment_verification',
  ]) {
    const module = await col('modules').findOne({ key });
    await col('role_permissions').updateOne(
      { role_id: assignment!.role_id, module_id: module!._id },
      { $set: { can_view: true, can_update: false }, $setOnInsert: { _id: randomUUID() } },
      { upsert: true },
    );
  }
  expect(await json(await request('continuations', sellerCookie))).toEqual([]);
  await json(await request(`rows/${row}/intake`, sellerCookie), 403);
  for (const key of ['governance.customer_import', 'sales.customers']) {
    const module = await col('modules').findOne({ key }),
      restriction = randomUUID();
    await col('staff_permission_restrictions').insertOne({
      _id: restriction,
      staff_id: fixture.admin.id,
      module_id: module!._id,
      deny_view: true,
    });
    try {
      await json(await request(`sources/${source}/intake`), 403);
    } finally {
      await col('staff_permission_restrictions').deleteOne({ _id: restriction });
    }
  }
  await json(await request(`rows/${row}/continuation`, cookie, {}), 400);
  await json(await request('jobs/invalid/retry', cookie, {}), 501);
});

it('proposes missing fields safely, flags conflicts and refuses ambiguous customer identity or unsupported certified history', async () => {
  const recovery = randomUUID();
  await col('customer_import_rows').insertOne({
    _id: recovery,
    import_job_id: job,
    customer_id: fixture.customer.id,
    committed_at: '2026-10-27T00:00:00.000Z',
    raw_data: fields(fixture.customer.email),
    normalized_data: {
      customerFacts: {
        person: { firstName: 'A Different Buyer' },
        company: { tinNumber: '123456789000', statedTotalAmount: '100000.0' },
      },
    },
  });
  const result = await preview(recovery);
  expect(result).toMatchObject({
    stage: 'review',
    conflicts: expect.arrayContaining([expect.objectContaining({ field: 'first_name' })]),
    proposedFields: expect.arrayContaining([
      { field: 'tin_number', value: 'Private value supplied' },
    ]),
  });
  expect(JSON.stringify(result)).not.toContain('123456789000');
  await col('customer_import_rows').updateOne(
    { _id: recovery },
    { $set: { 'raw_data.email': 'a-different-person@example.invalid' } },
  );
  await json(await request(`rows/${recovery}/continuation`), 409);
  await col('customer_import_rows').updateOne(
    { _id: row },
    { $set: { 'normalized_data.externalVerified': true } },
  );
  try {
    await json(await request(`rows/${row}/continuation`), 409);
  } finally {
    await col('customer_import_rows').updateOne(
      { _id: row },
      { $unset: { 'normalized_data.externalVerified': '' } },
    );
  }
});

it('offers manual application completion for a new person without creating a customer or accepting consent', async () => {
  const id = randomUUID(),
    before = await col('customers').countDocuments();
  await col('customer_import_rows').insertOne({
    _id: id,
    import_job_id: job,
    raw_data: {
      ...fields('new-synthetic-person@example.invalid'),
      purchase_reference: 'Synthetic new purchase',
    },
    normalized_data: { customerFacts: { person: {}, company: {} } },
    committed_at: null,
  });
  const result = await preview(id);
  expect(result).toMatchObject({
    customerId: null,
    sourceId: null,
    applicationId: null,
    stage: 'application',
    nextAction: { path: `/admin/customers/applications/new?customerId=&importRowId=${id}` },
  });
  expect(result.missingRequirements.join(' ')).toContain('actual acknowledgment date');
  expect(await col('customers').countDocuments()).toBe(before);
  const intake = importSourceIntakeSchema.parse(await json(await request(`rows/${id}/intake`)));
  expect(intake.continuation.customerId).toBeNull();
  expect(JSON.stringify(intake)).not.toContain('123456789000');
});

it('validates an explicit existing-reservation reference against the exact customer and frozen terms', async () => {
  const id = randomUUID();
  await col('reservation_agreements').updateOne(
    { _id: reservation },
    {
      $set: {
        reservation_number: 'SYNTHETIC-EXISTING',
        total_price_snapshot: '312000.00',
        reservation_fee_snapshot: '10000.00',
        tier_snapshot: 'GOLD',
        payment_scheme_snapshot: 'move_a',
      },
    },
  );
  await col('customer_import_rows').insertOne({
    _id: id,
    import_job_id: job,
    customer_id: fixture.customer.id,
    raw_data: {
      ...fields(fixture.customer.email),
      existing_reservation_reference: 'SYNTHETIC-EXISTING',
      stated_payment_scheme_code: 'move_a',
    },
    normalized_data: { customerFacts: { person: {}, company: {} } },
  });
  expect(await preview(id)).toMatchObject({
    applicationId: app,
    reservationId: reservation,
    stage: 'review',
  });
  await col('customer_import_rows').updateOne(
    { _id: id },
    { $set: { 'raw_data.stated_total': '312001' } },
  );
  await json(await request(`rows/${id}/continuation`), 409);
  await col('customer_import_rows').updateOne(
    { _id: id },
    { $set: { 'raw_data.existing_reservation_reference': 'UNKNOWN' } },
  );
  await json(await request(`rows/${id}/continuation`), 409);
});

it('reconstructs older source facts without rewriting the legacy evidence', async () => {
  const id = randomUUID(),
    raw = {
      ...fields('legacy-synthetic-person@example.invalid'),
      workbook_format: 'company_v1',
      purchase_reference: 'Synthetic legacy purchase',
      tin: '123-456-789',
      secondary_tin: '987-654-321',
    };
  expect(() => buildImportedCustomerFacts(raw)).not.toThrow();
  await col('customer_import_rows').insertOne({
    _id: id,
    import_job_id: job,
    raw_data: raw,
    normalized_data: {},
  });
  const result = await preview(id);
  expect(result).toMatchObject({ stage: 'application', sourceId: null, customerId: null });
  expect((await col('customer_import_rows').findOne({ _id: id }))?.normalized_data).toEqual({});
  expect(await preview(id)).toEqual(result);
});

it('uploads a CSV into a persisted, paginated native review job without creating business records', async () => {
  const before = await col('customers').countDocuments(),
    payments = await col('payments').countDocuments();
  const csv =
    'first_name,last_name,email,mobile,source_status,tin_number\n' +
    Array.from(
      { length: 12 },
      (_, i) => `Synthetic,Buyer,review-${i}@example.invalid,09123456789,Pending,123-456-789`,
    ).join('\n');
  const parsed = await json(
    await request('parse', cookie, {
      source: 'csv',
      sourceName: 'synthetic-review.csv',
      contentBase64: Buffer.from(csv).toString('base64'),
    }),
    201,
  );
  expect(parsed.job).toMatchObject({
    totalRows: 12,
    validRows: 12,
    invalidRows: 0,
    status: 'ready',
  });
  expect(parsed.rows).toHaveLength(10);
  expect(JSON.stringify(parsed.rows)).not.toContain('123-456-789');
  const next = await json(await request(`jobs/${parsed.job.id}?offset=10&limit=10`));
  expect(next.rows).toHaveLength(2);
  expect(
    (await json(await request('jobs'))).data.some((j: { id: string }) => j.id === parsed.job.id),
  ).toBe(true);
  await json(await request(`jobs/${parsed.job.id}/cancel`, cookie, {}));
  expect((await json(await request(`jobs/${parsed.job.id}`))).job.status).toBe('cancelled');
  await json(await request(`jobs/${parsed.job.id}/cancel`, cookie, {}), 409);
  expect(await col('customers').countDocuments()).toBe(before);
  expect(await col('payments').countDocuments()).toBe(payments);
});

it('retains existing workbook formats, row validation, template download and the larger local upload limit', async () => {
  const workbook = companyWorkbook([
    {
      first_name: 'Synthetic',
      last_name: 'Workbook',
      email: 'synthetic-book@example.invalid',
      mobile: '09123456789',
      tin: '123-456-789',
    },
  ]);
  const parsed = await json(
    await request('parse', cookie, {
      source: 'excel',
      contentBase64: Buffer.from(workbook).toString('base64'),
    }),
    201,
  );
  expect(parsed.job.totalRows).toBe(1);
  expect(parsed.rows[0].fields.workbook_format).toBe('company_v1');
  expect(JSON.stringify(parsed.rows)).not.toContain('123-456-789');
  const csv =
    'first_name,last_name,email,mobile,source_status,ignored_column\nSynthetic,Large,large-review@example.invalid,09123456789,Pending,' +
    'x'.repeat(70000);
  const large = await json(
    await request('parse', cookie, {
      source: 'csv',
      contentBase64: Buffer.from(csv).toString('base64'),
    }),
    201,
  );
  expect(large.job).toMatchObject({ totalRows: 1, validRows: 1, status: 'ready' });
  const invalid = await json(
    await request('parse', cookie, {
      source: 'csv',
      contentBase64: Buffer.from(
        'first_name,last_name,email,mobile,source_status\nSynthetic,,bad,invalid,Pending',
      ).toString('base64'),
    }),
    201,
  );
  expect(invalid.job).toMatchObject({ totalRows: 1, invalidRows: 1, status: 'validated' });
  for (const format of ['csv', 'xlsx']) {
    const template = await json(await request(`template/${format}`));
    expect(Buffer.from(template.content, 'base64').length).toBeGreaterThan(100);
  }
  await json(
    await request('parse', cookie, {
      source: 'google_sheets',
      sheetUrl: 'http://127.0.0.1/private',
    }),
    400,
  );
  await json(await request('parse', cookie, { source: 'csv', contentBase64: '' }), 400);
  await json(
    await request('parse', cookie, {
      source: 'excel',
      externalVerificationReason: 'Synthetic certified request',
      contentBase64: 'AA==',
    }),
    400,
  );
});

it('returns a downloadable guided review workbook retaining bad/good values, cell flags and explanations through native HTTP', async () => {
  const parts = readWorkbookParts(customerWorkflowTemplate());
  const column = (n: number): string =>
    n > 26
      ? column(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26))
      : String.fromCharCode(64 + n);
  for (const [name, index] of [
    ['Customers', 2],
    ['Sales Team', 4],
  ] as const) {
    const path = `xl/worksheets/sheet${index}.xml`;
    let xml = new TextDecoder().decode(parts.get(path));
    for (const row of [2, 3]) {
      const email = `review-flags-${row}@example.invalid`;
      const values =
        name === 'Customers'
          ? {
              first_name: row === 2 ? 'Flagged' : 'Retained',
              last_name: 'Synthetic',
              email,
              mobile: row === 2 ? '09BAD' : '09123456789',
              vip_tier: 'BRONZE',
              stated_payment_scheme: 'Spot cash',
              stated_status: 'Pending',
              contract_date: '2025-01-01',
              stated_regular_price: '100000',
              stated_rf: '10000',
            }
          : { customer_key: email, referrer_name: 'SYNTHETIC OST MEMBER' };
      for (const [key, value] of Object.entries(values)) {
        const position = WORKFLOW_COLUMNS[name].findIndex((c) => c.key === key) + 1;
        expect(position).toBeGreaterThan(0);
        const ref = column(position) + row;
        const cell = new RegExp('<c\\b[^>]*r="' + ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');
        expect(xml).toMatch(cell);
        xml = xml.replace(cell, `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`);
      }
    }
    parts.set(path, new TextEncoder().encode(xml));
  }
  const input = Buffer.from(
    zipStored(
      [...parts].map(([name, data]) => ({ name, data })),
      true,
    ),
  );
  const before = await col('customers').countDocuments();
  const parsed = await json(
    await request('parse', cookie, { source: 'excel', contentBase64: input.toString('base64') }),
    201,
  );
  expect(parsed.job).toMatchObject({ totalRows: 2, invalidRows: 1 });
  expect(parsed.reviewFile).toMatchObject({
    filename: 'customer-import-review.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const reviewed = readWorkbookParts(Buffer.from(parsed.reviewFile.content, 'base64'));
  const originalSources = parseCustomerWorkbookV2(input, { collectErrors: true })!.sources.flat();
  const returnedSources = parseCustomerWorkbookV2(
    Buffer.from(parsed.reviewFile.content, 'base64'),
    { collectErrors: true },
  )!.sources.flat();
  for (const original of originalSources) {
    const returned = returnedSources.find(
      (source) => source.sheet === original.sheet && source.row === original.row,
    );
    expect(returned).toBeDefined();
    for (const [key, value] of Object.entries(original.fields))
      if (!['review_status', 'review_errors', 'review_warnings'].includes(key))
        expect(returned!.fields[key]).toBe(value);
  }
  const sheet = new TextDecoder().decode(reviewed.get('xl/worksheets/sheet2.xml'));
  expect(sheet).toContain('09BAD');
  expect(sheet).toContain('Retained');
  expect(sheet).toContain('09123456789');
  expect(sheet).toContain('Needs correction');
  const messages = parsed.rows[0].errors.map((error: { message: string }) => error.message);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.some((message: string) => sheet.includes(message))).toBe(true);
  const styles = new TextDecoder().decode(reviewed.get('xl/styles.xml'));
  const mobileRef =
    column(WORKFLOW_COLUMNS.Customers.findIndex((c) => c.key === 'mobile') + 1) + '2';
  const flaggedCell = new RegExp('<c\\b[^>]*r="' + mobileRef + '"[^>]*>').exec(sheet)![0];
  const styleId = Number(/\bs="(\d+)"/.exec(flaggedCell)![1]);
  const xfs = [
    .../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/
      .exec(styles)![1]!
      .matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g),
  ];
  const fillId = Number(/fillId="(\d+)"/.exec(xfs[styleId]![0])![1]);
  const fills = [
    .../<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles)![1]!.matchAll(/<fill\b[\s\S]*?<\/fill>/g),
  ];
  expect(fills[fillId]![0]).toContain('FFFADBD8');
  // Correct the entered value in the downloaded workbook, then re-upload it.
  reviewed.set(
    'xl/worksheets/sheet2.xml',
    new TextEncoder().encode(sheet.replace('09BAD', '09123456780')),
  );
  const corrected = Buffer.from(
    zipStored(
      [...reviewed].map(([name, data]) => ({ name, data })),
      true,
    ),
  );
  const again = await json(
    await request('parse', cookie, {
      source: 'excel',
      contentBase64: corrected.toString('base64'),
    }),
    201,
  );
  expect(again.job).toMatchObject({ totalRows: 2, invalidRows: 0 });
  const refreshed = new TextDecoder().decode(
    readWorkbookParts(Buffer.from(again.reviewFile.content, 'base64')).get(
      'xl/worksheets/sheet2.xml',
    ),
  );
  expect(refreshed).not.toContain('Needs correction');
  expect(refreshed).toContain('Retained');
  expect(await col('customers').countDocuments()).toBe(before);
  // Two full workbook builds/uploads plus re-parsing and cell-level review checks.
}, 30000);

it.each([
  ['Fully Paid', 'activation'], ['Active VIP', 'active'],
])('uploads, reviews and confirms an actual %s guided workbook through native HTTP', async (status, stage) => {
  const parts = readWorkbookParts(customerWorkflowTemplate());
  const email = `historical-review-${stage}@example.invalid`;
  const sheets = [
    ['Customers', 2, { first_name: 'Synthetic', last_name: 'Historical', email,
      mobile: '09123456789', vip_tier: 'BRONZE', stated_payment_scheme: 'Spot cash',
      stated_status: status, contract_date: '2025-01-01', stated_regular_price: '100000', stated_rf: '10000',
      existing_card_activation_date: '2025-01-02', existing_card_valid_until: '2047-01-02', existing_stay_points_total: '101',
    }],
    ['Sales Team', 4, { customer_key: email, referrer_name: 'SYNTHETIC OST MEMBER' }],
  ] as const;
  for (const [name, index, values] of sheets) {
    const path = `xl/worksheets/sheet${index}.xml`;
    let xml = new TextDecoder().decode(parts.get(path));
    for (const [key, value] of Object.entries(values)) {
      const position = WORKFLOW_COLUMNS[name].findIndex((c) => c.key === key) + 1;
      expect(position).toBeGreaterThan(0);
      const column = (n: number): string => n > 26 ? column(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + (n - 1) % 26) : String.fromCharCode(64 + n);
      const ref = column(position) + '2';
      const cell = new RegExp('<c\\b[^>]*r="' + ref + '"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');
      expect(xml).toMatch(cell);
      xml = xml.replace(cell, `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`);
    }
    parts.set(path, new TextEncoder().encode(xml));
  }
  const input = { source: 'excel', externalVerificationReason: 'Certified synthetic historical records',
    contentBase64: Buffer.from(zipStored([...parts].map(([name, data]) => ({ name, data })), true)).toString('base64') };
  const customers = await col('customers').countDocuments(), payments = await col('payments').countDocuments();
  const parsed = await json(await request('parse', cookie, input), 201);
  expect(parsed.job).toMatchObject({ validRows: 1, invalidRows: 0, status: 'ready' });
  expect(parsed.rows[0].normalized).toMatchObject({ externalVerified: true,
    externalSummary: { stage, paid: '100000.00', settlement: 'certified' },
    continuationPreview: { stage, externallyVerified: true },
  });
  expect(await preview(parsed.rows[0].id)).toMatchObject({ stage, externallyVerified: true });
  expect(await col('customers').countDocuments()).toBe(customers);
  expect(await col('payments').countDocuments()).toBe(payments);
  for (const [moduleKey, action] of [['sales.customers', 'create'], ['sales.card_sales', 'create'], ['finance.payment_verification', 'update']] as const) {
    const module = await col('modules').findOne({ key: moduleKey }), id = randomUUID();
    await col('staff_permission_restrictions').insertOne({ _id: id, staff_id: fixture.admin.id, module_id: module!._id, [`deny_${action}`]: true });
    try { await json(await request('parse', cookie, input), 403); }
    finally { await col('staff_permission_restrictions').deleteOne({ _id: id }); }
  }
  const confirmed = await json(await request(`jobs/${parsed.job.id}/confirm`, cookie, {}));
  expect(confirmed).toMatchObject({ failed: 0, committed: 1, job: { status: 'completed' } });
  const saved = await preview(parsed.rows[0].id);
  expect(saved).toMatchObject({ stage, externallyVerified: true, externalSummary: { paid: '100000.00', balance: '0.00' } });
  expect(saved.customerId).toEqual(expect.any(String));
  expect(saved.saleId).toEqual(expect.any(String));
  expect(await col('customers').countDocuments({ email })).toBe(1);
  expect(await col('card_sales').findOne({ _id: saved.saleId })).toMatchObject({ origin: 'legacy_import', cash_price_snapshot: '100000.00' });
  expect(await col('payments').findOne({ sale_id: saved.saleId })).toMatchObject({ method: 'historical_certification', status: 'verified', amount: '100000.00' });
  expect(await col('commissions').countDocuments({ sale_id: saved.saleId })).toBe(0);
  const membership = await col('memberships').findOne({ sale_id: saved.saleId });
  if (stage === 'active') {
    expect(membership).toMatchObject({ status: 'active', activated_at: '2025-01-01T16:00:00.000Z', expires_at: '2047-01-01T16:00:00.000Z' });
    expect(await col('points_accounts').findOne({ membership_id: membership!._id })).toMatchObject({ balance: 101, weekday_balance: 71, weekend_balance: 30 });
  } else expect(membership).toBeNull();
  await json(await request(`jobs/${parsed.job.id}/confirm`, cookie, {}));
  expect(await col('customers').countDocuments({ email })).toBe(1);
  expect(await col('payments').countDocuments({ sale_id: saved.saleId })).toBe(1);
  expect(await col('memberships').countDocuments({ sale_id: saved.saleId })).toBe(stage === 'active' ? 1 : 0);
}, 15000);

it('denies import mutations without their permissions and rolls review persistence back on audit failure', async () => {
  const input = {
    source: 'csv',
    contentBase64: Buffer.from(
      'first_name,last_name,email,mobile,source_status\nSynthetic,Audit,audit-review@example.invalid,09123456789,Pending',
    ).toString('base64'),
  };
  const module = await col('modules').findOne({ key: 'governance.customer_import' }),
    restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_create: true,
  });
  try {
    await json(await request('parse', cookie, input), 403);
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
  const jobs = await col('customer_import_jobs').countDocuments(),
    rows = await col('customer_import_rows').countDocuments();
  const counters = await col('counters').find().sort({ _id: 1 }).toArray();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_IMPORT_PARSED' } },
  });
  try {
    await json(await request('parse', cookie, input), 503);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(await col('customer_import_jobs').countDocuments()).toBe(jobs);
  expect(await col('customer_import_rows').countDocuments()).toBe(rows);
  expect(await col('counters').find().sort({ _id: 1 }).toArray()).toEqual(counters);
});
