-- AF Homes sale-team: direct OST creation and IST <-> OST transfers.
--
-- Two writes the existing functions cannot express.
--
-- 1. `install_direct_ost_accreditation` completes an OST that management
--    created from the Members console. The official pipeline requires the
--    SPONSOR's endorsement (`approve_ost_accreditation` raises
--    OST_ENDORSEMENT_REQUIRED without it) and only the sponsor may endorse -
--    an operator must never record another person's consent. The direct path
--    therefore requires the two signatures the operator transcribes, and
--    records NO endorsement: `endorsed_by`/`endorsed_at` stay NULL and the
--    approving manager is the actor. Everything else mirrors
--    `install_ost_accreditation_identity` (staff account, role, invitation,
--    ost_members, sponsoring edge, term); the AA-number trigger on the term
--    insert issues the AAO number as usual.
--
-- 2. `transfer_sale_team_member` changes a member's accreditation KIND. The
--    holder's row in `private.sale_team_accreditations` is keyed by staff_id
--    and its kind/aa_number are immutable, so a transfer retires the row into
--    `private.sale_team_accreditation_history` and issues the successor
--    number in ONE transaction, then installs (IST -> OST) or retires
--    (OST -> IST) the OST footprint: application, ost_members, sponsoring
--    edge, term, role assignment.
--
-- Lock order, fixed and total: the staff row -> the accreditation row -> OST
-- rows. The accreditation row is locked before any number is allocated, so
-- two concurrent transfers of the same person cannot interleave, and
-- allocation is the same counter every other writer uses.
--
-- Deliberately not done here: no operator-typed number on a transfer (the
-- successor is always allocated), no fabricated endorsement, no renumbering
-- or reuse, no deletion of a historical application or term, and no transfer
-- while an OST renewal is still open (approving that renewal later would
-- target a member who is no longer an OST).
--
-- Dependencies: 20261023000001 (OST workflow), 20261130000001 (accreditation
-- and the OST AA trigger), 20261206000004 (manual 7-argument signature),
-- 20261207000001 (history), 20261207000002 (AA numbering). Idempotent: create
-- or replace only.
--
-- Validation after apply (expected):
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in
--      ('install_direct_ost_accreditation','transfer_sale_team_member'); -- 2
--   select checked_role from (values('anon'),('authenticated')) r(checked_role)
--    where has_function_privilege(checked_role,
--      'public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date)',
--      'EXECUTE'); -- zero rows
--   select count(*) from private.sale_team_accreditations a
--    join private.sale_team_accreditation_history h on h.aa_number=a.aa_number; -- 0
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): drop both functions. Existing
-- accreditations, applications, members and history are retained.
begin;

/* ------------------------------------------------------------------ */
/* 1. Direct OST creation                                              */
/* ------------------------------------------------------------------ */
create or replace function public.install_direct_ost_accreditation(p_application_id uuid,p_actor_id uuid,p_auth_id uuid,p_starts_on date,p_expires_on date)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_detail private.ost_registration_details%rowtype;
  v_role uuid; v_number text; v_term uuid; v_name text;
begin
  perform private.ost_reviewer(p_actor_id);
  select * into v_app from public.ost_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='22023'; end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  if v_app.status='approved' then
    select id into v_term from private.ost_accreditation_terms where application_id=p_application_id;
    if v_term is not null then
      if not exists(select 1 from private.ost_accreditation_terms where id=v_term and ost_id=p_auth_id and starts_on=p_starts_on and expires_on=p_expires_on) then
        raise exception 'MUTATION_PAYLOAD_CONFLICT' using errcode='22023';
      end if;
      return v_term;
    end if;
    raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='22023';
  end if;
  if v_app.status not in ('submitted','under_review','changes_requested') then raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='22023'; end if;
  select * into v_detail from private.ost_registration_details where application_id=p_application_id;
  -- The two signatures are the evidence the operator states. The endorsement
  -- is NOT recorded: only the sponsor can make it, so the record says there
  -- is none rather than attributing it to somebody who did not act.
  if not found or v_detail.applicant_signature_status<>'received' or v_detail.referrer_signature_status<>'received' then
    raise exception 'OST_SIGNATURE_EVIDENCE_REQUIRED' using errcode='22023';
  end if;
  if p_starts_on is null or p_expires_on is null or p_expires_on<p_starts_on then raise exception 'OST_VALIDITY_REQUIRED' using errcode='22023'; end if;
  perform private.ost_active_sponsor(v_app.sponsor_staff_id);
  if exists(select 1 from public.ost_members where id=p_auth_id) then raise exception 'OST_IDENTITY_REQUIRED' using errcode='22023'; end if;
  select id into v_role from public.roles where slug='ost' and is_active;
  if v_role is null then raise exception 'ROLE_NOT_FOUND'; end if;
  select ost_number into v_number from public.next_ost_number();
  v_name:=concat_ws(' ',v_app.first_name,v_app.middle_name,v_app.last_name);
  insert into public.staff_users(id,email,full_name,status,invited_at) values(p_auth_id,v_app.email,v_name,'invited',now());
  insert into public.staff_role_assignments(staff_id,role_id,assigned_by) values(p_auth_id,v_role,p_actor_id);
  insert into public.staff_invitations(email,full_name,role_id,invited_by,expires_at,auth_user_id) values(v_app.email,v_name,v_role,p_actor_id,now()+interval '7 days',p_auth_id);
  insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,status,approved_by) values(p_auth_id,v_app.id,v_app.sponsor_staff_id,v_number,v_name,v_app.email,v_app.phone,'active',p_actor_id);
  insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values(p_auth_id,v_app.sponsor_staff_id,'ost',true,true,p_actor_id);
  insert into private.ost_accreditation_terms(ost_id,application_id,starts_on,expires_on,approved_by) values(p_auth_id,v_app.id,p_starts_on,p_expires_on,p_actor_id) returning id into v_term;
  update public.ost_applications set status='approved',reviewed_by=p_actor_id,reviewed_at=now() where id=v_app.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'OST_ACCREDITATION_APPROVED','ost_application',v_app.id::text,jsonb_build_object('termId',v_term,'ostId',p_auth_id,'source','direct','endorsed',false));
  return v_term;
end $$;
revoke all on function public.install_direct_ost_accreditation(uuid,uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.install_direct_ost_accreditation(uuid,uuid,uuid,date,date) to service_role;

/* ------------------------------------------------------------------ */
/* 2. Transfers                                                        */
/* ------------------------------------------------------------------ */
create or replace function public.transfer_sale_team_member(
 p_actor_id uuid,p_staff_id uuid,p_direction text,p_reason text,
 p_target_position text default null,p_head_id uuid default null,p_sponsor_id uuid default null,
 p_identity jsonb default null,p_form jsonb default null,p_starts_on date default null,p_expires_on date default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_staff public.staff_users%rowtype; v_old private.sale_team_accreditations%rowtype;
  v_actor_role text; v_new_kind text; v_number text; v_role uuid; v_head_slug text; v_expected text;
  v_start date; v_end date; v_code_id uuid; v_app uuid; v_hash text; v_sponsor jsonb; v_term uuid;
  v_name text; v_ost_number text; v_new jsonb;
begin
  if p_direction is null or p_direction not in ('IST_TO_OST','OST_TO_IST') then raise exception 'INVALID_TRANSFER' using errcode='22023'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'TRANSFER_REASON_REQUIRED' using errcode='22023'; end if;
  v_actor_role:=private.mutation_actor_role(p_actor_id,'organization.staff','update');
  if v_actor_role is null or v_actor_role not in ('admin','super_admin') then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  -- Fixed lock order: the person, then the accreditation row they hold.
  select * into v_staff from public.staff_users where id=p_staff_id for update;
  if not found or v_staff.status<>'active' then raise exception 'INVALID_ACCREDITATION_TARGET' using errcode='22023'; end if;
  select * into v_old from private.sale_team_accreditations where staff_id=p_staff_id for update;
  if v_old.staff_id is null then raise exception 'ACCREDITATION_REQUIRED' using errcode='22023'; end if;
  delete from private.sale_team_accreditations where staff_id=p_staff_id;

  if p_direction='IST_TO_OST' then
    if v_old.kind<>'IST' then raise exception 'ACCREDITATION_KIND_CONFLICT' using errcode='22023'; end if;
    if p_sponsor_id is null or p_sponsor_id=p_staff_id then raise exception 'OST_ACTIVE_SM_REQUIRED' using errcode='22023'; end if;
    v_sponsor:=private.ost_active_sponsor(p_sponsor_id);
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
    -- carries a fresh AAO number (a transferred seller never keeps the other
    -- kind's identifier) and the retired number stays resolvable in history.
    v_new_kind:='OST';
    v_number:=private.next_sale_team_aa_number('OST',p_starts_on);
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
    -- Retire the OST side: membership, current term, sponsoring edge.
    update public.ost_members set status='inactive' where id=p_staff_id and status='active';
    if not found then raise exception 'OST_IDENTITY_REQUIRED' using errcode='22023'; end if;
    update private.ost_accreditation_terms set status='revoked' where ost_id=p_staff_id and status='active';
    -- A transfer carries a fresh one-year validity: the IST accreditation is
    -- the company's decision today, not the OST term's remainder.
    v_start:=(now() at time zone 'UTC')::date;
    v_end:=(v_start+interval '1 year')::date;
    v_new_kind:='IST';
    v_number:=private.next_sale_team_aa_number('IST',v_start);
    insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
      values(p_staff_id,v_number,v_staff.full_name,'IST','active',v_start,v_end,p_actor_id);
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
    v_new:=jsonb_build_object('startsOn',v_start,'expiresOn',v_end);
  end if;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(p_actor_id,'SALE_TEAM_ACCREDITATION_TRANSFERRED','staff_user',p_staff_id::text,
      jsonb_build_object('kind',v_old.kind,'aaNumber',v_old.aa_number,'startsOn',v_old.starts_on,'expiresOn',v_old.expires_on),
      jsonb_build_object('direction',p_direction,'kind',v_new_kind,'aaNumber',v_number,'reason',btrim(p_reason))||v_new);
  return jsonb_build_object('direction',p_direction,'previousAaNumber',v_old.aa_number,'aaNumber',v_number,'kind',v_new_kind)||v_new;
end $$;
revoke all on function public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date) from public,anon,authenticated;
grant execute on function public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date) to service_role;

commit;
