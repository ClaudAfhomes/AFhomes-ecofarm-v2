import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { analyticsOverviewSchema, salesTrendReportSchema, identityDocumentSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { LocalPrivateObjectStore } from './private-object-store.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';
import type { MongoRow } from './customer-activation.mongo.js';

let replica: Awaited<ReturnType<typeof createTestReplica>>, server: http.Server;
let base = '',
  cookie = '',
  root = '',
  customer = '',
  actor = '',
  document = '';
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const col = (name: string) => replica.db.collection<MongoRow>(name);
async function request(suffix: string, body?: unknown, auth = cookie, method?: string) {
  return fetch(base + '/api/v1' + suffix, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: auth } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect({ status: response.status, data }).toMatchObject({ status });
  return data;
}
const uploadInput = () => ({
  subjectType: 'customer',
  subjectId: customer,
  mime: 'image/jpeg',
  sizeBytes: bytes.length,
  originalFilename: 'fictional-id.jpg',
  idType: 'passport',
});
beforeAll(async () => {
  replica = await createTestReplica({ timeoutMS: 15000 });
  root = await mkdtemp(path.join(tmpdir(), 'afhomes-document-test-'));
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-document-secret'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  const fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticDocument123!');
  customer = fixture.customer.id;
  actor = fixture.admin.id;
  const store = new LocalPrivateObjectStore({
    root,
    baseURL: base,
    secret: 'synthetic-private-file-secret'.repeat(2),
  });
  server.on(
    'request',
    createMongoDevelopmentHandler(
      createMongoPhase5Runtime(replica.db, replica.client, env, {}, store),
      { coreWritesEnabled: true },
    ),
  );
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.admin.email, password: 'SyntheticDocument123!' },
    '',
  );
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((row) => row.split(';')[0])
    .join('; ');
  await json(
    await request('/admin/afhomes/session/password', {
      currentPassword: 'SyntheticDocument123!',
      newPassword: 'SyntheticDocumentReady123!',
      confirmPassword: 'SyntheticDocumentReady123!',
    }),
  );
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await replica?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

it('uses private signed byte upload, server verification, current-ID selection and masked review over HTTP', async () => {
  expect(
    await json(await request(`/documents/current?subjectType=customer&subjectId=${customer}`)),
  ).toEqual({ currentDocument: null });
  const grant = await json(await request('/documents/customer/upload-url', uploadInput()), 201);
  document = grant.documentId;
  expect(grant.uploadUrl).not.toContain('storage_path');
  expect((await request('/documents/' + document)).status).toBe(200);
  expect((await request('/documents/' + document + '/complete-upload', {})).status).toBe(409);
  expect((await fetch(new URL(grant.uploadUrl, base), { method: 'GET' })).status).toBe(403);
  const attempts = await Promise.all(
    [1, 2].map(() => fetch(new URL(grant.uploadUrl, base), { method: 'PUT', body: bytes })),
  );
  expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
  const completed = identityDocumentSchema.parse(
    await json(await request('/documents/' + document + '/complete-upload', {})),
  );
  expect(completed).toMatchObject({
    hasFile: true,
    isCurrent: true,
    verificationStatus: 'pending_review',
  });
  expect(await json(await request('/documents/' + document + '/complete-upload', {}))).toEqual(
    completed,
  );
  const access = await json(await request('/documents/' + document + '/access-url'));
  expect(Buffer.from(await (await fetch(access.url)).arrayBuffer())).toEqual(bytes);
  const lookup = await json(await request('/memberships/customer-lookup?search=SYNTHETIC'));
  expect(lookup.data[0].governmentIdImageUrl).toEqual(expect.any(String));
  expect(Buffer.from(await (await fetch(lookup.data[0].governmentIdImageUrl)).arrayBuffer())).toEqual(bytes);
  const confirmed = await json(
    await request('/documents/' + document + '/confirm', {
      decision: 'confirmed',
      fields: { idNumber: 'FICTIONAL-12345678', idType: 'passport' },
    }),
  );
  expect(confirmed.verificationStatus).toBe('confirmed');
  expect(JSON.stringify(confirmed)).not.toContain('FICTIONAL-12345678');
  expect((await col('customers').findOne({ _id: customer }))!.government_id_number).toBe(
    'FICTIONAL-12345678',
  );
  const auditCount = await col('audit_events').countDocuments({ entity_id: document });
  await json(
    await request('/documents/' + document + '/confirm', {
      decision: 'confirmed',
      fields: { idNumber: 'FICTIONAL-12345678', idType: 'passport' },
    }),
  );
  expect(await col('audit_events').countDocuments({ entity_id: document })).toBe(auditCount);
  expect(
    JSON.stringify(await col('audit_events').find({ entity_id: document }).toArray()),
  ).not.toContain('FICTIONAL-12345678');
  const ocr = await json(await request('/documents/' + document + '/ocr', {}));
  expect(ocr.ocrStatus).toBe('unavailable');
  expect(ocr.verificationStatus).toBe('confirmed');
  const list = await json(
    await request(`/documents?subjectType=customer&subjectId=${customer}&view=summary&limit=1`),
  );
  expect(list.meta.total).toBe(1);
  expect(list.data[0].extractedFields).toBeUndefined();
}, 30000);

it('rejects anonymous, malformed, wrong-size and forged uploads and enforces seller scope', async () => {
  expect((await request('/documents/' + document, undefined, '')).status).toBe(401);
  const grant = await json(await request('/documents/customer/upload-url', uploadInput()), 201);
  expect(
    (await fetch(new URL(grant.uploadUrl + 'bad', base), { method: 'PUT', body: bytes })).status,
  ).toBe(403);
  expect(
    (await fetch(new URL(grant.uploadUrl, base), { method: 'PUT', body: Buffer.from('no') }))
      .status,
  ).toBe(400);
  expect(
    (
      await fetch(new URL(grant.uploadUrl, base), {
        method: 'PUT',
        body: Buffer.alloc(bytes.length),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(new URL(grant.uploadUrl, base), {
        method: 'PUT',
        body: Buffer.alloc(bytes.length + 1),
      })
    ).status,
  ).toBe(400);
  expect((await col('identity_documents').findOne({ _id: grant.documentId }))!.sha256).toBe(
    '0'.repeat(64),
  );
  const assignment = await col('staff_role_assignments').findOne({ staff_id: actor });
  const salesRole = await col('roles').findOne({ slug: 'sales_manager' });
  await col('staff_role_assignments').updateOne(
    { staff_id: actor },
    { $set: { role_id: salesRole!._id } },
  );
  await col('customers').updateOne({ _id: customer }, { $set: { created_by: randomUUID() } });
  expect((await request('/documents/customer/upload-url', uploadInput())).status).toBe(403);
  // Sellers can still read their own uploads, exactly as in the source.
  expect((await request('/documents/' + document)).status).toBe(200);
  await col('identity_documents').updateOne(
    { _id: document },
    { $set: { uploaded_by: randomUUID() } },
  );
  expect((await request('/documents/' + document)).status).toBe(403);
  expect(
    await json(await request(`/documents/current?subjectType=customer&subjectId=${customer}`)),
  ).toEqual({ currentDocument: null });
  await col('identity_documents').updateOne({ _id: document }, { $set: { uploaded_by: actor } });
  await col('staff_role_assignments').updateOne(
    { staff_id: actor },
    { $set: { role_id: assignment!.role_id } },
  );
});

it('rolls review and customer mirroring back with failed audit and keeps rejected IDs out of current selection', async () => {
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'IDENTITY_DOCUMENT_REJECTED' } },
  });
  expect(
    (
      await request('/documents/' + document + '/confirm', {
        decision: 'rejected',
        fields: { idType: 'passport' },
      })
    ).status,
  ).toBe(503);
  expect((await col('identity_documents').findOne({ _id: document }))!.verification_status).toBe(
    'confirmed',
  );
  await replica.db.command({ collMod: 'audit_events', validator: {} });
  await json(
    await request('/documents/' + document + '/confirm', {
      decision: 'rejected',
      fields: { idType: 'passport' },
    }),
  );
  expect(
    await json(await request(`/documents/current?subjectType=customer&subjectId=${customer}`)),
  ).toEqual({ currentDocument: null });
});

it('keeps the newest file current when an older file is reviewed and falls back after rejection', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const grant = await json(await request('/documents/customer/upload-url', uploadInput()), 201);
    expect(
      (await fetch(new URL(grant.uploadUrl, base), { method: 'PUT', body: bytes })).status,
    ).toBe(200);
    await json(await request(`/documents/${grant.documentId}/complete-upload`, {}));
    ids.push(grant.documentId);
  }
  const reviewed = await json(
    await request(`/documents/${ids[0]}/confirm`, {
      decision: 'confirmed',
      fields: { idType: 'passport' },
    }),
  );
  expect(reviewed.isCurrent).toBe(false);
  expect(
    (await json(await request(`/documents/current?subjectType=customer&subjectId=${customer}`)))
      .currentDocument.id,
  ).toBe(ids[1]);
  await json(
    await request(`/documents/${ids[1]}/confirm`, {
      decision: 'rejected',
      fields: { idType: 'passport' },
    }),
  );
  expect(
    (await json(await request(`/documents/current?subjectType=customer&subjectId=${customer}`)))
      .currentDocument.id,
  ).toBe(ids[0]);
});

it('does not reserve a pending document if its creation audit cannot commit', async () => {
  const count = await col('identity_documents').countDocuments();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'IDENTITY_DOCUMENT_UPLOADED' } },
  });
  expect((await request('/documents/customer/upload-url', uploadInput())).status).toBe(503);
  expect(await col('identity_documents').countDocuments()).toBe(count);
  await replica.db.command({ collMod: 'audit_events', validator: {} });
});

it('serves dashboard overview and trend through the real cookie-authorized runtime and read gate',async()=>{
 const overview=analyticsOverviewSchema.parse(await json(await request('/analytics?period=month')));
 expect(overview.scope.kind).toBe('global');
 expect(overview.organization?.totalStaff).toBeGreaterThan(0);
 const trend=salesTrendReportSchema.parse(await json(await request('/analytics/sales-trend')));
 expect(trend.periods).toHaveLength(12);
 expect((await request('/analytics?period=month',undefined,'')).status).toBe(401);
});

it('reads the optional normal-reservation claim panel through the narrow development gate',async()=>{
 const id=randomUUID();
 await col('reservation_agreements').insertOne({_id:id,customer_application_id:randomUUID()});
 expect(await json(await request(`/customer-imports/reservations/${id}/claims`))).toEqual([]);
 expect((await request(`/customer-imports/reservations/${id}/claims`,undefined,'')).status).toBe(401);
 expect(await json(await request('/customer-imports/continuations'))).toEqual([]);
 expect((await request('/customer-imports/continuations',undefined,'')).status).toBe(401);
});
