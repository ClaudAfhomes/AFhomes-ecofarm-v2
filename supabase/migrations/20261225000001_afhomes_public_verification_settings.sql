-- Public verification: persist editable support, bank/check details and payment notices.
-- Consolidates two never-applied drafts; 20261212000005 readiness remains immutable.
-- Validation: test-sale-team-search.mjs; get_public_verification_settings() returns all
-- eleven content fields; stale revisions fail; browser roles cannot execute either RPC.
-- SELECT public.get_public_verification_settings();
-- SELECT has_function_privilege('authenticated','public.update_public_verification_settings(uuid,jsonb,integer)','EXECUTE'); -- false
-- Down: restore previous getter/updater definitions after reverting callers; retain
-- added columns and saved content. Do not reset privacy approval, cleanup or history.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

alter table private.public_verification_settings
  add column if not exists support_heading text not null default 'Customer Support & Payment Inquiries',
  add column if not exists support_email text not null default 'info@afhomes.com.ph' check(support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists support_phone text not null default '+63 960 431 6867' check(support_phone ~ '^\+?[0-9 ()-]{7,30}$'),
  add column if not exists bank_holder text not null default 'AFhomes Hotspring & Ecofarm Resort Corp.',
  add column if not exists bank1_name text not null default 'SECURITY BANK',
  add column if not exists bank1_account text not null default '0000082595577',
  add column if not exists bank2_name text not null default 'CHINABANK',
  add column if not exists bank2_account text not null default '150700006468',
  add column if not exists check_payee text not null default 'AFhomes Hotspring & Ecofarm Resort Corp.',
  add column if not exists bank_reminder text not null default 'Please double-check the provided company bank account details before sending any payment. Thank you!',
  add column if not exists agent_reminder text not null default 'A friendly reminder: All agents are strictly prohibited from directly collecting payments from buyers.';


-- Ensure privacy_approved column exists (added by 20261212000005_readiness)
alter table private.public_verification_settings
  add column if not exists privacy_approved boolean not null default false;

-- Fix get_public_verification_settings to return ALL fields including privacyApproved and cleanupReady
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
 return (select jsonb_build_object(
   'enabled',s.enabled,
   'dailyLimitEnabled',s.daily_limit_enabled,
   'privacyApproved',s.privacy_approved,
   'cleanupReady',v_cleanup_ready,
   'verificationPhone',s.verification_phone,
   'privacyNotice',s.privacy_notice,
   'retentionDays',s.retention_days,
   'noticeVersion',s.notice_version,
   'revision',s.revision,
   'updatedAt',s.updated_at,
   'supportHeading',s.support_heading,
   'supportEmail',s.support_email,
   'supportPhone',s.support_phone,
   'bankHolder',s.bank_holder,
   'bank1Name',s.bank1_name,
   'bank1Account',s.bank1_account,
   'bank2Name',s.bank2_name,
   'bank2Account',s.bank2_account,
   'checkPayee',s.check_payee,
   'bankReminder',s.bank_reminder,
   'agentReminder',s.agent_reminder
 )
 from private.public_verification_settings s where s.singleton);
end;
$$;

-- Fix update_public_verification_settings to handle ALL fields including privacyApproved
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
 -- Validate all fields
 if (p_input ? 'privacyApproved' and jsonb_typeof(p_input->'privacyApproved') is distinct from 'boolean') or
    (p_input ? 'dailyLimitEnabled' and jsonb_typeof(p_input->'dailyLimitEnabled') is distinct from 'boolean') or
    jsonb_typeof(p_input->'verificationPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'privacyNotice') is distinct from 'string' or
    jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or
    jsonb_typeof(p_input->'retentionDays') is distinct from 'number' or
    (p_input->>'retentionDays') !~ '^[0-9]+$' or
    jsonb_typeof(p_input->'supportHeading') is distinct from 'string' or
    jsonb_typeof(p_input->'supportEmail') is distinct from 'string' or
    jsonb_typeof(p_input->'supportPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'bankHolder') is distinct from 'string' or
    jsonb_typeof(p_input->'bank1Name') is distinct from 'string' or
    jsonb_typeof(p_input->'bank1Account') is distinct from 'string' or
    jsonb_typeof(p_input->'bank2Name') is distinct from 'string' or
    jsonb_typeof(p_input->'bank2Account') is distinct from 'string' or
    jsonb_typeof(p_input->'checkPayee') is distinct from 'string' or
    jsonb_typeof(p_input->'bankReminder') is distinct from 'string' or
    jsonb_typeof(p_input->'agentReminder') is distinct from 'string' then
  raise exception 'SETTINGS_INVALID' using errcode='22023';
 end if;
 v_version:=case when (
   v_before.verification_phone,v_before.privacy_notice,v_before.retention_days,
   v_before.daily_limit_enabled,v_before.privacy_approved,
   v_before.support_heading,v_before.support_email,v_before.support_phone,
   v_before.bank_holder,v_before.bank1_name,v_before.bank1_account,
   v_before.bank2_name,v_before.bank2_account,v_before.check_payee,
   v_before.bank_reminder,v_before.agent_reminder
 ) is distinct from (
   btrim(p_input->>'verificationPhone'),btrim(p_input->>'privacyNotice'),(p_input->>'retentionDays')::integer,
   coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
   coalesce((p_input->>'privacyApproved')::boolean,v_before.privacy_approved),
   btrim(p_input->>'supportHeading'),btrim(p_input->>'supportEmail'),btrim(p_input->>'supportPhone'),
   btrim(p_input->>'bankHolder'),btrim(p_input->>'bank1Name'),btrim(p_input->>'bank1Account'),
   btrim(p_input->>'bank2Name'),btrim(p_input->>'bank2Account'),btrim(p_input->>'checkPayee'),
   btrim(p_input->>'bankReminder'),btrim(p_input->>'agentReminder')
 ) then gen_random_uuid()::text else v_before.notice_version end;
 update private.public_verification_settings s set
   enabled=(p_input->>'enabled')::boolean,
   privacy_approved=coalesce((p_input->>'privacyApproved')::boolean,v_before.privacy_approved),
   daily_limit_enabled=coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
   verification_phone=btrim(p_input->>'verificationPhone'),
   privacy_notice=btrim(p_input->>'privacyNotice'),
   retention_days=(p_input->>'retentionDays')::integer,
   support_heading=btrim(p_input->>'supportHeading'),
   support_email=btrim(p_input->>'supportEmail'),
   support_phone=btrim(p_input->>'supportPhone'),
   bank_holder=btrim(p_input->>'bankHolder'),
   bank1_name=btrim(p_input->>'bank1Name'),
   bank1_account=btrim(p_input->>'bank1Account'),
   bank2_name=btrim(p_input->>'bank2Name'),
   bank2_account=btrim(p_input->>'bank2Account'),
   check_payee=btrim(p_input->>'checkPayee'),
   bank_reminder=btrim(p_input->>'bankReminder'),
   agent_reminder=btrim(p_input->>'agentReminder'),
   notice_version=v_version,
   revision=s.revision+1,
   updated_at=clock_timestamp()
 where s.singleton;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor,'PUBLIC_VERIFICATION_SETTINGS_UPDATED','public_verification_settings','singleton',
   jsonb_build_object(
     'privacyApproved',v_before.privacy_approved,
     'dailyLimitEnabled',v_before.daily_limit_enabled,
     'enabled',v_before.enabled,
     'retentionDays',v_before.retention_days,
     'revision',v_before.revision
   ),
   jsonb_build_object(
     'privacyApproved',coalesce((p_input->>'privacyApproved')::boolean,v_before.privacy_approved),
     'dailyLimitEnabled',coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
     'enabled',(p_input->>'enabled')::boolean,
     'retentionDays',(p_input->>'retentionDays')::integer,
     'revision',v_before.revision+1,
     'noticeVersion',v_version
   ));
 return public.get_public_verification_settings();
end;
$$;

revoke all on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer) to service_role;
