-- Database-backed public verification controls; no credentials are stored here.
-- Validate: disposable search settings tests and security/rls_invariants.sql (empty = PASS).
-- Check: anon/authenticated cannot read settings or execute its RPCs; only configuration
-- administrators may update; the existing cleanup job reads current retention each run.
-- select has_function_privilege('anon','public.get_public_verification_settings()','execute'); -- false
-- select relrowsecurity from pg_class where oid='private.public_verification_settings'::regclass; -- true
-- Down: disable search via these settings; retain settings, audit and contact history.
begin;
create table if not exists private.public_verification_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 verification_phone text not null check(verification_phone ~ '^\+?[0-9 ()-]{7,30}$'),
 privacy_notice text not null check(length(privacy_notice) between 100 and 20000 and privacy_notice !~ '(\[Insert|\mTBD\M)'),
 retention_days integer not null default 30 check(retention_days between 1 and 3650),
 notice_version text not null default gen_random_uuid()::text,
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.public_verification_settings enable row level security;
revoke all on private.public_verification_settings from public,anon,authenticated,service_role;

create or replace function public.get_public_verification_settings() returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('enabled',s.enabled,'verificationPhone',s.verification_phone,
  'privacyNotice',s.privacy_notice,'retentionDays',s.retention_days,
  'noticeVersion',s.notice_version,'revision',s.revision,'updatedAt',s.updated_at)
 from private.public_verification_settings s where s.singleton;
$$;

create or replace function public.update_public_verification_settings(p_actor uuid,p_input jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text; v_before private.public_verification_settings%rowtype; v_version text;
begin
 v_role:=private.mutation_actor_role(p_actor,'governance.config','update');
 if v_role is null or v_role not in ('admin','super_admin') then raise exception 'SETTINGS_FORBIDDEN' using errcode='42501'; end if;
 select s.* into v_before from private.public_verification_settings s where s.singleton for update;
 if not found or p_expected_revision is distinct from v_before.revision then
  raise exception 'SETTINGS_CHANGED' using errcode='23505';
 end if;
 if jsonb_typeof(p_input->'verificationPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'privacyNotice') is distinct from 'string' or
    jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or
    jsonb_typeof(p_input->'retentionDays') is distinct from 'number' or
    (p_input->>'retentionDays') !~ '^[0-9]+$' then
  raise exception 'SETTINGS_INVALID' using errcode='22023';
 end if;
 v_version:=case when (v_before.verification_phone,v_before.privacy_notice,v_before.retention_days)
  is distinct from (btrim(p_input->>'verificationPhone'),btrim(p_input->>'privacyNotice'),(p_input->>'retentionDays')::integer)
  then gen_random_uuid()::text else v_before.notice_version end;
 update private.public_verification_settings s set enabled=(p_input->>'enabled')::boolean,
  verification_phone=btrim(p_input->>'verificationPhone'),privacy_notice=btrim(p_input->>'privacyNotice'),
  retention_days=(p_input->>'retentionDays')::integer,notice_version=v_version,
  revision=s.revision+1,updated_at=clock_timestamp() where s.singleton;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor,'PUBLIC_VERIFICATION_SETTINGS_UPDATED','public_verification_settings','singleton',
  jsonb_build_object('enabled',v_before.enabled,'retentionDays',v_before.retention_days,'revision',v_before.revision),
  jsonb_build_object('enabled',(p_input->>'enabled')::boolean,'retentionDays',(p_input->>'retentionDays')::integer,
   'revision',v_before.revision+1,'noticeVersion',v_version));
 return public.get_public_verification_settings();
end;
$$;

create or replace function public.cleanup_sale_team_search() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_days integer;
begin
 select s.retention_days into strict v_days from private.public_verification_settings s where s.singleton;
 perform public.cleanup_sale_team_search(v_days);
end;
$$;
revoke all on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer),public.cleanup_sale_team_search() from public,anon,authenticated;
grant execute on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer),public.cleanup_sale_team_search() to service_role;

-- Preserve the owner's supplied live controls; infrastructure readiness remains enforced by the API.
insert into private.public_verification_settings(singleton,enabled,verification_phone,privacy_notice,retention_days)
values(true,true,'+639604316867',$notice$AFHomes Ecofarm — IST/OST Verification Privacy Notice Version: 2026-10-21-v1 AFHomes Ecofarm provides this service to help you check a representative's identity or accreditation using their AA number. For privacy questions or requests concerning your personal information, contact claudmarsjimenez.afhomes@gmail.com. Before showing a result, we collect your name, email address and mobile number. We check their format but do not verify that you own the email address or number. We privately store one record per complete matching contact combination and reuse it for later IST or OST verification requests while the record is retained. We use this information to provide your requested verification service, recognize repeat submissions and help prevent misuse. Providing these details is not permission for marketing. Your contact details are not shown to the representative you search for. We also keep limited security information about connection identifiers, requests, timestamps and successful searches to enforce abuse controls and the search allowance. Current verification permits three successful disclosures per IP address in a rolling 24 hours. A result shows only the representative's masked name, AA number, available profile photo and applicable validity information. Contact records become eligible for deletion {{CONTACT_RETENTION_DAYS}} days after creation. Scheduled cleanup runs hourly in bounded batches, so deletion may occur later while a backlog is being processed. Security disclosure records become eligible after 30 days; attempt records become eligible after 30 days without an update. This notice does not promise immediate deletion from provider backups or logs governed by separate retention arrangements. The browser stores a random session identifier and a signed receipt for up to 24 hours, rather than a copy of your contact details. A receipt does not remove the requirement for a fresh acknowledgment and anti-bot check. Cloudflare Turnstile checks browser/network signals for automated requests. Vercel hosts the website and API, and Supabase stores service data. Authorized service processes handle the contact/security records; public browser users cannot read those private tables directly. You may request information, access or correction concerning your personal data, or erasure/blocking where applicable, by emailing the privacy contact above. We may need to verify your identity and evaluate applicable legal obligations. You may also raise concerns with the National Privacy Commission. If you do not provide the requested contact details and acknowledge this notice, this online workflow will not show a verification result. Contact the official AFHomes company verification number, +63 960-431-6867, for assistance. Do not send payment or transact outside official AFHomes processes.$notice$,30) on conflict(singleton) do nothing;

-- Preserve every other job. Fresh installations schedule cleanup separately after approval.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  if exists(select 1 from cron.job where jobname='afhomes-sale-team-search-cleanup') then
   if (select count(*) from cron.job where jobname='afhomes-sale-team-search-cleanup')<>1
      or exists(select 1 from cron.job where jobname='afhomes-sale-team-search-cleanup' and username<>current_user) then
    raise exception 'CLEANUP_JOB_OWNER_MISMATCH';
   end if;
   perform cron.schedule('afhomes-sale-team-search-cleanup','0 * * * *','select public.cleanup_sale_team_search();');
  end if;
 end if;
end $$;
commit;
