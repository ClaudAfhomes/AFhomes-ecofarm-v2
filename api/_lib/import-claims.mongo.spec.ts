import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { importPaymentClaimSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { LocalPrivateObjectStore } from './private-object-store.js';
import type { MongoRow } from './customer-activation.mongo.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let server: http.Server,
  base = '',
  cookie = '',
  root = '';
const source = randomUUID(),
  row = randomUUID(),
  application = randomUUID(),
  reservation = randomUUID(),
  terms = randomUUID();
const col = (name: string) => replica.db.collection<MongoRow>(name);
async function request(route: string, body?: unknown, auth = cookie) {
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
async function claims(query = '') {
  return json(await request(`reservations/${reservation}/claims${query}`));
}
async function claim(reference: string = randomUUID()) {
  const id = randomUUID();
  await col('customer_import_payment_claims').insertOne({
    _id: id,
    source_id: source,
    claim_reference: 'Synthetic claim ' + id,
    normalized_reference: id,
    purpose: 'reservation',
    amount: '100.00',
    payment_date: '2024-01-01',
    method: 'cash',
    bank_reference: reference,
    notes: 'Synthetic workbook claim',
    fingerprint: reference,
    status: 'claim',
    payment_id: null,
    proof_id: null,
    proof_uploaded_at: null,
    updated_at: new Date().toISOString(),
    private_test_field: 'must not leak',
  });
  return id;
}
async function reviewed(id: string) {
  return (await claims()).find((r: { id: string }) => r.id === id);
}
const reconcile = (
  id: string,
  review: Record<string, unknown>,
  decision: unknown,
  requestId = randomUUID(),
) =>
  request(`payment-claims/${id}/reconcile`, {
    requestId,
    expectedClaimVersion: review.expectedClaimVersion,
    expectedTargetVersion: review.expectedTargetVersion,
    decision,
  });
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-import-claims-only'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticImport123!');
  root = await mkdtemp(path.join(tmpdir(), 'afhomes-import-proof-'));
  const objects = new LocalPrivateObjectStore({
    root,
    baseURL: base,
    secret: env.BETTER_AUTH_SECRET,
  });
  server.on('request', createMongoPhase5Runtime(replica.db, replica.client, env, {}, objects));
  const signed = await fetch(base + '/api/v1/auth/identity/sign-in/email', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.admin.email, password: 'SyntheticImport123!' }),
  });
  await json(signed);
  cookie = signed.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  await json(
    await fetch(base + '/api/v1/admin/afhomes/session/password', {
      method: 'POST',
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'SyntheticImport123!',
        newPassword: 'SyntheticImportReady123!',
        confirmPassword: 'SyntheticImportReady123!',
      }),
    }),
  );
  await col('customer_import_rows').insertOne({
    _id: row,
    customer_id: fixture.customer.id,
    raw_data: { email: fixture.customer.email, sm_name: 'SYNTHETIC SALES MANAGER' },
  });
  await col('customer_import_purchase_sources').insertOne({
    _id: source,
    original_row_id: row,
    customer_id: fixture.customer.id,
    application_id: application,
    normalized_reference: 'synthetic-claim-source',
    issuer_scope: 'afhomes',
  });
  await col('customer_import_source_rows').insertOne({
    _id: randomUUID(),
    row_id: row,
    source_id: source,
  });
  await col('customer_applications').insertOne({
    _id: application,
    application_number: 'SYNTHETIC-APP',
    customer_id: fixture.customer.id,
    status: 'approved',
  });
  await col('customer_application_purchase_terms').insertOne({
    _id: terms,
    customer_id: fixture.customer.id,
    application_id: application,
    total_price: '100000.00',
    version: 1,
  });
  await col('reservation_agreements').insertOne({
    _id: reservation,
    reservation_number: 'SYNTHETIC-RES',
    customer_id: fixture.customer.id,
    customer_application_id: application,
    purchase_terms_id: terms,
    seller_staff_id: fixture.staff.id,
    origin: 'application',
    status: 'executed',
    sale_id: null,
    finalized_at: null,
    total_price_snapshot: '100000.00',
    minimum_down_payment_snapshot: '0.00',
    created_at: '2026-10-27T00:00:00.000Z',
  });
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await replica?.stop();
  if (
    root &&
    path.dirname(root) === tmpdir() &&
    path.basename(root).startsWith('afhomes-import-proof-')
  )
    await rm(root, { recursive: true, force: true });
});

it('lists actual whitelisted claims, duplicate candidates and stable paginated review versions', async () => {
  const id = await claim('synthetic duplicate');
  const pay = randomUUID();
  await col('payments').insertOne({
    _id: pay,
    customer_id: fixture.customer.id,
    reservation_id: reservation,
    status: 'verified',
    amount: '100.0',
    method: 'cash',
    reference: ' SYNTHETIC   DUPLICATE ',
  });
  const result = await reviewed(id);
  importPaymentClaimSchema.parse(result);
  expect(result).toMatchObject({
    id,
    status: 'claim',
    proofUploaded: false,
    duplicateCandidates: [{ paymentId: pay, amount: '100.0' }],
  });
  expect(JSON.stringify(result)).not.toContain('private_test_field');
  expect(await reviewed(id)).toEqual(result);
  expect(await claims('?offset=100')).toEqual([]);
  await json(await request(`sources/${source}/claims?limit=101`), 400);
  await json(await request(`sources/${source}/claims`, undefined, ''), 401);
  expect(await json(await request(`sources/${randomUUID()}/claims`))).toEqual([]);
});

it('holds/rejects without payments, denies stale review after team or customer changes and preserves request replay', async () => {
  const id = await claim(),
    version = await reviewed(id),
    count = await col('payments').countDocuments();
  await col('customers').updateOne(
    { _id: fixture.customer.id },
    { $set: { updated_at: '2026-10-27T01:00:00.000Z' } },
  );
  await json(
    await reconcile(id, version, { kind: 'hold', reason: 'Synthetic Finance review' }),
    409,
  );
  const fresh = await reviewed(id),
    requestId = randomUUID(),
    decision = { kind: 'hold', reason: 'Synthetic Finance review' };
  await Promise.all([
    reconcile(id, fresh, decision, requestId),
    reconcile(id, fresh, decision, requestId),
  ]).then((rs) => Promise.all(rs.map((r) => json(r))));
  expect((await reviewed(id)).status).toBe('held');
  await json(
    await reconcile(id, fresh, { kind: 'reject', reason: 'Different Finance decision' }, requestId),
    409,
  );
  const beforeTeam = await reviewed(id);
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { full_name: 'SYNTHETIC RENAMED MANAGER' } },
  );
  await json(
    await reconcile(id, beforeTeam, { kind: 'reject', reason: 'Synthetic rejected claim' }),
    409,
  );
  await json(
    await reconcile(id, await reviewed(id), { kind: 'reject', reason: 'Synthetic rejected claim' }),
  );
  expect(await col('payments').countDocuments()).toBe(count);
});

it('matches only compatible existing payments and displays later verification without rewriting claims', async () => {
  const id = await claim(),
    pay = randomUUID(),
    review = await reviewed(id);
  await col('payments').insertOne({
    _id: pay,
    customer_id: randomUUID(),
    reservation_id: reservation,
    amount: '100.00',
    method: 'cash',
    status: 'recorded',
  });
  await json(
    await reconcile(id, await reviewed(id), {
      kind: 'match',
      paymentId: pay,
      reason: 'Synthetic matching receipt',
    }),
    409,
  );
  await col('payments').updateOne({ _id: pay }, { $set: { customer_id: fixture.customer.id } });
  const fresh = await reviewed(id);
  await json(
    await reconcile(id, fresh, {
      kind: 'match',
      paymentId: pay,
      reason: 'Synthetic matching receipt',
    }),
  );
  expect((await reviewed(id)).status).toBe('matched');
  await col('payments').updateOne({ _id: pay }, { $set: { status: 'verified' } });
  expect((await reviewed(id)).status).toBe('verified');
  expect((await col('customer_import_payment_claims').findOne({ _id: id }))?.status).toBe(
    'matched',
  );
  await json(
    await reconcile(id, review, {
      kind: 'match',
      paymentId: pay,
      reason: 'Synthetic matching receipt',
    }),
  );
});

async function upload(id: string, bytes = Buffer.from('%PDF-1.4\nSynthetic test receipt')) {
  const grant = await json(
    await request(`payment-claims/${id}/proof/upload`, {
      mime: 'application/pdf',
      sizeBytes: bytes.length,
    }),
    201,
  );
  await json(
    await fetch(grant.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    }),
  );
  await json(
    await request(`payment-claims/${id}/proof/complete`, {
      proofDocumentId: grant.proofDocumentId,
    }),
  );
  return grant;
}
it('validates private proof, records exactly one unverified payment and leaves verified totals unchanged', async () => {
  const id = await claim(),
    review = await reviewed(id);
  await json(await request(`payment-claims/${id}/proof`, {}), 404);
  await json(await request(`payment-claims/${id}/reconcile`), 404);
  await json(await reconcile(id, review, { kind: 'record', proofDocumentId: randomUUID() }), 409);
  const grant = await upload(id),
    fresh = await reviewed(id);
  const before = await col('payments').find({ status: 'verified' }).toArray();
  const requestId = randomUUID(),
    decision = { kind: 'record', proofDocumentId: grant.proofDocumentId };
  const result = await Promise.all([
    reconcile(id, fresh, decision, requestId),
    reconcile(id, fresh, decision, requestId),
  ]).then((rs) => Promise.all(rs.map((r) => json(r))));
  expect(result[0]).toEqual(result[1]);
  const payment = await col('payments').findOne({ _id: result[0].paymentId });
  expect(payment).toMatchObject({
    status: 'recorded',
    amount: '100.00',
    recorded_by: fixture.admin.id,
    payment_type: 'down_payment',
  });
  expect(payment?.notes).toContain('2024-01-01');
  expect(await col('payments').find({ status: 'verified' }).toArray()).toEqual(before);
  expect(
    await col('purchase_document_evidence').countDocuments({
      kind: 'payment_recorded',
      source_id: payment!._id,
    }),
  ).toBe(1);
  const download = await json(await request(`payment-claims/${id}/proof`));
  expect(await (await fetch(download.url)).text()).toContain('Synthetic test receipt');
  await json(await fetch(grant.uploadUrl, { method: 'PUT', body: Buffer.from('replay') }), 409);
});

it('denies duplicate recording without a distinct-payment reason and rolls the whole record back on audit failure', async () => {
  const id = await claim('synthetic duplicate'),
    grant = await upload(id),
    version = await reviewed(id);
  await json(
    await reconcile(id, version, { kind: 'record', proofDocumentId: grant.proofDocumentId }),
    409,
  );
  const payments = await col('payments').countDocuments(),
    evidence = await col('purchase_document_evidence').countDocuments();
  const requestId = randomUUID(),
    decision = {
      kind: 'record',
      proofDocumentId: grant.proofDocumentId,
      distinctPaymentReason: 'Synthetic separate receipt inspected',
    };
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'IMPORTED_PAYMENT_CLAIM_RECONCILED' } },
  });
  try {
    await json(await reconcile(id, version, decision, requestId), 503);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(await col('payments').countDocuments()).toBe(payments);
  expect(await col('purchase_document_evidence').countDocuments()).toBe(evidence);
  expect((await col('customer_import_payment_claims').findOne({ _id: id }))?.payment_id).toBeNull();
  expect(await col('mutation_requests').countDocuments({ request_id: requestId })).toBe(0);
  await json(await reconcile(id, version, decision, requestId));
});

it('requires both Finance and customer permissions and keeps unrelated imports and invalid scopes blocked', async () => {
  expect(await json(await request(`reservations/${randomUUID()}/claims`))).toEqual([]);
  await json(await request(`sources/${source}/claims?offset=-1`), 400);
  await json(await request('sources/not-a-uuid/claims'), 400);
  await json(await request('rows/not-a-supported-route/unknown'), 501);
  const id = await claim(),
    review = await reviewed(id);
  for (const key of ['finance.payment_verification', 'sales.customers']) {
    const module = await col('modules').findOne({ key }),
      restriction = randomUUID();
    await col('staff_permission_restrictions').insertOne({
      _id: restriction,
      staff_id: fixture.admin.id,
      module_id: module!._id,
      deny_view: true,
    });
    try {
      await json(await request(`sources/${source}/claims`), 403);
      await json(await reconcile(id, review, { kind: 'hold', reason: 'Synthetic reason' }), 403);
      await json(
        await request(`payment-claims/${id}/proof/upload`, {
          mime: 'application/pdf',
          sizeBytes: 32,
        }),
        403,
      );
    } finally {
      await col('staff_permission_restrictions').deleteOne({ _id: restriction });
    }
  }
});

it('rejects obsolete, expired, oversized and wrong-signature receipt grants without completing proof', async () => {
  const id = await claim(),
    bytes = Buffer.from('%PDF-1.4\nSynthetic test receipt');
  const first = await json(
    await request(`payment-claims/${id}/proof/upload`, {
      mime: 'application/pdf',
      sizeBytes: bytes.length,
    }),
    201,
  );
  const second = await json(
    await request(`payment-claims/${id}/proof/upload`, {
      mime: 'application/pdf',
      sizeBytes: bytes.length,
    }),
    201,
  );
  await json(await fetch(first.uploadUrl, { method: 'PUT', body: bytes }), 403);
  await json(
    await fetch(second.uploadUrl, { method: 'PUT', body: Buffer.alloc(bytes.length, 65) }),
    400,
  );
  await json(
    await fetch(second.uploadUrl, { method: 'PUT', body: Buffer.concat([bytes, bytes]) }),
    400,
  );
  await json(await request(`payment-claims/${id}/proof`), 409);
  await json(
    await request(`payment-claims/${id}/proof/complete`, {
      proofDocumentId: first.proofDocumentId,
    }),
    409,
  );
  await col('customer_import_payment_claims').updateOne(
    { _id: id },
    { $set: { proof_upload_expires: Date.now() - 1 } },
  );
  await json(await fetch(second.uploadUrl, { method: 'PUT', body: bytes }), 403);
  expect(
    (await col('customer_import_payment_claims').findOne({ _id: id }))?.proof_uploaded_at,
  ).toBeNull();
  await json(
    await request(`payment-claims/${id}/proof/upload`, {
      mime: 'text/html',
      sizeBytes: bytes.length,
    }),
    400,
  );
  await json(
    await request(`payment-claims/${id}/proof/upload`, {
      mime: 'application/pdf',
      sizeBytes: 11 * 1024 * 1024,
    }),
    400,
  );
});

it('invalidates review after holder, frozen term, membership or points changes', async () => {
  const id = await claim();
  for (const [table, extra] of [
    ['customer_application_holders', { application_id: application }],
    ['customer_application_purchase_terms', { customer_id: fixture.customer.id }],
    ['memberships', { customer_id: fixture.customer.id }],
    ['points_accounts', { membership_id: fixture.customer.membership }],
  ] as const) {
    const before = await reviewed(id),
      existing = await col(table).findOne(extra),
      record = existing?._id ?? randomUUID();
    if (existing)
      await col(table).updateOne(
        { _id: record },
        { $set: { synthetic_revision_marker: new Date() } },
      );
    else
      await col(table).insertOne({ _id: record, ...extra, synthetic_revision_marker: new Date() });
    try {
      await json(
        await reconcile(id, before, { kind: 'hold', reason: 'Synthetic stale graph' }),
        409,
      );
    } finally {
      if (existing)
        await col(table).updateOne({ _id: record }, { $unset: { synthetic_revision_marker: '' } });
      else await col(table).deleteOne({ _id: record });
    }
  }
});
