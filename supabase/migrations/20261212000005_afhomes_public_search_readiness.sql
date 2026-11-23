-- Move privacy approval to admin settings; verify cleanup readiness from the scheduler.
-- Validate: disposable search/settings tests cover missing, inactive and altered jobs,
-- administrator-only approval, stale revisions, replay and service-only ACLs.
-- select public.get_public_verification_settings()->'cleanupReady'; -- true only for the configured job
-- Down: disable search through admin settings; retain settings and audit history.
begin;
-- Preserve the already owner-approved notice; future singleton inserts require approval.
alter table private.public_verification_settings add column if not exists privacy_approved boolean not null default true;
alter table private.public_verification_settings alter column privacy_approved set default false;

create or replace function public.get_public_verification_settings() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v_cleanup_ready boolean:=false;
begin
 if to_regclass('cron.job') is not null
    and to_regprocedure('public.cleanup_sale_team_search()') is not null
    and to_regprocedure('public.cleanup_sale_team_search(integer)') is not null then
  select count(*)=1 and coalesce(bool_and(j.active and j.schedule='0 * * * *'
    and j.command='select public.cleanup_sale_team_search();'
    and j.database=current_database() and j.username=current_user),false)
  into v_cleanup_ready from cron.job j where j.jobname='afhomes-sale-team-search-cleanup';
 end if;
 return (select jsonb_build_object('enabled',s.enabled,'dailyLimitEnabled',s.daily_limit_enabled,
  'privacyApproved',s.privacy_approved,'cleanupReady',v_cleanup_ready,
  'verificationPhone',s.verification_phone,'privacyNotice',s.privacy_notice,'retentionDays',s.retention_days,
  'noticeVersion',s.notice_version,'revision',s.revision,'updatedAt',s.updated_at)
  from private.public_verification_settings s where s.singleton);
end;
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
 if (p_input ? 'privacyApproved' and jsonb_typeof(p_input->'privacyApproved') is distinct from 'boolean') or
    (p_input ? 'dailyLimitEnabled' and jsonb_typeof(p_input->'dailyLimitEnabled') is distinct from 'boolean') or
    jsonb_typeof(p_input->'verificationPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'privacyNotice') is distinct from 'string' or
    jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or
    jsonb_typeof(p_input->'retentionDays') is distinct from 'number' or
    (p_input->>'retentionDays') !~ '^[0-9]+$' then
  raise exception 'SETTINGS_INVALID' using errcode='22023';
 end if;
 v_version:=case when (v_before.verification_phone,v_before.privacy_notice,v_before.retention_days,v_before.daily_limit_enabled,v_before.privacy_approved)
  is distinct from (btrim(p_input->>'verificationPhone'),btrim(p_input->>'privacyNotice'),(p_input->>'retentionDays')::integer,coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),coalesce((p_input->>'privacyApproved')::boolean,v_before.privacy_approved))
  then gen_random_uuid()::text else v_before.notice_version end;
 update private.public_verification_settings s set enabled=(p_input->>'enabled')::boolean,
  privacy_approved=coalesce((p_input->>'privacyApproved')::boolean,v_before.privacy_approved),
  daily_limit_enabled=coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
  verification_phone=btrim(p_input->>'verificationPhone'),privacy_notice=btrim(p_input->>'privacyNotice'),
  retention_days=(p_input->>'retentionDays')::integer,notice_version=v_version,
  revision=s.revision+1,updated_at=clock_timestamp() where s.singleton;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor,'PUBLIC_VERIFICATION_SETTINGS_UPDATED','public_verification_settings','singleton',
  jsonb_build_object('privacyApproved',v_before.privacy_approved,'dailyLimitEnabled',v_before.daily_limit_enabled,'enabled',v_before.enabled,'retentionDays',v_before.retention_days,'revision',v_before.revision),
  jsonb_build_object('privacyApproved',coalesce((p_input->>'privacyApproved')::boolean,v_before.privacy_approved),'dailyLimitEnabled',coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),'enabled',(p_input->>'enabled')::boolean,'retentionDays',(p_input->>'retentionDays')::integer,
   'revision',v_before.revision+1,'noticeVersion',v_version));
 return public.get_public_verification_settings();
end;
$$;
revoke all on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer) to service_role;
commit;
