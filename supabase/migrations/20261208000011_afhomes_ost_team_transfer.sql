-- LOCAL DRAFT: expired OST team moves, explicitly approved by management.
-- Does not convert role, replace an AA number, or issue/renew a term.
begin;
create table private.ost_team_transfers (
  request_id uuid primary key,
  ost_id uuid not null references public.ost_members(id),
  prior_term_id uuid not null references private.ost_accreditation_terms(id),
  old_sponsor_staff_id uuid not null references public.staff_users(id),
  new_sponsor_staff_id uuid not null references public.staff_users(id),
  reason text not null check(length(btrim(reason)) between 5 and 300),
  approved_by uuid not null references public.staff_users(id),
  approved_at timestamptz not null default now(),
  check(old_sponsor_staff_id<>new_sponsor_staff_id)
);
alter table private.ost_team_transfers enable row level security;
revoke all on private.ost_team_transfers from public,anon,authenticated,service_role;
create or replace function private.preserve_ost_team_transfer() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin raise exception 'OST_TEAM_TRANSFER_HISTORY_IMMUTABLE' using errcode='42501'; end $$;
revoke all on function private.preserve_ost_team_transfer() from public,anon,authenticated,service_role;
create trigger ost_team_transfer_immutable before update or delete on private.ost_team_transfers
for each row execute function private.preserve_ost_team_transfer();

-- Extend the existing guard with a transaction-bound team approval. Retain
-- the renewal approval and legacy kind-conversion allowances unchanged.
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
  select t.approved_by into v_approval from private.ost_team_transfers t
    where t.ost_id=p_ost and t.prior_term_id=v_term.id and t.approved_at=now()
      and t.old_sponsor_staff_id=v_member.sponsor_staff_id
      and (p_sponsor is null or t.new_sponsor_staff_id=p_sponsor);
  if v_approval is null then
    select r.approved_by into v_approval from private.ost_accreditation_renewals r
      where r.ost_id=p_ost and r.status='approved' and r.approved_at=now()
        and r.prior_term_id=v_term.id and r.old_sponsor_staff_id=v_member.sponsor_staff_id
        and r.proposed_new_sponsor_staff_id is not null
        and (p_sponsor is null or r.proposed_new_sponsor_staff_id=p_sponsor);
  end if;
  if v_approval is null then raise exception 'OST_TRANSFER_APPROVAL_REQUIRED' using errcode='42501'; end if;
  perform private.ost_reviewer(v_approval);
  perform private.ost_scope(v_approval,v_member.sponsor_staff_id);
end $$;
revoke all on function private.assert_ost_genealogy_transfer(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.transfer_ost_team(p_actor_id uuid,p_ost_id uuid,p_request_id uuid,p_sponsor_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_member public.ost_members%rowtype; v_term private.ost_accreditation_terms%rowtype;
  v_replay private.ost_team_transfers%rowtype; v_edge uuid;
begin
  perform private.ost_reviewer(p_actor_id);
  perform private.mutation_actor_role(p_actor_id,'network.members','update');
  if p_request_id is null or p_sponsor_id is null or p_reason is null or length(btrim(p_reason)) not between 5 and 300
    then raise exception 'TRANSFER_REASON_REQUIRED' using errcode='22023'; end if;
  -- Same member-first lock as renewal: renewal and transfer cannot bypass expiry.
  select * into v_member from public.ost_members where id=p_ost_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='22023'; end if;
  perform private.ost_scope(p_actor_id,v_member.sponsor_staff_id);
  select * into v_replay from private.ost_team_transfers where request_id=p_request_id;
  if found then
    if v_replay.ost_id<>p_ost_id or v_replay.approved_by<>p_actor_id
      or v_replay.new_sponsor_staff_id<>p_sponsor_id or v_replay.reason<>btrim(p_reason)
      then raise exception 'MUTATION_PAYLOAD_CONFLICT' using errcode='22023'; end if;
    return p_request_id;
  end if;
  if v_member.status<>'active' or private.staff_role_slug(p_ost_id)<>'ost'
    or not exists(select 1 from public.staff_users where id=p_ost_id and status='active')
    then raise exception 'OST_IDENTITY_REQUIRED' using errcode='22023'; end if;
  select * into v_term from private.ost_accreditation_terms where ost_id=p_ost_id and status='active' for update;
  if not found or v_term.expires_on >= (now() at time zone 'Asia/Manila')::date
    then raise exception 'OST_ACCREDITATION_EXPIRED_REQUIRED' using errcode='22023'; end if;
  if exists(select 1 from private.ost_accreditation_renewals where ost_id=p_ost_id
    and status in ('submitted','under_review','changes_requested','endorsed'))
    then raise exception 'OST_RENEWAL_IN_PROGRESS' using errcode='22023'; end if;
  if p_sponsor_id=v_member.sponsor_staff_id then raise exception 'OST_TRANSFER_SAME_TEAM' using errcode='22023'; end if;
  perform private.ost_manual_sponsor(p_sponsor_id);
  perform private.ost_scope(p_actor_id,p_sponsor_id);
  select id into v_edge from public.referral_relationships where subject_staff_id=p_ost_id
    and hierarchy_role='ost' and is_active and is_authoritative and upline_staff_id=v_member.sponsor_staff_id for update;
  if not found then raise exception 'OST_TRANSFER_GENEALOGY_CONFLICT' using errcode='22023'; end if;
  insert into private.ost_team_transfers(request_id,ost_id,prior_term_id,old_sponsor_staff_id,new_sponsor_staff_id,reason,approved_by)
    values(p_request_id,p_ost_id,v_term.id,v_member.sponsor_staff_id,p_sponsor_id,btrim(p_reason),p_actor_id);
  update public.referral_relationships set is_active=false,updated_at=now() where id=v_edge;
  insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
    values(p_ost_id,p_sponsor_id,'ost',true,true,p_actor_id);
  update public.ost_members set sponsor_staff_id=p_sponsor_id where id=p_ost_id;
  update public.network_member_profiles set referrer_staff_id=p_sponsor_id where staff_id=p_ost_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(p_actor_id,'OST_TEAM_TRANSFER_APPROVED','ost_member',p_ost_id::text,
      jsonb_build_object('sponsorStaffId',v_member.sponsor_staff_id,'relationshipId',v_edge),
      jsonb_build_object('sponsorStaffId',p_sponsor_id,'requestId',p_request_id,'reason',btrim(p_reason)));
  return p_request_id;
end $$;
revoke all on function public.transfer_ost_team(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.transfer_ost_team(uuid,uuid,uuid,uuid,text) to service_role;
commit;
