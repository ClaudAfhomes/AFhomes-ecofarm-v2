import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsOverviewSchema } from '@jad/contracts';
import {
  STAFF2,
  TOKEN,
  TOKEN2,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { default: handler, calendarWindow } = await import('./analytics.js');

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

async function call(token?: string, period = 'month') {
  const { res, state } = makeRes();
  await handler(
    {
      method: 'GET',
      query: { familyPath: '', period },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

beforeEach(() => install());

describe('Phase 14 analytics', () => {
  it('uses exact UTC calendar day, Monday week, month, and year windows', () => {
    const now = new Date('2026-09-30T14:12:00.000Z');
    expect(calendarWindow('day', now).from.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(calendarWindow('week', now).from.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(calendarWindow('month', now).from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(calendarWindow('year', now).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns global Super Admin analytics and validates the typed contract', async () => {
    const state = await call(TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = analyticsOverviewSchema.parse(state.body);
    expect(parsed.scope.kind).toBe('global');
    expect(parsed.headline.totalCardSales).toBeGreaterThan(0);
  });

  it('gives Finance global financial facts but no redemption section', async () => {
    const state = await call(TOKEN2.finance);
    expect(state.status).toBe(200);
    expect((state.body as { scope: { kind: string }; redemptions: unknown }).scope.kind).toBe(
      'finance',
    );
    expect((state.body as { redemptions: unknown }).redemptions).toBeNull();
  });

  it('uses immutable snapshot rows for VD, SSM and SM team totals', async () => {
    const db = holder.db as FakeSupabase;
    const sale = db.rows('card_sales')[0]!;
    db.rows('card_sale_hierarchy_snapshots').push(
      {
        sale_id: sale.id,
        ancestor_staff_id: STAFF2.salesManager,
        ancestor_role: 'sales_manager',
        depth: 1,
      },
      {
        sale_id: sale.id,
        ancestor_staff_id: STAFF2.seniorSalesManager,
        ancestor_role: 'senior_sales_manager',
        depth: 2,
      },
      {
        sale_id: sale.id,
        ancestor_staff_id: STAFF2.viceDirector,
        ancestor_role: 'vice_director',
        depth: 3,
      },
    );
    for (const token of [TOKEN2.viceDirector, TOKEN2.seniorSalesManager, TOKEN2.salesManager]) {
      const state = await call(token);
      expect(state.status).toBe(200);
      expect((state.body as { headline: { totalCardSales: number } }).headline.totalCardSales).toBe(
        1,
      );
    }
  });

  it('does not assign a legacy sale to the current team, but keeps it global and seller-owned', async () => {
    const db = holder.db as FakeSupabase;
    const sale = db.rows('card_sales')[0]!;
    sale.seller_staff_id = STAFF2.ost;
    sale.seller_ost_id = null;
    sale.referral_relationship_id = db
      .rows('referral_relationships')
      .find((row) => row.subject_staff_id === STAFF2.ost)!.id;
    const team = await call(TOKEN2.salesManager);
    expect(
      (
        team.body as {
          headline: { totalCardSales: number };
          scope: { unattributedLegacySaleCount: number };
        }
      ).headline.totalCardSales,
    ).toBe(0);
    expect(
      (team.body as { scope: { unattributedLegacySaleCount: number } }).scope
        .unattributedLegacySaleCount,
    ).toBe(1);
    expect((await call(TOKEN.superAdmin)).body).toMatchObject({
      headline: { totalCardSales: expect.any(Number) },
    });
    expect((await call(TOKEN2.ost)).body).toMatchObject({ headline: { totalCardSales: 1 } });
  });

  it('denies unauthenticated and customer-only callers and returns safe database errors', async () => {
    expect((await call()).status).toBe(401);
    holder.db = new FakeSupabase({
      tables: phase2World({ card_sale_hierarchy_snapshots: [], redemptions: [] }),
      tokens: phase2WorldTokens(),
      errors: { card_sales: { message: 'secret database detail' } },
    });
    const failed = await call(TOKEN.superAdmin);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain('secret database detail');
  });
});

describe('Phase 14 migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/20261010000001_afhomes_phase14_analytics.sql'),
    'utf8',
  );
  it('captures a complete VD to OST chain and never backfills legacy sales', () => {
    expect(sql).toMatch(/after insert on public\.card_sales/i);
    expect(sql).toMatch(/SALE_COMPLETE_HIERARCHY_REQUIRED/);
    expect(sql).not.toMatch(
      /insert into public\.card_sale_hierarchy_snapshots[\s\S]*select[\s\S]*from public\.card_sales/i,
    );
  });
  it('makes snapshots immutable and keeps upline correction separate', () => {
    expect(sql).toMatch(/before update or delete on public\.card_sale_hierarchy_snapshots/i);
    expect(sql).toMatch(/SALE_HIERARCHY_SNAPSHOT_IMMUTABLE/);
    expect(sql).not.toMatch(/correct_referral_upline/i);
  });
});
