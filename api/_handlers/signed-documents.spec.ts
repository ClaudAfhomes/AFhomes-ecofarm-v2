/**
 * Signed purchase documents over HTTP (official-forms family): upload grant,
 * register, list, review and preview link. The SQL functions hold the rules;
 * these tests pin authorization, request shaping and that nothing is trusted
 * from the browser beyond the declared file facts.
 */
import {
  signedDocumentDownloadSchema,
  signedDocumentSchema,
  signedDocumentUploadGrantSchema,
} from '@afhomes/contracts';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  STAFF2,
  TOKEN,
  TOKEN2,
  UUID,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({
  db: null as unknown,
  grants: [] as string[][],
  object: { bytes: new Uint8Array() } as { bytes: Uint8Array } | { error: string },
}));

vi.mock('../_lib/storage.js', () => ({
  storageClient: () => ({}),
  createUploadGrant: async (_s: unknown, bucket: string, path: string) => {
    holder.grants.push(['upload', bucket, path]);
    return { uploadUrl: `https://storage.example.invalid/up/${path}`, expiresAt: 'soon' };
  },
  createDownloadGrant: async (_s: unknown, bucket: string, path: string) => {
    holder.grants.push(['download', bucket, path]);
    return { url: `https://storage.example.invalid/dl/${path}`, expiresAt: 'soon' };
  },
  downloadObject: async () => holder.object,
}));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const officialForms = (await import('./official-forms.js')).default;

const APP = 'aaaaaaaa-1111-4111-8111-000000000001';
const RES = 'aaaaaaaa-2222-4222-8222-000000000002';
const DOC = 'aaaaaaaa-3333-4333-8333-000000000003';
const FILE = new TextEncoder().encode('signed application bytes');
const SHA = createHash('sha256').update(FILE).digest('hex');

const DOC_ROW = {
  id: DOC,
  kind: 'signed_customer_application',
  status: 'pending_review',
  application_id: APP,
  reservation_id: null,
  storage_path: `applications/${APP}/file.pdf`,
  original_filename: 'signed.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1234,
  uploaded_by: UUID.adminStaff,
  uploaded_at: '2026-11-11T00:00:00.000Z',
  reviewed_by: null,
  reviewed_at: null,
  review_notes: null,
};

async function call(opts: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  seller?: string;
  object?: { bytes: Uint8Array } | { error: string };
}) {
  holder.db = new FakeSupabase({
    tables: phase2World({
      purchase_signed_documents: [DOC_ROW],
      customer_applications: [{ id: APP, created_by: UUID.adminStaff }],
      reservation_agreements: [{ id: RES, customer_application_id: APP }],
      customer_application_purchase_terms: opts.seller
        ? [
            {
              id: 'aaaaaaaa-4444-4444-8444-000000000004',
              application_id: APP,
              version: 1,
              seller_staff_id: opts.seller,
            },
          ]
        : [],
    }),
    tokens: phase2WorldTokens(),
    rpcs: [
      { fn: 'register_purchase_signed_document_once', result: DOC },
      { fn: 'review_purchase_signed_document_once', result: DOC },
    ],
  });
  holder.grants = [];
  holder.object = opts.object ?? { bytes: FILE };
  const { res, state } = makeRes();
  await officialForms(
    makeReq({
      method: opts.method,
      familyPath: opts.path,
      body: opts.body,
      token: opts.token,
    }) as never,
    res as never,
  );
  const db = holder.db as FakeSupabase;
  return { state, db, rpc: (fn: string) => db.calls.filter((c) => c.table === fn) };
}

const REGISTER = {
  storagePath: `applications/${APP}/file.pdf`,
  originalFilename: 'signed.pdf',
  mimeType: 'application/pdf',
  sizeBytes: FILE.byteLength,
  sha256: SHA,
};

describe('signed purchase documents', () => {
  it('grants an upload to a server-chosen path under the application folder', async () => {
    const { state } = await call({
      method: 'POST',
      path: `applications/${APP}/signed-documents/upload`,
      token: TOKEN.admin,
      body: { contentType: 'image/png', byteSize: 5000 },
    });
    expect(state.status).toBe(201);
    const grant = signedDocumentUploadGrantSchema.parse(state.body);
    expect(grant.storagePath).toMatch(new RegExp(`^applications/${APP}/[0-9a-f-]{36}\\.png$`));
    expect(holder.grants).toEqual([['upload', 'afhomes-signed-documents', grant.storagePath]]);
  });

  it('uses the reservations folder for a signed Reservation Agreement', async () => {
    const { state } = await call({
      method: 'POST',
      path: `reservations/${RES}/signed-documents/upload`,
      token: TOKEN.admin,
      body: { contentType: 'application/pdf', byteSize: 5000 },
    });
    expect(state.status).toBe(201);
    expect((state.body as { storagePath: string }).storagePath).toMatch(
      new RegExp(`^reservations/${RES}/`),
    );
  });

  it('refuses a disallowed type, an oversized file and a caller without permission', async () => {
    for (const body of [
      { contentType: 'text/html', byteSize: 10 },
      { contentType: 'image/png', byteSize: 10_485_761 },
    ]) {
      const { state } = await call({
        method: 'POST',
        path: `applications/${APP}/signed-documents/upload`,
        token: TOKEN.admin,
        body,
      });
      expect(state.status).toBe(400);
    }
    const denied = await call({
      method: 'POST',
      path: `applications/${APP}/signed-documents/upload`,
      token: TOKEN2.hr,
      body: { contentType: 'image/png', byteSize: 10 },
    });
    expect(denied.state.status).toBe(403);
    expect(holder.grants).toHaveLength(0);
  });

  it('registers with the session actor and the kind fixed by the route', async () => {
    const { state, rpc } = await call({
      method: 'POST',
      path: `applications/${APP}/signed-documents`,
      token: TOKEN.admin,
      body: { ...REGISTER, kind: 'signed_reservation_agreement', uploadedBy: 'spoof' },
    });
    expect(state.status).toBe(201);
    const calls = rpc('register_purchase_signed_document_once');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.arg).toEqual({
      p_actor_id: UUID.adminStaff,
      p_kind: 'signed_customer_application',
      p_entity_id: APP,
      p_storage_path: REGISTER.storagePath,
      p_original_filename: 'signed.pdf',
      p_mime_type: 'application/pdf',
      p_size_bytes: FILE.byteLength,
      p_sha256: SHA,
    });
  });

  it('refuses a malformed registration before any RPC', async () => {
    const { state, rpc } = await call({
      method: 'POST',
      path: `applications/${APP}/signed-documents`,
      token: TOKEN.admin,
      body: { ...REGISTER, sha256: 'not-a-hash' },
    });
    expect(state.status).toBe(400);
    expect(rpc('register_purchase_signed_document_once')).toHaveLength(0);
  });

  it('lists documents in the contract shape without the storage path', async () => {
    const { state } = await call({
      method: 'GET',
      path: `applications/${APP}/signed-documents`,
      token: TOKEN.admin,
    });
    expect(state.status).toBe(200);
    const rows = signedDocumentSchema.array().parse((state.body as { data: unknown[] }).data);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending_review');
    expect(JSON.stringify(state.body)).not.toContain('applications/');
  });

  it('reviews with the session actor; a rejection needs a reason', async () => {
    const accepted = await call({
      method: 'POST',
      path: `signed-documents/${DOC}/review`,
      token: TOKEN.admin,
      body: { decision: 'accepted' },
    });
    expect(accepted.state.status).toBe(200);
    expect(accepted.rpc('review_purchase_signed_document_once')[0]!.arg).toEqual({
      p_actor_id: UUID.adminStaff,
      p_document_id: DOC,
      p_decision: 'accepted',
      p_notes: null,
    });
    const rejected = await call({
      method: 'POST',
      path: `signed-documents/${DOC}/review`,
      token: TOKEN.admin,
      body: { decision: 'rejected', notes: 'no' },
    });
    expect(rejected.state.status).toBe(400);
    expect(rejected.rpc('review_purchase_signed_document_once')).toHaveLength(0);
  });

  it('gives a short-lived preview link, and 404 for an unknown or malformed id', async () => {
    const ok = await call({
      method: 'GET',
      path: `signed-documents/${DOC}/download`,
      token: TOKEN.admin,
    });
    expect(ok.state.status).toBe(200);
    signedDocumentDownloadSchema.parse(ok.state.body);
    expect(holder.grants).toEqual([['download', 'afhomes-signed-documents', DOC_ROW.storage_path]]);
    for (const id of ['aaaaaaaa-3333-4333-8333-0000000000ff', 'abc']) {
      const missing = await call({
        method: 'GET',
        path: `signed-documents/${id}/download`,
        token: TOKEN.admin,
      });
      expect(missing.state.status).toBe(404);
    }
  });

  it('hides documents from sellers outside the application team, and never reveals they exist', async () => {
    for (const [method, path, body] of [
      ['GET', `applications/${APP}/signed-documents`, undefined],
      [
        'POST',
        `applications/${APP}/signed-documents/upload`,
        { contentType: 'image/png', byteSize: 10 },
      ],
      ['POST', `applications/${APP}/signed-documents`, REGISTER],
      ['POST', `signed-documents/${DOC}/review`, { decision: 'accepted' }],
      ['GET', `signed-documents/${DOC}/download`, undefined],
    ] as const) {
      // The seller of record is a Vice Director; this Sales Manager is below them, not an upline.
      const out = await call({
        method,
        path,
        body,
        token: TOKEN2.salesManager,
        seller: STAFF2.viceDirector,
      });
      expect(out.state.status, `${method} ${path}`).toBe(404);
      expect(out.rpc('register_purchase_signed_document_once')).toHaveLength(0);
      expect(out.rpc('review_purchase_signed_document_once')).toHaveLength(0);
      expect(holder.grants).toHaveLength(0);
    }
  });

  it('lets the seller of record see and review their own application document', async () => {
    const listed = await call({
      method: 'GET',
      path: `applications/${APP}/signed-documents`,
      token: TOKEN2.salesManager,
      seller: STAFF2.salesManager,
    });
    expect(listed.state.status).toBe(200);
    const reviewed = await call({
      method: 'POST',
      path: `signed-documents/${DOC}/review`,
      token: TOKEN2.salesManager,
      seller: STAFF2.salesManager,
      body: { decision: 'accepted' },
    });
    expect(reviewed.state.status).toBe(200);
  });

  it('answers 404 for an application that does not exist, with no upload grant', async () => {
    const out = await call({
      method: 'POST',
      path: 'applications/aaaaaaaa-1111-4111-8111-0000000000ff/signed-documents/upload',
      token: TOKEN.admin,
      body: { contentType: 'image/png', byteSize: 10 },
    });
    expect(out.state.status).toBe(404);
    expect(holder.grants).toHaveLength(0);
  });

  it('records every document view in the audit log', async () => {
    const out = await call({
      method: 'GET',
      path: `signed-documents/${DOC}/download`,
      token: TOKEN.admin,
    });
    expect(out.state.status).toBe(200);
    const views = out.db.rows('audit_events').filter((e) => e.action === 'SIGNED_DOCUMENT_VIEWED');
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ actor_id: UUID.adminStaff, entity_id: DOC });
  });

  it('refuses a registration whose hash or size does not match the uploaded bytes', async () => {
    for (const body of [
      { ...REGISTER, sha256: 'b'.repeat(64) },
      { ...REGISTER, sizeBytes: FILE.byteLength + 1 },
    ]) {
      const out = await call({
        method: 'POST',
        path: `applications/${APP}/signed-documents`,
        token: TOKEN.admin,
        body,
      });
      expect(out.state.status).toBe(400);
      expect(out.rpc('register_purchase_signed_document_once')).toHaveLength(0);
    }
    const missing = await call({
      method: 'POST',
      path: `applications/${APP}/signed-documents`,
      token: TOKEN.admin,
      body: REGISTER,
      object: { error: 'not found' },
    });
    expect(missing.state.status).toBe(400);
    expect(missing.rpc('register_purchase_signed_document_once')).toHaveLength(0);
  });
});
