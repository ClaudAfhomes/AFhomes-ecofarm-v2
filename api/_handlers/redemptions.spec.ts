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
  {
    moduleKey: 'operations.redemption',
    canView: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
  },
  {
    moduleKey: 'operations.catalog',
    canView: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
  },
];

/** Holds view only: may open the screen and resolve, but may NOT redeem. */
const PERMISSIONS_VIEW_ONLY = [
  {
    moduleKey: 'operations.redemption',
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  },
  {
    moduleKey: 'operations.catalog',
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  },
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
      {
        role_id: 'r1',
        module_id: 'm1',
        can_view: true,
        can_create: true,
        can_update: true,
        can_delete: true,
      },
      {
        role_id: 'r1',
        module_id: 'm2',
        can_view: true,
        can_create: true,
        can_update: true,
        can_delete: true,
      },
      {
        role_id: 'r2',
        module_id: 'm1',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r2',
        module_id: 'm2',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
    ],
    staff_users: [
      { id: STAFF_ID, email: 'finance@afhomes.test', full_name: 'Fin Staffer', status: 'active' },
      { id: OTHER_STAFF_ID, email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
      {
        id: SUSPENDED_STAFF_ID,
        email: 'susp@afhomes.test',
        full_name: 'Sus Pended',
        status: 'suspended',
      },
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
      {
        id: ACCOUNT_ID,
        membership_id: MEMBERSHIP_ID,
        balance: 60000,
        lifetime_allocated: 60000,
        lifetime_redeemed: 0,
      },
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
      [OTHER_TOKEN]: {
        id: OTHER_STAFF_ID,
        email: 'emp@afhomes.test',
        email_confirmed_at: ago(200),
      },
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
    const grants = (
      options.permissions as {
        moduleKey: string;
        canView: boolean;
        canCreate: boolean;
        canUpdate: boolean;
        canDelete: boolean;
      }[]
    ).map((p) => ({
      role_id: roleId,
      module_id: p.moduleKey === 'operations.redemption' ? 'm1' : 'm2',
      can_view: p.canView,
      can_create: p.canCreate,
      can_update: p.canUpdate,
      can_delete: p.canDelete,
    }));
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
const errCode = (s: State) =>
  (s.body as { error?: { code?: string; message?: string } }).error?.code;
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
    expect((await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } })).status).toBe(
      200,
    );
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
    // The retired transaction is a 404 for every role, including this one, and
    // writes nothing: the deny-only restriction is not what protects it.
    const redeem = await call({ method: 'POST', body: VALID_REQUEST });
    expect(redeem.status).toBe(404);
    expect(db.rows('redemptions')).toHaveLength(0);
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
});

/* ================================================================== */
/* Catalog redemption is RETIRED                                       */
/* ================================================================== */

// Points are earned on a purchase and claimed by the customer in their own
// account. Spending an existing balance against a catalog item is no longer
// part of the product, so there is no transaction route at all.
//
// These assert the route is GONE rather than merely unused. A spend endpoint
// that still answers behind a removed button is exactly the hidden way to
// spend that the requirement forbids, and public.redeem_membership_points was
// revoked in 20261108000001, so it cannot be revived by re-adding a button.

// One already-completed redemption, as it existed BEFORE the transaction was
// retired. Seeding it directly is deliberate: there is no longer any API that
// can create one, which is exactly what the retirement means. History has to
// keep reading the rows that already exist.
function seedRetiredRedemption(db: FakeSupabase, pointsCostSnapshot: number) {
  db.rows('redemptions').push({
    id: '77777777-7777-4777-8777-777777777777',
    redemption_number: 'RDM-000001',
    membership_id: MEMBERSHIP_ID,
    customer_id: CUSTOMER_ID,
    points_account_id: ACCOUNT_ID,
    redemption_item_id: ITEM_ID,
    item_code_snapshot: 'TEPPANYAKI',
    item_name_snapshot: 'Japanese Teppanyaki',
    points_cost_snapshot: pointsCostSnapshot,
    quantity: 1,
    total_points: pointsCostSnapshot,
    balance_before_snapshot: 60000,
    balance_after_snapshot: 60000 - pointsCostSnapshot,
    redeemed_by: STAFF_ID,
    redeemed_by_name: 'Fin Staffer',
    status: 'completed',
    created_at: ago(10),
    completed_at: ago(10),
    voided_at: null,
    void_reason: null,
    idempotency_key: 'retired-1',
    customers: { first_name: 'Ana', middle_name: null, last_name: 'Buyer', suffix: null },
    memberships: { membership_number: 'MBS-000777' },
  });
}

describe('catalog redemption is retired', () => {
  it('does not serve the transaction, under any alias', async () => {
    const db = install();
    const redemptionsBefore = db.rows('redemptions').length;
    const ledgerBefore = db.rows('points_ledger').length;
    for (const path of ['', 'commit']) {
      for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const s = await call({ familyPath: path, method: verb, body: VALID_REQUEST });
        expect(s.status, `${verb} ${path || '(collection)'}`).toBe(404);
      }
    }
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
    expect(db.rows('redemptions')).toHaveLength(redemptionsBefore);
    expect(db.rows('points_ledger')).toHaveLength(ledgerBefore);
  });

  it('does not let a caller-supplied price smuggle a spend back in', async () => {
    const s = await call({
      method: 'POST',
      body: { ...VALID_REQUEST, amount: 5000, cash: 5000, peso: 5000, php: 5000 },
    });
    expect(s.status).toBe(404);
  });

  it('still serves the history of redemptions made before it was retired', async () => {
    const db = install();
    seedRetiredRedemption(db, 2000);
    const s = await call({ familyPath: 'history' });
    expect(s.status).toBe(200);
    const rows = (s.body as { data: Row[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemNameSnapshot).toBe('Japanese Teppanyaki');
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

  it('never DELETEs an item, because history must stay resolvable', async () => {
    install();
    for (const verb of ['DELETE']) {
      expect((await call({ method: verb, familyPath: `items/${ITEM_ID}` })).status, verb).toBe(404);
    }
  });

  it('an updated catalog price does not rewrite what history recorded', async () => {
    const db = install();
    seedRetiredRedemption(db, 2000);
    // The catalog is re-priced after the fact. History must still show what
    // the member was actually charged.
    db.rows('redemption_items').find((r) => r.id === ITEM_ID)!.points_cost = 3500;
    const s = await call({ familyPath: 'history' });
    expect(s.status).toBe(200);
    const rows = (s.body as { data: Row[] }).data;
    expect(Number(rows[0]!.pointsCostSnapshot)).toBe(2000);
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
    expect(Number(db.rows('points_accounts').find((r) => r.id === ACCOUNT_ID)!.balance)).toBe(
      60000,
    );
  });

  it('has no NFC, tag or reader concept anywhere in the flow', async () => {
    install();
    const s = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    const serialised = JSON.stringify(s.body).toLowerCase();
    for (const forbidden of ['nfc', 'ndef', 'tagid', 'tag_id', 'reader', 'emulate']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });
});

describe('retired catalog writes', () => {
  beforeEach(() => install());
  it.each([
    ['POST', 'items'],
    ['PATCH', `items/${ITEM_ID}`],
  ])('refuses direct %s %s even to a catalog administrator', async (method, familyPath) => {
    const state = await call({
      method,
      familyPath,
      body: { code: 'FORGED', name: 'Forged', pointsCost: 1 },
    });
    expect(state.status).toBe(404);
    expect(errCode(state)).toBe('NOT_FOUND');
  });
});
