import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesTrendReportSchema } from '@jad/contracts';
import {
  SALE,
  STAFF2,
  TOKEN,
  TOKEN2,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';
import { selectHandler } from '../_lib/router.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { default: handler } = await import('./analytics.js');

function install() {
  const tables = phase2World({
    card_sale_hierarchy_snapshots: [],
    redemptions: [],
    ost_applications: [],
    final_qualifications: [],
  });
  holder.db = new FakeSupabase({ tables, tokens: phase2WorldTokens() });
  return holder.db as FakeSupabase;
}

async function call(token?: string, granularity?: string) {
  const { res, state } = makeRes();
  await handler(
    {
      method: 'GET',
      query: {
        familyPath: 'sales-trend',
        ...(granularity === undefined ? {} : { granularity }),
      },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString();
};

const monthKey = (isoDate: string) => isoDate.slice(0, 7);

function activeSale(over: Record<string, unknown> = {}) {
  const id =
    typeof over.id === 'string'
      ? over.id
      : `bbbbbbbb-0000-4000-8000-00000000${String(Math.floor(Math.random() * 9000) + 1000)}`;
  return {
    id,
    sale_number: `SALE-${id.slice(-8).toUpperCase()}`,
    customer_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    plan_id: '99999999-9999-4999-8999-999999999991',
    seller_type: 'staff',
    seller_staff_id: '00000000-0000-4000-8000-000000000001',
    seller_ost_id: null,
    cash_price_snapshot: '60000.00',
    payment_scheme: 'spot_cash',
    status: 'active',
    submitted_at: daysAgo(10),
    created_at: daysAgo(10),
    activated_at: daysAgo(1),
    fully_paid_at: daysAgo(2),
    payment_verified_at: daysAgo(2),
    spot_cash_started_at: null,
    spot_cash_deadline: null,
    referral_relationship_id: null,
    ...over,
  };
}

beforeEach(() => install());

describe('GET /analytics/sales-trend (JAD Sales Overview parity)', () => {
  it('routes through the analytics family without a router change', () => {
    const match = selectHandler('/api/v1/analytics/sales-trend', {});
    expect(match?.routeKey).toBe('analytics/sales-trend');
  });

  it('defaults to month, returns 12 continuous zero-filled buckets, and validates the contract', async () => {
    const state = await call(TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = salesTrendReportSchema.parse(state.body);
    expect(parsed.granularity).toBe('month');
    expect(parsed.periods).toHaveLength(12);
    const now = new Date();
    const expectedLast = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(parsed.periods.at(-1)?.key).toBe(expectedLast);
    // Continuous keys, oldest first.
    for (let i = 1; i < parsed.periods.length; i += 1) {
      expect(parsed.periods[i]!.key > parsed.periods[i - 1]!.key).toBe(true);
    }
  });

  it('counts only the qualifying (active) fixture sale in its submission month', async () => {
    const state = await call(TOKEN.superAdmin);
    const parsed = salesTrendReportSchema.parse(state.body);
    const withSales = parsed.periods.filter((p) => p.count > 0);
    // Fixture world holds exactly one active sale; pipeline
    // (submitted/payment_pending/payment_in_progress/payment_verified) is excluded.
    expect(withSales).toHaveLength(1);
    const active = (holder.db as FakeSupabase).rows('card_sales').find((r) => r.id === SALE.active)!;
    expect(withSales[0]).toEqual({
      key: monthKey(String(active.submitted_at)),
      count: 1,
      total: '60000.00',
    });
  });

  it('aggregates yearly from the earliest qualifying year with exact-decimal sums', async () => {
    const db = holder.db as FakeSupabase;
    const thisYear = new Date().getUTCFullYear();
    db.rows('card_sales').push(
      activeSale({ id: 'bbbbbbbb-0000-4000-8000-000000000101', submitted_at: daysAgo(400), created_at: daysAgo(400), cash_price_snapshot: '0.10' }),
      activeSale({ id: 'bbbbbbbb-0000-4000-8000-000000000102', submitted_at: daysAgo(5), created_at: daysAgo(5), cash_price_snapshot: '0.20' }),
    );
    const state = await call(TOKEN.superAdmin, 'year');
    expect(state.status).toBe(200);
    const parsed = salesTrendReportSchema.parse(state.body);
    expect(parsed.granularity).toBe('year');
    expect(parsed.periods[0]?.key).toBe(String(thisYear - 1));
    expect(parsed.periods.at(-1)?.key).toBe(String(thisYear));
    const lastYear = parsed.periods.find((p) => p.key === String(thisYear - 1))!;
    expect(lastYear.count).toBe(1);
    expect(lastYear.total).toBe('0.10');
    // 0.10 + 0.20 as exact decimals, never 0.30000000000000004.
    const current = parsed.periods.find((p) => p.key === String(thisYear))!;
    expect(current.total).toBe('60000.20');
    expect(current.count).toBe(2);
  });

  it('skips corrupt rows without failing the read and excludes cancelled sales', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('card_sales').push(
      activeSale({ id: 'bbbbbbbb-0000-4000-8000-000000000103', cash_price_snapshot: '1,000.00' }),
      activeSale({ id: 'bbbbbbbb-0000-4000-8000-000000000104', submitted_at: 'not-a-date', created_at: 'not-a-date' }),
      activeSale({ id: 'bbbbbbbb-0000-4000-8000-000000000105', status: 'cancelled' }),
    );
    const state = await call(TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = salesTrendReportSchema.parse(state.body);
    expect(parsed.periods.filter((p) => p.count > 0)).toHaveLength(1);
    expect(parsed.periods.reduce((sum, p) => sum + p.count, 0)).toBe(1);
  });

  it('400s on an invalid granularity', async () => {
    const state = await call(TOKEN.superAdmin, 'week');
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('denies unauthenticated callers and callers without dashboard.view', async () => {
    expect((await call()).status).toBe(401);
    const db = holder.db as FakeSupabase;
    const bareRole = {
      id: '20202020-0000-4000-8000-000000000099',
      slug: 'noaccess',
      name: 'No Access',
      is_system: false,
      is_active: true,
    };
    db.rows('roles').push(bareRole);
    db.rows('staff_role_assignments').find((row) => row.staff_id === STAFF2.ost)!.role_id =
      bareRole.id;
    expect((await call(TOKEN2.ost)).status).toBe(403);
  });

  it('enforces role scope: self sees only its own qualifying sales, team without snapshots sees none', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('card_sales').push(
      activeSale({
        id: 'bbbbbbbb-0000-4000-8000-000000000106',
        seller_staff_id: STAFF2.ost,
        submitted_at: daysAgo(3),
        created_at: daysAgo(3),
      }),
    );
    const self = salesTrendReportSchema.parse((await call(TOKEN2.ost)).body);
    expect(self.periods.reduce((sum, p) => sum + p.count, 0)).toBe(1);
    // The OST sale is outside the SM's snapshot chain, so the team view stays empty.
    const team = salesTrendReportSchema.parse((await call(TOKEN2.salesManager)).body);
    expect(team.periods.reduce((sum, p) => sum + p.count, 0)).toBe(0);
    const global = salesTrendReportSchema.parse((await call(TOKEN.superAdmin)).body);
    expect(global.periods.reduce((sum, p) => sum + p.count, 0)).toBe(2);
  });

  it('does not leak database internals on failure', async () => {
    holder.db = new FakeSupabase({
      tables: phase2World({ card_sale_hierarchy_snapshots: [], redemptions: [] }),
      tokens: phase2WorldTokens(),
      errors: { card_sales: { message: 'secret database detail' } },
    });
    const state = await call(TOKEN.superAdmin);
    expect(state.status).toBe(500);
    expect(JSON.stringify(state.body)).not.toContain('secret database detail');
  });
});
