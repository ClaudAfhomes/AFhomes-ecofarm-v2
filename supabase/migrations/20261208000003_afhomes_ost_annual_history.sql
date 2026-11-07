-- AF Homes policy approved by the user on 2026-10-17: management selects the
-- renewal start; expiry is one calendar year later; no overlap with the prior term.
-- Snapshots come from registered records, never applicant VIP claims.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs and ACL audit.
-- SELECT id FROM private.ost_accreditation_terms WHERE expires_on<starts_on; -- zero
-- Down: disable new writes via a forward migration; preserve all recorded history.
begin;

create or replace function private.ost_applicant_snapshot(p_ost uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'fullName',s.full_name,'birthDate',coalesce(p.date_of_birth,a.birth_date),
    'email',s.email,'phone',coalesce(p.mobile_no,m.phone),
    'sex',coalesce(lower(p.sex),d.official_details->>'sex'),
    'civilStatus',coalesce(lower(p.civil_status),d.official_details->>'civilStatus'),
    'address',case when p.staff_id is null then a.address else jsonb_build_object(
      'line1',p.street_no,'city',p.city_municipality,'province',p.province,'postalCode',p.zip_code,'countryCode','PH') end,
    'messenger',coalesce(p.fb_messenger,d.official_details->>'messenger'),
    'employerName',coalesce(p.employer_name,d.official_details->>'employerName'),
    'jobPosition',coalesce(p.job_position,d.official_details->>'jobPosition'),
    'tinMasked',case when coalesce(p.tin,d.official_details->>'tin') is not null
      then '***'||right(coalesce(p.tin,d.official_details->>'tin'),4) else null end,
    'programCategory',case when c.id is null then 'unknown' when vip.code is not null then 'vip_holder' else 'non_vip' end,
    'vipCardType',vip.code
  ) from public.ost_members m join public.staff_users s on s.id=m.id
  join public.ost_applications a on a.id=m.application_id
  left join private.ost_registration_details d on d.application_id=a.id
  left join public.network_member_profiles p on p.staff_id=m.id
  left join public.customers c on c.auth_user_id=m.id
  left join lateral (
    select cp.code from public.memberships membership join public.card_plans cp on cp.id=membership.product_id
    where membership.customer_id=c.id and membership.status='active'
      and (membership.expires_at is null or membership.expires_at>now())
      and cp.code in ('BRONZE','SILVER','GOLD')
    order by membership.activated_at desc,membership.id limit 1
  ) vip on true where m.id=p_ost;
$$;
revoke all on function private.ost_applicant_snapshot(uuid) from public,anon,authenticated,service_role;

create or replace function private.guard_ost_renewal_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_member uuid; v_term private.ost_accreditation_terms%rowtype;
begin
  if tg_op='UPDATE' then
    if old.status in ('approved','rejected','withdrawn') and new is distinct from old then
      raise exception 'OST_RENEWAL_HISTORY_IMMUTABLE' using errcode='42501';
    end if;
    if (new.id,new.renewal_number,new.ost_id,new.prior_term_id,new.applicant_snapshot,
        new.original_accreditation_date,new.last_expiry_date,new.old_sponsor_staff_id,new.referrer_snapshot,new.created_by,new.created_at)
      is distinct from
       (old.id,old.renewal_number,old.ost_id,old.prior_term_id,old.applicant_snapshot,
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

create or replace function private.guard_ost_term_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
    raise exception 'OST_TERM_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_term_history() from public,anon,authenticated,service_role;
drop trigger if exists ost_term_history_guard on private.ost_accreditation_terms;
create trigger ost_term_history_guard before update on private.ost_accreditation_terms
for each row execute function private.guard_ost_term_history();

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
      private.ost_applicant_snapshot(p_ost_id),(select min(starts_on) from private.ost_accreditation_terms where ost_id=p_ost_id),v_term.expires_on,v_member.sponsor_staff_id,
      nullif(p_input->>'proposedNewSponsorStaffId','')::uuid,nullif(btrim(p_input->>'reasonForReferrerChange'),''),private.ost_active_sponsor(v_member.sponsor_staff_id),
      p_input->>'applicantSignatureStatus',p_input->>'referrerSignatureStatus',p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'OST_RENEWAL_SUBMITTED','ost_renewal',v_id::text,jsonb_build_object('ostId',p_ost_id,'status','submitted'));
  return v_id;
end $$;
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
    select (to_jsonb(d)-'payload_hash'-'request_id')||jsonb_build_object('official_details',d.official_details-ARRAY['governmentIdNumber','tin']) into v_detail from private.ost_registration_details d where application_id=p_application_id;
  end if;
  return jsonb_build_object('registration',v_detail,'currentApplicant',case when p_ost_id is not null then private.ost_applicant_snapshot(p_ost_id) else null end,
    'terms',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('displayStatus',case when t.status='active' and t.expires_on<current_date then 'expired' else t.status end) order by t.starts_on,t.id) from private.ost_accreditation_terms t where t.ost_id=p_ost_id),'[]'),
    'renewals',coalesce((select jsonb_agg((to_jsonb(r)-'payload_hash'-'request_id')||jsonb_build_object('applicant_snapshot',r.applicant_snapshot-'governmentIdNumber') order by r.created_at desc,r.id) from private.ost_accreditation_renewals r where r.ost_id=p_ost_id),'[]'));
end $$;
commit;
