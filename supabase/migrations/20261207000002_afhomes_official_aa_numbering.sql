-- AF Homes official AA numbering: AAI (IST) / AAO (OST) + YYMM + sequence.
--
-- Replaces the random `AA-` generator for NEW numbers only. The format was
-- supplied by the company and approved; the monthly scope is the approved
-- resolution of OD-02 in docs/AFHOMES-BUSINESS-RULES.md: ONE shared monthly
-- sequence across both prefixes, so AAI26100001 and AAO26100002 can never
-- collide inside a month while the counters stay a single ordered series.
--
-- Month = the approved accreditation start date. A number is never recomputed
-- for an existing holder: `coalesce(existing, next)` keeps renewals and edits
-- on the number that was issued, and a legacy `AA-` number is left untouched.
--
-- Delivered forward-only because the earlier attempt at this format
-- (20261203000002) is not in this branch's migration series. It carries the
-- 7-argument signature from 20261206000004 so operator-typed numbers keep
-- working, and it tightens the typed shape: a typed number must be the
-- official `AAI`/`AAO` form for the kind, or an issued legacy `AA-` number.
--
-- Dependencies: 20261130000001 (accreditation table, lookups, trigger),
-- 20261206000004 (7-argument manual signature). Re-run: idempotent
-- (create table if not exists, create or replace, drop constraint/trigger if
-- exists).
--
-- Validation after apply (expected):
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='manage_sale_team_accreditation'; -- 1
--   select conname from pg_constraint where conname='sale_team_aa_format'
--     and not convalidated; -- zero rows
--   select aa_number from private.sale_team_accreditations
--    where aa_number ~ '^AA[IO]' and substring(aa_number from 1 for 3)
--      <> case when kind='IST' then 'AAI' else 'AAO' end; -- zero rows
--   select checked_role,has_table_privilege(checked_role,
--     'private.sale_team_aa_counters','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
--    from (values('anon'),('authenticated'),('service_role')) r(checked_role); -- all false
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): retain every issued number and counter;
-- restore the random generator and the 7-argument function from 20261206000004
-- and drop the format CHECK. Never reset a counter or renumber a record.
begin;

create table if not exists private.sale_team_aa_counters (
  accreditation_month date primary key check(extract(day from accreditation_month)=1),
  last_value integer not null check(last_value between 1 and 9999)
);
alter table private.sale_team_aa_counters enable row level security;
revoke all on private.sale_team_aa_counters from public,anon,authenticated,service_role;

create or replace function private.next_sale_team_aa_number(p_kind text,p_accredited_on date)
returns text language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare v_month date; v_stamp text; v_high integer; v_next integer;
begin
  if p_kind is null or p_kind not in ('IST','OST') or p_accredited_on is null then
    raise exception 'INVALID_ACCREDITATION_NUMBER_INPUT' using errcode='22023';
  end if;
  v_month:=date_trunc('month',p_accredited_on::timestamp)::date;
  v_stamp:=to_char(p_accredited_on,'YYMM');
  -- Preserve an imported or operator-typed high-water mark across both prefixes.
  select coalesce(max(substring(a.aa_number from 8 for 4)::integer),0) into v_high
  from private.sale_team_accreditations a
  where a.aa_number ~ '^AA[IO][0-9]{2}(0[1-9]|1[0-2])[0-9]{4}$'
    and substring(a.aa_number from 4 for 4)=v_stamp;
  if v_high>=9999 then raise exception 'AA_SEQUENCE_EXHAUSTED' using errcode='55000'; end if;
  insert into private.sale_team_aa_counters(accreditation_month,last_value)
  values(v_month,v_high+1)
  on conflict(accreditation_month) do update
    set last_value=greatest(private.sale_team_aa_counters.last_value+1,excluded.last_value)
    where private.sale_team_aa_counters.last_value<9999
  returning last_value into v_next;
  if v_next is null then raise exception 'AA_SEQUENCE_EXHAUSTED' using errcode='55000'; end if;
  return case when p_kind='IST' then 'AAI' else 'AAO' end||v_stamp||lpad(v_next::text,4,'0');
end $$;
revoke all on function private.next_sale_team_aa_number(text,date) from public,anon,authenticated,service_role;

-- The approved identifier is immutable: a renewal changes dates and status,
-- never identity. A kind change is a transfer, which deletes the old row (its
-- number is appended to the accreditation history) and inserts the successor.
create or replace function private.preserve_sale_team_aa_identity() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if new.staff_id is distinct from old.staff_id or new.aa_number is distinct from old.aa_number
    or new.kind is distinct from old.kind then
    raise exception 'ACCREDITATION_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.preserve_sale_team_aa_identity() from public,anon,authenticated,service_role;
drop trigger if exists sale_team_aa_identity_immutable on private.sale_team_accreditations;
create trigger sale_team_aa_identity_immutable before update on private.sale_team_accreditations
for each row execute function private.preserve_sale_team_aa_identity();

-- Official shape, or an issued legacy number. The prefix must match the kind.
alter table private.sale_team_accreditations drop constraint if exists sale_team_aa_format;
alter table private.sale_team_accreditations add constraint sale_team_aa_format check (
  (aa_number ~ '^AA-[A-Z0-9]{12}$'
    and length(regexp_replace(substring(aa_number from 4),'[^A-Z]','','g'))=6)
  or (aa_number ~ '^AA[IO][0-9]{2}(0[1-9]|1[0-2])[0-9]{4}$'
    and substring(aa_number from 8 for 4)<>'0000'
    and substring(aa_number from 1 for 3)=case when kind='IST' then 'AAI' else 'AAO' end)
);

-- Replace, not overload: with both the 6- and 7-argument bodies present,
-- Postgres resolves the trigger's 4-argument positional call as AMBIGUOUS.
-- Dropping first makes this file correct whether or not 20261206000004 was
-- recorded already.
drop function if exists public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date);

-- Approval, ownership, role, recovery gates and audit unchanged; the generator
-- call and the typed-number shape are the only differences from 20261206000004.
create or replace function public.manage_sale_team_accreditation(
 p_actor_id uuid,p_staff_id uuid,p_kind text,p_action text,p_starts_on date default null,p_expires_on date default null,
 p_aa_number text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text; v_target text; v_existing private.sale_team_accreditations%rowtype;
  v_attempt integer; v_constraint text; v_number text;
begin
 if p_kind not in ('IST','OST') or p_action not in ('approve','revoke') then raise exception 'INVALID_ACCREDITATION'; end if;
 v_role:=private.mutation_actor_role(p_actor_id,case when p_kind='IST' then 'organization.staff' else 'network.ost_registrations' end,'update');
 if v_role is null or v_role not in ('admin','super_admin') then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
 -- A typed number is either the official form for THIS kind or an issued
 -- legacy identifier. A kind-mismatched prefix is refused here, by name,
 -- instead of surfacing as a raw CHECK violation.
 if p_aa_number is not null and not (
   (p_aa_number ~ '^AA[IO][0-9]{2}(0[1-9]|1[0-2])[0-9]{4}$' and substring(p_aa_number from 8 for 4)<>'0000'
     and substring(p_aa_number from 1 for 3)=case when p_kind='IST' then 'AAI' else 'AAO' end)
   or (p_aa_number ~ '^AA-[A-Z0-9]{12}$'
     and length(regexp_replace(substring(p_aa_number from 4),'[^A-Z]','','g'))=6)
 ) then raise exception 'INVALID_ACCREDITATION_NUMBER'; end if;
 perform 1 from public.staff_users s where s.id=p_staff_id for update;
 select r.slug into v_target from public.staff_users s
 join public.staff_role_assignments ra on ra.staff_id=s.id
 join public.roles r on r.id=ra.role_id and r.is_active where s.id=p_staff_id
   and (s.status='active' or (p_kind='OST' and s.status='invited'));
 select * into v_existing from private.sale_team_accreditations a where a.staff_id=p_staff_id for update;
 if v_existing.staff_id is not null and v_existing.kind<>p_kind then raise exception 'ACCREDITATION_KIND_CONFLICT'; end if;
 if v_existing.aa_number is not null and p_aa_number is not null and v_existing.aa_number<>p_aa_number then
   raise exception 'ACCREDITATION_NUMBER_IMMUTABLE';
 end if;
 if p_action='revoke' then
   if v_existing.staff_id is null then raise exception 'ACCREDITATION_REQUIRED'; end if;
   if v_existing.status='revoked' then return public.get_sale_team_accreditation(p_staff_id); end if;
   update private.sale_team_accreditations set status='revoked',revoked_by=p_actor_id,revoked_at=now() where staff_id=p_staff_id;
 else
   if v_target is null or (p_kind='IST' and v_target not in ('vice_director','senior_sales_manager','sales_manager'))
      or (p_kind='OST' and v_target<>'ost') then raise exception 'INVALID_ACCREDITATION_TARGET'; end if;
   if p_kind='OST' then
     select t.starts_on,t.expires_on into p_starts_on,p_expires_on
       from private.ost_accreditation_terms t join public.ost_members m on m.id=t.ost_id and m.status='active'
       where t.ost_id=p_staff_id and t.status='active';
   end if;
   if p_starts_on is null or p_expires_on is null or p_expires_on<p_starts_on then raise exception 'APPROVED_DATES_REQUIRED'; end if;
   if v_existing.status='active' and v_existing.starts_on=p_starts_on and v_existing.expires_on=p_expires_on
     and v_existing.public_name=(select s.full_name from public.staff_users s where s.id=p_staff_id)
     and (p_aa_number is null or v_existing.aa_number=p_aa_number) then
     return public.get_sale_team_accreditation(p_staff_id);
   end if;
   v_number:=coalesce(v_existing.aa_number,p_aa_number,
     private.next_sale_team_aa_number(p_kind,p_starts_on));
   for v_attempt in 1..8 loop
    begin
     insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
     values(p_staff_id,v_number,
       (select s.full_name from public.staff_users s where s.id=p_staff_id),p_kind,'active',p_starts_on,p_expires_on,p_actor_id)
     on conflict(staff_id) do update set status='active',starts_on=excluded.starts_on,expires_on=excluded.expires_on,
       public_name=excluded.public_name,approved_by=excluded.approved_by,approved_at=now(),revoked_by=null,revoked_at=null;
     exit;
    exception when unique_violation then
     get stacked diagnostics v_constraint=CONSTRAINT_NAME;
     if p_aa_number is not null and v_constraint='sale_team_accreditations_aa_number_key' then
       raise exception 'ACCREDITATION_NUMBER_TAKEN';
     end if;
     if v_existing.staff_id is not null or v_constraint<>'sale_team_accreditations_aa_number_key' or v_attempt=8 then raise; end if;
     v_number:=private.next_sale_team_aa_number(p_kind,p_starts_on);
    end;
   end loop;
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
 values(p_actor_id,case when p_action='approve' then 'SALE_TEAM_ACCREDITATION_APPROVED' else 'SALE_TEAM_ACCREDITATION_REVOKED' end,
   'staff_user',p_staff_id::text,jsonb_build_object('kind',p_kind,'aaNumber',(select aa_number from private.sale_team_accreditations where staff_id=p_staff_id)));
 return public.get_sale_team_accreditation(p_staff_id);
end $$;
revoke all on function public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date,text) from public,anon,authenticated;
grant execute on function public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date,text) to service_role;

commit;
