import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const benefitsSql = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20261018000001_afhomes_official_vip_benefits.sql'),
  'utf8',
);
const commissionSql = readFileSync(
  resolve(
    process.cwd(),
    '../supabase/migrations/20261018000002_afhomes_flexible_commission_rules.sql',
  ),
  'utf8',
);
const formsSql = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20261018000003_afhomes_official_forms.sql'),
  'utf8',
);

describe('official VIP benefits migration', () => {
  it.each([
    ['BRONZE', 10000, 15, 5, 1, 5, '50000.00'],
    ['SILVER', 20000, 20, 10, 1, 10, '200000.00'],
    ['GOLD', 25000, 25, 20, 2, 20, '500000.00'],
  ])(
    '%s carries the official structured benefit values',
    (code, points, discount, base, holders, tranches, total) => {
      expect(benefitsSql).toContain(`when '${code}' then ${points}`);
      expect(benefitsSql).toContain(`when '${code}' then ${discount}`);
      expect(benefitsSql).toContain(`when '${code}' then ${base}`);
      if (code === 'GOLD') expect(benefitsSql).toContain("when 'GOLD' then 2 else 1");
      expect(benefitsSql).toContain(`when '${code}' then ${tranches}`);
      expect(benefitsSql).toContain(`when '${code}' then '${total}'`);
      expect(holders).toBe(code === 'GOLD' ? 2 : 1);
    },
  );

  it('updates plan configuration without touching historical points state', () => {
    expect(benefitsSql).toMatch(/update public\.card_plans/i);
    expect(benefitsSql).not.toMatch(
      /update public\.(memberships|points_accounts|points_ledger|card_sales)/i,
    );
  });
});

describe('official forms transaction migration', () => {
  it('uses normalized headers and details with immutable master references', () => {
    for (const table of [
      'customer_applications',
      'customer_application_holders',
      'reservation_agreements',
      'reservation_agreement_holders',
      'reservation_agreement_schedule',
    ])
      expect(formsSql).toContain(`create table public.${table}`);
    expect(formsSql).not.toMatch(/holder1|holder2|payment1|payment2|payment3/i);
    expect(formsSql).toContain('SECONDARY_HOLDER_GOLD_ONLY');
  });
  it('keeps browser roles read-only and applies RLS to every new table', () => {
    expect(formsSql).toContain('enable row level security');
    expect(formsSql).toContain('revoke all on public.%I from anon, authenticated');
    expect(formsSql).toContain('grant select on public.%I to authenticated');
  });
  it('uses explicit lifecycle dates and atomic service-role-only header/detail RPCs', () => {
    for (const column of ['submitted_at', 'approved_at', 'rejected_at', 'executed_at'])
      expect(formsSql).toContain(column);
    expect(formsSql).toContain("status in ('draft','submitted','approved','rejected','cancelled')");
    expect(formsSql).toContain('save_customer_application');
    expect(formsSql).toContain('save_reservation_agreement');
    expect(formsSql).toContain('grant execute on function public.save_customer_application');
    expect(formsSql).toContain('to service_role');
  });
  it('keeps payment schedules separate from actual payment rows', () => {
    expect(formsSql).toContain('reservation_agreement_schedule');
    expect(formsSql).toContain(
      "from public.payments where sale_id=v_sale.id and status='verified'",
    );
    expect(formsSql).not.toMatch(/insert into public\.payments/i);
  });
});

describe('flexible single-level commission migration', () => {
  it('uses deterministic non-stacking precedence and a zero default', () => {
    expect(commissionSql).toContain(
      'order by case when r.target_type = p_seller_type then 0 else 1 end',
    );
    expect(commissionSql).toContain('limit 1');
    expect(commissionSql).toContain("select null::uuid, '0'::text");
    expect(commissionSql).toContain('COMMISSION_RULE_OVERLAP');
  });

  it('does not rewrite historical sale or commission snapshots', () => {
    expect(commissionSql).not.toMatch(/update public\.(card_sales|commissions)/i);
  });
});
