-- AF Homes sale-team accreditation: the superseded-number history.
--
-- A transfer changes a member's accreditation KIND (IST <-> OST). The holder's
-- current row in `private.sale_team_accreditations` is keyed by `staff_id`, so
-- the replaced row cannot stay there - but the number it held must never be
-- forgotten, silently reused, or renumbered. Every transfer therefore appends
-- one immutable history row for the number that was retired, carrying the
-- successor number, and the transfer itself is the only writer.
--
-- Why a table and not the audit trail: the audit JSON cannot resolve a number
-- back to a person (no index on the payload, and the number lives inside
-- JSON), so an operator scanning a retired card would get "not found" - wrong,
-- and indistinguishable from a forged card. This table makes the answer exact.
--
-- Trade-offs, deliberate:
-- - The table holds no endorsement, no documents and no government data: the
--   queried number, the holder's public name, the period, and the successor.
-- - No backfill. Nothing has ever been transferred (transfers did not exist),
--   so the table starts empty; a revoked accreditation is still in the
--   accreditation table and is not history.
-- - Only a kind change writes history. Editing a name or dates never retires
--   a number, so it never appends a row.
--
-- Dependencies: 20261130000001 (accreditation table and lookups). Re-run: it is
-- idempotent (create table if not exists, create or replace, drop trigger if
-- exists).
--
-- Validation after apply (expected):
--   select to_regclass('private.sale_team_accreditation_history') is not null; -- true
--   select count(*) from private.sale_team_accreditation_history; -- 0
--   select checked_role from (values('anon'),('authenticated'),('service_role')) r(checked_role)
--     where has_table_privilege(checked_role,'private.sale_team_accreditation_history',
--       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'); -- zero rows
--   select relrowsecurity from pg_class
--    where oid='private.sale_team_accreditation_history'::regclass; -- true
--   select public.resolve_sale_team_accreditation_number('AA-000000000000'); -- null
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): drop the resolver, the trigger and the
-- table. Retired numbers then become unresolvable again; never re-issue them.
begin;

create table if not exists private.sale_team_accreditation_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users(id) on delete restrict,
  aa_number text not null,
  kind text not null check(kind in ('IST','OST')),
  public_name text not null,
  starts_on date not null,
  expires_on date not null,
  -- Only 'superseded' is legal today. A future revocation history must widen
  -- this CHECK on purpose, in its own migration.
  status text not null default 'superseded' check(status in ('superseded')),
  event text not null check(event in ('transferred')),
  successor_aa_number text,
  reason text,
  recorded_by uuid not null references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  check(expires_on>=starts_on),
  check(successor_aa_number is null or successor_aa_number<>aa_number),
  -- One row per number per event: a retried transfer cannot append twice.
  unique(aa_number,event)
);
alter table private.sale_team_accreditation_history enable row level security;
revoke all on private.sale_team_accreditation_history from public,anon,authenticated,service_role;
create index if not exists sale_team_accreditation_history_staff_idx
  on private.sale_team_accreditation_history(staff_id);

-- A recorded retirement is a fact, not a draft: UPDATE is refused outright.
-- DELETE is refused by privilege, not by trigger: no runtime role (public,
-- anon, authenticated or service_role) holds DELETE on this table, so the only
-- writer is the transfer function (SECURITY DEFINER) and the owner. A trigger
-- here would also block the owner's own maintenance and the row cleanup that
-- removing a synthetic person requires, and the repo's other append-only table
-- (audit_events) is protected the same way: by revocation.
create or replace function private.preserve_sale_team_accreditation_history() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  raise exception 'ACCREDITATION_HISTORY_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function private.preserve_sale_team_accreditation_history() from public,anon,authenticated,service_role;
drop trigger if exists sale_team_accreditation_history_immutable on private.sale_team_accreditation_history;
create trigger sale_team_accreditation_history_immutable
  before update on private.sale_team_accreditation_history
  for each row execute function private.preserve_sale_team_accreditation_history();

-- The one path from a retired number to its successor. NULL when the number
-- was never issued or is still current, so a caller can treat both as
-- "nothing to add" without inventing a status. service_role only: the API
-- decides whether the caller may see a historical answer.
create or replace function public.resolve_sale_team_accreditation_number(p_aa_number text)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('aaNumber',h.aa_number,'kind',h.kind,'fullName',h.public_name,
    'status',h.status,'startsOn',h.starts_on,'expiresOn',h.expires_on,
    'successorAaNumber',h.successor_aa_number)
  from private.sale_team_accreditation_history h
  where h.aa_number=p_aa_number
    and not exists(select 1 from private.sale_team_accreditations a where a.aa_number=h.aa_number)
  order by h.recorded_at desc,h.id desc limit 1;
$$;
revoke all on function public.resolve_sale_team_accreditation_number(text) from public,anon,authenticated;
grant execute on function public.resolve_sale_team_accreditation_number(text) to service_role;

commit;
