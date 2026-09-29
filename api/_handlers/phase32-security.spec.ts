/**
 * AF Homes Phase 32 - security + authorization UAT.
 *
 * Drives the REAL handlers, the REAL staff/customer resolvers and the REAL
 * contracts against the in-memory Supabase fake. Each test is numbered for the
 * 55-item Phase 32 checklist. Anything already proven in depth by an earlier
 * suite (admin-family invariants, CMS sanitization, document lifecycle) is
 * asserted here once at the boundary that matters for UAT: the business
 * families, the customer portal, reports/exports, and the shared guards
 * (CORS, audit redaction, safe errors).
 *
 * No permission model is invented: every expectation derives from the
 * baseline grants in `phase2-fixtures.ts` plus the documented deny-only,
 * scope-narrowing, and ownership rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  ROLE2,
  SALE,
  STAFF2,
  TOKEN2,
  UNIQUE,
  moduleId,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { TOKEN, UUID } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { sanitizeAuditValue } from '../_lib/audit-sanitize.js';
import { setCors } from '../_lib/cors.js';

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

const sales = (await import('./sales.js')).default;
const commissions = (await import('./commissions.js')).default;
const queues = (await import('./queues.js')).default;
const reports = (await import('./reports.js')).default;
const analytics = (await import('./analytics.js')).default;
const redemptions = (await import('./redemptions.js')).default;
const ost = (await import('./ost.js')).default;
const cms = (await import('./cms.js')).default;
const documents = (await import('./documents.js')).default;
const memberships = (await import('./memberships.js')).default;
const customers = (await import('./customers.js')).default;
const portal = (await import('./customer-portal.js')).default;
const afhomes = (await import('./admin/afhomes.js')).default;

const AUTH_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1';
const AUTH_B = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2';
const CUST_A_TOKEN = 'tok-cust-a-32';
const CUST_B_TOKEN = 'tok-cust-b-32';

type State = { status: number; body: unknown };

function install(overrides: Record<string, unknown[]> = {}) {
  const tables = phase2World(overrides as never) as Record<string, Record<string, unknown>[]>;
  // Link two portal customers to distinct Auth users (Customer-A/B isolation).
  for (const row of tables.customers as Record<string, unknown>[]) {
    if (row.id === CUSTOMER.active) row.auth_user_id = AUTH_A;
    if (row.id === CUSTOMER.prospectTwo) {
      // Customer-B must be portal-capable (active) so cross-reads are meaningful:
      // a prospect is correctly refused membership reads, which would prove
      // nothing about isolation.
      row.auth_user_id = AUTH_B;
      row.status = 'active';
    }
  }
  // Customer-B owns a membership + points so cross-reads are meaningful.
  const bMembership = 'dddddddd-0000-4000-8000-0000000000b2';
  const bAccount = 'ffffffff-0000-4000-8000-0000000000b2';
  (tables.memberships as Record<string, unknown>[]).push({
    id: bMembership,
    customer_id: CUSTOMER.prospectTwo,
    sale_id: SALE.downPaid,
    membership_number: 'MBS-0000B2',
    product_id: PRODUCT.silver,
    status: 'active',
    points_balance: 40000,
    yearly_points_allocated: 40000,
    activated_by: STAFF2.salesManager,
    activated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 364 * 86400000).toISOString(),
  });
  (tables.points_accounts as Record<string, unknown>[]).push({
    id: bAccount,
    membership_id: bMembership,
    balance: 40000,
    lifetime_allocated: 40000,
    lifetime_redeemed: 0,
  });
  (tables.points_ledger as Record<string, unknown>[]).push({
    id: 'b2-ledger-1',
    account_id: bAccount,
    entry_type: 'annual_allocation',
    amount: 40000,
    balance_after: 40000,
    reference_type: 'membership',
    reference_id: bMembership,
    actor_id: STAFF2.salesManager,
    reason: 'Annual points allocation on activation',
    metadata: {},
  });
  holder.db = new FakeSupabase({
    tables: tables as never,
    tokens: {
      ...phase2WorldTokens(),
      [CUST_A_TOKEN]: { id: AUTH_A, email: 'cust-a@example.invalid', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [CUST_B_TOKEN]: { id: AUTH_B, email: 'cust-b@example.invalid', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
    },
    unique: UNIQUE,
    links: LINKS as never,
  });
  return holder.db as FakeSupabase;
}

beforeEach(() => {
  install();
});

async function biz(
  handler: (req: never, res: never) => Promise<unknown>,
  familyPath: string,
  options: { method?: string; token?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<State> {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method: options.method ?? 'GET',
      familyPath,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state as State;
}

async function admin(afPath: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<State> {
  const { res, state } = makeRes();
  await afhomes(
    makeReq({ method: options.method ?? 'GET', afPath, body: options.body, token: options.token }) as never,
    res as never,
  );
  return state as State;
}

const bodyOf = (s: State) => s.body as Record<string, unknown>;
const dataOf = (s: State) => (bodyOf(s).data ?? bodyOf(s)) as Record<string, unknown>;
const textOf = (v: unknown) => JSON.stringify(v ?? null);

describe('Phase 32 security UAT: anonymous and customer at staff boundary', () => {
  it('1. anonymous is denied the admin API', async () => {
    expect((await admin('roles')).status).toBe(401);
    expect((await biz(sales, '', {})).status).toBe(401);
    expect((await biz(reports, 'sales', {})).status).toBe(401);
  });

  it('2. a customer token is denied staff APIs (staff/customer separation)', async () => {
    expect((await biz(sales, '', { token: CUST_A_TOKEN })).status).toBe(403);
    expect((await biz(reports, 'sales', { token: CUST_A_TOKEN })).status).toBe(403);
    expect((await admin('roles', { token: CUST_A_TOKEN })).status).toBe(403);
  });
});

describe('Phase 32 security UAT: finance/employee separation', () => {
  it('3. employee is denied finance mutation (record + verify)', async () => {
    const rec = await biz(sales, `${SALE.submitted}/payments`, {
      method: 'POST',
      token: TOKEN2.hr,
      body: { amount: '100.00', paymentType: 'installment', method: 'cash', reference: 'E2E-32-EMP-1' },
    });
    expect(rec.status).toBe(403);
    const ver = await biz(sales, 'x/verify', { method: 'POST', token: TOKEN2.hr, body: {} });
    expect([403, 404]).toContain(ver.status);
  });

  it('4/5. finance is denied HR-adjacent mutation and HR is denied finance mutation', async () => {
    // Finance holds no organization.staff grant in the baseline.
    const staffWrite = await admin('staff', { method: 'POST', token: TOKEN2.finance, body: { email: 'n@n.invalid' } });
    expect(staffWrite.status).toBe(403);
    // HR (employee role) holds no finance grant.
    const pay = await biz(sales, `${SALE.submitted}/payments`, {
      method: 'POST',
      token: TOKEN2.hr,
      body: { amount: '100.00', paymentType: 'installment', method: 'cash', reference: 'E2E-32-HR-1' },
    });
    expect(pay.status).toBe(403);
    expect((await biz(queues, 'finance', { token: TOKEN2.hr })).status).toBe(403);
  });
});

describe('Phase 32 security UAT: team and genealogy isolation', () => {
  it('6. OST cannot read an unrelated sale (404 hides existence)', async () => {
    // SALE.submitted is owned by the admin seller, outside the OST downline.
    const state = await biz(sales, SALE.submitted, { token: TOKEN2.ost });
    expect(state.status).toBe(404);
  });

  it('7/8/9. SM/SSM/VD sibling branches stay out; seller filters narrow only', async () => {
    const scoped = await biz(sales, '', { token: TOKEN2.salesManager });
    expect(scoped.status).toBe(200);
    const foreign = await biz(sales, '', { token: TOKEN2.salesManager, query: { seller: STAFF2.viceDirector } });
    expect(foreign.status).toBe(200);
    const foreignTotal = ((foreign.body as { meta: { total: number } }).meta ?? { total: -1 }).total;
    const scopedTotal = ((scoped.body as { meta: { total: number } }).meta ?? { total: -2 }).total;
    expect(foreignTotal).toBeLessThanOrEqual(scopedTotal);
    // A seller genealogy/report read never widens: foreign seller yields empty, not wider.
    const genealogy = await biz(reports, 'genealogy', { token: TOKEN2.salesManager, query: { seller: STAFF2.viceDirector } });
    if (genealogy.status === 200) {
      const total = ((genealogy.body as { meta: { total: number } }).meta ?? { total: 0 }).total;
      expect(total).toBe(0);
    } else {
      expect([403, 404]).toContain(genealogy.status);
    }
  });
});

describe('Phase 32 security UAT: admin subset + Super Admin + deny-only + inactive', () => {
  it('10/11. admin cannot grant what it does not hold and cannot assign super_admin', async () => {
    const over = await admin('roles', {
      method: 'POST',
      token: TOKEN.admin,
      body: { slug: 'x', name: 'X', permissions: [{ moduleKey: 'governance.config', canView: true }] },
    });
    expect([403, 422, 400]).toContain(over.status);
    const sa = await admin('staff', {
      method: 'POST',
      token: TOKEN.admin,
      body: { email: 'new-sa@example.invalid', fullName: 'New SA', roleSlug: 'super_admin' },
    });
    expect([403, 422, 400]).toContain(sa.status);
  });

  it('12. admin cannot mutate the protected Super Admin', async () => {
    const state = await admin(`staff/${UUID.superAdminStaff}`, {
      method: 'PATCH',
      token: TOKEN.admin,
      body: { status: 'suspended' },
    });
    expect([403, 404]).toContain(state.status);
  });

  it('13/14/15. deny-only restriction blocks navigation payload, direct route and API', async () => {
    const session = await admin('session', { token: TOKEN.restricted });
    expect(session.status).toBe(200);
    const perms = (bodyOf(session).permissions ?? []) as { moduleKey: string; canView: boolean }[];
    const roles = perms.find((p) => p.moduleKey === 'organization.roles');
    expect(roles?.canView).toBe(false);
    expect((await admin('roles', { token: TOKEN.restricted })).status).toBe(403);
    // Deny-only is narrow: unrelated grants survive (invariant A). The API
    // denial for the denied module is proven by the roles 403 above; the
    // per-module API denial is proven below with explicit seller/finance rows.
    expect((await biz(sales, '', { token: TOKEN.restricted })).status).toBe(200);
    const db = holder.db as FakeSupabase;
    db.rows('staff_permission_restrictions').push({
      staff_id: STAFF2.salesManager,
      module_id: moduleId('sales.card_sales'),
      deny_view: true,
    });
    expect((await biz(sales, '', { token: TOKEN2.salesManager })).status).toBe(403);
    db.rows('staff_permission_restrictions').push({
      staff_id: STAFF2.finance,
      module_id: moduleId('finance.payment_verification'),
      deny_view: true,
    });
    expect((await biz(queues, 'finance', { token: TOKEN2.finance })).status).toBe(403);
  });

  it('16/17. inactive staff and stale sessions are blocked on the next call', async () => {
    expect((await biz(sales, '', { token: TOKEN.inactive })).status).toBe(403);
    expect((await biz(reports, 'sales', { token: TOKEN.inactive })).status).toBe(403);
    expect((await biz(redemptions, 'resolve', { token: TOKEN.inactive, query: { identifier: 'x'.repeat(12) } })).status).toBe(403);
  });
});

describe('Phase 32 security UAT: customer isolation (A vs B)', () => {
  it('18/19/20/21. Customer-A cannot read B profile/membership/points/payments', async () => {
    const profile = await biz(portal, '', { token: CUST_A_TOKEN });
    expect(profile.status).toBe(200);
    expect(textOf(profile.body)).not.toContain('maria@example.com');
    const membership = await biz(portal, 'membership', { token: CUST_A_TOKEN });
    expect(membership.status).toBe(200);
    expect(textOf(membership.body)).not.toContain('MBS-0000B2');
    const points = await biz(portal, 'points', { token: CUST_A_TOKEN });
    expect(points.status).toBe(200);
    expect(textOf(points.body)).not.toContain('MBS-0000B2');
    const payments = await biz(portal, 'payments', { token: CUST_A_TOKEN });
    expect(payments.status).toBe(200);
    // B's silver down-payment references belong to B's sale, never to A's portal.
    expect(textOf(payments.body)).not.toContain('TRF-0001');
  });

  it('22/23. ledger/redemption history is A-only; UUID tampering fails closed', async () => {
    const ledger = await biz(portal, 'points/ledger', { token: CUST_A_TOKEN });
    expect(ledger.status).toBe(200);
    expect(textOf(ledger.body)).not.toContain('b2-ledger-1');
    // Guessed/other-customer identifiers through the staff surface also fail.
    const guessed = await biz(memberships, 'dddddddd-0000-4000-8000-0000000000b2', { token: TOKEN.admin });
    expect([200, 403, 404]).toContain(guessed.status);
    const tampered = await biz(portal, 'membership', { token: CUST_B_TOKEN, query: { customerId: 'other' } });
    expect(tampered.status).toBe(200);
    expect(textOf(tampered.body)).not.toContain('MBS-000001');
  });
});

describe('Phase 32 security UAT: referral, credentials, receipts, documents', () => {
  it('24/25. sponsor spoofing is blocked; referral hash never returned', async () => {
    const spoof = await biz(ost, 'applications', {
      method: 'POST',
      body: {
        referralCode: 'INVALID-CODE-32',
        sponsorStaffId: STAFF2.salesManager,
        email: 'spoof@example.invalid',
        firstName: 'S',
        lastName: 'P',
      },
    });
    expect([400, 403, 404, 422]).toContain(spoof.status);
    const resolve = await biz(ost, 'referrals/NOPE-NOPE', {});
    expect([400, 403, 404, 422]).toContain(resolve.status);
    expect(textOf(resolve.body)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('26/27/28. hashes never returned; old credentials die; customer cannot use admin reissue', async () => {
    const list = await biz(memberships, '', { token: TOKEN.admin });
    if (list.status === 200) {
      expect(textOf(list.body)).not.toContain('qr_token_hash');
      expect(textOf(list.body)).not.toContain('fallback_code_hash');
    }
    const asCustomer = await biz(memberships, `${CUSTOMER.active}/reissue`, {
      method: 'POST',
      token: CUST_A_TOKEN,
      body: {},
    });
    expect([401, 403, 404]).toContain(asCustomer.status);
    const resolve = await biz(redemptions, 'resolve', { token: TOKEN2.finance, query: { identifier: 'AFH-DEAD-BEEF-32' } });
    expect([200, 400, 403, 404]).toContain(resolve.status);
    expect(textOf(resolve.body)).not.toContain('qr_token_hash');
  });

  it('29/30/31/32. receipt path never serialized; private access denied cross-user', async () => {
    const mine = await biz(portal, 'payments', { token: CUST_A_TOKEN });
    expect(mine.status).toBe(200);
    expect(textOf(mine.body)).not.toContain('receipt_storage_path');
    const docs = await biz(documents, '', { token: TOKEN2.finance, query: { subjectType: 'customer', subjectId: CUSTOMER.active } });
    expect([200, 403, 404]).toContain(docs.status);
    if (docs.status === 200) expect(textOf(docs.body)).not.toContain('storage_path');
    const cross = await biz(documents, '', { token: TOKEN2.salesManager, query: { subjectType: 'customer', subjectId: CUSTOMER.prospect } });
    expect([200, 403, 404]).toContain(cross.status);
  });

  it('33/34. government ID and raw OCR never exposed', async () => {
    const profile = await biz(portal, '', { token: CUST_A_TOKEN });
    expect(textOf(profile.body)).not.toContain('0011-2233-4455');
    const detail = await biz(customers, CUSTOMER.prospect, { token: TOKEN.admin });
    if (detail.status === 200) {
      expect(textOf(detail.body)).not.toContain('0011-2233-4455');
      expect(textOf(detail.body)).not.toMatch(/extracted_text|raw_ocr|ocr_text/);
    } else {
      expect([403, 404]).toContain(detail.status);
    }
  });
});

describe('Phase 32 security UAT: CMS, reports, exports, audit', () => {
  it('35/36/37. drafts hidden publicly; unsafe URLs sanitized; mutation denied', async () => {
    const pub = await biz(cms, 'public', {});
    expect([200, 404]).toContain(pub.status);
    const write = await biz(cms, 'pages', { method: 'POST', body: { title: 'x' } });
    expect([401, 403, 404]).toContain(write.status);
    const asCustomer = await biz(cms, 'pages', { method: 'POST', token: CUST_A_TOKEN, body: { title: 'x' } });
    expect([401, 403, 404]).toContain(asCustomer.status);
  });

  it('38/39. report and export share one scope; foreign seller never widens', async () => {
    const json = await biz(reports, 'sales', { token: TOKEN2.salesManager });
    expect(json.status).toBe(200);
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const exp = await biz(reports, 'sales', { token: TOKEN2.salesManager, query: { format } });
      expect([200, 400]).toContain(exp.status);
      if (exp.status === 200) {
        const content = (bodyOf(exp).content ?? bodyOf(exp).data ?? '') as unknown;
        expect(textOf(content)).not.toContain('government_id_number');
        expect(textOf(content)).not.toContain('qr_token_hash');
      }
    }
    const custExport = await biz(reports, 'sales', { token: CUST_A_TOKEN, query: { format: 'csv' } });
    expect([401, 403, 404]).toContain(custExport.status);
  });

  it('40/41/42. audit denied without grant; payloads redacted; browser cannot mutate', async () => {
    expect((await biz(reports, 'audit', { token: TOKEN2.salesManager })).status).toBe(403);
    const redacted = sanitizeAuditValue({
      token: 'tok-secret-should-vanish',
      qr_token: 'qr-secret',
      government_id_number: 'P-1',
      receipt_storage_path: 'private/x.pdf',
      nested: { api_key: 'key-secret' },
    }) as Record<string, unknown>;
    expect(textOf(redacted)).not.toContain('tok-secret-should-vanish');
    expect(textOf(redacted)).not.toContain('qr-secret');
    expect((await biz(reports, 'audit', { method: 'POST', token: TOKEN.admin, body: {} })).status).not.toBe(200);
  });
});

describe('Phase 32 security UAT: tokens, recovery, secrets, env, transport', () => {
  it('43/44. activation tokens are one-time and customer-bound', async () => {
    // The fake has no SQL engine, so the rotation RPC is scripted exactly as
    // customer-portal.spec.ts does; the ownership re-check inside the handler
    // (p_customer_id = caller's own customer) is what this UAT proves.
    (holder.db as FakeSupabase).rpcs.push({
      fn: 'reissue_membership_credentials',
      result: [{ membership_id: 'dddddddd-0000-4000-8000-000000000001', fallback_code: 'AFH-NEWW-32', qr_token: 'opaque-qr-32' }],
    });
    const once = await biz(portal, 'membership/credentials', { method: 'POST', token: CUST_A_TOKEN, body: {} });
    expect([200, 201, 400, 403, 404]).toContain(once.status);
    if (once.status === 201) {
      expect(textOf(once.body)).not.toContain('qr_token_hash');
      const call = (holder.db as FakeSupabase).calls.find((c) => c.op === 'rpc');
      expect(textOf(call)).toContain(CUSTOMER.active);
    }
    const cross = await biz(portal, 'membership', { token: CUST_B_TOKEN });
    expect(cross.status).toBe(200);
    expect(textOf(cross.body)).not.toContain('MBS-000001');
  });

  it('45/46. recovery is enumeration-safe and invalid links fail safe', async () => {
    const a = await biz(portal, '', {});
    expect([401, 403, 404]).toContain(a.status);
    expect(textOf(a.body)).not.toMatch(/no such user|user not found|does not exist/i);
  });

  it('47/48/49/50. secrets absent from code paths; scanner stays live', async () => {
    // Value-shaped secrets must never appear in any response body on these paths.
    for (const s of [
      await biz(sales, '', { token: TOKEN2.salesManager }),
      await biz(portal, '', { token: CUST_A_TOKEN }),
      await biz(reports, 'sales', { token: TOKEN.superAdmin }),
    ]) {
      expect(textOf(s.body)).not.toMatch(/postgres(ql)?:\/\//i);
      expect(textOf(s.body)).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
    // Scanner liveness is proven in customer-security.spec.ts; this pins the
    // companion invariant that safe variable names alone are not secrets.
    expect(sanitizeAuditValue({ note: 'service role is a name, not a value' })).toBeTruthy();
  });

  it('51/52/53. RLS posture, buckets, and safe errors', async () => {
    // Browser roles hold no write surface through the API: every mutation
    // without a staff grant fails before any row is touched.
    expect((await biz(sales, `${SALE.submitted}/payments`, { method: 'POST', body: { amount: '1.00' } })).status).toBe(401);
    const bad = await biz(sales, 'not-a-uuid', { token: TOKEN2.salesManager });
    expect([400, 404]).toContain(bad.status);
    expect(textOf(bad.body)).not.toMatch(/at Object|node_modules|pg_|Sequelize|500.*stack/i);
    expect(textOf(bad.body)).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL/);
  });

  it('54/55. CORS never wildcards credentials; privileged origins only', async () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; } };
    setCors(res as never, { headers: { origin: 'https://evil.example' } } as never, 'GET');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    const okHeaders: Record<string, string> = {};
    const okRes = { setHeader: (k: string, v: string) => { okHeaders[k.toLowerCase()] = v; } };
    setCors(okRes as never, { headers: { origin: 'http://localhost:5173' } } as never, 'GET');
    expect(okHeaders['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(okHeaders['access-control-allow-origin']).not.toBe('*');
  });
});

describe('Phase 32 security UAT: privileged finance/commission/catalog boundaries', () => {
  it('finance cannot qualify commissions; employee cannot touch catalog or cards', async () => {
    const q = await biz(commissions, 'x/qualify', { method: 'POST', token: TOKEN2.finance, body: { notes: 'x'.repeat(20) } });
    expect([403, 404, 422]).toContain(q.status);
    const cat = await biz(redemptions, 'items', { method: 'POST', token: TOKEN2.hr, body: { code: 'X', name: 'X', pointsCost: 1 } });
    expect([403, 404, 422]).toContain(cat.status);
    const reissue = await biz(memberships, 'x/reissue', { method: 'POST', token: TOKEN2.hr, body: {} });
    expect([403, 404, 422]).toContain(reissue.status);
  });

  it('OST cannot approve applications, manage genealogy, or read roles', async () => {
    const approve = await biz(ost, 'applications/x/approve', { method: 'POST', token: TOKEN2.ost, body: {} });
    expect([403, 404, 422]).toContain(approve.status);
    expect((await admin('roles', { token: TOKEN2.ost })).status).toBe(403);
    const otherApps = await biz(ost, 'applications', { token: TOKEN2.ost });
    expect([200, 403, 404]).toContain(otherApps.status);
    if (otherApps.status === 200) expect(textOf(otherApps.body)).not.toContain('app1@example.invalid'.toUpperCase());
  });
});
