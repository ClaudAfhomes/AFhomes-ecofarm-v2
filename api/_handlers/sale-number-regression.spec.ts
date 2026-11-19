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
 * Direct sale creation now refuses before reaching this sequence. Customer and
 * onboarding sequence readers still exercise the live one-row-array response.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  TOKEN,
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
  token: TOKEN2.salesManager,
  body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
} as const;

const err = (body: unknown) => (body as { error: { code: string; message: string } }).error;

describe('legacy sale creation never reaches the sale-number RPC', () => {
  it.each([
    ['one-row array', [{ sale_number: 'SALE-700001' }]],
    ['empty array', []],
    ['empty number', [{ sale_number: '' }]],
    ['whitespace number', [{ sale_number: '   ' }]],
    ['unexpected rows', [{ sale_number: 'SALE-1' }, { sale_number: 'SALE-2' }]],
  ])('refuses bypass before reading a %s result', async (_shape, result) => {
    const db = install([{ fn: 'next_sale_number', result }]);
    const salesBefore = db.rows('card_sales').length;
    const commissionsBefore = db.rows('commissions').length;
    const state = await call('sales', { ...GOLD_SALE });
    expect(state.status).toBe(409);
    expect(err(state.body).code).toBe('PURCHASE_WORKFLOW_REQUIRED');
    expect(db.calls.some((c) => c.table === 'next_sale_number')).toBe(false);
    expect(db.rows('card_sales')).toHaveLength(salesBefore);
    expect(db.rows('commissions')).toHaveLength(commissionsBefore);
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
