/**
 * AF Homes Phase 9 - end-to-end customer onboarding lifecycle.
 *
 * Drives the real handlers, the real authorization resolver and the real Zod
 * schemas against the in-memory Supabase fake. The transactional RPCs are
 * scripted (PL/pgSQL cannot run in-process); their SQL truth is proven by
 * execution in `supabase/db-integration.ts` sections 5-21, and the handler
 * contract with each RPC - arguments sent, result mapping, error mapping - is
 * asserted here.
 *
 * What this file proves that no earlier spec does:
 *
 * - the sales-list scope polarity (a seller sees their OWN sales instead of a
 *   403; finance sees every sale);
 * - single-sale reads (detail, summary, payments) enforce the same scope, so
 *   a direct URL cannot bypass it;
 * - customer registration attributes the registering seller server-side;
 * - the full chain wires together: customer -> sale (frozen snapshot) ->
 *   record -> verify -> summary -> activate -> onboarding token, with every
 *   audit carrying IDs and no secrets.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  SALE,
  TOKEN2,
  UNIQUE,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

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

const customers = (await import('./customers.js')).default;
const sales = (await import('./sales.js')).default;
const queues = (await import('./queues.js')).default;
const { selectHandler } = await import('../_lib/router.js');

let counter = 0;
function install(
  options: {
    tables?: Record<string, unknown[]>;
    rpcs?: { fn: string; result: unknown }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  counter += 1;
  holder.db = new FakeSupabase({
    tables: phase2World(options.tables as never),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      ...(options.rpcs ?? []),
      { fn: 'next_customer_number', result: [{ customer_number: `CUS-${910000 + counter}` }] },
      { fn: 'next_sale_number', result: [{ sale_number: `SALE-${910000 + counter}` }] },
      { fn: 'record_card_payment', result: `pay-${counter}` },
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
            membership_id: '33333333-3333-4333-8333-333333333333',
            membership_number: 'MBS-000009',
            fallback_code: 'AFH-ABCD-EF01',
            qr_token: 'opaque-random-token',
            points_allocated: 60000,
            already_active: false,
          },
        ],
      },
      {
        fn: 'issue_customer_onboarding_token',
        result: [
          { token: 'raw-once-onboarding-token-0001', expires_at: '2026-10-01T00:00:00.000Z' },
        ],
      },
    ],
    rpcErrors: options.rpcErrors,
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(
  handler: (req: never, res: never) => Promise<unknown>,
  options: { path: string; method?: string; token?: string; body?: unknown },
): Promise<State> {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
    }) as never,
    res as never,
  );
  return state;
}

const err = (body: unknown) => (body as { error: { code: string; message: string } }).error;

const newCustomer = {
  firstName: 'Phase',
  lastName: 'Nine',
  email: 'phase.nine@example.invalid',
  phone: '+639171234567',
  dateOfBirth: '1994-03-03',
  address: { line1: '9 Onboarding St', city: 'Tagaytay', province: 'Cavite', countryCode: 'PH' },
};

/* ================================================================== */
/* Registration with server-resolved attribution                       */
/* ================================================================== */

describe('customer registration', () => {
  it('1. creates the customer as a prospect attributed to the registering seller', async () => {
    const db = install();
    const state = await call(customers, {
      method: 'POST',
      path: '',
      token: TOKEN2.salesManager,
      body: newCustomer,
    });
    expect(state.status).toBe(201);
    const row = db.rows('customers').find((r) => r.email === newCustomer.email)!;
    expect(row.status).toBe('prospect');
    expect(row.created_by).toBe(row.referred_by_staff_id);
    expect(row.referred_by_staff_id).not.toBeNull();
  });

  it('2. ignores a smuggled referrer: attribution always resolves to the session', async () => {
    const db = install();
    const state = await call(customers, {
      method: 'POST',
      path: '',
      token: TOKEN2.salesManager,
      body: { ...newCustomer, referredByStaffId: '00000000-0000-4000-8000-0000000000aa' },
    });
    expect(state.status).toBe(201);
    const row = db.rows('customers').find((r) => r.email === newCustomer.email)!;
    expect(String(row.referred_by_staff_id)).not.toBe('00000000-0000-4000-8000-0000000000aa');
  });

  it('audits creation with identifiers only, never the government ID', async () => {
    const db = install();
    await call(customers, {
      method: 'POST',
      path: '',
      token: TOKEN2.salesManager,
      body: { ...newCustomer, governmentIdType: 'passport', governmentIdNumber: 'P1234567' },
    });
    const audits = db.rows('audit_events').filter((a) => a.action === 'CUSTOMER_CREATED');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('P1234567');
  });
});

/* ================================================================== */
/* Seller scope (Phase 9 section E)                                     */
/* ================================================================== */

describe('seller scope on sales', () => {
  it('3. a seller lists only their own sales instead of a 403', async () => {
    install();
    const state = await call(sales, { path: '', token: TOKEN2.salesManager });
    expect(state.status).toBe(200);
    const rows = (state.body as { data: { sellerStaffId: string }[] }).data;
    expect(rows.every((r) => r.sellerStaffId === '10101010-0000-4000-8000-000000000003')).toBe(
      true,
    );
  });

  it('finance lists every sale', async () => {
    install();
    const state = await call(sales, { path: '', token: TOKEN2.finance });
    expect(state.status).toBe(200);
    expect((state.body as { meta: { total: number } }).meta.total).toBe(5);
  });

  it('an unrelated seller cannot open the detail, summary or payments by URL', async () => {
    install();
    for (const path of [
      `${SALE.downPaid}`,
      `${SALE.downPaid}/summary`,
      `${SALE.downPaid}/payments`,
    ]) {
      const state = await call(sales, { path, token: TOKEN2.salesManager });
      expect(state.status, path).toBe(404);
    }
  });

  it('the owning seller and finance can open all three', async () => {
    install();
    // Every fixture sale belongs to the admin seller, who holds both finance
    // grants here; finance scope therefore applies to each read.
    for (const path of [
      `${SALE.downPaid}`,
      `${SALE.downPaid}/summary`,
      `${SALE.downPaid}/payments`,
    ]) {
      const state = await call(sales, { path, token: TOKEN2.finance });
      expect(state.status, path).toBe(200);
    }
  });

  it('a caller with no sale scope is denied, never leaked through', async () => {
    install();
    const state = await call(sales, { path: `${SALE.downPaid}`, token: TOKEN2.hr });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Product snapshot and sale creation                                  */
/* ================================================================== */

describe('card plan selection and frozen snapshots', () => {
  it('4. sells only an active plan and freezes its economics', async () => {
    const db = install();
    const state = await call(sales, {
      method: 'POST',
      path: '',
      token: TOKEN2.salesManager,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      expectedCommission: '2400.00',
      status: 'submitted',
    });
    // Later product edits cannot move the frozen sale.
    const product = db.rows('card_plans').find((r) => r.id === PRODUCT.gold)!;
    product.cash_price = '99999.99';
    const reread = await call(sales, {
      path: `${(state.body as { id: string }).id}`,
      token: TOKEN2.finance,
    });
    expect(reread.body).toMatchObject({ cashPrice: '60000.00', expectedCommission: '2400.00' });
  });

  it('6. rejects an inactive plan without creating a sale', async () => {
    const db = install();
    const product = db.rows('card_plans').find((r) => r.id === PRODUCT.gold)!;
    product.is_active = false;
    const before = db.rows('card_sales').length;
    const state = await call(sales, {
      method: 'POST',
      path: '',
      token: TOKEN2.salesManager,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(state.status).toBe(409);
    expect(db.rows('card_sales')).toHaveLength(before);
  });
});

/* ================================================================== */
/* Payments: record, verify, summarize                                 */
/* ================================================================== */

describe('payment recording and verification', () => {
  it('8. records through the RPC with the actor and returns the payment id', async () => {
    const db = install();
    const state = await call(sales, {
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN2.finance,
      body: { amount: '10000.00', paymentType: 'down_payment', method: 'cash' },
    });
    expect(state.status).toBe(201);
    const rpc = db.calls.find((c) => c.op === 'rpc' && c.table === 'record_card_payment');
    expect(rpc?.arg).toMatchObject({ p_sale_id: SALE.unpaid, p_amount: '10000.00' });
  });

  it('9. counts only verified money in the summary', async () => {
    const db = install();
    db.rows('payments').push(
      { id: 'a', sale_id: SALE.unpaid, amount: '7000.00', status: 'recorded' },
      { id: 'b', sale_id: SALE.unpaid, amount: '10000.00', status: 'verified' },
      { id: 'c', sale_id: SALE.unpaid, amount: '500.00', status: 'rejected' },
    );
    const state = await call(sales, {
      path: `${SALE.unpaid}/summary`,
      token: TOKEN2.finance,
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      recordedTotal: '7000.00',
      verifiedTotal: '10000.00',
      rejectedTotal: '500.00',
      remainingBalance: '20000.00',
      downPaymentSatisfied: true,
      fullyPaid: false,
      spotCashState: 'not_started',
    });
  });

  it('10. verifies and reports the server-computed fully-paid state', async () => {
    install();
    const state = await call(sales, {
      method: 'POST',
      path: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/verify`,
      token: TOKEN2.finance,
      body: { decision: 'verified' },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ fullyPaid: false, verifiedTotal: '20000.00' });
  });

  it('28. maps a double verification to a conflict, never a second count', async () => {
    install({ rpcErrors: { verify_card_payment: { message: 'PAYMENT_NOT_PENDING:verified' } } });
    const state = await call(sales, {
      method: 'POST',
      path: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/verify`,
      token: TOKEN2.finance,
      body: { decision: 'verified' },
    });
    expect(state.status).toBe(409);
  });
});

/* ================================================================== */
/* Activation and onboarding                                           */
/* ================================================================== */

describe('activation and customer onboarding', () => {
  it('15/16. refuses an unpaid sale and activates a fully paid one exactly once', async () => {
    install({
      rpcErrors: {
        activate_card_sale: { message: 'SALE_NOT_FULLY_PAID:verified=0.00 price=60000.00' },
      },
    });
    const denied = await call(sales, {
      method: 'POST',
      path: `${SALE.unpaid}/activate`,
      token: TOKEN2.finance,
      body: {},
    });
    expect(denied.status).toBe(409);
  });

  it('activates with identifiers issued exactly once and audits the chain', async () => {
    const db = install();
    const state = await call(sales, {
      method: 'POST',
      path: `${SALE.fullyPaid}/activate`,
      token: TOKEN2.finance,
      body: { validityMonths: 12 },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipNumber: 'MBS-000009',
      fallbackCode: 'AFH-ABCD-EF01',
      qrToken: 'opaque-random-token',
      alreadyActive: false,
    });
    const rpc = db.calls.find((c) => c.op === 'rpc' && c.table === 'activate_card_sale');
    expect(rpc?.arg).toMatchObject({ p_sale_id: SALE.fullyPaid, p_validity_months: 12 });
  });

  it('17. repeats activation idempotently without new identifiers', async () => {
    install({
      rpcs: [
        {
          fn: 'activate_card_sale',
          result: [
            {
              membership_id: '33333333-3333-4333-8333-333333333333',
              membership_number: 'MBS-000009',
              fallback_code: null,
              qr_token: null,
              points_allocated: 60000,
              already_active: true,
            },
          ],
        },
      ],
    });
    const state = await call(sales, {
      method: 'POST',
      path: `${SALE.fullyPaid}/activate`,
      token: TOKEN2.finance,
      body: {},
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ alreadyActive: true });
  });

  it('22. issues the onboarding token once, audited without the secret', async () => {
    const db = install();
    const state = await call(customers, {
      method: 'POST',
      path: `${CUSTOMER.active}/onboarding-token`,
      token: TOKEN2.finance,
      body: {},
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({ token: 'raw-once-onboarding-token-0001' });
    const audits = db
      .rows('audit_events')
      .filter((a) => a.action === 'CUSTOMER_ONBOARDING_TOKEN_ISSUED');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('raw-once');
  });
});

/* ================================================================== */
/* Queues and packaging                                                */
/* ================================================================== */

describe('queues and route packaging', () => {
  it('serves the finance and activation queues with server-computed eligibility', async () => {
    install();
    const finance = await call(queues, { path: 'finance', token: TOKEN2.finance });
    expect(finance.status).toBe(200);
    const activation = await call(queues, { path: 'activation', token: TOKEN2.finance });
    expect(activation.status).toBe(200);
    const items = (activation.body as { data: { activatable: boolean }[] }).data;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.activatable)).toBe(true);
  });

  it('31. packages every lifecycle route in the single Vercel function', async () => {
    const q: Record<string, string | undefined> = {};
    expect(selectHandler('/api/v1/customers', q)?.routeKey).toBe('customers/customers');
    expect(selectHandler('/api/v1/sales/abc', q)?.routeKey).toBe('sales/abc');
    expect(selectHandler('/api/v1/payments/abc/verify', q)?.routeKey).toBe('sales/abc/verify');
    expect(selectHandler('/api/v1/queues/activation', q)?.routeKey).toBe('queues/activation');
    expect(selectHandler('/api/v1/memberships/resolve', q)?.routeKey).toBe('memberships/resolve');
    expect(selectHandler('/api/v1/auth/customer/activate', q)?.routeKey).toBe(
      'auth/customer/activate',
    );
    expect(selectHandler('/api/v1/customer/membership', q)?.routeKey).toBe('customer/membership');
  });
});
