/**
 * AF Homes customer detail read (`GET /customers/:id`).
 *
 * Drives the real handler, the real authorization resolver and the real Zod
 * schemas against the in-memory Supabase fake. The `customer_directory` RPC
 * (including the newer `id` filter) is scripted; its SQL truth is proven by
 * execution in `supabase/db-integration.ts`, and the handler contract with it
 * - id filter sent, single-row mapping, 404 on empty - is asserted here.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
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

const RECORD = {
  id: CUSTOMER.active,
  customer_number: 'AF-CUS-000003',
  customer_code: 'AF-CC-AAAAAAAA',
  first_name: 'Maria',
  middle_name: null,
  last_name: 'Santos',
  suffix: null,
  email: 'maria@example.invalid',
  phone: '+639171234567',
  birth_date: '1990-05-05',
  gender: 'female',
  address: null,
  government_id_type: 'passport',
  government_id_number: 'P1234567',
  government_id_masked: null,
  status: 'active',
  auth_user_id: null,
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
  memberships: { id: 'dddddddd-0000-4000-8000-000000000001', status: 'active' },
  tier: 'GOLD',
  member_status: 'active',
  expires_at: '2027-05-05T00:00:00.000Z',
  payment_status: 'fully_paid',
  derivedCategory: 'ACTIVE_VIP',
};

function install(rows: unknown[] = [{ record: RECORD, total_count: 1 }]) {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [{ fn: 'customer_directory', result: rows }],
  });
}

/** No RPC stub: the fake computes the directory from the fixture tables. */
function installLive() {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
  });
}

type State = { status: number; body: unknown };

async function call(options: { path: string; token?: string }): Promise<State> {
  const { res, state } = makeRes();
  await customers(
    makeReq({ method: 'GET', familyPath: options.path, token: options.token }) as never,
    res as never,
  );
  return state;
}

describe('GET /customers/:id', () => {
  it('returns the directory row for a viewer of sales.customers', async () => {
    install();
    const state = await call({ path: CUSTOMER.active, token: TOKEN2.salesManager });
    expect(state.status).toBe(200);
    const body = state.body as Record<string, unknown>;
    expect(body).toMatchObject({
      id: CUSTOMER.active,
      customerNumber: 'AF-CUS-000003',
      fullName: 'Maria Santos',
      status: 'active',
      derivedCategory: 'ACTIVE_VIP',
      tier: 'GOLD',
      membershipStatus: 'active',
      membershipExpiresAt: '2027-05-05T00:00:00.000Z',
      paymentStatus: 'fully_paid',
      verifiedPaid: '0.00',
      frozenTotal: '0.00',
    });
  });

  it('exposes only the masked government ID, never the raw number', async () => {
    install();
    const state = await call({ path: CUSTOMER.active, token: TOKEN2.salesManager });
    expect(state.status).toBe(200);
    const raw = JSON.stringify(state.body);
    expect(raw).not.toContain('P1234567');
    expect((state.body as Record<string, unknown>).governmentIdMasked).toBe('****4567');
  });

  it('returns 404 when the directory has no such row', async () => {
    install([]);
    const state = await call({
      path: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      token: TOKEN2.salesManager,
    });
    expect(state.status).toBe(404);
  });

  it('resolves the requested row (not the first row) without an RPC stub', async () => {
    installLive();
    const state = await call({ path: CUSTOMER.active, token: TOKEN2.salesManager });
    expect(state.status).toBe(200);
    expect((state.body as Record<string, unknown>).id).toBe(CUSTOMER.active);
  });

  it('returns 404 for an unknown id without an RPC stub', async () => {
    installLive();
    const state = await call({
      path: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      token: TOKEN2.salesManager,
    });
    expect(state.status).toBe(404);
  });

  it('refuses unauthenticated callers', async () => {
    install();
    const state = await call({ path: CUSTOMER.active });
    expect(state.status).toBe(401);
  });

  it('refuses a role without the sales.customers view grant', async () => {
    // HR holds only dashboard.view; finance legitimately holds the customers
    // view grant (permission matrix), so HR is the denial case here.
    install();
    const state = await call({ path: CUSTOMER.active, token: TOKEN2.hr });
    expect(state.status).toBe(403);
  });
});
