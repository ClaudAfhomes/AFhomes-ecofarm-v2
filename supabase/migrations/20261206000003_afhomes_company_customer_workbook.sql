-- Company workbook imports are identity-only; all financial/package/status values
-- remain statements in the existing protected import row. No new tables/columns.
-- Validation: pnpm test:db:local; execute the company workbook RPC integration test;
-- run supabase/security/rls_invariants.sql (empty = PASS).
-- Down: forward-only; restore the prior commit_customer_import_row body in a new
-- migration if disabling company imports. Never delete imported business history.

-- Read-only adapter over existing registered staff/roles/hierarchy. This does
-- not create genealogy, recommender or public registration APIs.
create or replace function public.match_company_import_staff(p_names text[])
returns table(staff_id uuid, full_name text, role_slug text, ancestor_ids uuid[], match_count bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select su.id, su.full_name, r.slug,
    array(with recursive lineage(id, depth) as (
      select rr.upline_staff_id, 1 from public.referral_relationships rr where rr.subject_staff_id=su.id and rr.is_active
      union all select rr.upline_staff_id, l.depth+1 from public.referral_relationships rr join lineage l on rr.subject_staff_id=l.id where rr.is_active and l.depth<4
    ) select l.id from lineage l order by l.depth),
    count(*) over(partition by lower(regexp_replace(trim(su.full_name),'\s+',' ','g')))
  from public.staff_users su join public.staff_role_assignments sa on sa.staff_id=su.id
  join public.roles r on r.id=sa.role_id and r.is_active
  where su.status='active' and lower(regexp_replace(trim(su.full_name),'\s+',' ','g')) = any(
    array(select lower(regexp_replace(trim(n),'\s+',' ','g')) from unnest(p_names) n)
  );
$$;
revoke all on function public.match_company_import_staff(text[]) from public, anon, authenticated;
grant execute on function public.match_company_import_staff(text[]) to service_role;

create or replace function private.commit_company_customer_import(p_row_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.customer_import_rows%rowtype;
  v_customer public.customers%rowtype;
  v_raw jsonb;
  v_person jsonb;
  v_previous jsonb;
  v_out jsonb;
  v_field text;
  v_expected text;
  v_match record;
  v_resolved uuid[] := '{}'::uuid[];
  v_referrer uuid;
begin
  -- Only the parent RPC (which rechecks permission, actor, job and row locks)
  -- calls this private function. Its EXECUTE privilege is not granted to clients.
  select * into strict v_row from public.customer_import_rows where id = p_row_id for update;
  v_raw := v_row.raw_data;
  v_person := v_row.normalized_data->'person';
  if v_raw->>'workbook_format' is distinct from 'company_v1'
    or v_row.normalized_data->>'category' is distinct from 'PENDING'
    or v_row.normalized_data->>'customerStatus' is distinct from 'prospect'
    or v_row.normalized_data->>'requireMember' is distinct from 'false'
    or coalesce(v_row.normalized_data->'payment', 'null'::jsonb) <> 'null'::jsonb
    or coalesce(v_person->>'email', '') = ''
    or coalesce(v_person->>'firstName', '') = ''
    or coalesce(v_person->>'lastName', '') = ''
    or coalesce(v_raw->>'mobile', '') !~ '^[0-9]{11}$'
    or (coalesce(v_raw->>'province','') <> '' and
      (coalesce(v_raw->>'verified_postal_code','') !~ '^[0-9]{4}$'
       or (coalesce(v_raw->>'postal_code','') <> '' and
           v_raw->>'postal_code' <> v_raw->>'verified_postal_code')))
    or (nullif(v_raw->>'secondary_first_name','') is not null and v_raw->>'vip_tier' <> 'GOLD')
  then raise exception 'IMPORT_ROW_INVALID'; end if;

  foreach v_field in array array['vd_name','ssm_name','sm_name','referrer_name'] loop
    if nullif(v_raw->>v_field,'') is null then continue; end if;
    select * into v_match from public.match_company_import_staff(array[v_raw->>v_field]);
    v_expected := case v_field when 'vd_name' then 'vice_director' when 'ssm_name' then 'senior_sales_manager' when 'sm_name' then 'sales_manager' else null end;
    if not found or v_match.match_count <> 1 or (v_expected is not null and v_match.role_slug <> v_expected)
      or v_match.role_slug not in ('vice_director','senior_sales_manager','sales_manager','ost')
      or v_match.staff_id::text is distinct from v_raw->>replace(v_field,'_name','_staff_id')
      or exists(select 1 from unnest(v_resolved) parent where parent <> v_match.staff_id and not parent=any(v_match.ancestor_ids))
    then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED'; end if;
    v_resolved := array_append(v_resolved,v_match.staff_id);
    if v_field='referrer_name' then v_referrer:=v_match.staff_id; end if;
  end loop;

  -- Serialize cross-job retries by strong identity, then RA reference. A unique
  -- email index remains the final guard even against another creation workflow.
  perform pg_advisory_xact_lock(hashtextextended('company-email:' || lower(v_person->>'email'), 0));
  if nullif(v_raw->>'ra_number', '') is not null then
    perform pg_advisory_xact_lock(hashtextextended('company-ra:' || (v_raw->>'ra_number'), 0));
    if exists (
      select 1 from public.customer_import_rows r
      where r.committed_at is not null and r.raw_data->>'ra_number' = v_raw->>'ra_number'
        and lower(r.raw_data->>'email') is distinct from lower(v_raw->>'email')
    ) or exists (
      select 1 from public.reservation_agreements ra where ra.reservation_number = v_raw->>'ra_number'
    ) then raise exception 'IMPORT_RA_REVIEW_REQUIRED'; end if;
  end if;
  select * into v_customer from public.customers c where lower(c.email) = lower(v_person->>'email') for update;
  if found then
    select r.raw_data into v_previous from public.customer_import_rows r
      where r.customer_id = v_customer.id and r.committed_at is not null
        and r.raw_data->>'workbook_format' = 'company_v1'
      order by r.committed_at desc, r.id limit 1;
    if (v_previous - 'tin' - 'secondary_tin') is distinct from (v_raw - 'tin' - 'secondary_tin')
      or (nullif(v_raw->>'tin','') is not null and v_raw->>'tin' is distinct from v_previous->>'tin')
      or (nullif(v_raw->>'secondary_tin','') is not null and v_raw->>'secondary_tin' is distinct from v_previous->>'secondary_tin')
      or v_customer.first_name is distinct from v_person->>'firstName'
      or v_customer.last_name is distinct from v_person->>'lastName'
      or v_customer.middle_name is distinct from nullif(v_person->>'middleName','')
      or v_customer.suffix is distinct from nullif(v_person->>'suffix','')
      or v_customer.phone is distinct from v_raw->>'mobile'
      or v_customer.birth_date is distinct from nullif(v_person->>'birthDate','')::date
    then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
    update public.customer_import_rows set customer_id = v_customer.id, committed_at = now(), action = 'SKIP' where id = p_row_id;
    v_out := jsonb_build_object('customerId', v_customer.id, 'membershipId', null, 'saleId', null);
  else
    if v_row.action <> 'CREATE' then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
    v_out := public.import_legacy_member(v_row.import_job_id, p_actor_id,
      v_person || jsonb_build_object('customerStatus', 'prospect', 'phone', v_raw->>'mobile',
        'address', jsonb_strip_nulls(jsonb_build_object(
          'line1', nullif(v_raw->>'address_line_1',''), 'line2', nullif(v_raw->>'address_line_2',''),
          'province', nullif(v_raw->>'province',''), 'city', nullif(v_raw->>'city',''),
          'barangay', nullif(v_raw->>'barangay',''), 'postalCode', nullif(v_raw->>'verified_postal_code',''),
          'provinceCode', nullif(v_raw->>'province_code',''),
          'cityMunicipalityCode', nullif(v_raw->>'city_code',''),
          'barangayCode', nullif(v_raw->>'barangay_code',''), 'countryCode', 'PH'))),
      null, '[]'::jsonb, null, false);
    if v_referrer is not null then update public.customers set referred_by_staff_id=v_referrer where id=(v_out->>'customerId')::uuid; end if;
    update public.customer_import_rows set customer_id = (v_out->>'customerId')::uuid, committed_at = now() where id = p_row_id;
  end if;
  v_out := jsonb_build_object('customerId', v_out->'customerId', 'membershipId', null, 'saleId', null,
    'action', case when v_customer.id is null then 'CREATE' else 'SKIP' end);
  insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data)
    values(p_actor_id, 'COMPANY_CUSTOMER_IMPORT_COMMITTED', 'customer_import_row', p_row_id::text,
      v_out || jsonb_build_object('importJobId', v_row.import_job_id));
  return v_out;
end $$;
revoke all on function private.commit_company_customer_import(uuid,uuid) from public, anon, authenticated, service_role;

-- Preserve the actual preceding legacy implementation, including coworker SSOT changes.
-- Re-application must not capture this dispatcher recursively.
do $capture$
declare definition text;
begin
  select pg_get_functiondef('public.commit_customer_import_row(uuid,uuid)'::regprocedure) into definition;
  if position('private.commit_customer_import_legacy_row' in definition)=0 then
    if position('FUNCTION public.commit_customer_import_row(' in definition)=0 then
      raise exception 'IMPORT_DISPATCHER_SIGNATURE_MISMATCH';
    end if;
    execute replace(definition,'FUNCTION public.commit_customer_import_row(', 'FUNCTION private.commit_customer_import_legacy_row(');
  elsif to_regprocedure('private.commit_customer_import_legacy_row(uuid,uuid)') is null then
    raise exception 'IMPORT_LEGACY_IMPLEMENTATION_MISSING';
  end if;
end $capture$;
revoke all on function private.commit_customer_import_legacy_row(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.commit_customer_import_row(p_row_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.customer_import_rows%rowtype;
  v_job public.customer_import_jobs%rowtype;
  v_customer public.customers%rowtype;
  v_person jsonb;
begin
  if not exists (select 1 from public.staff_users where id = p_actor_id and status = 'active') then
    raise exception 'ACTOR_INACTIVE';
  end if;
  if not exists (
    select 1 from public.staff_role_assignments sa join public.roles r on r.id = sa.role_id
    where sa.staff_id = p_actor_id and r.is_active and
      (r.slug = 'super_admin' or exists (
        select 1 from public.role_permissions rp join public.modules m on m.id = rp.module_id
        where rp.role_id = r.id and m.key = 'governance.customer_import' and rp.can_view and rp.can_update
      ))
  ) or exists (
    select 1 from public.staff_permission_restrictions pr join public.modules m on m.id = pr.module_id
    where pr.staff_id = p_actor_id and m.key = 'governance.customer_import' and (pr.deny_update or pr.deny_view)
  ) then raise exception 'IMPORT_FORBIDDEN'; end if;
  select * into v_row from public.customer_import_rows where id = p_row_id for update;
  if not found then raise exception 'IMPORT_ROW_NOT_FOUND'; end if;
  select * into v_job from public.customer_import_jobs where id = v_row.import_job_id for update;
  if v_row.committed_at is not null then
    if v_row.raw_data->>'workbook_format' = 'company_v1' then
      return jsonb_build_object('customerId', v_row.customer_id, 'membershipId', v_row.membership_id,
        'saleId', v_row.sale_id, 'action', v_row.action);
    end if;
    return jsonb_build_object('customerId', v_row.customer_id, 'membershipId', v_row.membership_id, 'saleId', v_row.sale_id);
  end if;
  if v_job.status not in ('ready', 'validated', 'committing') then raise exception 'IMPORT_JOB_NOT_COMMITTABLE'; end if;
  if v_row.validation_status not in ('valid', 'warning') or v_row.action not in ('CREATE', 'UPDATE') then
    raise exception 'IMPORT_ROW_INVALID';
  end if;
  if v_row.raw_data->>'workbook_format' = 'company_v1' then
    return private.commit_company_customer_import(p_row_id, p_actor_id);
  end if;
  if v_row.action = 'UPDATE' then
    v_person := v_row.normalized_data->'person';
    -- The preserved legacy implementation checks the RAW identifier claims
    -- before it touches the linked row: a row whose raw membership number or
    -- customer number contradicts the database is an identifier conflict even
    -- when the linked customer's stored identity has since changed elsewhere.
    -- These checks therefore run BEFORE the identity guard below so the
    -- rejection order matches the authoritative implementation; the legacy
    -- body repeats them, unchanged, after this dispatcher delegates.
    if nullif(v_row.raw_data->>'membership_number','') is not null and exists(
        select 1 from public.memberships m
        where m.membership_number = v_row.raw_data->>'membership_number'
          and m.customer_id is distinct from v_row.customer_id)
      then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
    if nullif(v_row.raw_data->>'customer_number','') is not null and exists(
        select 1 from public.customers c
        where c.customer_number = v_row.raw_data->>'customer_number'
          and c.id is distinct from v_row.customer_id)
      then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
    if exists(
        select 1 from public.customers c
        where lower(c.email) = lower(v_person->>'email')
          and c.id <> v_row.customer_id)
      then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
    select * into v_customer from public.customers where id=v_row.customer_id for update;
    if not found then raise exception 'IMPORT_UPDATE_WITHOUT_CUSTOMER'; end if;
    -- An import preview cannot overwrite identity that was verified or edited
    -- elsewhere before confirmation. Identity changes belong in Customers.
    if v_customer.first_name is distinct from v_person->>'firstName'
      or v_customer.last_name is distinct from v_person->>'lastName'
      or coalesce(v_customer.middle_name,'') <> coalesce(v_person->>'middleName','')
      or coalesce(v_customer.suffix,'') <> coalesce(v_person->>'suffix','')
      or v_customer.phone is distinct from v_person->>'phone'
      or lower(v_customer.email) is distinct from lower(v_person->>'email')
      or v_customer.birth_date is distinct from nullif(v_person->>'birthDate','')::date
    then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
  end if;
  return private.commit_customer_import_legacy_row(p_row_id,p_actor_id);
end $$;
revoke all on function public.commit_customer_import_row(uuid,uuid) from public, anon, authenticated;
grant execute on function public.commit_customer_import_row(uuid,uuid) to service_role;
