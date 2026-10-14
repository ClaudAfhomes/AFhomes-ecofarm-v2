-- Forward-only annual customer numbering. Existing IDs and AF-CC codes are untouched.
-- Validate: SELECT * FROM private.official_id_counters;
-- SELECT customer_number,count(*) FROM public.customers GROUP BY 1 HAVING count(*)>1;
-- Run supabase/security/rls_invariants.sql (zero violations).
-- Down: retain issued IDs/counters; retire issuance through a reviewed forward fix.
-- Never reset counters or restore random-only readers after official issuance.
create table if not exists private.official_id_counters (
  domain text not null check (domain in ('customer','vip')),
  issuance_year integer not null check (issuance_year between 1000 and 9999),
  last_value integer not null check (last_value between 1 and 999999),
  primary key(domain,issuance_year),
  check (domain<>'vip' or last_value<=99999)
);
alter table private.official_id_counters enable row level security;
revoke all on private.official_id_counters from public,anon,authenticated,service_role;

create or replace function private.next_official_customer_number(p_date date) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare y integer:=extract(year from p_date); n integer; high_water integer:=0;
begin
  if p_date is null or y not between 1000 and 9999 then
    raise exception 'CUSTOMER_ISSUANCE_DATE_INVALID' using errcode='22023';
  end if;
  if not exists(select 1 from private.official_id_counters c where c.domain='customer' and c.issuance_year=y) then
    select coalesce(max(right(c.customer_number,6)::integer),0) into high_water
      from public.customers c where c.customer_number ~ ('^AF-CUS-'||y||'-(?!000000)[0-9]{6}$');
  end if;
  insert into private.official_id_counters as counter(domain,issuance_year,last_value)
    values('customer',y,high_water+1)
    on conflict(domain,issuance_year) do update
      set last_value=greatest(counter.last_value,high_water)+1
    returning last_value into n;
  return 'AF-CUS-'||y||'-'||lpad(n::text,6,'0');
exception when check_violation then
  raise exception 'CUSTOMER_SEQUENCE_EXHAUSTED' using errcode='55000';
end $$;
revoke all on function private.next_official_customer_number(date) from public,anon,authenticated,service_role;

create or replace function public.next_customer_number()
returns table(customer_number text) language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$
  select private.next_official_customer_number((now() at time zone 'Asia/Manila')::date);
$$;
revoke all on function public.next_customer_number() from public,anon,authenticated;
grant execute on function public.next_customer_number() to service_role;

create or replace function private.guard_official_customer_number() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if old.customer_number ~ '^AF-CUS-[1-9][0-9]{3}-(?!000000)[0-9]{6}$'
     and new.customer_number is distinct from old.customer_number then
    raise exception 'OFFICIAL_CUSTOMER_NUMBER_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.guard_official_customer_number() from public,anon,authenticated,service_role;
drop trigger if exists official_customer_number_immutable on public.customers;
create trigger official_customer_number_immutable before update of customer_number on public.customers
  for each row execute function private.guard_official_customer_number();

alter table private.mutation_requests drop constraint if exists mutation_requests_operation_check;
alter table private.mutation_requests add constraint mutation_requests_operation_check check (operation in (
  'payment.create','application.create','reservation.create','purchase_terms.review','application.submit',
  'application.decide','reservation.transition','payment.verify','reservation.finalize',
  'purchase.finalize','membership.activate','customer.create'));

create or replace function public.create_customer_once(p_request_id uuid,p_actor_id uuid,p_input jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare role text; result_id uuid; number text;
begin
  role:=private.mutation_actor_role(p_actor_id,'sales.customers','create');
  if role not in ('super_admin','admin','vice_director','senior_sales_manager','sales_manager','ost') then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;
  result_id:=private.mutation_result(p_actor_id,'customer.create',p_request_id,p_input);
  if result_id is not null then return result_id; end if;
  if jsonb_typeof(p_input)<>'object' or nullif(btrim(p_input->>'first_name'),'') is null
    or nullif(btrim(p_input->>'last_name'),'') is null or nullif(btrim(p_input->>'email'),'') is null then
    raise exception 'CUSTOMER_DETAILS_INVALID' using errcode='22023';
  end if;
  select cn.customer_number into strict number from public.next_customer_number() cn;
  insert into public.customers(customer_number,first_name,middle_name,last_name,suffix,birth_date,gender,email,
    phone,address,government_id_type,government_id_number,registration_source,created_by,referred_by_staff_id,
    referral_code_used,notes,status)
  values(number,p_input->>'first_name',p_input->>'middle_name',p_input->>'last_name',p_input->>'suffix',
    (p_input->>'birth_date')::date,p_input->>'gender',p_input->>'email',p_input->>'phone',p_input->'address',
    p_input->>'government_id_type',p_input->>'government_id_number','seller_created',p_actor_id,p_actor_id,
    p_input->>'referral_code_used',p_input->>'notes','prospect') returning id into result_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'CUSTOMER_CREATED','customer',result_id::text,
      jsonb_build_object('customerNumber',number,'email',p_input->>'email','createdBy',p_actor_id),p_request_id::text);
  perform private.complete_mutation(p_actor_id,'customer.create',p_request_id,p_input,result_id);
  return result_id;
end $$;
revoke all on function public.create_customer_once(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_customer_once(uuid,uuid,jsonb) to service_role;

-- Preserve official customer IDs if the separately gated legacy maintenance routine is called.
create or replace function private.upgrade_legacy_business_ids()
returns bigint
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_entity text;
  v_table_name text;
  v_column text;
  v_key text;
  v_prefix text;
  v_table regclass;
  v_old text;
  v_new text;
  v_id uuid;
  v_row record;
  v_left bigint := 0;
  v_converted bigint := 0;
begin
  -- entity_type, table, column, approved prefix. Fixed here in SQL, so no
  -- client-supplied relation or column is ever reachable.
  for v_entity, v_table_name, v_column, v_key, v_prefix in
    select * from (values
      ('customer',            'public.customers',                    'customer_number',    'id',             'AF-CUS'),
      ('card_sale',           'public.card_sales',                   'sale_number',        'id',             'AF-CSALE'),
      ('customer_application','public.customer_applications',         'application_number', 'id',             'AF-APP'),
      ('reservation_agreement','public.reservation_agreements',       'reservation_number', 'id',             'AF-RES'),
      ('ost_member',          'public.ost_members',                  'ost_number',        'id',             'AF-OST'),
      ('ost_accreditation',   'private.ost_registration_details',    'form_number',        'application_id', 'AF-ACC'),
      ('ost_renewal',         'private.ost_accreditation_renewals',  'renewal_number',     'id',             'AF-REN'),
      ('redemption',          'public.redemptions',                  'redemption_number',  'id',             'AF-RED')
    ) as t(entity_type, tbl, col, key_column, prefix)
  loop
    v_table := v_table_name::regclass;

    for v_row in execute format(
      'select t.%I as ent_key, t.%I as old_value from %s t where t.%I is not null and btrim(t.%I) <> '''' and t.%I !~ %L order by t.%I',
      v_key, v_column, v_table, v_column, v_column, v_column,
      case when v_prefix='AF-CUS' then '^AF-CUS-([A-HJ-NP-Z2-9]{5}|[1-9][0-9]{3}-(?!000000)[0-9]{6})$' else '^' || v_prefix || '-[A-HJ-NP-Z2-9]{5}$' end, v_key)
      loop
      v_id  := v_row.ent_key;
      v_old := v_row.old_value;

      -- The alias is recorded BEFORE the column is overwritten, so the legacy
      -- value is never lost even if the update itself fails.
      insert into private.business_id_aliases
        (entity_type, entity_id, old_identifier, migration_source)
      values (v_entity, v_id, v_old, '20261027000001')
      on conflict (entity_type, old_identifier) do nothing;

      v_new := private.claim_af_id(v_prefix, v_table, v_column);

      execute format('update %s set %I = $1 where %I = $2', v_table, v_column, v_key)
        using v_new, v_id;
      v_converted := v_converted + 1;

      -- The alias must exist for exactly this row, or the legacy value was lost.
      if not exists (
        select 1 from private.business_id_aliases a
         where a.entity_type = v_entity and a.entity_id = v_id and a.old_identifier = v_old
      ) then
        raise exception 'LEGACY_ID_ALIAS_MISSING: % % %', v_entity, v_id, v_old;
      end if;
    end loop;
  end loop;

  -- Fail loudly: no converted column may still hold a non-modern value.
  for v_table_name, v_column, v_prefix in
    select * from (values
      ('public.customers',                   'customer_number',    'AF-CUS'),
      ('public.card_sales',                  'sale_number',        'AF-CSALE'),
      ('public.customer_applications',        'application_number', 'AF-APP'),
      ('public.reservation_agreements',       'reservation_number', 'AF-RES'),
      ('public.ost_members',                  'ost_number',        'AF-OST'),
      ('private.ost_registration_details',    'form_number',        'AF-ACC'),
      ('private.ost_accreditation_renewals',  'renewal_number',     'AF-REN'),
      ('public.redemptions',                  'redemption_number',  'AF-RED')
    ) as t(tbl, col, prefix)
  loop
    v_table := v_table_name::regclass;
    execute format(
      'select count(*) from %s t where t.%I is not null and btrim(t.%I) <> '''' and t.%I !~ %L',
      v_table, v_column, v_column, v_column,
      case when v_prefix='AF-CUS' then '^AF-CUS-([A-HJ-NP-Z2-9]{5}|[1-9][0-9]{3}-(?!000000)[0-9]{6})$' else '^' || v_prefix || '-[A-HJ-NP-Z2-9]{5}$' end)
      into v_left;
    if v_left > 0 then
      raise exception 'LEGACY_ID_REMAINS: %.% still has % non-modern values', v_table, v_column, v_left;
    end if;
  end loop;
  return v_converted;
end $$;
