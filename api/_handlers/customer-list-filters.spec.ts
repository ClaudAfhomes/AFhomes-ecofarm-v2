/**
 * AF Homes customer directory list filters (`GET /customers`).
 *
 * Pins the status/payment query contract: valid values reach the
 * `customer_directory` RPC untouched, and an unknown payment state is
 * rejected before any database call. Row-level filtering itself is proven on
 * real PostgreSQL in `supabase/db-integration.ts` section 49.
 */
import { describe, expect, it, vi } from 'vitest';

import {
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
  id: 'aaaaaaaa-0000-4000-8000-000000000003',
  customer_number: 'AF-CUS-000003',
  customer_code: 'AF-CC-AAAAAAAA',
  first_name: 'Maria',
  middle_name: null,
  last_name: 'Santos',
  suffix: null,
  email: 'maria@example.invalid',
  phone: '+639171234567',
  birth_date: null,
  gender: null,
  address: null,
  government_id_type: null,
  government_id_number: null,
  government_id_masked: null,
  status: 'active',
  auth_user_id: null,
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
  memberships: null,
  derivedCategory: 'ACTIVE',
};

let captured: Record<string, unknown> = {};

function install() {
  captured = {};
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      {
        fn: 'customer_directory',
        result: (args: { p_filters?: Record<string, unknown> }) => {
          captured = { ...(args.p_filters ?? {}) };
          return [{ record: RECORD, total_count: 1 }];
        },
      },
    ],
  });
}

type State = { status: number; body: unknown };

async function call(query: Record<string, string>): Promise<State> {
  const { res, state } = makeRes();
  await customers(
    makeReq({ method: 'GET', familyPath: '', query, token: TOKEN2.salesManager }) as never,
    res as never,
  );
  return state;
}

describe('GET /customers list filters', () => {
  it('forwards the status and payment filters to the directory RPC', async () => {
    install();
    const state = await call({ status: 'active', payment: 'fully_paid' });
    expect(state.status).toBe(200);
    expect(captured).toMatchObject({ status: 'active', payment: 'fully_paid' });
  });

  it('rejects an unknown payment state before any database call', async () => {
    install();
    const state = await call({ payment: 'half_paid' });
    expect(state.status).toBe(400);
    expect(captured).toEqual({});
  });
});
