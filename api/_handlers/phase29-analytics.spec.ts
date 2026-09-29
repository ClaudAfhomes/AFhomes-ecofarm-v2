/**
 * AF Homes Phase 29 - analytics completion.
 *
 * Drives the REAL analytics handler (plus the REAL reports handler for the
 * OST-status and genealogy-performance proofs) against a two-team fixture
 * hierarchy (VD-A -> SSM-A -> SM-A -> OST-A alongside VD-B -> ... -> OST-B)
 * with frozen snapshot attribution, exact-decimal money designed to catch
 * float drift, and per-status commissions/redemptions/OST data.
 *
 * What this suite proves, requirement by requirement:
 * - role scopes (global/finance/team/self/redemption) with two-team isolation
 *   on the SAME dataset, so a leak would fail, not pass vacuously;
 * - calendar day/week/month/year windows are server-computed UTC, and an
 *   unknown period is rejected (no custom-range API exists by design);
 * - verified revenue is labeled separately from frozen sale value and both
 *   are exact (0.10 + 0.20 + 29999.70 totals 30000.00, never 30000.01);
 * - current-team facts come from live referral edges while historical sales
 *   come from immutable snapshots (a genealogy move changes the former and
 *   never the latter);
 * - commissions break down by lifecycle state from frozen rows; redemptions
 *   use snapshots (a catalog rename changes nothing); OST applications break
 *   down by their real statuses;
 * - deny-only restrictions, inactive staff, and unknown callers fail closed;
 * - figures move when the data moves (no mock constants) and sequential
 *   callers never share scope (no cache layer exists in the handler).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsOverviewSchema, reportResponseSchema } from '@jad/contracts';

import {
  CUSTOMER,
  PRODUCT,
  ROLE2,
  STAFF2,
  TOKEN,
  TOKEN2,
  moduleId,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { UUID } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));

const analytics = (await import('./analytics.js')).default;
const { calendarWindow } = await import('./analytics.js');
const reports = (await import('./reports.js')).default;

/* ------------------------------------------------------------------ */
/* Scenario identities                                                 */
/* ------------------------------------------------------------------ */

const A = {
  vd: '10101010-0000-4000-8000-0000000000a1',
  ssm: '10101010-0000-4000-8000-0000000000a2',
  sm: '10101010-0000-4000-8000-0000000000a3',
  ost: '10101010-0000-4000-8000-0000000000a4',
  smInactive: '10101010-0000-4000-8000-0000000000a5',
} as const;
const B = {
  vd: '10101010-0000-4000-8000-0000000000b1',
  ssm: '10101010-0000-4000-8000-0000000000b2',
  sm: '10101010-0000-4000-8000-0000000000b3',
  ost: '10101010-0000-4000-8000-0000000000b4',
} as const;

const TOK = {
  vdA: 'tok-vd-a',
  ssmA: 'tok-ssm-a',
  smA: 'tok-sm-a',
  ostA: 'tok-ost-a',
  vdB: 'tok-vd-b',
  smB: 'tok-sm-b',
  ostB: 'tok-ost-b',
} as const;

const SALE = {
  a1: 'bbbbbbbb-0000-4000-8000-0000000000a1',
  a2: 'bbbbbbbb-0000-4000-8000-0000000000a2',
  a3: 'bbbbbbbb-0000-4000-8000-0000000000a3',
  b1: 'bbbbbbbb-0000-4000-8000-0000000000b1',
  b2: 'bbbbbbbb-0000-4000-8000-0000000000b2',
  b3: 'bbbbbbbb-0000-4000-8000-0000000000b3',
} as const;

/* Deterministic dates: the 15th is always inside its own month window. */
const now = new Date();
const inMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 10)).toISOString();
const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const prevMonth = new Date(new Date(monthFrom).valueOf() - 10 * 86400000).toISOString();
const future = new Date(now.valueOf() + 3 * 86400000).toISOString();
const past = new Date(now.valueOf() - 10 * 86400000).toISOString();

const staffRow = (id: string, fullName: string, status = 'active') => ({
  id,
  email: `${id.slice(0, 8)}@afhomes.test`,
  full_name: fullName,
  department_id: null,
  status,
  invited_at: prevMonth,
  activated_at: prevMonth,
  created_at: prevMonth,
  updated_at: prevMonth,
});

const edge = (id: string, subject: string, upline: string, role: string) => ({
  id,
  subject_staff_id: subject,
  upline_staff_id: upline,
  hierarchy_role: role,
  is_authoritative: true,
  is_active: true,
});

const snap = (saleId: string, ancestor: string, role: string, depth: number) => ({
  sale_id: saleId,
  ancestor_staff_id: ancestor,
  ancestor_role: role,
  depth,
});

const saleRow = (over: Record<string, unknown>) => ({
  sale_number: `SALE-${String(over.id).slice(-4)}`,
  seller_type: 'staff',
  seller_ost_id: null,
  minimum_down_payment_snapshot: '10000.00',
  yearly_points_snapshot: 25000,
  commission_rate_snapshot: '0.04',
  expected_commission_snapshot: '1200.00',
  submitted_at: over.created_at,
  payment_verified_at: null,
  activated_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  spot_cash_started_at: null,
  referral_relationship_id: null,
  created_by: A.vd,
  balance_due_at: future,
  created_at: over.created_at,
  updated_at: over.created_at,
  ...over,
});

function tables(): Record<string, Record<string, unknown>[]> {
  return {
    staff_users: [
      ...phase2World({}).staff_users!,
      staffRow(A.vd, 'Zara Vd'),
      staffRow(A.ssm, 'Aaron Ssm'),
      staffRow(A.sm, 'Cody Sm'),
      staffRow(A.ost, 'Evan Ost'),
      staffRow(A.smInactive, 'Greg Inactive', 'inactive'),
      staffRow(B.vd, 'David Vd'),
      staffRow(B.ssm, 'Ben Ssm'),
      staffRow(B.sm, 'Carl Sm'),
      staffRow(B.ost, 'Finn Ost'),
    ],
    staff_role_assignments: [
      ...phase2World({}).staff_role_assignments!,
      { staff_id: A.vd, role_id: ROLE2.viceDirector },
      { staff_id: A.ssm, role_id: ROLE2.seniorSalesManager },
      { staff_id: A.sm, role_id: ROLE2.salesManager },
      { staff_id: A.ost, role_id: ROLE2.ost },
      { staff_id: A.smInactive, role_id: ROLE2.salesManager },
      { staff_id: B.vd, role_id: ROLE2.viceDirector },
      { staff_id: B.ssm, role_id: ROLE2.seniorSalesManager },
      { staff_id: B.sm, role_id: ROLE2.salesManager },
      { staff_id: B.ost, role_id: ROLE2.ost },
    ],
    referral_relationships: [
      edge('eeeeeeee-0000-4000-8000-0000000000a1', A.ssm, A.vd, 'senior_sales_manager'),
      edge('eeeeeeee-0000-4000-8000-0000000000a2', A.sm, A.ssm, 'sales_manager'),
      edge('eeeeeeee-0000-4000-8000-0000000000a3', A.ost, A.sm, 'ost'),
      edge('eeeeeeee-0000-4000-8000-0000000000a4', A.smInactive, A.ssm, 'sales_manager'),
      edge('eeeeeeee-0000-4000-8000-0000000000b1', B.ssm, B.vd, 'senior_sales_manager'),
      edge('eeeeeeee-0000-4000-8000-0000000000b2', B.sm, B.ssm, 'sales_manager'),
      edge('eeeeeeee-0000-4000-8000-0000000000b3', B.ost, B.sm, 'ost'),
    ],
    card_sale_hierarchy_snapshots: [
      snap(SALE.a1, A.ost, 'ost', 0),
      snap(SALE.a1, A.sm, 'sales_manager', 1),
      snap(SALE.a1, A.ssm, 'senior_sales_manager', 2),
      snap(SALE.a1, A.vd, 'vice_director', 3),
      snap(SALE.a2, A.sm, 'sales_manager', 0),
      snap(SALE.a2, A.ssm, 'senior_sales_manager', 1),
      snap(SALE.a2, A.vd, 'vice_director', 2),
      snap(SALE.a3, A.ssm, 'senior_sales_manager', 0),
      snap(SALE.a3, A.vd, 'vice_director', 1),
      snap(SALE.b1, B.ost, 'ost', 0),
      snap(SALE.b1, B.sm, 'sales_manager', 1),
      snap(SALE.b1, B.ssm, 'senior_sales_manager', 2),
      snap(SALE.b1, B.vd, 'vice_director', 3),
      snap(SALE.b2, B.sm, 'sales_manager', 0),
      snap(SALE.b2, B.ssm, 'senior_sales_manager', 1),
      snap(SALE.b2, B.vd, 'vice_director', 2),
      snap(SALE.b3, B.sm, 'sales_manager', 0),
      snap(SALE.b3, B.ssm, 'senior_sales_manager', 1),
      snap(SALE.b3, B.vd, 'vice_director', 2),
    ],
    card_sales: [
      saleRow({ id: SALE.a1, customer_id: CUSTOMER.prospect, plan_id: PRODUCT.gold, seller_staff_id: null, seller_ost_id: A.ost, cash_price_snapshot: '60000.00', status: 'payment_in_progress', created_at: inMonth, spot_cash_deadline: future, fully_paid_at: null }),
      saleRow({ id: SALE.a2, customer_id: CUSTOMER.prospect, plan_id: PRODUCT.bronze, seller_staff_id: A.sm, cash_price_snapshot: '30000.00', status: 'activation_pending', created_at: prevMonth, spot_cash_deadline: past, fully_paid_at: inMonth }),
      saleRow({ id: SALE.a3, customer_id: CUSTOMER.prospect, plan_id: PRODUCT.silver, seller_staff_id: A.ssm, cash_price_snapshot: '40000.00', status: 'payment_pending', created_at: inMonth, spot_cash_deadline: past, fully_paid_at: null }),
      saleRow({ id: SALE.b1, customer_id: CUSTOMER.prospectTwo, plan_id: PRODUCT.silver, seller_staff_id: null, seller_ost_id: B.ost, cash_price_snapshot: '40000.00', status: 'payment_verified', created_at: inMonth, spot_cash_deadline: future, fully_paid_at: inMonth }),
      saleRow({ id: SALE.b2, customer_id: CUSTOMER.prospectTwo, plan_id: PRODUCT.bronze, seller_staff_id: B.sm, cash_price_snapshot: '30000.00', status: 'payment_in_progress', created_at: inMonth, spot_cash_deadline: null, fully_paid_at: null }),
      saleRow({ id: SALE.b3, customer_id: CUSTOMER.prospectTwo, plan_id: PRODUCT.bronze, seller_staff_id: B.sm, cash_price_snapshot: '30000.00', status: 'cancelled', created_at: prevMonth, spot_cash_deadline: null, fully_paid_at: null }),
    ],
    payments: [
      { id: 'cc000000-0000-4000-8000-0000000000a1', sale_id: SALE.a1, status: 'verified', amount: '20000.00', verified_at: inMonth, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000a2', sale_id: SALE.a1, status: 'recorded', amount: '5000.00', verified_at: null, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000a3', sale_id: SALE.a1, status: 'rejected', amount: '100.00', verified_at: null, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000a4', sale_id: SALE.a2, status: 'verified', amount: '0.10', verified_at: inMonth, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000a5', sale_id: SALE.a2, status: 'verified', amount: '0.20', verified_at: inMonth, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000a6', sale_id: SALE.a2, status: 'verified', amount: '29999.70', verified_at: inMonth, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000b1', sale_id: SALE.b1, status: 'verified', amount: '40000.00', verified_at: inMonth, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000b2', sale_id: SALE.b2, status: 'recorded', amount: '1000.00', verified_at: null, recorded_at: inMonth },
      { id: 'cc000000-0000-4000-8000-0000000000b3', sale_id: SALE.b3, status: 'rejected', amount: '50.00', verified_at: null, recorded_at: prevMonth },
    ],
    memberships: [
      { id: 'dd000000-0000-4000-8000-0000000000a1', sale_id: SALE.a1, status: 'active', activated_at: inMonth },
      { id: 'dd000000-0000-4000-8000-0000000000b1', sale_id: SALE.b1, status: 'active', activated_at: inMonth },
    ],
    commissions: [
      { id: 'ee000000-0000-4000-8000-0000000000a1', sale_id: SALE.a1, status: 'pending' },
      { id: 'ee000000-0000-4000-8000-0000000000a2', sale_id: SALE.a2, status: 'earned' },
      { id: 'ee000000-0000-4000-8000-0000000000a3', sale_id: SALE.a3, status: 'payment_verified' },
      { id: 'ee000000-0000-4000-8000-0000000000b1', sale_id: SALE.b1, status: 'paid' },
      { id: 'ee000000-0000-4000-8000-0000000000b2', sale_id: SALE.b2, status: 'final_qualification_pending' },
      { id: 'ee000000-0000-4000-8000-0000000000b3', sale_id: SALE.b3, status: 'cancelled' },
    ],
    redemptions: [
      { id: 'ff000000-0000-4000-8000-0000000000a1', redemption_number: 'RDM-A1', item_name_snapshot: 'Rice 5kg', total_points: 10000, status: 'completed', redeemed_by: STAFF2.hr, created_at: inMonth },
      { id: 'ff000000-0000-4000-8000-0000000000a2', redemption_number: 'RDM-A2', item_name_snapshot: 'Rice 5kg', total_points: 5000, status: 'completed', redeemed_by: UUID.adminStaff, created_at: inMonth },
      { id: 'ff000000-0000-4000-8000-0000000000a3', redemption_number: 'RDM-A3', item_name_snapshot: 'Rice 5kg', total_points: 7000, status: 'voided', redeemed_by: STAFF2.hr, created_at: inMonth },
    ],
    redemption_items: [
      { id: '33333333-0000-4000-8000-000000000001', code: 'RICE-5KG', name: 'Rice 5kg', points_cost: 5000, is_active: true },
    ],
    ost_applications: [
      { id: '44444444-0000-4000-8000-0000000000a1', sponsor_staff_id: A.sm, first_name: 'A', middle_name: null, last_name: 'One', email: 'a1@example.invalid', phone: '09180000001', status: 'submitted', submitted_at: inMonth, reviewed_at: null, reviewed_by: null, review_notes: null },
      { id: '44444444-0000-4000-8000-0000000000a2', sponsor_staff_id: A.sm, first_name: 'A', middle_name: null, last_name: 'Two', email: 'a2@example.invalid', phone: '09180000002', status: 'under_review', submitted_at: inMonth, reviewed_at: null, reviewed_by: null, review_notes: null },
      { id: '44444444-0000-4000-8000-0000000000a3', sponsor_staff_id: A.sm, first_name: 'A', middle_name: null, last_name: 'Three', email: 'a3@example.invalid', phone: '09180000003', status: 'changes_requested', submitted_at: inMonth, reviewed_at: null, reviewed_by: null, review_notes: null },
      { id: '44444444-0000-4000-8000-0000000000a4', sponsor_staff_id: A.sm, first_name: 'A', middle_name: null, last_name: 'Four', email: 'a4@example.invalid', phone: '09180000004', status: 'approved', submitted_at: inMonth, reviewed_at: inMonth, reviewed_by: A.vd, review_notes: null },
      { id: '44444444-0000-4000-8000-0000000000a5', sponsor_staff_id: A.sm, first_name: 'A', middle_name: null, last_name: 'Five', email: 'a5@example.invalid', phone: '09180000005', status: 'rejected', submitted_at: inMonth, reviewed_at: inMonth, reviewed_by: A.vd, review_notes: null },
      { id: '44444444-0000-4000-8000-0000000000b1', sponsor_staff_id: B.sm, first_name: 'B', middle_name: null, last_name: 'One', email: 'b1@example.invalid', phone: '09180000006', status: 'submitted', submitted_at: inMonth, reviewed_at: null, reviewed_by: null, review_notes: null },
    ],
  };
}

function install() {
  const db = new FakeSupabase({
    tables: phase2World(tables() as never),
    tokens: {
      ...phase2WorldTokens(),
      [TOK.vdA]: { id: A.vd, email: 'vd-a@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.ssmA]: { id: A.ssm, email: 'ssm-a@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.smA]: { id: A.sm, email: 'sm-a@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.ostA]: { id: A.ost, email: 'ost-a@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.vdB]: { id: B.vd, email: 'vd-b@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.smB]: { id: B.sm, email: 'sm-b@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      [TOK.ostB]: { id: B.ost, email: 'ost-b@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
    },
  });
  holder.db = db as unknown;
  const real = db as FakeSupabase;
  // Production-baseline grants the shared fixtures predate or narrow down,
  // labelled exactly as in reports.spec.ts.
  for (const role of [ROLE2.viceDirector, ROLE2.seniorSalesManager, ROLE2.salesManager, ROLE2.ost]) {
    real.rows('role_permissions').push({
      role_id: role,
      module_id: moduleId('network.commissions'),
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
  }
  real.rows('role_permissions').push({
    role_id: ROLE2.employee,
    module_id: moduleId('operations.redemption'),
    can_view: true,
    can_create: false,
    can_update: false,
    can_delete: false,
  });
  real.rows('role_permissions').push({
    role_id: ROLE2.salesManager,
    module_id: moduleId('network.ost_registrations'),
    can_view: true,
    can_create: false,
    can_update: false,
    can_delete: false,
  });
  return real;
}

beforeEach(() => {
  install();
});

type State = { status: number; body: unknown };

async function overview(token?: string, period = 'month'): Promise<State> {
  const { res, state } = makeRes();
  await analytics(
    {
      method: 'GET',
      query: { familyPath: '', period },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

async function report(path: string, token?: string, query: Record<string, string> = {}) {
  const { res, state } = makeRes();
  await reports(
    { method: 'GET', query: { familyPath: path, ...query }, headers: token ? { authorization: `Bearer ${token}` } : {} } as never,
    res as never,
  );
  return state;
}

const body = <T>(state: State) => state.body as T;
type Overview = ReturnType<typeof analyticsOverviewSchema.parse>;

/* ================================================================== */
/* Global + finance scopes                                             */
/* ================================================================== */

describe('Phase 29 global and finance analytics', () => {
  it('1. Super Admin sees validated global facts with no mock constants', async () => {
    const state = await overview(TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = analyticsOverviewSchema.parse(state.body);
    expect(parsed.scope.kind).toBe('global');
    expect(parsed.headline.totalCardSales).toBe(6);
    // Frozen sale value is period-windowed (in-month sales only); verified
    // revenue is windowed by verification time. Both are labeled, never mixed.
    expect(parsed.headline.periodSales).toBe(4);
    expect(parsed.headline.grossFrozenSaleValue).toBe('170000.00');
    // Verified revenue is labeled separately from frozen sale value.
    expect(parsed.headline.periodVerifiedPayments).toBe('90000.00');
    expect(parsed.headline.activatedMemberships).toBe(2);
    expect(parsed.sellers).toMatchObject({ active: expect.any(Number), inactive: expect.any(Number) });
    expect(parsed.commissions).toMatchObject({
      pending: 1,
      payment_verified: 1,
      final_qualification_pending: 1,
      earned: 1,
      paid: 1,
      cancelled: 1,
    });
    expect(parsed.redemptions).toMatchObject({ count: 2, pointsRedeemed: 15000 });
    expect(parsed.queues).toMatchObject({
      pendingPaymentVerification: 2,
      rejectedPayments: 2,
      fullPaidSales: 2,
      spotCashActive: 1,
      spotCashExpired: 1,
    });
    const byPlan = Object.fromEntries(parsed.salesByPlan.map((p) => [p.planName, p]));
    // Plan attribution is period-windowed like the rest of the headline:
    // A2/B3 were created last month, so this month holds B2 alone for Bronze.
    expect(byPlan.Gold).toMatchObject({ count: 1, value: '60000.00' });
    expect(byPlan.Silver).toMatchObject({ count: 2, value: '80000.00' });
    expect(byPlan.Bronze).toMatchObject({ count: 1, value: '30000.00' });
    // Trend points carry both labeled series, never a blended number.
    const point = parsed.trends.find((t) => t.sales > 0);
    expect(point).toMatchObject({ saleValue: expect.any(String), verifiedPayments: expect.any(String) });
    expect(point!.saleValue).not.toBe(point!.verifiedPayments);
  });

  it('46. figures move when the data moves', async () => {
    const db = holder.db as FakeSupabase;
    const before = body<Overview>(await overview(TOKEN.superAdmin)).headline.grossFrozenSaleValue;
    db.rows('card_sales').push(
      saleRow({ id: 'bbbbbbbb-0000-4000-8000-0000000000a9', customer_id: CUSTOMER.prospect, plan_id: PRODUCT.bronze, seller_staff_id: A.sm, cash_price_snapshot: '30000.00', status: 'submitted', created_at: inMonth, spot_cash_deadline: null, fully_paid_at: null }),
    );
    db.rows('card_sale_hierarchy_snapshots').push(snap(SALE.a1, A.sm, 'sales_manager', 1));
    const after = body<Overview>(await overview(TOKEN.superAdmin)).headline.grossFrozenSaleValue;
    expect(before).toBe('170000.00');
    expect(after).toBe('200000.00');
  });

  it('2. Finance sees money and queues, but no redemption or org sections', async () => {
    const parsed = body<Overview>(await overview(TOKEN2.finance));
    expect(parsed.scope.kind).toBe('finance');
    expect(parsed.queues.spotCashExpired).toBe(1);
    expect(parsed.queues.spotCashActive).toBe(1);
    expect(parsed.headline.periodVerifiedPayments).toBe('90000.00');
    expect(parsed.redemptions).toBeNull();
    expect(parsed.organization).toBeNull();
    expect(parsed.commissions).toMatchObject({ paid: 1, earned: 1 });
  });
});

/* ================================================================== */
/* Team scopes with two-team isolation                                 */
/* ================================================================== */

describe('Phase 29 team and self scopes', () => {
  it('3/20. VD-A sees current genealogy and only team-A history', async () => {
    const parsed = body<Overview>(await overview(TOK.vdA));
    expect(parsed.scope.kind).toBe('team');
    expect(parsed.headline.totalCardSales).toBe(3);
    expect(parsed.headline.periodSales).toBe(2);
    expect(parsed.headline.grossFrozenSaleValue).toBe('100000.00');
    expect(parsed.sellers).toMatchObject({
      directCount: 1,
      descendantCount: 4,
      active: 3,
      inactive: 1,
      byRole: { senior_sales_manager: 1, sales_manager: 2, ost: 1 },
    });
    expect(parsed.networkContext).toMatchObject({ upperline: null });
    // No team-B fact anywhere in the payload.
    expect(JSON.stringify(parsed)).not.toContain(SALE.b1);
    expect(JSON.stringify(parsed)).not.toContain(B.sm);
    expect(parsed.scope.unattributedLegacySaleCount).toBe(0);
  });

  it('4. SSM-A sees its subtree without the sibling chain or its upline sales', async () => {
    const parsed = body<Overview>(await overview(TOK.ssmA));
    expect(parsed.headline.totalCardSales).toBe(3);
    expect(parsed.sellers).toMatchObject({ directCount: 2, descendantCount: 3 });
    expect(JSON.stringify(parsed)).not.toContain(SALE.b1);
    expect(parsed.networkContext).toMatchObject({ upperline: { id: A.vd, name: 'Zara Vd' } });
  });

  it('5. SM-A sees its downline sales but not its upline sale', async () => {
    const parsed = body<Overview>(await overview(TOK.smA));
    // A3 was sold by SSM-A (above SM-A): attributed to VD-A/SSM-A, never here.
    // A2 predates the month window, so the period slice holds A1 alone.
    expect(parsed.headline.totalCardSales).toBe(2);
    expect(parsed.headline.periodSales).toBe(1);
    expect(parsed.headline.grossFrozenSaleValue).toBe('60000.00');
    expect(parsed.sellers).toMatchObject({ directCount: 1, descendantCount: 1 });
    expect(JSON.stringify(parsed)).not.toContain(SALE.a3);
    expect(JSON.stringify(parsed)).not.toContain(SALE.b1);
  });

  it('6/25. OST-A sees itself only: one sale, one pending commission', async () => {
    const parsed = body<Overview>(await overview(TOK.ostA));
    expect(parsed.scope.kind).toBe('self');
    expect(parsed.headline.totalCardSales).toBe(1);
    expect(parsed.headline.grossFrozenSaleValue).toBe('60000.00');
    expect(parsed.headline.totalCustomers).toBe(1);
    expect(parsed.commissions).toMatchObject({ pending: 1, earned: 0, paid: 0 });
    expect(parsed.networkContext).toMatchObject({ upperline: { id: A.sm, name: 'Cody Sm' } });
    expect(JSON.stringify(parsed)).not.toContain(SALE.a2);
    expect(JSON.stringify(parsed)).not.toContain(SALE.b1);
  });

  it('23/24. sibling and unrelated teams are excluded, never denied with an error', async () => {
    const vdB = body<Overview>(await overview(TOK.vdB));
    expect(vdB.headline.totalCardSales).toBe(3);
    expect(vdB.headline.grossFrozenSaleValue).toBe('70000.00');
    expect(JSON.stringify(vdB)).not.toContain(SALE.a1);
    const smB = body<Overview>(await overview(TOK.smB));
    expect(smB.headline.totalCardSales).toBe(3);
    expect(JSON.stringify(smB)).not.toContain(SALE.a1);
  });

  it('7. Employee sees only redemption operations they handled', async () => {
    const parsed = body<Overview>(await overview(TOKEN2.hr));
    expect(parsed.scope.kind).toBe('redemption');
    expect(parsed.headline.totalCardSales).toBe(0);
    expect(parsed.headline.periodVerifiedPayments).toBe('0.00');
    expect(parsed.commissions).toBeNull();
    expect(parsed.redemptions).toMatchObject({ count: 1, pointsRedeemed: 10000 });
    expect(parsed.redemptions!.recent[0]).toMatchObject({ itemName: 'Rice 5kg', points: 10000 });
  });

  it('8/43. unknown callers are denied staff analytics outright', async () => {
    expect((await overview('tok-unknown')).status).toBe(401);
    expect((await overview()).status).toBe(401);
  });

  it('44/45. deny-only restrictions and inactive accounts fail closed', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('staff_permission_restrictions').push({
      staff_id: A.sm,
      module_id: moduleId('dashboard.view'),
      deny_view: true,
      deny_create: false,
      deny_update: false,
      deny_delete: false,
    });
    expect((await overview(TOK.smA)).status).toBe(403);
    db.rows('staff_users').find((r) => r.id === A.ssm)!.status = 'inactive';
    expect((await overview(TOK.ssmA)).status).toBe(403);
  });
});

/* ================================================================== */
/* Timeframes                                                          */
/* ================================================================== */

describe('Phase 29 timeframes', () => {
  it('9/10/11/12. day, week, and year windows are server UTC; month is exact', async () => {
    const day = calendarWindow('day');
    expect(day.from.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(day.to.valueOf() - day.from.valueOf()).toBe(86400000);
    const week = calendarWindow('week');
    expect(week.from.getUTCDay()).toBe(1);
    expect(week.to.valueOf() - week.from.valueOf()).toBe(7 * 86400000);
    const year = calendarWindow('year');
    expect(year.from.toISOString()).toBe(`${year.from.getUTCFullYear()}-01-01T00:00:00.000Z`);

    const month = body<Overview>(await overview(TOKEN.superAdmin, 'month'));
    expect(month.headline.periodSales).toBe(4);
    expect(month.headline.grossFrozenSaleValue).toBe('170000.00');
    // Verified money is windowed by verification time, not sale creation:
    // A2 was created last month but verified this month.
    expect(month.headline.periodVerifiedPayments).toBe('90000.00');

    const yearBody = body<Overview>(await overview(TOKEN.superAdmin, 'year'));
    const expectedYear = (holder.db as FakeSupabase)
      .rows('card_sales')
      .filter((s) => String(s.created_at) >= year.from.toISOString()).length;
    expect(yearBody.headline.periodSales).toBe(expectedYear);
    expect(yearBody.trends.every((t) => /^\d{4}-\d{2}$/.test(t.period))).toBe(true);

    const dayBody = body<Overview>(await overview(TOKEN.superAdmin, 'day'));
    expect(dayBody.trends.every((t) => /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(t.period))).toBe(true);
  });

  it('13. an unknown period is rejected, never defaulted', async () => {
    expect((await overview(TOKEN.superAdmin, 'fortnight')).status).toBe(400);
    expect((await overview(TOKEN.superAdmin, 'last_30_days')).status).toBe(400);
  });
});

/* ================================================================== */
/* Money, plans, commissions, redemptions, OST                         */
/* ================================================================== */

describe('Phase 29 money and historical facts', () => {
  it('14/15/16/48. counts, frozen values, and float-proof verified revenue', async () => {
    const parsed = body<Overview>(await overview(TOKEN.superAdmin));
    // 0.10 + 0.20 + 29999.70 is exactly 30000.00 in centavo arithmetic.
    expect(parsed.headline.periodVerifiedPayments).toBe('90000.00');
    expect(parsed.headline.periodSales).toBe(4);
    expect(parsed.headline.grossFrozenSaleValue).toBe('170000.00');
    expect(parsed.headline.activatedMemberships).toBe(2);
    expect(parsed.sellers).toMatchObject({ active: expect.any(Number), inactive: expect.any(Number) });
    analyticsOverviewSchema.parse(parsed);
  });

  it('18/19. active and inactive sellers come from account status only', async () => {
    const vdA = body<Overview>(await overview(TOK.vdA));
    // Greg Inactive holds a sales_manager assignment but an inactive account:
    // counted, never hidden, never labeled by invented activity rules.
    expect(vdA.sellers).toMatchObject({ active: 3, inactive: 1 });
  });

  it('26/27. plans aggregate frozen snapshots; live repricing changes nothing', async () => {
    const db = holder.db as FakeSupabase;
    const before = body<Overview>(await overview(TOKEN.superAdmin));
    db.rows('card_plans').find((r) => r.id === PRODUCT.gold)!.cash_price = '99999.99';
    db.rows('card_plans').find((r) => r.id === PRODUCT.gold)!.commission_rate = '0.5000';
    const after = body<Overview>(await overview(TOKEN.superAdmin));
    expect(after.headline.grossFrozenSaleValue).toBe(before.headline.grossFrozenSaleValue);
    expect(after.salesByPlan).toEqual(before.salesByPlan);
    expect(after.commissions).toEqual(before.commissions);
  });

  it('28/29/30/31/32. commission states stay distinct and frozen', async () => {
    const vdA = body<Overview>(await overview(TOK.vdA));
    expect(vdA.commissions).toMatchObject({
      pending: 1,
      payment_verified: 1,
      final_qualification_pending: 0,
      earned: 1,
      paid: 0,
      cancelled: 0,
    });
    // Earned and paid are never collapsed into one number.
    expect(JSON.stringify(vdA.commissions)).not.toContain('total');
  });

  it('33/34/35. redemptions count completions; a catalog rename changes nothing', async () => {
    const db = holder.db as FakeSupabase;
    const admin = body<Overview>(await overview(TOKEN.superAdmin));
    expect(admin.redemptions).toMatchObject({ count: 2, pointsRedeemed: 15000 });
    expect(admin.redemptions!.recent.map((r) => r.itemName)).toEqual(['Rice 5kg', 'Rice 5kg']);
    db.rows('redemption_items').find((r) => r.code === 'RICE-5KG')!.name = 'Rice Premium 5kg';
    const renamed = body<Overview>(await overview(TOKEN.superAdmin));
    expect(renamed.redemptions!.recent.map((r) => r.itemName)).toEqual(['Rice 5kg', 'Rice 5kg']);
    expect(renamed.redemptions).toMatchObject({ count: 2, pointsRedeemed: 15000 });
  });

  it('36. OST applications break down by their real statuses', async () => {
    const global = reportResponseSchema.parse((await report('ost', TOKEN.superAdmin)).body);
    expect(global.meta.total).toBe(6);
    expect((global.summary as Record<string, Record<string, number>>).byStatus).toMatchObject({
      submitted: 2,
      under_review: 1,
      changes_requested: 1,
      approved: 1,
      rejected: 1,
    });
    const team = reportResponseSchema.parse((await report('ost', TOK.smA)).body);
    expect(team.meta.total).toBe(5);
    expect(JSON.stringify(team)).not.toContain('b1@example.invalid');
  });
});

/* ================================================================== */
/* Genealogy move, performance order, cache behavior                    */
/* ================================================================== */

describe('Phase 29 genealogy history and performance order', () => {
  it('21/22. moving the live genealogy never moves frozen history', async () => {
    const db = holder.db as FakeSupabase;
    const before = body<Overview>(await overview(TOK.vdA));
    expect(before.headline.totalCardSales).toBe(3);
    expect(before.sellers!.descendantCount).toBe(4);
    // SM-A moves from SSM-A to SSM-B in the LIVE structure only.
    db.rows('referral_relationships').find((r) => r.subject_staff_id === A.sm)!.is_active = false;
    db.rows('referral_relationships').push(edge('eeeeeeee-0000-4000-8000-0000000000a9', A.sm, B.ssm, 'sales_manager'));
    const after = body<Overview>(await overview(TOK.vdA));
    expect(after.headline.totalCardSales).toBe(3);
    expect(after.headline.grossFrozenSaleValue).toBe('100000.00');
    // ...while the current-team facts follow the move immediately: SM-A and
    // OST-A leave VD-A (the inactive Greg Inactive stays visible in structure).
    expect(after.sellers!.descendantCount).toBe(2);
    const gained = body<Overview>(await overview(TOK.vdB));
    expect(gained.sellers!.descendantCount).toBe(5);
  });

  it('37/38. the performance table is deterministically ordered with no scores', async () => {
    const parsed = reportResponseSchema.parse((await report('genealogy', TOKEN.superAdmin)).body);
    const names = parsed.data.map((r) => (r as { seller: string }).seller);
    expect(names.slice(0, 8)).toEqual([
      'Aaron Ssm',
      'Zara Vd',
      'Ben Ssm',
      'Carl Sm',
      'David Vd',
      'Cody Sm',
      'Evan Ost',
      'Finn Ost',
    ]);
    const text = JSON.stringify(parsed.data);
    expect(text).not.toMatch(/score|rating|grade|poor performer/i);
    // Zero-history sellers (the other chain plus the inactive account) sort
    // last, still visible, still unscored.
    expect(names).toHaveLength(13);
  });

  it('47. sequential callers never share scope: no cache layer exists', async () => {
    const vdA = body<Overview>(await overview(TOK.vdA));
    const vdB = body<Overview>(await overview(TOK.vdB));
    expect(vdA.scope.viewerStaffId).toBe(A.vd);
    expect(vdB.scope.viewerStaffId).toBe(B.vd);
    expect(vdA.headline.grossFrozenSaleValue).toBe('100000.00');
    expect(vdB.headline.grossFrozenSaleValue).toBe('70000.00');
  });
});
