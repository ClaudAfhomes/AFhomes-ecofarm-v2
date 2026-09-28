/**
 * Card-plan manageability regression (Phase 19).
 *
 * The `card-products` family is the HTTP surface over `card_plans`. Phase 19
 * adds creation, detail reads, search/active filtering and plan copy
 * (`description`) while keeping every Phase 18 guarantee: inactive plans
 * stay invisible to sellers, edits never rewrite sale snapshots, and every
 * write is permission-gated server-side.
 *
 * NOTE on the permission fixture: the Phase 2 double grants the fixture
 * `admin` role `sales.card_plans` create+update, while the real production
 * matrix (`20260930000001` baseline) grants Admin update-only (create is
 * Super Admin-only). Tests that assert the production matrix override the
 * grant in-test instead of trusting the fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
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

const handlers = {
  cards: (await import('./cards.js')).default,
  sales: (await import('./sales.js')).default,
};

function install(rpcs: { fn: string; result: unknown }[] = [], rpcErrors = {}) {
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
  options: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  },
): Promise<State> {
  const { res, state } = makeRes();
  await handlers[family](
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const data = (body: unknown) => (body as { data: Record<string, unknown>[] }).data;
const byCode = (body: unknown) =>
  Object.fromEntries(data(body).map((r) => [r.code, r])) as Record<string, Record<string, unknown>>;

const JADE = {
  name: 'Jade',
  code: 'Jade',
  description: 'A fourth plan for regression tests.',
  cashPrice: '80000.00',
  minimumDownPayment: '25000.00',
  yearlyPoints: 80000,
  commissionRate: '0.04',
  sortOrder: 5,
};

async function createSale(productId: string, saleNumber: string) {
  install([{ fn: 'next_sale_number', result: [{ sale_number: saleNumber }] }]);
  const state = await call('sales', {
    method: 'POST',
    path: '',
    token: TOKEN.admin,
    body: { customerId: CUSTOMER.prospect, productId },
  });
  expect(state.status).toBe(201);
  return state;
}

describe('existing catalogue loads unchanged', () => {
  beforeEach(() => {
    install();
  });

  it('loads Bronze with its frozen economics', async () => {
    const state = await call('cards', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(byCode(state.body).BRONZE).toMatchObject({
      name: 'Bronze',
      cashPrice: '30000.00',
      minimumDownPayment: '10000.00',
      yearlyPoints: 25000,
      commissionRate: '0.04',
      isActive: true,
    });
  });

  it('loads Silver with its frozen economics', async () => {
    const state = await call('cards', { path: '', token: TOKEN.admin });
    expect(byCode(state.body).SILVER).toMatchObject({
      name: 'Silver',
      cashPrice: '40000.00',
      minimumDownPayment: '15000.00',
      yearlyPoints: 40000,
      commissionRate: '0.04',
      isActive: true,
    });
  });

  it('loads Gold with its frozen economics', async () => {
    const state = await call('cards', { path: '', token: TOKEN.admin });
    expect(byCode(state.body).GOLD).toMatchObject({
      name: 'Gold',
      cashPrice: '60000.00',
      minimumDownPayment: '20000.00',
      yearlyPoints: 60000,
      commissionRate: '0.04',
      isActive: true,
    });
  });

  it('reads a single plan by id', async () => {
    const state = await call('cards', { path: PRODUCT.gold, token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ code: 'GOLD', name: 'Gold', description: null });
  });

  it('returns 404 for an unknown plan id', async () => {
    const state = await call('cards', {
      path: '00000000-0000-4000-8000-000000000099',
      token: TOKEN.admin,
    });
    expect(state.status).toBe(404);
  });

  it('hides an inactive plan id from a non-super-admin (404, not 403)', async () => {
    const state = await call('cards', { path: PRODUCT.retired, token: TOKEN.admin });
    expect(state.status).toBe(404);
  });

  it('lets the Super Admin read an inactive plan id', async () => {
    const state = await call('cards', { path: PRODUCT.retired, token: TOKEN.superAdmin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ code: 'LEGACY', isActive: false });
  });
});

describe('creating a card plan', () => {
  beforeEach(() => {
    install();
  });

  it('creates a valid plan with a normalised code and audits it', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: JADE,
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      code: 'JADE',
      name: 'Jade',
      description: 'A fourth plan for regression tests.',
      cashPrice: '80000.00',
      minimumDownPayment: '25000.00',
      yearlyPoints: 80000,
      commissionRate: '0.04',
      isActive: true,
      sortOrder: 5,
    });
    const row = db.rows('card_plans').find((r) => r.code === 'JADE');
    expect(row).toBeDefined();
    expect(
      db
        .rows('audit_events')
        .some((e) => e.action === 'CARD_PLAN_CREATED' && String(e.entity_id) === String(row!.id)),
    ).toBe(true);
  });

  it('sorts a new plan by display order ahead of Gold', async () => {
    await call('cards', { method: 'POST', path: '', token: TOKEN.superAdmin, body: JADE });
    const state = await call('cards', { path: '', token: TOKEN.superAdmin });
    expect(data(state.body).map((r) => r.code)).toEqual(['JADE', 'GOLD', 'SILVER', 'BRONZE']);
  });

  it('rejects a duplicate code (case-insensitive) with 409', async () => {
    const state = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { ...JADE, code: 'gold', name: 'Not Gold' },
    });
    expect(state.status).toBe(409);
  });

  it('rejects a duplicate name with 409', async () => {
    const state = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { ...JADE, code: 'NOTGOLD', name: 'Gold' },
    });
    expect(state.status).toBe(409);
  });

  it.each([
    ['blank name', { ...JADE, code: 'BLANK1', name: '   ' }],
    ['blank code', { ...JADE, code: '   ', name: 'Blank Code' }],
    ['missing economics', { name: 'No Money', code: 'NOMONEY' }],
  ])('rejects %s with 400', async (_name, body) => {
    const state = await call('cards', { method: 'POST', path: '', token: TOKEN.superAdmin, body });
    expect(state.status).toBe(400);
  });

  it.each([
    ['malformed price', { ...JADE, code: 'BAD1', cashPrice: 'abc' }],
    ['zero price', { ...JADE, code: 'BAD2', cashPrice: '0.00' }],
    ['negative down payment', { ...JADE, code: 'BAD3', minimumDownPayment: '-5' }],
    ['down payment above price', { ...JADE, code: 'BAD4', minimumDownPayment: '90000.00' }],
  ])('rejects %s with 400', async (_name, body) => {
    const state = await call('cards', { method: 'POST', path: '', token: TOKEN.superAdmin, body });
    expect(state.status).toBe(400);
  });

  it('rejects negative yearly points with 400', async () => {
    const state = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { ...JADE, code: 'BAD5', yearlyPoints: -1 },
    });
    expect(state.status).toBe(400);
  });

  it.each([
    ['whole-number percent', '4'],
    ['above one', '1.5'],
    ['malformed', 'abc'],
  ])('rejects commission %s with 400', async (_name, commissionRate) => {
    const state = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { ...JADE, code: `BAD-${String(commissionRate).replace('.', '')}`, commissionRate },
    });
    expect(state.status).toBe(400);
  });

  it('accepts the boundary commission rates 0 and 1', async () => {
    for (const [code, name, commissionRate] of [
      ['ZERO-RATE', 'Zero Rate', '0'],
      ['FULL-RATE', 'Full Rate', '1'],
    ] as const) {
      const state = await call('cards', {
        method: 'POST',
        path: '',
        token: TOKEN.superAdmin,
        body: { ...JADE, code, name, commissionRate },
      });
      expect(state.status).toBe(201);
    }
  });
});

describe('editing a card plan', () => {
  beforeEach(() => {
    install();
  });

  it('edits economics and audits CARD_PLAN_UPDATED', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.superAdmin,
      body: { yearlyPoints: 45000, description: 'Updated copy.' },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ yearlyPoints: 45000, description: 'Updated copy.' });
    expect(
      db.rows('audit_events').some((e) => e.action === 'CARD_PLAN_UPDATED'),
    ).toBe(true);
  });

  it('clears the description back to null', async () => {
    await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.superAdmin,
      body: { description: 'Temporary.' },
    });
    const state = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.superAdmin,
      body: { description: null },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ description: null });
  });

  it('rejects a price edit that strands the down payment above it', async () => {
    const state = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.bronze,
      token: TOKEN.superAdmin,
      body: { cashPrice: '5000.00' },
    });
    expect(state.status).toBe(400);
  });

  it('rejects a zero price edit', async () => {
    const state = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.bronze,
      token: TOKEN.superAdmin,
      body: { cashPrice: '0.00', minimumDownPayment: '0.00' },
    });
    expect(state.status).toBe(400);
  });

  it('leaves an existing historical sale snapshot unchanged after a plan edit', async () => {
    await createSale(PRODUCT.gold, 'SALE-910001');
    const db = holder.db as FakeSupabase;
    const sale = db.rows('card_sales').find((r) => r.sale_number === 'SALE-910001');
    expect(sale).toMatchObject({
      cash_price_snapshot: '60000.00',
      minimum_down_payment_snapshot: '20000.00',
      yearly_points_snapshot: 60000,
      commission_rate_snapshot: '0.04',
      expected_commission_snapshot: '2400.00',
    });

    const edit = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.gold,
      token: TOKEN.superAdmin,
      body: { cashPrice: '65000.00', minimumDownPayment: '22000.00', yearlyPoints: 65000 },
    });
    expect(edit.status).toBe(200);

    const after = db.rows('card_sales').find((r) => r.sale_number === 'SALE-910001');
    expect(after).toMatchObject({
      cash_price_snapshot: '60000.00',
      minimum_down_payment_snapshot: '20000.00',
      yearly_points_snapshot: 60000,
      commission_rate_snapshot: '0.04',
      expected_commission_snapshot: '2400.00',
      plan_id: PRODUCT.gold,
    });
  });
});

describe('activate and deactivate', () => {
  beforeEach(() => {
    install();
  });

  it('deactivates, hides from the default catalogue, and blocks new applications', async () => {
    const db = holder.db as FakeSupabase;
    const off = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.superAdmin,
      body: { isActive: false },
    });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ isActive: false });
    expect(db.rows('audit_events').some((e) => e.action === 'CARD_PLAN_DEACTIVATED')).toBe(true);

    const list = await call('cards', { path: '', token: TOKEN.superAdmin });
    expect(data(list.body).map((r) => r.code)).not.toContain('SILVER');

    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-910002' }] }]);
    // Re-apply the deactivation in the fresh world the sale runs against.
    const db2 = holder.db as FakeSupabase;
    db2.rows('card_plans').find((r) => r.id === PRODUCT.silver)!.is_active = false;
    const sale = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.silver },
    });
    expect(sale.status).toBe(409);
  });

  it('keeps history resolvable while deactivated', async () => {
    await createSale(PRODUCT.gold, 'SALE-910003');
    const db = holder.db as FakeSupabase;
    const saleId = db.rows('card_sales').find((r) => r.sale_number === 'SALE-910003')!.id;

    await call('cards', {
      method: 'PATCH',
      path: PRODUCT.gold,
      token: TOKEN.superAdmin,
      body: { isActive: false },
    });

    // The sale row still carries its frozen terms and its plan reference.
    const sale = db.rows('card_sales').find((r) => r.id === saleId);
    expect(sale).toMatchObject({ plan_id: PRODUCT.gold, cash_price_snapshot: '60000.00' });
    // Management can still resolve the retired plan for history/reporting.
    const detail = await call('cards', { path: PRODUCT.gold, token: TOKEN.superAdmin });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ code: 'GOLD', cashPrice: '60000.00' });
  });

  it('reactivates and returns to the default catalogue', async () => {
    const db = holder.db as FakeSupabase;
    await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.superAdmin,
      body: { isActive: false },
    });
    const on = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.superAdmin,
      body: { isActive: true },
    });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ isActive: true });
    expect(db.rows('audit_events').some((e) => e.action === 'CARD_PLAN_ACTIVATED')).toBe(true);
    const list = await call('cards', { path: '', token: TOKEN.superAdmin });
    expect(data(list.body).map((r) => r.code)).toContain('SILVER');
  });
});

describe('listing filters', () => {
  beforeEach(() => {
    install();
  });

  it('filters inactive-only for the Super Admin', async () => {
    const state = await call('cards', {
      path: '',
      token: TOKEN.superAdmin,
      query: { active: 'false' },
    });
    expect(data(state.body).map((r) => r.code)).toEqual(['LEGACY']);
  });

  it('lists everything with active=all and with the legacy flag', async () => {
    for (const query of [{ active: 'all' }, { includeInactive: 'true' }] as Record<
      string,
      string
    >[]) {
      const state = await call('cards', { path: '', token: TOKEN.superAdmin, query });
      expect(data(state.body).map((r) => r.code)).toEqual(['GOLD', 'SILVER', 'BRONZE', 'LEGACY']);
    }
  });

  it('searches by name or code', async () => {
    const state = await call('cards', {
      path: '',
      token: TOKEN.superAdmin,
      query: { search: 'sil' },
    });
    expect(data(state.body).map((r) => r.code)).toEqual(['SILVER']);
  });

  it('keeps the default ordering by display order then name', async () => {
    const state = await call('cards', { path: '', token: TOKEN.superAdmin });
    expect(data(state.body).map((r) => r.code)).toEqual(['GOLD', 'SILVER', 'BRONZE']);
  });

  it('never leaks inactive plans to a non-super-admin, even when asked', async () => {
    const state = await call('cards', {
      path: '',
      token: TOKEN.admin,
      query: { active: 'all', includeInactive: 'true' },
    });
    expect(data(state.body).map((r) => r.code)).toEqual(['GOLD', 'SILVER', 'BRONZE']);
  });
});

describe('plan permissions', () => {
  beforeEach(() => {
    install();
  });

  it('denies catalogue reads without a selling or planning grant', async () => {
    expect((await call('cards', { path: '', token: TOKEN.viewer })).status).toBe(403);
    expect((await call('cards', { path: PRODUCT.gold, token: TOKEN.viewer })).status).toBe(403);
  });

  it('denies plan creation and edits to a role without the grant', async () => {
    expect(
      (
        await call('cards', {
          method: 'POST',
          path: '',
          token: TOKEN.viewer,
          body: JADE,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('cards', {
          method: 'PATCH',
          path: PRODUCT.bronze,
          token: TOKEN.viewer,
          body: { yearlyPoints: 1 },
        })
      ).status,
    ).toBe(403);
  });

  it('denies creation to Admin under the production matrix (update-only)', async () => {
    const db = holder.db as FakeSupabase;
    // The fixture is more permissive than production here; narrow it to the
    // real baseline (admin view+update, no create) before asserting.
    for (const row of db.rows('role_permissions')) {
      if (row.role_id === UUID.role.admin && row.module_id === 'module:sales.card_plans')
        row.can_create = false;
    }
    const denied = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: JADE,
    });
    expect(denied.status).toBe(403);
    const allowed = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.bronze,
      token: TOKEN.admin,
      body: { yearlyPoints: 26000 },
    });
    expect(allowed.status).toBe(200);
  });

  it('keeps Finance view-only: list yes, create and update no', async () => {
    const db = holder.db as FakeSupabase;
    // Mirror the production baseline, which the fixture omits: Finance may
    // view the catalogue and card sales but holds no mutation grant on plans.
    // The list endpoint checks `sales.card_sales` first, so the card_sales
    // view grant (which production holds) is what admits Finance here.
    for (const key of ['sales.card_sales', 'sales.card_plans']) {
      db.rows('role_permissions').push({
        role_id: UUID.role.finance,
        module_id: `module:${key}`,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      });
    }
    const listState = await call('cards', { path: '', token: TOKEN2.finance });
    expect(listState.status).toBe(200);
    expect(data(listState.body).map((r) => r.code)).toEqual(['GOLD', 'SILVER', 'BRONZE']);
    expect(
      (
        await call('cards', {
          method: 'POST',
          path: '',
          token: TOKEN2.finance,
          body: JADE,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('cards', {
          method: 'PATCH',
          path: PRODUCT.bronze,
          token: TOKEN2.finance,
          body: { yearlyPoints: 1 },
        })
      ).status,
    ).toBe(403);
  });
});
