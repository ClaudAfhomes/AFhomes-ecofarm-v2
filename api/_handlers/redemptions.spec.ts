/**
 * AF Homes staff redemption - handler tests.
 *
 * These drive the REAL handler, the REAL staff principal resolver, the REAL
 * contracts and the REAL identifier resolution against the in-memory Supabase
 * fake. What they are really asserting is that the client cannot influence the
 * money: no price, no balance, no status, no staff identity, and no way to reach
 * the redemption function without a staff session that holds the permission.
 */
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const redemptions = (await import('./redemptions.js')).default;
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF_ID = '11111111-1111-4111-8111-111111111112';
const SUSPENDED_STAFF_ID = '11111111-1111-4111-8111-111111111113';
const TOKEN = 'staff-token';
const OTHER_TOKEN = 'other-staff-token';
const SUSPENDED_TOKEN = 'suspended-staff-token';
/** A customer Auth session. Has a `customers` row but NO `staff_users` row. */
const CUSTOMER_TOKEN = 'customer-token';
const CUSTOMER_AUTH_ID = '99999999-9999-4999-8999-999999999999';

const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222299';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CUSTOMER_ID = '33333333-3333-4333-8333-333333333399';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const RETIRED_ITEM_ID = '55555555-5555-4555-8555-555555555599';

/**
 * A QR token is base64, so it is CASE-SENSITIVE. The fixture deliberately mixes
 * cases: an all-lowercase token would make a "does not case-fold" assertion pass
 * for the wrong reason.
 */
const QR_TOKEN = 'OpAqUeQrToKeN-vALue-aAaAaAaAaAaAa';
const FALLBACK_CODE = 'AFH-1A2B-3C4D';

const PERMISSIONS_ALL = [
  { moduleKey: 'operations.redemption', canView: true, canCreate: true, canUpdate: true, canDelete: true },
  { moduleKey: 'operations.catalog', canView: true, canCreate: true, canUpdate: true, canDelete: true },
];

/** Holds view only: may open the screen and resolve, but may NOT redeem. */
const PERMISSIONS_VIEW_ONLY = [
  { moduleKey: 'operations.redemption', canView: true, canCreate: false, canUpdate: false, canDelete: false },
  { moduleKey: 'operations.catalog', canView: true, canCreate: false, canUpdate: false, canDelete: false },
];

/** No redemption permission at all. */
const PERMISSIONS_NONE: unknown[] = [];

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

type Row = Record<string, unknown>;

function baseTables(): Record<string, Row[]> {
  return {
    modules: [
      { id: 'm1', key: 'operations.redemption', is_active: true },
      { id: 'm2', key: 'operations.catalog', is_active: true },
    ],
    roles: [
      { id: 'r1', slug: 'finance', name: 'Finance', is_active: true },
      { id: 'r2', slug: 'employee', name: 'Employee', is_active: true },
    ],
    role_permissions: [
      { role_id: 'r1', module_id: 'm1', can_view: true, can_create: true, can_update: true, can_delete: true },
      { role_id: 'r1', module_id: 'm2', can_view: true, can_create: true, can_update: true, can_delete: true },
      { role_id: 'r2', module_id: 'm1', can_view: true, can_create: false, can_update: false, can_delete: false },
      { role_id: 'r2', module_id: 'm2', can_view: true, can_create: false, can_update: false, can_delete: false },
    ],
    staff_users: [
      { id: STAFF_ID, email: 'finance@afhomes.test', full_name: 'Fin Staffer', status: 'active' },
      { id: OTHER_STAFF_ID, email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
      { id: SUSPENDED_STAFF_ID, email: 'susp@afhomes.test', full_name: 'Sus Pended', status: 'suspended' },
    ],
    staff_role_assignments: [
      { staff_id: STAFF_ID, role_id: 'r1' },
      { staff_id: OTHER_STAFF_ID, role_id: 'r2' },
      { staff_id: SUSPENDED_STAFF_ID, role_id: 'r1' },
    ],
    staff_permission_restrictions: [],
    customers: [
      {
        id: CUSTOMER_ID,
        customer_number: 'CUS-000777',
        first_name: 'Ana',
        middle_name: 'R',
        last_name: 'Buyer',
        suffix: null,
        email: 'ana@example.invalid',
        phone: '09185550000',
        status: 'active',
        government_id_number: '7788-9900-1122',
        auth_user_id: CUSTOMER_AUTH_ID,
        created_at: ago(500),
        updated_at: ago(100),
        card_plans: { name: 'Gold' },
        memberships: [{ id: MEMBERSHIP_ID, status: 'active' }],
      },
      {
        id: OTHER_CUSTOMER_ID,
        customer_number: 'CUS-000888',
        first_name: 'Other',
        middle_name: null,
        last_name: 'Person',
        suffix: null,
        email: 'other@example.invalid',
        phone: '09185550001',
        status: 'active',
        government_id_number: '9999-8888-7777',
        auth_user_id: null,
        created_at: ago(400),
        updated_at: ago(200),
        card_plans: { name: 'Bronze' },
        memberships: [{ id: OTHER_MEMBERSHIP_ID, status: 'active' }],
      },
    ],
    memberships: [
      {
        id: MEMBERSHIP_ID,
        customer_id: CUSTOMER_ID,
        sale_id: '66666666-6666-4666-8666-666666666666',
        membership_number: 'MBS-000777',
        product_id: '77777777-7777-4777-8777-777777777777',
        status: 'active',
        points_balance: 60000,
        yearly_points_allocated: 60000,
        fallback_code_hash: hash(FALLBACK_CODE),
        qr_token_hash: hash(QR_TOKEN),
        activated_at: ago(100),
        expires_at: ahead(24 * 300),
        renewal_due_at: ahead(24 * 300),
        issued_at: ago(100),
        created_at: ago(100),
      },
      {
        id: OTHER_MEMBERSHIP_ID,
        customer_id: OTHER_CUSTOMER_ID,
        sale_id: '66666666-6666-4666-8666-666666666699',
        membership_number: 'MBS-000888',
        product_id: '77777777-7777-4777-8777-777777777777',
        status: 'active',
        points_balance: 25000,
        yearly_points_allocated: 25000,
        fallback_code_hash: hash('AFH-FFFF-FFFF'),
        qr_token_hash: hash('some-other-qr-token'),
        activated_at: ago(200),
        expires_at: ahead(24 * 200),
        renewal_due_at: ahead(24 * 200),
        issued_at: ago(200),
        created_at: ago(200),
      },
    ],
    // A REAL relation, not a pre-baked property on the membership row. These
    // rows used to carry `card_plans: { name: 'Gold' }` inline, which meant the
    // `card_plans!inner(name)` embed in SELECT_MEMBERSHIP resolved NOTHING and
    // the handler read the fixture's own copy instead. Every assertion about
    // productName was therefore green without the join ever running.
    card_plans: [
      { id: '77777777-7777-4777-8777-777777777777', code: 'GOLD', name: 'Gold', tier: 'GOLD' },
    ],
    points_accounts: [
      { id: ACCOUNT_ID, membership_id: MEMBERSHIP_ID, balance: 60000, lifetime_allocated: 60000, lifetime_redeemed: 0 },
    ],
    points_ledger: [
      {
        id: '1',
        account_id: ACCOUNT_ID,
        entry_type: 'annual_allocation',
        amount: 60000,
        balance_after: 60000,
        reference_type: 'membership',
        reference_id: MEMBERSHIP_ID,
        actor_id: STAFF_ID,
        reason: 'Annual points allocation on activation',
        created_at: ago(100),
      },
    ],
    redemption_items: [
      {
        id: ITEM_ID,
        code: 'TEPPANYAKI',
        name: 'Japanese Teppanyaki',
        description: 'Dinner for two',
        category: 'dining',
        points_cost: 2000,
        is_active: true,
        sort_order: 10,
        created_at: ago(300),
        updated_at: ago(300),
      },
      {
        id: RETIRED_ITEM_ID,
        code: 'RETIRED',
        name: 'Retired Voucher',
        description: null,
        category: 'general',
        points_cost: 100,
        is_active: false,
        sort_order: 99,
        created_at: ago(300),
        updated_at: ago(300),
      },
    ],
    redemptions: [],
    audit_events: [],
  };
}

type Setup = {
  tables?: Record<string, Row[]>;
  tokens?: Record<string, { id: string; email: string; email_confirmed_at: string }>;
  permissions?: unknown[];
  roleSlug?: string;
  rpcErrors?: Record<string, { code?: string; message: string }>;
  redeemImpl?: (args: Record<string, unknown>) => unknown;
  noStaffRecord?: string[];
};

function install(options: Setup = {}) {
  resetIdentifierRateLimit();
  const permissions = options.permissions ?? PERMISSIONS_ALL;
  const roleId = options.roleSlug === 'employee' ? 'r2' : 'r1';
  const db = new FakeSupabase({
    tables: (options.tables ?? baseTables()) as never,
    tokens: {
      [TOKEN]: { id: STAFF_ID, email: 'finance@afhomes.test', email_confirmed_at: ago(200) },
      [OTHER_TOKEN]: { id: OTHER_STAFF_ID, email: 'emp@afhomes.test', email_confirmed_at: ago(200) },
      [SUSPENDED_TOKEN]: {
        id: SUSPENDED_STAFF_ID,
        email: 'susp@afhomes.test',
        email_confirmed_at: ago(200),
      },
      [CUSTOMER_TOKEN]: {
        id: CUSTOMER_AUTH_ID,
        email: 'ana@example.invalid',
        email_confirmed_at: ago(200),
      },
      ...options.tokens,
    },
    rpcErrors: options.rpcErrors,
    unique: { redemption_items: [['code']] },
    links: [
      { child: 'staff_role_assignments', parent: 'roles', fk: 'role_id' },
      { child: 'memberships', parent: 'customers', fk: 'customer_id' },
      { child: 'memberships', parent: 'card_plans', fk: 'product_id' },
      { child: 'points_accounts', parent: 'memberships', fk: 'membership_id' },
      { child: 'redemptions', parent: 'customers', fk: 'customer_id' },
      { child: 'redemptions', parent: 'memberships', fk: 'membership_id' },
    ],
  });
  if (roleId === 'r2') {
    // The employee role genuinely has fewer grants; make the resolver see that.
    (db as unknown as { permissions: unknown[] }).permissions = permissions;
  }
  // The resolver reads permissions from the tables, so scripting the role grants
  // is what actually varies. `permissions` is applied by rewriting role_permissions.
  if (options.permissions) {
    const grants = (options.permissions as { moduleKey: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[]).map(
      (p) => ({
        role_id: roleId,
        module_id: p.moduleKey === 'operations.redemption' ? 'm1' : 'm2',
        can_view: p.canView,
        can_create: p.canCreate,
        can_update: p.canUpdate,
        can_delete: p.canDelete,
      }),
    );
    db.rows('role_permissions').splice(0, db.rows('role_permissions').length, ...grants);
  }
  if (options.noStaffRecord) {
    for (const id of options.noStaffRecord) {
      db.rows('staff_users').splice(
        db.rows('staff_users').findIndex((r) => r.id === id),
        1,
      );
    }
  }

  // Emulate `redeem_membership_points` faithfully enough to test the handler's
  // contract: it re-reads the price, refuses an inactive item, refuses an
  // insufficient balance, and is idempotent per (actor, key).
  const base = db.rpc.bind(db);
  db.rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    // The base implementation records the call; the override must too, or a
    // test asserting on the exact RPC arguments would silently find nothing.
    db.calls.push({ op: 'rpc', table: fn, arg: args });
    if (fn !== 'redeem_membership_points') return base(fn, args);
    if (options.redeemImpl) return { data: options.redeemImpl(args), error: null };
    if (options.rpcErrors?.[fn]) return { data: null, error: { ...options.rpcErrors[fn] } };

    const key = String(args.p_idempotency_key);
    const actor = String(args.p_actor_id);
    const existing = db
      .rows('redemptions')
      .find((r) => r.redeemed_by === actor && r.idempotency_key === key);
    if (existing) {
      return {
        data: [
          {
            redemption_id: existing.id,
            redemption_number: existing.redemption_number,
            item_code: existing.item_code_snapshot,
            item_name: existing.item_name_snapshot,
            unit_points: existing.points_cost_snapshot,
            quantity: existing.quantity,
            total_points: existing.total_points,
            balance_before: existing.balance_before_snapshot,
            balance_after: existing.balance_after_snapshot,
            customer_name: 'Ana R Buyer',
            membership_number: 'MBS-000777',
            completed_at: existing.completed_at,
          },
        ],
        error: null,
      };
    }
    const item = db.rows('redemption_items').find((r) => r.id === args.p_redemption_item_id);
    if (!item) return { data: null, error: { message: 'REDEMPTION_ITEM_NOT_FOUND' } };
    if (item.is_active !== true) {
      return { data: null, error: { message: `REDEMPTION_ITEM_INACTIVE:${item.code}` } };
    }
    const membership = db.rows('memberships').find((r) => r.id === args.p_membership_id);
    if (!membership) return { data: null, error: { message: 'MEMBERSHIP_NOT_FOUND' } };
    const customer = db.rows('customers').find((r) => r.id === membership.customer_id);
    if (customer?.status !== 'active') {
      return { data: null, error: { message: `CUSTOMER_NOT_ACTIVE:${customer?.status}` } };
    }
    if (membership.status !== 'active') {
      return { data: null, error: { message: `MEMBERSHIP_NOT_ACTIVE:${membership.status}` } };
    }
    if (new Date(String(membership.expires_at)).valueOf() <= Date.now()) {
      return { data: null, error: { message: 'MEMBERSHIP_EXPIRED' } };
    }
    const account = db.rows('points_accounts').find((r) => r.membership_id === membership.id)!;
    const total = Number(item.points_cost) * Number(args.p_quantity ?? 1);
    if (Number(account.balance) < total) {
      return { data: null, error: { message: `INSUFFICIENT_POINTS:need ${total}` } };
    }
    const before = Number(account.balance);
    const after = before - total;
    const row: Row = {
      id: '88888888-8888-4888-8888-888888888888',
      redemption_number: 'RDM-000001',
      membership_id: membership.id,
      customer_id: customer.id,
      points_account_id: account.id,
      redemption_item_id: item.id,
      item_code_snapshot: item.code,
      item_name_snapshot: item.name,
      points_cost_snapshot: Number(item.points_cost),
      quantity: Number(args.p_quantity ?? 1),
      total_points: total,
      balance_before_snapshot: before,
      balance_after_snapshot: after,
      redeemed_by: actor,
      redeemed_by_name: 'Fin Staffer',
      status: 'completed',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      voided_at: null,
      void_reason: null,
      idempotency_key: key,
    };
    db.rows('redemptions').push(row);
    db.rows('points_ledger').push({
      id: String(db.rows('points_ledger').length + 1),
      account_id: account.id,
      entry_type: 'redemption',
      amount: -total,
      balance_after: after,
      reference_type: 'redemption',
      reference_id: row.id,
      actor_id: actor,
      reason: `Redeemed ${item.name} (${item.code})`,
      created_at: new Date().toISOString(),
    });
    account.balance = after;
    account.lifetime_redeemed = Number(account.lifetime_redeemed ?? 0) + total;
    membership.points_balance = after;
    db.rows('audit_events').push({
      actor_id: actor,
      action: 'REDEMPTION_COMPLETED',
      entity_type: 'redemption',
      entity_id: row.id,
      after_data: { totalPoints: total },
    });
    return {
      data: [
        {
          redemption_id: row.id,
          redemption_number: row.redemption_number,
          item_code: row.item_code_snapshot,
          item_name: row.item_name_snapshot,
          unit_points: row.points_cost_snapshot,
          quantity: row.quantity,
          total_points: total,
          balance_before: before,
          balance_after: after,
          customer_name: 'Ana R Buyer',
          membership_number: 'MBS-000777',
          completed_at: row.completed_at,
        },
      ],
      error: null,
    };
  };

  holder.db = db;
  return db;
}

type State = { status: number; body: unknown };

async function call(
  options: {
    familyPath?: string;
    method?: string;
    body?: unknown;
    token?: string | null;
    query?: Record<string, string>;
  } = {},
): Promise<State> {
  const { res, state } = makeRes();
  await redemptions(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.familyPath ?? '',
      body: options.body,
      ...(options.token === null ? {} : { token: options.token ?? TOKEN }),
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const body = (s: State) => s.body as Record<string, unknown>;
const errCode = (s: State) => (s.body as { error?: { code?: string; message?: string } }).error?.code;
const errMsg = (s: State) => (s.body as { error?: { message?: string } }).error?.message;

const VALID_REQUEST = {
  membershipId: MEMBERSHIP_ID,
  redemptionItemId: ITEM_ID,
  quantity: 1,
  clientTransactionId: 'pos-terminal-7-000001',
};

/* ================================================================== */
/* Identifier resolution                                                */
/* ================================================================== */

describe('redemption identifier resolution', () => {
  beforeEach(() => install());

  it('resolves a valid QR token to a safe preview', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      membershipId: MEMBERSHIP_ID,
      membershipNumber: 'MBS-000777',
      customerDisplayName: 'Ana R Buyer',
      productName: 'Gold',
      membershipStatus: 'active',
      expired: false,
      redeemable: true,
      pointsBalance: 60000,
      matchedBy: 'qr',
    });
  });

  it('resolves a valid fallback code to the same preview', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: FALLBACK_CODE } });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ membershipId: MEMBERSHIP_ID, matchedBy: 'fallback_code' });
  });

  it('normalises the fallback code by case and separator', async () => {
    for (const variant of ['afh-1a2b-3c4d', 'AFH1A2B3C4D', '  AFH-1A2B-3C4D  ']) {
      const s = await call({ familyPath: 'resolve', query: { identifier: variant } });
      expect(s.status, variant).toBe(200);
      expect(body(s).membershipId, variant).toBe(MEMBERSHIP_ID);
    }
  });

  it('does NOT case-fold a QR token, which is base64 and case-sensitive', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN.toLowerCase() } });
    expect(s.status).toBe(404);
  });

  it('refuses an unknown identifier without saying why', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: 'AFH-0000-0000' } });
    expect(s.status).toBe(404);
    expect(errMsg(s)).toMatch(/no membership matches/i);
  });

  it('refuses a rotated-out identifier, because its hash was replaced', async () => {
    const db = install();
    const membership = db.rows('memberships').find((r) => r.id === MEMBERSHIP_ID)!;
    membership.qr_token_hash = hash('a-brand-new-qr-token');
    membership.fallback_code_hash = hash('AFH-9999-9999');
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(s.status).toBe(404);
  });

  it('reports an inactive membership as blocked rather than refusing to resolve', async () => {
    const db = install();
    db.rows('memberships').find((r) => r.id === MEMBERSHIP_ID)!.status = 'suspended';
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(s.status).toBe(200);
    expect(body(s).redeemable).toBe(false);
    expect(String(body(s).blockedReason)).toMatch(/suspended/i);
  });

  it('reports a suspended customer as blocked', async () => {
    const db = install();
    db.rows('customers').find((r) => r.id === CUSTOMER_ID)!.status = 'suspended';
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(body(s).redeemable).toBe(false);
    expect(String(body(s).blockedReason)).toMatch(/suspended/i);
  });

  it('reports an expired membership as blocked', async () => {
    const db = install();
    db.rows('memberships').find((r) => r.id === MEMBERSHIP_ID)!.expires_at = ago(1);
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(body(s).expired).toBe(true);
    expect(body(s).redeemable).toBe(false);
  });

  it('reads the AUTHORITATIVE balance, not the membership cache', async () => {
    const db = install();
    db.rows('memberships').find((r) => r.id === MEMBERSHIP_ID)!.points_balance = 1;
    db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance = 60000;
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(body(s).pointsBalance).toBe(60000);
  });

  it('never returns customer PII', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain('7788-9900-1122');
    expect(serialised).not.toContain('09185550000');
    expect(serialised).not.toContain('CUS-000777');
    expect(serialised).not.toContain('ana@example.invalid');
    for (const forbidden of [
      'governmentId',
      'government_id',
      'address',
      'dateOfBirth',
      'birth_date',
      'commission',
      'seller',
      'authUserId',
      'customerId',
    ]) {
      expect(body(s), forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('never echoes the identifier it was given', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(JSON.stringify(s.body)).not.toContain(QR_TOKEN);
    expect(JSON.stringify(s.body)).not.toContain(FALLBACK_CODE);
    expect(JSON.stringify(s.body)).not.toContain(hash(QR_TOKEN));
  });

  it('never returns a stored credential hash', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain(hash(QR_TOKEN));
    expect(serialised).not.toContain(hash(FALLBACK_CODE));
  });

  it('rejects a missing identifier', async () => {
    expect((await call({ familyPath: 'resolve', query: {} })).status).toBe(400);
  });

  it('rate-limits a hammering session', async () => {
    let last: State = { status: 200, body: {} };
    for (let i = 0; i < 40; i += 1) {
      last = await call({ familyPath: 'resolve', query: { identifier: 'AFH-0000-0000' } });
    }
    expect(last.status).toBe(429);
    expect(errCode(last)).toBe('RATE_LIMITED');
  });

  it('a different staff member is not locked out by a colleague hammering', async () => {
    // The limiter is keyed by staff AND address, so one bad session cannot
    // exhaust a colleague's budget at a busy till.
    for (let i = 0; i < 40; i += 1) {
      await call({ familyPath: 'resolve', query: { identifier: 'AFH-0000-0000' } });
    }
    const other = await call({
      familyPath: 'resolve',
      query: { identifier: FALLBACK_CODE },
      token: OTHER_TOKEN,
    });
    expect(other.status).toBe(200);
  });
});

/* ================================================================== */
/* Staff authorization                                                  */
/* ================================================================== */

describe('redemption staff authorization', () => {
  beforeEach(() => install());

  it('refuses an unauthenticated caller', async () => {
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN }, token: null });
    expect(s.status).toBe(401);
  });

  it('refuses a CUSTOMER session, which has no staff record', async () => {
    const s = await call({
      familyPath: 'resolve',
      query: { identifier: QR_TOKEN },
      token: CUSTOMER_TOKEN,
    });
    expect(s.status).toBe(403);
    expect(errMsg(s)).toMatch(/staff access required/i);
  });

  it('refuses a suspended employee', async () => {
    const s = await call({
      familyPath: 'resolve',
      query: { identifier: QR_TOKEN },
      token: SUSPENDED_TOKEN,
    });
    expect(s.status).toBe(403);
    expect(errMsg(s)).toMatch(/not active/i);
  });

  it('lets a permissioned employee resolve a member', async () => {
    expect((await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } })).status).toBe(200);
  });

  it('refuses a redemption attempt by a staff member without the create permission', async () => {
    install({ permissions: PERMISSIONS_VIEW_ONLY, roleSlug: 'employee' });
    const s = await call({ method: 'POST', body: VALID_REQUEST, token: OTHER_TOKEN });
    expect(s.status).toBe(403);
    expect(errMsg(s)).toMatch(/insufficient permission/i);
  });

  it('refuses a redemption attempt with no redemption permission at all', async () => {
    install({ permissions: PERMISSIONS_NONE, roleSlug: 'employee' });
    expect((await call({ method: 'POST', body: VALID_REQUEST, token: OTHER_TOKEN })).status).toBe(403);
  });

  it('honours a deny-only restriction on an otherwise-permissioned employee', async () => {
    install();
    const db = holder.db as FakeSupabase;
    db.rows('staff_permission_restrictions').push({
      staff_id: STAFF_ID,
      module_id: 'm1',
      deny_view: true,
      deny_create: true,
      deny_update: false,
      deny_delete: false,
    });
    const resolve = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(resolve.status).toBe(403);
    const redeem = await call({ method: 'POST', body: VALID_REQUEST });
    expect(redeem.status).toBe(403);
  });

  it('refuses catalog maintenance without the catalog permission', async () => {
    install({ permissions: PERMISSIONS_VIEW_ONLY, roleSlug: 'employee' });
    const s = await call({
      method: 'POST',
      familyPath: 'items',
      token: OTHER_TOKEN,
      body: { code: 'NEW-1', name: 'New Item', pointsCost: 100 },
    });
    expect(s.status).toBe(403);
  });

  it('takes the acting staff identity from the session, never the body', async () => {
    const db = install();
    const s = await call({
      method: 'POST',
      body: {
        ...VALID_REQUEST,
        // Every one of these is ignored: the contract has no such field.
        redeemedBy: OTHER_STAFF_ID,
        redeemedById: OTHER_STAFF_ID,
        staffId: OTHER_STAFF_ID,
        actorId: OTHER_STAFF_ID,
      },
    });
    expect(s.status).toBe(201);
    const row = db.rows('redemptions')[0]!;
    expect(row.redeemed_by).toBe(STAFF_ID);
    const rpcCall = db.calls.find((c) => c.op === 'rpc')!;
    expect((rpcCall.arg as Record<string, unknown>).p_actor_id).toBe(STAFF_ID);
  });
});

/* ================================================================== */
/* Creating a redemption                                                */
/* ================================================================== */

describe('creating a redemption', () => {
  beforeEach(() => install());

  it('succeeds and returns a receipt', async () => {
    const s = await call({ method: 'POST', body: VALID_REQUEST });
    expect(s.status).toBe(201);
    expect(body(s)).toMatchObject({
      redemptionNumber: 'RDM-000001',
      membershipNumber: 'MBS-000777',
      customerDisplayName: 'Ana R Buyer',
      itemCode: 'TEPPANYAKI',
      itemName: 'Japanese Teppanyaki',
      unitPoints: 2000,
      quantity: 1,
      totalPoints: 2000,
      balanceBefore: 60000,
      balanceAfter: 58000,
      redeemedByName: 'Fin Staffer',
      replayed: false,
    });
  });

  it('sends the reference through as the de-duplication key', async () => {
    const db = install();
    await call({ method: 'POST', body: VALID_REQUEST });
    const rpcCall = db.calls.find((c) => c.op === 'rpc')!;
    expect((rpcCall.arg as Record<string, unknown>).p_idempotency_key).toBe(
      'pos-terminal-7-000001',
    );
  });

  it('never accepts a client-supplied price, balance, status or item name', async () => {
    const db = install();
    const s = await call({
      method: 'POST',
      body: {
        ...VALID_REQUEST,
        pointsCost: 1,
        totalPoints: 1,
        balance: 999999,
        balanceAfter: 999999,
        status: 'voided',
        itemName: 'Free Lunch',
        itemCode: 'FREE',
        customerId: OTHER_CUSTOMER_ID,
        productName: 'Platinum',
      },
    });
    expect(s.status).toBe(201);
    // The receipt reflects the DATABASE price, not the injected one.
    expect(body(s).unitPoints).toBe(2000);
    expect(body(s).totalPoints).toBe(2000);
    expect(body(s).itemName).toBe('Japanese Teppanyaki');
    expect(body(s).balanceAfter).toBe(58000);
    const rpcCall = db.calls.find((c) => c.op === 'rpc')!;
    const args = rpcCall.arg as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      'p_actor_id',
      'p_idempotency_key',
      'p_membership_id',
      'p_quantity',
      'p_redemption_item_id',
    ]);
  });

  it('refuses an inactive catalog item', async () => {
    const s = await call({
      method: 'POST',
      body: { ...VALID_REQUEST, redemptionItemId: RETIRED_ITEM_ID, clientTransactionId: 'ref-000001' },
    });
    expect(s.status).toBe(409);
    expect(errMsg(s)).toMatch(/no longer available/i);
  });

  it('refuses an insufficient balance with a business-safe message', async () => {
    const db = install();
    db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance = 1500;
    const s = await call({ method: 'POST', body: VALID_REQUEST });
    expect(s.status).toBe(409);
    expect(errMsg(s)).toMatch(/does not have enough points/i);
    expect(db.rows('redemptions')).toHaveLength(0);
    expect(db.rows('points_ledger')).toHaveLength(1);
  });

  it('does not leak the balance in an insufficient-points refusal', async () => {
    const db = install();
    db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance = 1500;
    const s = await call({ method: 'POST', body: VALID_REQUEST });
    expect(JSON.stringify(s.body)).not.toContain('1500');
  });

  it('writes exactly one negative ledger entry', async () => {
    const db = install();
    await call({ method: 'POST', body: VALID_REQUEST });
    const debits = db.rows('points_ledger').filter((r) => r.entry_type === 'redemption');
    expect(debits).toHaveLength(1);
    expect(Number(debits[0]!.amount)).toBe(-2000);
    expect(Number(debits[0]!.balance_after)).toBe(58000);
    expect(debits[0]!.reference_type).toBe('redemption');
  });

  it('a retry with the same reference does not deduct twice', async () => {
    const db = install();
    const first = await call({ method: 'POST', body: VALID_REQUEST });
    const second = await call({ method: 'POST', body: VALID_REQUEST });
    expect(second.status).toBe(201);
    expect(body(second).redemptionNumber).toBe(body(first).redemptionNumber);
    expect(db.rows('redemptions')).toHaveLength(1);
    expect(db.rows('points_ledger').filter((r) => r.entry_type === 'redemption')).toHaveLength(1);
    expect(Number(db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance)).toBe(58000);
  });

  it('marks an identical retry as replayed', async () => {
    install();
    await call({ method: 'POST', body: VALID_REQUEST });
    const second = await call({ method: 'POST', body: VALID_REQUEST });
    expect(body(second).replayed).toBe(true);
  });

  it('a different reference is a genuinely new redemption', async () => {
    const db = install();
    await call({ method: 'POST', body: VALID_REQUEST });
    await call({ method: 'POST', body: { ...VALID_REQUEST, clientTransactionId: 'pos-7-000002' } });
    expect(db.rows('redemptions')).toHaveLength(2);
    expect(Number(db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance)).toBe(56000);
  });

  it('multiplies quantity by the catalog price and nothing else', async () => {
    const s = await call({ method: 'POST', body: { ...VALID_REQUEST, quantity: 3 } });
    expect(body(s).totalPoints).toBe(6000);
    expect(body(s).balanceAfter).toBe(54000);
  });

  it.each([0, -1, 100, 1.5])('refuses quantity %s', async (quantity) => {
    const s = await call({ method: 'POST', body: { ...VALID_REQUEST, quantity } });
    expect(s.status).toBe(400);
  });

  it.each(['', 'short', 'has spaces', 'semi;colon'])(
    'refuses a de-duplication reference of %s',
    async (clientTransactionId) => {
      const s = await call({ method: 'POST', body: { ...VALID_REQUEST, clientTransactionId } });
      expect(s.status).toBe(400);
    },
  );

  it('refuses a non-uuid membership or item', async () => {
    expect(
      (await call({ method: 'POST', body: { ...VALID_REQUEST, membershipId: 'nope' } })).status,
    ).toBe(400);
    expect(
      (await call({ method: 'POST', body: { ...VALID_REQUEST, redemptionItemId: 'nope' } })).status,
    ).toBe(400);
  });

  it('refuses any other verb on the collection', async () => {
    for (const verb of ['PUT', 'PATCH', 'DELETE']) {
      expect((await call({ method: verb, body: VALID_REQUEST })).status, verb).toBe(404);
    }
  });
});

/* ================================================================== */
/* Catalog management                                                   */
/* ================================================================== */

describe('redemption catalog management', () => {
  beforeEach(() => install());

  it('lists only active items by default', async () => {
    const s = await call({ familyPath: 'items' });
    expect(s.status).toBe(200);
    const rows = (s.body as { data: Row[] }).data;
    expect(rows.map((r) => r.code)).toEqual(['TEPPANYAKI']);
  });

  it('includes inactive items on request', async () => {
    const s = await call({ familyPath: 'items', query: { includeInactive: 'true' } });
    expect((s.body as { data: Row[] }).data).toHaveLength(2);
  });

  it('creates an item and audits it', async () => {
    const db = install();
    const s = await call({
      method: 'POST',
      familyPath: 'items',
      body: { code: 'spa-day', name: 'Spa Day Pass', pointsCost: 25000, category: 'wellness' },
    });
    expect(s.status).toBe(201);
    expect(body(s)).toMatchObject({ code: 'SPA-DAY', name: 'Spa Day Pass', pointsCost: 25000 });
    const actions = db.rows('audit_events').map((r) => r.action);
    expect(actions).toContain('REDEMPTION_ITEM_CREATED');
  });

  it('rejects a duplicate code as a conflict', async () => {
    install();
    const s = await call({
      method: 'POST',
      familyPath: 'items',
      body: { code: 'TEPPANYAKI', name: 'Clone', pointsCost: 10 },
    });
    expect(s.status).toBe(409);
  });

  it.each([
    { code: '', name: 'X', pointsCost: 10 },
    { code: 'OK-1', name: '', pointsCost: 10 },
    { code: 'OK-1', name: 'X', pointsCost: 0 },
    { code: 'OK-1', name: 'X', pointsCost: -5 },
    { code: 'OK-1', name: 'X', pointsCost: 1.5 },
    { code: 'has spaces', name: 'X', pointsCost: 10 },
  ])('rejects an invalid create body %j', async (payload) => {
    install();
    expect((await call({ method: 'POST', familyPath: 'items', body: payload })).status).toBe(400);
  });

  it('updates the price and audits it', async () => {
    const db = install();
    const s = await call({
      method: 'PATCH',
      familyPath: `items/${ITEM_ID}`,
      body: { pointsCost: 3500, name: 'Japanese Teppanyaki (2026)' },
    });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ pointsCost: 3500, name: 'Japanese Teppanyaki (2026)' });
    expect(db.rows('audit_events').map((r) => r.action)).toContain('REDEMPTION_ITEM_UPDATED');
  });

  it('deactivates an item and audits that specifically', async () => {
    const db = install();
    const s = await call({
      method: 'PATCH',
      familyPath: `items/${ITEM_ID}`,
      body: { isActive: false },
    });
    expect(s.status).toBe(200);
    expect(body(s).isActive).toBe(false);
    const actions = db.rows('audit_events').map((r) => r.action);
    expect(actions).toContain('REDEMPTION_ITEM_DEACTIVATED');
    expect(actions).not.toContain('REDEMPTION_ITEM_UPDATED');
  });

  it('never DELETEs an item, because history must stay resolvable', async () => {
    install();
    for (const verb of ['DELETE']) {
      expect((await call({ method: verb, familyPath: `items/${ITEM_ID}` })).status, verb).toBe(404);
    }
  });

  it('an updated price applies to new redemptions only', async () => {
    const db = install();
    await call({ method: 'POST', body: VALID_REQUEST });
    await call({
      method: 'PATCH',
      familyPath: `items/${ITEM_ID}`,
      body: { pointsCost: 3500 },
    });
    const second = await call({
      method: 'POST',
      body: { ...VALID_REQUEST, clientTransactionId: 'pos-7-000009' },
    });
    expect(body(second).unitPoints).toBe(3500);
    // The first redemption keeps its own snapshot.
    expect(Number(db.rows('redemptions')[0]!.points_cost_snapshot)).toBe(2000);
  });
});

/* ================================================================== */
/* History                                                              */
/* ================================================================== */

describe('redemption history', () => {
  beforeEach(() => {
    const db = install();
    for (let i = 0; i < 3; i += 1) {
      db.rows('redemptions').push({
        id: `88888888-8888-4888-8888-88888888888${i}`,
        redemption_number: `RDM-00000${i + 1}`,
        membership_id: i === 2 ? OTHER_MEMBERSHIP_ID : MEMBERSHIP_ID,
        customer_id: i === 2 ? OTHER_CUSTOMER_ID : CUSTOMER_ID,
        points_account_id: ACCOUNT_ID,
        redemption_item_id: ITEM_ID,
        item_code_snapshot: 'TEPPANYAKI',
        item_name_snapshot: 'Japanese Teppanyaki',
        points_cost_snapshot: 2000,
        quantity: 1,
        total_points: 2000,
        balance_before_snapshot: 60000 - i * 2000,
        balance_after_snapshot: 58000 - i * 2000,
        redeemed_by: STAFF_ID,
        redeemed_by_name: 'Fin Staffer',
        status: 'completed',
        created_at: ago(10 - i),
        completed_at: ago(10 - i),
        voided_at: null,
        void_reason: null,
        idempotency_key: `hist-${i}`,
        customers: {
          first_name: i === 2 ? 'Other' : 'Ana',
          middle_name: i === 2 ? null : 'R',
          last_name: i === 2 ? 'Person' : 'Buyer',
          suffix: null,
        },
        memberships: { membership_number: i === 2 ? 'MBS-000888' : 'MBS-000777' },
      });
    }
  });

  it('lists redemptions newest first with the snapshots', async () => {
    const s = await call();
    expect(s.status).toBe(200);
    const rows = (s.body as { data: Row[] }).data;
    expect(rows).toHaveLength(3);
    // `created_at` descends: RDM-000003 was created ago(8), the newest.
    expect(rows[0]!.redemptionNumber).toBe('RDM-000003');
    expect(rows[2]!.redemptionNumber).toBe('RDM-000001');
    const ana = rows.find((r) => r.redemptionNumber === 'RDM-000001')!;
    expect(ana).toMatchObject({
      itemNameSnapshot: 'Japanese Teppanyaki',
      pointsCostSnapshot: 2000,
      totalPoints: 2000,
      membershipNumber: 'MBS-000777',
      customerDisplayName: 'Ana R Buyer',
    });
    // The joined name and membership number come from the real relations.
    expect(rows[0]).toMatchObject({
      customerDisplayName: 'Other Person',
      membershipNumber: 'MBS-000888',
    });
  });

  it('never exposes a government ID or a credential hash', async () => {
    const s = await call();
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain('7788-9900-1122');
    expect(serialised).not.toContain('9999-8888-7777');
    expect(serialised).not.toContain(hash(QR_TOKEN));
    expect(serialised).not.toContain(hash(FALLBACK_CODE));
  });

  it('filters by status', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('redemptions')[0]!.status = 'voided';
    const s = await call({ query: { status: 'voided' } });
    expect((s.body as { data: Row[] }).data).toHaveLength(1);
  });

  it('filters by membership number, server-side', async () => {
    const s = await call({ query: { membershipNumber: 'MBS-000888' } });
    const rows = (s.body as { data: Row[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.membershipNumber).toBe('MBS-000888');
  });

  it('filters by item', async () => {
    const s = await call({ query: { itemId: ITEM_ID } });
    expect((s.body as { data: Row[] }).data).toHaveLength(3);
    const none = await call({ query: { itemId: RETIRED_ITEM_ID } });
    expect((none.body as { data: Row[] }).data).toHaveLength(0);
  });

  it('filters by date range', async () => {
    const all = await call({ query: {} });
    expect((all.body as { data: Row[] }).data).toHaveLength(3);
    const none = await call({ query: { from: ago(1) } });
    expect((none.body as { data: Row[] }).data).toHaveLength(0);
  });

  it('paginates', async () => {
    const s = await call({ query: { limit: '2', offset: '0' } });
    expect((s.body as { data: Row[] }).data).toHaveLength(2);
    const meta = (s.body as { meta: Row }).meta;
    expect(meta.total).toBe(3);
    expect(meta.limit).toBe(2);
  });

  it('requires the redemption view permission', async () => {
    install({ permissions: PERMISSIONS_NONE, roleSlug: 'employee' });
    const s = await call({ token: OTHER_TOKEN });
    expect(s.status).toBe(403);
  });
});

/* ================================================================== */
/* No void, and no NFC                                                  */
/* ================================================================== */

describe('what this phase deliberately cannot do', () => {
  beforeEach(() => install());

  it('offers no void or reversal endpoint', async () => {
    const db = install();
    db.rows('redemptions').push({
      id: '88888888-8888-4888-8888-8888888888aa',
      redemption_number: 'RDM-000010',
      membership_id: MEMBERSHIP_ID,
      customer_id: CUSTOMER_ID,
      points_account_id: ACCOUNT_ID,
      redemption_item_id: ITEM_ID,
      item_code_snapshot: 'TEPPANYAKI',
      item_name_snapshot: 'Japanese Teppanyaki',
      points_cost_snapshot: 2000,
      quantity: 1,
      total_points: 2000,
      balance_before_snapshot: 60000,
      balance_after_snapshot: 58000,
      redeemed_by: STAFF_ID,
      redeemed_by_name: 'Fin Staffer',
      status: 'completed',
      created_at: ago(1),
      completed_at: ago(1),
      voided_at: null,
      void_reason: null,
      idempotency_key: 'void-test',
      customers: { first_name: 'Ana', middle_name: 'R', last_name: 'Buyer', suffix: null },
      memberships: { membership_number: 'MBS-000777' },
    });
    const id = '88888888-8888-4888-8888-8888888888aa';
    for (const [verb, familyPath] of [
      ['DELETE', `redemptions/${id}`],
      ['POST', `${id}/void`],
      ['POST', `${id}/reverse`],
      ['POST', 'void'],
    ] as const) {
      const s = await call({ method: verb, familyPath });
      expect(s.status, `${verb} ${familyPath}`).toBe(404);
    }
    // The redemption is untouched.
    const row = db.rows('redemptions').find((r) => r.id === id)!;
    expect(row.status).toBe('completed');
    expect(row.voided_at).toBeNull();
    expect(Number(db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance)).toBe(60000);
  });

  it('has no NFC, tag or reader concept anywhere in the flow', async () => {
    install();
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    const serialised = JSON.stringify(s.body).toLowerCase();
    for (const forbidden of ['nfc', 'ndef', 'tagid', 'tag_id', 'reader', 'emulate']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it('never accepts a cash or payment amount', async () => {
    const s = await call({
      method: 'POST',
      body: { ...VALID_REQUEST, amount: 5000, cash: 5000, peso: 5000, php: 5000 },
    });
    expect(s.status).toBe(201);
    expect(body(s).totalPoints).toBe(2000);
  });
});
