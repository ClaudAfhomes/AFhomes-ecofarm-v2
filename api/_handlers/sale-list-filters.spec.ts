/**
 * AF Homes sales directory list filters (`GET /sales`).
 *
 * Pins the card filter contract: a plan id narrows the directory to that
 * card, and a malformed id is rejected before any database call. Seller
 * scoping itself is proven in `phase9-customer-lifecycle.spec.ts`, so these
 * run as finance (sees every sale).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  LINKS,
  PRODUCT,
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

const sales = (await import('./sales.js')).default;

function install() {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
  });
}

type State = { status: number; body: unknown };

async function call(query: Record<string, string>): Promise<State> {
  const { res, state } = makeRes();
  await sales(
    makeReq({ method: 'GET', familyPath: '', query, token: TOKEN2.finance }) as never,
    res as never,
  );
  return state;
}

describe('GET /sales list filters', () => {
  it('narrows the directory to the requested card', async () => {
    install();
    const state = await call({ productId: PRODUCT.gold });
    expect(state.status).toBe(200);
    const body = state.body as { data: { productId: string }[]; meta: { total: number } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((row) => row.productId === PRODUCT.gold)).toBe(true);
    expect(body.meta.total).toBe(body.data.length);
  });

  it('rejects a malformed card id before any database call', async () => {
    install();
    const state = await call({ productId: 'not-a-uuid' });
    expect(state.status).toBe(400);
  });
});
