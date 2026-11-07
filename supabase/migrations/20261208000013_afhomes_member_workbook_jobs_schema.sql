-- Schema-only changes for member workbook jobs (tables, indexes, private functions).
-- Runtime callers use only service-only RPCs after API authentication.
-- This migration is backward compatible: no public RPC changes.
begin;
create table private.member_workbook_jobs (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.staff_users(id),
 kind text not null check(kind in ('IST','OST')), source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 layout_version text not null check(layout_version='company-v2'), created_at timestamptz not null default now(),
 unique(actor_id,kind,source_hash)
);
create table private.member_workbook_rows (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references private.member_workbook_jobs(id),
 row_number integer not null check(row_number between 2 and 501), planned_staff_id uuid not null,
 payload jsonb not null, decision text not null check(decision in ('CREATE','MATCH','SKIP','CONFLICT','REVIEW')),
 errors text[] not null default '{}', state text not null default 'preview' check(state in ('preview','creating','completed')),
 result_staff_id uuid references public.staff_users(id), audit_id bigint,
 approved_by uuid references public.staff_users(id), approved_at timestamptz, completed_at timestamptz,
 last_error text check(last_error in ('REVIEW_REQUIRED','OUTCOME_UNCONFIRMED')), attempts integer not null default 0, last_attempt_at timestamptz,
 unique(job_id,row_number)
);
alter table private.member_workbook_jobs enable row level security;
alter table private.member_workbook_rows enable row level security;
revoke all on private.member_workbook_jobs,private.member_workbook_rows from public,anon,authenticated,service_role;
create unique index member_workbook_email_claim on private.member_workbook_rows(lower(payload->'fields'->>'email')) where state='creating';
create unique index member_workbook_phone_claim on private.member_workbook_rows((payload->'fields'->>'canonical_mobile')) where state='creating';
create unique index member_workbook_aa_claim on private.member_workbook_rows((payload->'fields'->>'aa_number')) where state='creating' and nullif(payload->'fields'->>'aa_number','') is not null;

create function private.member_workbook_actor(p_actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if private.mutation_actor_role(p_actor,'network.members','create') not in ('admin','super_admin') then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
end $$;
revoke all on function private.member_workbook_actor(uuid) from public,anon,authenticated,service_role;

create function private.member_workbook_role(p_actor uuid,p_slug text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role uuid;
begin
 select id into v_role from public.roles where slug=p_slug and is_active;
 if v_role is null or p_slug not in ('vice_director','senior_sales_manager','sales_manager','ost') then raise exception 'INVALID_IMPORT_ROLE'; end if;
 if exists(select 1 from public.role_permissions rp join public.modules m on m.id=rp.module_id where rp.role_id=v_role and
   (rp.can_view and not private.has_permission_for_user(p_actor,m.key,'view')
    or rp.can_create and not private.has_permission_for_user(p_actor,m.key,'create')
    or rp.can_update and not private.has_permission_for_user(p_actor,m.key,'update')
    or rp.can_delete and not private.has_permission_for_user(p_actor,m.key,'delete'))) then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
end $$;
revoke all on function private.member_workbook_role(uuid,text) from public,anon,authenticated,service_role;

-- AA alone never matches a person. Current account, role, name, email, phone,
-- supplied profile values and current head must agree. No existing row is updated.
create function private.match_member_workbook_identity(p_kind text,p_fields jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid; v_owner uuid; v_email text:=lower(p_fields->>'email'); v_phone text:=p_fields->>'canonical_mobile';
 v_local_phone text; v_detail private.ost_registration_details%rowtype;
 v_aa text:=nullif(p_fields->>'aa_number',''); v_profile public.network_member_profiles%rowtype; v_app public.ost_applications%rowtype; v_pair record; v_street text;
begin
 v_local_phone:=case when v_phone ~ '^\+639[0-9]{9}$' then '0'||substring(v_phone from 4) else v_phone end;
 perform pg_advisory_xact_lock(hashtextextended(v_email,130001));
 if v_phone is not null then perform pg_advisory_xact_lock(hashtextextended(v_phone,130002)); end if;
 if v_aa is not null then
  perform pg_advisory_xact_lock(hashtextextended(v_aa,0));
  select staff_id into v_owner from (
    select staff_id from private.sale_team_accreditations where aa_number=v_aa
    union select staff_id from private.sale_team_accreditation_history where aa_number=v_aa
  ) owners;
 end if;
 select id into v_id from public.staff_users where lower(email)=v_email;
 if v_owner is not null and v_owner is distinct from v_id then raise exception 'IMPORT_IDENTITY_CONFLICT'; end if;
 if exists(select 1 from public.network_member_profiles where mobile_no in (v_phone,v_local_phone) and staff_id is distinct from v_id)
   or exists(select 1 from public.ost_members where phone in (v_phone,v_local_phone) and id is distinct from v_id) then raise exception 'IMPORT_PHONE_CONFLICT'; end if;
 if v_id is null then
   if exists(select 1 from public.staff_users where upper(regexp_replace(trim(full_name),'\s+',' ','g'))=upper(p_fields->>'canonical_name')) then raise exception 'IMPORT_AMBIGUOUS_PERSON'; end if;
   if exists(select 1 from public.ost_applications where status in ('submitted','under_review','changes_requested','approved') and (lower(email)=v_email or phone in (v_phone,v_local_phone))) then raise exception 'IMPORT_APPLICATION_CONFLICT'; end if;
   return null;
 end if;
 if not exists(select 1 from public.staff_users where id=v_id and upper(regexp_replace(trim(full_name),'\s+',' ','g'))=upper(p_fields->>'canonical_name'))
   or private.staff_role_slug(v_id) is distinct from p_fields->>'position'
   or not exists(select 1 from private.sale_team_accreditations where staff_id=v_id and kind=p_kind and (v_aa is null or aa_number=v_aa))
   then raise exception 'IMPORT_IDENTITY_CONFLICT'; end if;
 if (select upline_staff_id from public.referral_relationships where subject_staff_id=v_id and is_active and is_authoritative)
      is distinct from nullif(p_fields->>'head_staff_id','')::uuid then raise exception 'IMPORT_HEAD_CONFLICT'; end if;
 if p_kind='IST' then
  select * into v_profile from public.network_member_profiles where staff_id=v_id;
  if not found or (v_profile.mobile_no is distinct from v_phone and v_profile.mobile_no is distinct from v_local_phone)
    or (nullif(p_fields->>'birth_date','') is not null and v_profile.date_of_birth is distinct from (p_fields->>'birth_date')::date)
    or (nullif(p_fields->>'government_id_number','') is not null and v_profile.government_id_number is distinct from p_fields->>'government_id_number')
    or (nullif(p_fields->>'tin','') is not null and v_profile.tin is distinct from p_fields->>'tin') then raise exception 'IMPORT_PROFILE_CONFLICT'; end if;
  for v_pair in select key,value from jsonb_each_text(jsonb_build_object('sex',v_profile.sex,'civil_status',v_profile.civil_status,
    'province',v_profile.province,'city',v_profile.city_municipality,'telephone',v_profile.tel_no,'messenger',v_profile.fb_messenger,
    'employer_name',v_profile.employer_name,'employer_address',v_profile.employer_address,'job_position',v_profile.job_position,
    'government_id_type',v_profile.government_id_type)) loop
  if nullif(p_fields->>v_pair.key,'') is not null and lower(regexp_replace(trim(coalesce(v_pair.value,'')),'\s+',' ','g'))
    is distinct from lower(regexp_replace(trim(p_fields->>v_pair.key),'\s+',' ','g')) then raise exception 'IMPORT_PROFILE_CONFLICT'; end if;
  end loop;
  v_street:=concat_ws(', ',nullif(p_fields->>'address_line_1',''),nullif(p_fields->>'barangay',''));
  if nullif(v_street,'') is not null and lower(v_street) is distinct from lower(v_profile.street_no) then raise exception 'IMPORT_PROFILE_CONFLICT'; end if;
 else
  select a.* into v_app from public.ost_members m join public.ost_applications a on a.id=m.application_id where m.id=v_id and m.phone in (v_phone,v_local_phone);
  if not found or (nullif(p_fields->>'birth_date','') is not null and v_app.birth_date is distinct from (p_fields->>'birth_date')::date) then raise exception 'IMPORT_PROFILE_CONFLICT'; end if;
  if nullif(p_fields->>'starts_on','') is not null then
   if not exists(select 1 from private.ost_accreditation_terms where ost_id=v_id and starts_on=(p_fields->>'starts_on')::date
      and (nullif(p_fields->>'expires_on','') is null or expires_on=(p_fields->>'expires_on')::date)) then raise exception 'IMPORT_TERM_CONFLICT'; end if;
  elsif nullif(p_fields->>'expires_on','') is not null then raise exception 'IMPORT_TERM_CONFLICT'; end if;
  select * into v_detail from private.ost_registration_details where application_id=v_app.id;
  for v_pair in select key,value from jsonb_each_text(jsonb_build_object(
    'address_line_1',v_app.address->>'line1','province',v_app.address->>'province','city',v_app.address->>'city',
    'barangay',v_app.address->>'barangay','postal_code',v_app.address->>'postalCode',
    'date_applied',v_detail.date_applied,'program_category',v_detail.program_category,'vip_card_type',v_detail.vip_card_type,
    'applicant_signature',v_detail.applicant_signature_status,'referrer_signature',v_detail.referrer_signature_status,
    'applicant_signed_on',v_detail.applicant_signed_on,'referrer_signed_on',v_detail.referrer_signed_on,
    'sex',v_detail.official_details->>'sex','civil_status',v_detail.official_details->>'civilStatus',
    'government_id_type',v_detail.official_details->>'governmentIdType','government_id_number',v_detail.official_details->>'governmentIdNumber',
    'tin',v_detail.official_details->>'tin','telephone',v_detail.official_details->>'telephone','messenger',v_detail.official_details->>'messenger',
    'employer_name',v_detail.official_details->>'employerName','employer_address',v_detail.official_details->>'employerAddress')) loop
  if nullif(p_fields->>v_pair.key,'') is not null and lower(regexp_replace(trim(coalesce(v_pair.value,'')),'\s+',' ','g'))
    is distinct from lower(regexp_replace(trim(p_fields->>v_pair.key),'\s+',' ','g')) then raise exception 'IMPORT_PROFILE_CONFLICT'; end if;
  end loop;
 end if;
 return v_id;
end $$;
revoke all on function private.match_member_workbook_identity(text,jsonb) from public,anon,authenticated,service_role;
commit;