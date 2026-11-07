-- Company customers can predate this application. Their Excel ID is preserved in
-- ra_number; customer_number remains the independently generated system reference.
-- Never repair historical duplicate identities implicitly.
do $$begin
 if exists(select 1 from public.customers where nullif(btrim(ra_number),'') is not null group by lower(btrim(ra_number)) having count(*)>1) then
  raise exception 'IMPORT_DUPLICATE_COMPANY_IDS_REVIEW_REQUIRED';
 end if;
end $$;
create unique index customers_company_customer_id_unique
 on public.customers(lower(btrim(ra_number)))
 where nullif(btrim(ra_number),'') is not null;

-- Annual company numbering is independent of internal AF-CUS-XXXXX references.
-- Keep a high-water mark so corrections/deletions cannot cause ID reuse.
create table private.company_customer_id_counters (
 issue_year integer primary key check(issue_year between 1 and 9999),
 last_issued integer not null check(last_issued between 0 and 999999)
);
alter table private.company_customer_id_counters enable row level security;
revoke all on private.company_customer_id_counters from public,anon,authenticated,service_role;
insert into private.company_customer_id_counters(issue_year,last_issued)
 select substring(btrim(ra_number) from 8 for 4)::integer,max(right(btrim(ra_number),6)::integer)
 from public.customers where upper(btrim(ra_number)) ~ '^AF-CUS-[0-9]{4}-[0-9]{6}$'
 group by 1;

create function private.assign_company_customer_id() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_year integer;v_serial integer;
begin
 if nullif(btrim(new.ra_number),'') is null and tg_op='INSERT' then
  v_year:=extract(year from current_timestamp at time zone 'Asia/Manila')::integer;
  insert into private.company_customer_id_counters(issue_year,last_issued) values(v_year,0) on conflict(issue_year) do nothing;
  update private.company_customer_id_counters set last_issued=last_issued+1 where issue_year=v_year and last_issued<999999 returning last_issued into v_serial;
  if not found then raise exception 'COMPANY_CUSTOMER_ID_RANGE_EXHAUSTED';end if;
  new.ra_number:='AF-CUS-'||v_year::text||'-'||lpad(v_serial::text,6,'0');
 elsif upper(btrim(new.ra_number)) ~ '^AF-CUS-[0-9]{4}-[0-9]{6}$' then
  v_year:=substring(btrim(new.ra_number) from 8 for 4)::integer;
  v_serial:=right(btrim(new.ra_number),6)::integer;
  insert into private.company_customer_id_counters(issue_year,last_issued) values(v_year,v_serial)
   on conflict(issue_year) do update set last_issued=greatest(company_customer_id_counters.last_issued,excluded.last_issued);
 end if;
 return new;
end $$;
revoke all on function private.assign_company_customer_id() from public,anon,authenticated,service_role;
create trigger assign_company_customer_id before insert or update of ra_number on public.customers
 for each row execute function private.assign_company_customer_id();

create or replace function private.import_customer_for(p_row uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype; v_id uuid; v_email uuid; v_refs uuid[]; v_reference text;
begin
 select * into strict r from public.customer_import_rows where id=p_row;
 v_reference:=nullif(btrim(r.raw_data->>'ra_number'),'');
 select array_agg(c.id) into v_refs from public.customers c where v_reference is not null
  and (lower(c.customer_number)=lower(v_reference) or lower(btrim(c.ra_number))=lower(v_reference));
 if cardinality(v_refs)>1 then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 v_id:=v_refs[1];
 select id into v_email from public.customers where lower(email)=lower(r.raw_data->>'email');
 if v_id is not null and (v_email is distinct from v_id or r.customer_id is not null and r.customer_id<>v_id) then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 if r.customer_id is not null and v_email is distinct from r.customer_id then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 if v_reference is not null and v_id is null and v_email is not null and r.customer_id is null then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 -- An unmatched company ID can create a reviewed prospect; it is not a request
 -- to assign or regenerate the separate internal customer_number.
 return coalesce(r.customer_id,v_id,v_email);
end $$;
revoke all on function private.import_customer_for(uuid) from public,anon,authenticated,service_role;

-- Serialize company ID reuse as well as email/purchase retries. The existing
-- transaction, stale-target checks, genealogy and history safeguards are retained.
do $$declare definition text; needle text:=' v_customer:=private.import_customer_for(p_row_id);';begin
 select pg_get_functiondef('private.commit_customer_import_source(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure) into definition;
 if position(needle in definition)=0 or position('company-ra:' in definition)>0 then raise exception 'IMPORT_COMPANY_ID_MIGRATION_PRECONDITION';end if;
 execute replace(definition,needle,
 ' if nullif(btrim(r.raw_data->>''ra_number''),'''') is not null then
  perform pg_advisory_xact_lock(hashtextextended(''company-ra:''||(r.raw_data->>''ra_number''),0));
  perform pg_advisory_xact_lock(hashtextextended(''company-id:''||lower(btrim(r.raw_data->>''ra_number'')),0));
 end if;
 '||needle);
end $$;
revoke all on function private.commit_customer_import_source(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Imported company IDs must also find the customer through the normal directory.
do $$declare definition text; needle text:='lower(d.customer_number) like';begin
 select pg_get_functiondef('public.customer_directory(jsonb)'::regprocedure) into definition;
 if position(needle in definition)=0 then raise exception 'IMPORT_COMPANY_ID_DIRECTORY_PRECONDITION';end if;
 execute replace(definition,needle,
 'lower(d.ra_number) like ''%''||lower(p_filters->>''search'')||''%'' or '||needle);
end $$;
revoke all on function public.customer_directory(jsonb) from public,anon,authenticated;
grant execute on function public.customer_directory(jsonb) to service_role;
