-- AF Homes sale-team accreditation: operator-supplied AA numbers.
--
-- Member onboarding offers AUTO (system issues the number, unchanged) or
-- MANUAL (the operator types it, e.g. a pre-printed card). The 6-argument
-- `manage_sale_team_accreditation` only auto-generates, so this file replaces
-- it with a 7-argument version carrying optional `p_aa_number`.
--
-- Replace, not overload: Postgres resolves two same-prefix signatures that
-- differ only by trailing defaults as AMBIGUOUS, which broke every existing
-- 4-argument positional caller (the OST approval trigger). With one function,
-- 4-argument calls fill the rest by default, 6-argument named calls default
-- `p_aa_number` to null (AUTO, unchanged), and 7-argument calls pass a typed
-- number (MANUAL).
--
-- Rules, enforced in SQL so a handler bug cannot bypass them:
-- - manual numbers match `AA` plus 4 to 12 uppercase letters/digits, else
--   INVALID_ACCREDITATION_NUMBER;
-- - an issued number never changes: approving a staff row that already holds
--   a different number raises ACCREDITATION_NUMBER_IMMUTABLE (never renumber
--   existing records);
-- - a taken number raises ACCREDITATION_NUMBER_TAKEN immediately instead of
--   silently minting a different number (no retry-generate on manual).
--
-- forward-only, idempotent: drop-if-exists the old signature, create or
-- replace the new one, re-grant the execute privilege. Re-running changes
-- nothing.
--
-- Validation after apply (expected):
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'manage_sale_team_accreditation';  -- 1
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): drop the 7-argument function and
-- restore the 6-argument body from
-- 20261130000001_afhomes_sale_team_accreditation.sql. Issued numbers and
-- audit history are retained.

drop function if exists public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date);

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
 if p_aa_number is not null and p_aa_number !~ '^AA[A-Z0-9]{4,12}$' then raise exception 'INVALID_ACCREDITATION_NUMBER'; end if;
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
   v_number:=coalesce(p_aa_number,private.next_sale_team_aa_number());
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
     v_number:=private.next_sale_team_aa_number();
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
