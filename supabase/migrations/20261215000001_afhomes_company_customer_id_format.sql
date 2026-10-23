-- AF Homes: switch the auto-generated Company Customer ID (RA No.) format from
-- `AF-CUS-YYYY-NNNNNN` to `YYYY-NNNN` (minimum 4 digits, expandable).
--
-- Rationale: the Customer ID (RA No.) is the company-facing identifier and the
-- user-approved external format is now `YYYY-NNNN`. The internal `customer_number`
-- (`AF-CUS-XXXXX`) is a separate allocator and is untouched.
--
-- Backward compatibility: rows already carrying the legacy `AF-CUS-YYYY-NNNNNN`
-- value are preserved verbatim and still maintain the per-year high-water mark,
-- so no number is ever reused. Imported values in either format are recognized.
--
-- Idempotent: safe to apply to a database of any provenance. Re-running changes
-- nothing.
--
-- Validation (after apply):
--   select * from private.company_customer_id_counters order by issue_year;
--   insert into public.customers(customer_number,first_name,last_name,email,phone,status)
--     values('SYNTHETIC-FMT','X','Y','fmt@example.invalid','09123456789','prospect')
--     returning ra_number;  -- expect '<current year>-0001' or next serial
--
-- Down note: revert the trigger body and counter CHECK to the 20261208000017
-- definitions; do not delete counter rows.

-- 1. Relax the counter's range check so serials can expand beyond 6 digits.
alter table private.company_customer_id_counters
  drop constraint if exists company_customer_id_counters_last_issued_check;
alter table private.company_customer_id_counters
  add constraint company_customer_id_counters_last_issued_check
  check (last_issued >= 0);

-- 2. Re-backfill the high-water mark from both legacy and new formats.
insert into private.company_customer_id_counters (issue_year, last_issued)
select yr, max(serial) from (
  select substring(btrim(ra_number) from 8 for 4)::integer as yr,
         right(btrim(ra_number), 6)::integer as serial
  from public.customers
  where upper(btrim(ra_number)) ~ '^AF-CUS-[0-9]{4}-[0-9]{6}$'
  union all
  select left(btrim(ra_number), 4)::integer as yr,
         regexp_replace(btrim(ra_number), '^[0-9]{4}-', '')::integer as serial
  from public.customers
  where btrim(ra_number) ~ '^[0-9]{4}-[0-9]{4,}$'
) t
group by yr
on conflict (issue_year) do update
  set last_issued = greatest(private.company_customer_id_counters.last_issued, excluded.last_issued);

-- 3. Replace the trigger: generate `YYYY-NNNN` (min 4 digits), recognize both
--    formats for high-water maintenance.
create or replace function private.assign_company_customer_id() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_year integer; v_serial integer;
begin
  if nullif(btrim(new.ra_number), '') is null and tg_op = 'INSERT' then
    v_year := extract(year from current_timestamp at time zone 'Asia/Manila')::integer;
    insert into private.company_customer_id_counters (issue_year, last_issued)
      values (v_year, 0) on conflict (issue_year) do nothing;
    update private.company_customer_id_counters
      set last_issued = last_issued + 1
      where issue_year = v_year and last_issued < 2147483647
      returning last_issued into v_serial;
    if not found then raise exception 'COMPANY_CUSTOMER_ID_RANGE_EXHAUSTED'; end if;
    new.ra_number := v_year::text || '-' || lpad(v_serial::text, 4, '0');
  elsif btrim(new.ra_number) ~ '^[0-9]{4}-[0-9]{4,}$' then
    v_year := left(btrim(new.ra_number), 4)::integer;
    v_serial := regexp_replace(btrim(new.ra_number), '^[0-9]{4}-', '')::integer;
    insert into private.company_customer_id_counters (issue_year, last_issued)
      values (v_year, v_serial)
      on conflict (issue_year) do update
        set last_issued = greatest(private.company_customer_id_counters.last_issued, excluded.last_issued);
  elsif upper(btrim(new.ra_number)) ~ '^AF-CUS-[0-9]{4}-[0-9]{6}$' then
    v_year := substring(btrim(new.ra_number) from 8 for 4)::integer;
    v_serial := right(btrim(new.ra_number), 6)::integer;
    insert into private.company_customer_id_counters (issue_year, last_issued)
      values (v_year, v_serial)
      on conflict (issue_year) do update
        set last_issued = greatest(private.company_customer_id_counters.last_issued, excluded.last_issued);
  end if;
  return new;
end $$;

revoke all on function private.assign_company_customer_id() from public, anon, authenticated, service_role;

-- Trigger already exists from 20261208000017; ensure it is (re)attached.
drop trigger if exists assign_company_customer_id on public.customers;
create trigger assign_company_customer_id
  before insert or update of ra_number on public.customers
  for each row execute function private.assign_company_customer_id();