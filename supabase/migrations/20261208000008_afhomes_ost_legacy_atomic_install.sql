-- Legacy approval keeps its existing no-validity-date contract. Only its SQL
-- installation moves into one transaction; this does not authorize new AA policy.
-- GoTrue invitations remain external and are never deleted on ambiguous failure.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs (rollback/races/ACL).
-- SELECT has_function_privilege('authenticated',
-- 'public.install_legacy_ost_identity(uuid,uuid,uuid)','EXECUTE'); -- false
-- Down: disable the legacy approval API before retiring this RPC in a forward
-- migration. Retain all identities, genealogy history and audit events.
begin;

create or replace function public.install_legacy_ost_identity(p_application_id uuid,p_actor_id uuid,p_auth_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_app public.ost_applications%rowtype; v_member public.ost_members%rowtype;
  v_role uuid; v_number text; v_name text; v_edge uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'network.ost_registrations','update');
  if p_auth_id is null then raise exception 'OST_IDENTITY_REQUIRED' using errcode='22023'; end if;
  select * into v_app from public.ost_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  perform private.ost_scope(p_actor_id,v_app.sponsor_staff_id);
  if coalesce((v_app.registration_details->>'officialAccreditation')::boolean,false) then
    raise exception 'OST_OFFICIAL_WORKFLOW_REQUIRED' using errcode='22023';
  end if;
  if v_app.status='approved' then
    select * into v_member from public.ost_members where application_id=v_app.id;
    if v_member.id=p_auth_id then return to_jsonb(v_member); end if;
    raise exception 'OST_IDENTITY_ALREADY_LINKED' using errcode='23505';
  end if;
  if v_app.status not in ('submitted','under_review','changes_requested') then
    raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='22023';
  end if;
  perform private.ost_active_sponsor(v_app.sponsor_staff_id);
  perform pg_advisory_xact_lock(hashtextextended(lower(v_app.email),23000008));
  if exists(select 1 from public.staff_users where id=p_auth_id or lower(email)=lower(v_app.email))
    or exists(select 1 from public.ost_members where application_id=v_app.id or lower(email)=lower(v_app.email)) then
    raise exception 'OST_IDENTITY_ALREADY_LINKED' using errcode='23505';
  end if;
  select id into v_role from public.roles where slug='ost' and is_active;
  if not found then raise exception 'ROLE_NOT_FOUND'; end if;
  select ost_number into v_number from public.next_ost_number();
  v_name:=concat_ws(' ',v_app.first_name,nullif(v_app.middle_name,''),v_app.last_name);
  insert into public.staff_users(id,email,full_name,status,invited_at)
    values(p_auth_id,v_app.email,v_name,'invited',now());
  insert into public.staff_role_assignments(staff_id,role_id,assigned_by)
    values(p_auth_id,v_role,p_actor_id);
  insert into public.staff_invitations(email,full_name,role_id,invited_by,expires_at,auth_user_id)
    values(v_app.email,v_name,v_role,p_actor_id,now()+interval '7 days',p_auth_id);
  insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,status,approved_by)
    values(p_auth_id,v_app.id,v_app.sponsor_staff_id,v_number,v_name,v_app.email,v_app.phone,'active',p_actor_id)
    returning * into v_member;
  insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
    values(p_auth_id,v_app.sponsor_staff_id,'ost',true,true,p_actor_id) returning id into v_edge;
  update public.ost_applications set status='approved',reviewed_by=p_actor_id,reviewed_at=now() where id=v_app.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data) values
    (p_actor_id,'OST_APPLICATION_APPROVED','ost_application',v_app.id::text,jsonb_build_object('status',v_app.status),
      jsonb_build_object('status','approved','sponsorStaffId',v_app.sponsor_staff_id,'ostMemberId',p_auth_id,'genealogyRelationshipId',v_edge)),
    (p_actor_id,'OST_MEMBER_ACTIVATED','ost_member',p_auth_id::text,null,
      jsonb_build_object('applicationId',v_app.id,'sponsorStaffId',v_app.sponsor_staff_id,'ostNumber',v_number));
  return to_jsonb(v_member);
end $$;
revoke all on function public.install_legacy_ost_identity(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.install_legacy_ost_identity(uuid,uuid,uuid) to service_role;

commit;
