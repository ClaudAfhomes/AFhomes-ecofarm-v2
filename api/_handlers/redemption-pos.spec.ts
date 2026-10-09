/**
 * POS redemption end-to-end regression (Phase 22).
 *
 * Drives the REAL redemptions handler through the complete till flow against
 * the same faithful `redeem_membership_points` emulation the Phase 4 suite
 * uses: resolve (QR and fallback reach the same membership), review figures,
 * confirm, receipt, idempotent replay, and the refusal paths. True lock-step
 * concurrency and rollback are proven on real PostgreSQL (db-integration
 * §§27-30); what is proven here is the handler contract around them.
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

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'staff-token';
const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const RETIRED_ITEM_ID = '55555555-5555-4555-8555-555555555599';

const QR_TOKEN = 'OpAqUeQrToKeN-vALue-aAaAaAaAaAaAa';
const FALLBACK_CODE = 'AFH-1A2B-3C4D';
const NEW_QR = 'NeWqRtOkEn-AfTeR-rEiSsUe-0001';
const NEW_FB = 'AFH-9Z8Y-7X6W';

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
    roles: [{ id: 'r1', slug: 'finance', name: 'Finance', is_active: true }],
    role_permissions: [
      { role_id: 'r1', module_id: 'm1', can_view: true, can_create: true, can_update: true, can_delete: true },
      { role_id: 'r1', module_id: 'm2', can_view: true, can_create: true, can_update: true, can_delete: true },
    ],
    staff_users: [
      { id: STAFF_ID, email: 'finance@afhomes.test', full_name: 'Fin Staffer', status: 'active' },
    ],
    staff_role_assignments: [{ staff_id: STAFF_ID, role_id: 'r1' }],
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
        auth_user_id: null,
        created_at: ago(500),
        updated_at: ago(100),
        memberships: [{ id: MEMBERSHIP_ID, status: 'active' }],
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
    ],
    // A REAL relation. The membership and customer rows used to carry
    // `card_plans: { name: 'Gold' }` inline, so the `card_plans!inner(name)`
    // embed resolved nothing and every productName assertion passed without the
    // join running.
    card_plans: [
      { id: '77777777-7777-4777-8777-777777777777', code: 'GOLD', name: 'Gold' },
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

function install() {
  resetIdentifierRateLimit();
  const db = new FakeSupabase({
    tables: baseTables() as never,
    tokens: {
      [TOKEN]: { id: STAFF_ID, email: 'finance@afhomes.test', email_confirmed_at: ago(200) },
    },
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

  // Faithful `redeem_membership_points`: re-reads the catalog price, refuses
  // inactive items and short balances with the real refusal codes, debits
  // exactly once per idempotency key, and freezes snapshots on the row.
  const base = db.rpc.bind(db);
  db.rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    db.calls.push({ op: 'rpc', table: fn, arg: args });
    if (fn !== 'redeem_membership_points') return base(fn, args);
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
      id: `88888888-8888-4888-8888-88888888${String(db.rows('redemptions').length + 1000).padStart(4, '0')}`,
      redemption_number: `RDM-${String(db.rows('redemptions').length + 1).padStart(6, '0')}`,
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

describe('POS till flow: identify, review, confirm, receipt', () => {
  beforeEach(() => install());

  it('resolves the QR and the fallback code to the same membership', async () => {
    const qr = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    const fb = await call({ familyPath: 'resolve', query: { identifier: '  afh-1a2b-3c4d ' } });
    expect(qr.status).toBe(200);
    expect(fb.status).toBe(200);
    expect(body(qr)).toMatchObject({
      membershipId: MEMBERSHIP_ID,
      membershipNumber: 'MBS-000777',
      membershipStatus: 'active',
      redeemable: true,
      pointsBalance: 60000,
      matchedBy: 'qr',
    });
    expect(body(fb)).toMatchObject({
      membershipId: MEMBERSHIP_ID,
      membershipNumber: 'MBS-000777',
      redeemable: true,
      matchedBy: 'fallback_code',
    });
  });

  it('completes a redemption with exact figures and a full receipt', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-terminal-7-000001',
      },
    });
    expect(state.status).toBe(201);
    expect(body(state)).toMatchObject({
      membershipId: MEMBERSHIP_ID,
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
    expect(body(state).redemptionNumber).toMatch(/^RDM-/);
    // Exactly one negative ledger entry and an in-step balance cache.
    const debits = db
      .rows('points_ledger')
      .filter((r) => r.entry_type === 'redemption' && Number(r.amount) < 0);
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({ amount: -2000, balance_after: 58000 });
    expect(db.rows('points_accounts')[0]).toMatchObject({ balance: 58000, lifetime_redeemed: 2000 });
    expect(db.rows('memberships')[0]).toMatchObject({ points_balance: 58000 });
  });

  it('redeems an exact balance down to zero, then refuses the next peso', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('points_accounts')[0]!.balance = 2000;
    db.rows('memberships')[0]!.points_balance = 2000;
    const exact = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-exact-000001',
      },
    });
    expect(exact.status).toBe(201);
    expect(body(exact)).toMatchObject({ balanceBefore: 2000, balanceAfter: 0 });
    const next = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-exact-000002',
      },
    });
    expect(next.status).toBe(409);
    expect(db.rows('points_accounts')[0]!.balance).toBe(0);
  });

  it('cannot overspend across sequential confirmations: first wins, second is refused', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('points_accounts')[0]!.balance = 3000;
    db.rows('memberships')[0]!.points_balance = 3000;
    const first = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-race-000001',
      },
    });
    expect(first.status).toBe(201);
    const second = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-race-000002',
      },
    });
    expect(second.status).toBe(409);
    expect(db.rows('points_accounts')[0]!.balance).toBe(1000);
    expect(db.rows('redemptions')).toHaveLength(1);
  });

  it('a retry with the same reference returns the original receipt without a second debit', async () => {
    const db = holder.db as FakeSupabase;
    const first = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-retry-000001',
      },
    });
    const retry = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-retry-000001',
      },
    });
    expect(retry.status).toBe(201);
    expect(body(retry)).toMatchObject({
      redemptionId: body(first).redemptionId,
      balanceBefore: 60000,
      balanceAfter: 58000,
      replayed: true,
    });
    expect(db.rows('redemptions')).toHaveLength(1);
    expect(db.rows('points_accounts')[0]!.balance).toBe(58000);
  });

  it('refuses an expired membership at confirmation with a business-safe message', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('memberships')[0]!.expires_at = ago(1);
    const preview = await call({ familyPath: 'resolve', query: { identifier: QR_TOKEN } });
    expect(body(preview)).toMatchObject({ expired: true, redeemable: false });
    const state = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-expired-000001',
      },
    });
    expect(state.status).toBe(409);
    expect(db.rows('redemptions')).toHaveLength(0);
    expect(db.rows('points_accounts')[0]!.balance).toBe(60000);
  });

  it('refuses suspended memberships and cancelled customers at confirmation', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('memberships')[0]!.status = 'suspended';
    expect(
      (
        await call({
          method: 'POST',
          body: {
            membershipId: MEMBERSHIP_ID,
            redemptionItemId: ITEM_ID,
            quantity: 1,
            clientTransactionId: 'pos-susp-000001',
          },
        })
      ).status,
    ).toBe(409);
    db.rows('memberships')[0]!.status = 'active';
    db.rows('customers')[0]!.status = 'cancelled';
    expect(
      (
        await call({
          method: 'POST',
          body: {
            membershipId: MEMBERSHIP_ID,
            redemptionItemId: ITEM_ID,
            quantity: 1,
            clientTransactionId: 'pos-canc-000001',
          },
        })
      ).status,
    ).toBe(409);
    expect(db.rows('redemptions')).toHaveLength(0);
  });

  it('ignores a client-tampered price: the catalog cost always wins', async () => {
    const state = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 2,
        clientTransactionId: 'pos-tamper-000001',
        pointsCost: 1,
        balance: 999999,
      },
    });
    expect(state.status).toBe(201);
    expect(body(state)).toMatchObject({ unitPoints: 2000, quantity: 2, totalPoints: 4000 });
  });
});

describe('POS reissue compatibility: rotated codes fail, fresh codes flow', () => {
  beforeEach(() => install());

  it('old credentials fail while the rotated pair resolves and redeems', async () => {
    const db = holder.db as FakeSupabase;
    // A Phase 20 rotation replaces both hashes; balances stay put.
    const member = db.rows('memberships')[0]!;
    member.qr_token_hash = hash(NEW_QR);
    member.fallback_code_hash = hash(NEW_FB);

    for (const dead of [QR_TOKEN, FALLBACK_CODE]) {
      expect((await call({ familyPath: 'resolve', query: { identifier: dead } })).status).toBe(
        404,
      );
    }
    for (const live of [NEW_QR, NEW_FB]) {
      const found = await call({ familyPath: 'resolve', query: { identifier: live } });
      expect(found.status).toBe(200);
      expect(body(found)).toMatchObject({
        membershipId: MEMBERSHIP_ID,
        membershipNumber: 'MBS-000777',
        redeemable: true,
      });
    }
    const state = await call({
      method: 'POST',
      body: {
        membershipId: MEMBERSHIP_ID,
        redemptionItemId: ITEM_ID,
        quantity: 1,
        clientTransactionId: 'pos-rotated-000001',
      },
    });
    expect(state.status).toBe(201);
    expect(body(state)).toMatchObject({ totalPoints: 2000, balanceAfter: 58000 });
  });
});
