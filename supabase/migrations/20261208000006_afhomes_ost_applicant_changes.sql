-- AF Homes 2026-10-17 request, Phase 4.3: controlled applicant edits.
-- The renewal form shows registered values read-only; an authorized operator
-- may record verified corrections through "Update Information". Authority is
-- the existing member profile-update authority (admin/super_admin through
-- network.members update). Every accepted change keeps its old and resulting
-- values; fullName/birthDate/sex/civilStatus are sensitive identity changes and
-- require a reason. Email is the login identity and program/VIP fields are
-- authoritative, so neither is editable here.
--
-- The OST account row is NOT rewritten: this private, insert-only ledger is the
-- registered-value override consumed by the current-applicant projection and by
-- renewal submission. Submitted applications and renewals keep their own frozen
-- snapshots. A future migration can backfill network_member_profiles
-- (20261205000001 constraints block exactly copying OST form values) and switch
-- the edit route without losing this history.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs (disposable only).
-- Down: stop writes with a forward migration; history rows are never rewritten.
begin;

create table if not exists private.ost_applicant_changes (
  id bigint generated always as identity primary key,
  ost_id uuid not null references public.ost_members(id) on delete restrict,
  changed_fields text[] not null,
  prior_values jsonb not null,
  resulting_values jsonb not null,
  reason text,
  changed_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ost_applicant_changes_fields_key check (
    cardinality(changed_fields) > 0
    and changed_fields <@ ARRAY['fullName','birthDate','phone','sex','civilStatus','address','messenger','employerName','jobPosition']::text[]
    and (prior_values - changed_fields) = '{}'::jsonb
    and (resulting_values - changed_fields) = '{}'::jsonb
  ),
  constraint ost_applicant_changes_reason_key check (
    not (changed_fields && ARRAY['fullName','birthDate','sex','civilStatus']::text[])
    or nullif(btrim(reason), '') is not null
  )
);
comment on table private.ost_applicant_changes is
  'Insert-only ledger of verified OST applicant corrections. resulting_values carries only the changeable display fields; authoritative program/VIP state and the login email can never appear here.';

alter table private.ost_applicant_changes enable row level security;
revoke all on private.ost_applicant_changes from public, anon, authenticated, service_role;

create or replace function private.guard_ost_applicant_history() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'OST_APPLICANT_HISTORY_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function private.guard_ost_applicant_history() from public, anon, authenticated, service_role;
drop trigger if exists ost_applicant_history_guard on private.ost_applicant_changes;
create trigger ost_applicant_history_guard before update or delete on private.ost_applicant_changes
for each row execute function private.guard_ost_applicant_history();

-- Current registered applicant view: the frozen registration data overlaid by
-- every accepted correction in id order (each row stores only the fields it
-- changed, so later rows override earlier ones per field). The table checks
-- keep protected keys out.
create or replace function private.ost_applicant_current(p_ost uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, private, public, pg_temp as $$
  select private.ost_applicant_snapshot(p_ost) || coalesce((
    select jsonb_object_agg(latest.key, latest.value)
    from (
      select distinct on (e.key) e.key, e.value
      from private.ost_applicant_changes c, jsonb_each(c.resulting_values) e
      where c.ost_id = p_ost
      order by e.key, c.id desc
    ) latest), '{}'::jsonb);
$$;
revoke all on function private.ost_applicant_current(uuid) from public, anon, authenticated, service_role;

-- Renewal submission freezes the latest registered values (the overlay), so the
-- form reflects verified information at final submission.
create or replace function public.submit_ost_renewal(p_request_id uuid, p_actor_id uuid, p_ost_id uuid, p_input jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, extensions, private, public, pg_temp as $$
declare v_member public.ost_members%rowtype; v_term private.ost_accreditation_terms%rowtype; v_prior private.ost_accreditation_renewals%rowtype; v_id uuid := gen_random_uuid(); v_hash text; v_role text;
begin
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED'; end if;
  v_role := private.ost_owned_or_view(p_actor_id, p_ost_id);
  select * into v_member from public.ost_members where id = p_ost_id for update;
  if not found or v_member.status <> 'active' then raise exception 'OST_IDENTITY_REQUIRED'; end if;
  if p_actor_id <> p_ost_id then perform private.ost_scope(p_actor_id, v_member.sponsor_staff_id); end if;
  if p_actor_id <> p_ost_id and p_actor_id <> v_member.sponsor_staff_id then perform private.ost_reviewer(p_actor_id); end if;
  select * into v_term from private.ost_accreditation_terms where ost_id = p_ost_id and status = 'active' for update;
  if not found then raise exception 'OST_PRIOR_TERM_REQUIRED'; end if;
  v_hash := encode(digest(private.normalized_mutation_json(p_input)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 23000001));
  select * into v_prior from private.ost_accreditation_renewals where request_id = p_request_id;
  if found then
    if v_prior.created_by <> p_actor_id or v_prior.ost_id <> p_ost_id or v_prior.payload_hash <> v_hash then raise exception 'MUTATION_PAYLOAD_CONFLICT'; end if;
    return v_prior.id;
  end if;
  if nullif(p_input->>'proposedNewSponsorStaffId', '') is not null then perform private.ost_active_sponsor((p_input->>'proposedNewSponsorStaffId')::uuid); end if;
  insert into private.ost_accreditation_renewals(id, renewal_number, request_id, payload_hash, ost_id, prior_term_id, date_of_renewal, requested_start, requested_end,
    applicant_snapshot, original_accreditation_date, last_expiry_date, old_sponsor_staff_id, proposed_new_sponsor_staff_id, reason_for_referrer_change, referrer_snapshot,
    applicant_signature_status, referrer_signature_status, created_by)
    values(v_id, 'REN-' || upper(replace(v_id::text, '-', '')), p_request_id, v_hash, p_ost_id, v_term.id, (p_input->>'dateOfRenewal')::date, (p_input->>'requestedStart')::date, (p_input->>'requestedEnd')::date,
      private.ost_applicant_current(p_ost_id), (select min(starts_on) from private.ost_accreditation_terms where ost_id = p_ost_id), v_term.expires_on, v_member.sponsor_staff_id,
      nullif(p_input->>'proposedNewSponsorStaffId', '')::uuid, nullif(btrim(p_input->>'reasonForReferrerChange'), ''), private.ost_active_sponsor(v_member.sponsor_staff_id),
      p_input->>'applicantSignatureStatus', p_input->>'referrerSignatureStatus', p_actor_id);
  insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data) values(p_actor_id, 'OST_RENEWAL_SUBMITTED', 'ost_renewal', v_id::text, jsonb_build_object('ostId', p_ost_id, 'status', 'submitted'));
  return v_id;
end $$;

-- Reads project the overlay as the current registered applicant.
create or replace function public.ost_accreditation_records(p_actor_id uuid, p_ost_id uuid default null, p_application_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_detail jsonb; v_sponsor uuid;
begin
  v_role := private.ost_owned_or_view(p_actor_id, p_ost_id);
  if p_ost_id is not null then
    select sponsor_staff_id into v_sponsor from public.ost_members where id = p_ost_id;
    if not found then raise exception 'OST_IDENTITY_REQUIRED'; end if;
    if p_actor_id <> p_ost_id then perform private.ost_scope(p_actor_id, v_sponsor); end if;
  end if;
  if p_application_id is not null then
    select sponsor_staff_id into v_sponsor from public.ost_applications where id = p_application_id;
    if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
    if p_actor_id = p_ost_id then
      if not exists(select 1 from public.ost_members where id = p_actor_id and application_id = p_application_id) then raise exception 'MUTATION_FORBIDDEN' using errcode = '42501'; end if;
    else perform private.ost_scope(p_actor_id, v_sponsor); end if;
    select (to_jsonb(d) - 'payload_hash' - 'request_id') || jsonb_build_object('official_details', d.official_details - ARRAY['governmentIdNumber', 'tin']) into v_detail from private.ost_registration_details d where application_id = p_application_id;
  end if;
  return jsonb_build_object('registration', v_detail, 'currentApplicant', case when p_ost_id is not null then private.ost_applicant_current(p_ost_id) else null end,
    'terms', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('displayStatus', case when t.status = 'active' and t.expires_on < current_date then 'expired' else t.status end) order by t.starts_on, t.id) from private.ost_accreditation_terms t where t.ost_id = p_ost_id), '[]'),
    'renewals', coalesce((select jsonb_agg((to_jsonb(r) - 'payload_hash' - 'request_id') || jsonb_build_object('applicant_snapshot', r.applicant_snapshot - 'governmentIdNumber') order by r.created_at desc, r.id) from private.ost_accreditation_renewals r where r.ost_id = p_ost_id), '[]'));
end $$;

create or replace function public.update_ost_applicant(p_request_id uuid, p_actor_id uuid, p_ost_id uuid, p_input jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, extensions, private, public, pg_temp as $$
declare v_current jsonb; v_proposed jsonb; v_prior jsonb := '{}'::jsonb; v_resulting jsonb := '{}'::jsonb;
  v_changed text[] := '{}'::text[]; v_field text; v_reason text; v_payload jsonb; v_replay uuid; v_change bigint;
begin
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode = '22023'; end if;
  perform private.mutation_actor_role(p_actor_id, 'network.members', 'update');
  v_reason := nullif(btrim(p_input->>'reason'), '');
  v_proposed := jsonb_strip_nulls(jsonb_build_object(
    'fullName', nullif(btrim(p_input->>'fullName'), ''),
    'birthDate', nullif(p_input->>'birthDate', '')::date,
    'phone', nullif(btrim(p_input->>'phone'), ''),
    'sex', nullif(btrim(p_input->>'sex'), ''),
    'civilStatus', nullif(btrim(p_input->>'civilStatus'), ''),
    'address', p_input->'address',
    'messenger', nullif(btrim(p_input->>'messenger'), ''),
    'employerName', nullif(btrim(p_input->>'employerName'), ''),
    'jobPosition', nullif(btrim(p_input->>'jobPosition'), '')))
    -- A supplied empty optional text means "clear", not "unchanged": strip_nulls
    -- would silently drop it, so supplied-empty keys come back as an explicit null.
    || (select coalesce(jsonb_object_agg(k, 'null'::jsonb), '{}'::jsonb)
        from unnest(array['messenger', 'employerName', 'jobPosition']) k
        where p_input ? k and btrim(coalesce(p_input->>k, '')) = '');
  v_payload := v_proposed || jsonb_build_object('ostId', p_ost_id, 'reason', v_reason);
  v_replay := private.mutation_result(p_actor_id, 'ost.applicant.update', p_request_id, v_payload);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.ost_members where id = p_ost_id for update;
  if not found then raise exception 'OST_IDENTITY_REQUIRED' using errcode = '22023'; end if;
  v_current := private.ost_applicant_current(p_ost_id);
  for v_field in select jsonb_object_keys(v_proposed) loop
    if (v_current->v_field) is distinct from (v_proposed->v_field) then
      v_changed := v_changed || v_field;
      v_prior := v_prior || jsonb_build_object(v_field, v_current->v_field);
      v_resulting := v_resulting || jsonb_build_object(v_field, v_proposed->v_field);
    end if;
  end loop;
  if cardinality(v_changed) = 0 then raise exception 'OST_APPLICANT_NO_CHANGES' using errcode = '22023'; end if;
  if v_changed && ARRAY['fullName', 'birthDate', 'sex', 'civilStatus']::text[]
    and (v_reason is null or length(v_reason) < 5) then
    raise exception 'OST_APPLICANT_REASON_REQUIRED' using errcode = '22023';
  end if;
  insert into private.ost_applicant_changes(ost_id, changed_fields, prior_values, resulting_values, reason, changed_by)
    values(p_ost_id, v_changed, v_prior, v_resulting, v_reason, p_actor_id) returning id into v_change;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data)
    values(p_actor_id, 'OST_APPLICANT_UPDATED', 'ost_member', p_ost_id::text,
      jsonb_build_object('changeId', v_change, 'changedFields', to_jsonb(v_changed)));
  perform private.complete_mutation(p_actor_id, 'ost.applicant.update', p_request_id, v_payload, p_ost_id);
  return p_ost_id;
end $$;
revoke all on function public.update_ost_applicant(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_ost_applicant(uuid, uuid, uuid, jsonb) to service_role;

alter table private.mutation_requests drop constraint if exists mutation_requests_operation_check;
alter table private.mutation_requests add constraint mutation_requests_operation_check
  -- Forward-only union: an already-applied database keeps rows for every
  -- operation any earlier batch accepted (20261208000009 re-states the union).
  check (operation in ('payment.create','application.create','reservation.create','purchase_terms.review',
    'application.submit','application.decide','reservation.transition','payment.verify',
    'reservation.finalize','purchase.finalize','membership.activate','ost.convert',
    'ost.applicant.update','sale_team.transfer'));
commit;
