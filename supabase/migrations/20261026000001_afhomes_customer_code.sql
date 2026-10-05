-- AF Homes customer code (AF-CC-XXXXXXXX) - a SEPARATE identifier from the
-- Customer ID (customers.customer_number, AF-CUS-XXXXX).
--
-- Customer ID is the company/staff business identifier and is NOT touched.
-- Customer Code is the stable customer-facing lookup/reference code. The two
-- are independently generated: the code is never derived from the ID, a UUID,
-- a phone, an email, a date of birth, a timestamp, a sequence or a row count.
--
-- The canonical generator is extended rather than duplicated: private.af_candidate
-- gains an 8-character suffix only for AF-CC (40 bits from gen_random_bytes(5),
-- eight independent 5-bit slices, so there is no modulo bias), and
-- private.claim_af_id gains one more PINNED (prefix, table, column) pair. For
-- every other prefix the generated value is byte-identical to 20261025000001.
--
-- Customer Code is NOT an auth secret and NOT a credential. It grants no login,
-- profile, payment, points, membership, reset or impersonation access. The QR
-- token, fallback code, membership number, referral code and onboarding tokens
-- are untouched and remain the only lookup credentials.
--
-- Validation after apply (expected):
--   select private.af_candidate('AF-CC');                 -- one AF-CC-XXXXXXXX row
--   select private.af_candidate('AF-CUS');                -- still AF-CUS-XXXXX (5 chars)
--   select private.af_candidate('NOPE');                  -- INVALID_BUSINESS_PREFIX
--   select private.claim_af_id('AF-CUS','public.customers'::regclass,'customer_code');
--                                                            -- INVALID_BUSINESS_ID_TARGET
--   select count(*) from public.customers where customer_code is null;             -- 0
--   select count(*) from (select customer_code from public.customers
--                         group by customer_code having count(*)>1) d;               -- 0
--   select count(*) from public.customers
--    where customer_code !~ '^AF-CC-[A-HJ-NP-Z2-9]{8}$';                           -- 0
--   select count(*) from public.customers where customer_number like 'AF-CC-%';     -- 0
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (forward-only; documentation, not a script): retire callers in a later
-- migration. Never rewrite an issued Customer ID or Customer Code.

-- ---------------------------------------------------------------------------
-- 1. Canonical generator, extended for AF-CC. For the 13 existing prefixes the
-- byte count, the slice order and the output are unchanged: 'AF-CC' reads 5
-- bytes and emits 8 characters, every other prefix reads 4 bytes and emits 5.
-- ---------------------------------------------------------------------------
create or replace function private.af_candidate(p_prefix text)
returns text
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea;
  v bigint := 0;
  chars integer;
  i integer;
  out text := '';
begin
  if p_prefix = 'AF-CC' then
    -- Customer Code: 40 bits of pgcrypto entropy, eight 5-bit slices.
    raw := gen_random_bytes(5);
    chars := 8;
  elsif p_prefix in (
    'AF-CUS','AF-SALES','AF-CSALE','AF-EMP','AF-APP','AF-RES','AF-OST',
    'AF-ACC','AF-REN','AF-PAY','AF-COM','AF-RED','AF-IMP'
  ) then
    raw := gen_random_bytes(4);
    chars := 5;
  else
    raise exception 'INVALID_BUSINESS_PREFIX';
  end if;
  for i in 0..(octet_length(raw) - 1) loop
    v := (v << 8) | get_byte(raw, i);
  end loop;
  for i in 0..(chars - 1) loop
    out := out || substr(alphabet, ((v >> (i * 5)) & 31)::integer + 1, 1);
  end loop;
  return p_prefix || '-' || out;
end $$;

comment on function private.af_candidate(text) is
  'AF-XXXXX business identifiers, plus the 8-character AF-CC Customer Code. Slice-based, so no modulo bias.';

-- ---------------------------------------------------------------------------
-- 2. One more PINNED claim target. Arbitrary table/column input stays refused,
-- so no caller can point the allocator at an arbitrary identifier.
-- ---------------------------------------------------------------------------
create or replace function private.claim_af_id(p_prefix text, p_table regclass, p_column text)
returns text
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  attempt integer;
  candidate text;
  taken boolean;
begin
  if not (
    (p_prefix = 'AF-CUS'   and p_table = 'public.customers'::regclass                  and p_column = 'customer_number') or
    (p_prefix = 'AF-CSALE' and p_table = 'public.card_sales'::regclass                  and p_column = 'sale_number') or
    (p_prefix = 'AF-APP'   and p_table = 'public.customer_applications'::regclass      and p_column = 'application_number') or
    (p_prefix = 'AF-RES'   and p_table = 'public.reservation_agreements'::regclass      and p_column = 'reservation_number') or
    (p_prefix = 'AF-OST'   and p_table = 'public.ost_members'::regclass                 and p_column = 'ost_number') or
    (p_prefix = 'AF-ACC'   and p_table = 'private.ost_registration_details'::regclass  and p_column = 'form_number') or
    (p_prefix = 'AF-REN'   and p_table = 'private.ost_accreditation_renewals'::regclass and p_column = 'renewal_number') or
    (p_prefix = 'AF-PAY'   and p_table = 'public.payments'::regclass                    and p_column = 'payment_number') or
    (p_prefix = 'AF-COM'   and p_table = 'public.commissions'::regclass                and p_column = 'commission_number') or
    (p_prefix = 'AF-RED'   and p_table = 'public.redemptions'::regclass                 and p_column = 'redemption_number') or
    (p_prefix = 'AF-IMP'   and p_table = 'public.customer_import_jobs'::regclass       and p_column = 'job_number') or
    (p_prefix = 'AF-IMP'   and p_table = 'private.ost_import_jobs'::regclass           and p_column = 'job_number') or
    (p_prefix = 'AF-EMP'   and p_table = 'public.staff_users'::regclass                and p_column = 'employee_number') or
    (p_prefix = 'AF-SALES' and p_table = 'public.staff_users'::regclass                and p_column = 'sales_number') or
    (p_prefix = 'AF-CC'    and p_table = 'public.customers'::regclass                  and p_column = 'customer_code')
  ) then
    raise exception 'INVALID_BUSINESS_ID_TARGET';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_prefix, 23000002));
  for attempt in 1..64 loop
    candidate := private.af_candidate(p_prefix);
    execute format('select exists(select 1 from %s where %I = $1)', p_table, p_column)
      into taken using candidate;
    if not taken then
      return candidate;
    end if;
  end loop;
  raise exception 'BUSINESS_ID_ALLOCATION_FAILED' using errcode = '55000';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Schema, in the required order: add nullable, backfill, VERIFY, then
-- UNIQUE, then NOT NULL, then the insert-time DEFAULT. No existing
-- customer_number or credential value is read or written by any step below.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists customer_code text;

do $$
declare r record;
begin
  for r in select id from public.customers where customer_code is null loop
    update public.customers
      set customer_code = private.claim_af_id('AF-CC', 'public.customers'::regclass, 'customer_code')
      where id = r.id;
  end loop;
end $$;

-- Fail loudly rather than add a NOT NULL column with holes in it.
do $$
declare v_nulls integer; v_dupes integer; v_malformed integer;
begin
  select count(*) into v_nulls from public.customers where customer_code is null;
  select count(*) into v_dupes from (
    select customer_code from public.customers group by customer_code having count(*) > 1
  ) d;
  select count(*) into v_malformed from public.customers
    where customer_code !~ '^AF-CC-[A-HJ-NP-Z2-9]{8}$';
  if v_nulls > 0 then
    raise exception 'CUSTOMER_CODE_BACKFILL_INCOMPLETE:nulls=%', v_nulls;
  end if;
  if v_dupes > 0 then
    raise exception 'CUSTOMER_CODE_BACKFILL_DUPLICATED:rows=%', v_dupes;
  end if;
  if v_malformed > 0 then
    raise exception 'CUSTOMER_CODE_BACKFILL_MALFORMED:rows=%', v_malformed;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_customer_code_unique') then
    alter table public.customers add constraint customers_customer_code_unique unique (customer_code);
  end if;
end $$;

alter table public.customers alter column customer_code set not null;

-- Every creation path (handler insert, register_customer_application_once,
-- import_legacy_member, and anything else) inherits this DEFAULT, so a customer
-- cannot be created without a Customer Code.
alter table public.customers
  alter column customer_code set default
    (private.claim_af_id('AF-CC', 'public.customers'::regclass, 'customer_code'));

comment on column public.customers.customer_code is
  'Customer Code (AF-CC-XXXXXXXX): the stable customer-facing lookup/reference code. Separate from customer_number (the Customer ID). An identifier only - it authorizes nothing, and it is never derived from the ID, a UUID or any personal data.';

-- ---------------------------------------------------------------------------
-- 4. Authorized search resolves the Customer Code as well. Both functions stay
-- service-role only and revoked from anon/authenticated, so this widens what an
-- ALREADY-authorized staff lookup can match; it grants no new access and adds no
-- browser-reachable surface. Matching is case-insensitive; the stored value is
-- canonical uppercase. Fail-loud guard: an unknown definition is not silently
-- left without search support.
-- ---------------------------------------------------------------------------
do $$
declare
  item record;
  definition text;
begin
  -- $q$ literals, so the matched SQL text is written verbatim: no quote
  -- doubling, and a pattern can never be silently mistruncated by escaping.
  for item in
    select * from (values
      ('public.search_customer_ids(text)',
       $q$ or lower(c.customer_number) like '%' || lower(p_search) || '%'$q$,
       $q$ or lower(c.customer_number) like '%' || lower(p_search) || '%'
          or lower(c.customer_code) like '%' || lower(p_search) || '%'$q$,
       'search_customer_ids'),
      ('public.customer_directory(jsonb)',
       $q$lower(d.customer_number) like '%'||lower(p_filters->>'search')||'%' or lower(d.email)$q$,
       $q$lower(d.customer_number) like '%'||lower(p_filters->>'search')||'%'
          or lower(d.customer_code) like '%'||lower(p_filters->>'search')||'%'
          or lower(d.email)$q$,
       'customer_directory')
    ) as t(sig, old_expr, new_expr, tag)
  loop
    select pg_get_functiondef(item.sig::regprocedure) into definition;
    if strpos(definition, item.new_expr) > 0 then continue; end if;
    if strpos(definition, item.old_expr) = 0 then
      raise exception 'CUSTOMER_CODE_SEARCH_MISMATCH:%', item.tag;
    end if;
    definition := replace(definition, item.old_expr, item.new_expr);
    execute definition;
  end loop;
end $$;