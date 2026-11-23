-- Official OST forms, approved validity history, renewal and import staging.
-- Forward-only: no legacy term/source/expiry is inferred or backfilled.
-- Validate: supabase/security/rls_invariants.sql returns zero rows; execute the
-- disposable accreditation concurrency/rollback/ACL suite. #19 is excluded.
-- SELECT * FROM private.ost_accreditation_terms WHERE expires_on < starts_on; -- 0
-- SELECT * FROM private.ost_import_rows WHERE status='committed' AND application_id IS NULL; -- 0
-- Down: retire the new callers in a later migration; preserve all form/history
-- records. Never remove people, applied migrations or historical terms.

create table if not exists private.ost_registration_details (
  application_id uuid primary key references public.ost_applications(id) on delete restrict,
  request_id uuid not null unique,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  date_applied date not null,
  form_number text not null unique,
  form_version text not null default 'AFHOMES-OST-1',
  program_category text not null check(program_category in ('vip_holder','non_vip','future_vip')),
  vip_card_type text check(vip_card_type in ('BRONZE','SILVER','GOLD')),
  -- Identity already lives on the frozen application; supplemental official
  -- fields and ID number stay in PRIVATE storage, never in public JSON/audits.
  official_details jsonb not null check(jsonb_typeof(official_details)='object'),
  referrer_snapshot jsonb not null check(jsonb_typeof(referrer_snapshot)='object'),
  applicant_signature_status text not null check(applicant_signature_status in ('pending','received')),
  referrer_signature_status text not null check(referrer_signature_status in ('pending','received')),
  applicant_signed_on date,
  referrer_signed_on date,
  endorsed_by uuid references public.staff_users(id) on delete restrict,
  endorsed_at timestamptz,
  source text not null check(source in ('public','manual','import')),
  created_by uuid references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check((endorsed_by is null)=(endorsed_at is null))
);
create table if not exists private.ost_accreditation_renewals (
  id uuid primary key default gen_random_uuid(),
  renewal_number text not null unique,
  request_id uuid not null unique,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  ost_id uuid not null references public.ost_members(id) on delete restrict,
  prior_term_id uuid not null,
  date_of_renewal date not null,
  requested_start date not null,
  requested_end date not null,
  status text not null default 'submitted' check(status in ('submitted','under_review','changes_requested','endorsed','approved','rejected','withdrawn')),
  applicant_snapshot jsonb not null check(jsonb_typeof(applicant_snapshot)='object'),
  original_accreditation_date date not null,
  last_expiry_date date not null,
  old_sponsor_staff_id uuid not null references public.staff_users(id) on delete restrict,
  proposed_new_sponsor_staff_id uuid references public.staff_users(id) on delete restrict,
  reason_for_referrer_change text,
  referrer_snapshot jsonb not null check(jsonb_typeof(referrer_snapshot)='object'),
  applicant_signature_status text not null check(applicant_signature_status in ('pending','received')),
  referrer_signature_status text not null check(referrer_signature_status in ('pending','received')),
  submitted_at timestamptz not null default now(),
  endorsed_by uuid references public.staff_users(id) on delete restrict,
  endorsed_at timestamptz,
  approved_by uuid references public.staff_users(id) on delete restrict,
  approved_at timestamptz,
  rejected_by uuid references public.staff_users(id) on delete restrict,
  rejected_at timestamptz,
  review_notes text,
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(requested_end >= requested_start),
  check(proposed_new_sponsor_staff_id is null or (proposed_new_sponsor_staff_id<>old_sponsor_staff_id and reason_for_referrer_change is not null and length(btrim(reason_for_referrer_change))>=5)),
  check((approved_by is null)=(approved_at is null)),
  check((rejected_by is null)=(rejected_at is null)),
  check((endorsed_by is null)=(endorsed_at is null)),
  check((status='approved')=(approved_at is not null)),
  check((status='rejected')=(rejected_at is not null))
);
create unique index if not exists ost_one_reviewable_renewal on private.ost_accreditation_renewals(ost_id)
where status in ('submitted','under_review','changes_requested','endorsed');
create table if not exists private.ost_accreditation_terms (
  id uuid primary key default gen_random_uuid(),
  ost_id uuid not null references public.ost_members(id) on delete restrict,
  application_id uuid unique references public.ost_applications(id) on delete restrict,
  renewal_id uuid unique references private.ost_accreditation_renewals(id) on delete restrict,
  starts_on date not null,
  expires_on date not null,
  status text not null default 'active' check(status in ('active','superseded','revoked')),
  approved_by uuid not null references public.staff_users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check(expires_on>=starts_on),
  check(num_nonnulls(application_id,renewal_id)=1)
);
create unique index if not exists ost_one_current_term on private.ost_accreditation_terms(ost_id) where status='active';
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='private.ost_accreditation_renewals'::regclass and conname='ost_renewal_prior_term_fk') then
    alter table private.ost_accreditation_renewals add constraint ost_renewal_prior_term_fk foreign key(prior_term_id) references private.ost_accreditation_terms(id) on delete restrict;
  end if;
end $$;
create table if not exists private.ost_import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check(source_type in ('excel','csv','google_sheets')),
  source_name text not null,
  google_sheet_id text,
  created_by uuid not null references public.staff_users(id) on delete restrict,
  status text not null default 'ready' check(status in ('ready','completed','cancelled')),
  total_rows integer not null check(total_rows between 1 and 5000),
  valid_rows integer not null check(valid_rows>=0),
  invalid_rows integer not null check(invalid_rows>=0),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.staff_users(id) on delete restrict,
  check(total_rows=valid_rows+invalid_rows),
  check((status='completed')=(confirmed_at is not null)),
  check((confirmed_at is null)=(confirmed_by is null))
);
create table if not exists private.ost_import_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references private.ost_import_jobs(id) on delete restrict,
  row_number integer not null check(row_number>0),
  normalized_data jsonb not null check(jsonb_typeof(normalized_data)='object'),
  status text not null check(status in ('valid','error','committed')),
  errors jsonb not null default '[]' check(jsonb_typeof(errors)='array'),
  sponsor_staff_id uuid references public.staff_users(id) on delete restrict,
  application_id uuid unique references public.ost_applications(id) on delete restrict,
  unique(job_id,row_number),
  check((status='committed')=(application_id is not null))
);
do $$ declare t text; begin
  foreach t in array array['ost_registration_details','ost_accreditation_terms','ost_accreditation_renewals','ost_import_jobs','ost_import_rows'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function private.ost_active_sponsor(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_staff public.staff_users%rowtype;
begin
  select s.* into v_staff from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id
    join public.roles r on r.id=a.role_id and r.is_active and r.slug='sales_manager'
    where s.id=p_id and s.status='active';
  if not found then raise exception 'OST_ACTIVE_SM_REQUIRED' using errcode='22023'; end if;
  return jsonb_build_object('staffId',v_staff.id,'name',v_staff.full_name,'email',v_staff.email);
end $$;
create or replace function private.ost_reviewer(p_actor uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text;
begin
  v_role:=private.mutation_actor_role(p_actor,'network.ost_registrations','update');
  if v_role not in ('admin','super_admin','senior_sales_manager','vice_director') then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  return v_role;
end $$;
create or replace function private.ost_owned_or_view(p_actor uuid,p_ost uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if p_actor=p_ost and exists(select 1 from public.staff_users s
    join public.staff_role_assignments a on a.staff_id=s.id
    join public.roles r on r.id=a.role_id and r.is_active and r.slug='ost'
    join public.ost_members m on m.id=s.id and m.status='active'
    where s.id=p_actor and s.status='active') then return 'ost'; end if;
  return private.mutation_actor_role(p_actor,'network.ost_registrations','view');
end $$;
create or replace function private.ost_scope(p_actor uuid,p_sponsor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_role text;
begin
  select r.slug into v_role from public.staff_users s
    join public.staff_role_assignments a on a.staff_id=s.id
    join public.roles r on r.id=a.role_id and r.is_active where s.id=p_actor and s.status='active';
  if v_role is null then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  if v_role in ('vice_director','senior_sales_manager','sales_manager','ost') and p_sponsor is distinct from p_actor then
    if v_role not in ('vice_director','senior_sales_manager') or not exists(
      with recursive team(id,path) as (
        select p_actor,array[p_actor]
        union all select e.subject_staff_id,t.path||e.subject_staff_id
        from team t join public.referral_relationships e on e.upline_staff_id=t.id and e.is_active
        where not e.subject_staff_id=any(t.path)
      ) select 1 from team where id=p_sponsor
    ) then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  end if;
end $$;
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
  v_sponsor:=private.ost_active_sponsor(p_sponsor_id);
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
  update public.ost_applications set registration_details='{"officialAccreditation":true}' where id=v_id;
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

-- Existing account invitation is still performed by the server's approved
-- invitation path. This finalizer runs inside the same database transaction
-- as account/member/genealogy installation, and is retry-safe per application.
create or replace function public.approve_ost_accreditation(p_application_id uuid,p_actor_id uuid,p_ost_id uuid,p_starts_on date,p_expires_on date)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_detail private.ost_registration_details%rowtype; v_term uuid;
begin
  perform private.ost_reviewer(p_actor_id);
  select * into v_app from public.ost_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  select id into v_term from private.ost_accreditation_terms where application_id=p_application_id;
  if found then
    if not exists(select 1 from private.ost_accreditation_terms where id=v_term and ost_id=p_ost_id and starts_on=p_starts_on and expires_on=p_expires_on) then raise exception 'MUTATION_PAYLOAD_CONFLICT'; end if;
    return v_term;
  end if;
  if v_app.status not in ('submitted','under_review','changes_requested') then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  select * into v_detail from private.ost_registration_details where application_id=p_application_id;
  if not found or v_detail.endorsed_at is null or v_detail.applicant_signature_status<>'received' or v_detail.referrer_signature_status<>'received' then raise exception 'OST_ENDORSEMENT_REQUIRED'; end if;
  if p_starts_on is null or p_expires_on is null or p_expires_on<p_starts_on then raise exception 'OST_VALIDITY_REQUIRED'; end if;
  perform private.ost_active_sponsor(v_app.sponsor_staff_id);
  if not exists(select 1 from public.ost_members where id=p_ost_id and application_id=v_app.id and sponsor_staff_id=v_app.sponsor_staff_id and status='active') then raise exception 'OST_IDENTITY_REQUIRED'; end if;
  insert into private.ost_accreditation_terms(ost_id,application_id,starts_on,expires_on,approved_by) values(p_ost_id,v_app.id,p_starts_on,p_expires_on,p_actor_id) returning id into v_term;
  update public.ost_applications set status='approved',reviewed_by=p_actor_id,reviewed_at=now() where id=v_app.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'OST_ACCREDITATION_APPROVED','ost_application',v_app.id::text,jsonb_build_object('termId',v_term,'ostId',p_ost_id));
  return v_term;
end $$;

create or replace function public.submit_ost_renewal(p_request_id uuid,p_actor_id uuid,p_ost_id uuid,p_input jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_member public.ost_members%rowtype; v_term private.ost_accreditation_terms%rowtype; v_prior private.ost_accreditation_renewals%rowtype; v_id uuid:=gen_random_uuid(); v_hash text; v_role text;
begin
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED'; end if;
  v_role:=private.ost_owned_or_view(p_actor_id,p_ost_id);
  select * into v_member from public.ost_members where id=p_ost_id for update;
  if not found or v_member.status<>'active' then raise exception 'OST_IDENTITY_REQUIRED'; end if;
  if p_actor_id<>p_ost_id then perform private.ost_scope(p_actor_id,v_member.sponsor_staff_id); end if;
  if p_actor_id<>p_ost_id and p_actor_id<>v_member.sponsor_staff_id then perform private.ost_reviewer(p_actor_id); end if;
  select * into v_term from private.ost_accreditation_terms where ost_id=p_ost_id and status='active' for update;
  if not found then raise exception 'OST_PRIOR_TERM_REQUIRED'; end if;
  v_hash:=encode(digest(private.normalized_mutation_json(p_input)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,23000001));
  select * into v_prior from private.ost_accreditation_renewals where request_id=p_request_id;
  if found then
    if v_prior.created_by<>p_actor_id or v_prior.ost_id<>p_ost_id or v_prior.payload_hash<>v_hash then raise exception 'MUTATION_PAYLOAD_CONFLICT'; end if;
    return v_prior.id;
  end if;
  if nullif(p_input->>'proposedNewSponsorStaffId','') is not null then perform private.ost_active_sponsor((p_input->>'proposedNewSponsorStaffId')::uuid); end if;
  insert into private.ost_accreditation_renewals(id,renewal_number,request_id,payload_hash,ost_id,prior_term_id,date_of_renewal,requested_start,requested_end,
    applicant_snapshot,original_accreditation_date,last_expiry_date,old_sponsor_staff_id,proposed_new_sponsor_staff_id,reason_for_referrer_change,referrer_snapshot,
    applicant_signature_status,referrer_signature_status,created_by)
    values(v_id,'REN-'||upper(replace(v_id::text,'-','')),p_request_id,v_hash,p_ost_id,v_term.id,(p_input->>'dateOfRenewal')::date,(p_input->>'requestedStart')::date,(p_input->>'requestedEnd')::date,
      (select jsonb_build_object('fullName',a.first_name||' '||a.last_name,'birthDate',a.birth_date,'phone',a.phone,'email',a.email,'address',a.address,'programCategory',d.program_category,'vipCardType',d.vip_card_type) from public.ost_applications a join private.ost_registration_details d on d.application_id=a.id where a.id=v_member.application_id),(select min(starts_on) from private.ost_accreditation_terms where ost_id=p_ost_id),v_term.expires_on,v_member.sponsor_staff_id,
      nullif(p_input->>'proposedNewSponsorStaffId','')::uuid,nullif(btrim(p_input->>'reasonForReferrerChange'),''),private.ost_active_sponsor(v_member.sponsor_staff_id),
      p_input->>'applicantSignatureStatus',p_input->>'referrerSignatureStatus',p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'OST_RENEWAL_SUBMITTED','ost_renewal',v_id::text,jsonb_build_object('ostId',p_ost_id,'status','submitted'));
  return v_id;
end $$;

create or replace function public.decide_ost_renewal(p_id uuid,p_actor_id uuid,p_action text,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_renew private.ost_accreditation_renewals%rowtype; v_member public.ost_members%rowtype; v_term private.ost_accreditation_terms%rowtype; v_result uuid; v_sponsor uuid;
begin
  -- Total lock order: member -> renewal -> prior term. Submission uses member
  -- first as well; concurrent approvals cannot create overlapping current terms.
  select m.* into v_member from public.ost_members m join private.ost_accreditation_renewals r on r.ost_id=m.id where r.id=p_id for update of m;
  if not found then raise exception 'OST_RENEWAL_NOT_FOUND'; end if;
  select * into v_renew from private.ost_accreditation_renewals where id=p_id for update;
  if p_action='endorse' then
    perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','view');
    if p_actor_id<>v_member.sponsor_staff_id then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
    perform private.ost_active_sponsor(p_actor_id);
  else
    perform private.ost_reviewer(p_actor_id);
    perform private.ost_scope(p_actor_id,v_member.sponsor_staff_id);
  end if;
  if p_action='approve' and v_renew.status='approved' then select id into v_result from private.ost_accreditation_terms where renewal_id=p_id; return v_result; end if;
  if p_action='reject' and v_renew.status='rejected' then return p_id; end if;
  if p_action='endorse' and v_renew.endorsed_at is not null then return p_id; end if;
  if v_renew.status not in ('submitted','under_review','changes_requested','endorsed') then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  if p_action='endorse' then
    update private.ost_accreditation_renewals set status='endorsed',endorsed_by=p_actor_id,endorsed_at=now(),updated_at=now() where id=p_id;
  elsif p_action='reject' then
    if length(btrim(coalesce(p_notes,'')))<5 then raise exception 'INVALID_OST_FORM'; end if;
    update private.ost_accreditation_renewals set status='rejected',rejected_by=p_actor_id,rejected_at=now(),review_notes=btrim(p_notes),updated_at=now() where id=p_id;
  elsif p_action='request-changes' then
    if length(btrim(coalesce(p_notes,'')))<5 then raise exception 'INVALID_OST_FORM'; end if;
    update private.ost_accreditation_renewals set status='changes_requested',review_notes=btrim(p_notes),endorsed_at=null,endorsed_by=null,updated_at=now() where id=p_id;
  elsif p_action='approve' then
    if v_member.status<>'active' or v_renew.endorsed_at is null or v_renew.applicant_signature_status<>'received' or v_renew.referrer_signature_status<>'received' then raise exception 'OST_ENDORSEMENT_REQUIRED'; end if;
    select * into v_term from private.ost_accreditation_terms where id=v_renew.prior_term_id for update;
    if v_term.status<>'active' or v_term.ost_id<>v_member.id then raise exception 'OST_PRIOR_TERM_REQUIRED'; end if;
    if v_member.sponsor_staff_id<>v_renew.old_sponsor_staff_id then raise exception 'OST_SPONSOR_CHANGED'; end if;
    v_sponsor:=coalesce(v_renew.proposed_new_sponsor_staff_id,v_member.sponsor_staff_id);
    perform private.ost_active_sponsor(v_sponsor);
    update private.ost_accreditation_terms set status='superseded' where id=v_term.id;
    insert into private.ost_accreditation_terms(ost_id,renewal_id,starts_on,expires_on,approved_by) values(v_member.id,p_id,v_renew.requested_start,v_renew.requested_end,p_actor_id) returning id into v_result;
    if v_sponsor<>v_member.sponsor_staff_id then
      -- Existing genealogy trigger validates adjacency, uniqueness and cycles.
      update public.referral_relationships set is_active=false,updated_at=now() where subject_staff_id=v_member.id and is_active;
      insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values(v_member.id,v_sponsor,'ost',true,true,p_actor_id);
      update public.ost_members set sponsor_staff_id=v_sponsor where id=v_member.id;
      insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_id,'OST_REFERRER_CHANGED','ost_member',v_member.id::text,jsonb_build_object('sponsorStaffId',v_member.sponsor_staff_id),jsonb_build_object('sponsorStaffId',v_sponsor,'renewalId',p_id));
    end if;
    update private.ost_accreditation_renewals set status='approved',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_id;
  else raise exception 'INVALID_OST_FORM'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,case p_action when 'approve' then 'OST_RENEWAL_APPROVED' when 'endorse' then 'OST_RENEWAL_ENDORSED' when 'reject' then 'OST_RENEWAL_REJECTED' else 'OST_RENEWAL_CHANGES_REQUESTED' end,'ost_renewal',p_id::text,jsonb_build_object('termId',v_result));
  return coalesce(v_result,p_id);
end $$;

create or replace function public.confirm_ost_application_signatures(p_id uuid,p_actor_id uuid,p_applicant_date date,p_referrer_date date) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_app public.ost_applications%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','view');
  select * into v_app from public.ost_applications where id=p_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_app.sponsor_staff_id<>p_actor_id then perform private.ost_reviewer(p_actor_id); end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  if v_app.status not in ('submitted','under_review','changes_requested') then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  if p_applicant_date is null or p_referrer_date is null or greatest(p_applicant_date,p_referrer_date)>current_date then raise exception 'OST_SIGNATURE_DATES_REQUIRED'; end if;
  if exists(select 1 from private.ost_registration_details where application_id=p_id and applicant_signature_status='received' and referrer_signature_status='received' and applicant_signed_on=p_applicant_date and referrer_signed_on=p_referrer_date) then return p_id; end if;
  update private.ost_registration_details set applicant_signature_status='received',referrer_signature_status='received',applicant_signed_on=p_applicant_date,referrer_signed_on=p_referrer_date,endorsed_by=null,endorsed_at=null where application_id=p_id;
  if not found then raise exception 'INVALID_OST_FORM'; end if;
  update public.ost_applications set status='under_review' where id=p_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id) values(p_actor_id,'OST_ACCREDITATION_SIGNATURES_CONFIRMED','ost_application',p_id::text);
  return p_id;
end $$;

create or replace function public.endorse_ost_accreditation(p_id uuid,p_actor_id uuid,p_signed_on date default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_detail private.ost_registration_details%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','view');
  perform private.ost_active_sponsor(p_actor_id);
  select * into v_app from public.ost_applications where id=p_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_app.sponsor_staff_id<>p_actor_id then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  select * into v_detail from private.ost_registration_details where application_id=p_id for update;
  if not found then raise exception 'INVALID_OST_FORM'; end if;
  if v_detail.endorsed_at is not null then return p_id; end if;
  if v_app.status not in ('submitted','under_review','changes_requested') then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  if v_detail.referrer_signature_status<>'received' and (p_signed_on is null or p_signed_on>current_date) then raise exception 'OST_REFERRER_SIGNATURE_REQUIRED'; end if;
  update private.ost_registration_details set endorsed_by=p_actor_id,endorsed_at=now(),referrer_signature_status='received',referrer_signed_on=coalesce(p_signed_on,referrer_signed_on) where application_id=p_id;
  update public.ost_applications set status='under_review' where id=p_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'OST_ACCREDITATION_ENDORSED','ost_application',p_id::text,'{"status":"under_review"}');
  return p_id;
end $$;

-- Public RPC facade: private tables never enter the browser Data API.
create or replace function public.ost_accreditation_records(p_actor_id uuid,p_ost_id uuid default null,p_application_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_detail jsonb; v_sponsor uuid;
begin
  v_role:=private.ost_owned_or_view(p_actor_id,p_ost_id);
  if p_ost_id is not null then
    select sponsor_staff_id into v_sponsor from public.ost_members where id=p_ost_id;
    if not found then raise exception 'OST_IDENTITY_REQUIRED'; end if;
    if p_actor_id<>p_ost_id then perform private.ost_scope(p_actor_id,v_sponsor); end if;
  end if;
  if p_application_id is not null then
    select sponsor_staff_id into v_sponsor from public.ost_applications where id=p_application_id;
    if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
    if p_actor_id=p_ost_id then
      if not exists(select 1 from public.ost_members where id=p_actor_id and application_id=p_application_id) then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
    else perform private.ost_scope(p_actor_id,v_sponsor); end if;
    select (to_jsonb(d)-'payload_hash'-'request_id')||jsonb_build_object('official_details',d.official_details-'governmentIdNumber') into v_detail from private.ost_registration_details d where application_id=p_application_id;
  end if;
  return jsonb_build_object('registration',v_detail,
    'terms',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('displayStatus',case when t.status='active' and t.expires_on<current_date then 'expired' else t.status end) order by t.starts_on,t.id) from private.ost_accreditation_terms t where t.ost_id=p_ost_id),'[]'),
    'renewals',coalesce((select jsonb_agg((to_jsonb(r)-'payload_hash'-'request_id')||jsonb_build_object('applicant_snapshot',r.applicant_snapshot-'governmentIdNumber') order by r.created_at desc,r.id) from private.ost_accreditation_renewals r where r.ost_id=p_ost_id),'[]'));
end $$;

-- Initial account installation and accreditation commit are one DB call.
-- Auth invitations remain an external GoTrue operation. A refused SQL call
-- preserves the Auth identity for safe reconciliation; it never deletes it.
create or replace function public.install_ost_accreditation_identity(p_application_id uuid,p_actor_id uuid,p_auth_id uuid,p_starts_on date,p_expires_on date)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_role uuid; v_number text; v_term uuid;
begin
  perform private.ost_reviewer(p_actor_id);
  select * into v_app from public.ost_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  if v_app.status='approved' then
    select id into v_term from private.ost_accreditation_terms where application_id=p_application_id;
    if v_term is not null then return public.approve_ost_accreditation(p_application_id,p_actor_id,p_auth_id,p_starts_on,p_expires_on); end if;
    raise exception 'INVALID_APPLICATION_TRANSITION';
  end if;
  select id into v_role from public.roles where slug='ost' and is_active;
  if v_role is null then raise exception 'ROLE_NOT_FOUND'; end if;
  select ost_number into v_number from public.next_ost_number();
  insert into public.staff_users(id,email,full_name,status,invited_at) values(p_auth_id,v_app.email,concat_ws(' ',v_app.first_name,v_app.middle_name,v_app.last_name),'invited',now());
  insert into public.staff_role_assignments(staff_id,role_id,assigned_by) values(p_auth_id,v_role,p_actor_id);
  insert into public.staff_invitations(email,full_name,role_id,invited_by,expires_at,auth_user_id) values(v_app.email,concat_ws(' ',v_app.first_name,v_app.middle_name,v_app.last_name),v_role,p_actor_id,now()+interval '7 days',p_auth_id);
  insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,status,approved_by) values(p_auth_id,v_app.id,v_app.sponsor_staff_id,v_number,concat_ws(' ',v_app.first_name,v_app.middle_name,v_app.last_name),v_app.email,v_app.phone,'active',p_actor_id);
  insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values(p_auth_id,v_app.sponsor_staff_id,'ost',true,true,p_actor_id);
  return public.approve_ost_accreditation(p_application_id,p_actor_id,p_auth_id,p_starts_on,p_expires_on);
end $$;

create or replace function public.review_ost_accreditation(p_id uuid,p_actor_id uuid,p_action text,p_notes text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_app public.ost_applications%rowtype;
begin
  perform private.ost_reviewer(p_actor_id);
  select * into v_app from public.ost_applications where id=p_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  if p_action not in ('reject','request-changes') or length(btrim(coalesce(p_notes,'')))<5 then raise exception 'INVALID_OST_FORM'; end if;
  if v_app.status='rejected' and p_action='reject' then return p_id; end if;
  if v_app.status not in ('submitted','under_review','changes_requested') then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  update public.ost_applications set status=case p_action when 'reject' then 'rejected' else 'changes_requested' end,
    review_notes=btrim(p_notes),reviewed_by=p_actor_id,reviewed_at=now() where id=p_id;
  if p_action='request-changes' then update private.ost_registration_details set endorsed_at=null,endorsed_by=null where application_id=p_id; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id)
    values(p_actor_id,case p_action when 'reject' then 'OST_ACCREDITATION_REJECTED' else 'OST_ACCREDITATION_CHANGES_REQUESTED' end,'ost_application',p_id::text);
  return p_id;
end $$;

create or replace function public.revise_ost_renewal(p_id uuid,p_actor_id uuid,p_input jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_member public.ost_members%rowtype; v_row private.ost_accreditation_renewals%rowtype; v_hash text;
begin
  select m.* into v_member from public.ost_members m join private.ost_accreditation_renewals r on r.ost_id=m.id where r.id=p_id for update of m;
  if not found then raise exception 'OST_RENEWAL_NOT_FOUND'; end if;
  perform private.ost_owned_or_view(p_actor_id,v_member.id);
  if p_actor_id<>v_member.id and p_actor_id<>v_member.sponsor_staff_id then perform private.ost_reviewer(p_actor_id); end if;
  if p_actor_id<>v_member.id then perform private.ost_scope(p_actor_id,v_member.sponsor_staff_id); end if;
  select * into v_row from private.ost_accreditation_renewals where id=p_id for update;
  if v_row.status not in ('submitted','under_review','changes_requested') then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  if nullif(p_input->>'proposedNewSponsorStaffId','') is not null then perform private.ost_active_sponsor((p_input->>'proposedNewSponsorStaffId')::uuid); end if;
  v_hash:=encode(digest(private.normalized_mutation_json(p_input)::text,'sha256'),'hex');
  if v_row.payload_hash=v_hash and v_row.status<>'changes_requested' then return p_id; end if;
  update private.ost_accreditation_renewals set date_of_renewal=(p_input->>'dateOfRenewal')::date,requested_start=(p_input->>'requestedStart')::date,requested_end=(p_input->>'requestedEnd')::date,
    proposed_new_sponsor_staff_id=nullif(p_input->>'proposedNewSponsorStaffId','')::uuid,reason_for_referrer_change=nullif(btrim(p_input->>'reasonForReferrerChange'),''),
    applicant_signature_status=p_input->>'applicantSignatureStatus',referrer_signature_status=p_input->>'referrerSignatureStatus',
    payload_hash=v_hash,status='under_review',endorsed_at=null,endorsed_by=null,updated_at=now() where id=p_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'OST_RENEWAL_REVISED','ost_renewal',p_id::text,'{"status":"under_review"}');
  return p_id;
end $$;

create or replace function public.stage_ost_import(p_actor_id uuid,p_source text,p_name text,p_sheet_id text,p_rows jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_id uuid; v_row jsonb; v_valid integer;
begin
  perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','create');
  if p_source not in ('excel','csv','google_sheets') or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 5000 or length(btrim(p_name)) not between 1 and 200 then raise exception 'INVALID_OST_FORM'; end if;
  select count(*) into v_valid from jsonb_array_elements(p_rows) r where r->>'status'='valid';
  insert into private.ost_import_jobs(source_type,source_name,google_sheet_id,created_by,total_rows,valid_rows,invalid_rows)
    values(p_source,p_name,p_sheet_id,p_actor_id,jsonb_array_length(p_rows),v_valid,jsonb_array_length(p_rows)-v_valid) returning id into v_id;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if v_row->>'status'='valid' then
      perform private.ost_active_sponsor((v_row->>'sponsorStaffId')::uuid);
      perform private.ost_scope(p_actor_id,(v_row->>'sponsorStaffId')::uuid);
    end if;
    insert into private.ost_import_rows(job_id,row_number,normalized_data,status,errors,sponsor_staff_id)
      values(v_id,(v_row->>'rowNumber')::integer,v_row->'normalized',v_row->>'status',coalesce(v_row->'errors','[]'),nullif(v_row->>'sponsorStaffId','')::uuid);
  end loop;
  return v_id;
end $$;
create or replace function public.ost_import_preview(p_actor_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_job private.ost_import_jobs%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','create');
  select * into v_job from private.ost_import_jobs where id=p_id and created_by=p_actor_id;
  if not found then raise exception 'OST_IMPORT_NOT_FOUND'; end if;
  return jsonb_build_object('job',to_jsonb(v_job),'rows',coalesce((select jsonb_agg(
    (to_jsonb(r)-'normalized_data')||jsonb_build_object('normalized',jsonb_set(r.normalized_data,'{form}',coalesce(r.normalized_data->'form','{}')-'governmentIdNumber')) order by r.row_number)
    from private.ost_import_rows r where job_id=p_id),'[]'));
end $$;
create or replace function public.confirm_ost_import(p_actor_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_job private.ost_import_jobs%rowtype; v_row private.ost_import_rows%rowtype; v_app uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','create');
  select * into v_job from private.ost_import_jobs where id=p_id and created_by=p_actor_id for update;
  if not found then raise exception 'OST_IMPORT_NOT_FOUND'; end if;
  if v_job.status='completed' then return public.ost_import_preview(p_actor_id,p_id); end if;
  if v_job.status<>'ready' or v_job.valid_rows=0 then raise exception 'INVALID_OST_FORM'; end if;
  -- One transaction: sponsor/duplicate/audit failure rolls back every row.
  -- Invalid preview rows are retained and skipped, never converted to accounts.
  for v_row in select * from private.ost_import_rows where job_id=p_id and status='valid' order by row_number for update loop
    v_app:=public.submit_ost_accreditation(v_row.id,p_actor_id,v_row.sponsor_staff_id,null,v_row.normalized_data->'identity',v_row.normalized_data->'form','import');
    update private.ost_import_rows set status='committed',application_id=v_app where id=v_row.id;
  end loop;
  update private.ost_import_jobs set status='completed',confirmed_at=now(),confirmed_by=p_actor_id where id=p_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'OST_IMPORT_CONFIRMED','ost_import_job',p_id::text,jsonb_build_object('pendingApplications',v_job.valid_rows,'invalidRows',v_job.invalid_rows));
  return public.ost_import_preview(p_actor_id,p_id);
end $$;

-- Registration is one atomic application/master transaction. The existing
-- retry registry and permission vocabulary remain authoritative; no new table,
-- arbitrary name merge, account activation or historical rewrite is introduced.
create or replace function public.register_customer_application_once(p_request_id uuid,p_actor_id uuid,p_header jsonb,p_primary jsonb,p_secondary jsonb default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_payload jsonb; v_result uuid; v_customer uuid; v_number text;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','create');
  if p_header ? 'customerId' or p_header ? 'saleId' then raise exception 'INVALID_APPLICATION'; end if;
  v_payload:=jsonb_build_object('newRegistration',true,'header',jsonb_strip_nulls(p_header),'primary',jsonb_strip_nulls(p_primary),'secondary',jsonb_strip_nulls(p_secondary));
  v_result:=private.mutation_result(p_actor_id,'application.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  -- Email is a conflict signal, never an instruction to merge two identities.
  perform pg_advisory_xact_lock(hashtextextended(lower(p_primary->>'email'),23000002));
  if exists(select 1 from public.customers where lower(email)=lower(p_primary->>'email')) then raise exception 'CUSTOMER_EMAIL_CONFLICT'; end if;
  select customer_number into v_number from public.next_customer_number();
  insert into public.customers(customer_number,first_name,middle_name,last_name,birth_date,email,phone,address,status,created_by)
    values(v_number,p_primary->>'firstName',nullif(p_primary->>'middleName',''),p_primary->>'lastName',(p_primary->>'birthDate')::date,lower(p_primary->>'email'),p_primary->>'mobile',
      jsonb_build_object('line1',p_primary->>'permanentAddressLine1','line2',p_primary->>'permanentAddressLine2','city',p_primary->>'cityMunicipality','province',p_primary->>'province','postalCode',p_primary->>'postalCode','countryCode','PH'),'prospect',p_actor_id) returning id into v_customer;
  v_result:=public.save_customer_application(null,p_actor_id,p_header||jsonb_build_object('customerId',v_customer),p_primary,p_secondary);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'CUSTOMER_APPLICATION_CREATED','customer_application',v_result::text,jsonb_build_object('status','draft','customerId',v_customer));
  perform private.complete_mutation(p_actor_id,'application.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

create or replace function public.reserve_from_customer_application_once(p_request_id uuid,p_actor_id uuid,p_input jsonb,p_primary jsonb,p_secondary jsonb default null,p_schedule jsonb default '[]')
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_app public.customer_applications%rowtype; v_sale public.card_sales%rowtype; v_primary jsonb; v_secondary jsonb; v_payload jsonb; v_result uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  select * into v_app from public.customer_applications where id=(p_input->>'customerApplicationId')::uuid for update;
  if not found or v_app.status not in ('submitted','approved') then raise exception 'APPLICATION_NOT_ELIGIBLE'; end if;
  if v_app.created_by<>p_actor_id then perform private.mutation_actor_role(p_actor_id,'sales.customers','update'); end if;
  select * into v_sale from public.card_sales where id=(p_input->>'saleId')::uuid;
  if not found or v_sale.customer_id<>v_app.customer_id or v_sale.plan_id<>v_app.plan_id or v_sale.status in ('cancelled','voided') or
    (v_app.sale_id is not null and v_app.sale_id<>v_sale.id) then raise exception 'APPLICATION_SALE_CONFLICT'; end if;
  if v_sale.seller_staff_id is distinct from p_actor_id and v_sale.seller_ost_id is distinct from p_actor_id then perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update'); end if;
  select jsonb_build_object('holderType',h.holder_type,'name',concat_ws(' ',h.first_name,h.middle_name,h.last_name,h.suffix),
    'address',concat_ws(', ',h.permanent_address_line_1,h.permanent_address_line_2,h.city_municipality,h.province,h.postal_code),
    'contactNumber',h.mobile,'email',h.email,'tinNumber',h.tin_number) into v_primary from public.customer_application_holders h where application_id=v_app.id and holder_type='PRIMARY';
  select jsonb_build_object('holderType',h.holder_type,'name',concat_ws(' ',h.first_name,h.middle_name,h.last_name,h.suffix),
    'address',concat_ws(', ',h.permanent_address_line_1,h.permanent_address_line_2,h.city_municipality,h.province,h.postal_code),
    'contactNumber',h.mobile,'email',h.email,'tinNumber',h.tin_number) into v_secondary from public.customer_application_holders h where application_id=v_app.id and holder_type='SECONDARY';
  if v_primary is null then raise exception 'PRIMARY_HOLDER_REQUIRED'; end if;
  v_payload:=jsonb_build_object('fromApplication',true,'input',jsonb_strip_nulls(p_input),'primary',v_primary,'secondary',v_secondary,'schedule',p_schedule);
  v_result:=private.mutation_result(p_actor_id,'reservation.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  v_result:=public.save_reservation_agreement(null,p_actor_id,p_input,v_primary,v_secondary,p_schedule);
  -- This is still the uncommitted NEW draft. Benefits come from the submitted
  -- application; commercial amounts/payment totals remain the sale's snapshots.
  update public.reservation_agreements set tier_snapshot=v_app.tier_snapshot,
    discount_percent_snapshot=v_app.discount_percent_snapshot,
    validity_years_snapshot=v_app.validity_years_snapshot,
    yearly_points_snapshot=v_app.yearly_points_snapshot,
    annual_points_tranches_snapshot=v_app.annual_points_tranches_snapshot,
    holder_limit_snapshot=v_app.holder_limit_snapshot,
    inclusions_snapshot=jsonb_build_object('discountPercent',v_app.discount_percent_snapshot,'validityYears',v_app.validity_years_snapshot,'yearlyPoints',v_app.yearly_points_snapshot,'annualPointsTranches',v_app.annual_points_tranches_snapshot,'holderLimit',v_app.holder_limit_snapshot)
    where id=v_result;
  update public.customer_applications set sale_id=v_sale.id where id=v_app.id and sale_id is null;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'RESERVATION_AGREEMENT_CREATED','reservation_agreement',v_result::text,jsonb_build_object('status','draft','applicationId',v_app.id));
  perform private.complete_mutation(p_actor_id,'reservation.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname in ('ost_active_sponsor','ost_reviewer','ost_owned_or_view','ost_scope','submit_ost_accreditation','approve_ost_accreditation','submit_ost_renewal','decide_ost_renewal','revise_ost_renewal','endorse_ost_accreditation','confirm_ost_application_signatures','ost_accreditation_records','install_ost_accreditation_identity','review_ost_accreditation','stage_ost_import','ost_import_preview','confirm_ost_import','register_customer_application_once','reserve_from_customer_application_once') and n.nspname in ('private','public') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
    if f.nspname='public' then execute format('grant execute on function %s to service_role',f.sig); end if;
  end loop;
end $$;
