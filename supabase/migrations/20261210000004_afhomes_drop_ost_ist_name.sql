-- AF Homes: drop customers.ost_ist_name (company-stated OST/IST name removed).
--
-- The company-stated "OST/IST NAME" field is removed everywhere: the column
-- goes away, so no UI, contract or API may read or write it. Historical
-- migrations (20261130000001, 20261130000003, 20261204000001) keep the
-- column's creation for databases that recorded those versions; this migration
-- redefines the live functions that still insert into it and then drops the
-- column.
--
-- The `private.ost_ist_conversions` table is unrelated (OST <-> IST staff
-- role conversion audit) and is NOT touched.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--     where table_schema='public' and table_name='customers'
--       and column_name='ost_ist_name';  -- 0
--   select position('ost_ist_name' in prosrc) from pg_proc
--     where proname='import_legacy_member';  -- 0
--   select position('ost_ist_name' in prosrc) from pg_proc
--     where proname='commit_customer_import_legacy_row';  -- 0
--
-- Down: re-add the column (values lost) and restore the ost_ist_name branch of
-- public.import_legacy_member / private.commit_customer_import_legacy_row from
-- 20261204000001.

do $$
declare definition text;
begin
  if to_regprocedure('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)') is null then
    return;
  end if;
  select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure)
    into definition;
  -- Drop the column from the INSERT column list.
  definition := regexp_replace(definition, 'ost_ist_name\s*,\s*svd_name', 'svd_name', 'g');
  -- Drop the corresponding value.
  definition := regexp_replace(definition, 'nullif\(v_company->>''ostIstName''[^)]*\)\s*,\s*', '', 'g');
  if position('ost_ist_name' in definition) <> 0 or position('ostIstName' in definition) <> 0 then
    raise exception 'IMPORT_LEGACY_MEMBER_OST_IST_NAME_REMOVAL_FAILED';
  end if;
  execute definition;
end $$;

do $$
declare definition text;
begin
  if to_regprocedure('private.commit_customer_import_legacy_row(uuid,uuid)') is null then
    return;
  end if;
  select pg_get_functiondef('private.commit_customer_import_legacy_row(uuid,uuid)'::regprocedure)
    into definition;
  -- Drop the column assignment from the UPDATE SET list.
  definition := regexp_replace(definition, 'ost_ist_name\s*=\s*coalesce\s*\(\s*nullif\s*\(\s*v_company->>''ostIstName''[^)]*\)\s*,\s*ost_ist_name\s*\)\s*,', '', 'g');
  if position('ost_ist_name' in definition) <> 0 or position('ostIstName' in definition) <> 0 then
    raise exception 'COMMIT_CUSTOMER_IMPORT_LEGACY_ROW_OST_IST_NAME_REMOVAL_FAILED';
  end if;
  execute definition;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'ost_ist_name'
  ) then
    alter table public.customers drop column ost_ist_name;
  end if;
end $$;