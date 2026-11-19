-- AF Homes user requirement, 2026-10-17: OST genealogy changes require expired
-- accreditation and management approval. The approved renewal is the existing
-- review record; apply its transfer before issuing its new active term, atomically.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs, plus ACL audit.
-- SELECT id FROM private.ost_accreditation_terms WHERE expires_on<starts_on; -- zero
-- Down: restore prior bodies in a forward migration; retain history and audit rows.
--
-- Bypass audit (2026-10-17). Scope: in-place relationship edits, historical edge
-- Follow-up correction: the original reachability claim below was incomplete.
-- Generic Members/staff APIs exposed role changes and Members OST creation.
-- Handler guards now refuse those operations; migration 20261208000007 also
-- guards role UPDATE/DELETE and is_authoritative changes. The residual list
-- below records the earlier audit, not the final state of this migration batch.
-- reactivation, profile/referrer fields, role-conversion paths. Every path a
-- browser or authenticated token can reach is covered; the residual paths below
-- need direct owner SQL or a service-role client, where no trigger can be the
-- final authority. Recorded, not fixed.
--
--   Covered (proven with direct service-role SQL in the lifecycle gate):
--   - active ost edge upline/subject/role change and deactivation -> assert
--     (OST_ACCREDITATION_EXPIRED_REQUIRED / OST_TRANSFER_APPROVAL_REQUIRED;
--     test-ost-lifecycle.mjs lines ~41-42, ~57);
--   - inactive historical ost edge edit -> OST_GENEALOGY_HISTORY_IMMUTABLE;
--     reactivation -> assert, because a prior ost edge row exists;
--   - ost_members.sponsor_staff_id update -> assert (guard trigger);
--   - profile/referrer display fields (network_member_profiles.referrer_name,
--     vip_referrer, ost_members contact fields) do not feed genealogy: sale
--     freezes resolve public.referral_relationships (purchase-flow RPC);
--   - browser/authenticated roles: SELECT-only grants on referral_relationships
--     (phase 2 RLS) and staff_role_assignments (phase 1), so no PostgREST write.
--
--   Residual, reachable only by direct owner/service-role SQL:
--   - is_authoritative flip on an active ost edge: neither this guard nor
--     phase 7's validate trigger tests the column on update. The unique partial
--     index keeps one active edge per subject, so sale freezes are unaffected;
--     consumers that filter is_authoritative (analytics rollups) can silently
--     drop the edge from reports.
--   - staff_role_assignments flip/delete for an installed OST: no trigger
--     cross-checks the role against existing edges, so staff_role_slug changes
--     without a transfer approval and existing edges are not revalidated.
--   - staff with role 'ost' but no ost_members row: the sponsor guard returns
--     early (no member row to assert on) and a first-ever edge insert has no
--     prior ost edge row to trigger the assert; direct SQL can open this state.
--     Supported opening paths are the accreditation/install RPCs.
--   - direct INSERT into ost_members: this guard covers UPDATE of
--     sponsor_staff_id only; the installer and renewal RPCs are the supported
--     insert paths.
--   Known ceiling: the table owner can disable triggers, and direct SQL writes
--   no audit_events row (the RPCs do). Monitoring and audit review are the
--   control for that window; no in-database defense exists.
begin;

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

create or replace function private.guard_ost_member_sponsor() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if new.sponsor_staff_id is distinct from old.sponsor_staff_id then
    perform private.assert_ost_genealogy_transfer(old.id,new.sponsor_staff_id);
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_member_sponsor() from public,anon,authenticated,service_role;
drop trigger if exists ost_member_sponsor_guard on public.ost_members;
create trigger ost_member_sponsor_guard before update of sponsor_staff_id on public.ost_members
for each row execute function private.guard_ost_member_sponsor();

create or replace function private.guard_ost_genealogy_edge() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.hierarchy_role='ost' then raise exception 'OST_GENEALOGY_HISTORY_IMMUTABLE' using errcode='42501'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.hierarchy_role='ost' and
    (new.subject_staff_id<>old.subject_staff_id or new.hierarchy_role<>old.hierarchy_role or
     (not old.is_active and new.upline_staff_id<>old.upline_staff_id)) then
    raise exception 'OST_GENEALOGY_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.hierarchy_role='ost' and old.is_active
    and (not new.is_active or new.subject_staff_id<>old.subject_staff_id or new.upline_staff_id<>old.upline_staff_id or new.hierarchy_role<>old.hierarchy_role) then
    perform private.assert_ost_genealogy_transfer(old.subject_staff_id,case when new.is_active then new.upline_staff_id else null end);
  elsif new.hierarchy_role='ost' and new.is_active and (tg_op='INSERT' or not old.is_active)
    and exists(select 1 from public.referral_relationships where subject_staff_id=new.subject_staff_id and hierarchy_role='ost') then
    perform private.assert_ost_genealogy_transfer(new.subject_staff_id,new.upline_staff_id);
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_genealogy_edge() from public,anon,authenticated,service_role;
drop trigger if exists ost_genealogy_transfer_guard on public.referral_relationships;
create trigger ost_genealogy_transfer_guard before insert or update or delete on public.referral_relationships
for each row execute function private.guard_ost_genealogy_edge();

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

    if v_sponsor<>v_member.sponsor_staff_id then
      if v_term.expires_on >= (now() at time zone 'Asia/Manila')::date then raise exception 'OST_ACCREDITATION_EXPIRED_REQUIRED' using errcode='22023'; end if;
      perform private.ost_manual_sponsor(v_sponsor);
    end if;
    update private.ost_accreditation_renewals set status='approved',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_id;
    if v_sponsor<>v_member.sponsor_staff_id then
      -- Existing genealogy trigger validates adjacency, uniqueness and cycles.
      update public.referral_relationships set is_active=false,updated_at=now() where subject_staff_id=v_member.id and is_active;
      insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values(v_member.id,v_sponsor,'ost',true,true,p_actor_id);
      update public.ost_members set sponsor_staff_id=v_sponsor where id=v_member.id;
      insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_id,'OST_REFERRER_CHANGED','ost_member',v_member.id::text,jsonb_build_object('sponsorStaffId',v_member.sponsor_staff_id),jsonb_build_object('sponsorStaffId',v_sponsor,'renewalId',p_id));
    end if;
    update private.ost_accreditation_terms set status='superseded' where id=v_term.id;
    insert into private.ost_accreditation_terms(ost_id,renewal_id,starts_on,expires_on,approved_by) values(v_member.id,p_id,v_renew.requested_start,v_renew.requested_end,p_actor_id) returning id into v_result;
  else raise exception 'INVALID_OST_FORM'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,case p_action when 'approve' then 'OST_RENEWAL_APPROVED' when 'endorse' then 'OST_RENEWAL_ENDORSED' when 'reject' then 'OST_RENEWAL_REJECTED' else 'OST_RENEWAL_CHANGES_REQUESTED' end,'ost_renewal',p_id::text,jsonb_build_object('termId',v_result));
  return coalesce(v_result,p_id);
end $$;
commit;
