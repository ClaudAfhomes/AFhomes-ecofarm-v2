/**
 * Legacy direct creation must refuse before consuming a sale number or writing
 * commercial records. New sales originate through the approved Application & RA.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  TOKEN2,
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

const sales = (await import('./sales.js')).default;

let counter = 0;
function install() {
  counter += 1;
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      { fn: 'next_sale_number', result: [{ sale_number: `SALE-${920000 + counter}` }] },
      {
        fn: 'resolve_commission_rule',
        result: [{ rule_id: null, rate: '0.04' }],
      },
    ],
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function create(body: unknown, token?: string): Promise<{ db: FakeSupabase; state: State }> {
  const db = install();
  const { res, state } = makeRes();
  await sales(makeReq({ method: 'POST', familyPath: '', body, token }) as never, res as never);
  return { db, state };
}

const numberCalls = (db: FakeSupabase) => db.calls.filter((c) => c.table === 'next_sale_number');

describe('POST /sales cannot consume a number before the required purchase workflow', () => {
  it.each([
    ['valid request', { customerId: CUSTOMER.prospect, productId: PRODUCT.gold }],
    ['unconfigured scheme', { customerId: CUSTOMER.prospect, productId: PRODUCT.gold, paymentScheme: 'installment_4_month' }],
    ['inactive product', { customerId: CUSTOMER.prospect, productId: PRODUCT.retired }],
    ['inactive seller', { customerId: CUSTOMER.prospect, productId: PRODUCT.gold, sellerStaffId: UUID.inactiveStaff }],
    ['missing fields', {}],
  ])('refuses %s without number, sale or commission writes', async (_label, body) => {
    const { db, state } = await create(body, TOKEN2.salesManager);
    expect(state.status).toBe(409);
    expect(state.body).toMatchObject({ error: { code: 'PURCHASE_WORKFLOW_REQUIRED' } });
    expect(numberCalls(db)).toHaveLength(0);
    expect(db.calls.filter((c) => c.table === 'card_sales' || c.table === 'commissions')).toHaveLength(0);
  });
});
