/**
 * Preview caller-bound branches (no service role).
 *
 * Drives the REAL handlers with the service client withheld (`svcNull`), so
 * every case must resolve through the caller's own JWT and call exactly one
 * `preview_*` wrapper. Each assertion pins that NO trusted actor id, customer
 * id, price, rate or balance travels from the browser: wrapper arguments carry
 * business identifiers only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ svc: null as unknown, userDb: null as unknown, svcNull: true }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => (holder.svcNull ? null : holder.svc),
  anonClient: () => holder.svc,
  userClient: () => holder.userDb,
}));
vi.mock('../_lib/storage.js', () => ({
  storageClient: () => null,
  createDownloadGrant: async () => ({ url: 'https://storage.test/x', expiresAt: '2026-01-01T00:00:00.000Z' }),
}));

const points = (await import('./points.js')).default;
const customerPortal = (await import('./customer-portal.js')).default;
const redemptions = (await import('./redemptions.js')).default;

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_AUTH_ID = '66666666-6666-4666-8666-666666666666';
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const PURCHASE_ID = '88888888-8888-4888-8888-888888888888';
const SERVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUOTE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAYMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sessionFor = (permissions: { moduleKey: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[]) => ({
  id: STAFF_ID,
  email: 'gsd@afhomes.test',
  fullName: 'Gus Dee',
  status: 'active',
  roleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  roleSlug: 'employee',
  roleName: 'Employee',
  mustChangePassword: false,
  testPurgeEnabled: false,
  permissions,
});
const allPerms = (...keys: string[]) =>
  keys.map((moduleKey) => ({ moduleKey, canView: true, canCreate: true, canUpdate: true, canDelete: false }));

function installUser(rpcs: Record<string, unknown>, tables: Record<string, Record<string, unknown>[]> = {}) {
  holder.svc = new FakeSupabase({
    tokens: {
      'staff-token': { id: STAFF_ID, email: 'gsd@afhomes.test', email_confirmed_at: new Date().toISOString() },
      'customer-token': { id: CUSTOMER_AUTH_ID, email: 'ana@example.invalid', email_confirmed_at: new Date().toISOString() },
    },
  });
  holder.userDb = new FakeSupabase({
    tokens: (holder.svc as FakeSupabase).tokens,
    tables,
    rpcs: Object.entries(rpcs).map(([fn, result]) => ({ fn, result })),
  });
}

const rpcArg = (fn: string) =>
  ((holder.userDb as FakeSupabase).calls.find((c) => c.table === fn)?.arg ?? null) as Record<string, unknown> | null;

describe('preview caller branches without a service role', () => {
  beforeEach(() => {
    holder.svcNull = true;
  });

  it('customer claim calls preview_customer_claim with the token only', async () => {
    installUser(
      { preview_customer_claim: [{ claim_number: 'AF-EARN-1', points_awarded: 1000, points_capped: 0, balance_after: 1000 }] },
      {
        customers: [{ id: CUSTOMER_ID, customer_number: 'CUS-1', email: 'ana@example.invalid', status: 'active', auth_user_id: CUSTOMER_AUTH_ID }],
      },
    );
    const { res, state } = makeRes();
    await points(
      makeReq({ method: 'POST', familyPath: 'claim', body: { token: 'AFH-AAAA-BBBB' }, token: 'customer-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(rpcArg('preview_customer_claim')).toEqual({ p_token: 'AFH-AAAA-BBBB' });
    expect((holder.userDb as FakeSupabase).calls.some((c) => c.table === 'claim_earning_points')).toBe(false);
  });

  it('staff sale creation calls preview_staff_create_purchase without actor or gross', async () => {
    installUser(
      {
        afhomes_self_session: sessionFor(allPerms('operations.sales')),
        preview_staff_create_purchase: [{ purchase_id: PURCHASE_ID, purchase_number: 'AF-TXN-1', gross_amount: '2000.00', tier_discount_amount: '0.00', net_amount: '2000.00' }],
      },
    );
    const { res, state } = makeRes();
    await points(
      makeReq({
        method: 'POST',
        familyPath: 'purchases',
        body: { membershipId: CUSTOMER_ID, lines: [{ serviceId: SERVICE_ID, quantity: 1 }], reference: 'ref-1' },
        token: 'staff-token',
      }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    const arg = rpcArg('preview_staff_create_purchase');
    expect(arg).toMatchObject({ p_membership_id: CUSTOMER_ID, p_reference: 'ref-1' });
    expect(arg).not.toHaveProperty('p_actor_id');
    expect(arg).not.toHaveProperty('p_gross_amount');
    expect((holder.userDb as FakeSupabase).calls.some((c) => c.table === 'create_purchase')).toBe(false);
  });

  it('finance verification calls preview_staff_verify_payment without actor', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.payments')),
      preview_staff_verify_payment: [{ payment_id: PAYMENT_ID, status: 'verified', verified_total: '2000.00' }],
    });
    const { res, state } = makeRes();
    await points(
      makeReq({ method: 'POST', familyPath: `payments/${PAYMENT_ID}/verify`, body: { decision: 'verified' }, token: 'staff-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    const arg = rpcArg('preview_staff_verify_payment');
    expect(arg).toMatchObject({ p_payment_id: PAYMENT_ID, p_decision: 'verified' });
    expect(arg).not.toHaveProperty('p_actor_id');
  });

  it('quote preparation calls preview_staff_prepare_quote', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.redemption')),
      preview_staff_prepare_quote: [{ quote_id: QUOTE_ID, quote_number: 'AF-QTE-1', points_requested: 100, peso_value: '50.01', eligible_line_total: '2000.00', remaining_points_after: 900, expires_at: new Date(Date.now() + 3600_000).toISOString() }],
    });
    const { res, state } = makeRes();
    await points(
      makeReq({ method: 'POST', familyPath: `purchases/${PURCHASE_ID}/quote`, body: { pointsRequested: 100, serviceDates: { serviceDate: '2026-10-24' } }, token: 'staff-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(rpcArg('preview_staff_prepare_quote')).toMatchObject({ p_purchase_id: PURCHASE_ID, p_points_requested: 100 });
  });

  it('purchase summary calls preview_staff_summary', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.payments')),
      preview_staff_summary: [{ purchase_id: PURCHASE_ID, gross_amount: '2000.00', tier_discount_amount: '0.00', points_discount_amount: '0.00', net_amount: '2000.00', recorded_total: '2000.00', verified_total: '2000.00', rejected_total: '0.00', remaining_balance: '0.00', overpaid_amount: '0.00', fully_paid: true }],
    });
    const { res, state } = makeRes();
    await points(
      makeReq({ method: 'GET', familyPath: `purchases/${PURCHASE_ID}/summary`, token: 'staff-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(rpcArg('preview_staff_summary')).toEqual({ p_purchase_id: PURCHASE_ID });
  });

  it('claim issuance calls preview_staff_create_claim without actor', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.redemption')),
      preview_staff_create_claim: [{ claim_id: QUOTE_ID, claim_number: 'AF-EARN-2', qr_token: 'qr', fallback_code: 'AFH-1111-2222', points_requested: 5, points_reserved: 5, points_capped: 0, expires_at: new Date(Date.now() + 3600_000).toISOString() }],
    });
    const { res, state } = makeRes();
    await points(
      makeReq({ method: 'POST', familyPath: 'claims', body: { purchaseId: PURCHASE_ID }, token: 'staff-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    const arg = rpcArg('preview_staff_create_claim');
    expect(arg).toEqual({ p_purchase_id: PURCHASE_ID });
  });

  it('service creation calls preview_staff_save_service without actor', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.catalog')),
      preview_staff_save_service: [{ id: SERVICE_ID, code: 'SVC-1', name: 'Stay', description: null, base_price: '2000.00', is_active: true, is_staycation_eligible: true, published: false, availability: 'available', photos: [], details: {} }],
    });
    const { res, state } = makeRes();
    await points(
      makeReq({ method: 'POST', familyPath: 'services', body: { name: 'Stay', basePrice: '2000.00' }, token: 'staff-token' }) as never,
      res as never,
    );
    expect([200, 201]).toContain(state.status);
    const arg = rpcArg('preview_staff_save_service');
    expect(arg?.p_service_id).toBeNull();
    expect(arg).not.toHaveProperty('p_actor_id');
  });

  it('refund approval calls preview_staff_refund_points without actor', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.payments')),
      preview_staff_refund_points: [{ points_restored: 100, balance_after: 100, refund_id: QUOTE_ID }],
    });
    const { res, state } = makeRes();
    await points(
      makeReq({
        method: 'POST',
        familyPath: `purchases/${PURCHASE_ID}/point-refunds`,
        body: { serviceValue: '2000.00', reference: 'R-1', reason: 'QA review', serviceReviewConfirmed: true },
        token: 'staff-token',
      }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    const arg = rpcArg('preview_staff_refund_points');
    expect(arg).toMatchObject({ p_purchase_id: PURCHASE_ID });
    expect(arg).not.toHaveProperty('p_actor_id');
  });

  it('customer approval decision calls preview_customer_decide without customer ids', async () => {
    const approvals = (await import('./_point-approvals.js')).handlePointApprovals;
    installUser(
      { preview_customer_decide: 'approved' },
      {
        customers: [{ id: CUSTOMER_ID, customer_number: 'CUS-1', email: 'ana@example.invalid', status: 'active', auth_user_id: CUSTOMER_AUTH_ID }],
      },
    );
    const { res, state } = makeRes();
    await approvals(
      makeReq({ method: 'POST', familyPath: `approvals/${QUOTE_ID}/decision`, body: { approve: true }, token: 'customer-token' }) as never,
      res as never,
      holder.userDb as never,
      `approvals/${QUOTE_ID}/decision`,
      'POST',
      true,
    );
    expect(state.status).toBe(200);
    const arg = rpcArg('preview_customer_decide');
    expect(arg).toEqual({ p_quote_id: QUOTE_ID, p_approve: true });
  });

  it('customer position calls preview_customer_position with no arguments', async () => {
    installUser(
      {
        preview_customer_position_with_allowances: [{ membership_id: CUSTOMER_ID, balance: 100, annual_cap: 60000, remaining_earning_capacity: 59900, spendable: 100, reversal_debt: 0, period_start: '2026-01-01', period_end: '2026-12-31', tier: 'GOLD', earned_this_period: 100, redeemed_this_period: 0 }],
      },
      {
        customers: [{ id: CUSTOMER_ID, customer_number: 'CUS-1', email: 'ana@example.invalid', status: 'active', auth_user_id: CUSTOMER_AUTH_ID }],
        memberships: [{ id: CUSTOMER_ID, customer_id: CUSTOMER_ID, status: 'active' }],
      },
    );
    const { res, state } = makeRes();
    await customerPortal(
      makeReq({ method: 'GET', familyPath: 'points/position', token: 'customer-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(rpcArg('preview_customer_position_with_allowances')).toEqual({});
  });

  it('member resolution calls preview_staff_resolve_member', async () => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.redemption')),
      preview_staff_resolve_member: { membershipId: CUSTOMER_ID, membershipNumber: 'MBS-1', redeemable: true, pointsBalance: 10, matchedBy: 'card_number' },
    });
    const { res, state } = makeRes();
    await redemptions(
      makeReq({ method: 'GET', familyPath: 'resolve', query: { identifier: 'MBS-1' }, token: 'staff-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(rpcArg('preview_staff_resolve_member')).toEqual({ p_identifier: 'MBS-1' });
  });

  it.each([
    ['catalog items', 'items'],
    ['catalog item detail', `items/${SERVICE_ID}`],
    ['redemption history', 'history'],
    ['redemption detail', PURCHASE_ID],
  ])('retired Phase-4 %s answers 503 without a service key', async (_label, familyPath) => {
    installUser({
      afhomes_self_session: sessionFor(allPerms('operations.redemption', 'operations.catalog')),
    });
    const { res, state } = makeRes();
    await redemptions(
      makeReq({ method: 'GET', familyPath, token: 'staff-token' }) as never,
      res as never,
    );
    expect(state.status).toBe(503);
  });
});
