/**
 * Sale-number data-integrity regression (Phase 18 live finding).
 *
 * `public.next_sale_number()` is `RETURNS TABLE (sale_number text)`, so live
 * PostgREST answers `db.rpc('next_sale_number')` with a ONE-ROW ARRAY
 * (`[{ sale_number: 'SALE-000001' }]`), never a bare object. The handler used
 * to read `.sale_number` off the array itself, got `undefined`, fell back to
 * `''`, and persisted a sale with a blank number (`sale_number` is only
 * `NOT NULL UNIQUE`, so the database accepted it).
 *
 * These tests drive the real handlers against scripted doubles shaped exactly
 * like the live PostgREST responses, and prove a missing/blank number fails
 * the creation BEFORE any row is inserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  TOKEN,
  UNIQUE,
  UUID,
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

const handlers = {
  customers: (await import('./customers.js')).default,
  sales: (await import('./sales.js')).default,
};

function install(rpcs: { fn: string; result: unknown }[], rpcErrors = {}) {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs,
    rpcErrors,
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(
  family: keyof typeof handlers,
  options: { path: string; method?: string; token?: string; body?: unknown },
): Promise<State> {
  const { res, state } = makeRes();
  await handlers[family](
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

const GOLD_SALE = {
  method: 'POST',
  path: '',
  token: TOKEN.admin,
  body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
} as const;

const err = (body: unknown) => (body as { error: { code: string; message: string } }).error;

describe('sale-number extraction follows the live PostgREST shape', () => {
  beforeEach(() => {
    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-700001' }] }]);
  });

  it('uses the number from a one-row array response', async () => {
    const db = install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-700001' }] }]);
    const state = await call('sales', { ...GOLD_SALE });
    expect(state.status).toBe(201);
    expect((state.body as Record<string, unknown>).saleNumber).toBe('SALE-700001');
    const sale = db.rows('card_sales').find((r) => r.id !== undefined && r.sale_number === 'SALE-700001');
    expect(sale).toBeDefined();
    expect(sale!.sale_number).toBe('SALE-700001');
  });

  it('fails closed on an empty array and inserts nothing', async () => {
    const db = install([{ fn: 'next_sale_number', result: [] }]);
    const salesBefore = db.rows('card_sales').length;
    const commissionsBefore = db.rows('commissions').length;
    const state = await call('sales', { ...GOLD_SALE });
    expect(state.status).toBe(500);
    expect(err(state.body).code).toBe('INTERNAL');
    expect(db.rows('card_sales')).toHaveLength(salesBefore);
    expect(db.rows('commissions')).toHaveLength(commissionsBefore);
  });

  it.each([['empty string', ''], ['whitespace', '   ']])(
    'fails closed on a blank (%s) number and inserts nothing',
    async (_name, blank) => {
      const db = install([{ fn: 'next_sale_number', result: [{ sale_number: blank }] }]);
      const salesBefore = db.rows('card_sales').length;
      const state = await call('sales', { ...GOLD_SALE });
      expect(state.status).toBe(500);
      expect(err(state.body).code).toBe('INTERNAL');
      expect(db.rows('card_sales')).toHaveLength(salesBefore);
      expect(db.rows('card_sales').some((r) => r.sale_number === '')).toBe(false);
    },
  );

  it('fails closed on multiple unexpected rows and inserts nothing', async () => {
    const db = install([
      { fn: 'next_sale_number', result: [{ sale_number: 'SALE-1' }, { sale_number: 'SALE-2' }] },
    ]);
    const salesBefore = db.rows('card_sales').length;
    const state = await call('sales', { ...GOLD_SALE });
    expect(state.status).toBe(500);
    expect(db.rows('card_sales')).toHaveLength(salesBefore);
  });

  it('fails closed on an RPC error with no partial sale or commission', async () => {
    const db = install([], { next_sale_number: { code: '57000', message: 'sequence gone' } });
    const salesBefore = db.rows('card_sales').length;
    const commissionsBefore = db.rows('commissions').length;
    const state = await call('sales', { ...GOLD_SALE });
    expect(state.status).toBe(500);
    expect(db.rows('card_sales')).toHaveLength(salesBefore);
    expect(db.rows('commissions')).toHaveLength(commissionsBefore);
  });

  it('an Admin Gold sale carries a non-blank number and frozen Gold economics', async () => {
    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-700002' }] }]);
    const state = await call('sales', { ...GOLD_SALE });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      saleNumber: 'SALE-700002',
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      expectedCommission: '2400.00',
      status: 'submitted',
    });
  });

  it('an SM sale carries a non-blank number with the same server snapshot', async () => {
    const db = install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-700003' }] }]);
    db.rows('staff_role_assignments').find(
      (assignment) => assignment.staff_id === UUID.viewerStaff,
    )!.role_id = UUID.role.custom;
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
      saleNumber: 'SALE-700003',
      sellerStaffId: UUID.viewerStaff,
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      expectedCommission: '2400.00',
    });
  });
});

describe('sibling sequence RPCs follow the same live shape', () => {
  it('uses the customer number from a one-row array response', async () => {
    const db = install([{ fn: 'next_customer_number', result: [{ customer_number: 'CUS-700001' }] }]);
    const state = await call('customers', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: VALID_CUSTOMER,
    });
    expect(state.status).toBe(201);
    expect((state.body as Record<string, unknown>).customerNumber).toBe('CUS-700001');
    expect(db.rows('customers').some((r) => r.customer_number === 'CUS-700001')).toBe(true);
  });

  it('fails a customer registration on an empty array and inserts nothing', async () => {
    const db = install([{ fn: 'next_customer_number', result: [] }]);
    const before = db.rows('customers').length;
    const state = await call('customers', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: VALID_CUSTOMER,
    });
    expect(state.status).toBe(500);
    expect(db.rows('customers')).toHaveLength(before);
  });

  it('issues an onboarding token from a one-row array response', async () => {
    vi.stubEnv('AFHOMES_WEB_URL', 'https://members.afhomes.test');
    install([
      {
        fn: 'issue_customer_onboarding_token',
        result: [{ token: 'raw-live-shape', expires_at: '2026-10-01T00:00:00.000Z' }],
      },
    ]);
    const state = await call('customers', {
      method: 'POST',
      path: `${CUSTOMER.active}/onboarding-token`,
      token: TOKEN.admin,
      body: {},
    });
    expect(state.status).toBe(201);
    expect((state.body as Record<string, unknown>).activationUrl).toBe(
      'https://members.afhomes.test/customer/activate#token=raw-live-shape',
    );
  });
});
