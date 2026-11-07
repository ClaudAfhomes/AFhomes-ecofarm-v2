-- Public RPCs and function replacements for member workbook jobs (requires coordinated deploy).
-- Applies after schema migration 20261208000013.
-- Replaces install_direct_ost_password and adds new public import RPCs.
begin;
-- Public RPCs for durable import workflow
create function public.stage_member_workbook(p_actor uuid,p_kind text,p_source_hash text,p_rows jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_job uuid; v_row jsonb; v_id uuid; v_errors text[]; v_decision text;
begin
 perform private.member_workbook_actor(p_actor);
 if p_kind not in ('IST','OST') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'INVALID_IMPORT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_kind||p_source_hash,130003));
 select id into v_job from private.member_workbook_jobs where actor_id=p_actor and kind=p_kind and source_hash=p_source_hash;
 if found then return v_job; end if;
 insert into private.member_workbook_jobs(actor_id,kind,source_hash,layout_version) values(p_actor,p_kind,p_source_hash,'company-v2') returning id into v_job;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_errors:=array(select jsonb_array_elements_text(v_row->'errors')); v_id:=null;
  v_decision:=case when cardinality(v_errors)>0 then 'REVIEW' else 'CREATE' end;
  begin
   v_id:=private.match_member_workbook_identity(p_kind,v_row->'fields');
   if v_id is not null then
    if v_id is distinct from (v_row->'fields'->>'planned_staff_id')::uuid then raise exception 'IMPORT_IDENTITY_CONFLICT'; end if;
    v_decision:=case when cardinality(v_errors)>0 then 'REVIEW' else 'MATCH' end;
   end if;
  exception when raise_exception then
   v_decision:='CONFLICT'; v_errors:=array_append(v_errors,case sqlerrm
     when 'IMPORT_TERM_CONFLICT' then 'Accreditation dates do not match a recorded OST term. Use the renewal workflow; import cannot create renewal history for an existing member.'
     when 'IMPORT_PROFILE_CONFLICT' then 'Supplied profile or signature claims differ from the registered record. Review without changing existing history.'
     when 'IMPORT_PHONE_CONFLICT' then 'This mobile number already belongs to a different member, including its equivalent 09/+63 format.'
     when 'IMPORT_HEAD_CONFLICT' then 'The selected head differs from current genealogy. Use the approved team-transfer workflow.'
     else 'Identity, profile or team conflicts with a canonical record. Review without changing existing history.' end);
  end;
  insert into private.member_workbook_rows(job_id,row_number,planned_staff_id,payload,decision,errors)
   values(v_job,(v_row->>'rowNumber')::integer,(v_row->'fields'->>'planned_staff_id')::uuid,v_row,v_decision,v_errors);
 end loop;
 return v_job;
end $$;

create function public.get_member_workbook_jobs(p_actor uuid,p_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.member_workbook_actor(p_actor);
 return coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'sourceHash',j.source_hash,'createdAt',j.created_at,'rows',
   (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rowNumber',r.row_number,'decision',r.decision,'state',r.state,'errors',r.errors,
     'memberId',r.result_staff_id,'lastError',r.last_error,'attempts',r.attempts,'name',r.payload->'fields'->>'display_name','email',r.payload->'fields'->>'email',
     'aaNumber',coalesce(a.aa_number,r.payload->'fields'->>'aa_number'),'head',r.payload->'fields'->>'head_member',
     'mobile',r.payload->'fields'->>'mobile','position',r.payload->'fields'->>'position',
     'details',(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(r.payload->'fields') where key in
       ('birth_date','sex','civil_status','province','city','barangay','address_line_1','postal_code','telephone','messenger','employer_name','employer_address','job_position','government_id_type','starts_on','expires_on','date_applied','program_category','vip_card_type','applicant_signature','referrer_signature','applicant_signed_on','referrer_signed_on')))
     order by r.row_number),'[]'::jsonb)
    from private.member_workbook_rows r left join private.sale_team_accreditations a on a.staff_id=r.result_staff_id where r.job_id=j.id)) order by j.created_at desc)
   from (select * from private.member_workbook_jobs where actor_id=p_actor and (p_job is null or id=p_job) order by created_at desc limit 20) j),'[]'::jsonb);
end $$;

-- Durable claim is committed before Auth creation. UUID is fixed for every retry.
create function public.claim_member_workbook_row(p_actor uuid,p_job uuid,p_row uuid,p_evidence_verified boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_row private.member_workbook_rows%rowtype; v_kind text; v_id uuid;
begin
 perform private.member_workbook_actor(p_actor);
 select kind into v_kind from private.member_workbook_jobs where id=p_job and actor_id=p_actor;
 if not found then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_row from private.member_workbook_rows where id=p_row and job_id=p_job for update;
 if not found then raise exception 'IMPORT_ROW_NOT_FOUND'; end if;
 if v_row.state='completed' then return jsonb_build_object('completed',true); end if;
 if cardinality(v_row.errors)>0 or v_row.decision not in ('CREATE','MATCH') then raise exception 'IMPORT_REVIEW_REQUIRED'; end if;
 perform private.member_workbook_role(p_actor,v_row.payload->'fields'->>'position');
 v_id:=private.match_member_workbook_identity(v_kind,v_row.payload->'fields');
 if v_row.decision='MATCH' then
  if v_id is distinct from v_row.planned_staff_id then raise exception 'IMPORT_IDENTITY_CONFLICT'; end if;
  update private.member_workbook_rows set state='completed',result_staff_id=v_id,approved_by=p_actor,approved_at=now(),completed_at=now() where id=p_row;
  return jsonb_build_object('completed',true);
 end if;
 if v_id is not null then raise exception 'IMPORT_IDENTITY_CONFLICT'; end if;
 if v_kind='IST' then
   perform private.mutation_actor_role(p_actor,'organization.staff','update');
 else
   perform private.mutation_actor_role(p_actor,'network.ost_registrations','create');
   perform private.ost_reviewer(p_actor);
 end if;
 if v_kind='OST' and p_evidence_verified is distinct from true then raise exception 'IMPORT_EVIDENCE_REQUIRED'; end if;
 if nullif(v_row.payload->'fields'->>'head_staff_id','') is not null and not exists(select 1 from public.staff_users where id=(v_row.payload->'fields'->>'head_staff_id')::uuid and status='active') then raise exception 'IMPORT_PARENT_REQUIRED'; end if;
 update private.member_workbook_rows set state='creating',approved_by=p_actor,approved_at=coalesce(approved_at,now()),last_error=null,attempts=attempts+1,last_attempt_at=now() where id=p_row;
 return jsonb_build_object('completed',false,'authId',v_row.planned_staff_id,'email',v_row.payload->'fields'->>'email');
end $$;

create function public.install_member_workbook_row(p_actor uuid,p_job uuid,p_row uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_row private.member_workbook_rows%rowtype; v_kind text; f jsonb; i jsonb; v_role uuid; v_department uuid; v_parent uuid; v_app uuid; v_term uuid; v_audit bigint;
begin
 perform private.member_workbook_actor(p_actor);
 select kind into v_kind from private.member_workbook_jobs where id=p_job and actor_id=p_actor;
 if not found then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_row from private.member_workbook_rows where id=p_row and job_id=p_job for update;
 if not found then raise exception 'IMPORT_ROW_NOT_FOUND'; end if;
 if v_row.state='completed' then return v_row.result_staff_id; end if;
 if v_row.state<>'creating' or v_row.approved_by is distinct from p_actor then raise exception 'IMPORT_APPROVAL_REQUIRED'; end if;
 f:=v_row.payload->'fields'; i:=v_row.payload->'input'; v_parent:=nullif(f->>'head_staff_id','')::uuid;
 perform private.member_workbook_role(p_actor,f->>'position');
 if private.match_member_workbook_identity(v_kind,f) is not null then raise exception 'IMPORT_IDENTITY_CONFLICT'; end if;
 if not exists(select 1 from auth.users where id=v_row.planned_staff_id and lower(email)=lower(f->>'email')) then raise exception 'IMPORT_AUTH_REQUIRED'; end if;
 if v_kind='IST' then
  select id into v_role from public.roles where slug=f->>'position' and is_active;
  if v_role is null or f->>'position' not in ('vice_director','senior_sales_manager','sales_manager') then raise exception 'INVALID_IMPORT_ROLE'; end if;
  if (f->>'position'='vice_director' and v_parent is not null)
    or (f->>'position'='senior_sales_manager' and (v_parent is null or private.staff_role_slug(v_parent)<>'vice_director'))
    or (f->>'position'='sales_manager' and (v_parent is null or private.staff_role_slug(v_parent)<>'senior_sales_manager')) then raise exception 'IMPORT_PARENT_REQUIRED'; end if;
  if v_parent is not null then perform private.ost_active_sponsor(v_parent); end if;
  select id into v_department from public.departments where code='SALES' and is_active;
  if v_department is null then raise exception 'IMPORT_DEPARTMENT_REQUIRED'; end if;
  insert into public.staff_users(id,email,full_name,department_id,status,must_change_password,activated_at)
   values(v_row.planned_staff_id,f->>'email',f->>'canonical_name',v_department,'active',true,now());
  insert into public.staff_role_assignments(staff_id,role_id,assigned_by) values(v_row.planned_staff_id,v_role,p_actor);
  insert into public.network_member_profiles(staff_id,date_of_birth,sex,civil_status,street_no,city_municipality,province,province_code,city_municipality_code,zip_code,tel_no,mobile_no,fb_messenger,tin,employer_name,employer_address,job_position,government_id_type,government_id_number,referrer_staff_id)
   values(v_row.planned_staff_id,(i->>'dateOfBirth')::date,i->>'sex',i->>'civilStatus',i->>'streetNo',i->>'cityMunicipality',i->>'province',i->>'provinceCode',i->>'cityMunicipalityCode',i->>'zipCode',i->>'telNo',i->>'mobileNo',i->>'fbMessenger',i->>'tin',i->>'employerName',i->>'employerAddress',i->>'jobPosition',i->>'governmentIdType',i->>'governmentIdNumber',v_parent);
  if v_parent is not null then insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values(v_row.planned_staff_id,v_parent,f->>'position',true,true,p_actor); end if;
  perform public.issue_ist_employee_identity(p_actor,v_row.planned_staff_id,nullif(f->>'aa_number',''));
 else
  perform private.ost_manual_sponsor(v_parent);
  v_app:=public.submit_ost_accreditation(v_row.id,p_actor,v_parent,null,i->'identity',i->'form','import');
  v_term:=public.install_direct_ost_password(v_app,p_actor,v_row.planned_staff_id,(i->>'startsOn')::date,(i->>'expiresOn')::date,nullif(f->>'aa_number',''));
  -- Members reads this profile; retain the signed registration separately as evidence.
  insert into public.network_member_profiles(staff_id,date_of_birth,sex,civil_status,street_no,city_municipality,province,province_code,city_municipality_code,zip_code,tel_no,mobile_no,fb_messenger,tin,employer_name,employer_address,job_position,government_id_type,government_id_number,referrer_staff_id)
   values(v_row.planned_staff_id,(i->'identity'->>'birthDate')::date,initcap(i->'form'->>'sex'),initcap(i->'form'->>'civilStatus'),
    i->'identity'->'address'->>'line1',i->'identity'->'address'->>'city',i->'identity'->'address'->>'province',
    i->'identity'->'addressHierarchy'->>'provinceCode',i->'identity'->'addressHierarchy'->>'localityCode',coalesce(i->'identity'->'address'->>'postalCode',''),
    i->'form'->>'telephone',f->>'canonical_mobile',i->'form'->>'messenger',i->'form'->>'tin',
    coalesce(i->'form'->>'employerName',''),coalesce(i->'form'->>'employerAddress',''),coalesce(i->'form'->>'jobPosition',''),
    i->'form'->>'governmentIdType',i->'form'->>'governmentIdNumber',v_parent);
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
  values(p_actor,'MEMBER_WORKBOOK_ROW_IMPORTED','staff_user',v_row.planned_staff_id::text,jsonb_build_object('jobId',p_job,'rowId',p_row,'kind',v_kind,'source','company-v2','historicalClaimsVerifiedNow',true)) returning id into v_audit;
 update private.member_workbook_rows set state='completed',result_staff_id=planned_staff_id,audit_id=v_audit,completed_at=now(),last_error=null where id=p_row;
 return v_row.planned_staff_id;
end $$;

revoke all on function public.stage_member_workbook(uuid,text,text,jsonb),public.get_member_workbook_jobs(uuid,uuid),public.claim_member_workbook_row(uuid,uuid,uuid,boolean),public.install_member_workbook_row(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.stage_member_workbook(uuid,text,text,jsonb),public.get_member_workbook_jobs(uuid,uuid),public.claim_member_workbook_row(uuid,uuid,uuid,boolean),public.install_member_workbook_row(uuid,uuid,uuid) to service_role;

create function public.record_member_workbook_failure(p_actor uuid,p_job uuid,p_row uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.member_workbook_actor(p_actor);
 if not exists(select 1 from private.member_workbook_jobs where id=p_job and actor_id=p_actor) then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
 update private.member_workbook_rows set last_error=case when state='creating' then 'OUTCOME_UNCONFIRMED' else 'REVIEW_REQUIRED' end,last_attempt_at=now()
   where id=p_row and job_id=p_job and state<>'completed';
end $$;
revoke all on function public.record_member_workbook_failure(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_member_workbook_failure(uuid,uuid,uuid) to service_role;

-- Explicit projection: never return TIN, government ID numbers or raw job payloads.
create function public.export_member_workbook_profiles(p_actor uuid,p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.mutation_actor_role(p_actor,'network.members','view');
 if cardinality(p_ids)>500 then raise exception 'IMPORT_EXPORT_ROW_LIMIT'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'fields',
   jsonb_build_object('first_name',coalesce(a.first_name,source.payload->'fields'->>'first_name'),
     'middle_name',coalesce(a.middle_name,source.payload->'fields'->>'middle_name'),
     'last_name',coalesce(a.last_name,source.payload->'fields'->>'last_name'),
     'mobile',m.phone,'birth_date',a.birth_date,'address_line_1',coalesce(a.address->>'line1',source.payload->'fields'->>'address_line_1'),
     'province',a.address->>'province','city',a.address->>'city','barangay',coalesce(a.address->>'barangay',source.payload->'fields'->>'barangay'),
     'postal_code',a.address->>'postalCode','starts_on',t.starts_on,'expires_on',t.expires_on,
     'date_applied',d.date_applied,'program_category',d.program_category,'vip_card_type',d.vip_card_type,
     'applicant_signature',d.applicant_signature_status,'referrer_signature',d.referrer_signature_status,
     'applicant_signed_on',d.applicant_signed_on,'referrer_signed_on',d.referrer_signed_on,
     'sex',d.official_details->>'sex','civil_status',d.official_details->>'civilStatus',
     'telephone',d.official_details->>'telephone','messenger',d.official_details->>'messenger',
     'employer_name',d.official_details->>'employerName','employer_address',d.official_details->>'employerAddress',
     'government_id_type',d.official_details->>'governmentIdType'),
   'history',(select coalesce(jsonb_agg(jsonb_build_object('startsOn',ot.starts_on,'expiresOn',ot.expires_on,'status',ot.status,'approvedAt',ot.approved_at) order by ot.approved_at),'[]'::jsonb) from private.ost_accreditation_terms ot where ot.ost_id=s.id)))
  from public.staff_users s
  left join public.ost_members m on m.id=s.id
  left join public.ost_applications a on a.id=m.application_id
  left join private.ost_registration_details d on d.application_id=a.id
  left join lateral(select * from private.ost_accreditation_terms where ost_id=s.id order by approved_at desc,id desc limit 1) t on true
  left join lateral(select payload from private.member_workbook_rows where result_staff_id=s.id and state='completed' and decision='CREATE' order by completed_at desc limit 1) source on true
  where s.id=any(p_ids)),'[]'::jsonb);
end $$;
revoke all on function public.export_member_workbook_profiles(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.export_member_workbook_profiles(uuid,uuid[]) to service_role;

-- Legacy AA- OST values are accepted only for a sealed, explicitly approved import row.
-- Keep the existing service-only signature; passwords belong exclusively to Auth.
create or replace function public.install_direct_ost_password(p_application_id uuid,p_actor_id uuid,p_auth_id uuid,p_starts_on date,p_expires_on date,p_aa_number text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_detail private.ost_registration_details%rowtype;
  v_role uuid; v_number text; v_term uuid; v_name text;
begin
  perform private.ost_reviewer(p_actor_id);
  if private.staff_role_slug(p_actor_id) not in ('admin','super_admin') then raise exception 'OST_AA_ISSUANCE_FORBIDDEN' using errcode='42501'; end if;
  if p_aa_number is not null and not (
    (p_aa_number ~ '^AAO[0-9]{2}(0[1-9]|1[0-2])[0-9]{4}$' and right(p_aa_number,4)<>'0000')
    or (p_aa_number ~ '^AA-[A-Z0-9]{12}$' and length(regexp_replace(substring(p_aa_number from 4),'[^A-Z]','','g'))=6
      and exists(select 1 from private.member_workbook_rows r join private.member_workbook_jobs j on j.id=r.job_id
        where r.planned_staff_id=p_auth_id and r.state='creating' and r.approved_by=p_actor_id
          and j.actor_id=p_actor_id and j.kind='OST' and r.payload->'fields'->>'aa_number'=p_aa_number))
  ) then raise exception 'INVALID_ACCREDITATION_NUMBER' using errcode='22023'; end if;
  select * into v_app from public.ost_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='22023'; end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  if v_app.status='approved' then
    select id into v_term from private.ost_accreditation_terms where application_id=p_application_id;
    if v_term is not null then
      if not exists(select 1 from private.ost_accreditation_terms where id=v_term and ost_id=p_auth_id and starts_on=p_starts_on and expires_on=p_expires_on) then
        raise exception 'MUTATION_PAYLOAD_CONFLICT' using errcode='22023';
      end if;
      if p_aa_number is not null and not exists(select 1 from private.sale_team_accreditations where staff_id=p_auth_id and aa_number=p_aa_number) then raise exception 'MUTATION_PAYLOAD_CONFLICT' using errcode='22023'; end if;
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
  insert into public.staff_users(id,email,full_name,status,must_change_password) values(p_auth_id,v_app.email,v_name,'active',true);
  insert into public.staff_role_assignments(staff_id,role_id,assigned_by) values(p_auth_id,v_role,p_actor_id);
  insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,status,approved_by) values(p_auth_id,v_app.id,v_app.sponsor_staff_id,v_number,v_name,v_app.email,v_app.phone,'active',p_actor_id);
  insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values(p_auth_id,v_app.sponsor_staff_id,'ost',true,true,p_actor_id);
  if p_aa_number is not null then
    -- Reserve before the term trigger allocates an automatic number.
    perform pg_advisory_xact_lock(hashtextextended(p_aa_number,0));
    if exists(select 1 from private.sale_team_accreditations where aa_number=p_aa_number)
      or exists(select 1 from private.sale_team_accreditation_history where aa_number=p_aa_number) then
      raise exception 'ACCREDITATION_NUMBER_TAKEN' using errcode='23505';
    end if;
    insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
      values(p_auth_id,p_aa_number,v_name,'OST','active',p_starts_on,p_expires_on,p_actor_id);
  end if;
  insert into private.ost_accreditation_terms(ost_id,application_id,starts_on,expires_on,approved_by) values(p_auth_id,v_app.id,p_starts_on,p_expires_on,p_actor_id) returning id into v_term;
  update public.ost_applications set status='approved',reviewed_by=p_actor_id,reviewed_at=now() where id=v_app.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'OST_ACCREDITATION_APPROVED','ost_application',v_app.id::text,jsonb_build_object('termId',v_term,'ostId',p_auth_id,'source','direct','endorsed',false));
  return v_term;
end $$;
revoke all on function public.install_direct_ost_password(uuid,uuid,uuid,date,date,text) from public,anon,authenticated;
grant execute on function public.install_direct_ost_password(uuid,uuid,uuid,date,date,text) to service_role;
commit;
