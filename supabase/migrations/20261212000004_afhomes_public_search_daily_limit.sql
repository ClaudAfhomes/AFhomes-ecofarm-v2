-- Admin-controlled daily disclosure allowance; enabled by default for existing installations.
-- Validate: disposable search/settings tests: fourth search denied when on, allowed when off,
-- restored immediately when on; concurrent cap, authorization and existing abuse checks retained.
-- select daily_limit_enabled from private.public_verification_settings; -- true initially
-- Down: turn the daily limit back on through the administrator settings; retain disclosure history.
begin;
alter table private.public_verification_settings add column if not exists daily_limit_enabled boolean not null default true;
create or replace function public.get_public_verification_settings() returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('enabled',s.enabled,'dailyLimitEnabled',s.daily_limit_enabled,'verificationPhone',s.verification_phone,
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
 if (p_input ? 'dailyLimitEnabled' and jsonb_typeof(p_input->'dailyLimitEnabled') is distinct from 'boolean') or
    jsonb_typeof(p_input->'verificationPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'privacyNotice') is distinct from 'string' or
    jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or
    jsonb_typeof(p_input->'retentionDays') is distinct from 'number' or
    (p_input->>'retentionDays') !~ '^[0-9]+$' then
  raise exception 'SETTINGS_INVALID' using errcode='22023';
 end if;
 v_version:=case when (v_before.verification_phone,v_before.privacy_notice,v_before.retention_days,v_before.daily_limit_enabled)
  is distinct from (btrim(p_input->>'verificationPhone'),btrim(p_input->>'privacyNotice'),(p_input->>'retentionDays')::integer,coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled))
  then gen_random_uuid()::text else v_before.notice_version end;
 update private.public_verification_settings s set enabled=(p_input->>'enabled')::boolean,
  daily_limit_enabled=coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
  verification_phone=btrim(p_input->>'verificationPhone'),privacy_notice=btrim(p_input->>'privacyNotice'),
  retention_days=(p_input->>'retentionDays')::integer,notice_version=v_version,
  revision=s.revision+1,updated_at=clock_timestamp() where s.singleton;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor,'PUBLIC_VERIFICATION_SETTINGS_UPDATED','public_verification_settings','singleton',
  jsonb_build_object('dailyLimitEnabled',v_before.daily_limit_enabled,'enabled',v_before.enabled,'retentionDays',v_before.retention_days,'revision',v_before.revision),
  jsonb_build_object('dailyLimitEnabled',coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),'enabled',(p_input->>'enabled')::boolean,'retentionDays',(p_input->>'retentionDays')::integer,
   'revision',v_before.revision+1,'noticeVersion',v_version));
 return public.get_public_verification_settings();
end;
$$;
create or replace function public.reveal_sale_team_search(p_ip_hash text,p_request_id uuid,p_aa_number text,p_notice_version text,p_contact_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_now timestamptz; v_count integer; v_oldest timestamptz; v_retry boolean; v_result jsonb;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' or p_request_id is null or p_aa_number is null or length(p_aa_number)>64 or p_notice_version is null or length(p_notice_version) not between 1 and 100 then raise exception 'INVALID_SEARCH' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sale-team-search:'||p_ip_hash,0));
 perform 1 from private.sale_team_search_contacts c where c.id=p_contact_id for key share;
 if not found then raise exception 'CONTACT_REQUIRED' using errcode='22023'; end if;
 v_now:=clock_timestamp();
 select exists(select 1 from private.sale_team_search_disclosures d where d.ip_hash=p_ip_hash and d.request_id=p_request_id) into v_retry;
 select count(*)::integer,min(d.disclosed_at) into v_count,v_oldest from private.sale_team_search_disclosures d where d.ip_hash=p_ip_hash and d.disclosed_at>v_now-interval '24 hours';
 if not v_retry and v_count>=3 and coalesce((select s.daily_limit_enabled from private.public_verification_settings s where s.singleton),true) then return jsonb_build_object('limited',true,'retryAfter',greatest(1,ceil(extract(epoch from v_oldest+interval '24 hours'-v_now))),'result',null); end if;
 v_result:=public.search_sale_team_accreditation(p_aa_number);
 if v_result is not null and not v_retry then insert into private.sale_team_search_disclosures(ip_hash,request_id,notice_version,disclosed_at) values(p_ip_hash,p_request_id,p_notice_version,v_now); end if;
 return jsonb_build_object('limited',false,'retryAfter',0,'result',v_result);
end;
$$;
revoke all on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer),public.reveal_sale_team_search(text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.get_public_verification_settings(),public.update_public_verification_settings(uuid,jsonb,integer),public.reveal_sale_team_search(text,uuid,text,text,uuid) to service_role;
commit;
