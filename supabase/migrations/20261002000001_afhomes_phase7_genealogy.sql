-- AF Homes Ecofarm v2 PHASE 7: sales genealogy foundation.
-- Validation: pnpm test:db:local && supabase/security/rls_invariants.sql returns no rows.
-- Down: drop the Phase 7 trigger/functions; the forward-only relationship history is retained.

create or replace function private.staff_role_slug(p_staff_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.slug from public.staff_role_assignments sra
  join public.roles r on r.id = sra.role_id and r.is_active
  where sra.staff_id = p_staff_id
$$;
revoke all on function private.staff_role_slug(uuid) from public, anon, authenticated;

create or replace function private.has_permission_for_user(p_staff_id uuid,p_key text,p_action text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.staff_users su
    join public.staff_role_assignments sra on sra.staff_id=su.id
    join public.roles r on r.id=sra.role_id and r.is_active
    join public.modules m on m.key=p_key and m.is_active
    left join public.role_permissions rp on rp.role_id=r.id and rp.module_id=m.id
    left join public.staff_permission_restrictions spr on spr.staff_id=su.id and spr.module_id=m.id
    where su.id=p_staff_id and su.status='active' and case p_action
      when 'view' then (r.slug='super_admin' or coalesce(rp.can_view,false)) and not coalesce(spr.deny_view,false)
      when 'update' then (r.slug='super_admin' or coalesce(rp.can_update,false)) and not coalesce(spr.deny_view,false) and not coalesce(spr.deny_update,false)
      else false end)
$$;
revoke all on function private.has_permission_for_user(uuid,text,text) from public,anon,authenticated;

create or replace function private.can_view_genealogy_edge(p_subject uuid,p_upline uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
  with recursive identity as (
    select auth.uid() id, private.staff_role_slug(auth.uid()) role
  ), downline(id,depth) as (
    select id,0 from identity
    union all select rr.subject_staff_id,d.depth+1 from downline d
      join public.referral_relationships rr on rr.upline_staff_id=d.id and rr.is_active where d.depth<4
  ), upline(id,depth) as (
    select id,0 from identity
    union all select rr.upline_staff_id,u.depth+1 from upline u
      join public.referral_relationships rr on rr.subject_staff_id=u.id and rr.is_active where u.depth<4
  ) select case
    when not private.has_permission_for_user(auth.uid(),'network.genealogy','view')
      and not private.has_permission_for_user(auth.uid(),'network.referrals','view') then false
    when (select role from identity) not in ('vice_director','senior_sales_manager','sales_manager','ost') then true
    when (select role from identity)='ost' then p_subject in (select id from upline) or p_upline in (select id from upline)
    else p_subject in (select id from downline union select id from upline)
      or p_upline in (select id from downline union select id from upline) end
$$;
revoke all on function private.can_view_genealogy_edge(uuid,uuid) from public,anon,authenticated;

do $$ begin
  if exists (
    select 1 from public.referral_relationships rr
    where rr.is_active and not coalesce((
      (private.staff_role_slug(rr.subject_staff_id)='senior_sales_manager' and private.staff_role_slug(rr.upline_staff_id)='vice_director') or
      (private.staff_role_slug(rr.subject_staff_id)='sales_manager' and private.staff_role_slug(rr.upline_staff_id)='senior_sales_manager') or
      (private.staff_role_slug(rr.subject_staff_id)='ost' and private.staff_role_slug(rr.upline_staff_id)='sales_manager')
    ),false)
  ) then raise exception 'PHASE7_EXISTING_HIERARCHY_CONFLICT'; end if;
end $$;

drop policy if exists referral_relationships_read on public.referral_relationships;
create policy referral_relationships_read on public.referral_relationships for select to authenticated
using (private.can_view_genealogy_edge(subject_staff_id,upline_staff_id));

create or replace function private.validate_genealogy_relationship()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_subject_role text; v_upline_role text;
begin
  if not new.is_active then return new; end if;
  if new.subject_staff_id = new.upline_staff_id then raise exception 'UPLINE_SELF_REFERENCE' using errcode='22023'; end if;
  select private.staff_role_slug(new.subject_staff_id), private.staff_role_slug(new.upline_staff_id)
    into v_subject_role, v_upline_role;
  if v_subject_role is null or v_upline_role is null then raise exception 'HIERARCHY_ROLE_REQUIRED' using errcode='22023'; end if;
  if new.hierarchy_role <> v_subject_role then raise exception 'SUBJECT_ROLE_MISMATCH' using errcode='22023'; end if;
  if not ((v_subject_role='senior_sales_manager' and v_upline_role='vice_director') or
          (v_subject_role='sales_manager' and v_upline_role='senior_sales_manager') or
          (v_subject_role='ost' and v_upline_role='sales_manager')) then
    raise exception 'INVALID_HIERARCHY_DIRECTION' using errcode='22023';
  end if;
  if exists (
    with recursive ancestors(id, depth) as (
      select new.upline_staff_id, 1
      union all
      select rr.upline_staff_id, a.depth + 1 from ancestors a
      join public.referral_relationships rr on rr.subject_staff_id=a.id and rr.is_active
      where a.depth < 4
    ) select 1 from ancestors where id=new.subject_staff_id
  ) then raise exception 'GENEALOGY_CYCLE' using errcode='22023'; end if;
  return new;
end $$;
revoke all on function private.validate_genealogy_relationship() from public, anon, authenticated;

drop trigger if exists referral_relationships_validate_genealogy on public.referral_relationships;
create trigger referral_relationships_validate_genealogy
before insert or update of subject_staff_id,upline_staff_id,hierarchy_role,is_active
on public.referral_relationships for each row execute function private.validate_genealogy_relationship();

create or replace function public.correct_referral_upline(p_relationship_id uuid,p_upline_staff_id uuid,p_reason text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_old public.referral_relationships%rowtype; v_new_id uuid;
begin
  if p_actor_id is null then raise exception 'ACTOR_REQUIRED' using errcode='42501'; end if;
  if not private.has_permission_for_user(p_actor_id,'sales.uplines','update') then raise exception 'INSUFFICIENT_PERMISSION' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  select * into v_old from public.referral_relationships where id=p_relationship_id for update;
  if not found then raise exception 'SUBJECT_NOT_FOUND' using errcode='P0002'; end if;
  if not v_old.is_active then raise exception 'RELATIONSHIP_NOT_ACTIVE' using errcode='55000'; end if;
  if v_old.upline_staff_id=p_upline_staff_id then raise exception 'SAME_UPLINE' using errcode='55000'; end if;
  perform 1 from public.staff_users where id=p_upline_staff_id and status='active';
  if not found then raise exception 'UPLINE_NOT_FOUND' using errcode='P0002'; end if;
  update public.referral_relationships set is_active=false,updated_at=now() where id=p_relationship_id;
  insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
  values(v_old.subject_staff_id,p_upline_staff_id,v_old.hierarchy_role,true,true,p_actor_id) returning id into v_new_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,reason)
  values(p_actor_id,'UPLINE_CORRECTED','referral_relationship',v_new_id::text,
    jsonb_build_object('relationshipId',p_relationship_id,'uplineStaffId',v_old.upline_staff_id),
    jsonb_build_object('uplineStaffId',p_upline_staff_id,'supersededRelationshipId',p_relationship_id),btrim(p_reason));
  return v_new_id;
end $$;
revoke all on function public.correct_referral_upline(uuid,uuid,text,uuid) from public,anon,authenticated;

comment on table public.referral_relationships is
  'PHASE 7 authoritative immediate-upline history. Active edges enforce VD to SSM to SM to OST; corrections retire rows so historical sales remain frozen.';
