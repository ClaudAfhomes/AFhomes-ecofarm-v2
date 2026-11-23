-- AF Homes flexible, single-level commission rules.
-- No historical sale or commission snapshot is rewritten. New eligible sales
-- resolve exactly one rule: account-specific, then role default, then 0%.
-- Down: forward-only; disable rules and deploy a later compatibility migration.

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('role','staff','ost')),
  target_id uuid not null,
  rate text not null check (rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'),
  effective_from date not null,
  effective_until date,
  accredited_on_or_after date,
  is_active boolean not null default true,
  created_by uuid not null references public.staff_users(id) on delete restrict,
  updated_by uuid references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

comment on table public.commission_rules is
  'Prospective single-level rates. Rules never stack and never rewrite frozen commission history.';

create index if not exists commission_rules_lookup_idx
  on public.commission_rules(target_type, target_id, effective_from, effective_until)
  where is_active;

create or replace function private.reject_overlapping_commission_rule()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_active and exists (
    select 1 from public.commission_rules r
    where r.id <> new.id and r.is_active
      and r.target_type = new.target_type and r.target_id = new.target_id
      and daterange(r.effective_from, coalesce(r.effective_until + 1, 'infinity'::date), '[)')
          && daterange(new.effective_from, coalesce(new.effective_until + 1, 'infinity'::date), '[)')
  ) then
    raise exception 'COMMISSION_RULE_OVERLAP';
  end if;
  return new;
end $$;

drop trigger if exists commission_rules_no_overlap on public.commission_rules;
create trigger commission_rules_no_overlap before insert or update on public.commission_rules
for each row execute function private.reject_overlapping_commission_rule();

alter table public.card_sales
  add column if not exists commission_rule_id uuid references public.commission_rules(id) on delete restrict,
  add column if not exists commission_base_snapshot text
    check (commission_base_snapshot is null or commission_base_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$');

alter table public.card_sales drop constraint if exists card_sales_commission_rate_snapshot_check;
alter table public.card_sales add constraint card_sales_commission_rate_snapshot_check
  check (commission_rate_snapshot is null or commission_rate_snapshot ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$');

alter table public.commissions
  add column if not exists commission_rule_id uuid references public.commission_rules(id) on delete restrict;

-- A 0% default is a legal commission: the sale still freezes a (zero) row so
-- history shows "no rate applied" instead of "no row". Phase 1 required
-- amount >= 1.00, which rejects a '0.00' row on real PostgreSQL (found by
-- test:db:local section 5). Widen to the standard money regex; historical
-- non-zero rows are untouched.
alter table public.commissions drop constraint if exists commissions_amount_check;
alter table public.commissions add constraint commissions_amount_check
  check (amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$');

-- Same 0%-default widening for the frozen rate: Phase 2 allowed only
-- 0.xxxx, which rejects a resolved '0' rate on real PostgreSQL (found by
-- test:db:local section 5). Historical non-zero snapshots are untouched.
alter table public.commissions drop constraint if exists commissions_rate_snapshot_check;
alter table public.commissions add constraint commissions_rate_snapshot_check
  check (rate_snapshot is null or rate_snapshot ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$');

alter table public.commission_rules enable row level security;
revoke all on public.commission_rules from anon, authenticated;
grant select on public.commission_rules to authenticated;
create policy commission_rules_read on public.commission_rules for select to authenticated
  using (private.has_permission('network.commissions'));

create or replace function public.resolve_commission_rule(
  p_seller_type text,
  p_seller_id uuid,
  p_sale_date date
)
returns table(rule_id uuid, rate text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role_id uuid;
  v_accredited date;
begin
  if p_seller_type = 'staff' then
    select sra.role_id, coalesce(su.activated_at::date, su.created_at::date)
      into v_role_id, v_accredited
      from public.staff_users su
      left join public.staff_role_assignments sra on sra.staff_id = su.id
     where su.id = p_seller_id and su.status = 'active';
  elsif p_seller_type = 'ost' then
    select r.id, om.approved_at::date into v_role_id, v_accredited
      from public.ost_members om
      left join public.roles r on r.slug = 'ost'
     where om.id = p_seller_id and om.status = 'active';
  else
    return query select null::uuid, '0'::text;
    return;
  end if;

  return query
  select r.id, r.rate from public.commission_rules r
   where r.is_active and p_sale_date >= r.effective_from
     and (r.effective_until is null or p_sale_date <= r.effective_until)
     and (r.accredited_on_or_after is null or v_accredited >= r.accredited_on_or_after)
     and ((r.target_type = p_seller_type and r.target_id = p_seller_id)
       or (r.target_type = 'role' and r.target_id = v_role_id))
   order by case when r.target_type = p_seller_type then 0 else 1 end
   limit 1;
  if not found then return query select null::uuid, '0'::text; end if;
end $$;

revoke all on function public.resolve_commission_rule(text, uuid, date) from public, anon, authenticated;
grant execute on function public.resolve_commission_rule(text, uuid, date) to service_role;

-- Plan-level 4% is no longer authoritative for future Bronze/Silver/Gold
-- sales. Historical card_sales/commissions retain their frozen rate/amount.
alter table public.card_plans drop constraint if exists card_plans_commission_rate_check;
alter table public.card_plans add constraint card_plans_commission_rate_check
  check (commission_rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$');
update public.card_plans set commission_rate = '0', updated_at = now()
where code in ('BRONZE','SILVER','GOLD');
