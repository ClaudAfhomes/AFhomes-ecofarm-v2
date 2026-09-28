/**
 * Customer payment history and portal status-matrix regression (Phase 23).
 *
 * `GET /customer/payments` exposes only a member's own card-sale payments
 * with a field-by-field read model (no staff ids, receipt paths, reasons or
 * notes), scoped from ownership alone. The status matrix pins the existing
 * lifecycle: non-active customers read their profile but nothing else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
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

const portal = (await import('./customer-portal.js')).default;

const SALE_A = 'bbbbbbbb-0000-4000-8000-0000000000a1';
const SALE_B = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const MEMBER_A = 'dddddddd-0000-4000-8000-0000000000a1';
const MEMBER_B = 'dddddddd-0000-4000-8000-0000000000b2';

function install() {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: {
      ...phase2WorldTokens(),
      'tok-cust-a': { id: 'auth-user-a', email: 'a@example.com', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-cust-b': { id: 'auth-user-b', email: 'b@example.com', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
    },
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      {
        fn: 'reissue_membership_credentials',
        result: [{ membership_id: MEMBER_A, fallback_code: 'AFH-NEW1-CODE', qr_token: 'qr-new-0001' }],
      },
    ],
    rpcErrors: {},
  });
  const db = holder.db as FakeSupabase;
  // This spec owns its business rows outright: drop the fixture sales,
  // memberships, payments and ledger rows so every count and lookup below
  // is exactly what the test seeded (direct pushes bypass unique checks).
  for (const table of [
    'memberships',
    'card_sales',
    'payments',
    'commissions',
    'points_accounts',
    'points_ledger',
    'redemptions',
    'customer_onboarding_tokens',
  ]) {
    db.rows(table).splice(0, db.rows(table).length);
  }
  return db;
}

function linkCustomer(db: FakeSupabase, customerId: string, authId: string, status: string) {
  const row = db.rows('customers').find((r) => r.id === customerId)!;
  row.auth_user_id = authId;
  row.status = status;
}

function seedMembership(
  db: FakeSupabase,
  options: { id: string; customerId: string; saleId: string; number: string; status: string },
) {
  db.rows('card_sales').push({ id: options.saleId, customer_id: options.customerId, sale_number: `SALE-${options.saleId.slice(-4)}`, status: 'active' });
  db.rows('memberships').push({
    id: options.id,
    customer_id: options.customerId,
    sale_id: options.saleId,
    membership_number: options.number,
    product_id: PRODUCT.gold,
    status: options.status,
    points_balance: 60000,
    yearly_points_allocated: 60000,
    activated_at: '2026-09-27T09:00:00.000Z',
    expires_at: '2027-09-27T09:00:00.000Z',
    renewal_due_at: '2027-09-27T09:00:00.000Z',
  });
}

function seedPayment(db: FakeSupabase, options: { id: string; saleId: string; amount: string; status: string; reference: string }) {
  db.rows('payments').push({
    id: options.id,
    sale_id: options.saleId,
    customer_id: CUSTOMER.active,
    amount: options.amount,
    payment_type: 'installment',
    method: 'bank_transfer',
    reference: options.reference,
    status: options.status,
    recorded_by: 'staff-id',
    verified_by: 'staff-id',
    receipt_storage_path: 'private/receipt.pdf',
    rejection_reason: 'internal note',
    notes: 'finance note',
    recorded_at: '2026-09-27T10:00:00.000Z',
    verified_at: options.status === 'verified' ? '2026-09-27T11:00:00.000Z' : null,
  });
}

type State = { status: number; body: unknown };

async function call(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<State> {
  const { res, state } = makeRes();
  await portal(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: path,
      body: options.body,
      token: options.token,
    }) as never,
    res as never,
  );
  return state;
}

const data = (body: unknown) => (body as { data: Record<string, unknown>[] }).data;
const serialised = (body: unknown) => JSON.stringify(body);

describe('customer payment history', () => {
  beforeEach(() => {
    const db = install();
    linkCustomer(db, CUSTOMER.active, 'auth-user-a', 'active');
    seedMembership(db, { id: MEMBER_A, customerId: CUSTOMER.active, saleId: SALE_A, number: 'MBS-000101', status: 'active' });
    seedPayment(db, { id: 'cccccccc-0000-4000-8000-0000000000a1', saleId: SALE_A, amount: '20000.00', status: 'verified', reference: 'TRF-9001' });
    seedPayment(db, { id: 'cccccccc-0000-4000-8000-0000000000a2', saleId: SALE_A, amount: '40000.00', status: 'recorded', reference: 'TRF-9002' });
  });

  it('returns only the caller own payments with safe fields', async () => {
    const state = await call('payments', { token: 'tok-cust-a' });
    expect(state.status).toBe(200);
    expect(data(state.body)).toHaveLength(2);
    expect(data(state.body)[0]).toEqual({
      id: 'cccccccc-0000-4000-8000-0000000000a1',
      saleId: SALE_A,
      amount: '20000.00',
      paymentType: 'installment',
      method: 'bank_transfer',
      reference: 'TRF-9001',
      status: 'verified',
      recordedAt: '2026-09-27T10:00:00.000Z',
      verifiedAt: '2026-09-27T11:00:00.000Z',
    });
    expect(serialised(state.body)).not.toMatch(
      /recorded_by|verified_by|receipt_storage_path|rejection_reason|notes|government/i,
    );
  });

  it('returns an empty list when the member has no sales', async () => {
    const db = holder.db as FakeSupabase;
    linkCustomer(db, CUSTOMER.prospectTwo, 'auth-user-b', 'active');
    const state = await call('payments', { token: 'tok-cust-b' });
    expect(state.status).toBe(200);
    expect(data(state.body)).toEqual([]);
  });

  it('never shows another customer payments', async () => {
    const db = holder.db as FakeSupabase;
    linkCustomer(db, CUSTOMER.prospectTwo, 'auth-user-b', 'active');
    seedMembership(db, { id: MEMBER_B, customerId: CUSTOMER.prospectTwo, saleId: SALE_B, number: 'MBS-000102', status: 'active' });
    seedPayment(db, { id: 'cccccccc-0000-4000-8000-0000000000b1', saleId: SALE_B, amount: '15000.00', status: 'verified', reference: 'TRF-9101' });
    // B's rows point at B's sale; A must not see them and vice versa.
    db.rows('payments').find((r) => r.id === 'cccccccc-0000-4000-8000-0000000000b1')!.customer_id =
      CUSTOMER.prospectTwo;
    const a = await call('payments', { token: 'tok-cust-a' });
    expect(data(a.body).map((r) => r.id).sort()).toEqual([
      'cccccccc-0000-4000-8000-0000000000a1',
      'cccccccc-0000-4000-8000-0000000000a2',
    ]);
    const b = await call('payments', { token: 'tok-cust-b' });
    expect(data(b.body).map((r) => r.id)).toEqual(['cccccccc-0000-4000-8000-0000000000b1']);
  });

  it('refuses payments for suspended, cancelled and prospect accounts', async () => {
    const db = holder.db as FakeSupabase;
    linkCustomer(db, CUSTOMER.prospect, 'auth-user-b', 'suspended');
    expect((await call('payments', { token: 'tok-cust-b' })).status).toBe(403);
    linkCustomer(db, CUSTOMER.prospect, 'auth-user-b', 'prospect');
    expect((await call('payments', { token: 'tok-cust-b' })).status).toBe(403);
    linkCustomer(db, CUSTOMER.cancelled, 'auth-user-b', 'cancelled');
    // The token now matches two rows; unlink the first so resolution is exact.
    db.rows('customers').find((r) => r.id === CUSTOMER.prospect)!.auth_user_id = null;
    expect((await call('payments', { token: 'tok-cust-b' })).status).toBe(403);
  });

  it('accepts no verb or id parameter on the collection', async () => {
    expect((await call('payments', { method: 'POST', token: 'tok-cust-a' })).status).toBe(404);
  });
});

describe('portal status matrix', () => {
  beforeEach(() => {
    const db = install();
    linkCustomer(db, CUSTOMER.active, 'auth-user-a', 'active');
    seedMembership(db, { id: MEMBER_A, customerId: CUSTOMER.active, saleId: SALE_A, number: 'MBS-000101', status: 'active' });
  });

  it('a cancelled customer reads their profile but nothing else', async () => {
    const db = holder.db as FakeSupabase;
    linkCustomer(db, CUSTOMER.active, 'auth-user-a', 'cancelled');
    expect((await call('', { token: 'tok-cust-a' })).status).toBe(200);
    for (const path of ['membership', 'points', 'points/ledger', 'payments']) {
      expect((await call(path, { token: 'tok-cust-a' })).status).toBe(403);
    }
    expect(
      (
        await call('membership/credentials', {
          method: 'POST',
          token: 'tok-cust-a',
        })
      ).status,
    ).toBe(403);
  });

  it('a suspended customer is refused points, ledger and reissue', async () => {
    const db = holder.db as FakeSupabase;
    linkCustomer(db, CUSTOMER.active, 'auth-user-a', 'suspended');
    for (const path of ['points', 'points/ledger']) {
      expect((await call(path, { token: 'tok-cust-a' })).status).toBe(403);
    }
    expect(
      (
        await call('membership/credentials', {
          method: 'POST',
          token: 'tok-cust-a',
        })
      ).status,
    ).toBe(403);
  });

  it('an expired-status membership reads as no active membership', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('memberships').find((r) => r.id === MEMBER_A)!.status = 'expired';
    expect((await call('membership', { token: 'tok-cust-a' })).status).toBe(404);
  });

  it('a cancelled-status membership reads as no active membership', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('memberships').find((r) => r.id === MEMBER_A)!.status = 'cancelled';
    expect((await call('membership', { token: 'tok-cust-a' })).status).toBe(404);
  });

  it('a date-past expiry on an active membership changes nothing (no invented termination)', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('memberships').find((r) => r.id === MEMBER_A)!.expires_at = '2020-01-01T00:00:00.000Z';
    expect((await call('membership', { token: 'tok-cust-a' })).status).toBe(200);
  });

  it('a credential rotation is bound to the caller own membership', async () => {
    const db = holder.db as FakeSupabase;
    linkCustomer(db, CUSTOMER.prospectTwo, 'auth-user-b', 'active');
    seedMembership(db, { id: MEMBER_B, customerId: CUSTOMER.prospectTwo, saleId: SALE_B, number: 'MBS-000102', status: 'active' });
    const state = await call('membership/credentials', { method: 'POST', token: 'tok-cust-a' });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({ membershipNumber: 'MBS-000101' });
    expect(db.rows('audit_events')).toHaveLength(0);
  });
});
