-- AF Homes: separate manual SM sponsorship from public VD/SSM/SM referral codes.
-- Forward-only; no accounts, identifiers, financial records or existing edges are rewritten.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs (disposable only).
-- Validate browser ACLs with supabase/security/rls_invariants.sql (zero findings).
-- ACL check: has_function_privilege('authenticated',
-- 'public.submit_ost_accreditation(uuid,uuid,uuid,uuid,jsonb,jsonb,text)','EXECUTE') = false.
-- Down: restore prior function bodies in a later migration; preserve applications/history.
begin;
create or replace function private.ost_active_sponsor(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_staff public.staff_users%rowtype;
begin
  select s.* into v_staff from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id
    join public.roles r on r.id=a.role_id and r.is_active and r.slug in ('vice_director','senior_sales_manager','sales_manager')
    where s.id=p_id and s.status='active';
  if not found then raise exception 'OST_ACTIVE_SPONSOR_REQUIRED' using errcode='22023'; end if;
  return jsonb_build_object('staffId',v_staff.id,'name',v_staff.full_name,'email',v_staff.email);
end $$;

create or replace function private.ost_manual_sponsor(p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_sponsor jsonb;
begin
  v_sponsor:=private.ost_active_sponsor(p_id);
  if private.staff_role_slug(p_id)<>'sales_manager' then raise exception 'OST_ACTIVE_SM_REQUIRED' using errcode='22023'; end if;
  if not exists (
    select 1 from public.referral_relationships sm
    join public.staff_users ssm on ssm.id=sm.upline_staff_id and ssm.status='active'
    join public.referral_relationships parent on parent.subject_staff_id=ssm.id and parent.is_active and parent.hierarchy_role='senior_sales_manager'
    join public.staff_users vd on vd.id=parent.upline_staff_id and vd.status='active'
    where sm.subject_staff_id=p_id and sm.is_active and sm.hierarchy_role='sales_manager'
      and private.staff_role_slug(ssm.id)='senior_sales_manager' and private.staff_role_slug(vd.id)='vice_director'
  ) then raise exception 'OST_SM_UPPERLINE_REQUIRED' using errcode='22023'; end if;
  return v_sponsor;
end $$;
revoke all on function private.ost_manual_sponsor(uuid) from public,anon,authenticated,service_role;

create or replace function public.submit_ost_accreditation(p_request_id uuid,p_actor_id uuid,p_sponsor_id uuid,p_code_id uuid,p_identity jsonb,p_form jsonb,p_source text)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_id uuid; v_prior private.ost_registration_details%rowtype; v_hash text; v_sponsor jsonb; v_code public.referral_codes%rowtype; v_code_id uuid;
begin
  if p_request_id is null or p_source not in ('public','manual','import') then raise exception 'INVALID_OST_FORM'; end if;
  if p_source='public' then
    if p_actor_id is not null or p_code_id is null then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
    select * into v_code from public.referral_codes where id=p_code_id for update;
    if not found or not v_code.is_active or (v_code.expires_at is not null and v_code.expires_at<=now()) or v_code.sponsor_staff_id<>p_sponsor_id then raise exception 'INVALID_REFERRAL_CODE'; end if;
  else
    perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','create');
    perform private.ost_scope(p_actor_id,p_sponsor_id);
  end if;
  v_sponsor:=case when p_source='public' then private.ost_active_sponsor(p_sponsor_id) else private.ost_manual_sponsor(p_sponsor_id) end;
  v_hash:=encode(digest(private.normalized_mutation_json(jsonb_build_object('identity',p_identity,'form',p_form,'sponsor',p_sponsor_id,'code',p_code_id,'source',p_source))::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,23000001));
  select * into v_prior from private.ost_registration_details where request_id=p_request_id;
  if found then
    if v_prior.created_by is distinct from p_actor_id or v_prior.payload_hash<>v_hash then raise exception 'MUTATION_PAYLOAD_CONFLICT'; end if;
    return v_prior.application_id;
  end if;
  if p_source='public' and v_code.use_count>=v_code.max_uses then raise exception 'INVALID_REFERRAL_CODE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(p_identity->>'email'),23000003));
  perform pg_advisory_xact_lock(hashtextextended(p_identity->>'phone',23000004));
  if exists(select 1 from public.ost_applications where status in ('submitted','under_review','changes_requested','approved') and (lower(email)=lower(p_identity->>'email') or phone=p_identity->>'phone')) or
    exists(select 1 from public.ost_members where phone=p_identity->>'phone') then raise exception 'OST_DUPLICATE_ACCOUNT'; end if;
  if exists(select 1 from public.staff_users where lower(email)=lower(p_identity->>'email')) or exists(select 1 from public.ost_members where lower(email)=lower(p_identity->>'email')) then raise exception 'OST_DUPLICATE_ACCOUNT'; end if;
  v_code_id:=p_code_id;
  if p_source<>'public' then
    -- Never manufacture a shareable referral credential or relax the existing
    -- mandatory code FK. This consumed, inactive code records the authorized
    -- manual/import provenance; its random plaintext is never returned.
    if p_code_id is not null then raise exception 'INVALID_OST_FORM'; end if;
    insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,expires_at,max_uses,use_count,is_active,created_by)
      values(encode(digest(gen_random_uuid()::text,'sha256'),'hex'),'MANUAL',p_sponsor_id,now(),1,1,false,p_actor_id) returning id into v_code_id;
  end if;
  insert into public.ost_applications(referral_code_id,sponsor_staff_id,email,phone,first_name,middle_name,last_name,birth_date,address,status)
    values(v_code_id,p_sponsor_id,lower(p_identity->>'email'),p_identity->>'phone',p_identity->>'firstName',nullif(p_identity->>'middleName',''),p_identity->>'lastName',(p_identity->>'birthDate')::date,p_identity->'address','submitted') returning id into v_id;
  update public.ost_applications set registration_details=jsonb_build_object('officialAccreditation',true,'addressHierarchy',p_identity->'addressHierarchy') where id=v_id;
  insert into private.ost_registration_details(application_id,request_id,payload_hash,date_applied,form_number,program_category,vip_card_type,official_details,referrer_snapshot,
    applicant_signature_status,referrer_signature_status,applicant_signed_on,referrer_signed_on,source,created_by)
    values(v_id,p_request_id,v_hash,(p_form->>'dateApplied')::date,'AF-'||upper(replace(v_id::text,'-','')),p_form->>'programCategory',nullif(p_form->>'vipCardType',''),
      p_form-ARRAY['dateApplied','programCategory','vipCardType','applicantSignatureStatus','referrerSignatureStatus','referrerSnapshot'],
      v_sponsor||coalesce(p_form->'referrerSnapshot','{}'),p_form->>'applicantSignatureStatus',p_form->>'referrerSignatureStatus',nullif(p_form->>'applicantSignedOn','')::date,nullif(p_form->>'referrerSignedOn','')::date,p_source,p_actor_id);
  -- Authoritative staffId/name/email override submitted historical extras.
  update private.ost_registration_details set referrer_snapshot=referrer_snapshot||v_sponsor where application_id=v_id;
  if p_code_id is not null then update public.referral_codes set use_count=use_count+1 where id=p_code_id; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'OST_ACCREDITATION_SUBMITTED','ost_application',v_id::text,jsonb_build_object('source',p_source,'status','submitted','sponsorStaffId',p_sponsor_id));
  return v_id;
end $$;

create or replace function public.manage_ost_referral_code(p_actor uuid,p_sponsor uuid,p_rotate boolean,p_hash text,p_hint text,p_expires timestamptz,p_max_uses integer)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_role text; v_id uuid;
begin
 v_role:=private.mutation_actor_role(p_actor,'network.referrals','view');
 if v_role not in ('admin','super_admin','vice_director','senior_sales_manager','sales_manager') or (v_role in ('vice_director','senior_sales_manager','sales_manager') and p_actor<>p_sponsor) then raise exception 'FORBIDDEN: Only active hierarchy sellers or administrators may issue'; end if;
 perform 1 from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id join public.roles r on r.id=a.role_id and r.is_active
 where s.id=p_sponsor and s.status='active' and r.slug in ('vice_director','senior_sales_manager','sales_manager') for update of s;
 if not found then raise exception 'FORBIDDEN: Only an active hierarchy seller can sponsor an OST account'; end if;
 if not p_rotate and exists(select 1 from public.referral_codes where sponsor_staff_id=p_sponsor and is_active and expires_at>now() and use_count<max_uses) then raise exception 'CONFLICT: An active referral code already exists. Rotate it to generate a replacement'; end if;
 if p_hash !~ '^[a-f0-9]{64}$' or p_max_uses not between 1 and 100 or p_expires<=now() then raise exception 'VALIDATION_ERROR: Invalid referral code'; end if;
 if p_rotate then update public.referral_codes set is_active=false where sponsor_staff_id=p_sponsor and is_active; end if;
 insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,expires_at,max_uses,use_count,is_active,created_by)
 values(p_hash,p_hint,p_sponsor,p_expires,p_max_uses,0,true,p_actor) returning id into v_id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor,case when p_rotate then 'REFERRAL_CODE_ROTATED' else 'REFERRAL_CODE_ISSUED' end,'referral_code',v_id::text,jsonb_build_object('sponsorStaffId',p_sponsor));
 return v_id;
end $$;

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
          (v_subject_role='ost' and v_upline_role in ('vice_director','senior_sales_manager','sales_manager'))) then
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
create or replace function public.list_ost_manual_sponsors(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text; v_allowed uuid[]; v_result jsonb;
begin
  if p_actor is not null and exists(select 1 from public.ost_members m
    join public.staff_users s on s.id=m.id and s.status='active'
    where m.id=p_actor and m.status='active' and private.staff_role_slug(m.id)='ost') then
    v_role:='ost';
  else v_role:=private.mutation_actor_role(p_actor,'network.ost_registrations','view'); end if;
  if v_role in ('vice_director','senior_sales_manager','sales_manager') then
    with recursive team(id,path) as (
      select p_actor,array[p_actor]
      union all select e.subject_staff_id,t.path||e.subject_staff_id
      from team t join public.referral_relationships e on e.upline_staff_id=t.id and e.is_active
      where not e.subject_staff_id=any(t.path)
    ) select array_agg(id) into v_allowed from team;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.full_name) order by s.full_name,s.id),'[]'::jsonb)
  into v_result from public.staff_users s
  join public.referral_relationships sm on sm.subject_staff_id=s.id and sm.is_active and sm.hierarchy_role='sales_manager'
  join public.staff_users ssm on ssm.id=sm.upline_staff_id and ssm.status='active'
  join public.referral_relationships parent on parent.subject_staff_id=ssm.id and parent.is_active and parent.hierarchy_role='senior_sales_manager'
  join public.staff_users vd on vd.id=parent.upline_staff_id and vd.status='active'
  where s.status='active' and private.staff_role_slug(s.id)='sales_manager'
    and private.staff_role_slug(ssm.id)='senior_sales_manager' and private.staff_role_slug(vd.id)='vice_director'
    and (v_allowed is null or s.id=any(v_allowed));
  return v_result;
end $$;
revoke all on function public.list_ost_manual_sponsors(uuid) from public,anon,authenticated;
grant execute on function public.list_ost_manual_sponsors(uuid) to service_role;
commit;
