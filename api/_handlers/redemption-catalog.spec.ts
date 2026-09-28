/**
 * Redemption-catalog manageability regression (Phase 21).
 *
 * Drives the REAL redemptions handler with the REAL permission resolver
 * against a catalog-shaped world mirroring the production baseline (admin
 * manages, employee spends, finance holds neither key). The redemption
 * transaction itself is NOT executed here - that is Phase 22 and the
 * Phase 4 suite - but seeded transaction, account and ledger rows prove
 * catalog CRUD never moves points or rewrites history.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const handler = (await import('./redemptions.js')).default;

const TOK = {
  superAdmin: 'tok-superadmin',
  admin: 'tok-admin',
  employee: 'tok-employee',
  finance: 'tok-finance',
  customer: 'tok-customer',
} as const;

const TEPPANYAKI = '11111111-1111-4111-8111-111111111111';
const RETIRED = '11111111-1111-4111-8111-111111111112';

function install() {
  holder.db = new FakeSupabase({
    tables: {
      modules: [
        { id: 'm1', key: 'operations.redemption', is_active: true },
        { id: 'm2', key: 'operations.catalog', is_active: true },
      ],
      roles: [
        { id: 'r0', slug: 'super_admin', name: 'Super Admin', is_active: true },
        { id: 'r1', slug: 'admin', name: 'Admin', is_active: true },
        { id: 'r2', slug: 'employee', name: 'Employee', is_active: true },
        { id: 'r3', slug: 'finance', name: 'Finance', is_active: true },
      ],
      role_permissions: [
        { role_id: 'r1', module_id: 'm2', can_view: true, can_create: true, can_update: true, can_delete: false },
        { role_id: 'r1', module_id: 'm1', can_view: true, can_create: false, can_update: false, can_delete: false },
        { role_id: 'r2', module_id: 'm1', can_view: true, can_create: true, can_update: false, can_delete: false },
        { role_id: 'r2', module_id: 'm2', can_view: true, can_create: false, can_update: false, can_delete: false },
      ],
      staff_users: [
        { id: 's0', email: 'super@afhomes.test', full_name: 'Super Admin', status: 'active' },
        { id: 's1', email: 'admin@afhomes.test', full_name: 'Ops Admin', status: 'active' },
        { id: 's2', email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
        { id: 's3', email: 'fin@afhomes.test', full_name: 'Fin Officer', status: 'active' },
      ],
      staff_role_assignments: [
        { staff_id: 's0', role_id: 'r0' },
        { staff_id: 's1', role_id: 'r1' },
        { staff_id: 's2', role_id: 'r2' },
        { staff_id: 's3', role_id: 'r3' },
      ],
      staff_permission_restrictions: [],
      redemption_items: [
        {
          id: TEPPANYAKI,
          code: 'TEPPANYAKI',
          name: 'Japanese Teppanyaki',
          description: 'Dinner for two',
          category: 'dining',
          points_cost: 2000,
          is_active: true,
          sort_order: 10,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
        {
          id: RETIRED,
          code: 'RETIRED',
          name: 'Retired Voucher',
          description: null,
          category: 'general',
          points_cost: 100,
          is_active: false,
          sort_order: 99,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      redemptions: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          redemption_number: 'RDM-000001',
          membership_id: '33333333-3333-4333-8333-333333333333',
          customer_id: '44444444-4444-4334-8444-444444444444',
          points_account_id: '55555555-5555-4555-8555-555555555555',
          redemption_item_id: TEPPANYAKI,
          item_code_snapshot: 'TEPPANYAKI',
          item_name_snapshot: 'Japanese Teppanyaki',
          points_cost_snapshot: 2000,
          quantity: 1,
          total_points: 2000,
          balance_before_snapshot: 60000,
          balance_after_snapshot: 58000,
          redeemed_by: 's2',
          redeemed_by_name: 'Em Ployee',
          status: 'completed',
          created_at: '2026-09-20T00:00:00.000Z',
          completed_at: '2026-09-20T00:00:00.000Z',
        },
      ],
      points_accounts: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          membership_id: '33333333-3333-4333-8333-333333333333',
          balance: 58000,
          lifetime_allocated: 60000,
          lifetime_redeemed: 2000,
        },
      ],
      points_ledger: [
        {
          id: '1',
          account_id: '55555555-5555-4555-8555-555555555555',
          entry_type: 'annual_allocation',
          amount: 60000,
          balance_after: 60000,
        },
        {
          id: '2',
          account_id: '55555555-5555-4555-8555-555555555555',
          entry_type: 'redemption',
          amount: -2000,
          balance_after: 58000,
        },
      ],
      audit_events: [],
    },
    tokens: {
      [TOK.superAdmin]: { id: 's0', email: 'super@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.admin]: { id: 's1', email: 'admin@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.employee]: { id: 's2', email: 'emp@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.finance]: { id: 's3', email: 'fin@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.customer]: { id: 'auth-customer-1', email: 'cust@example.com', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
    },
    unique: { redemption_items: [['code']] },
    links: [],
    rpcs: [],
    rpcErrors: {},
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(options: {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string>;
}): Promise<State> {
  const { res, state } = makeRes();
  await handler(
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
const serialised = (body: unknown) => JSON.stringify(body);

const SPA = {
  code: 'Spa-Day',
  name: 'Spa Day Pass',
  description: 'Wellness treat.',
  category: 'wellness',
  pointsCost: 25000,
  sortOrder: 5,
};

describe('catalog reads', () => {
  beforeEach(() => {
    install();
  });

  it('lists active items by default, ordered by display order', async () => {
    const state = await call({ path: 'items', token: TOK.admin });
    expect(state.status).toBe(200);
    expect(data(state.body).map((r) => r.code)).toEqual(['TEPPANYAKI']);
  });

  it('lets the employee (POS role) read the active catalog', async () => {
    const state = await call({ path: 'items', token: TOK.employee });
    expect(state.status).toBe(200);
    expect(data(state.body).map((r) => r.code)).toEqual(['TEPPANYAKI']);
  });

  it('denies the catalog to finance and customers under this matrix', async () => {
    expect((await call({ path: 'items', token: TOK.finance })).status).toBe(403);
    expect((await call({ path: 'items', token: TOK.customer })).status).toBe(403);
  });

  it('reads one item by id for management', async () => {
    const state = await call({ path: `items/${TEPPANYAKI}`, token: TOK.admin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      code: 'TEPPANYAKI',
      name: 'Japanese Teppanyaki',
      pointsCost: 2000,
      isActive: true,
    });
  });

  it('hides an inactive item id from the employee (404, not 403)', async () => {
    expect((await call({ path: `items/${RETIRED}`, token: TOK.employee })).status).toBe(404);
  });

  it('lets management read the inactive item id', async () => {
    const state = await call({ path: `items/${RETIRED}`, token: TOK.superAdmin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ code: 'RETIRED', isActive: false });
  });

  it('returns 404 for an unknown item id', async () => {
    expect(
      (await call({ path: 'items/00000000-0000-4000-8000-000000000099', token: TOK.admin })).status,
    ).toBe(404);
  });
});

describe('catalog filters', () => {
  beforeEach(() => {
    install();
  });

  it('searches by name, code and category', async () => {
    for (const [search, codes] of [
      ['tepp', ['TEPPANYAKI']],
      ['dining', ['TEPPANYAKI']],
      ['no-such-thing', []],
    ] as [string, string[]][]) {
      const state = await call({ path: 'items', token: TOK.superAdmin, query: { search } });
      expect(data(state.body).map((r) => r.code)).toEqual(codes);
    }
  });

  it('filters inactive-only and all for management', async () => {
    const inactive = await call({
      path: 'items',
      token: TOK.superAdmin,
      query: { active: 'false' },
    });
    expect(data(inactive.body).map((r) => r.code)).toEqual(['RETIRED']);
    const all = await call({ path: 'items', token: TOK.superAdmin, query: { active: 'all' } });
    expect(data(all.body).map((r) => r.code)).toEqual(['TEPPANYAKI', 'RETIRED']);
  });

  it('never leaks inactive items to the employee, even when asked', async () => {
    for (const query of [{ active: 'all' }, { includeInactive: 'true' }, { active: 'false' }] as Record<
      string,
      string
    >[]) {
      const state = await call({ path: 'items', token: TOK.employee, query });
      expect(state.status).toBe(200);
      expect(data(state.body).map((r) => r.code)).toEqual(['TEPPANYAKI']);
    }
  });

  it('keeps stable ordering by display order then name', async () => {
    await call({ method: 'POST', path: 'items', token: TOK.superAdmin, body: { ...SPA, code: 'AAA', sortOrder: 1 } });
    const state = await call({ path: 'items', token: TOK.superAdmin, query: { active: 'all' } });
    expect(data(state.body).map((r) => r.code)).toEqual(['AAA', 'TEPPANYAKI', 'RETIRED']);
  });
});

describe('catalog writes', () => {
  beforeEach(() => {
    install();
  });

  it('creates a valid item with a normalised code and audits it', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call({ method: 'POST', path: 'items', token: TOK.superAdmin, body: SPA });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      code: 'SPA-DAY',
      name: 'Spa Day Pass',
      pointsCost: 25000,
      isActive: true,
    });
    const row = db.rows('redemption_items').find((r) => r.code === 'SPA-DAY');
    expect(row).toBeDefined();
    const audits = db.rows('audit_events').filter((e) => e.action === 'REDEMPTION_ITEM_CREATED');
    expect(audits).toHaveLength(1);
    expect(serialised(audits)).not.toMatch(/token|secret|password|hash/i);
  });

  it('lets an admin create under the matrix grant', async () => {
    const state = await call({ method: 'POST', path: 'items', token: TOK.admin, body: SPA });
    expect(state.status).toBe(201);
  });

  it('rejects a duplicate code with 409', async () => {
    const state = await call({
      method: 'POST',
      path: 'items',
      token: TOK.superAdmin,
      body: { ...SPA, code: 'teppanyaki', name: 'Clone' },
    });
    expect(state.status).toBe(409);
  });

  it.each([
    ['blank name', { ...SPA, code: 'OK-1', name: '  ' }],
    ['blank code', { ...SPA, code: '   ', name: 'Ok' }],
    ['zero points', { ...SPA, code: 'OK-1', pointsCost: 0 }],
    ['negative points', { ...SPA, code: 'OK-1', pointsCost: -5 }],
    ['fractional points', { ...SPA, code: 'OK-1', pointsCost: 1.5 }],
    ['bad display order', { ...SPA, code: 'OK-1', sortOrder: 1.5 }],
  ])('rejects %s with 400', async (_name, body) => {
    expect(
      (await call({ method: 'POST', path: 'items', token: TOK.superAdmin, body })).status,
    ).toBe(400);
  });

  it('denies creation to employee, finance and customers', async () => {
    for (const token of [TOK.employee, TOK.finance, TOK.customer]) {
      expect((await call({ method: 'POST', path: 'items', token, body: SPA })).status).toBe(403);
    }
  });

  it('edits fields and audits the update', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call({
      method: 'PATCH',
      path: `items/${TEPPANYAKI}`,
      token: TOK.superAdmin,
      body: { name: 'Teppanyaki Deluxe', pointsCost: 2500, sortOrder: 3 },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ name: 'Teppanyaki Deluxe', pointsCost: 2500, sortOrder: 3 });
    expect(
      db.rows('audit_events').some((e) => e.action === 'REDEMPTION_ITEM_UPDATED'),
    ).toBe(true);
  });

  it('denies edits without the update grant', async () => {
    for (const token of [TOK.employee, TOK.finance, TOK.customer]) {
      expect(
        (
          await call({
            method: 'PATCH',
            path: `items/${TEPPANYAKI}`,
            token,
            body: { name: 'Hacked' },
          })
        ).status,
      ).toBe(403);
    }
  });

  it('deactivates and reactivates with distinct audits', async () => {
    const db = holder.db as FakeSupabase;
    const off = await call({
      method: 'PATCH',
      path: `items/${TEPPANYAKI}`,
      token: TOK.superAdmin,
      body: { isActive: false },
    });
    expect(off.status).toBe(200);
    expect(
      db.rows('audit_events').some((e) => e.action === 'REDEMPTION_ITEM_DEACTIVATED'),
    ).toBe(true);
    const on = await call({
      method: 'PATCH',
      path: `items/${TEPPANYAKI}`,
      token: TOK.superAdmin,
      body: { isActive: true },
    });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ isActive: true });
    expect(
      db.rows('audit_events').some((e) => e.action === 'REDEMPTION_ITEM_ACTIVATED'),
    ).toBe(true);
    const list = await call({ path: 'items', token: TOK.employee });
    expect(data(list.body).map((r) => r.code)).toContain('TEPPANYAKI');
  });

  it('exposes no DELETE route', async () => {
    expect(
      (await call({ method: 'DELETE', path: `items/${TEPPANYAKI}`, token: TOK.superAdmin })).status,
    ).toBe(404);
    expect((holder.db as FakeSupabase).rows('redemption_items')).toHaveLength(2);
  });
});

describe('catalog CRUD moves no points and rewrites no history', () => {
  beforeEach(() => {
    install();
  });

  it('leaves accounts, ledger and redemptions byte-identical', async () => {
    const db = holder.db as FakeSupabase;
    const snap = {
      account: JSON.stringify(db.rows('points_accounts')),
      ledger: JSON.stringify(db.rows('points_ledger')),
      redemptions: JSON.stringify(db.rows('redemptions')),
    };
    await call({ method: 'POST', path: 'items', token: TOK.superAdmin, body: SPA });
    await call({
      method: 'PATCH',
      path: `items/${TEPPANYAKI}`,
      token: TOK.superAdmin,
      body: { pointsCost: 2500, name: 'Teppanyaki Deluxe' },
    });
    await call({
      method: 'PATCH',
      path: `items/${TEPPANYAKI}`,
      token: TOK.superAdmin,
      body: { isActive: false },
    });
    await call({
      method: 'PATCH',
      path: `items/${TEPPANYAKI}`,
      token: TOK.superAdmin,
      body: { isActive: true },
    });
    expect(JSON.stringify(db.rows('points_accounts'))).toBe(snap.account);
    expect(JSON.stringify(db.rows('points_ledger'))).toBe(snap.ledger);
    expect(JSON.stringify(db.rows('redemptions'))).toBe(snap.redemptions);
    const redemption = db.rows('redemptions')[0]!;
    expect(redemption.item_code_snapshot).toBe('TEPPANYAKI');
    expect(redemption.item_name_snapshot).toBe('Japanese Teppanyaki');
    expect(redemption.points_cost_snapshot).toBe(2000);
  });
});
