-- AF Homes: adapt local OST protections to develop's existing creation/transfer workflows.
-- Preserves Members UI, bidirectional route and immutable retired-number lookup.
-- IST -> OST transforms AAI to AAO without allocating a new suffix.
-- Forward reconciliation for a database that already recorded 20261208000001..8:
-- those versions never re-run, so this file re-delivers the allowance-aware
-- guards from 02/07, re-delivers 03's renewal guard so the sanctioned
-- legacy-identifier conversion can rename an alias-recorded renewal number,
-- states the operation CHECK as a forward-only union,
-- relaxes the live-only strictness the develop workflows cannot satisfy, and
-- keeps the eleven-parameter transfer call working for callers deployed before
-- the twelve-parameter form.
-- Validate: disposable lifecycle and transfer gates; browser roles cannot execute.
-- Down: forward-only replacement; retain conversion, renewal and number history.
begin;
alter table private.mutation_requests drop constraint if exists mutation_requests_operation_check;
alter table private.mutation_requests add constraint mutation_requests_operation_check
-- Forward-only union of every operation any batch has ever accepted. An
-- already-applied database holds rows for all of them (payment.verify et al.),
-- so narrowing this list would fail the ALTER against that history.
check(operation in ('payment.create','application.create','reservation.create','purchase_terms.review',
  'application.submit','application.decide','reservation.transition','payment.verify',
  'reservation.finalize','purchase.finalize','membership.activate','ost.convert',
  'ost.applicant.update','sale_team.transfer'));
create or replace function private.ost_kind_transfer_authorized(p_staff uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
select exists(select 1 from private.sale_team_accreditation_history h join private.sale_team_accreditations a on a.staff_id=h.staff_id
where h.staff_id=p_staff and h.kind='OST' and a.kind='IST' and h.successor_aa_number=a.aa_number
and h.recorded_at=now() and h.expires_on<(now() at time zone 'Asia/Manila')::date
and private.staff_role_slug(h.recorded_by) in ('admin','super_admin'));
$$;
revoke all on function private.ost_kind_transfer_authorized(uuid) from public,anon,authenticated,service_role;

-- Forward re-delivery: a database that already recorded 02 and 07 keeps their
-- old bodies, so the allowance line is repeated here. Both bodies are copies of
-- the current 02/07 files; keep the three copies in step if the allowance moves.
create or replace function private.assert_ost_genealogy_transfer(p_ost uuid,p_sponsor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_member public.ost_members%rowtype; v_term private.ost_accreditation_terms%rowtype; v_approval uuid;
begin
  select * into v_member from public.ost_members where id=p_ost for update;
  if not found then return; end if;
  if private.ost_kind_transfer_authorized(p_ost) then return; end if;
  if p_sponsor=v_member.sponsor_staff_id then return; end if;
  select * into v_term from private.ost_accreditation_terms where ost_id=p_ost and status='active' for update;
  if v_term.id is null or v_term.expires_on >= (now() at time zone 'Asia/Manila')::date then
    raise exception 'OST_ACCREDITATION_EXPIRED_REQUIRED' using errcode='22023';
  end if;
  select r.approved_by into v_approval from private.ost_accreditation_renewals r
  where r.ost_id=p_ost and r.status='approved' and r.approved_at=now()
    and r.prior_term_id=v_term.id and r.old_sponsor_staff_id=v_member.sponsor_staff_id
    and r.proposed_new_sponsor_staff_id is not null
    and (p_sponsor is null or r.proposed_new_sponsor_staff_id=p_sponsor);
  if v_approval is null then raise exception 'OST_TRANSFER_APPROVAL_REQUIRED' using errcode='42501'; end if;
  perform private.ost_reviewer(v_approval);
  perform private.ost_scope(v_approval,v_member.sponsor_staff_id);
end $$;
revoke all on function private.assert_ost_genealogy_transfer(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.guard_ost_role_workflow() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_old text; v_new text;
begin
  select slug into v_old from public.roles where id=old.role_id;
  if tg_op='DELETE' then
    if v_old='ost' and exists(select 1 from public.ost_members where id=old.staff_id) then
      raise exception 'OST_ROLE_WORKFLOW_REQUIRED' using errcode='42501';
    end if;
    return old;
  end if;
  if new.role_id=old.role_id and new.staff_id=old.staff_id then return new; end if;
  select slug into v_new from public.roles where id=new.role_id;
  if v_old='ost' and new.staff_id=old.staff_id and v_new in ('vice_director','senior_sales_manager','sales_manager') and private.ost_kind_transfer_authorized(old.staff_id) then return new; end if;
  if v_old='ost' and exists(select 1 from public.ost_members where id=old.staff_id) then
    raise exception 'OST_ROLE_WORKFLOW_REQUIRED' using errcode='42501';
  end if;
  if v_new='ost' and not exists (
    select 1 from private.ost_ist_conversions c
    join private.sale_team_accreditations a on a.staff_id=c.staff_id
      and a.kind='OST' and a.aa_number=c.to_aa_number
    where c.staff_id=old.staff_id and new.staff_id=old.staff_id
      and c.from_role=v_old and c.created_at=now()
      and c.approved_by=new.assigned_by
      and private.staff_role_slug(c.approved_by) in ('admin','super_admin')
  ) then
    raise exception 'OST_ROLE_WORKFLOW_REQUIRED' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_role_workflow() from public,anon,authenticated,service_role;

-- Forward re-delivery: the applied 03 refuses every change to renewal_number,
-- which blocks the sanctioned legacy-identifier conversion (20261027000001
-- renames renewal_number after recording an alias, and every renewal keeps a
-- REN- number until it runs). The identifier is excluded from the immutable
-- tuple and from the terminal-row freeze, so only the alias-recorded rename is
-- new; every workflow field stays immutable exactly as before.
create or replace function private.guard_ost_renewal_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_member uuid; v_term private.ost_accreditation_terms%rowtype;
begin
  if tg_op='UPDATE' then
    if old.status in ('approved','rejected','withdrawn')
      and (to_jsonb(new)-'renewal_number') is distinct from (to_jsonb(old)-'renewal_number') then
      raise exception 'OST_RENEWAL_HISTORY_IMMUTABLE' using errcode='42501';
    end if;
    if (new.id,new.ost_id,new.prior_term_id,new.applicant_snapshot,
        new.original_accreditation_date,new.last_expiry_date,new.old_sponsor_staff_id,new.referrer_snapshot,new.created_by,new.created_at)
      is distinct from
       (old.id,old.ost_id,old.prior_term_id,old.applicant_snapshot,
        old.original_accreditation_date,old.last_expiry_date,old.old_sponsor_staff_id,old.referrer_snapshot,old.created_by,old.created_at) then
      raise exception 'OST_RENEWAL_HISTORY_IMMUTABLE' using errcode='42501';
    end if;
  end if;
  select id into v_member from public.ost_members where id=new.ost_id for update;
  select * into v_term from private.ost_accreditation_terms where id=new.prior_term_id and ost_id=new.ost_id for update;
  if not found then raise exception 'OST_PRIOR_TERM_REQUIRED'; end if;
  if new.requested_end<>(new.requested_start+interval '1 year')::date then raise exception 'OST_ANNUAL_VALIDITY_REQUIRED' using errcode='22023'; end if;
  if new.requested_start<=v_term.expires_on then raise exception 'OST_TERM_OVERLAP_INVALID' using errcode='22023'; end if;
  if new.proposed_new_sponsor_staff_id is not null then
    if v_term.expires_on >= (now() at time zone 'Asia/Manila')::date then raise exception 'OST_ACCREDITATION_EXPIRED_REQUIRED' using errcode='22023'; end if;
    perform private.ost_manual_sponsor(new.proposed_new_sponsor_staff_id);
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_renewal_history() from public,anon,authenticated,service_role;
drop trigger if exists ost_renewal_history_guard on private.ost_accreditation_renewals;
create trigger ost_renewal_history_guard before insert or update on private.ost_accreditation_renewals
for each row execute function private.guard_ost_renewal_history();

-- Shape reconciliation for the already-applied database only (04 ran there with
-- the local conversion plumbing). Each statement is a no-op where 04 ran
-- without it, so fresh databases are unaffected.
alter table private.ost_ist_conversions alter column from_upline_staff_id drop not null;
do $$
begin
  if exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='ost_members' and column_name='conversion_id') then
    alter table public.ost_members drop constraint if exists ost_members_origin_required;
    alter table public.ost_members add constraint ost_members_origin_required
      check(num_nonnulls(application_id,conversion_id)>=1);
  end if;
end $$;
create or replace function public.install_direct_ost_accreditation(p_application_id uuid,p_actor_id uuid,p_auth_id uuid,p_starts_on date,p_expires_on date)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_detail private.ost_registration_details%rowtype;
  v_role uuid; v_number text; v_term uuid; v_name text;
begin
  perform private.ost_reviewer(p_actor_id);
  if private.staff_role_slug(p_actor_id) not in ('admin','super_admin') then raise exception 'OST_AA_ISSUANCE_FORBIDDEN' using errcode='42501'; end if;
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
  perform private.ost_manual_sponsor(v_app.sponsor_staff_id);
  if p_expires_on<>(p_starts_on+interval '1 year')::date then raise exception 'OST_ANNUAL_VALIDITY_REQUIRED' using errcode='22023'; end if;
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
-- The deployed Members build still calls the eleven-parameter form. It is
-- dropped here and re-created below, after the request-aware definition, as a
-- transitional wrapper: a SQL-language body is validated when it is created, so
-- the twelve-parameter form must exist first.
drop function if exists public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date);
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
  perform private.complete_mutation(p_actor_id,'sale_team.transfer',p_request_id,v_payload,p_staff_id);
  return jsonb_build_object('direction',p_direction,'previousAaNumber',v_old.aa_number,'aaNumber',v_number,'kind',v_new_kind)||v_new;
end $$;
revoke all on function public.transfer_sale_team_member(uuid,uuid,text,text,uuid,text,uuid,uuid,jsonb,jsonb,date,date) from public,anon,authenticated;
grant execute on function public.transfer_sale_team_member(uuid,uuid,text,text,uuid,text,uuid,uuid,jsonb,jsonb,date,date) to service_role;

-- Transitional eleven-parameter wrapper for callers deployed before the
-- request-aware form. The request id is derived from the normalised payload, so
-- an identical retry replays instead of transferring twice. Retire the wrapper
-- in a later migration once no deployed caller uses the old shape.
create function public.transfer_sale_team_member(
 p_actor_id uuid,p_staff_id uuid,p_direction text,p_reason text,
 p_target_position text default null,p_head_id uuid default null,p_sponsor_id uuid default null,
 p_identity jsonb default null,p_form jsonb default null,p_starts_on date default null,p_expires_on date default null
) returns jsonb language sql security definer set search_path=pg_catalog,private,public,pg_temp as $$
  select public.transfer_sale_team_member(
    p_actor_id,p_staff_id,p_direction,p_reason,
    md5(private.normalized_mutation_json(jsonb_build_object('staff',p_staff_id,'direction',p_direction,
      'reason',p_reason,'position',p_target_position,'head',p_head_id,'sponsor',p_sponsor_id,
      'identity',p_identity,'form',p_form,'start',p_starts_on,'expiry',p_expires_on))::text)::uuid,
    p_target_position,p_head_id,p_sponsor_id,
    p_identity,p_form,p_starts_on,p_expires_on);
$$;
revoke all on function public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date) from public,anon,authenticated;
grant execute on function public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date) to service_role;



-- Renewal updates current validity while earlier terms and AA-number history stay frozen.
create or replace function private.sync_ost_renewal_accreditation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  update private.sale_team_accreditations set starts_on=new.starts_on,expires_on=new.expires_on,
    approved_by=new.approved_by,approved_at=new.approved_at,status='active'
    where staff_id=new.ost_id and kind='OST';
  return new;
end $$;
revoke all on function private.sync_ost_renewal_accreditation() from public,anon,authenticated,service_role;
drop trigger if exists ost_renewal_accreditation_sync on private.ost_accreditation_terms;
create trigger ost_renewal_accreditation_sync after insert on private.ost_accreditation_terms
for each row when (new.renewal_id is not null) execute function private.sync_ost_renewal_accreditation();
commit;
