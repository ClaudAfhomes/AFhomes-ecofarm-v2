import { describe, expect, it } from 'vitest';
import { FakeSupabase } from './testing/supabase-fake.js';
import { commissionRoster } from './commission-roster.js';
import type { Db } from './handler-kit.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = () =>
  new FakeSupabase({
    tables: {
      roles: [{ id: id(1), slug: 'sales_manager', name: 'Sales Manager', is_active: true }],
      staff_role_assignments: [
        { staff_id: id(2), role_id: id(1) },
        { staff_id: id(3), role_id: id(1) },
      ],
      staff_users: [
        { id: id(2), full_name: 'ANA CRUZ', status: 'active', activated_at: '2025-01-01' },
        { id: id(3), full_name: 'BEN SANTOS', status: 'active', activated_at: '2025-01-01' },
      ],
      ost_members: [],
      card_sales: [
        { id: id(4), seller_staff_id: id(2), status: 'active', created_at: '2026-01-01' },
      ],
      commission_rules: [
        {
          id: id(5),
          target_type: 'role',
          target_id: id(1),
          rate: '0.05',
          is_active: true,
          effective_from: '2020-01-01',
          effective_until: null,
        },
        {
          id: id(6),
          target_type: 'staff',
          target_id: id(2),
          rate: '0.07',
          is_active: true,
          effective_from: '2020-01-01',
          effective_until: null,
        },
      ],
    },
  });
describe('Supabase commission settings roster', () => {
  it('previews a personal override, a position default, counts and pagination without touching snapshots', async () => {
    const source = db();
    const result = await commissionRoster(source as unknown as Db, { limit: 1 });
    expect(result.total).toBe(2);
    expect(result.positions[0]?.memberCount).toBe(2);
    expect(result.members[0]).toMatchObject({
      name: 'ANA CRUZ',
      rate: '0.07',
      source: 'custom',
      salesCount: 1,
    });
    const page = await commissionRoster(source as unknown as Db, { offset: 1 });
    expect(page.members[0]).toMatchObject({ name: 'BEN SANTOS', rate: '0.05', source: 'position' });
    expect(source.rows('card_sales')[0]).not.toHaveProperty('commission_rate_snapshot');
  });
  it('filters literally and counts missing rates only for sellers with a sale', async () => {
    const source = db();
    source.rows('commission_rules').forEach((rule) => {
      rule.is_active = false;
    });
    const result = await commissionRoster(source as unknown as Db, {
      needsRate: 'true',
      search: 'CRUZ',
      sales: 'with',
    });
    expect(result.total).toBe(1);
    expect(result.needsRateCount).toBe(1);
    expect(result.members[0]?.rate).toBe('0');
    expect((await commissionRoster(source as unknown as Db, { search: '%' })).total).toBe(0);
  });
  it('does not apply future, expired, or accreditation-ineligible rules', async () => {
    const source = db();
    source.rows('commission_rules')[0]!.effective_from = '2999-01-01';
    source.rows('commission_rules')[1]!.accredited_on_or_after = '2999-01-01';
    expect((await commissionRoster(source as unknown as Db, {})).members[0]?.source).toBe('none');
  });
});
