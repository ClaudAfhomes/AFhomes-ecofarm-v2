/**
 * AF Homes Phase 13 - router -> loader -> handler contract proofs.
 *
 * CANONICAL ROUTING CONTRACT (proven here, not assumed): the router strips
 * `/api/v1/<family>/` before dispatch, so every handler receives the STRIPPED
 * sub-path (`abc/summary`, never `sales/abc/summary`). The collection root is
 * always `''`. The single exception is an exact-path family (`auth`), whose
 * configured full path passes through unchanged.
 *
 * These tests go through the REAL entry (`routeRequest`: URL resolution,
 * family selection, lazy loader, handler dispatch) with the in-memory
 * Supabase fake, so a path mismatch 404s here exactly as it would under the
 * dev server or Vercel. `handled === false` means the ROUTER missed;
 * anything else means a HANDLER branch answered (including a handler 404,
 * 401 or 403, each asserted explicitly).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  MEMBERSHIP,
  PAYMENT,
  SALE,
  STAFF2,
  TOKEN,
  TOKEN2,
  UNIQUE,
  UUID,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

vi.mock('../_lib/storage.js', () => ({
  storageClient: () => null,
  createUploadGrant: async () => {
    throw new Error('storage unavailable in routing tests');
  },
  createDownloadGrant: async () => {
    throw new Error('storage unavailable in routing tests');
  },
  downloadObject: async () => ({ error: 'storage unavailable in routing tests' }),
}));

const { routeRequest } = await import('../_lib/router.js');

function install() {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      { fn: 'next_customer_number', result: { customer_number: 'CUS-900001' } },
      { fn: 'next_sale_number', result: { sale_number: 'SALE-900001' } },
      { fn: 'record_card_payment', result: 'pay-1' },
      {
        fn: 'verify_card_payment',
        result: [
          {
            sale_id: SALE.downPaid,
            status: 'payment_in_progress',
            verified_total: '20000.00',
            remaining_balance: '20000.00',
            fully_paid: false,
            spot_cash_deadline: '2026-10-04T10:00:00.000Z',
          },
        ],
      },
      {
        fn: 'activate_card_sale',
        result: [
          {
            membership_id: MEMBERSHIP.active,
            membership_number: 'MBS-000009',
            fallback_code: 'AFH-ABCD-EF01',
            qr_token: 'opaque-token',
            points_allocated: 60000,
            already_active: false,
          },
        ],
      },
      {
        fn: 'issue_customer_onboarding_token',
        result: { token: 'raw-once', expires_at: '2026-10-01T00:00:00.000Z' },
      },
    ],
  });
  // Mirror the production baseline: sellers hold the ID-documents view, so
  // seller-scoped document reads are reachable in these proofs.
  const db = holder.db as FakeSupabase;
  for (const roleId of [
    '20202020-0000-4000-8000-000000000002',
    '20202020-0000-4000-8000-000000000003',
  ]) {
    db.rows('role_permissions').push({
      role_id: roleId,
      module_id: 'module:sales.id_documents',
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
  }
  return db;
}

beforeEach(() => {
  install();
});

type Dispatch = { handled: boolean; status: number; body: unknown };

async function dispatch(
  url: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<Dispatch> {
  const { res, state } = makeRes();
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const handled = await routeRequest(
    { method: options.method ?? 'GET', url, query: {}, headers, body: options.body } as never,
    res as never,
  );
  return { handled, status: state.status, body: state.body };
}

const code = (body: unknown) => (body as { error: { code: string } }).error.code;
const message = (body: unknown) => (body as { error: { message: string } }).error.message;

/* ================================================================== */
/* Family matrix: root, nested, unknown nested                          */
/* ================================================================== */

describe('router -> handler contract matrix', () => {
  it('sales: root, detail, summary, payments, record, verify, activate', async () => {
    let r = await dispatch('/api/v1/sales', { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/sales/${SALE.downPaid}`, { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/sales/${SALE.downPaid}/summary`, { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/sales/${SALE.downPaid}/payments`, { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/sales/${SALE.unpaid}/payments`, {
      method: 'POST',
      token: TOKEN2.finance,
      body: { amount: '100.00', paymentType: 'installment', method: 'cash' },
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(201);

    r = await dispatch(`/api/v1/payments/${PAYMENT.second}/verify`, {
      method: 'POST',
      token: TOKEN2.finance,
      body: { decision: 'verified' },
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/sales/${SALE.fullyPaid}/activate`, {
      method: 'POST',
      token: TOKEN2.finance,
      body: {},
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);
  });

  it('customers: root, detail, onboarding token', async () => {
    let r = await dispatch('/api/v1/customers', { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/customers/${CUSTOMER.prospect}`, { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/customers/${CUSTOMER.active}/onboarding-token`, {
      method: 'POST',
      token: TOKEN2.finance,
      body: {},
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(201);
  });

  it('memberships and points: resolve, detail, account, ledger, card', async () => {
    let r = await dispatch('/api/v1/memberships/resolve?identifier=AFH-ABCD-EF01');
    expect(r.handled).toBe(true);
    expect(r.status).toBe(401);
    expect(code(r.body)).toBe('UNAUTHORIZED');

    r = await dispatch(`/api/v1/memberships/${MEMBERSHIP.active}`, { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/points/accounts/${MEMBERSHIP.active}`, { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect([200, 404]).toContain(r.status);

    r = await dispatch(`/api/v1/memberships/${MEMBERSHIP.active}/card`, { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);
  });

  it('commissions, referrals, genealogy, queues', async () => {
    let r = await dispatch('/api/v1/commissions', { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/referrals', { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/genealogy', { token: TOKEN.admin });
    expect(r.handled).toBe(true);
    // No fixture role holds the genealogy view: the branch answers 403
    // instead of routing past it.
    expect(r.status).toBe(403);

    r = await dispatch('/api/v1/queues/finance', { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/queues/activation', { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);
  });

  it('redemptions and cms', async () => {
    let r = await dispatch('/api/v1/redemptions/resolve?identifier=x');
    expect(r.handled).toBe(true);
    expect(r.status).toBe(401);

    r = await dispatch('/api/v1/redemptions/items', { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/redemptions', { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/cms/public');
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);
  });

  it('ost, documents, customer portal, activation, admin, health', async () => {
    let r = await dispatch('/api/v1/ost/referrals/OST-ABCDEF-123456');
    expect(r.handled).toBe(true);
    expect(r.status).toBe(404);
    expect(code(r.body)).toBe('NOT_FOUND');

    r = await dispatch('/api/v1/ost/applications', { token: TOKEN.superAdmin });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/documents/does-not-exist-1');
    expect(r.handled).toBe(true);
    // No session and no row: the branch answers (401 before the read when
    // unauthenticated, 404 after it) instead of routing past it.
    expect([401, 404]).toContain(r.status);

    r = await dispatch('/api/v1/customer/membership');
    expect(r.handled).toBe(true);
    expect(r.status).toBe(401);

    r = await dispatch('/api/v1/auth/customer/activate', { method: 'POST', body: {} });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(400);

    r = await dispatch('/api/v1/admin/afhomes/session');
    expect(r.handled).toBe(true);
    expect(r.status).toBe(401);

    r = await dispatch('/health');
    expect(r.handled).toBe(true);
    expect((r.body as { service?: string }).service).toBe('afhomes-api');
  });

  it('unknown paths miss the router with the safe envelope', async () => {
    const r = await dispatch('/api/v1/nope');
    expect(r.handled).toBe(false);
    // routeRequest leaves the 404 to its caller (api/router.ts and the dev
    // server both render `No handler for <url>` through the safe envelope);
    // the real-HTTP spec below asserts that rendered body.
  });

  it('unknown nested suffixes reach the handler 404, never a collection', async () => {
    for (const url of [
      '/api/v1/sales/not-a-real-subroute/extra',
      '/api/v1/documents/unknown/action',
      '/api/v1/memberships/unknown/action',
    ]) {
      const r = await dispatch(url, { token: TOKEN.admin });
      expect(r.handled, url).toBe(true);
      expect(r.status, url).toBe(404);
      expect(message(r.body), url).not.toMatch(/No handler for/);
    }
  });
});

/* ================================================================== */
/* Authorization survives the repair                                    */
/* ================================================================== */

describe('authorization across the repaired routes', () => {
  it('sales detail: owner reads, stranger gets 404, hr gets 403, anon gets 401', async () => {
    const db = holder.db as FakeSupabase;
    // Give the seller one of their own sales; every other fixture sale
    // belongs to somebody else.
    db.rows('card_sales').find((row) => row.id === SALE.downPaid)!.seller_staff_id =
      STAFF2.salesManager;

    let r = await dispatch(`/api/v1/sales/${SALE.downPaid}`, { token: TOKEN2.salesManager });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch(`/api/v1/sales/${SALE.fullyPaid}`, { token: TOKEN2.salesManager });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(404);

    r = await dispatch(`/api/v1/sales/${SALE.downPaid}`, { token: TOKEN2.hr });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(403);

    r = await dispatch(`/api/v1/sales/${SALE.downPaid}`);
    expect(r.handled).toBe(true);
    expect(r.status).toBe(401);

    r = await dispatch(`/api/v1/sales/${SALE.downPaid}`, { token: TOKEN2.finance });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);
  });

  it('documents detail: uploader reads, unrelated seller is refused', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('identity_documents').push({
      id: 'dddddddd-0000-4000-8000-000000000001',
      subject_type: 'customer',
      customer_id: CUSTOMER.prospect,
      ost_application_id: null,
      storage_path: 'afhomes-customer-ids/customer/doc.jpg',
      original_filename: 'doc.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 10,
      sha256: '0'.repeat(64),
      extracted_data: {},
      reviewed_data: {},
      ocr_status: 'not_requested',
      verification_status: 'pending_review',
      uploaded_by: STAFF2.salesManager,
      created_at: '2026-09-27T00:00:00.000Z',
    });

    let r = await dispatch('/api/v1/documents/dddddddd-0000-4000-8000-000000000001', {
      token: TOKEN2.salesManager,
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(200);

    r = await dispatch('/api/v1/documents/dddddddd-0000-4000-8000-000000000001', {
      token: TOKEN2.seniorSalesManager,
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(403);
  });

  it('finance and employee boundaries hold on the repaired routes', async () => {
    // Finance has no catalog maintenance grant.
    let r = await dispatch('/api/v1/redemptions/items', {
      method: 'POST',
      token: TOKEN2.finance,
      body: { code: 'X', name: 'X', pointsCost: 1 },
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(403);

    // The ost approval route still authorizes before touching the database.
    r = await dispatch(`/api/v1/ost/applications/${UUID.adminStaff}/approve`, {
      method: 'POST',
      token: TOKEN2.salesManager,
      body: {},
    });
    expect(r.handled).toBe(true);
    expect(r.status).toBe(403);
  });
});
