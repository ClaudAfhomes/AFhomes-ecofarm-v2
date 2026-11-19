/**
 * POST /sales cannot bypass application approval and RA execution. Authorized
 * originators receive workflow guidance; other roles are denied.
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


describe('POST /sales requires the approved application workflow for authorized originators', () => {
  it.each([
    ['Vice Director', TOKEN2.viceDirector],
    ['Senior Sales Manager', TOKEN2.seniorSalesManager],
    ['Finance', TOKEN2.finance],
    ['HR', TOKEN2.hr],
    ['OST', TOKEN2.ost],
  ])('refuses %s with one 403 and no side effects', async (_role, token) => {
    const out = await post(token, { ...BODY, sellerStaffId: STAFF2.salesManager });
    expect(out.state.status).toBe(403);
    expect(out.writes).toBe(1);
    expect(out.salesAdded).toBe(0);
    expect(out.commissionsAdded).toBe(0);
    expect(out.numbersIssued).toBe(0);
  });

  it.each([
    ['Admin', TOKEN.admin],
    ['Super Admin', TOKEN.superAdmin],
    ['Sales Manager', TOKEN2.salesManager],
  ])('requires %s to finalize through the application and RA workflow', async (_role, token) => {
    for (const sellerStaffId of [undefined, STAFF2.salesManager, STAFF2.ost, UUID.superAdminStaff]) {
      const out = await post(token, { ...BODY, ...(sellerStaffId ? { sellerStaffId } : {}) });
      expect(out.state.status).toBe(409);
      expect(out.state.body).toMatchObject({ error: { code: 'PURCHASE_WORKFLOW_REQUIRED' } });
      expect(out.writes).toBe(1);
      expect(out.salesAdded).toBe(0);
      expect(out.commissionsAdded).toBe(0);
      expect(out.numbersIssued).toBe(0);
    }
  });
});
