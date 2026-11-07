import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const chainSql = readFileSync(
  resolve(
    process.cwd(),
    '../supabase/migrations/20261131000002_afhomes_application_referral_staff.sql',
  ),
  'utf8',
);

describe('application referral-chain migration', () => {
  it('links every chain level to staff with restricted references', () => {
    for (const column of ['svd_staff_id', 'ssm_staff_id', 'sm_staff_id', 'referrer_staff_id'])
      expect(chainSql).toContain(column);
    expect(chainSql).toContain('references public.staff_users(id) on delete restrict');
    expect(chainSql).toContain('add column if not exists');
  });

  it('resolves ids against active staff with the exact level role', () => {
    expect(chainSql).toContain("('svd', 'vice_director'");
    expect(chainSql).toContain("('ssm', 'senior_sales_manager'");
    expect(chainSql).toContain("('sm', 'sales_manager'");
    expect(chainSql).toContain("('referrer', 'ost'");
    expect(chainSql).toContain('SELLER_INACTIVE');
    expect(chainSql).toContain('SELLER_ROLE_NOT_A_SELLER');
    expect(chainSql).toContain('SUBJECT_NOT_FOUND');
  });

  it('refuses a disagreeing chain but allows gaps', () => {
    // Agreement walks referral_relationships ancestry; the ordered levels let
    // a missing middle level pass while a contradiction raises.
    expect(chainSql).toContain('referral_relationships');
    expect(chainSql).toContain('INVALID_HIERARCHY');
    expect(chainSql).toContain("values ('svd', 1), ('ssm', 2), ('sm', 3), ('referrer', 4)");
  });

  it('snapshots Organization names from ids and keeps legacy text otherwise', () => {
    // An id snapshots staff_users.full_name; client text for those names is
    // ignored, while a level with no id keeps the legacy nullif passthrough.
    expect(chainSql).toContain('u.full_name as full_name');
    expect(chainSql).toContain("nullif(p_header->>'svdName','')");
    // The join compares as text: casting the untrusted value would let a
    // malformed id escape as a 500 instead of the subject refusal.
    expect(chainSql).toContain('u.id::text = lower(s.raw_id)');
  });

  it('re-delivers the same RPC without broadening its grants', () => {
    expect(chainSql).toContain(
      'create or replace function public.save_customer_application(',
    );
    expect(chainSql).toContain(
      'revoke all on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated',
    );
    expect(chainSql).toContain('grant execute on function public.save_customer_application');
    expect(chainSql).toContain('to service_role');
    expect(chainSql).not.toMatch(/update public\.(customers|card_sales|commissions)/i);
  });
});
