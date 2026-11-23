-- ===========================================================================
-- Phase 19: card-plan manageability (description + widened plan economics)
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- Phase 19 turns the Card Products screen into a fully manageable Card Plan
-- module. The `card_plans` catalogue already carries `is_active` and
-- `sort_order`, but it has no `description` column, and two Phase 1 CHECKs
-- are stricter than the Phase 19 business rules:
--
--   * `yearly_points > 0` rejects a plan with zero points, while the rule is
--     `yearly_points >= 0`.
--   * `commission_rate ~ '^0\.[0-9]{1,4}$'` rejects the boundary rates `0`
--     and `1`, while the rule is `0 <= commission_rate <= 1`.
--
-- This migration is ADDITIVE and widening-only:
--
--   * one new nullable column (`description`), no backfill, no default;
--   * two CHECKs relaxed, never tightened - every row valid before is still
--     valid after, so Bronze/Silver/Gold economics are untouched;
--   * no RLS change (the existing table-wide SELECT grant covers the new
--     column automatically), no index change, no foreign-key change, and no
--     write to any historical sale snapshot.
--
-- The CHECK relaxations cannot name the old constraints directly: inline
-- `CHECK`s receive auto-generated names, so the DO blocks below drop ANY
-- check constraint whose definition mentions the column (except the canonical
-- replacement) and then install the canonical one exactly once.
--
-- VALIDATION (run on a real PostgreSQL; `pnpm test:db:local` proves all six):
--
--   1. select column_name from information_schema.columns
--        where table_schema = 'public' and table_name = 'card_plans'
--          and column_name = 'description';                       -- one row
--   2. select code, cash_price, minimum_down_payment, yearly_points,
--        commission_rate from public.card_plans
--        where code in ('BRONZE','SILVER','GOLD') order by code;
--        -- BRONZE 30000.00/10000.00/25000/0.04,
--        -- SILVER 40000.00/15000.00/40000/0.04,
--        -- GOLD   60000.00/20000.00/60000/0.04 (unchanged)
--   3. select count(*) from public.card_sales;  -- unchanged by this file
--   4. select count(*) from public.card_plans
--        where cash_price = '0' or cash_price = '0.00';          -- zero rows
--   5. select conname, pg_get_constraintdef(oid) from pg_constraint
--        where conrelid = 'public.card_plans'::regclass and contype = 'c';
--        -- exactly one yearly_points CHECK (>= 0) and exactly one
--        -- commission_rate CHECK (0..1); no duplicates on re-apply
--   6. RLS invariants: supabase/security/rls_invariants.sql returns empty.
--
-- DOWN (operator-only, data loss on description):
--
--   alter table public.card_plans drop constraint
--     card_plans_yearly_points_check;
--   alter table public.card_plans add constraint
--     card_plans_yearly_points_check check (yearly_points > 0);
--   alter table public.card_plans drop constraint
--     card_plans_commission_rate_check;
--   alter table public.card_plans add constraint
--     card_plans_commission_rate_check
--     check (commission_rate ~ '^0\.[0-9]{1,4}$');
--   alter table public.card_plans drop column description;
--
--   The down path is documented, not automated: dropping `description`
--   destroys plan copy, and re-tightening the CHECKs fails if any plan
--   created under the widened rules violates the old bounds.

-- 1. Plan copy. Nullable, no default: existing rows read back as NULL.
alter table public.card_plans
  add column if not exists description text;

comment on column public.card_plans.description is
'Optional marketing copy for the Card Plans screen and future storefronts. Never part of a sale snapshot.';

-- 2. Widen yearly_points to >= 0 (was > 0).
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'card_plans'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%yearly_points%'
      and c.conname <> 'card_plans_yearly_points_check'
  loop
    execute format('alter table public.card_plans drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'card_plans'
      and c.conname = 'card_plans_yearly_points_check'
  ) then
    alter table public.card_plans
      add constraint card_plans_yearly_points_check check (yearly_points >= 0);
  end if;
end
$$;

-- 3. Widen commission_rate to the closed interval 0..1 with up to 4 decimals
-- (was 0.xxxx only, so the boundary rates 0 and 1 were rejected).
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'card_plans'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%commission_rate%'
      and c.conname <> 'card_plans_commission_rate_check'
  loop
    execute format('alter table public.card_plans drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'card_plans'
      and c.conname = 'card_plans_commission_rate_check'
  ) then
    alter table public.card_plans
      add constraint card_plans_commission_rate_check
      check (commission_rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$');
  end if;
end
$$;
