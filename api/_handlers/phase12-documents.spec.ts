import { installDocumentReviewRpc } from '../_lib/testing/document-review-rpc.js';
/**
 * AF Homes Phase 12 - identity documents and OCR-assisted extraction.
 *
 * Drives the REAL documents handler, the REAL staff principal resolver, the
 * REAL contracts and the REAL OCR abstraction against the in-memory Supabase
 * fake. Storage is the only seam (`vi.mock` on `_lib/storage.js`, the same
 * seam production uses); the HTTP OCR provider is exercised with a stubbed
 * `fetch`, so the manual-fallback and failure paths run their real code.
 *
 * Load-bearing assertions: OCR output never touches a customer record, the
 * raw storage path never leaves the server, ID numbers are masked on read
 * and absent from audits, and unrelated sellers see nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const store = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

vi.mock('../_lib/storage.js', () => ({
  storageClient: () => ({}),
  createUploadGrant: async (_storage: unknown, bucket: string, path: string) => ({
    uploadUrl: `https://storage.test/upload/${bucket}/${path}`,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }),
  createDownloadGrant: async (_storage: unknown, bucket: string, path: string, ttl: number) => ({
    url: `https://storage.test/download/${bucket}/${path}?ttl=${ttl}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
  downloadObject: async (_storage: unknown, bucket: string, path: string) => {
    const bytes = store.objects.get(`${bucket}/${path}`);
    return bytes ? { bytes } : { error: 'NoSuchKey: object not found' };
  },
}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

const documents = (await import('./documents.js')).default;
const { selectHandler } = await import('../_lib/router.js');
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SM_ID = '22222222-2222-4222-8222-222222222222';
const SM2_ID = '22222222-2222-4222-8222-222222222223';
const EMP_ID = '33333333-3333-4333-8333-333333333333';
const CUST1 = '44444444-4444-4444-8444-444444444444';
const CUST2 = '44444444-4444-4444-8444-444444444445';
const APP1 = '55555555-5555-4555-8555-555555555555';
const APP2 = '55555555-5555-4555-8555-555555555556';

const ADMIN_TOKEN = 'tok-admin';
const SM_TOKEN = 'tok-sm';
const SM2_TOKEN = 'tok-sm2';
const EMP_TOKEN = 'tok-emp';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x46, 0x00, 0x01]);

type Row = Record<string, unknown>;

function tables(): Record<string, Row[]> {
  return {
    modules: [
      { id: 'm-docs', key: 'sales.id_documents', is_active: true },
      { id: 'm-ost', key: 'network.ost_registrations', is_active: true },
    ],
    roles: [
      { id: 'r-admin', slug: 'admin', name: 'Admin', is_active: true },
      { id: 'r-seller', slug: 'sales_manager', name: 'Sales Manager', is_active: true },
      { id: 'r-emp', slug: 'employee', name: 'Employee', is_active: true },
    ],
    role_permissions: [
      {
        role_id: 'r-admin',
        module_id: 'm-docs',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-admin',
        module_id: 'm-ost',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-seller',
        module_id: 'm-docs',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-seller',
        module_id: 'm-ost',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
    ],
    staff_users: [
      { id: ADMIN_ID, email: 'admin@afhomes.test', full_name: 'Ada Admin', status: 'active' },
      { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
      { id: SM2_ID, email: 'sm2@afhomes.test', full_name: 'Sue Manager', status: 'active' },
      { id: EMP_ID, email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
    ],
    staff_role_assignments: [
      { staff_id: ADMIN_ID, role_id: 'r-admin' },
      { staff_id: SM_ID, role_id: 'r-seller' },
      { staff_id: SM2_ID, role_id: 'r-seller' },
      { staff_id: EMP_ID, role_id: 'r-emp' },
    ],
    staff_permission_restrictions: [],
    customers: [
      {
        id: CUST1,
        email: 'c1@example.invalid',
        status: 'prospect',
        created_by: SM_ID,
        government_id_number: null,
      },
      {
        id: CUST2,
        email: 'c2@example.invalid',
        status: 'prospect',
        created_by: SM2_ID,
        government_id_number: null,
      },
    ],
    ost_applications: [
      { id: APP1, sponsor_staff_id: SM_ID, email: 'a1@example.invalid', status: 'submitted' },
      { id: APP2, sponsor_staff_id: SM2_ID, email: 'a2@example.invalid', status: 'submitted' },
    ],
    identity_documents: [],
    audit_events: [],
  };
}

function install() {
  store.objects.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  const db = new FakeSupabase({
    links: [
      { child: 'identity_documents', parent: 'customers', fk: 'customer_id' },
      { child: 'identity_documents', parent: 'ost_applications', fk: 'ost_application_id' },
    ],
    tables: tables() as never,
    tokens: {
      [ADMIN_TOKEN]: {
        id: ADMIN_ID,
        email: 'admin@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
      [SM_TOKEN]: {
        id: SM_ID,
        email: 'sm@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
      [SM2_TOKEN]: {
        id: SM2_ID,
        email: 'sm2@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
      [EMP_TOKEN]: {
        id: EMP_ID,
        email: 'emp@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    },
  });
  installDocumentReviewRpc(db);
  holder.db = db as unknown;
  return db;
}

beforeEach(() => {
  resetIdentifierRateLimit();
  install();
});

type State = { status: number; body: unknown };

async function call(options: {
  path: string;
  method?: string;
  token?: string | null;
  body?: unknown;
  query?: Record<string, string>;
}): Promise<State> {
  const { res, state } = makeRes();
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  await documents(
    {
      method: options.method ?? 'GET',
      query: { familyPath: options.path, ...options.query },
      headers,
      body: options.body,
    } as never,
    res as never,
  );
  return state;
}

const uploadBody = {
  subjectType: 'customer',
  subjectId: CUST1,
  mime: 'image/jpeg',
  sizeBytes: JPEG.length,
  originalFilename: 'id.jpg',
};

async function uploaded(
  token: string = SM_TOKEN,
  body: unknown = uploadBody,
): Promise<{ id: string; path: string }> {
  const state = await call({ method: 'POST', path: 'customer/upload-url', token, body });
  expect(state.status).toBe(201);
  const grant = state.body as { documentId: string; bucket: string; uploadUrl: string };
  const row = (holder.db as FakeSupabase)
    .rows('identity_documents')
    .find((r) => r.id === grant.documentId)!;
  const storagePath = String(row.storage_path);
  store.objects.set(storagePath, JPEG);
  return { id: grant.documentId, path: storagePath };
}

/* ================================================================== */
/* Upload grants                                                        */
/* ================================================================== */

describe('upload grants', () => {
  it('1. issues a signed grant on a server-generated private path and audits it', async () => {
    const state = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: uploadBody,
    });
    expect(state.status).toBe(201);
    const grant = state.body as { documentId: string; bucket: string; uploadUrl: string };
    expect(grant.bucket).toBe('afhomes-customer-ids');
    expect(grant.uploadUrl).toMatch(/^https:\/\/storage\.test\/upload\/afhomes-customer-ids\//);
    expect(grant.uploadUrl).not.toContain('/object/public/');
    const row = (holder.db as FakeSupabase)
      .rows('identity_documents')
      .find((r) => r.id === grant.documentId)!;
    expect(String(row.storage_path)).toMatch(
      new RegExp(`^afhomes-customer-ids/customer/${CUST1}/[0-9a-f-]+\\.jpg$`),
    );
    expect(row.sha256).toBe('0'.repeat(64));
    expect(row.ocr_status).toBe('not_requested');
    const audits = (holder.db as FakeSupabase).rows('audit_events');
    expect(audits.map((a) => a.action)).toContain('IDENTITY_DOCUMENT_UPLOADED');
    expect(JSON.stringify(audits)).not.toContain('afhomes-customer-ids/customer');
  });

  it('2. denies strangers: no session, no grant, wrong scope', async () => {
    expect(
      (await call({ method: 'POST', path: 'customer/upload-url', body: uploadBody })).status,
    ).toBe(401);
    expect(
      (
        await call({
          method: 'POST',
          path: 'customer/upload-url',
          token: EMP_TOKEN,
          body: uploadBody,
        })
      ).status,
    ).toBe(403);
    // Another seller's customer is outside scope.
    expect(
      (
        await call({
          method: 'POST',
          path: 'customer/upload-url',
          token: SM2_TOKEN,
          body: uploadBody,
        })
      ).status,
    ).toBe(403);
  });

  it('3. binds OST uploads to the application sponsor in the OST bucket', async () => {
    const ostBody = {
      subjectType: 'ost_application',
      subjectId: APP1,
      mime: 'image/png',
      sizeBytes: 100,
      originalFilename: 'id.png',
    };
    const own = await call({
      method: 'POST',
      path: 'ost_application/upload-url',
      token: SM_TOKEN,
      body: ostBody,
    });
    expect(own.status).toBe(201);
    expect((own.body as { bucket: string }).bucket).toBe('afhomes-ost-ids');
    const alien = await call({
      method: 'POST',
      path: 'ost_application/upload-url',
      token: SM2_TOKEN,
      body: ostBody,
    });
    expect(alien.status).toBe(403);
    const gone = await call({
      method: 'POST',
      path: 'ost_application/upload-url',
      token: SM_TOKEN,
      body: { ...ostBody, subjectId: '00000000-0000-4000-8000-000000000099' },
    });
    expect(gone.status).toBe(404);
  });

  it('5/6. rejects oversized and non-allowlisted files before any storage call', async () => {
    const big = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...uploadBody, sizeBytes: 11 * 1024 * 1024 },
    });
    expect(big.status).toBe(400);
    const gif = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...uploadBody, mime: 'image/gif' },
    });
    expect(gif.status).toBe(400);
    expect((holder.db as FakeSupabase).rows('identity_documents')).toHaveLength(0);
  });
});

/* ================================================================== */
/* Reads: scoping, masking, temporary access                            */
/* ================================================================== */

describe('reads', () => {
  it('4/19. hides other sellers\u2019 documents but shows the reviewer everything', async () => {
    const { id } = await uploaded();
    expect((await call({ path: `${id}`, token: SM2_TOKEN })).status).toBe(403);
    expect((await call({ path: `${id}/access-url`, token: SM2_TOKEN })).status).toBe(403);
    const own = await call({ path: `${id}`, token: SM_TOKEN });
    expect(own.status).toBe(200);
    const review = await call({ path: `${id}`, token: ADMIN_TOKEN });
    expect(review.status).toBe(200);
  });

  it('16/24. masks ID numbers and never exposes paths, hashes or public URLs', async () => {
    const { id } = await uploaded();
    const db = holder.db as FakeSupabase;
    const row = db.rows('identity_documents').find((r) => r.id === id)!;
    row.extracted_data = {
      provider: 'http',
      fields: {
        idNumber: { value: '7788-9900-1122', confidence: 0.9 },
        firstName: { value: 'Ana', confidence: 0.9 },
      },
      warnings: [],
    };
    row.ocr_status = 'completed';
    const state = await call({ path: `${id}`, token: SM_TOKEN });
    expect(state.status).toBe(200);
    const body = state.body as { extractedFields: Record<string, { value: string | null }> };
    expect(body.extractedFields.idNumber!.value).toBe('**********1122');
    expect(body.extractedFields.firstName!.value).toBe('Ana');
    const serialised = JSON.stringify(state.body);
    expect(serialised).not.toContain('storage_path');
    expect(serialised).not.toContain('sha256');
    expect(serialised).not.toContain('7788-9900-1122');
    expect(serialised).not.toContain('/object/public/');
  });

  it('17/18. issues a scoped, short-lived download grant', async () => {
    const { id } = await uploaded();
    const state = await call({ path: `${id}/access-url`, token: SM_TOKEN });
    expect(state.status).toBe(200);
    const grant = state.body as { url: string; expiresAt: string };
    expect(grant.url).toContain('ttl=60');
    expect(grant.url).toContain(`afhomes-customer-ids/customer/${CUST1}/`);
    expect(new Date(grant.expiresAt).valueOf()).toBeGreaterThan(Date.now());
  });
});

/* ================================================================== */
/* OCR: suggestions only, manual fallback always                        */
/* ================================================================== */

describe('ocr', () => {
  it('9. reports unavailable when unconfigured and writes nothing authoritative', async () => {
    const db = holder.db as FakeSupabase;
    const { id } = await uploaded();
    const state = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: {},
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ocrStatus: 'unavailable' });
    const customer = db.rows('customers').find((r) => r.id === CUST1)!;
    expect(customer.government_id_number).toBeNull();
    const row = db.rows('identity_documents').find((r) => r.id === id)!;
    expect(row.verification_status).toBe('pending_review');
  });

  it('7. rejects bytes whose signature contradicts the declared MIME', async () => {
    const { id } = await uploaded();
    const db = holder.db as FakeSupabase;
    const row = db.rows('identity_documents').find((r) => r.id === id)!;
    // PNG bytes under a JPEG declaration.
    store.objects.set(
      String(row.storage_path),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const state = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: {},
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ocrStatus: 'failed' });
  });

  it('refuses OCR before the bytes arrive, retryably', async () => {
    const state = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: uploadBody,
    });
    const id = (state.body as { documentId: string }).documentId;
    const ocr = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: {},
    });
    expect(ocr.status).toBe(409);
    const row = (holder.db as FakeSupabase).rows('identity_documents').find((r) => r.id === id)!;
    expect(row.ocr_status).toBe('not_requested');
  });

  it('10. maps provider failure to failed with a manual path, not an exception', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { id } = await uploaded();
    const state = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: {},
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ocrStatus: 'failed' });
  });

  it('11/15. returns masked suggestions with confidence warnings on success', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        fields: {
          firstName: { value: 'Ana', confidence: 0.95 },
          idNumber: { value: 'P1234567', confidence: 0.2 },
        },
        rawText: 'raw secret text that must never be stored',
        warnings: [],
      }),
    }));
    const db = holder.db as FakeSupabase;
    const { id } = await uploaded();
    const state = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: {},
    });
    expect(state.status).toBe(200);
    const body = state.body as {
      ocrStatus: string;
      ocrProvider: string;
      warnings: string[];
      extractedFields: Record<string, { value: string | null }>;
    };
    expect(body.ocrStatus).toBe('completed');
    expect(body.ocrProvider).toBe('http');
    expect(body.warnings).toContain('OCR_LOW_CONFIDENCE');
    expect(body.extractedFields.idNumber!.value).toBe('****4567');
    const row = db.rows('identity_documents').find((r) => r.id === id)!;
    expect(String(row.sha256)).toHaveLength(64);
    expect(String(row.sha256)).not.toBe('0'.repeat(64));
    expect(JSON.stringify(row)).not.toContain('raw secret text');
    // Still nothing authoritative: the customer row is untouched.
    expect(db.rows('customers').find((r) => r.id === CUST1)!.government_id_number).toBeNull();
  });
});

/* ================================================================== */
/* Human confirmation is the only authority                             */
/* ================================================================== */

describe('confirm', () => {
  it('13/14. saves corrected reviewer values and marks verification', async () => {
    const { id } = await uploaded();
    const state = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'confirmed', fields: { firstName: 'Ana-Marie', idNumber: 'P1234567' } },
    });
    expect(state.status).toBe(200);
    const db = holder.db as FakeSupabase;
    const row = db.rows('identity_documents').find((r) => r.id === id)!;
    expect(row.verification_status).toBe('confirmed');
    expect(row.reviewed_by).toBe(SM_ID);
    expect((row.reviewed_data as { fields: Record<string, string> }).fields).toMatchObject({
      firstName: 'Ana-Marie',
      idNumber: 'P1234567',
    });
    // The read echoes the reviewer's own submitted values, masked.
    expect(state.body).toMatchObject({ verificationStatus: 'confirmed' });
  });

  it('flags a possible duplicate without rejecting', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('customers').find((r) => r.id === CUST2)!.government_id_number = 'P1234567';
    const { id } = await uploaded();
    const state = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'confirmed', fields: { idNumber: 'P1234567' } },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ verificationStatus: 'confirmed', possibleDuplicate: true });
  });

  it('supports rejection with a reason and requires reviewer input', async () => {
    const { id } = await uploaded();
    const rejected = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'rejected', fields: { notes: 'Unreadable' } },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ verificationStatus: 'rejected' });
    const empty = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'confirmed', fields: {} },
    });
    expect(empty.status).toBe(400);
  });

  it('21/22. audits decisions with ids and statuses, never values or text', async () => {
    const { id } = await uploaded();
    await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'confirmed', fields: { idNumber: 'P1234567' } },
    });
    const audits = (holder.db as FakeSupabase).rows('audit_events');
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('IDENTITY_DOCUMENT_UPLOADED');
    expect(actions).toContain('IDENTITY_DOCUMENT_CONFIRMED');
    expect(JSON.stringify(audits)).not.toContain('P1234567');
  });
});

/* ================================================================== */
/* Packaging                                                            */
/* ================================================================== */

describe('route packaging', () => {
  it('29. packages the document routes in the single Vercel function', async () => {
    const q: Record<string, string | undefined> = {};
    expect(selectHandler('/api/v1/documents', q)?.routeKey).toBe('documents/documents');
    expect(selectHandler('/api/v1/documents/customer/upload-url', q)?.routeKey).toBe(
      'documents/customer/upload-url',
    );
    expect(selectHandler('/api/v1/documents/abc/ocr', q)?.routeKey).toBe('documents/abc/ocr');
  });
});

describe('durable upload completion', () => {
  const complete = (id: string, token: string | null = SM_TOKEN) =>
    call({ method: 'POST', path: id + '/complete-upload', token, body: {} });
  it('keeps metadata-only replacement incomplete on both list and detail reads', async () => {
    const old = await uploaded();
    expect((await complete(old.id)).status).toBe(200);
    const grant = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...uploadBody, originalFilename: 'replacement.jpg' },
    });
    const id = (grant.body as { documentId: string }).documentId;
    expect((await complete(id)).status).toBe(409);
    const list = await call({
      path: '',
      token: SM_TOKEN,
      query: { subjectType: 'customer', subjectId: CUST1 },
    });
    expect(list.status).toBe(200);
    expect((list.body as { data: unknown[] }).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.id, hasFile: true }),
        expect.objectContaining({ id, hasFile: false }),
      ]),
    );
    expect((await call({ path: id, token: SM_TOKEN })).body).toMatchObject({ hasFile: false });
    expect(store.objects.get(old.path)).toEqual(JPEG);
  });
  it('marks validated bytes complete durably without OCR or identity approval, and is retryable', async () => {
    const { id } = await uploaded();
    expect((await call({ path: id, token: SM_TOKEN })).body).toMatchObject({ hasFile: false });
    const result = await complete(id);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      hasFile: true,
      ocrStatus: 'not_requested',
      verificationStatus: 'pending_review',
    });
    expect((await complete(id)).body).toEqual(result.body);
    expect((await call({ path: id, token: SM_TOKEN })).body).toMatchObject({ hasFile: true });
    expect(JSON.stringify(result.body)).not.toMatch(/sha256|storage_path|object\/public/);
  });
  it.each([new Uint8Array(), new Uint8Array([1, 2, 3]), new Uint8Array(10 * 1024 * 1024 + 1)])(
    'keeps empty, invalid or oversized bytes incomplete',
    async (bytes) => {
      const { id, path } = await uploaded();
      store.objects.set(path, bytes);
      expect((await complete(id)).status).toBe(400);
      expect((await call({ path: id, token: SM_TOKEN })).body).toMatchObject({ hasFile: false });
    },
  );
  it('keeps bytes private and pending if durable finalization fails, and supports retry', async () => {
    const db = holder.db as FakeSupabase;
    const { id, path } = await uploaded();
    db.writeErrors.identity_documents = { message: 'Finalization unavailable' };
    expect((await complete(id)).status).toBe(500);
    expect((await call({ path: id, token: SM_TOKEN })).body).toMatchObject({ hasFile: false });
    expect(db.rows('identity_documents').find((row) => row.id === id)?.sha256).toBe('0'.repeat(64));
    expect(store.objects.get(path)).toEqual(JPEG);
    delete db.writeErrors.identity_documents;
    expect((await complete(id)).body).toMatchObject({ hasFile: true });
  });
  it('retains upload completion when OCR cannot extract, without approving identity', async () => {
    const { id } = await uploaded();
    await complete(id);
    const result = await call({ method: 'POST', path: id + '/ocr', token: SM_TOKEN, body: {} });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      hasFile: true,
      ocrStatus: 'unavailable',
      verificationStatus: 'pending_review',
    });
  });
  it.each([null, EMP_TOKEN, SM2_TOKEN])('refuses unauthorized completion for %s', async (token) => {
    const { id } = await uploaded();
    expect([401, 403]).toContain((await complete(id, token)).status);
    expect((await call({ path: id, token: SM_TOKEN })).body).toMatchObject({ hasFile: false });
  });
});

/* ================================================================== */
/* Authoritative Current ID                                             */
/* ================================================================== */

describe('authoritative Current ID', () => {
  const complete = (id: string, token: string = SM_TOKEN) =>
    call({ method: 'POST', path: id + '/complete-upload', token, body: {} });
  const list = (token: string = SM_TOKEN) =>
    call({ path: '', token, query: { subjectType: 'customer', subjectId: CUST1 } });
  const backdate = (id: string, createdAt: string) => {
    (holder.db as FakeSupabase).rows('identity_documents').find((r) => r.id === id)!.created_at =
      createdAt;
  };
  const flags = async (token: string = SM_TOKEN) => {
    const state = await list(token);
    expect(state.status).toBe(200);
    const docs = (state.body as { data: Array<{ id: string; isCurrent: boolean }> }).data;
    return new Map(docs.map((d) => [d.id, d.isCurrent] as const));
  };
  // A older and still pending, B newer and file-complete: B is canonical current.
  const seedAB = async () => {
    const a = await uploaded();
    backdate(a.id, '2026-09-18T00:00:00.000Z');
    const b = await uploaded();
    backdate(b.id, '2026-09-19T00:00:00.000Z');
    expect((await complete(b.id)).status).toBe(200);
    return { a: a.id, b: b.id };
  };

  it('A. verifying the older pending document does not steal currentness', async () => {
    const { a, b } = await seedAB();
    const done = await complete(a);
    expect({ status: done.status, body: done.body }).toEqual({
      status: 200,
      body: expect.objectContaining({ id: a, hasFile: true, isCurrent: false }),
    });
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, true],
      ]),
    );
    expect((await call({ path: a, token: SM_TOKEN })).body).toMatchObject({ isCurrent: false });
    expect((await call({ path: b, token: SM_TOKEN })).body).toMatchObject({ isCurrent: true });
  });

  it('B. a reopened read agrees with the write response', async () => {
    const { a, b } = await seedAB();
    await complete(a);
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, true],
      ]),
    );
  });

  it('C. an explicit replacement upload becomes current immediately', async () => {
    const { a, b } = await seedAB();
    const c = await uploaded();
    backdate(c.id, '2026-09-20T00:00:00.000Z');
    const done = await complete(c.id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ id: c.id, isCurrent: true });
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, false],
        [c.id, true],
      ]),
    );
  });

  it('D. the replacement stays current on reopen', async () => {
    const { a, b } = await seedAB();
    const c = await uploaded();
    backdate(c.id, '2026-09-20T00:00:00.000Z');
    await complete(c.id);
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, false],
        [c.id, true],
      ]),
    );
  });

  it('E. verifying an older pending document after replacement keeps the replacement', async () => {
    const { a, b } = await seedAB();
    const c = await uploaded();
    backdate(c.id, '2026-09-20T00:00:00.000Z');
    await complete(c.id);
    const d = await uploaded();
    backdate(d.id, '2026-09-17T00:00:00.000Z');
    expect((await complete(d.id)).status).toBe(200);
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, false],
        [c.id, true],
        [d.id, false],
      ]),
    );
  });

  it('F. a failed replacement leaves the prior current untouched', async () => {
    const { b } = await seedAB();
    const e = await uploaded();
    (holder.db as FakeSupabase).rows('identity_documents').find((r) => r.id === e.id)!.created_at =
      '2026-09-20T00:00:00.000Z';
    store.objects.delete(e.path);
    expect((await complete(e.id)).status).toBe(409);
    const f = await flags();
    expect(f.get(b)).toBe(true);
    expect(f.get(e.id)).toBe(false);
  });

  it('G. retrying an old pending verification never steals currentness', async () => {
    const { a, b } = await seedAB();
    await complete(a);
    const retry = await complete(a);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ id: a, isCurrent: false });
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, true],
      ]),
    );
  });

  it('confirming the older document does not move currentness', async () => {
    const { a, b } = await seedAB();
    await complete(a);
    const decided = await call({
      method: 'POST',
      path: `${a}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'confirmed', fields: { firstName: 'Ana' } },
    });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({
      id: a,
      verificationStatus: 'confirmed',
      isCurrent: false,
    });
    expect(await flags()).toEqual(
      new Map([
        [a, false],
        [b, true],
      ]),
    );
  });

  it('rejecting the current document passes currentness to the next eligible one', async () => {
    const { a, b } = await seedAB();
    await complete(a);
    const rejected = await call({
      method: 'POST',
      path: `${b}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'rejected', fields: { firstName: 'Ana' } },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ id: b, isCurrent: false });
    expect(await flags()).toEqual(
      new Map([
        [a, true],
        [b, false],
      ]),
    );
  });

  it('never marks another subject document current', async () => {
    const { b } = await seedAB();
    const other = await uploaded(ADMIN_TOKEN, { ...uploadBody, subjectId: CUST2 });
    (holder.db as FakeSupabase)
      .rows('identity_documents')
      .find((r) => r.id === other.id)!.created_at = '2026-09-25T00:00:00.000Z';
    await call({
      method: 'POST',
      path: other.id + '/complete-upload',
      token: ADMIN_TOKEN,
      body: {},
    });
    const own = await flags();
    expect(own.get(b)).toBe(true);
    expect(own.has(other.id)).toBe(false);
    const foreign = await call({
      path: '',
      token: ADMIN_TOKEN,
      query: { subjectType: 'customer', subjectId: CUST2 },
    });
    const docs = (foreign.body as { data: Array<{ id: string; isCurrent: boolean }> }).data;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: other.id, isCurrent: true });
  });

  const seedHistory = async (subject = CUST1) => {
    const { b } = await seedAB();
    const db = holder.db as FakeSupabase;
    const base = { ...db.rows('identity_documents').find((row) => row.id === b)! };
    for (let i = 0; i < 125; i++)
      db.rows('identity_documents').push({
        ...base,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(i).padStart(12, '0'),
        customer_id: subject,
        uploaded_by: subject === CUST1 ? SM_ID : SM2_ID,
        created_at: '2026-09-20T00:00:00.000Z',
      });
    const winner = {
      ...base,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      customer_id: subject,
      uploaded_by: subject === CUST1 ? SM_ID : SM2_ID,
      created_at: '2026-10-01T00:00:00.000Z',
    };
    db.rows('identity_documents').push(winner);
    return String(winner.id);
  };
  const page = (subjectId: string, limit: number, offset: number, token = ADMIN_TOKEN) =>
    call({
      path: '',
      token,
      query: { subjectType: 'customer', subjectId, limit: String(limit), offset: String(offset) },
    });
  const current = (subjectId: string, token = ADMIN_TOKEN) =>
    call({ path: 'current', token, query: { subjectType: 'customer', subjectId } });

  it('selects beyond the old unordered 100-row subset for list/detail/completion', async () => {
    const winner = await seedHistory();
    expect((await page(CUST1, 10, 0)).body).toMatchObject({
      data: [
        expect.objectContaining({ id: winner, isCurrent: true }),
        ...Array(9).fill(expect.objectContaining({ isCurrent: false })),
      ],
    });
    expect((await call({ path: winner, token: ADMIN_TOKEN })).body).toMatchObject({
      isCurrent: true,
    });
    expect((await complete(winner, ADMIN_TOKEN)).body).toMatchObject({ isCurrent: true });
    expect((await current(CUST1)).body).toMatchObject({
      currentDocument: { id: winner, isCurrent: true },
    });
  });
  it.each([
    [1, 0],
    [7, 0],
    [13, 40],
    [100, 1],
    [10, 120],
  ])('keeps current invariant for limit=%i offset=%i', async (limit, offset) => {
    const winner = await seedHistory();
    const response = await page(CUST1, limit, offset);
    expect(response.status).toBe(200);
    const docs = (response.body as { data: { id: string; isCurrent: boolean }[] }).data;
    expect(docs.every((doc) => doc.isCurrent === (doc.id === winner))).toBe(true);
    expect((await current(CUST1)).body).toMatchObject({ currentDocument: { id: winner } });
  });
  it('does not invent current on a page of rejected rows ahead of the eligible winner', async () => {
    const winner = await seedHistory();
    const db = holder.db as FakeSupabase;
    for (const row of db.rows('identity_documents'))
      if (row.id !== winner) {
        row.created_at = '2026-10-02T00:00:00Z';
        row.verification_status = 'rejected';
      }
    const first = await page(CUST1, 100, 0);
    expect(
      (first.body as { data: { isCurrent: boolean }[] }).data.every((doc) => !doc.isCurrent),
    ).toBe(true);
    expect((await page(CUST1, 100, 100)).body).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id: winner, isCurrent: true })]),
    });
    expect((await current(CUST1)).body).toMatchObject({ currentDocument: { id: winner } });
  });
  it('rejects the newest current and hands off across pages consistently', async () => {
    const winner = await seedHistory();
    const response = await call({
      method: 'POST',
      path: winner + '/confirm',
      token: ADMIN_TOKEN,
      body: {
        decision: 'rejected',
        fields: { firstName: 'Synthetic' },
        notes: 'QA synthetic rejection',
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ isCurrent: false, verificationStatus: 'rejected' });
    const next = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000124';
    expect((await current(CUST1)).body).toMatchObject({
      currentDocument: { id: next, isCurrent: true },
    });
    expect((await call({ path: next, token: ADMIN_TOKEN })).body).toMatchObject({
      isCurrent: true,
    });
    expect((await page(CUST1, 1, 0)).body).toMatchObject({
      data: [expect.objectContaining({ id: winner, isCurrent: false })],
    });
  });
  it('uses deterministic ID ties before presentation truncation', async () => {
    const winner = await seedHistory();
    for (const row of (holder.db as FakeSupabase).rows('identity_documents'))
      row.created_at = '2026-10-01T00:00:00Z';
    expect((await page(CUST1, 1, 0)).body).toMatchObject({
      data: [expect.objectContaining({ id: winner, isCurrent: true })],
    });
    expect((await call({ path: winner, token: ADMIN_TOKEN })).body).toMatchObject({
      isCurrent: true,
    });
  });
  it('batches independent current winners for multiple subjects each over 100 rows', async () => {
    const winner = await seedHistory();
    const db = holder.db as FakeSupabase;
    const originals = [...db.rows('identity_documents')].filter((row) => row.customer_id === CUST1);
    for (const [index, row] of originals.entries())
      db.rows('identity_documents').push({
        ...row,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(index).padStart(12, '0'),
        customer_id: CUST2,
        uploaded_by: SM2_ID,
      });
    const winner2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    db.rows('identity_documents').push({
      ...originals.find((row) => row.id === winner)!,
      id: winner2,
      customer_id: CUST2,
      uploaded_by: SM2_ID,
      created_at: '2026-10-03T00:00:00Z',
    });
    db.calls.length = 0;
    const result = await call({ path: '', token: ADMIN_TOKEN, query: { subjectType: 'customer' } });
    const docs = (result.body as { data: { id: string; isCurrent: boolean }[] }).data;
    expect(
      docs
        .filter((doc) => doc.isCurrent)
        .map((doc) => doc.id)
        .sort(),
    ).toEqual([winner, winner2].sort());
    expect(
      db.calls.filter((call) => call.op === 'select' && call.table === 'customers'),
    ).toHaveLength(1);
    expect((await current(CUST2)).body).toMatchObject({ currentDocument: { id: winner2 } });
    expect((await current(CUST2, SM_TOKEN)).body).toMatchObject({ currentDocument: null });
    expect((await call({ path: winner2, token: SM_TOKEN })).status).toBe(403);
  });
  it('returns no current document for rejected-only subject history', async () => {
    await seedHistory();
    for (const row of (holder.db as FakeSupabase).rows('identity_documents'))
      row.verification_status = 'rejected';
    expect((await current(CUST1)).body).toEqual({ currentDocument: null });
  });

  it('keeps OST application currentness independent of customer history and page size', async () => {
    const customerWinner = await seedHistory();
    const db = holder.db as FakeSupabase;
    const base = db.rows('identity_documents').find((row) => row.id === customerWinner)!;
    for (let index = 0; index < 125; index++) {
      db.rows('identity_documents').push({
        ...base,
        id: 'cccccccc-cccc-4ccc-8ccc-' + String(index).padStart(12, '0'),
        subject_type: 'ost_application',
        customer_id: null,
        ost_application_id: APP1,
        created_at: '2026-10-02T00:00:00.000Z',
      });
    }
    const winner = 'cccccccc-cccc-4ccc-8ccc-000000000124';
    const result = await call({
      path: '',
      token: SM_TOKEN,
      query: { subjectType: 'ost_application', subjectId: APP1, limit: '1', offset: '1' },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ data: [expect.objectContaining({ isCurrent: false })] });
    expect((await call({ path: winner, token: SM_TOKEN })).body).toMatchObject({ isCurrent: true });
    expect(
      (
        await call({
          path: 'current',
          token: SM_TOKEN,
          query: { subjectType: 'ost_application', subjectId: APP1 },
        })
      ).body,
    ).toMatchObject({ currentDocument: { id: winner, subjectType: 'ost_application' } });
    expect((await current(CUST1)).body).toMatchObject({ currentDocument: { id: customerWinner } });
  });
});
