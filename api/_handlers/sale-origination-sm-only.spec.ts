/**
 * Sale origination for POST /sales (amended 11 Nov 2026).
 *
 * Business rule: the sales.card_sales create permission decides who may originate;
 * OST never may. The seller of record is always an ACTIVE Sales Manager: an SM
 * creator is the seller; Admin / Super Admin must name the SM.
 *
 * Regression: the guard was once an async function called without `await`, so
 * `!promise` was always false. The handler wrote a 403 and then KEPT RUNNING,
 * consuming a sale number and inserting the sale. These tests therefore assert
 * that a refusal writes exactly one response, inserts no sale or commission and
 * consumes no sale number - not merely that the status code is 403.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  STAFF2,
  TOKEN,
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
      { fn: 'next_sale_number', result: [{ sale_number: `SALE-${930000 + counter}` }] },
      { fn: 'resolve_commission_rule', result: [{ rule_id: null, rate: '0.04' }] },
    ],
  });
  return holder.db as FakeSupabase;
}

/** Counts every response write so a handler that answers twice is caught. */
function countingRes() {
  const { res, state } = makeRes();
  let writes = 0;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    writes += 1;
    return json(body);
  };
  return { res, state, writes: () => writes };
}

async function post(token: string, body: Record<string, unknown>) {
  const db = install();
  const before = {
    sales: db.rows('card_sales').length,
    commissions: db.rows('commissions').length,
  };
  const r = countingRes();
  await sales(makeReq({ method: 'POST', familyPath: '', body, token }) as never, r.res as never);
  return {
    db,
    state: r.state,
    writes: r.writes(),
    salesAdded: db.rows('card_sales').length - before.sales,
    commissionsAdded: db.rows('commissions').length - before.commissions,
    numbersIssued: db.calls.filter((c) => c.table === 'next_sale_number').length,
  };
}

const BODY = { customerId: CUSTOMER.prospect, productId: PRODUCT.gold };
const message = (body: unknown) => (body as { error?: { message?: string } }).error?.message ?? '';

describe('POST /sales origination: module permission decides who; an active SM is always the seller', () => {
  const refused: [string, string, RegExp][] = [
    // The fixture VD, Finance and HR hold no sales.card_sales create grant, so the module check refuses first.
    ['Vice Director (no grant)', TOKEN2.viceDirector, /./],
    ['Finance (no grant)', TOKEN2.finance, /./],
    ['HR (no grant)', TOKEN2.hr, /./],
    // OST holds the grant in the fixture but may never originate.
    ['OST', TOKEN2.ost, /OST or inactive account/],
  ];

  for (const [label, token, why] of refused) {
    it(`refuses ${label} with one 403 and no side effects`, async () => {
      const out = await post(token, { ...BODY, sellerStaffId: STAFF2.salesManager });
      expect(out.state.status).toBe(403);
      expect(out.writes).toBe(1);
      expect(out.salesAdded).toBe(0);
      expect(out.commissionsAdded).toBe(0);
      expect(out.numbersIssued).toBe(0);
      expect(message(out.state.body)).toMatch(why);
    });
  }

  for (const [label, token] of [
    ['Admin', TOKEN.admin],
    ['Super Admin', TOKEN.superAdmin],
  ] as const) {
    it(`lets ${label} create the sale for an active SM, who is the seller of record`, async () => {
      const out = await post(token, { ...BODY, sellerStaffId: STAFF2.salesManager });
      expect(out.state.status).toBe(201);
      expect(out.writes).toBe(1);
      expect(out.salesAdded).toBe(1);
      expect(out.db.rows('card_sales').at(-1)!.seller_staff_id).toBe(STAFF2.salesManager);
    });

    it(`refuses ${label} without a named SM, before any write`, async () => {
      const out = await post(token, BODY);
      expect(out.state.status).toBe(400);
      expect(out.writes).toBe(1);
      expect(message(out.state.body)).toMatch(/seller of record/);
      expect(out.salesAdded).toBe(0);
      expect(out.numbersIssued).toBe(0);
    });

    it(`refuses ${label} naming a non-SM (themselves or an OST) as seller`, async () => {
      const out = await post(token, { ...BODY, sellerStaffId: STAFF2.ost });
      expect(out.state.status).toBe(403);
      expect(out.salesAdded).toBe(0);
      expect(out.numbersIssued).toBe(0);
    });
  }

  it('lets an active Sales Manager create the sale as the seller of record', async () => {
    const out = await post(TOKEN2.salesManager, BODY);
    expect(out.state.status).toBe(201);
    expect(out.writes).toBe(1);
    expect(out.salesAdded).toBe(1);
    expect(out.numbersIssued).toBe(1);
    const sale = out.db.rows('card_sales').at(-1)!;
    expect(sale.seller_staff_id).toBe(STAFF2.salesManager);
  });

  it('refuses a Sales Manager naming another seller, before any write', async () => {
    const out = await post(TOKEN2.salesManager, { ...BODY, sellerStaffId: UUID.superAdminStaff });
    expect(out.state.status).toBe(403);
    expect(out.writes).toBe(1);
    expect(message(out.state.body)).toMatch(/seller of record/);
    expect(out.salesAdded).toBe(0);
    expect(out.numbersIssued).toBe(0);
  });

  it('accepts a Sales Manager naming themselves as the seller', async () => {
    const out = await post(TOKEN2.salesManager, { ...BODY, sellerStaffId: STAFF2.salesManager });
    expect(out.state.status).toBe(201);
    expect(out.salesAdded).toBe(1);
  });
});
