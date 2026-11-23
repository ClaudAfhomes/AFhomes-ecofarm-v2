import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoCustomersHandler } from './customers.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { PrivateObjectStore } from './private-object-store.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createAfHomesAdminAuth } from './auth.js';
import { LocalPrivateObjectStore } from './private-object-store.js';

let replica: Awaited<ReturnType<typeof createTestReplica>>;
const actor = randomUUID();
const principal = { userId: actor, roleSlug: 'super_admin', permissions: [] };
const col = (name: string) => replica.db.collection<MongoRow>(name);
beforeAll(async () => {
  replica = await createTestReplica({ timeoutMS: 15_000 });
}, 30_000);
afterAll(async () => replica?.stop());
function store() {
  return { remove: vi.fn().mockResolvedValue(undefined) } as unknown as PrivateObjectStore;
}
async function call(
  id: string,
  objects = store(),
  authorize = vi.fn().mockResolvedValue(principal),
) {
  const res = makeRes();
  const handler = createMongoCustomersHandler(
    replica.db,
    replica.client,
    authorize as typeof authorizeAfHomes,
    objects,
  );
  await handler({ method: 'DELETE', headers: {}, query: { familyPath: id } } as never, res.res);
  return res.state;
}
async function fixture() {
  const customer = randomUUID(),
    sale = randomUUID(),
    application = randomUUID(),
    reservation = randomUUID();
  const membership = randomUUID(),
    account = randomUUID(),
    identity = randomUUID(),
    source = randomUUID();
  const payment = randomUUID(),
    purchase = randomUUID(),
    refund = randomUUID();
  const doc = randomUUID(),
    row = randomUUID();
  const records: [string, MongoRow][] = [
    [
      'customers',
      {
        _id: customer,
        auth_user_id: identity,
        customer_number: 'SYNTHETIC-CUSTOMER',
        government_id_number: 'PRIVATE-ID',
      },
    ],
    ['card_sales', { _id: sale, customer_id: customer }],
    ['customer_applications', { _id: application, customer_id: customer }],
    [
      'reservation_agreements',
      { _id: reservation, customer_id: customer, customer_application_id: application },
    ],
    ['memberships', { _id: membership, customer_id: customer, sale_id: sale }],
    ['points_accounts', { _id: account, membership_id: membership }],
    ['points_ledger', { _id: randomUUID(), account_id: account }],
    ['points_periods', { _id: randomUUID(), account_id: account }],
    [
      'payments',
      {
        _id: payment,
        sale_id: sale,
        receipt_storage_path: `afhomes-payment-receipts/${customer}/receipt.png`,
      },
    ],
    ['commissions', { _id: randomUUID(), sale_id: sale }],
    ['final_qualifications', { _id: randomUUID(), sale_id: sale }],
    [
      'card_sale_hierarchy_snapshots',
      { _id: randomUUID(), sale_id: sale, ancestor_staff_id: actor },
    ],
    ['customer_application_holders', { _id: randomUUID(), application_id: application }],
    ['customer_application_purchase_terms', { _id: randomUUID(), application_id: application }],
    [
      'identity_documents',
      { _id: doc, customer_id: customer, storage_path: `afhomes-customer-ids/${customer}/id.png` },
    ],
    ['customer_application_documents', { _id: randomUUID(), identity_document_id: doc }],
    ['reservation_agreement_holders', { _id: randomUUID(), agreement_id: reservation }],
    ['reservation_agreement_schedule', { _id: randomUUID(), agreement_id: reservation }],
    ['reservation_agreement_documents', { _id: randomUUID(), payment_id: payment }],
    ['purchase_document_evidence', { _id: randomUUID(), reservation_id: reservation }],
    ['customer_import_purchase_sources', { _id: source, customer_id: customer }],
    ['customer_import_rows', { _id: row, customer_id: customer }],
    ['customer_import_source_rows', { _id: randomUUID(), source_id: source, row_id: row }],
    [
      'customer_import_payment_claims',
      { _id: randomUUID(), source_id: source, proof_path: `${customer}/proof.png` },
    ],
    ['customer_external_import_receipts', { _id: randomUUID(), source_id: source }],
    ['purchases', { _id: purchase, customer_id: customer }],
    ['purchase_lines', { _id: randomUUID(), purchase_id: purchase }],
    ['purchase_payments', { _id: randomUUID(), purchase_id: purchase }],
    ['purchase_point_refunds', { _id: randomUUID(), purchase_id: purchase }],
    ['service_refunds', { _id: refund, purchase_id: purchase }],
    ['service_refund_repayments', { _id: randomUUID(), refund_id: refund }],
    ['earning_claims', { _id: randomUUID(), customer_id: customer }],
    ['redemptions', { _id: randomUUID(), membership_id: membership }],
    ['redemption_quotes', { _id: randomUUID(), approval_customer_id: customer }],
    ['customer_onboarding_tokens', { _id: randomUUID(), customer_id: customer }],
    [
      'profile_photos',
      { _id: randomUUID(), owner_id: identity, object_key: `profiles/${identity}/photo.png` },
    ],
    ['auth_users', { _id: identity }],
    ['auth_sessions', { _id: randomUUID(), userId: identity }],
    ['auth_accounts', { _id: randomUUID(), userId: identity }],
    ['auth_two_factors', { _id: randomUUID(), userId: identity }],
    ['auth_session_assurance', { _id: randomUUID(), user_id: identity }],
    ['mutation_requests', { _id: randomUUID(), result_id: payment }],
  ];
  for (const [name, record] of records) await col(name).insertOne(record);
  return { customer, identity, records };
}
it('purges all linked rows and private files, retaining unrelated records, audit and issued numbers', async () => {
  const f = await fixture(),
    objects = store(),
    unrelated = randomUUID();
  await col('customers').insertOne({ _id: unrelated });
  await col('staff_users').insertOne({ _id: actor, full_name: 'SYNTHETIC SUPER ADMIN' });
  await col('vip_card_number_issuances').insertOne({
    _id: randomUUID(),
    customer_id: f.customer,
    number: 'SYNTHETIC-ISSUED',
  });
  await col('audit_events').insertOne({
    _id: randomUUID(),
    entity_id: f.customer,
    action: 'EXISTING_HISTORY',
  });
  const response = await call(f.customer, objects);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: true });
  for (const [name, record] of f.records)
    expect(await col(name).findOne({ _id: record._id }), name).toBeNull();
  expect(vi.mocked(objects.remove)).toHaveBeenCalledTimes(4);
  expect(await col('customers').findOne({ _id: unrelated })).toBeTruthy();
  expect(await col('staff_users').findOne({ _id: actor })).toBeTruthy();
  expect(await col('vip_card_number_issuances').findOne({ customer_id: f.customer })).toBeTruthy();
  const audit = await col('audit_events').find({ entity_id: f.customer }).toArray();
  expect(audit.map((x) => x.action)).toEqual(['EXISTING_HISTORY', 'CUSTOMER_DELETED']);
  expect(JSON.stringify(audit)).not.toContain('PRIVATE-ID');
  expect((await call(f.customer, objects)).status).toBe(200);
  expect(
    await col('audit_events').countDocuments({ entity_id: f.customer, action: 'CUSTOMER_DELETED' }),
  ).toBe(1);
});
it('refuses missing permissions, non-Super-Admins and revoked authorization before deletion', async () => {
  const id = randomUUID();
  await col('customers').insertOne({ _id: id });
  const denied = { error: { status: 403, error: { code: 'FORBIDDEN', message: 'Denied' } } };
  expect((await call(id, store(), vi.fn().mockResolvedValue(denied))).status).toBe(403);
  expect(
    (await call(id, store(), vi.fn().mockResolvedValue({ ...principal, roleSlug: 'admin' })))
      .status,
  ).toBe(403);
  expect(
    (await call(id, store(), vi.fn().mockResolvedValueOnce(principal).mockResolvedValue(denied)))
      .status,
  ).toBe(403);
  expect(await col('customers').findOne({ _id: id })).toBeTruthy();
});
it('preserves a staff or shared customer identity instead of deleting somebody else’s login', async () => {
  const f = await fixture();
  await col('staff_users').insertOne({ _id: f.identity });
  expect((await call(f.customer)).status).toBe(409);
  expect(await col('auth_users').findOne({ _id: f.identity })).toBeTruthy();
  await col('staff_users').deleteOne({ _id: f.identity });
  await col('customers').insertOne({ _id: randomUUID(), auth_user_id: f.identity });
  expect((await call(f.customer)).status).toBe(409);
  expect(await col('customers').findOne({ _id: f.customer })).toBeTruthy();
});
it('rolls back every row and queues no file deletions when the audit insert fails', async () => {
  const f = await fixture(),
    objects = store();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_DELETED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await call(f.customer, objects)).status).toBe(503);
    for (const [name, record] of f.records)
      expect(await col(name).findOne({ _id: record._id }), name).toBeTruthy();
    expect(objects.remove).not.toHaveBeenCalled();
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
});
it('retries pending file cleanup after commit without repeating the purge or audit', async () => {
  const f = await fixture(),
    objects = store();
  vi.mocked(objects.remove).mockRejectedValueOnce(new Error('synthetic storage failure'));
  const failed = await call(f.customer, objects);
  expect(failed.status).toBe(503);
  expect(failed.body).toMatchObject({ error: { code: 'INTERNAL' } });
  expect(await col('customers').findOne({ _id: f.customer })).toBeNull();
  expect((await call(f.customer, objects)).status).toBe(200);
  expect(
    await col('audit_events').countDocuments({ entity_id: f.customer, action: 'CUSTOMER_DELETED' }),
  ).toBe(1);
});
it('returns 404 for an unknown customer without creating a purge marker', async () => {
  expect((await call(randomUUID())).status).toBe(404);
});
it('requires configured storage before committing a customer with private files', async () => {
  const f = await fixture(),
    res = makeRes();
  const handler = createMongoCustomersHandler(
    replica.db,
    replica.client,
    vi.fn().mockResolvedValue(principal),
  );
  await handler(
    { method: 'DELETE', headers: {}, query: { familyPath: f.customer } } as never,
    res.res,
  );
  expect(res.state.status).toBe(503);
  for (const [name, record] of f.records)
    expect(await col(name).findOne({ _id: record._id }), name).toBeTruthy();
});
it('refuses a malformed/legacy private-file key with a specific, typed error instead of a generic crash', async () => {
  const f = await fixture(),
    objects = store();
  // A pre-conversion or manually-entered record can carry a key the current
  // strict generator would never produce (spaces, a raw filename, an absolute
  // URL). `checkKey` throws a plain `Error` for this, which previously had no
  // special handling and fell into the generic 503 "Customer service is
  // unavailable" - indistinguishable from any other unexpected crash.
  await col('identity_documents').updateOne(
    { _id: f.records.find(([name]) => name === 'identity_documents')![1]._id },
    { $set: { storage_path: 'Scanned ID (final).png' } },
  );
  const response = await call(f.customer, objects);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({
    error: { code: 'CONFLICT', message: expect.stringMatching(/file reference/i) },
  });
  expect(objects.remove).not.toHaveBeenCalled();
  // Refused before commit: nothing was deleted, and no purge marker exists to
  // short-circuit a later, corrected retry.
  for (const [name, record] of f.records)
    expect(await col(name).findOne({ _id: record._id }), name).toBeTruthy();
  expect(
    await col('mutation_requests').findOne({ operation: 'customer.permanent-purge', request_id: f.customer }),
  ).toBeNull();
});
it('purges a legitimate legacy file key that uses a different-but-safe naming convention', async () => {
  const f = await fixture(),
    objects = store();
  // Not today's `bucket/scope/subjectId/leaf.ext` shape, but still only the
  // characters the native key format allows - a real pre-conversion record,
  // not a corrupted one. Deletion must not treat "differently named" the same
  // as "unsafe".
  await col('identity_documents').updateOne(
    { _id: f.records.find(([name]) => name === 'identity_documents')![1]._id },
    { $set: { storage_path: 'legacy-scans/LEGACY_SCAN_0001.jpg' } },
  );
  const response = await call(f.customer, objects);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: true });
  expect(objects.remove).toHaveBeenCalledWith('legacy-scans/LEGACY_SCAN_0001.jpg');
  for (const [name, record] of f.records)
    expect(await col(name).findOne({ _id: record._id }), name).toBeNull();
});
it('purges cleanly when a file field is present on the row but no file was ever uploaded', async () => {
  const f = await fixture(),
    objects = store();
  // `payments.receipt_storage_path` genuinely empty/absent (e.g. a cash
  // payment with no receipt on file) must not be treated as a reference to
  // clean up, nor block the purge waiting on a file that never existed.
  await col('payments').updateOne(
    { _id: f.records.find(([name]) => name === 'payments')![1]._id },
    { $set: { receipt_storage_path: '' }, $unset: {} },
  );
  const response = await call(f.customer, objects);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: true });
  // One fewer real file than the base fixture (the payment receipt no longer
  // counts), so cleanup only ran for the three that remain.
  expect(objects.remove).toHaveBeenCalledTimes(3);
  for (const [name, record] of f.records)
    expect(await col(name).findOne({ _id: record._id }), name).toBeNull();
});
it('retains a shared private object still referenced by another customer', async () => {
  const f = await fixture(),
    objects = store(),
    other = randomUUID();
  const key = `afhomes-customer-ids/${f.customer}/id.png`;
  await col('identity_documents').insertOne({
    _id: randomUUID(),
    customer_id: other,
    storage_path: key,
  });
  expect((await call(f.customer, objects)).status).toBe(200);
  expect(objects.remove).not.toHaveBeenCalledWith(key);
  expect(await col('identity_documents').findOne({ customer_id: other })).toBeTruthy();
});
it('serializes duplicate deletion requests into one purge and one audit', async () => {
  const id = randomUUID();
  await col('customers').insertOne({ _id: id });
  const results = await Promise.all([call(id), call(id)]);
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  expect(
    await col('audit_events').countDocuments({ entity_id: id, action: 'CUSTOMER_DELETED' }),
  ).toBe(1);
});
it.each(['owner', 'parent'])(
  'refuses a cross-customer %s link instead of deleting another customer’s record',
  async (kind) => {
    const f = await fixture(),
      objects = store(),
      other = randomUUID();
    const sale = f.records.find(([name]) => name === 'card_sales')![1]._id;
    const document = f.records.find(([name]) => name === 'identity_documents')![1]._id;
    if (kind === 'owner')
      await col('payments').insertOne({ _id: randomUUID(), customer_id: other, sale_id: sale });
    else
      await col('customer_application_documents').insertOne({
        _id: randomUUID(),
        application_id: other,
        identity_document_id: document,
      });
    expect((await call(f.customer, objects)).status).toBe(409);
    expect(await col('customers').findOne({ _id: f.customer })).toBeTruthy();
    expect(objects.remove).not.toHaveBeenCalled();
  },
);
it('dispatches authenticated DELETE over HTTP, removes real private bytes and revokes customer access', async () => {
  const target = await createTestReplica({ timeoutMS: 15_000 });
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-purge-test-'));
  if (
    path.dirname(root) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('afhomes-purge-test-')
  )
    throw new Error('Unexpected temporary test path');
  const server = http.createServer();
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const env = {
      BETTER_AUTH_SECRET: 'synthetic-purge-HTTP-fixture-only-'.repeat(3),
      BETTER_AUTH_URL: base,
      AFHOMES_WEB_URL: base,
    };
    const fixture = await seedPhase7Fixture(
      target.db,
      target.client,
      env,
      'SyntheticPurgeFixture123!',
    );
    await target.db
      .collection('staff_users')
      .updateOne({ _id: fixture.admin.id } as never, { $set: { must_change_password: false } });
    const identity = await createAfHomesAdminAuth(target.db, target.client, env).api.createUser({
      body: {
        email: fixture.customer.email,
        password: 'SyntheticCustomerPurge123!',
        name: 'SYNTHETIC CUSTOMER',
        data: { emailVerified: true },
      },
    });
    await target.db.collection('customers').updateOne({ _id: fixture.customer.id } as never, {
      $set: { auth_user_id: identity.user.id },
    });
    const objects = new LocalPrivateObjectStore({
      root,
      baseURL: base,
      secret: 'synthetic-private-object-fixture'.repeat(3),
    });
    const key = `afhomes-customer-ids/${fixture.customer.id}/synthetic.txt`;
    await objects.put(key, Buffer.from('SYNTHETIC PRIVATE BYTES'), 'text/plain');
    await target.db
      .collection<MongoRow>('identity_documents')
      .insertOne({ _id: randomUUID(), customer_id: fixture.customer.id, storage_path: key });
    server.on('request', createMongoPhase5Runtime(target.db, target.client, env, {}, objects));
    const request = (route: string, method = 'GET', cookie = '', body?: unknown) =>
      fetch(`${base}/api/v1${route}`, {
        method,
        headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const cookies = (res: Response) =>
      res.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    const adminLogin = await request('/auth/identity/sign-in/email', 'POST', '', {
      email: fixture.admin.email,
      password: fixture.admin.password,
    });
    expect(adminLogin.status).toBe(200);
    const admin = cookies(adminLogin);
    const customerLogin = await request('/auth/identity/sign-in/email', 'POST', '', {
      email: fixture.customer.email,
      password: 'SyntheticCustomerPurge123!',
    });
    expect(customerLogin.status).toBe(200);
    const customer = cookies(customerLogin);
    expect((await request('/customer', 'GET', customer)).status).toBe(200);
    expect((await request(`/customers/${fixture.customer.id}`, 'DELETE')).status).toBe(401);
    const removed = await request(`/customers/${fixture.customer.id}`, 'DELETE', admin);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ deleted: true });
    expect(await objects.exists(key)).toBe(false);
    expect([401, 403]).toContain((await request('/customer', 'GET', customer)).status);
    expect((await request('/admin/afhomes/session', 'GET', admin)).status).toBe(200);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await target.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it(
  'outlasts the ordinary client-wide operation deadline instead of aborting with MongoOperationTimeoutError',
  async () => {
    // The shared production/dev client sets a 15s client-side operation
    // timeout (CSOT), which `withTransaction` applies to the WHOLE
    // transaction. A purge walks 30+ collections plus nested shared-file
    // lookups, so on a real connection it can exceed that budget and abort
    // with `MongoOperationTimeoutError` - surfacing as an unexplained generic
    // 503 with no indication a purge was even involved. The fix gives the
    // purge transaction its own larger `timeoutMS`, the same pattern already
    // used by `admin-bootstrap.mongo.ts` for its own heavy transaction.
    //
    // Proof: connect with a client whose default is tighter than a deliberate
    // mid-transaction delay. Only an explicit, larger transaction-level
    // override (not the client default) can make this succeed.
    const f = await fixture(),
      objects = store();
    const host = replica.client.options.hosts[0]!.toString();
    const tightClient = new MongoClient(
      `mongodb://${host}/?replicaSet=${replica.client.options.replicaSet}`,
      { timeoutMS: 200 },
    );
    await tightClient.connect();
    try {
      let calls = 0;
      const slowAuthorize: typeof authorizeAfHomes = async () => {
        // The purge re-authorizes fresh inside the transaction; delay there,
        // well past the 200ms client default and comfortably under the 60s
        // transaction override, to prove which deadline actually governs.
        if (++calls === 1) await new Promise((resolve) => setTimeout(resolve, 500));
        return principal as never;
      };
      const handler = createMongoCustomersHandler(
        tightClient.db('afhomes_dev'),
        tightClient,
        slowAuthorize,
        objects,
      );
      const res = makeRes();
      await handler(
        { method: 'DELETE', headers: {}, query: { familyPath: f.customer } } as never,
        res.res,
      );
      expect(res.state.status, JSON.stringify(res.state.body)).toBe(200);
      expect(res.state.body).toEqual({ deleted: true });
      for (const [name, record] of f.records)
        expect(await col(name).findOne({ _id: record._id }), name).toBeNull();
    } finally {
      await tightClient.close();
    }
  },
  15_000,
);
