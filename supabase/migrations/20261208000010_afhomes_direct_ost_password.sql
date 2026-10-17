-- Direct management OST creation: password login, optional manual AAO.
-- Additive RPC: old invitation clients and public sponsored approval stay intact.
-- Local draft; requires scoped approval before shared application.
begin;
create or replace function public.install_direct_ost_password(p_application_id uuid,p_actor_id uuid,p_auth_id uuid,p_starts_on date,p_expires_on date,p_aa_number text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_detail private.ost_registration_details%rowtype;
  v_role uuid; v_number text; v_term uuid; v_name text;
begin
  perform private.ost_reviewer(p_actor_id);
  if private.staff_role_slug(p_actor_id) not in ('admin','super_admin') then raise exception 'OST_AA_ISSUANCE_FORBIDDEN' using errcode='42501'; end if;
  if p_aa_number is not null and (p_aa_number !~ '^AAO[0-9]{2}(0[1-9]|1[0-2])[0-9]{4}$' or right(p_aa_number,4)='0000') then raise exception 'INVALID_ACCREDITATION_NUMBER' using errcode='22023'; end if;
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
