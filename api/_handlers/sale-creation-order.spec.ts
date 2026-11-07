/**
 * Sale creation ordering (BR-RATE-01 lineage, BR-RATE-06).
 *
 * Company rules: the salesperson is entered BEFORE the sale number appears; the
 * system fixes the sale's commercial terms at the moment the number is issued
 * (A4 §3.1, A6 §2.1, C1 §5.4); and invalid inputs generate NO sale number
 * (A2 Control Panel A23; duplicate prevention enforced at freeze, A25). In v2
 * terms: seller resolution AND scheme resolution must both succeed before
 * `next_sale_number` is consumed, so a rejected sale never burns a number.
 */
import { describe, expect, it, vi } from 'vitest';

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

describe('POST /sales ordering (BR-RATE-01: seller before number)', () => {
  it('rejects an unsellable seller before consuming a sale number', async () => {
    const db = install();
    const before = db.rows('card_sales').length;
    const { res, state } = makeRes();
    await sales(
      makeReq({
        method: 'POST',
        familyPath: '',
        body: {
          customerId: CUSTOMER.prospect,
          productId: PRODUCT.gold,
          sellerStaffId: UUID.inactiveStaff,
        },
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(403);
    expect(numberCalls(db)).toHaveLength(0);
    expect(db.rows('card_sales')).toHaveLength(before);
  });

  it('issues exactly one sale number per created sale, after seller resolution', async () => {
    const { db, state } = await create(
      { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
      TOKEN.admin,
    );
    expect(state.status).toBe(201);
    expect(numberCalls(db)).toHaveLength(1);
    const saleNumber = (state.body as { saleNumber: string }).saleNumber;
    expect(saleNumber).toMatch(/^SALE-/);
    const row = db.rows('card_sales').find((r) => r.sale_number === saleNumber);
    expect(row?.seller_staff_id).toBeTruthy();
    expect(row?.commission_rate_snapshot).toBe('0.04');
  });

  it('rejects an unconfigured scheme before consuming a sale number (BR-RATE-06)', async () => {
    // The fixture Gold plan carries no installment price, so the installment
    // track must refuse with 409 - and the refused sale must burn no number.
    const db = install();
    const before = db.rows('card_sales').length;
    const { res, state } = makeRes();
    await sales(
      makeReq({
        method: 'POST',
        familyPath: '',
        body: {
          customerId: CUSTOMER.prospect,
          productId: PRODUCT.gold,
          paymentScheme: 'installment_4_month',
        },
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
    expect(numberCalls(db)).toHaveLength(0);
    expect(db.rows('card_sales')).toHaveLength(before);
  });

  it('rejects an unsellable product before consuming a sale number (BR-RATE-06)', async () => {
    // The fixture Legacy plan is inactive, so sellability fails with 409 -
    // and the refused sale must burn no number.
    const db = install();
    const before = db.rows('card_sales').length;
    const { res, state } = makeRes();
    await sales(
      makeReq({
        method: 'POST',
        familyPath: '',
        body: { customerId: CUSTOMER.prospect, productId: PRODUCT.retired },
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
    expect(numberCalls(db)).toHaveLength(0);
    expect(db.rows('card_sales')).toHaveLength(before);
  });
});
