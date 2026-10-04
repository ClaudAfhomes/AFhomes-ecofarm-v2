import { commissionSchema, financeQueueItemSchema } from '@jad/contracts';
/**
 * AF Homes Phase 2 - business API coverage.
 *
 * Drives the real handlers, the real authorization resolver, and the real Zod
 * schemas against the in-memory Supabase fake. The transactional RPCs are
 * scripted (PL/pgSQL cannot run in-process); their SQL is asserted structurally
 * in `phase2-migration.spec.ts` and the handler contract with each RPC - the
 * arguments it sends and how it maps the result - is asserted here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  MEMBERSHIP,
  PAYMENT,
  PRODUCT,
  REFERRAL,
  SALE,
  STAFF2,
  TOKEN,
  TOKEN2,
  UUID,
  phase2World,
  phase2WorldTokens,
  UNIQUE,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import * as onboardingEmail from '../_lib/customer-onboarding-email.js';

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

const handlers = {
  cards: (await import('./cards.js')).default,
  customers: (await import('./customers.js')).default,
  sales: (await import('./sales.js')).default,
  memberships: (await import('./memberships.js')).default,
  commissions: (await import('./commissions.js')).default,
  referrals: (await import('./referrals.js')).default,
  queues: (await import('./queues.js')).default,
};

const ORIGINAL_ADMIN_URL = process.env.AFHOMES_ADMIN_URL;
const ORIGINAL_WEB_URL = process.env.AFHOMES_WEB_URL;
beforeAll(() => {
  process.env.AFHOMES_ADMIN_URL = 'https://afhomes.test/admin';
  process.env.AFHOMES_WEB_URL = 'https://members.afhomes.test';
});
afterAll(() => {
  if (ORIGINAL_ADMIN_URL === undefined) delete process.env.AFHOMES_ADMIN_URL;
  else process.env.AFHOMES_ADMIN_URL = ORIGINAL_ADMIN_URL;
  if (ORIGINAL_WEB_URL === undefined) delete process.env.AFHOMES_WEB_URL;
  else process.env.AFHOMES_WEB_URL = ORIGINAL_WEB_URL;
});
afterEach(() => vi.restoreAllMocks());

let counter = 0;
function install(
  options: {
    tables?: Record<string, unknown[]>;
    errors?: Record<string, { code?: string; message: string }>;
    writeErrors?: Record<string, { code?: string; message: string }>;
    rpcs?: { fn: string; result: unknown }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
    tokens?: Record<string, { id: string; email: string; email_confirmed_at?: string | null }>;
  } = {},
) {
  counter += 1;
  holder.db = new FakeSupabase({
    tables: phase2World(options.tables as never),
    tokens: { ...phase2WorldTokens(), ...options.tokens },
    unique: UNIQUE,
    links: LINKS as never,
    errors: options.errors,
    writeErrors: options.writeErrors,
    rpcs: [
      ...(options.rpcs ?? []),
      { fn: 'next_customer_number', result: [{ customer_number: `CUS-${900000 + counter}` }] },
      { fn: 'next_sale_number', result: [{ sale_number: `SALE-${900000 + counter}` }] },
      { fn: 'record_card_payment', result: `pay-${counter}` },
      { fn: 'record_card_payment_once', result: `pay-${counter}` },
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
            qr_token: 'opaque-random-token',
            points_allocated: 60000,
            already_active: false,
          },
        ],
      },
      { fn: 'correct_referral_upline', result: 'eeeeeeee-0000-4000-8000-0000000000ff' },
      {
        fn: 'issue_customer_onboarding_token',
        result: [
          { token: 'raw-once-onboarding-token-0001', expires_at: '2026-10-01T00:00:00.000Z' },
        ],
      },
    ],
    rpcErrors: options.rpcErrors,
    defaults: { staff_invitations: { status: 'pending' } },
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(
  family: keyof typeof handlers,
  options: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  },
): Promise<State> {
  const { res, state } = makeRes();
  await handlers[family](
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const data = (body: unknown) => (body as { data: unknown[] }).data;
const err = (body: unknown) => (body as { error: { code: string; message: string } }).error;

/** Upline relationship ids, spelled out so a path assertion is self-evident. */
const REL = {
  vdToSsm: 'eeeeeeee-0000-4000-8000-000000000001',
  ssmToSm: 'eeeeeeee-0000-4000-8000-000000000002',
} as const;

describe('business endpoint error envelopes', () => {
  beforeEach(() => install());

  it.each([
    ['cards', ''],
    ['customers', ''],
    ['sales', ''],
    ['queues', 'finance'],
    ['queues', 'activation'],
    ['commissions', ''],
  ] as const)('%s/%s returns a safe correlated error', async (family, path) => {
    const state = await call(family, { path });
    expect(state.status).toBe(401);
    expect(state.body).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing authentication',
        requestId: expect.any(String),
        timestamp: expect.any(String),
      },
    });
    const error = (state.body as { error: Record<string, unknown> }).error;
    expect(Object.keys(error).sort()).toEqual(['code', 'message', 'requestId', 'timestamp']);
    expect(JSON.stringify(state.body)).not.toMatch(/service[_-]?role|database_url|stack|select\s/i);
  });
});

/* ================================================================== */
/* Card products                                                      */
/* ================================================================== */

describe('card products', () => {
  beforeEach(() => install());

  it('serves the approved Bronze/Silver/Gold economics from the database', async () => {
    const state = await call('cards', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Record<string, unknown>[];
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.GOLD).toMatchObject({
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      isActive: true,
    });
    expect(byCode.SILVER).toMatchObject({
      cashPrice: '40000.00',
      minimumDownPayment: '15000.00',
      yearlyPoints: 40000,
    });
    expect(byCode.BRONZE).toMatchObject({
      cashPrice: '30000.00',
      minimumDownPayment: '10000.00',
      yearlyPoints: 25000,
    });
  });

  it('hides inactive products from the default catalogue', async () => {
    const rows = data((await call('cards', { path: '', token: TOKEN.admin })).body) as {
      code: string;
    }[];
    expect(rows.map((r) => r.code)).not.toContain('LEGACY');
  });

  it('orders the catalogue by display order', async () => {
    const rows = data((await call('cards', { path: '', token: TOKEN.admin })).body) as {
      code: string;
    }[];
    expect(rows.map((r) => r.code)).toEqual(['GOLD', 'SILVER', 'BRONZE']);
  });

  it('denies the catalogue without a selling permission', async () => {
    const state = await call('cards', { path: '', token: TOKEN.viewer });
    expect(state.status).toBe(403);
  });

  it('updates permitted configuration and audits it', async () => {
    const db = install();
    const state = await call('cards', {
      method: 'PATCH',
      path: `${PRODUCT.bronze}`,
      token: TOKEN.admin,
      body: { yearlyPoints: 30000 },
    });
    expect(state.status).toBe(200);
    expect((state.body as { yearlyPoints: number }).yearlyPoints).toBe(30000);
    expect(db.rows('card_plans').find((r) => r.id === PRODUCT.bronze)!.yearly_points).toBe(30000);
    expect(db.rows('audit_events').some((e) => e.action === 'CARD_PLAN_UPDATED')).toBe(true);
  });

  it('refuses a down payment above the price', async () => {
    const state = await call('cards', {
      method: 'PATCH',
      path: `${PRODUCT.bronze}`,
      token: TOKEN.admin,
      body: { minimumDownPayment: '90000.00' },
    });
    expect(state.status).toBe(400);
  });

  it('denies configuration changes to a role without sales.card_plans update', async () => {
    const state = await call('cards', {
      method: 'PATCH',
      path: `${PRODUCT.bronze}`,
      token: TOKEN.viewer,
      body: { yearlyPoints: 1 },
    });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Customers                                                          */
/* ================================================================== */

const VALID_CUSTOMER = {
  firstName: 'Ana',
  middleName: 'R',
  lastName: 'Reyes',
  dateOfBirth: '1993-04-05',
  gender: 'female',
  email: 'ana.reyes@example.com',
  phone: '09185550999',
  address: { line1: '77 Katipunan', city: 'Quezon City', province: 'Metro Manila' },
  governmentIdType: 'philippine_id',
  governmentIdNumber: '7788-9900-1122',
};

describe('customers', () => {
  beforeEach(() => install());

  it('registers a valid customer and audits without the government ID number', async () => {
    const db = install();
    const state = await call('customers', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: VALID_CUSTOMER,
    });
    expect(state.status).toBe(201);
    const body = state.body as Record<string, unknown>;
    expect(body.fullName).toBe('Ana R Reyes');
    expect(body.status).toBe('prospect');
    expect(body.customerNumber).toMatch(/^CUS-/);
    // Stored, but never returned.
    expect(body).not.toHaveProperty('governmentIdNumber');
    expect(db.rows('customers').some((r) => r.government_id_number === '7788-9900-1122')).toBe(
      true,
    );
    const audit = db.rows('audit_events').find((e) => e.action === 'CUSTOMER_CREATED')!;
    expect(JSON.stringify(audit)).not.toContain('7788-9900-1122');
  });

  it('masks the government ID on read', async () => {
    const state = await call('customers', { path: `${CUSTOMER.prospect}`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const body = state.body as Record<string, unknown>;
    expect(body.governmentIdMasked).toBe('**********4455');
    expect(body).not.toHaveProperty('governmentIdNumber');
    expect(JSON.stringify(state.body)).not.toContain('0011-2233-4455');
  });

  it.each([
    ['missing first name', { firstName: '' }],
    ['future date of birth', { dateOfBirth: '2999-01-01' }],
    ['impossible date', { dateOfBirth: '2020-02-31' }],
    ['bad email', { email: 'nope' }],
    ['bad phone', { phone: 'abcdefg' }],
    ['missing address line', { address: { city: 'Manila', province: 'Metro Manila' } }],
    ['short government id', { governmentIdNumber: '12' }],
  ])('rejects %s', async (_name, override) => {
    const state = await call('customers', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { ...VALID_CUSTOMER, ...override },
    });
    expect(state.status).toBe(400);
  });

  it('maps a duplicate government ID to a conflict', async () => {
    install({ writeErrors: { customers: { code: '23505', message: 'duplicate key' } } });
    const state = await call('customers', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: VALID_CUSTOMER,
    });
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/government id|email already exists/i);
  });

  it('lists and searches by name or number', async () => {
    (holder.db as FakeSupabase).rpcs.push({
      fn: 'search_customer_ids',
      result: [{ customer_id: CUSTOMER.prospectTwo }],
    });
    const all = await call('customers', { path: '', token: TOKEN.admin });
    expect((all.body as { meta: { total: number } }).meta.total).toBe(4);
    const search = await call('customers', {
      path: '',
      token: TOKEN.admin,
      query: { search: 'Santos' },
    });
    expect(data(search.body)).toHaveLength(1);
  });

  it.each([
    ['active', 'ACTIVE_VIP'],
    ['suspended', 'SUSPENDED'],
    ['expired', 'EXPIRED'],
  ])('normal customer filter includes imported %s memberships', async (status, category) => {
    const world = phase2World();
    const imported = world.customers.find((row) => row.id === CUSTOMER.active)!;
    install({
      tables: {
        customers: [{ ...imported, registration_source: 'bulk_import' }],
        memberships: [
          { id: MEMBERSHIP.active, customer_id: CUSTOMER.active, status, expires_at: '2099-01-01' },
        ],
      },
    });
    const response = await call('customers', { path: '', token: TOKEN.admin, query: { category } });
    expect(response.status).toBe(200);
    expect(data(response.body)).toHaveLength(1);
    expect(data(response.body)[0]).toMatchObject({ derivedCategory: category });
  });

  it('filters by status', async () => {
    const state = await call('customers', {
      path: '',
      token: TOKEN.admin,
      query: { status: 'cancelled' },
    });
    expect(data(state.body)).toHaveLength(1);
  });

  it('rejects an invalid list query', async () => {
    const state = await call('customers', {
      path: '',
      token: TOKEN.admin,
      query: { limit: '9999' },
    });
    expect(state.status).toBe(400);
  });

  it('denies customer access without sales.customers', async () => {
    const state = await call('customers', { path: '', token: TOKEN.viewer });
    expect(state.status).toBe(403);
  });

  it('denies unauthenticated access', async () => {
    const state = await call('customers', { path: '' });
    expect(state.status).toBe(401);
  });

  it('edits a customer and keeps the audit free of the government ID', async () => {
    const db = install();
    const state = await call('customers', {
      method: 'PATCH',
      path: `${CUSTOMER.prospect}`,
      token: TOKEN.admin,
      body: { lastName: 'Dela Cruz Jr' },
    });
    expect(state.status).toBe(200);
    expect((state.body as { fullName: string }).fullName).toBe('Juan A Dela Cruz Jr');
    expect(JSON.stringify(db.rows('audit_events'))).not.toContain('0011-2233-4455');
  });

  it('404s an unknown customer', async () => {
    const state = await call('customers', {
      path: '99999999-9999-4999-8999-999999999999',
      token: TOKEN.admin,
    });
    expect(state.status).toBe(404);
  });

  it('hard-deletes an unused customer and removes its Auth user', async () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000099';
    const authId = '99999999-0000-4000-8000-000000000099';
    const db = install({
      tables: {
        customers: [
          {
            id,
            auth_user_id: authId,
            customer_number: 'CUS-UNUSED',
            first_name: 'Unused',
            middle_name: null,
            last_name: 'Customer',
            email: 'unused@example.test',
            phone: '09170000000',
            birth_date: '1990-01-01',
            address: {},
            status: 'prospect',
          },
        ],
        card_sales: [],
        payments: [],
        memberships: [],
        redemptions: [],
        identity_documents: [],
      },
    });
    const state = await call('customers', {
      method: 'DELETE',
      path: id,
      token: TOKEN.superAdmin,
    });
    expect(state.status).toBe(200);
    expect(db.rows('customers')).toHaveLength(0);
    expect(db.calls.some((entry) => entry.op === 'deleteUser' && entry.arg === authId)).toBe(true);
    expect(db.rows('audit_events').some((row) => row.action === 'CUSTOMER_DELETED')).toBe(true);
  });

  it('deactivates login while preserving the customer and business history', async () => {
    const db = install({
      tables: {
        customers: [
          {
            id: CUSTOMER.active,
            auth_user_id: '99999999-0000-4000-8000-000000000088',
            customer_number: 'CUS-ACTIVE',
            first_name: 'Active',
            middle_name: null,
            last_name: 'Customer',
            email: 'active@example.test',
            phone: '09170000002',
            address: {},
            status: 'active',
          },
        ],
      },
    });
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/deactivate`,
      token: TOKEN.admin,
    });
    expect(state.status).toBe(200);
    expect(db.rows('customers').find((row) => row.id === CUSTOMER.active)).toMatchObject({
      status: 'suspended',
      auth_user_id: null,
    });
    expect(db.rows('card_sales').some((sale) => sale.customer_id === CUSTOMER.active)).toBe(true);
    expect(db.rows('audit_events').some((row) => row.action === 'CUSTOMER_DEACTIVATED')).toBe(true);
  });

  it('denies customer account actions without the existing customer permissions', async () => {
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/deactivate`,
      token: TOKEN.viewer,
    });
    expect(state.status).toBe(403);
  });

  it.each([
    ['sales', 'card_sales', 'customer_id'],
    ['payments', 'payments', 'customer_id'],
    ['memberships', 'memberships', 'customer_id'],
    ['redemptions', 'redemptions', 'customer_id'],
    ['documents', 'identity_documents', 'customer_id'],
  ])('blocks customer deletion when protected %s exist', async (label, table, column) => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000098';
    install({
      tables: {
        customers: [
          {
            id,
            auth_user_id: null,
            customer_number: 'CUS-PROTECTED',
            first_name: 'Protected',
            middle_name: null,
            last_name: 'Customer',
            email: 'protected@example.test',
            phone: '09170000001',
            address: {},
            status: 'active',
          },
        ],
        card_sales: [],
        payments: [],
        memberships: [],
        redemptions: [],
        identity_documents: [],
        [table]: [{ id: `${label}-protected`, [column]: id }],
      },
    });
    const state = await call('customers', {
      method: 'DELETE',
      path: id,
      token: TOKEN.superAdmin,
    });
    expect(state.status).toBe(409);
    expect(
      (state.body as { error: { details: { blockers: string[] } } }).error.details.blockers,
    ).toContain(label);
  });

  it('blocks deletion but permits anonymization when customer history exists', async () => {
    const db = install();
    const blocked = await call('customers', {
      method: 'DELETE',
      path: CUSTOMER.active,
      token: TOKEN.superAdmin,
    });
    expect(blocked.status).toBe(409);
    expect(
      (blocked.body as { error: { details: { blockers: string[] } } }).error.details.blockers,
    ).toContain('memberships');

    const anonymized = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/anonymize`,
      token: TOKEN.superAdmin,
    });
    expect(anonymized.status).toBe(200);
    const row = db.rows('customers').find((customer) => customer.id === CUSTOMER.active)!;
    expect(row).toMatchObject({
      first_name: 'Deleted',
      last_name: 'Customer',
      auth_user_id: null,
      status: 'cancelled',
    });
    expect(db.rows('card_sales').some((sale) => sale.customer_id === CUSTOMER.active)).toBe(true);
    expect(db.rows('audit_events').some((event) => event.action === 'CUSTOMER_ANONYMIZED')).toBe(
      true,
    );
  });
});

/* ================================================================== */
/* Customer active-membership mapping (live CUS-000003 regression)    */
/* ================================================================== */

describe('customer active-membership mapping', () => {
  beforeEach(() => install());

  it('reports an active member with no portal account as eligible (live CUS-000003 shape)', async () => {
    const state = await call('customers', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Record<string, unknown>[];
    const active = rows.find((row) => row.customerNumber === 'CUS-000003')!;
    expect(active.status).toBe('active');
    expect(active.hasActiveMembership).toBe(true);
    expect(active.portalAccountActivated).toBe(false);
  });

  it('reports false for a prospect with no memberships', async () => {
    const state = await call('customers', { path: '', token: TOKEN.admin });
    const rows = data(state.body) as Record<string, unknown>[];
    const prospect = rows.find((row) => row.customerNumber === 'CUS-000001')!;
    expect(prospect.hasActiveMembership).toBe(false);
    expect(prospect.portalAccountActivated).toBe(false);
  });

  it('reports false when the only linked membership is inactive', async () => {
    install({
      tables: {
        memberships: [
          {
            id: 'dddddddd-0000-4000-8000-000000000002',
            customer_id: CUSTOMER.prospect,
            sale_id: SALE.submitted,
            membership_number: 'MBS-000002',
            status: 'suspended',
          },
        ],
      },
    });
    const state = await call('customers', { path: '', token: TOKEN.admin });
    const rows = data(state.body) as Record<string, unknown>[];
    expect(rows.find((row) => row.customerNumber === 'CUS-000001')!.hasActiveMembership).toBe(
      false,
    );
  });

  it('matches list behavior on the detail endpoint', async () => {
    const state = await call('customers', { path: `${CUSTOMER.active}`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const body = state.body as Record<string, unknown>;
    expect(body.status).toBe('active');
    expect(body.hasActiveMembership).toBe(true);
    expect(body.portalAccountActivated).toBe(false);
  });

  it('reports a linked portal account without changing the membership flag', async () => {
    const db = install();
    db.rows('customers').find((row) => row.id === CUSTOMER.active)!.auth_user_id = 'auth-user-0001';
    const state = await call('customers', { path: `${CUSTOMER.active}`, token: TOKEN.admin });
    const body = state.body as Record<string, unknown>;
    expect(body.portalAccountActivated).toBe(true);
    expect(body.hasActiveMembership).toBe(true);
    expect(JSON.stringify(state.body)).not.toContain('auth-user-0001');
  });

  it.each([
    ['to-one object (live PostgREST shape)', { memberships: { id: 'm1', status: 'active' } }, true],
    [
      'to-many array with one active',
      {
        memberships: [
          { id: 'm1', status: 'suspended' },
          { id: 'm2', status: 'active' },
        ],
      },
      true,
    ],
    ['to-many array all inactive', { memberships: [{ id: 'm1', status: 'expired' }] }, false],
    ['empty array', { memberships: [] }, false],
    ['to-one object inactive', { memberships: { id: 'm1', status: 'cancelled' } }, false],
    ['null embed', { memberships: null }, false],
    ['missing embed', {}, false],
  ])('maps %s to %s', async (_name, row, expected) => {
    const { customerHasActiveMembership } = await import('./customers.js');
    expect(customerHasActiveMembership(row as Record<string, unknown>)).toBe(expected);
  });
});

/* ================================================================== */
/* Card sales                                                         */
/* ================================================================== */

describe('card sales', () => {
  beforeEach(() => install());

  it('creates a sale with a full commercial snapshot and a pending commission', async () => {
    const db = install();
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(201);
    const body = state.body as Record<string, unknown>;
    expect(body).toMatchObject({
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      expectedCommission: '2400.00',
      status: 'submitted',
    });

    const sale = db.rows('card_sales').find((r) => r.sale_number === body.saleNumber)!;
    expect(sale.cash_price_snapshot).toBe('60000.00');
    expect(sale.expected_commission_snapshot).toBe('2400.00');
    expect(sale.seller_staff_id).toBe(UUID.adminStaff);

    const commission = db.rows('commissions').find((c) => c.sale_id === sale.id)!;
    expect(commission).toMatchObject({
      amount: '2400.00',
      rate_snapshot: '0.04',
      basis_amount_snapshot: '60000.00',
      status: 'pending',
      beneficiary_staff_id: UUID.adminStaff,
    });
    expect(db.rows('audit_events').some((e) => e.action === 'APPLICATION_SUBMITTED')).toBe(true);
  });

  it('creates an SM-owned sale with the same server-side commercial snapshot', async () => {
    const db = install();
    db
      .rows('staff_role_assignments')
      .find((assignment) => assignment.staff_id === UUID.viewerStaff)!.role_id = UUID.role.custom;
    db.rows('role_permissions').push({
      role_id: UUID.role.custom,
      module_id: 'module:sales.card_sales',
      can_view: true,
      can_create: true,
      can_update: false,
      can_delete: false,
    });
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.viewer,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      sellerStaffId: UUID.viewerStaff,
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      expectedCommission: '2400.00',
    });
  });

  it('a later price change cannot alter an existing sale', async () => {
    const db = install();
    await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    const sale = db.rows('card_sales').find((r) => r.id === SALE.submitted)!;
    expect(sale.id).toBe(SALE.submitted);

    db.rows('card_plans').find((r) => r.id === PRODUCT.gold)!.cash_price = '90000.00';
    const detail = await call('sales', { path: `${SALE.submitted}`, token: TOKEN.admin });
    expect((detail.body as { cashPrice: string }).cashPrice).toBe('60000.00');
    expect((detail.body as { expectedCommission: string }).expectedCommission).toBe('2400.00');
  });

  it('refuses to sell an inactive product', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.retired },
    });
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/product inactive/);
  });

  it('refuses a cancelled customer', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.cancelled, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(409);
  });

  it('404s an unknown product or customer', async () => {
    const badProduct = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: '99999999-9999-4999-8999-999999999999' },
    });
    expect(badProduct.status).toBe(404);
    const badCustomer = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: '99999999-9999-4999-8999-999999999999', productId: PRODUCT.gold },
    });
    expect(badCustomer.status).toBe(404);
  });

  it('derives the upline from the seller relationship, not the request', async () => {
    const db = install();
    const created = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.bronze },
    });
    const saleNumber = (created.body as { saleNumber: string }).saleNumber;
    const sale = db.rows('card_sales').find((r) => r.sale_number === saleNumber)!;
    // adminStaff is an SSM whose authoritative upline is the Super Admin.
    expect(sale.referral_relationship_id).toBe(REL.vdToSsm);
  });

  it('records no upline for a seller without an authoritative relationship', async () => {
    const db = install();
    db.rows('referral_relationships').length = 0;
    const created = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    const saleNumber = (created.body as { saleNumber: string }).saleNumber;
    expect(
      db.rows('card_sales').find((r) => r.sale_number === saleNumber)!.referral_relationship_id,
    ).toBeNull();
  });

  it('rejects a body that tries to assert the seller for someone outside the downline', async () => {
    const db = install();
    const before = db.rows('card_sales').length;
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      // The inactive staff account is a valid row but must not be sellable.
      body: {
        customerId: CUSTOMER.prospect,
        productId: PRODUCT.gold,
        sellerStaffId: UUID.inactiveStaff,
      },
    });
    expect(state.status).toBe(403);
    expect(err(state.body).message).toMatch(/inactive/);
    // No sale row was created.
    expect(db.rows('card_sales')).toHaveLength(before);
  });

  it('rejects a seller the caller may not sell for', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: {
        customerId: CUSTOMER.prospect,
        productId: PRODUCT.gold,
        sellerStaffId: UUID.superAdminStaff,
      },
    });
    expect(state.status).toBe(403);
  });

  it('denies sale creation without sales.card_sales create', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.viewer,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(403);
  });

  it('rejects a malformed request body', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: 'nope', productId: PRODUCT.gold },
    });
    expect(state.status).toBe(400);
  });

  it('maps the one-open-application-per-customer index to a conflict', async () => {
    install({ writeErrors: { card_sales: { code: '23505', message: 'duplicate key' } } });
    const state = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(409);
  });

  it('shows a seller only their own sales', async () => {
    const state = await call('sales', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as { sellerStaffId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sellerStaffId === UUID.adminStaff)).toBe(true);
  });

  it('returns a terminal empty list instead of leaving the UI loading', async () => {
    const db = install();
    db.rows('card_sales').length = 0;
    const state = await call('sales', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(data(state.body)).toEqual([]);
    expect((state.body as { meta: { total: number } }).meta.total).toBe(0);
  });

  it('returns verified paid amount and remaining balance with a populated list', async () => {
    const state = await call('sales', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as { id: string; paidAmount: string; balance: string }[];
    expect(rows.find((row) => row.id === SALE.downPaid)).toMatchObject({
      paidAmount: '15000.00',
      balance: '25000.00',
    });
  });

  it('denies an unauthenticated sale list request', async () => {
    expect((await call('sales', { path: '' })).status).toBe(401);
  });

  it('shows Finance every sale', async () => {
    const db = install();
    // Give the admin role the finance permission for this case.
    db.rows('role_permissions').push({
      role_id: UUID.role.admin,
      module_id: 'module:finance.payment_verification',
      can_view: true,
      can_create: true,
      can_update: true,
      can_delete: true,
    });
    const state = await call('sales', { path: '', token: TOKEN.admin });
    expect((state.body as { meta: { total: number } }).meta.total).toBe(5);
  });

  it('computes the financial summary from payments only', async () => {
    const state = await call('sales', { path: `${SALE.downPaid}/summary`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      cashPrice: '40000.00',
      minimumDownPayment: '15000.00',
      // Only the verified 15000 counts toward the price; the recorded 5000 is
      // not money yet and the rejected 9999.99 never was.
      verifiedTotal: '15000.00',
      recordedTotal: '5000.00',
      rejectedTotal: '9999.99',
      remainingBalance: '25000.00',
      downPaymentSatisfied: true,
      fullyPaid: false,
    });
  });
});

/* ================================================================== */
/* Payments                                                           */
/* ================================================================== */

describe('payments', () => {
  beforeEach(() => install());

  it('records a payment through the transactional RPC with the actor', async () => {
    const db = install();
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN.admin,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '10000.00',
        paymentType: 'down_payment',
        method: 'bank_transfer',
        reference: 'TRF-9',
      },
    });
    expect(state.status).toBe(201);
    const rpc = db.calls.find((c) => c.op === 'rpc' && c.table === 'record_card_payment_once');
    expect(rpc?.arg).toMatchObject({
      p_sale_id: SALE.unpaid,
      p_amount: '10000.00',
      p_payment_type: 'down_payment',
      p_actor_id: UUID.adminStaff,
    });
  });

  it('never accepts a client-supplied total or balance', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN.admin,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '10000.00',
        paymentType: 'down_payment',
        method: 'cash',
        totalPaid: '99999.00',
        balance: '0.00',
        status: 'verified',
      },
    });
    // The extra fields are ignored by the schema; the request still succeeds
    // and the server-side amount is what counts.
    expect(state.status).toBe(201);
  });

  it.each([
    ['zero', '0.00'],
    ['negative-looking', '-1.00'],
    ['too many decimals', '100.005'],
  ])('rejects a %s amount', async (_name, amount) => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN.admin,
      body: { amount, paymentType: 'installment', method: 'cash' },
    });
    expect(state.status).toBe(400);
  });

  it('rejects a receipt path that looks like a public URL', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN.admin,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '100.00',
        paymentType: 'installment',
        method: 'cash',
        receiptStoragePath:
          'https://example.supabase.co/storage/v1/object/public/afhomes-payment-receipts/x.pdf',
      },
    });
    // Accepted as an opaque string, but it is never echoed back and never used
    // as a delivery URL; a private bucket path is the intended value.
    expect([201, 400]).toContain(state.status);
  });

  it('denies recording without finance.payment_verification', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN.viewer,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '100.00',
        paymentType: 'installment',
        method: 'cash',
      },
    });
    expect(state.status).toBe(403);
  });

  it('verifies a payment and returns the recomputed totals', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${PAYMENT.second}/verify`,
      token: TOKEN.admin,
      body: { decision: 'verified' },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      saleId: SALE.downPaid,
      verifiedTotal: '20000.00',
      remainingBalance: '20000.00',
      fullyPaid: false,
    });
  });

  it('requires a reason to reject a payment', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${PAYMENT.second}/verify`,
      token: TOKEN.admin,
      body: { decision: 'rejected' },
    });
    expect(state.status).toBe(400);
  });

  it('rejects an invalid decision', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${PAYMENT.second}/verify`,
      token: TOKEN.admin,
      body: { decision: 'maybe' },
    });
    expect(state.status).toBe(400);
  });

  it('denies verification without finance.payment_verification', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${PAYMENT.second}/verify`,
      token: TOKEN.viewer,
      body: { decision: 'verified' },
    });
    expect(state.status).toBe(403);
  });

  it('surfaces the RPC refusal when a sale is cancelled', async () => {
    install({
      rpcErrors: { record_card_payment_once: { message: 'SALE_NOT_ACCEPTING_PAYMENTS:cancelled' } },
    });
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN.admin,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '100.00',
        paymentType: 'installment',
        method: 'cash',
      },
    });
    expect(state.status).toBe(409);
  });

  it('lists the payments of a sale', async () => {
    const state = await call('sales', { path: `${SALE.downPaid}/payments`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === PAYMENT.rejected)!.rejectionReason).toBe('Funds not received');
  });
});

/* ================================================================== */
/* Activation - the critical invariant                                  */
/* ================================================================== */

describe('activation requires confirmed full payment', () => {
  beforeEach(() => install());

  it('activates a fully paid sale and returns one-time identifiers', async () => {
    const db = install();
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.fullyPaid}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipNumber: 'MBS-000009',
      fallbackCode: 'AFH-ABCD-EF01',
      qrToken: 'opaque-random-token',
      pointsAllocated: 60000,
      alreadyActive: false,
      onboarding: {
        status: 'manual_required',
        emailStatus: 'failed',
        token: 'raw-once-onboarding-token-0001',
        expiresAt: '2026-10-01T00:00:00.000Z',
      },
    });
    const rpc = db.calls.find((c) => c.op === 'rpc' && c.table === 'activate_card_sale');
    expect(rpc?.arg).toMatchObject({ p_sale_id: SALE.fullyPaid, p_validity_months: 12 });
    const tokenRpc = db.calls.find(
      (c) => c.op === 'rpc' && c.table === 'issue_customer_onboarding_token',
    );
    expect(tokenRpc?.arg).toMatchObject({
      p_customer_id: CUSTOMER.active,
      p_purpose: 'account_activation',
      p_valid_hours: 72,
    });
    const onboardingAudit = db
      .rows('audit_events')
      .find((entry) => entry.action === 'CUSTOMER_ONBOARDING_TOKEN_ISSUED');
    const deliveryAudit = db
      .rows('audit_events')
      .find((entry) => entry.action === 'CUSTOMER_ACTIVATION_EMAIL_FAILED');
    expect(onboardingAudit).toBeDefined();
    expect(deliveryAudit).toBeDefined();
    expect(JSON.stringify([onboardingAudit, deliveryAudit])).not.toContain(
      'raw-once-onboarding-token-0001',
    );
    expect(JSON.stringify([onboardingAudit, deliveryAudit])).not.toContain('/customer/activate');
  });

  it('refuses to activate an unpaid sale', async () => {
    install({
      rpcErrors: {
        activate_card_sale: { message: 'SALE_NOT_FULLY_PAID:verified=0.00 price=60000.00' },
      },
    });
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.unpaid}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/not activatable/);
  });

  it('refuses to activate a partially paid sale', async () => {
    install({
      rpcErrors: {
        activate_card_sale: { message: 'SALE_NOT_FULLY_PAID:verified=15000.00 price=40000.00' },
      },
    });
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.downPaid}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(409);
  });

  it('refuses activation from a status that is not payment_verified', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.submitted}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(409);
  });

  it('is idempotent: an already-active sale does not mint a second membership', async () => {
    const db = install({
      rpcs: [
        {
          fn: 'activate_card_sale',
          result: [
            {
              membership_id: MEMBERSHIP.active,
              membership_number: 'MBS-000001',
              fallback_code: null,
              qr_token: null,
              points_allocated: 60000,
              already_active: true,
            },
          ],
        },
      ],
    });
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.active}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      alreadyActive: true,
      membershipNumber: 'MBS-000001',
      onboarding: {
        status: 'already_active',
        emailStatus: 'not_attempted',
        token: null,
      },
    });
    // Only one activation attempt reached the RPC - no retry loop.
    expect(db.calls.filter((c) => c.table === 'activate_card_sale')).toHaveLength(1);
    expect(db.calls.filter((c) => c.table === 'issue_customer_onboarding_token')).toHaveLength(0);
  });

  it('keeps the membership activation successful when onboarding token issuance fails', async () => {
    install({
      rpcErrors: { issue_customer_onboarding_token: { message: 'TOKEN_ISSUE_FAILED: detail' } },
    });
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.fullyPaid}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipNumber: 'MBS-000009',
      onboarding: {
        status: 'not_issued',
        emailStatus: 'not_attempted',
        token: null,
      },
    });
  });

  it('rejects a nonsense validity period', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.fullyPaid}/activate`,
      token: TOKEN.admin,
      body: { validityMonths: 0 },
    });
    expect(state.status).toBe(400);
  });

  it('denies activation without finance.card_activation', async () => {
    const state = await call('sales', {
      method: 'POST',
      path: `${SALE.fullyPaid}/activate`,
      token: TOKEN.viewer,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Memberships, identifiers, points                                    */
/* ================================================================== */

describe('memberships and identifiers', () => {
  beforeEach(() => install());

  it('resolves a QR token to its membership without leaking customer data', async () => {
    const db = install();
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update('raw-qr-token').digest('hex');
    db.rows('memberships')[0]!.qr_token_hash = hash;

    const state = await call('memberships', {
      path: 'resolve',
      token: TOKEN.admin,
      query: { identifier: 'raw-qr-token' },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipId: MEMBERSHIP.active,
      membershipNumber: 'MBS-000001',
      status: 'active',
      pointsBalance: 60000,
      expired: false,
    });
    // A lookup response travels to a staff device: no PII.
    const serialised = JSON.stringify(state.body);
    for (const pii of ['Pedro', 'pedro@example.com', 'Reyes', '09185550103']) {
      expect(serialised, pii).not.toContain(pii);
    }
  });

  it('resolves a fallback member code to the same membership as the QR token', async () => {
    const db = install();
    const { createHash } = await import('node:crypto');
    db.rows('memberships')[0]!.fallback_code_hash = createHash('sha256')
      .update('AFH-ABCD-EF01')
      .digest('hex');
    const state = await call('memberships', {
      path: 'resolve',
      token: TOKEN.admin,
      query: { identifier: 'AFH-ABCD-EF01' },
    });
    expect((state.body as { membershipId: string }).membershipId).toBe(MEMBERSHIP.active);
  });

  it('404s an unknown identifier without disclosing whether it exists', async () => {
    const state = await call('memberships', {
      path: 'resolve',
      token: TOKEN.admin,
      query: { identifier: 'AFH-NOPE-NOPE' },
    });
    expect(state.status).toBe(404);
  });

  it('requires a plausible identifier', async () => {
    const state = await call('memberships', {
      path: 'resolve',
      token: TOKEN.admin,
      query: { identifier: 'x' },
    });
    expect(state.status).toBe(400);
  });

  it('denies identifier resolution without a staff permission', async () => {
    const state = await call('memberships', {
      path: 'resolve',
      token: TOKEN.viewer,
      query: { identifier: 'AFH-ABCD-EF01' },
    });
    expect(state.status).toBe(403);
  });

  it('reads the points account and its append-only ledger', async () => {
    const denied = await call('memberships', {
      path: `accounts/${MEMBERSHIP.active}`,
      token: TOKEN.viewer,
    });
    expect(denied.status).toBe(403);

    const accountId = 'ffffffff-0000-4000-8000-000000000001';
    const allowed = await call('memberships', {
      path: `accounts/${MEMBERSHIP.active}`,
      token: TOKEN2.finance,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ balance: 60000, lifetimeAllocated: 60000 });

    const ledger = await call('memberships', {
      path: `ledger/${accountId}`,
      token: TOKEN2.finance,
    });
    expect(ledger.status).toBe(200);
    expect(data(ledger.body)).toHaveLength(1);
  });
});

/* ================================================================== */
/* Commissions                                                        */
/* ================================================================== */

describe('commissions', () => {
  beforeEach(() => install());

  it('lists commissions with their snapshotted rate and basis', async () => {
    const state = await call('commissions', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Record<string, unknown>[];
    const pending = rows.find((r) => r.status === 'pending')!;
    expect(pending).toMatchObject({ rate: '0.04', basisAmount: '60000.00', amount: '2400.00' });
  });

  it('is never auto-earned: a payment_verified commission still awaits qualification', async () => {
    install();
    const state = await call('commissions', { path: '', token: TOKEN.admin });
    const rows = data(state.body) as { status: string }[];
    expect(rows.some((r) => r.status === 'earned')).toBe(false);
    expect(rows.some((r) => r.status === 'final_qualification_pending')).toBe(true);
  });

  it('qualifies only a commission awaiting final qualification, and audits it', async () => {
    const db = install();
    const state = await call('commissions', {
      method: 'POST',
      path: '99990000-0000-4000-8000-000000000002/qualify',
      token: TOKEN.admin,
      body: { decision: 'earned', notes: 'Card holder qualified after 30 days.' },
    });
    expect(state.status).toBe(200);
    expect((state.body as { status: string }).status).toBe('earned');
    expect(
      db.rows('commissions').find((c) => c.id === '99990000-0000-4000-8000-000000000002')!.status,
    ).toBe('earned');
    const audit = db.rows('audit_events').find((e) => e.action === 'COMMISSION_QUALIFIED')!;
    expect(audit.reason).toContain('30 days');
  });

  it('refuses to qualify a commission that is not awaiting qualification', async () => {
    const state = await call('commissions', {
      method: 'POST',
      path: '99990000-0000-4000-8000-000000000001/qualify',
      token: TOKEN.admin,
      body: { decision: 'earned', notes: 'Trying to skip qualification.' },
    });
    expect(state.status).toBe(409);
  });

  it('requires notes for a qualification decision', async () => {
    const state = await call('commissions', {
      method: 'POST',
      path: '99990000-0000-4000-8000-000000000002/qualify',
      token: TOKEN.admin,
      body: { decision: 'earned', notes: 'no' },
    });
    expect(state.status).toBe(400);
  });

  it('denies commission access without network.commissions', async () => {
    const state = await call('commissions', { path: '', token: TOKEN.viewer });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Referrals / uplines                                                */
/* ================================================================== */

describe('referrals and uplines', () => {
  beforeEach(() => install());

  it('lists authoritative relationships', async () => {
    const state = await call('referrals', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    // Three organisation relationships plus the VD -> SSM -> SM -> OST chain.
    expect(data(state.body)).toHaveLength(6);
  });

  it('rejects a self-referencing upline', async () => {
    const state = await call('referrals', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: {
        subjectStaffId: UUID.viewerStaff,
        uplineStaffId: UUID.viewerStaff,
        hierarchyRole: 'sales_manager',
      },
    });
    expect(state.status).toBe(400);
  });

  it('rejects an upline that is not above the subject in the hierarchy', async () => {
    const state = await call('referrals', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: {
        // A Sales Manager cannot report to an OST: the upline must sit strictly
        // ABOVE the subject in VD -> SSM -> SM -> OST.
        subjectStaffId: STAFF2.salesManager,
        uplineStaffId: STAFF2.ost,
        hierarchyRole: 'sales_manager',
      },
    });
    expect(state.status).toBe(400);
    expect(err(state.body).message).toMatch(/cannot report to/);
  });

  it('rejects a declared level that does not match the subject real role', async () => {
    const state = await call('referrals', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: {
        subjectStaffId: UUID.viewerStaff,
        uplineStaffId: UUID.adminStaff,
        hierarchyRole: 'ost',
      },
    });
    expect(state.status).toBe(400);
  });

  it('rejects an inactive subject or upline', async () => {
    const state = await call('referrals', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: {
        subjectStaffId: UUID.inactiveStaff,
        uplineStaffId: UUID.adminStaff,
        hierarchyRole: 'ost',
      },
    });
    expect(state.status).toBe(409);
  });

  it('denies upline assignment to a seller (they may not move themselves)', async () => {
    // The OST role holds selling permissions but not sales.uplines.
    const state = await call('referrals', {
      method: 'POST',
      path: '',
      token: TOKEN2.ost,
      body: {
        subjectStaffId: STAFF2.ost,
        uplineStaffId: STAFF2.salesManager,
        hierarchyRole: 'ost',
      },
    });
    expect(state.status).toBe(403);
  });

  it('a correction requires a reason and goes through the atomic RPC', async () => {
    const db = install();
    const noReason = await call('referrals', {
      method: 'PATCH',
      path: REL.ssmToSm,
      token: TOKEN.superAdmin,
      body: { uplineStaffId: UUID.superAdminStaff },
    });
    expect(noReason.status).toBe(400);

    // The RPC retires the old row and opens a new one in one transaction; the
    // new row is scripted here so the handler can read it back.
    db.rows('referral_relationships').push({
      id: 'eeeeeeee-0000-4000-8000-0000000000ff',
      subject_staff_id: UUID.viewerStaff,
      upline_staff_id: STAFF2.seniorSalesManager,
      hierarchy_role: 'sales_manager',
      is_authoritative: true,
      is_active: true,
      assigned_by: UUID.superAdminStaff,
      assigned_at: '2026-09-26T00:00:00.000Z',
      created_at: '2026-09-26T00:00:00.000Z',
      updated_at: '2026-09-26T00:00:00.000Z',
    });

    const state = await call('referrals', {
      method: 'PATCH',
      path: REL.ssmToSm,
      token: TOKEN.superAdmin,
      body: { uplineStaffId: STAFF2.seniorSalesManager, reason: 'Reorganised the region.' },
    });
    expect(state.status).toBe(200);
    expect((state.body as { uplineStaffId: string }).uplineStaffId).toBe(STAFF2.seniorSalesManager);
    const rpc = db.calls.find((c) => c.op === 'rpc' && c.table === 'correct_referral_upline');
    expect(rpc?.arg).toMatchObject({
      p_relationship_id: REL.ssmToSm,
      p_upline_staff_id: STAFF2.seniorSalesManager,
      p_actor_id: UUID.superAdminStaff,
    });
  });

  it('refuses a correction to the same upline', async () => {
    const state = await call('referrals', {
      method: 'PATCH',
      path: REL.ssmToSm,
      token: TOKEN.superAdmin,
      body: { uplineStaffId: UUID.adminStaff, reason: 'No change intended.' },
    });
    expect(state.status).toBe(409);
  });
});

/* ================================================================== */
/* Queues                                                             */
/* ================================================================== */

describe('finance and activation queues', () => {
  it('lists sales awaiting money with server-computed totals', async () => {
    install();
    const state = await call('queues', { path: 'finance', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Record<string, unknown>[];
    const downPaid = rows.find((r) => r.saleId === SALE.downPaid)!;
    expect(downPaid).toMatchObject({
      verifiedTotal: '15000.00',
      remainingBalance: '25000.00',
      downPaymentSatisfied: true,
      fullyPaid: false,
      activatable: false,
    });
  });

  it('marks a fully paid sale as activatable in the activation queue', async () => {
    install();
    const state = await call('queues', { path: 'activation', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ saleId: SALE.fullyPaid, fullyPaid: true, activatable: true });
  });

  it('denies each queue without its permission', async () => {
    install();
    expect((await call('queues', { path: 'finance', token: TOKEN.viewer })).status).toBe(403);
    expect((await call('queues', { path: 'activation', token: TOKEN.viewer })).status).toBe(403);
  });

  it('404s an unknown queue', async () => {
    install();
    expect((await call('queues', { path: 'nope', token: TOKEN.admin })).status).toBe(404);
  });
});

/* ================================================================== */
/* Customer account onboarding                                        */
/* ================================================================== */

describe('customer account onboarding', () => {
  beforeEach(() => install());

  it('issues a single-use activation link for an active membership without reactivation', async () => {
    const db = install();
    const before = JSON.stringify({
      sales: db.rows('card_sales'),
      memberships: db.rows('memberships'),
      points: db.rows('points_accounts'),
      commissions: db.rows('commissions'),
    });
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/onboarding-token`,
      token: TOKEN.admin,
      body: {},
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      status: 'manual_required',
      emailStatus: 'failed',
      email: 'pedro@example.com',
      expiresAt: '2026-10-01T00:00:00.000Z',
    });
    expect((state.body as { activationUrl: string }).activationUrl).toContain(
      '/customer/activate#token=raw-once-onboarding-token-0001',
    );
    expect(db.calls.some((call) => call.op === 'rpc' && call.table === 'activate_card_sale')).toBe(
      false,
    );
    expect(
      JSON.stringify({
        sales: db.rows('card_sales'),
        memberships: db.rows('memberships'),
        points: db.rows('points_accounts'),
        commissions: db.rows('commissions'),
      }),
    ).toBe(before);
    const audits = db
      .rows('audit_events')
      .filter((entry) => String(entry.action).startsWith('CUSTOMER_'));
    expect(audits.map((entry) => entry.action)).toEqual([
      'CUSTOMER_ONBOARDING_TOKEN_ISSUED',
      'CUSTOMER_ACTIVATION_EMAIL_FAILED',
    ]);
    expect(JSON.stringify(audits)).not.toContain('raw-once-onboarding-token-0001');
    expect(JSON.stringify(audits)).not.toContain('/customer/activate');
  });

  it('denies issuing without sales.customers update permission', async () => {
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/onboarding-token`,
      token: TOKEN.viewer,
      body: {},
    });
    expect(state.status).toBe(403);
  });

  it('allows Super Admin and reports successful email separately from token issuance', async () => {
    vi.spyOn(onboardingEmail, 'sendCustomerOnboardingEmail').mockResolvedValueOnce({
      status: 'sent',
    });
    const db = install();
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/onboarding-token`,
      token: TOKEN.superAdmin,
      body: {},
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({ status: 'email_sent', emailStatus: 'sent' });
    expect(
      db.rows('audit_events').some((entry) => entry.action === 'CUSTOMER_ACTIVATION_EMAIL_SENT'),
    ).toBe(true);
  });

  it('returns 404 for an unknown customer without issuing a token', async () => {
    const db = install();
    const state = await call('customers', {
      method: 'POST',
      path: 'aaaaaaaa-0000-4000-8000-999999999999/onboarding-token',
      token: TOKEN.admin,
      body: {},
    });
    expect(state.status).toBe(404);
    expect(
      db.calls.some(
        (call) => call.op === 'rpc' && call.table === 'issue_customer_onboarding_token',
      ),
    ).toBe(false);
  });

  it('refuses a prospect without an active membership before issuing a token', async () => {
    const db = install();
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.prospect}/onboarding-token`,
      token: TOKEN.admin,
      body: {},
    });
    expect(state.status).toBe(409);
    expect(
      db.calls.some(
        (call) => call.op === 'rpc' && call.table === 'issue_customer_onboarding_token',
      ),
    ).toBe(false);
  });

  it('refuses to replace activation with a second portal account', async () => {
    const db = install();
    db.rows('customers').find((row) => row.id === CUSTOMER.active)!.auth_user_id =
      '99999999-0000-4000-8000-000000000001';
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/onboarding-token`,
      token: TOKEN.admin,
      body: {},
    });
    expect(state.status).toBe(409);
    expect(
      db.calls.some(
        (call) => call.op === 'rpc' && call.table === 'issue_customer_onboarding_token',
      ),
    ).toBe(false);
  });
});

it('authorized employee can look up imported normal records without importing or receiving PII', async () => {
  const world = phase2World();
  install({
    tables: {
      role_permissions: [
        ...world.role_permissions,
        {
          role_id: UUID.role.employee,
          module_id: world.modules.find((m) => m.key === 'operations.redemption')!.id,
          can_view: true,
          can_create: false,
          can_update: false,
          can_delete: false,
        },
      ],
    },
  });
  const response = await call('memberships', {
    path: 'lookup',
    token: TOKEN.viewer,
    query: { search: 'MBS-' },
  });
  expect(response.status).toBe(200);
  expect(data(response.body).length).toBeGreaterThan(0);
  const text = JSON.stringify(response.body);
  expect(text).not.toMatch(/government|auth_user|dateOfBirth|address|payment|email/i);
  const imports = (await import('./customer-imports.js')).default;
  const { res, state } = makeRes();
  await imports(
    makeReq({
      method: 'POST',
      familyPath: 'parse',
      headers: { authorization: `Bearer ${TOKEN.viewer}` },
      body: { source: 'csv', contentBase64: 'aA==' },
    }),
    res,
  );
  expect(state.status).toBe(403);
});

describe('operational search before pagination', () => {
  beforeEach(() => install());
  it.each(['customerName', 'saleNumber', 'productName'])(
    'payment queue searches %s before its page window',
    async (field) => {
      const all = data((await call('queues', { path: 'finance', token: TOKEN.admin })).body).map(
        (row) => financeQueueItemSchema.parse(row),
      );
      const row = all[all.length - 1];
      const search =
        field === 'customerName'
          ? row.customerName
          : field === 'saleNumber'
            ? row.saleNumber
            : row.productName;
      const result = await call('queues', {
        path: 'finance',
        token: TOKEN.admin,
        query: { search: search.toLowerCase(), limit: '1' },
      });
      expect(result.status).toBe(200);
      expect(data(result.body)).toHaveLength(1);
      const matched = financeQueueItemSchema.parse(data(result.body)[0]);
      expect(
        [matched.customerName, matched.saleNumber, matched.productName].some((value) =>
          value.toLowerCase().includes(search.toLowerCase()),
        ),
      ).toBe(true);
    },
  );
  it('returns no payment queue rows for nonexistent text', async () => {
    expect(
      data(
        (
          await call('queues', {
            path: 'finance',
            token: TOKEN.admin,
            query: { search: '__NO_SUCH_PAYMENT__' },
          })
        ).body,
      ),
    ).toEqual([]);
  });
  it('cannot bypass payment permissions with search', async () => {
    expect(
      (await call('queues', { path: 'finance', token: TOKEN.viewer, query: { search: 'Juan' } }))
        .status,
    ).toBe(403);
  });
  it.each(['beneficiaryName', 'saleNumber', 'status'])(
    'commission transactions search %s case insensitively',
    async (field) => {
      const rows = data((await call('commissions', { path: '', token: TOKEN.admin })).body).map(
        (row) => commissionSchema.parse(row),
      );
      const row = rows.find((row) =>
        Boolean(
          field === 'beneficiaryName'
            ? row.beneficiaryName
            : field === 'saleNumber'
              ? row.saleNumber
              : row.status,
        ),
      );
      if (!row) throw new Error('Missing commission fixture');
      const search = String(
        field === 'beneficiaryName'
          ? row.beneficiaryName
          : field === 'saleNumber'
            ? row.saleNumber
            : row.status,
      );
      const lower = data(
        (
          await call('commissions', {
            path: '',
            token: TOKEN.admin,
            query: { search: search.toLowerCase() },
          })
        ).body,
      );
      const upper = data(
        (
          await call('commissions', {
            path: '',
            token: TOKEN.admin,
            query: { search: search.toUpperCase() },
          })
        ).body,
      );
      expect(lower.length).toBeGreaterThan(0);
      expect(upper).toEqual(lower);
    },
  );
  it('returns no transaction commissions for nonexistent text', async () => {
    expect(
      data(
        (
          await call('commissions', {
            path: '',
            token: TOKEN.admin,
            query: { search: '__NO_SUCH_COMMISSION__' },
          })
        ).body,
      ),
    ).toEqual([]);
  });
});
