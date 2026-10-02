/**
 * AF Homes Phase 27 - OCR + document processing completion.
 *
 * Drives the REAL documents handler, the REAL staff principal resolver, the
 * REAL contracts and the REAL OCR abstraction against the in-memory Supabase
 * fake. Storage is the only seam (`vi.mock` on `_lib/storage.js`, the same
 * seam production uses); the HTTP OCR provider is exercised with a stubbed
 * `fetch`, so the manual-fallback and failure paths run their real code.
 *
 * Phase 12 proved the core lifecycle (upload grants, scoping, masking, OCR
 * suggestions-only, human confirmation, audits). This suite completes it:
 * PDF intake, replacement-as-new-upload with preserved history, malformed
 * provider responses, secret hygiene on every response, HR/Finance denial
 * (staff without a document grant), and the full integration flow.
 *
 * What is deliberately NOT here: staff-subject documents (the schema defines
 * only `customer` and `ost_application` - inventing a third subject would need
 * a migration the phase does not justify), Google Document AI (no provider
 * implementation exists in the codebase and billing was unavailable - manual
 * plus the generic HTTP adapter pass the phase), and OCR-written profiles
 * (OCR output never touches a customer record by design).
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
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SM_ID = '22222222-2222-4222-8222-222222222222';
const SM2_ID = '22222222-2222-4222-8222-222222222223';
const FIN_ID = '33333333-3333-4333-8333-333333333331';
const HR_ID = '33333333-3333-4333-8333-333333333332';
const EMP_ID = '33333333-3333-4333-8333-333333333333';
const CUST1 = '44444444-4444-4444-8444-444444444444';
const CUST2 = '44444444-4444-4444-8444-444444444445';
const APP1 = '55555555-5555-4555-8555-555555555555';

const ADMIN_TOKEN = 'tok-admin';
const SM_TOKEN = 'tok-sm';
const SM2_TOKEN = 'tok-sm2';
const FIN_TOKEN = 'tok-fin';
const HR_TOKEN = 'tok-hr';
const EMP_TOKEN = 'tok-emp';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x46, 0x00, 0x01]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

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
      { id: 'r-fin', slug: 'finance', name: 'Finance', is_active: true },
      { id: 'r-hr', slug: 'hr', name: 'HR', is_active: true },
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
      // Finance, HR and Employee hold NO document grant: every document route
      // must fail closed for them. There is no staff-subject document type in
      // the schema, so HR has nothing of its own to read here either.
    ],
    staff_users: [
      { id: ADMIN_ID, email: 'admin@afhomes.test', full_name: 'Ada Admin', status: 'active' },
      { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
      { id: SM2_ID, email: 'sm2@afhomes.test', full_name: 'Sue Manager', status: 'active' },
      { id: FIN_ID, email: 'fin@afhomes.test', full_name: 'Fin Officer', status: 'active' },
      { id: HR_ID, email: 'hr@afhomes.test', full_name: 'H R Officer', status: 'active' },
      { id: EMP_ID, email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
    ],
    staff_role_assignments: [
      { staff_id: ADMIN_ID, role_id: 'r-admin' },
      { staff_id: SM_ID, role_id: 'r-seller' },
      { staff_id: SM2_ID, role_id: 'r-seller' },
      { staff_id: FIN_ID, role_id: 'r-fin' },
      { staff_id: HR_ID, role_id: 'r-hr' },
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
      [FIN_TOKEN]: {
        id: FIN_ID,
        email: 'fin@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
      [HR_TOKEN]: {
        id: HR_ID,
        email: 'hr@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
      [EMP_TOKEN]: {
        id: EMP_ID,
        email: 'emp@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    },
  });
  holder.db = db as unknown;
  return db;
}

beforeEach(() => {
  install();
  resetIdentifierRateLimit();
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

const jpegUpload = {
  subjectType: 'customer',
  subjectId: CUST1,
  mime: 'image/jpeg',
  sizeBytes: JPEG.length,
  originalFilename: 'id-front.jpg',
};

async function uploaded(
  token: string = SM_TOKEN,
  body: unknown = jpegUpload,
  bytes: Uint8Array = JPEG,
): Promise<{ id: string; path: string }> {
  const state = await call({ method: 'POST', path: 'customer/upload-url', token, body });
  expect(state.status).toBe(201);
  const grant = state.body as { documentId: string; bucket: string; uploadUrl: string };
  const row = (holder.db as FakeSupabase)
    .rows('identity_documents')
    .find((r) => r.id === grant.documentId)!;
  const storagePath = String(row.storage_path);
  store.objects.set(storagePath, bytes);
  return { id: grant.documentId, path: storagePath };
}

const serialised = (body: unknown) => JSON.stringify(body);

/* ================================================================== */
/* PDF intake and file validation                                      */
/* ================================================================== */

describe('Phase 27 PDF intake and validation', () => {
  it('2. accepts a valid PDF through the private OST-bucket path', async () => {
    const state = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: {
        subjectType: 'customer',
        subjectId: CUST1,
        mime: 'application/pdf',
        sizeBytes: PDF.length,
        originalFilename: 'proof-of-address.pdf',
      },
    });
    expect(state.status).toBe(201);
    const grant = state.body as { documentId: string; bucket: string; uploadUrl: string };
    expect(grant.bucket).toBe('afhomes-customer-ids');
    const row = (holder.db as FakeSupabase)
      .rows('identity_documents')
      .find((r) => r.id === grant.documentId)!;
    expect(String(row.storage_path)).toMatch(/\.pdf$/);
    expect(String(row.mime_type)).toBe('application/pdf');
    // A PDF whose bytes arrive validates by signature at OCR time.
    store.objects.set(String(row.storage_path), PDF);
    const ocr = await call({
      method: 'POST',
      path: `${grant.documentId}/ocr`,
      token: SM_TOKEN,
      body: {},
    });
    expect(ocr.status).toBe(200);
    expect((ocr.body as { ocrStatus: string }).ocrStatus).not.toBe('failed');
  });

  it('3/4. rejects unsupported types and oversized files before storage', async () => {
    for (const mime of ['image/gif', 'image/webp', 'text/plain']) {
      const state = await call({
        method: 'POST',
        path: 'customer/upload-url',
        token: SM_TOKEN,
        body: { ...jpegUpload, mime },
      });
      expect(state.status).toBe(400);
    }
    const big = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...jpegUpload, sizeBytes: 10 * 1024 * 1024 + 1 },
    });
    expect(big.status).toBe(400);
    const empty = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...jpegUpload, sizeBytes: 0 },
    });
    expect(empty.status).toBe(400);
    expect((holder.db as FakeSupabase).rows('identity_documents')).toHaveLength(0);
  });

  it('5. storage paths are server-generated and traversal-proof', async () => {
    const { path } = await uploaded();
    expect(path).toMatch(new RegExp(`^afhomes-customer-ids/customer/${CUST1}/[0-9a-f-]+\\.jpg$`));
    expect(path).not.toContain('..');
    expect(
      serialised(
        await (
          await call({
            path: `${(holder.db as FakeSupabase).rows('identity_documents')[0]!.id}`,
            token: SM_TOKEN,
          })
        ).body,
      ),
    ).not.toContain('afhomes-customer-ids/customer');
  });
});

/* ================================================================== */
/* Staff without a document grant fail closed (HR / Finance / Employee) */
/* ================================================================== */

describe('Phase 27 staff scoping without a document grant', () => {
  it('6/9/33. HR, Finance and Employee are denied every document route', async () => {
    const { id } = await uploaded();
    for (const token of [HR_TOKEN, FIN_TOKEN, EMP_TOKEN]) {
      expect(
        (await call({ method: 'POST', path: 'customer/upload-url', token, body: jpegUpload }))
          .status,
      ).toBe(403);
      expect((await call({ path: `${id}`, token })).status).toBe(403);
      expect((await call({ path: `${id}/access-url`, token })).status).toBe(403);
      expect((await call({ method: 'POST', path: `${id}/ocr`, token, body: {} })).status).toBe(403);
      expect(
        (
          await call({
            method: 'POST',
            path: `${id}/confirm`,
            token,
            body: { decision: 'confirmed', fields: { firstName: 'X' } },
          })
        ).status,
      ).toBe(403);
    }
    // And the unfiltered seller list for a grant-less role is empty-by-denial:
    // the list endpoint itself refuses without the module grant.
    expect(
      (await call({ path: '', token: HR_TOKEN, query: { subjectType: 'customer' } })).status,
    ).toBe(403);
  });

  it('8/32. another seller cannot read, preview, OCR or confirm the document', async () => {
    const { id } = await uploaded();
    expect((await call({ path: `${id}`, token: SM2_TOKEN })).status).toBe(403);
    expect((await call({ path: `${id}/access-url`, token: SM2_TOKEN })).status).toBe(403);
    expect(
      (await call({ method: 'POST', path: `${id}/ocr`, token: SM2_TOKEN, body: {} })).status,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          path: `${id}/confirm`,
          token: SM2_TOKEN,
          body: { decision: 'confirmed', fields: { firstName: 'X' } },
        })
      ).status,
    ).toBe(403);
  });

  it('10/34. OST documents are sponsor-scoped; the reviewer sees them', async () => {
    const ostBody = {
      subjectType: 'ost_application',
      subjectId: APP1,
      mime: 'image/png',
      sizeBytes: 100,
      originalFilename: 'ost-id.png',
    };
    const own = await call({
      method: 'POST',
      path: 'ost_application/upload-url',
      token: SM_TOKEN,
      body: ostBody,
    });
    expect(own.status).toBe(201);
    const id = (own.body as { documentId: string }).documentId;
    // A different sponsor is outside scope even with the same module grant.
    expect((await call({ path: `${id}`, token: SM2_TOKEN })).status).toBe(403);
    expect((await call({ path: `${id}/access-url`, token: SM2_TOKEN })).status).toBe(403);
    // The permission-holding reviewer reads everything.
    expect((await call({ path: `${id}`, token: ADMIN_TOKEN })).status).toBe(200);
    expect((await call({ path: `${id}/access-url`, token: ADMIN_TOKEN })).status).toBe(200);
  });
});

/* ================================================================== */
/* Replacement is a new upload: history preserved, each step audited   */
/* ================================================================== */

describe('Phase 27 document replacement', () => {
  it('24/25/26. a re-upload preserves history, lists newest first, audits each', async () => {
    const first = await uploaded();
    const secondState = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...jpegUpload, originalFilename: 'id-front-v2.jpg' },
    });
    expect(secondState.status).toBe(201);
    const secondId = (secondState.body as { documentId: string }).documentId;
    expect(secondId).not.toBe(first.id);
    const db = holder.db as FakeSupabase;
    store.objects.set(
      String(db.rows('identity_documents').find((r) => r.id === secondId)!.storage_path),
      JPEG,
    );

    // Both rows survive: nothing is overwritten, no file is orphaned by
    // deleting history. The old bytes are still in private storage.
    expect(db.rows('identity_documents')).toHaveLength(2);
    expect(store.objects.has(first.path)).toBe(true);

    // The list is newest-first by created_at. The fake sets no server default,
    // so stamp production-like instants before asserting the order.
    db.rows('identity_documents').find((r) => r.id === first.id)!.created_at =
      '2026-09-27T10:00:00.000Z';
    db.rows('identity_documents').find((r) => r.id === secondId)!.created_at =
      '2026-09-27T10:00:01.000Z';
    const listState = await call({
      path: '',
      token: SM_TOKEN,
      query: { subjectType: 'customer', subjectId: CUST1 },
    });
    expect(listState.status).toBe(200);
    const rows = (listState.body as { data: { id: string }[] }).data;
    expect(rows.map((r) => r.id)).toEqual([secondId, first.id]);

    // Each upload is its own audited event with its own document id.
    const uploads = db
      .rows('audit_events')
      .filter((a) => a.action === 'IDENTITY_DOCUMENT_UPLOADED');
    expect(uploads).toHaveLength(2);
    expect(
      new Set(uploads.map((a) => String((a.after_data as { documentId: string }).documentId))).size,
    ).toBe(2);
    expect(serialised(uploads)).not.toContain('afhomes-customer-ids/customer');
  });
});

/* ================================================================== */
/* Malformed and empty provider responses never throw                  */
/* ================================================================== */

describe('Phase 27 provider robustness', () => {
  it('21. a malformed provider payload becomes a safe failure, never an exception', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    const { id } = await uploaded();
    for (const payload of [
      { fields: 'not-an-object', rawText: 'x'.repeat(5000) },
      { fields: { ['x'.repeat(60)]: { value: 'dropped-long-key' } } },
      { fields: { firstName: 42 } },
      null,
    ]) {
      vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => payload }));
      const state = await call({
        method: 'POST',
        path: `${id}/ocr`,
        token: SM_TOKEN,
        body: { refresh: true },
      });
      expect(state.status).toBe(200);
      expect(['failed', 'completed']).toContain((state.body as { ocrStatus: string }).ocrStatus);
      expect(serialised(state.body)).not.toContain('OCR_PROVIDER_API_KEY');
    }
  });

  it('22/23. empty extraction and network failure stay manual-fallback failures', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    const { id } = await uploaded();
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ fields: {} }) }));
    const empty = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: { refresh: true },
    });
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ ocrStatus: 'failed' });
    expect((empty.body as { warnings: string[] }).warnings).toContain('OCR_NO_TEXT_DETECTED');

    vi.stubGlobal('fetch', async () => {
      throw new Error('socket hang up');
    });
    const down = await call({
      method: 'POST',
      path: `${id}/ocr`,
      token: SM_TOKEN,
      body: { refresh: true },
    });
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ ocrStatus: 'failed' });
    // Manual review is still available on the failed document.
    const confirm = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: { decision: 'confirmed', fields: { firstName: 'Manual Ana' } },
    });
    expect(confirm.status).toBe(200);
  });

  it('14. a configured URL without a key still attempts without leaking anything', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubEnv('OCR_PROVIDER_API_KEY', '');
    const seen: { headers: unknown; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: unknown) => {
      seen.push({
        headers: (init as { headers: unknown }).headers,
        body: (init as { body: unknown }).body,
      });
      return {
        ok: true,
        json: async () => ({ fields: { firstName: { value: 'Ana', confidence: 0.9 } } }),
      };
    });
    const { id } = await uploaded();
    const state = await call({ method: 'POST', path: `${id}/ocr`, token: SM_TOKEN, body: {} });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ocrStatus: 'completed' });
    expect(serialised(seen)).not.toContain('OCR_PROVIDER_API_KEY');
  });
});

/* ================================================================== */
/* Suggestions are editable, clearable, and never authoritative        */
/* ================================================================== */

describe('Phase 27 review editing and manual entry', () => {
  it('17/18. reviewer edits are trimmed and cleared fields become null', async () => {
    const { id } = await uploaded();
    // The UI maps a cleared input ('') to null before sending; the API stores
    // an explicit null as null and preserves any other string verbatim.
    const state = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: {
        decision: 'confirmed',
        fields: { firstName: '  Ana-Marie  ', middleName: null, idNumber: 'P1234567' },
      },
    });
    expect(state.status).toBe(200);
    const row = (holder.db as FakeSupabase).rows('identity_documents').find((r) => r.id === id)!;
    expect((row.reviewed_data as { fields: Record<string, string | null> }).fields).toMatchObject({
      firstName: 'Ana-Marie',
      middleName: null,
      idNumber: 'P1234567',
    });
  });

  it('19. manual entry works on a document OCR never touched', async () => {
    const { id } = await uploaded();
    const state = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: {
        decision: 'confirmed',
        fields: { firstName: 'Manual', lastName: 'Entry', idNumber: 'M0001' },
      },
    });
    expect(state.status).toBe(200);
    const row = (holder.db as FakeSupabase).rows('identity_documents').find((r) => r.id === id)!;
    expect(row.ocr_status).toBe('not_requested');
    expect(row.verification_status).toBe('confirmed');
  });

  it('15/16. OCR success changes no profile and leaves verification pending', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        fields: { firstName: { value: 'Ana', confidence: 0.95 } },
        warnings: [],
      }),
    }));
    const db = holder.db as FakeSupabase;
    const { id } = await uploaded();
    const state = await call({ method: 'POST', path: `${id}/ocr`, token: SM_TOKEN, body: {} });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      ocrStatus: 'completed',
      verificationStatus: 'pending_review',
    });
    expect(db.rows('customers').find((r) => r.id === CUST1)!.government_id_number).toBeNull();
    expect(db.rows('customers')).toHaveLength(2);
  });
});

/* ================================================================== */
/* Secret hygiene on every response                                    */
/* ================================================================== */

describe('Phase 27 secret hygiene', () => {
  it('28/29/30. no response carries provider secrets, service values, paths or raw text', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubEnv('OCR_PROVIDER_API_KEY', 'server-secret-27');
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        fields: {
          firstName: { value: 'Ana', confidence: 0.9 },
          idNumber: { value: 'P9999', confidence: 0.9 },
        },
        rawText: 'full raw OCR text must never be stored or returned',
        warnings: [],
      }),
    }));
    const grantState = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: jpegUpload,
    });
    const id = (grantState.body as { documentId: string }).documentId;
    const db = holder.db as FakeSupabase;
    store.objects.set(
      String(db.rows('identity_documents').find((r) => r.id === id)!.storage_path),
      JPEG,
    );

    const states = [
      grantState,
      await call({ path: `${id}`, token: SM_TOKEN }),
      await call({ method: 'POST', path: `${id}/ocr`, token: SM_TOKEN, body: {} }),
      await call({
        method: 'POST',
        path: `${id}/confirm`,
        token: SM_TOKEN,
        body: { decision: 'confirmed', fields: { firstName: 'Ana' } },
      }),
      await call({ path: `${id}/access-url`, token: SM_TOKEN }),
    ];
    for (const state of states) {
      const text = serialised(state.body);
      expect(text).not.toContain('server-secret-27');
      expect(text).not.toContain('service_role');
      expect(text).not.toContain('service-role');
      expect(text).not.toContain('storage_path');
      expect(text).not.toContain('/object/public/');
      expect(text).not.toContain('full raw OCR text');
      expect(text).not.toContain('P9999');
    }
    // The stored row keeps the raw ID for duplicate detection, but the API
    // only ever returns its mask.
    expect(serialised(db.rows('audit_events'))).not.toContain('P9999');
    expect(serialised(db.rows('audit_events'))).not.toContain('server-secret-27');
  });

  it('31. signed preview URLs are short-lived (60s TTL)', async () => {
    const { id } = await uploaded();
    const state = await call({ path: `${id}/access-url`, token: SM_TOKEN });
    expect(state.status).toBe(200);
    const grant = state.body as { url: string; expiresAt: string };
    // The load-bearing grant is the 60-second TTL the handler requests from
    // storage (the mocked clock date is fixed, so only its futurity is asserted).
    expect(grant.url).toContain('ttl=60');
    expect(Number.isFinite(new Date(grant.expiresAt).valueOf())).toBe(true);
    expect(new Date(grant.expiresAt).valueOf()).toBeGreaterThan(Date.now());
  });
});

/* ================================================================== */
/* Integration flow                                                    */
/* ================================================================== */

describe('Phase 27 integration flow', () => {
  it('upload -> OCR suggestions -> edit -> confirm -> preview -> replace -> deny outsider', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubEnv('OCR_PROVIDER_API_KEY', 'server-secret-27');
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        fields: {
          firstName: { value: 'Ana', confidence: 0.95 },
          lastName: { value: 'Reyes', confidence: 0.9 },
          idNumber: { value: 'P1234567', confidence: 0.4 },
        },
        warnings: [],
      }),
    }));
    const db = holder.db as FakeSupabase;

    // Upload the ID.
    const { id } = await uploaded();
    // Attempt OCR: suggestions only, low-confidence flagged.
    const ocr = await call({ method: 'POST', path: `${id}/ocr`, token: SM_TOKEN, body: {} });
    expect(ocr.status).toBe(200);
    expect(ocr.body).toMatchObject({
      ocrStatus: 'completed',
      verificationStatus: 'pending_review',
    });
    expect((ocr.body as { warnings: string[] }).warnings).toContain('OCR_LOW_CONFIDENCE');
    // Edit one suggestion (correct the low-confidence ID) and confirm.
    const confirmed = await call({
      method: 'POST',
      path: `${id}/confirm`,
      token: SM_TOKEN,
      body: {
        decision: 'confirmed',
        fields: { firstName: 'Ana', lastName: 'Reyes', idNumber: 'P7654321' },
      },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ verificationStatus: 'confirmed' });
    // Profile/document metadata: the document is confirmed, the customer row
    // is untouched by OCR (no duplicate person is ever created from OCR).
    expect(db.rows('customers').find((r) => r.id === CUST1)!.government_id_number).toBeNull();
    // Preview via short-lived signed URL.
    const preview = await call({ path: `${id}/access-url`, token: SM_TOKEN });
    expect(preview.status).toBe(200);
    expect((preview.body as { url: string }).url).toContain('ttl=60');
    // Replace the document: history grows, audits grow.
    const replacement = await call({
      method: 'POST',
      path: 'customer/upload-url',
      token: SM_TOKEN,
      body: { ...jpegUpload, originalFilename: 'id-back.jpg' },
    });
    expect(replacement.status).toBe(201);
    expect(db.rows('identity_documents')).toHaveLength(2);
    // Cross-user access is denied at every step.
    for (const probe of [
      call({ path: `${id}`, token: SM2_TOKEN }),
      call({ path: `${id}/access-url`, token: SM2_TOKEN }),
      call({ method: 'POST', path: `${id}/ocr`, token: SM2_TOKEN, body: { refresh: true } }),
      call({
        method: 'POST',
        path: `${id}/confirm`,
        token: SM2_TOKEN,
        body: { decision: 'confirmed', fields: { firstName: 'X' } },
      }),
    ]) {
      expect((await probe).status).toBe(403);
    }
    const actions = db.rows('audit_events').map((a) => a.action);
    for (const expected of [
      'IDENTITY_DOCUMENT_UPLOADED',
      'IDENTITY_DOCUMENT_OCR_REQUESTED',
      'IDENTITY_DOCUMENT_OCR_COMPLETED',
      'IDENTITY_DOCUMENT_CONFIRMED',
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
