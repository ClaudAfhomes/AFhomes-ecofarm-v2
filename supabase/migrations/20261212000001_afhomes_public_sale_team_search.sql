-- AF Homes public verification: private contact deduplication and shared abuse/allowance state.
-- Dependencies: current sale-team/photo and IST employee-identity migrations.
-- Validation: run test-sale-team-search.mjs and security/rls_invariants.sql (empty = PASS).
-- Validate browser/service-role direct SELECT and browser RPC EXECUTE are denied.
-- Re-runnable; no identity/date/history rewrite. No pg_cron installation or job is implicit.
-- Down: disable public search first; retain contacts per approved retention and issued identity history.
begin;

create table if not exists private.sale_team_search_contacts (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (dedupe_key ~ '^[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 200 and name=btrim(name)),
  email text not null check (length(email) between 3 and 254 and email=lower(btrim(email))),
  mobile text not null check (mobile ~ '^\+?[0-9]{7,15}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists sale_team_search_contacts_created_idx on private.sale_team_search_contacts(created_at);
create table if not exists private.sale_team_search_attempts (
  ip_hash text primary key check (ip_hash ~ '^[a-f0-9]{64}$'),
  window_started timestamptz not null,
  attempts integer not null default 0 check (attempts>=0),
  invalid_started timestamptz not null,
  invalid_attempts integer not null default 0 check (invalid_attempts>=0),
  cooldown_until timestamptz,
  updated_at timestamptz not null
);
create index if not exists sale_team_search_attempts_updated_idx on private.sale_team_search_attempts(updated_at);
create table if not exists private.sale_team_search_disclosures (
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid not null,
  notice_version text not null check (length(notice_version) between 1 and 100),
  disclosed_at timestamptz not null default clock_timestamp(),
  primary key (ip_hash,request_id)
);
create index if not exists sale_team_search_disclosures_ip_time_idx on private.sale_team_search_disclosures(ip_hash,disclosed_at);
create index if not exists sale_team_search_disclosures_time_idx on private.sale_team_search_disclosures(disclosed_at);
alter table private.sale_team_search_contacts enable row level security;
alter table private.sale_team_search_attempts enable row level security;
alter table private.sale_team_search_disclosures enable row level security;
revoke all on private.sale_team_search_contacts,private.sale_team_search_attempts,private.sale_team_search_disclosures from public,anon,authenticated,service_role;

-- Restore date-free IST semantics while retaining the photo migration's staffId.
create or replace function public.get_sale_team_accreditation(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('staffId',a.staff_id,'aaNumber',a.aa_number,'kind',a.kind,'fullName',a.public_name,
   'startsOn',case when a.kind='OST' then coalesce(t.starts_on,a.starts_on) else a.starts_on end,
   'expiresOn',case when a.kind='OST' then coalesce(t.expires_on,a.expires_on) else a.expires_on end,
   'status',case
     when a.status='revoked' or (a.kind='OST' and t.status='revoked') then 'revoked'
     when s.status<>'active' or not r.is_active
       or (a.kind='IST' and r.slug not in ('vice_director','senior_sales_manager','sales_manager'))
       or (a.kind='OST' and (r.slug<>'ost' or m.status is distinct from 'active' or t.id is null)) then 'inactive'
     when (case when a.kind='OST' then t.starts_on else null::date end)>(now() at time zone 'Asia/Manila')::date then 'not_started'
     when (case when a.kind='OST' then t.expires_on else null::date end)<(now() at time zone 'Asia/Manila')::date then 'expired'
     else 'accredited' end)
 from private.sale_team_accreditations a
 join public.staff_users s on s.id=a.staff_id
 join public.staff_role_assignments ra on ra.staff_id=s.id
 join public.roles r on r.id=ra.role_id
 left join public.ost_members m on m.id=s.id and a.kind='OST'
 left join lateral (select ot.* from private.ost_accreditation_terms ot
   where ot.ost_id=m.id and ot.status in ('active','revoked')
   order by ot.approved_at desc,ot.id desc limit 1) t on true
 where a.staff_id=p_staff_id;
$$;
revoke all on function public.get_sale_team_accreditation(uuid) from public,anon,authenticated;
grant execute on function public.get_sale_team_accreditation(uuid) to service_role;

create or replace function public.save_sale_team_search_contact(p_dedupe_key text,p_name text,p_email text,p_mobile text)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid;
begin
 if p_dedupe_key is null or p_dedupe_key !~ '^[a-f0-9]{64}$' or p_name is null or p_email is null or p_mobile is null then raise exception 'INVALID_CONTACT' using errcode='22023'; end if;
 insert into private.sale_team_search_contacts(dedupe_key,name,email,mobile) values(p_dedupe_key,p_name,p_email,p_mobile)
 on conflict(dedupe_key) do nothing returning id into v_id;
 if v_id is null then select c.id into v_id from private.sale_team_search_contacts c where c.dedupe_key=p_dedupe_key; end if;
 return v_id;
end;
$$;
create or replace function public.sale_team_search_contact_exists(p_contact_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from private.sale_team_search_contacts c where c.id=p_contact_id);
$$;

create or replace function public.begin_sale_team_search(p_ip_hash text,p_aa_number text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_now timestamptz; v_state private.sale_team_search_attempts%rowtype; v_result jsonb;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' or p_aa_number is null or length(p_aa_number)>64 then raise exception 'INVALID_SEARCH' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sale-team-search:'||p_ip_hash,0));
 v_now:=clock_timestamp();
 insert into private.sale_team_search_attempts(ip_hash,window_started,invalid_started,updated_at) values(p_ip_hash,v_now,v_now,v_now) on conflict do nothing;
 select a.* into v_state from private.sale_team_search_attempts a where a.ip_hash=p_ip_hash for update;
 if v_state.cooldown_until>v_now then return jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from v_state.cooldown_until-v_now)))); end if;
 if v_state.window_started<=v_now-interval '60 seconds' then v_state.window_started:=v_now; v_state.attempts:=0; end if;
 if v_state.invalid_started<=v_now-interval '5 minutes' then v_state.invalid_started:=v_now; v_state.invalid_attempts:=0; end if;
 if v_state.attempts>=30 then return jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from v_state.window_started+interval '60 seconds'-v_now)))); end if;
 v_state.attempts:=v_state.attempts+1;
 v_result:=public.search_sale_team_accreditation(p_aa_number);
 if v_result is null then v_state.invalid_attempts:=v_state.invalid_attempts+1; end if;
 if v_state.invalid_attempts>=20 then v_state.cooldown_until:=v_now+interval '5 minutes'; end if;
 update private.sale_team_search_attempts a set window_started=v_state.window_started,attempts=v_state.attempts,invalid_started=v_state.invalid_started,invalid_attempts=v_state.invalid_attempts,cooldown_until=v_state.cooldown_until,updated_at=v_now where a.ip_hash=p_ip_hash;
 return jsonb_build_object('allowed',not coalesce(v_state.cooldown_until>v_now,false),'retryAfter',case when v_state.cooldown_until>v_now then 300 else 0 end);
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
 if not v_retry and v_count>=3 then return jsonb_build_object('limited',true,'retryAfter',greatest(1,ceil(extract(epoch from v_oldest+interval '24 hours'-v_now))),'result',null); end if;
 v_result:=public.search_sale_team_accreditation(p_aa_number);
 if v_result is not null and not v_retry then insert into private.sale_team_search_disclosures(ip_hash,request_id,notice_version,disclosed_at) values(p_ip_hash,p_request_id,p_notice_version,v_now); end if;
 return jsonb_build_object('limited',false,'retryAfter',0,'result',v_result);
end;
$$;

create or replace function public.cleanup_sale_team_search(p_contact_retention_days integer)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_contact_retention_days is null or p_contact_retention_days not between 1 and 3650 then raise exception 'RETENTION_REQUIRED' using errcode='22023'; end if;
 -- Bound each sweep; the scheduler must repeat and monitor backlog until expired rows are drained.
 delete from private.sale_team_search_disclosures d where (d.ip_hash,d.request_id) in
   (select old.ip_hash,old.request_id from private.sale_team_search_disclosures old where old.disclosed_at<clock_timestamp()-interval '30 days' order by old.disclosed_at limit 1000);
 delete from private.sale_team_search_attempts a where a.ip_hash in
   (select old.ip_hash from private.sale_team_search_attempts old where old.updated_at<clock_timestamp()-interval '30 days' order by old.updated_at limit 1000);
 delete from private.sale_team_search_contacts c where c.id in
   (select old.id from private.sale_team_search_contacts old where old.created_at<clock_timestamp()-make_interval(days=>p_contact_retention_days) order by old.created_at limit 1000);
end;
$$;

revoke all on function public.save_sale_team_search_contact(text,text,text,text),public.sale_team_search_contact_exists(uuid),public.begin_sale_team_search(text,text),public.reveal_sale_team_search(text,uuid,text,text,uuid),public.cleanup_sale_team_search(integer) from public,anon,authenticated;
grant execute on function public.save_sale_team_search_contact(text,text,text,text),public.sale_team_search_contact_exists(uuid),public.begin_sale_team_search(text,text),public.reveal_sale_team_search(text,uuid,text,text,uuid),public.cleanup_sale_team_search(integer) to service_role;
commit;
