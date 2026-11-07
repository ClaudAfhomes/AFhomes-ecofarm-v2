-- AF Homes 2026-10-17 requirement, Phase 8/10: final OST account commit must be
-- atomic and honest. Evidence: installation nominally admittable through
-- private.ost_reviewer (SSM/VD once their role holds the update permission),
-- while the AA number is issued by private.issue_ost_aa_on_approval only for an
-- admin/super_admin approver. Without this guard an SSM/VD approval commits an
-- OST identity with NO accreditation row: a partially created account.
-- Fail closed instead of rerouting authority: review/endorsement stays with
-- ost_reviewer; final account/AA issuance stays with its existing
-- admin/super_admin authority. Open policy question recorded for management:
-- whether SSM/VD should also be able to commit initial AA issuance.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs (disposable only).
-- Down: restore the prior body in a later migration; no data is ever rewritten.
begin;
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
  -- The term insert fires the AA issuance trigger. If no accreditation row
  -- exists afterwards, the approver cannot commit AA issuance: fail the whole
  -- transaction so no member, term or application state is left partial.
  if not exists(select 1 from private.sale_team_accreditations where staff_id=p_ost_id) then
    raise exception 'OST_AA_ISSUANCE_FORBIDDEN' using errcode='42501';
  end if;
  update public.ost_applications set status='approved',reviewed_by=p_actor_id,reviewed_at=now() where id=v_app.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'OST_ACCREDITATION_APPROVED','ost_application',v_app.id::text,jsonb_build_object('termId',v_term,'ostId',p_ost_id));
  return v_term;
end $$;
commit;
