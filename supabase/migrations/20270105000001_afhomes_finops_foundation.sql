-- AF Homes: Financial Operations foundation (Phase 1 of the 12 Nov 2026 brief).
--
-- Adds ONLY structure. No rate, amount, target or threshold is seeded and no
-- existing behaviour changes:
--   1. Payroll authority as ordinary dynamic-RBAC modules (no hardcoded role
--      names anywhere): Finance reviews/submits/records disbursements; approval,
--      period closing and compensation policy are separate modules that no role
--      row grants - only super_admin holds them (it holds every module by slug),
--      and they can be delegated later through role management.
--   2. public.ist_compensation_policies: effective-dated BA/PA/PB configuration.
--      EMPTY by design. The historical contract/workbook figures are unapproved
--      and exist only as test fixtures (packages/shared/src/ist-payroll.spec.ts).
--      Payroll stays "Configuration Required" until an approved row exists.
-- Validation: pnpm test:db:local (section 80); supabase/security/rls_invariants.sql.
--   select key from public.modules where key like 'finance.payroll%' order by 1;  -- 4 rows
--   select count(*) from public.ist_compensation_policies;                        -- 0
-- Down: forward only. Removing the modules would orphan delegated permissions.
begin;

-- ---------------------------------------------------------------------------
-- 1. Payroll permissions (module x view/create/update, like every other module)
-- ---------------------------------------------------------------------------
insert into public.modules (key, name, group_name, sort_order) values
  ('finance.payroll',          'IST Payroll',            'Finance', 45),
  ('finance.payroll_approval', 'IST Payroll Approval',   'Finance', 46),
  ('finance.payroll_close',    'Payroll Period Closing', 'Finance', 47),
  ('finance.payroll_policy',   'Compensation Policy',    'Finance', 48)
on conflict (key) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

-- Finance: view the workspace, submit batches (create), record disbursements (update).
-- Deliberately NO row for approval / close / policy, and none for SM, SSM or SVD.
insert into public.role_permissions
  (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, true, true, false
from public.roles r
join public.modules m on m.key = 'finance.payroll'
where r.slug = 'finance'
on conflict (role_id, module_id) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

-- ---------------------------------------------------------------------------
-- 2. Effective-dated compensation policy (empty until an approved policy exists)
-- ---------------------------------------------------------------------------
create table if not exists public.ist_compensation_policies (
  id uuid primary key default gen_random_uuid(),
  rank text not null check (rank in ('SM','SSM','SVD')),
  monthly_ba text not null check (monthly_ba ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  ba_target text not null check (ba_target ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  monthly_pa text not null check (monthly_pa ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  pa_target text not null check (pa_target ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  pb_target text not null check (pb_target ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  pb_rate text not null check (pb_rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'),
  collection_gate text not null check (collection_gate ~ '^(0\.[0-9]{1,4}|1(\.0{1,4})?)$'),
  effective_from date not null,
  effective_until date,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  basis_note text not null check (length(btrim(basis_note)) >= 5),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references public.staff_users(id) on delete restrict,
  approved_at timestamptz,
  check (effective_until is null or effective_until >= effective_from),
  -- A policy is payable only once someone has approved it, on the record.
  check ((status = 'draft') = (approved_by is null and approved_at is null))
);
comment on table public.ist_compensation_policies is
  'Effective-dated BA/PA/PB configuration per IST rank. Only APPROVED rows may produce payable payroll. Approved rows are never edited: a change is a new row with a later effective_from.';

-- Approved and retired rows are history: figures and window start never change.
create or replace function private.protect_ist_compensation_policy() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (
       new.rank, new.monthly_ba, new.ba_target, new.monthly_pa, new.pa_target, new.pb_target,
       new.pb_rate, new.collection_gate, new.effective_from, new.created_by, new.approved_by, new.approved_at
     ) is distinct from (
       old.rank, old.monthly_ba, old.ba_target, old.monthly_pa, old.pa_target, old.pb_target,
       old.pb_rate, old.collection_gate, old.effective_from, old.created_by, old.approved_by, old.approved_at
     ) then
    raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  -- The basis note is part of the approval record, and a window can only be
  -- CLOSED once (to make room for the next policy); it is never shortened or
  -- reopened, so a past period can never lose the policy that paid it.
  if old.status <> 'draft' and (
       new.basis_note is distinct from old.basis_note
       or (old.effective_until is not null and new.effective_until is distinct from old.effective_until)
     ) then
    raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;

-- One approved policy per rank per day: approved windows may not overlap.
create or replace function private.ist_compensation_policy_no_overlap() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status <> 'approved' then return new; end if;
  -- Serialize approvals per rank so two concurrent approvals cannot both pass.
  perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || new.rank));
  if exists (
    select 1 from public.ist_compensation_policies p
     where p.id <> new.id and p.rank = new.rank and p.status = 'approved'
       and p.effective_from <= coalesce(new.effective_until, 'infinity'::date)
       and coalesce(p.effective_until, 'infinity'::date) >= new.effective_from
  ) then
    raise exception 'COMPENSATION_POLICY_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function private.ist_compensation_policy_no_overlap() from public, anon, authenticated, service_role;
drop trigger if exists ist_compensation_policies_no_overlap on public.ist_compensation_policies;
create trigger ist_compensation_policies_no_overlap
  before insert or update on public.ist_compensation_policies
  for each row execute function private.ist_compensation_policy_no_overlap();
revoke all on function private.protect_ist_compensation_policy() from public, anon, authenticated, service_role;
drop trigger if exists ist_compensation_policies_protect on public.ist_compensation_policies;
create trigger ist_compensation_policies_protect
  before update or delete on public.ist_compensation_policies
  for each row execute function private.protect_ist_compensation_policy();

-- Staff-only and unexposed: no browser role can read or write compensation.
alter table public.ist_compensation_policies enable row level security;
revoke all on public.ist_compensation_policies from public, anon, authenticated;

-- The one approved policy for a rank on a date, or nothing ("Configuration Required").
create or replace function private.ist_compensation_policy_for(p_rank text, p_on date)
returns public.ist_compensation_policies
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select p.* from public.ist_compensation_policies p
   where p.rank = p_rank and p.status = 'approved'
     and p.effective_from <= p_on
     and (p.effective_until is null or p.effective_until >= p_on)
$$;
revoke all on function private.ist_compensation_policy_for(text, date) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
