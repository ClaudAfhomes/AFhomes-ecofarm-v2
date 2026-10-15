/**
 * Card-category manageability regression (Phase 19 completion patch).
 *
 * `card-categories` is the HTTP surface over the existing `card_categories`
 * table - reused, not duplicated. Categories own the plan vocabulary:
 * a plan is selectable for a NEW application only when the plan itself is
 * active AND its category is active. Deactivation never deletes plans,
 * sales, memberships or snapshots.
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
  categories: (await import('./card-categories.js')).default,
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

const MEMBERSHIP_CATEGORY = '99999999-9999-4999-8999-999999999999';

const VIP = {
  name: 'VIP Cards',
  slug: 'Vip-Cards',
  description: 'Premium tier vocabulary.',
  sortOrder: 5,
};

describe('existing membership category', () => {
  beforeEach(() => {
    install();
  });

  it('loads with its seeded values and plan count', async () => {
    const state = await call('categories', { path: '', token: TOKEN.superAdmin });
    expect(state.status).toBe(200);
    expect(data(state.body)).toMatchObject([
      {
        slug: 'membership',
        name: 'Membership Cards',
        isActive: true,
        sortOrder: 10,
        planCount: 4,
      },
    ]);
  });

  it('reads a single category by id', async () => {
    const state = await call('categories', { path: MEMBERSHIP_CATEGORY, token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ slug: 'membership', planCount: 4 });
  });

  it('returns 404 for an unknown category id', async () => {
    const state = await call('categories', {
      path: '00000000-0000-4000-8000-000000000099',
      token: TOKEN.superAdmin,
    });
    expect(state.status).toBe(404);
  });

  it('exposes no DELETE route', async () => {
    const state = await call('categories', {
      method: 'DELETE',
      path: MEMBERSHIP_CATEGORY,
      token: TOKEN.superAdmin,
    });
    expect(state.status).toBe(404);
  });
});

describe('creating a category', () => {
  beforeEach(() => {
    install();
  });

  it('creates with a normalised slug and audits it', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: VIP,
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      slug: 'vip-cards',
      name: 'VIP Cards',
      description: 'Premium tier vocabulary.',
      isActive: true,
      sortOrder: 5,
    });
    const row = db.rows('card_categories').find((r) => r.slug === 'vip-cards');
    expect(row).toBeDefined();
    expect(
      db
        .rows('audit_events')
        .some(
          (e) => e.action === 'CARD_CATEGORY_CREATED' && String(e.entity_id) === String(row!.id),
        ),
    ).toBe(true);
  });

  it('rejects a duplicate slug (case-insensitive) with 409', async () => {
    const state = await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { name: 'Other Membership', slug: 'MEMBERSHIP' },
    });
    expect(state.status).toBe(409);
  });

  it.each([
    ['blank name', { name: '   ', slug: 'blank-name' }],
    ['invalid slug', { name: 'Bad Slug', slug: 'not a slug!' }],
  ])('rejects %s with 400', async (_name, body) => {
    const state = await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body,
    });
    expect(state.status).toBe(400);
  });
});

describe('editing a category', () => {
  beforeEach(() => {
    install();
  });

  it('edits name, description and order and audits CARD_CATEGORY_UPDATED', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call('categories', {
      method: 'PATCH',
      path: MEMBERSHIP_CATEGORY,
      token: TOKEN.superAdmin,
      body: { description: 'Core vocabulary.', sortOrder: 1 },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ description: 'Core vocabulary.', sortOrder: 1 });
    expect(db.rows('audit_events').some((e) => e.action === 'CARD_CATEGORY_UPDATED')).toBe(true);
  });

  it('orders categories by sort order', async () => {
    await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: VIP,
    });
    const state = await call('categories', { path: '', token: TOKEN.superAdmin });
    expect(data(state.body).map((r) => r.slug)).toEqual(['vip-cards', 'membership']);
  });

  it('deactivates and reactivates with distinct audits', async () => {
    const db = holder.db as FakeSupabase;
    const off = await call('categories', {
      method: 'PATCH',
      path: MEMBERSHIP_CATEGORY,
      token: TOKEN.superAdmin,
      body: { isActive: false },
    });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ isActive: false });
    expect(db.rows('audit_events').some((e) => e.action === 'CARD_CATEGORY_DEACTIVATED')).toBe(
      true,
    );
    const on = await call('categories', {
      method: 'PATCH',
      path: MEMBERSHIP_CATEGORY,
      token: TOKEN.superAdmin,
      body: { isActive: true },
    });
    expect(on.status).toBe(200);
    expect(db.rows('audit_events').some((e) => e.action === 'CARD_CATEGORY_ACTIVATED')).toBe(true);
  });
});

describe('category permissions', () => {
  beforeEach(() => {
    install();
  });

  it('denies reads without a selling or planning grant', async () => {
    expect((await call('categories', { path: '', token: TOKEN.viewer })).status).toBe(403);
  });

  it('denies creation and edits to a role without the grant', async () => {
    expect(
      (await call('categories', { method: 'POST', path: '', token: TOKEN.viewer, body: VIP }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('categories', {
          method: 'PATCH',
          path: MEMBERSHIP_CATEGORY,
          token: TOKEN.viewer,
          body: { description: 'x' },
        })
      ).status,
    ).toBe(403);
  });

  it('denies creation to Admin under the production matrix (update-only)', async () => {
    const db = holder.db as FakeSupabase;
    for (const row of db.rows('role_permissions')) {
      if (row.role_id === UUID.role.admin && row.module_id === 'module:sales.card_plans')
        row.can_create = false;
    }
    expect(
      (await call('categories', { method: 'POST', path: '', token: TOKEN.admin, body: VIP }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('categories', {
          method: 'PATCH',
          path: MEMBERSHIP_CATEGORY,
          token: TOKEN.admin,
          body: { description: 'Admin copy.' },
        })
      ).status,
    ).toBe(200);
  });

  it('lets Finance read but never mutate', async () => {
    const db = holder.db as FakeSupabase;
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
    expect((await call('categories', { path: '', token: TOKEN2.finance })).status).toBe(200);
    expect(
      (await call('categories', { method: 'POST', path: '', token: TOKEN2.finance, body: VIP }))
        .status,
    ).toBe(403);
  });
});

describe('category-gated selling', () => {
  beforeEach(() => {
    install();
  });

  it('creates a plan under a new active category', async () => {
    const created = await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: VIP,
    });
    expect(created.status).toBe(201);
    const categoryId = (created.body as { id: string }).id;
    const plan = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: {
        name: 'VIP Gold',
        code: 'VIPGOLD',
        categoryId,
        cashPrice: '100000.00',
        minimumDownPayment: '30000.00',
        yearlyPoints: 100000,
        commissionRate: '0.04',
      },
    });
    expect(plan.status).toBe(201);
    expect(plan.body).toMatchObject({
      categoryId,
      categoryName: 'VIP Cards',
      categoryIsActive: true,
    });
  });

  it('refuses a new plan under an inactive category', async () => {
    const created = await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { ...VIP, isActive: false },
    });
    const categoryId = (created.body as { id: string }).id;
    const plan = await call('cards', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: {
        name: 'VIP Gold',
        code: 'VIPGOLD',
        categoryId,
        cashPrice: '100000.00',
        minimumDownPayment: '30000.00',
        yearlyPoints: 100000,
        commissionRate: '0.04',
      },
    });
    expect(plan.status).toBe(400);
  });

  it('refuses to move a plan into an inactive category', async () => {
    const created = await call('categories', {
      method: 'POST',
      path: '',
      token: TOKEN.superAdmin,
      body: { ...VIP, isActive: false },
    });
    const categoryId = (created.body as { id: string }).id;
    const moved = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.bronze,
      token: TOKEN.superAdmin,
      body: { categoryId },
    });
    expect(moved.status).toBe(400);
    // The plan kept its original category.
    const detail = await call('cards', { path: PRODUCT.bronze, token: TOKEN.superAdmin });
    expect(detail.body).toMatchObject({ categoryId: MEMBERSHIP_CATEGORY });
  });

  it('hides an active plan under an inactive category from new applications', async () => {
    // A sale for Gold succeeds while everything is active.
    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-920001' }] }]);
    const ok = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(ok.status).toBe(201);

    // Deactivate the shared category in the same world the sale runs against.
    const db = holder.db as FakeSupabase;
    db.rows('card_categories').find((r) => r.id === MEMBERSHIP_CATEGORY)!.is_active = false;

    // The active Gold plan disappears from the default (sellable) catalogue…
    const list = await call('cards', { path: '', token: TOKEN.admin });
    expect(data(list.body)).toHaveLength(0);
    const legacy = await call('cards', { path: '', token: TOKEN.superAdmin });
    expect(data(legacy.body)).toHaveLength(0);
    const managed = await call('cards', {
      path: '',
      token: TOKEN.superAdmin,
      query: { active: 'all' },
    });
    expect(
      (data(managed.body) as { code: string }[]).map((r) => r.code),
    ).toEqual(expect.arrayContaining(['GOLD']));

    // …its detail is 404 for sellers but resolvable for management…
    expect((await call('cards', { path: PRODUCT.gold, token: TOKEN.admin })).status).toBe(404);
    expect((await call('cards', { path: PRODUCT.gold, token: TOKEN.superAdmin })).status).toBe(
      200,
    );

    // …and a NEW application for it is refused without touching history.
    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-920002' }] }]);
    const db2 = holder.db as FakeSupabase;
    db2.rows('card_categories').find((r) => r.id === MEMBERSHIP_CATEGORY)!.is_active = false;
    const salesBefore = db2.rows('card_sales').length;
    const refused = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(refused.status).toBe(409);
    expect(db2.rows('card_sales')).toHaveLength(salesBefore);
  });

  it('makes eligible plans selectable again after reactivation', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('card_categories').find((r) => r.id === MEMBERSHIP_CATEGORY)!.is_active = false;
    expect(data((await call('cards', { path: '', token: TOKEN.admin })).body)).toHaveLength(0);

    await call('categories', {
      method: 'PATCH',
      path: MEMBERSHIP_CATEGORY,
      token: TOKEN.superAdmin,
      body: { isActive: true },
    });
    const list = await call('cards', { path: '', token: TOKEN.admin });
    expect(data(list.body).map((r) => r.code)).toEqual(['GOLD', 'SILVER', 'BRONZE']);

    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-920003' }] }]);
    const sale = await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    expect(sale.status).toBe(201);
  });

  it('leaves existing sales, memberships and snapshots untouched by deactivation', async () => {
    install([{ fn: 'next_sale_number', result: [{ sale_number: 'SALE-920004' }] }]);
    await call('sales', {
      method: 'POST',
      path: '',
      token: TOKEN.admin,
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.gold },
    });
    const db = holder.db as FakeSupabase;
    const before = {
      sales: db.rows('card_sales').length,
      memberships: db.rows('memberships').length,
      snapshots: db
        .rows('card_sales')
        .map((r) => [r.cash_price_snapshot, r.expected_commission_snapshot]),
    };

    await call('categories', {
      method: 'PATCH',
      path: MEMBERSHIP_CATEGORY,
      token: TOKEN.superAdmin,
      body: { isActive: false, description: 'Retired vocabulary.' },
    });

    expect(db.rows('card_sales')).toHaveLength(before.sales);
    expect(db.rows('memberships')).toHaveLength(before.memberships);
    expect(
      db.rows('card_sales').map((r) => [r.cash_price_snapshot, r.expected_commission_snapshot]),
    ).toEqual(before.snapshots);
    expect(db.rows('card_plans').filter((r) => r.category_id === MEMBERSHIP_CATEGORY)).toHaveLength(
      4,
    );
    expect(byGoldEconomics(db)).toBe(true);
  });
});

function byGoldEconomics(db: FakeSupabase): boolean {
  const gold = db.rows('card_plans').find((r) => r.code === 'GOLD');
  return (
    gold?.cash_price === '60000.00' &&
    gold?.minimum_down_payment === '20000.00' &&
    gold?.yearly_points === 60000 &&
    gold?.commission_rate === '0.04'
  );
}
