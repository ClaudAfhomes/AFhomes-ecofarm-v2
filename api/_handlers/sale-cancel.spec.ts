/**
 * AF Homes sale cancellation (`POST /sales/:id/cancel`).
 *
 * Cancellation is a terminal status move, never destruction: only `draft`
 * sales with no recorded/verified payments, no membership and no live
 * commissions may cancel, every decision is audited, and an out-of-scope
 * sale reads as missing (the Phase 9 no-probe convention).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  ROLE2,
  STAFF2,
  TOKEN,
  TOKEN2,
  UNIQUE,
  moduleId,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import type { FakeTables } from '../_lib/testing/supabase-fake.js';

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

const DRAFT_SALE = 'dddddddd-0000-4000-8000-000000000010';

const draftSale = (over: Record<string, unknown> = {}) => ({
  id: DRAFT_SALE,
  sale_number: 'SALE-000010',
  customer_id: CUSTOMER.prospect,
  plan_id: PRODUCT.gold,
  seller_type: 'staff',
  seller_staff_id: STAFF2.salesManager,
  seller_ost_id: null,
  cash_price: '60000.00',
  cash_price_snapshot: '60000.00',
  minimum_down_payment_snapshot: '20000.00',
  yearly_points_snapshot: 60000,
  commission_rate_snapshot: '0.04',
  expected_commission_snapshot: '2400.00',
  status: 'draft',
  submitted_at: null,
  payment_verified_at: null,
  fully_paid_at: null,
  activated_at: null,
  created_at: '2026-09-28T00:00:00.000Z',
  updated_at: '2026-09-28T00:00:00.000Z',
  ...over,
});

function install(overrides: Partial<FakeTables> = {}) {
  const tables = phase2World({
    // The fixture sales-manager role is view/create; cancellation needs the
    // update grant, so this suite works with it granted (denial of the
    // un-granted role is covered separately below).
    role_permissions: phase2World().role_permissions.map((row) =>
      row.role_id === ROLE2.salesManager && row.module_id === moduleId('sales.card_sales')
        ? { ...row, can_update: true }
        : row,
    ),
    card_sales: [draftSale()],
    payments: [],
    memberships: [],
    commissions: [],
    ...overrides,
  });
  holder.db = new FakeSupabase({
    tables,
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(saleId: string, token?: string): Promise<State> {
  const { res, state } = makeRes();
  await sales(
    makeReq({ method: 'POST', familyPath: `${saleId}/cancel`, token }) as never,
    res as never,
  );
  return state;
}

const err = (body: unknown) => (body as { error: { code: string; message: string } }).error;

describe('POST /sales/:id/cancel', () => {
  it('cancels an owned draft and audits the move', async () => {
    const db = install();
    const state = await call(DRAFT_SALE, TOKEN2.salesManager);
    expect(state.status).toBe(200);
    expect((state.body as { status: string }).status).toBe('cancelled');
    expect(db.rows('card_sales').find((r) => r.id === DRAFT_SALE)?.status).toBe('cancelled');
    const audits = db
      .rows('audit_events')
      .filter((r) => r.action === 'SALE_CANCELLED' && r.entity_id === DRAFT_SALE);
    expect(audits.length).toBe(1);
  });

  it('refuses a non-draft sale even for the super admin', async () => {
    install({ card_sales: [draftSale({ status: 'submitted' })] });
    const state = await call(DRAFT_SALE, TOKEN.superAdmin);
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/draft/i);
  });

  it('refuses a draft carrying a recorded payment', async () => {
    install({
      payments: [{ id: 'pay-1', sale_id: DRAFT_SALE, status: 'recorded', amount: '5000.00' }],
    });
    const state = await call(DRAFT_SALE, TOKEN.superAdmin);
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/payment/i);
  });

  it('refuses a draft that already grew a membership', async () => {
    install({ memberships: [{ id: 'mem-1', sale_id: DRAFT_SALE, status: 'active' }] });
    const state = await call(DRAFT_SALE, TOKEN.superAdmin);
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/membership/i);
  });

  it('refuses a draft with a live commission', async () => {
    install({
      commissions: [{ id: 'com-1', sale_id: DRAFT_SALE, status: 'pending' }],
    });
    const state = await call(DRAFT_SALE, TOKEN.superAdmin);
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/commission/i);
  });

  it('reads an unknown sale as missing', async () => {
    install();
    const state = await call('ffffffff-ffff-4fff-8fff-ffffffffffff', TOKEN.superAdmin);
    expect(state.status).toBe(404);
  });

  it('refuses unauthenticated callers', async () => {
    install();
    const state = await call(DRAFT_SALE);
    expect(state.status).toBe(401);
  });

  it('refuses a role without the update grant', async () => {
    // TOKEN2.hr holds only dashboard.view.
    install();
    const state = await call(DRAFT_SALE, TOKEN2.hr);
    expect(state.status).toBe(403);
  });

  it('reads another seller’s draft as missing instead of forbidden', async () => {
    install({
      card_sales: [draftSale({ seller_staff_id: '00000000-0000-4000-8000-00000000aa01' })],
    });
    const state = await call(DRAFT_SALE, TOKEN2.salesManager);
    expect(state.status).toBe(404);
  });
});
