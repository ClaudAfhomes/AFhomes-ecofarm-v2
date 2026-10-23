-- Function replacements for IST employee identity (requires coordinated deploy).
-- Applies after schema migration 20261208000012.
-- Replaces existing public RPCs with new signatures/behavior for date-free IST.
begin;
-- New function for IST employee identity issuance (no dates).
create or replace function public.issue_ist_employee_identity(p_actor_id uuid,p_staff_id uuid,p_aa_number text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_existing private.sale_team_accreditations%rowtype; v_name text; v_number text;
begin
  if private.mutation_actor_role(p_actor_id,'organization.staff','update') not in ('admin','super_admin') then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;
  select s.full_name into v_name from public.staff_users s
    join public.staff_role_assignments a on a.staff_id=s.id
    join public.roles r on r.id=a.role_id and r.is_active
    where s.id=p_staff_id and s.status='active' and r.slug in ('vice_director','senior_sales_manager','sales_manager') for update of s;
  if not found then raise exception 'INVALID_EMPLOYEE_IDENTITY_TARGET'; end if;
  select * into v_existing from private.sale_team_accreditations where staff_id=p_staff_id;
  if found then
    if v_existing.kind<>'IST' then raise exception 'ACCREDITATION_KIND_CONFLICT'; end if;
    if p_aa_number is not null and p_aa_number<>v_existing.aa_number then raise exception 'ACCREDITATION_NUMBER_IMMUTABLE'; end if;
    return public.get_sale_team_accreditation(p_staff_id);
  end if;
  if p_aa_number is not null and not (
    p_aa_number ~ '^AAI[0-9]{2}(0[1-9]|1[0-2])[0-9]{4}$' and right(p_aa_number,4)<>'0000'
    or p_aa_number ~ '^AA-[A-Z0-9]{12}$' and length(regexp_replace(substring(p_aa_number from 4),'[^A-Z]','','g'))=6
  ) then raise exception 'INVALID_ACCREDITATION_NUMBER'; end if;
  if p_aa_number is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_aa_number,0));
    if exists(select 1 from private.sale_team_accreditations where aa_number=p_aa_number)
      or exists(select 1 from private.sale_team_accreditation_history where aa_number=p_aa_number) then raise exception 'ACCREDITATION_NUMBER_TAKEN' using errcode='23505'; end if;
  end if;
  -- This date scopes NEW AAI allocation to its issuance month; it is not a term.
  v_number:=coalesce(p_aa_number,private.next_sale_team_aa_number('IST',(now() at time zone 'Asia/Manila')::date));
  insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
    values(p_staff_id,v_number,v_name,'IST','active',null,null,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'IST_EMPLOYEE_IDENTITY_ISSUED','staff_user',p_staff_id::text,jsonb_build_object('aaNumber',v_number));
  return public.get_sale_team_accreditation(p_staff_id);
end $$;
revoke all on function public.issue_ist_employee_identity(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_ist_employee_identity(uuid,uuid,text) to service_role;

-- Legacy API signature retained; IST dates are neither required nor persisted.
create or replace function public.get_sale_team_accreditation(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('aaNumber',a.aa_number,'kind',a.kind,'fullName',a.public_name,
   'startsOn',case when a.kind='OST' then coalesce(t.starts_on,a.starts_on) else a.starts_on end,
   'expiresOn',case when a.kind='OST' then coalesce(t.expires_on,a.expires_on) else a.expires_on end,
   'status',case
     when a.status='revoked' or (a.kind='OST' and t.status='revoked') then 'revoked'
     when s.status<>'active' or not r.is_active
       or (a.kind='IST' and r.slug not in ('vice_director','senior_sales_manager','sales_manager'))
       or (a.kind='OST' and (r.slug<>'ost' or m.status is distinct from 'active' or t.id is null)) then 'inactive'
     when (case when a.kind='OST' then t.starts_on else null::date end)>(now() at time zone 'Asia/Manila')::date then 'not_started'
     when (case when a.kind='OST' then t.expires_on else null::date end)<(now() at time zone 'Asia/Manila')::date then 'expired'
     else 'accredited' end)
 from private.sale_team_accreditations a
 join public.staff_users s on s.id=a.staff_id
 join public.staff_role_assignments ra on ra.staff_id=s.id
 join public.roles r on r.id=ra.role_id
 left join public.ost_members m on m.id=s.id and a.kind='OST'
 left join lateral (select ot.* from private.ost_accreditation_terms ot
   where ot.ost_id=m.id and ot.status in ('active','revoked')
   order by ot.approved_at desc,ot.id desc limit 1) t on true
 where a.staff_id=p_staff_id;
$$;

create or replace function public.manage_sale_team_accreditation(
 p_actor_id uuid,p_staff_id uuid,p_kind text,p_action text,p_starts_on date default null,p_expires_on date default null,
 p_aa_number text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text; v_target text; v_existing private.sale_team_accreditations%rowtype;
  v_attempt integer; v_constraint text; v_number text;
begin
 if p_kind='IST' then
   if p_action<>'approve' then raise exception 'IST_EMPLOYEE_LIFECYCLE_REQUIRED'; end if;
   return public.issue_ist_employee_identity(p_actor_id,p_staff_id,p_aa_number);
 end if;
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

create or replace function public.transfer_sale_team_member(
 p_actor_id uuid,p_staff_id uuid,p_direction text,p_reason text,p_request_id uuid, -- no default, and before the first defaulted parameter (PostgreSQL requires that order): PostgREST must be able to choose between this and the eleven-parameter wrapper
 p_target_position text default null,p_head_id uuid default null,p_sponsor_id uuid default null,
 p_identity jsonb default null,p_form jsonb default null,p_starts_on date default null,p_expires_on date default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_staff public.staff_users%rowtype; v_old private.sale_team_accreditations%rowtype;
  v_actor_role text; v_new_kind text; v_number text; v_role uuid; v_head_slug text; v_expected text;
  v_start date; v_end date; v_code_id uuid; v_app uuid; v_hash text; v_sponsor jsonb; v_term uuid;
  v_name text; v_ost_number text; v_new jsonb; v_payload jsonb; v_replay uuid; v_from_role text; v_old_head uuid;
begin
  if p_direction is null or p_direction not in ('IST_TO_OST','OST_TO_IST') then raise exception 'INVALID_TRANSFER' using errcode='22023'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'TRANSFER_REASON_REQUIRED' using errcode='22023'; end if;
  v_actor_role:=private.mutation_actor_role(p_actor_id,'organization.staff','update');
  if v_actor_role is null or v_actor_role not in ('admin','super_admin') then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('staff',p_staff_id,'direction',p_direction,'reason',p_reason,'position',p_target_position,'head',p_head_id,'sponsor',p_sponsor_id,'identity',p_identity,'form',p_form,'start',p_starts_on,'expiry',p_expires_on);
  v_replay:=private.mutation_result(p_actor_id,'sale_team.transfer',p_request_id,v_payload);
  if v_replay is not null then return jsonb_build_object('staffId',v_replay); end if;
  -- Fixed lock order: the person, then the accreditation row they hold.
  select * into v_staff from public.staff_users where id=p_staff_id for update;
  if not found or v_staff.status<>'active' then raise exception 'INVALID_ACCREDITATION_TARGET' using errcode='22023'; end if;
  select * into v_old from private.sale_team_accreditations where staff_id=p_staff_id for update;
  if v_old.staff_id is null then raise exception 'ACCREDITATION_REQUIRED' using errcode='22023'; end if;
  delete from private.sale_team_accreditations where staff_id=p_staff_id;

  if p_direction='IST_TO_OST' then
    if v_old.kind<>'IST' then raise exception 'ACCREDITATION_KIND_CONFLICT' using errcode='22023'; end if;
    if p_sponsor_id is null or p_sponsor_id=p_staff_id then raise exception 'OST_ACTIVE_SM_REQUIRED' using errcode='22023'; end if;
    v_sponsor:=private.ost_manual_sponsor(p_sponsor_id);
    if p_identity is null or jsonb_typeof(p_identity)<>'object' or p_form is null or jsonb_typeof(p_form)<>'object' then raise exception 'INVALID_OST_FORM' using errcode='22023'; end if;
    if nullif(btrim(coalesce(p_identity->>'firstName','')),'') is null or nullif(btrim(coalesce(p_identity->>'lastName','')),'') is null
      or nullif(btrim(coalesce(p_identity->>'phone','')),'') is null or nullif(btrim(coalesce(p_identity->>'birthDate','')),'') is null
      or p_identity->'address' is null or jsonb_typeof(p_identity->'address')<>'object' then raise exception 'INVALID_OST_FORM' using errcode='22023'; end if;
    -- The application must be this person: the email is their staff login and
    -- ost_members.email is unique, so a different address would mint a second
    -- identity for one human.
    if lower(coalesce(p_identity->>'email',''))<>lower(v_staff.email)
      or exists(select 1 from public.ost_members m where m.id<>p_staff_id and lower(m.email)=lower(v_staff.email)) then
      raise exception 'OST_IDENTITY_REQUIRED' using errcode='22023'; end if;
    -- A live application must not be clobbered (and unique(email,status)
    -- would refuse a second submitted row anyway).
    if exists(select 1 from public.ost_applications a where a.status in ('submitted','under_review','changes_requested')
        and (lower(a.email)=lower(v_staff.email) or a.phone=p_identity->>'phone')) then
      raise exception 'OST_APPLICATION_IN_PROGRESS' using errcode='22023'; end if;
    if p_starts_on is null or p_expires_on is null or p_expires_on<p_starts_on then raise exception 'OST_VALIDITY_REQUIRED' using errcode='22023'; end if;
    -- The signed evidence is stated, never assumed: a form that admits a
    -- missing signature, or carries no real date, cannot complete a transfer.
    if coalesce(p_form->>'applicantSignatureStatus','')<>'received'
      or coalesce(p_form->>'referrerSignatureStatus','')<>'received'
      or nullif(btrim(coalesce(p_form->>'applicantSignedOn','')),'') is null
      or nullif(btrim(coalesce(p_form->>'referrerSignedOn','')),'') is null then
      raise exception 'OST_SIGNATURE_EVIDENCE_REQUIRED' using errcode='22023'; end if;
    if nullif(btrim(coalesce(p_form->>'dateApplied','')),'') is null
      or coalesce(p_form->>'programCategory','') not in ('vip_holder','non_vip','future_vip') then
      raise exception 'INVALID_OST_FORM' using errcode='22023'; end if;
    -- Retire the IST number first, then state the OST side: the successor
    -- preserves the complete AAI suffix under AAO (the seller changes the
    -- kind's identifier) and the retired number stays resolvable in history.
    v_new_kind:='OST';
    if v_old.status<>'active' or v_old.aa_number !~ '^AAI[0-9]+$' then raise exception 'OST_CONVERSION_IST_REQUIRED' using errcode='22023'; end if;
    if p_expires_on<>(p_starts_on+interval '1 year')::date then raise exception 'OST_ANNUAL_VALIDITY_REQUIRED' using errcode='22023'; end if;
    if exists(select 1 from public.referral_relationships where upline_staff_id=p_staff_id and is_active) then raise exception 'OST_CONVERSION_DOWNLINES_ACTIVE' using errcode='22023'; end if;
    v_number:='AAO'||substr(v_old.aa_number,4);
    if exists(select 1 from private.sale_team_accreditations where aa_number=v_number)
      or exists(select 1 from private.sale_team_accreditation_history where aa_number=v_number) then raise exception 'ACCREDITATION_NUMBER_TAKEN' using errcode='P0001'; end if;
    v_from_role:=private.staff_role_slug(p_staff_id);
    select upline_staff_id into v_old_head from public.referral_relationships where subject_staff_id=p_staff_id and is_active for update;

    insert into private.ost_ist_conversions(request_id,staff_id,from_aa_number,to_aa_number,from_role,from_upline_staff_id,effective_date,approved_by)
      values(p_request_id,p_staff_id,v_old.aa_number,v_number,v_from_role,v_old_head,p_starts_on,p_actor_id);
    insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
      values(p_staff_id,v_number,v_staff.full_name,'OST','active',p_starts_on,p_expires_on,p_actor_id);
    insert into private.sale_team_accreditation_history(staff_id,aa_number,kind,public_name,starts_on,expires_on,event,successor_aa_number,reason,recorded_by)
      values(p_staff_id,v_old.aa_number,v_old.kind,v_old.public_name,v_old.starts_on,v_old.expires_on,'transferred',v_number,btrim(p_reason),p_actor_id);
    -- The consumed referral code records the authorized provenance exactly
    -- like a manual OST form; its plaintext is never returned or shared.
    insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,expires_at,max_uses,use_count,is_active,created_by)
      values(encode(digest(gen_random_uuid()::text,'sha256'),'hex'),'MANUAL',p_sponsor_id,now(),1,1,false,p_actor_id) returning id into v_code_id;
    v_app:=gen_random_uuid();
    insert into public.ost_applications(id,referral_code_id,sponsor_staff_id,email,phone,first_name,middle_name,last_name,birth_date,address,status)
      values(v_app,v_code_id,p_sponsor_id,lower(v_staff.email),p_identity->>'phone',p_identity->>'firstName',nullif(p_identity->>'middleName',''),p_identity->>'lastName',(p_identity->>'birthDate')::date,p_identity->'address','submitted');
    update public.ost_applications set registration_details='{"officialAccreditation":true}' where id=v_app;
    v_hash:=encode(digest(private.normalized_mutation_json(jsonb_build_object('direction',p_direction,'staff',p_staff_id,'identity',p_identity,'form',p_form,'sponsor',p_sponsor_id))::text,'sha256'),'hex');
    insert into private.ost_registration_details(application_id,request_id,payload_hash,date_applied,form_number,program_category,vip_card_type,official_details,referrer_snapshot,
      applicant_signature_status,referrer_signature_status,applicant_signed_on,referrer_signed_on,source,created_by)
      values(v_app,gen_random_uuid(),v_hash,(p_form->>'dateApplied')::date,'AF-'||upper(replace(v_app::text,'-','')),p_form->>'programCategory',nullif(p_form->>'vipCardType',''),
        p_form-ARRAY['dateApplied','programCategory','vipCardType','applicantSignatureStatus','referrerSignatureStatus','referrerSnapshot'],
        v_sponsor||coalesce(p_form->'referrerSnapshot','{}'),p_form->>'applicantSignatureStatus',p_form->>'referrerSignatureStatus',
        nullif(p_form->>'applicantSignedOn','')::date,nullif(p_form->>'referrerSignedOn','')::date,'manual',p_actor_id);
    update private.ost_registration_details set referrer_snapshot=referrer_snapshot||v_sponsor where application_id=v_app;
    v_name:=concat_ws(' ',p_identity->>'firstName',nullif(p_identity->>'middleName',''),p_identity->>'lastName');
    select id into v_role from public.roles where slug='ost' and is_active;
    if v_role is null then raise exception 'ROLE_NOT_FOUND'; end if;
    -- Role first, then the edge: the genealogy trigger reads the SUBJECT role
    -- slug and must see 'ost' already assigned.
    update public.staff_role_assignments set role_id=v_role,assigned_by=p_actor_id where staff_id=p_staff_id;
    update public.referral_relationships set is_active=false where subject_staff_id=p_staff_id and is_active;
    insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
      values(p_staff_id,p_sponsor_id,'ost',true,true,p_actor_id);
    if exists(select 1 from public.ost_members where id=p_staff_id) then
      update public.ost_members set application_id=v_app,sponsor_staff_id=p_sponsor_id,full_name=v_name,phone=p_identity->>'phone',status='active',approved_by=p_actor_id,approved_at=now()
        where id=p_staff_id returning ost_number into v_ost_number;
    else
      select ost_number into v_ost_number from public.next_ost_number();
      insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,status,approved_by)
        values(p_staff_id,v_app,p_sponsor_id,v_ost_number,v_name,lower(v_staff.email),p_identity->>'phone','active',p_actor_id);
    end if;
    -- The OST accreditation row exists already, so the AA trigger on the term
    -- insert deliberately does nothing: this function owns the number.
    insert into private.ost_accreditation_terms(ost_id,application_id,starts_on,expires_on,approved_by)
      values(p_staff_id,v_app,p_starts_on,p_expires_on,p_actor_id) returning id into v_term;
    update public.ost_applications set status='approved',reviewed_by=p_actor_id,reviewed_at=now() where id=v_app;
    v_new:=jsonb_build_object('termId',v_term,'ostNumber',v_ost_number,'applicationId',v_app);
  else
    if v_old.kind<>'OST' then raise exception 'ACCREDITATION_KIND_CONFLICT' using errcode='22023'; end if;
    if p_target_position is null or p_target_position not in ('vice_director','senior_sales_manager','sales_manager') then
      raise exception 'INVALID_ACCREDITATION_TARGET' using errcode='22023'; end if;
    -- An open renewal must not be left behind: approving it later would
    -- target a member who is no longer an OST.
    if exists(select 1 from private.ost_accreditation_renewals r where r.ost_id=p_staff_id
        and r.status in ('submitted','under_review','changes_requested','endorsed')) then
      raise exception 'OST_RENEWAL_IN_PROGRESS' using errcode='22023'; end if;
    select id into v_role from public.roles where slug=p_target_position and is_active;
    if v_role is null then raise exception 'ROLE_NOT_FOUND'; end if;
    if p_target_position='vice_director' then
      if p_head_id is not null then raise exception 'INVALID_HIERARCHY_DIRECTION' using errcode='22023'; end if;
    else
      v_expected:=case p_target_position when 'senior_sales_manager' then 'vice_director' else 'senior_sales_manager' end;
      if p_head_id is not null and p_head_id<>p_staff_id then
        select r.slug into v_head_slug from public.staff_users s
          join public.staff_role_assignments ra on ra.staff_id=s.id join public.roles r on r.id=ra.role_id and r.is_active
          where s.id=p_head_id and s.status='active';
      end if;
      if p_head_id is null or p_head_id=p_staff_id or v_head_slug is distinct from v_expected then
        raise exception 'INVALID_HIERARCHY_DIRECTION' using errcode='22023'; end if;
    end if;
    if not exists(select 1 from private.ost_accreditation_terms where ost_id=p_staff_id and status='active') or exists(select 1 from private.ost_accreditation_terms where ost_id=p_staff_id and status='active' and expires_on >= (now() at time zone 'Asia/Manila')::date) then raise exception 'OST_ACCREDITATION_EXPIRED_REQUIRED' using errcode='22023'; end if;
    -- Retire the OST side: membership, current term, sponsoring edge.
    update public.ost_members set status='inactive' where id=p_staff_id and status='active';
    if not found then raise exception 'OST_IDENTITY_REQUIRED' using errcode='22023'; end if;
    update private.ost_accreditation_terms set status='revoked' where ost_id=p_staff_id and status='active';
    -- Allocation month only; employment has no accreditation term.
    v_start:=(now() at time zone 'Asia/Manila')::date;
    v_end:=null;
    v_new_kind:='IST';
    v_number:=private.next_sale_team_aa_number('IST',v_start);
    insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
      values(p_staff_id,v_number,v_staff.full_name,'IST','active',null,null,p_actor_id);
    insert into private.sale_team_accreditation_history(staff_id,aa_number,kind,public_name,starts_on,expires_on,event,successor_aa_number,reason,recorded_by)
      values(p_staff_id,v_old.aa_number,v_old.kind,v_old.public_name,v_old.starts_on,v_old.expires_on,'transferred',v_number,btrim(p_reason),p_actor_id);
    update public.staff_role_assignments set role_id=v_role,assigned_by=p_actor_id where staff_id=p_staff_id;
    update public.referral_relationships set is_active=false where subject_staff_id=p_staff_id and is_active;
    if p_head_id is not null then
      insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
        values(p_staff_id,p_head_id,p_target_position,true,true,p_actor_id);
    end if;
    -- The profile may not exist (an OST account has no members record); when
    -- it does, the head link is kept in step with the genealogy edge.
    update public.network_member_profiles set referrer_staff_id=p_head_id,ost_referrer_staff_id=null,updated_at=now() where staff_id=p_staff_id;
    v_new:=jsonb_build_object('identityIssuedOn',v_start,'startsOn',null,'expiresOn',null);
  end if;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(p_actor_id,'SALE_TEAM_ACCREDITATION_TRANSFERRED','staff_user',p_staff_id::text,
      jsonb_build_object('kind',v_old.kind,'aaNumber',v_old.aa_number,'startsOn',v_old.starts_on,'expiresOn',v_old.expires_on),
      jsonb_build_object('direction',p_direction,'kind',v_new_kind,'aaNumber',v_number,'reason',btrim(p_reason))||v_new);
  perform private.complete_mutation(p_actor_id,'sale_team.transfer',p_request_id,v_payload,p_staff_id);
  return jsonb_build_object('direction',p_direction,'previousAaNumber',v_old.aa_number,'aaNumber',v_number,'kind',v_new_kind)||v_new;
end $$;

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
  from (select aa_number from private.sale_team_accreditations union all select aa_number from private.sale_team_accreditation_history) a
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
commit;