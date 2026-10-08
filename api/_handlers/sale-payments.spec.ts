/**
 * AF Homes sale payment reads (`GET /sales/:id/payments`).
 *
 * Actor UUIDs stay the source of truth, but the response also carries
 * display names resolved server-side in one lookup - the UI must never show
 * a raw staff UUID. Unknown or removed staff read as null upstream.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  LINKS,
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
type Row = {
  recordedBy: string;
  verifiedBy: string | null;
  recordedByName: string | null;
  verifiedByName: string | null;
};

async function call(path: string): Promise<State> {
  const { res, state } = makeRes();
  await sales(
    makeReq({ method: 'GET', familyPath: path, token: TOKEN2.finance }) as never,
    res as never,
  );
  return state;
}

describe('GET /sales/:id/payments actor names', () => {
  it('resolves actor UUIDs to staff names', async () => {
    install();
    const state = await call(`${SALE.downPaid}/payments`);
    expect(state.status).toBe(200);
    const rows = (state.body as { data: Row[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.recordedByName).toBe('Ops Admin');
      expect(row.recordedBy).not.toBe('Ops Admin');
    }
  });

  it('reads a missing verifier as null, never a UUID', async () => {
    install();
    const state = await call(`${SALE.downPaid}/payments`);
    expect(state.status).toBe(200);
    const rows = (state.body as { data: Row[] }).data;
    const unverified = rows.find((row) => row.verifiedBy === null);
    expect(unverified).toBeDefined();
    expect(unverified?.verifiedByName).toBeNull();
  });
});
