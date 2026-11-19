-- AF Homes company-wide public business IDs (AF-*).
--
-- Forward-only. Replaces predictable sequential/date-derived human-facing
-- identifiers with cryptographically random AF Homes business IDs for NEW
-- records. Internal UUID primary keys are unchanged. Historical rows keep
-- their existing numbers byte-identical.
--
-- Canonical generator: private.af_candidate(prefix) + private.claim_af_id().
-- Existing allocator names and RETURNS TABLE shapes are preserved, so handler
-- call sites (next_customer_number / next_sale_number / next_redemption_number
-- / next_ost_number) need no change. Old sequences are kept, not dropped:
-- legacy functions/history may reference them and rollback stays possible.
--
-- Card-sale transactions use AF-CSALE (AF-SALES is the sales PERSON).
-- Membership QR tokens, fallback codes, referral codes, onboarding tokens and
-- idempotency keys are security credentials and are NOT touched.
--
-- Validation after apply (expected):
--   select private.af_candidate('AF-CUS');              -- one AF-CUS-XXXXX row
--   select private.af_candidate('BOGUS');               -- INVALID_BUSINESS_PREFIX
--   select * from public.next_customer_number();        -- one AF-CUS-XXXXX row
--   select * from public.next_sale_number();            -- one AF-CSALE-XXXXX row
--   select * from public.next_redemption_number();      -- one AF-RED-XXXXX row
--   select * from public.next_ost_number();            -- one AF-OST-XXXXX row
--   select count(*) from public.payments where payment_number is null;        -- 0
--   select count(*) from public.commissions where commission_number is null;  -- 0
--   select count(*) from public.customer_import_jobs where job_number is null;-- 0
--   select count(*) from public.staff_users where employee_number is null;   -- 0
--   select count(distinct payment_number) = count(*) from public.payments;    -- true
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (forward-only; documentation, not a script): retire callers in a later
-- migration and re-point the four next_* functions at the old sequences.
-- Never rewrite issued AF-* values or historical rows.

-- ---------------------------------------------------------------------------
-- 1. Canonical candidate generator. 5 chars from the 32-symbol readable
-- alphabet (no I/O/0/1): 32^5 = 33,554,432 suffixes per prefix. 25 bits are
-- sliced straight out of 4 pgcrypto bytes, so there is no mod bias.
-- Source-of-truth alphabet is mirrored in packages/contracts business-ids.ts;
-- the business-ids spec asserts both strings are identical.
-- ---------------------------------------------------------------------------
create or replace function private.af_candidate(p_prefix text)
returns text
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea := gen_random_bytes(4);
  v bigint := 0;
  i integer;
  out text := '';
begin
  if p_prefix not in (
    'AF-CUS','AF-SALES','AF-CSALE','AF-EMP','AF-APP','AF-RES','AF-OST',
    'AF-ACC','AF-REN','AF-PAY','AF-COM','AF-RED','AF-IMP'
  ) then
    raise exception 'INVALID_BUSINESS_PREFIX';
  end if;
  for i in 0..3 loop
    v := (v << 8) | get_byte(raw, i);
  end loop;
  for i in 0..4 loop
    out := out || substr(alphabet, ((v >> (i * 5)) & 31)::integer + 1, 1);
  end loop;
  return p_prefix || '-' || out;
end $$;

revoke all on function private.af_candidate(text) from public, anon, authenticated;
grant execute on function private.af_candidate(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Claiming allocator. Serializes per prefix with an advisory transaction
-- lock, checks the target UNIQUE column, retries 64 times. The UNIQUE
-- constraint on every target column remains the final backstop: a collision
-- never overwrites another record.
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
    (p_prefix = 'AF-SALES' and p_table = 'public.staff_users'::regclass                and p_column = 'sales_number')
  ) then
    raise exception 'INVALID_BUSINESS_ID_TARGET';
  end if;
  -- ponytail: one lock per prefix (not per row); allocation is create-only traffic.
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

revoke all on function private.claim_af_id(text, regclass, text) from public, anon, authenticated;
grant execute on function private.claim_af_id(text, regclass, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Existing allocators keep their names and RETURNS TABLE shapes; only the
-- format changes. CREATE OR REPLACE preserves owner, grants and the Phase 17
-- search_path; the ALTERs below re-assert the path explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.next_customer_number()
returns table (customer_number text)
language sql
volatile
as $$
  select private.claim_af_id('AF-CUS', 'public.customers'::regclass, 'customer_number')
$$;

create or replace function public.next_sale_number()
returns table (sale_number text)
language sql
volatile
as $$
  select private.claim_af_id('AF-CSALE', 'public.card_sales'::regclass, 'sale_number')
$$;

create or replace function public.next_redemption_number()
returns table (redemption_number text)
language sql
volatile
as $$
  select private.claim_af_id('AF-RED', 'public.redemptions'::regclass, 'redemption_number')
$$;

create or replace function public.next_ost_number()
returns table (ost_number text)
language sql
volatile
as $$
  select private.claim_af_id('AF-OST', 'public.ost_members'::regclass, 'ost_number')
$$;

alter function public.next_customer_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_sale_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_redemption_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_ost_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;

comment on function public.next_customer_number() is
  'AF-CUS-XXXXX for new customers. Historical CUS-000000 rows are unchanged.';
comment on function public.next_sale_number() is
  'AF-CSALE-XXXXX for new card-sale transactions (AF-SALES is the sales person). Historical SALE-000000 rows are unchanged.';
comment on function public.next_redemption_number() is
  'AF-RED-XXXXX for new redemptions. Historical RDM-000000 rows are unchanged.';
comment on function public.next_ost_number() is
  'AF-OST-XXXXX for new OST members. Referral codes are separate credentials.';

-- ---------------------------------------------------------------------------
-- 4. Date-derived inline allocators (application / reservation / accreditation
-- form / renewal) move to the claiming allocator. Targeted string surgery on
-- the stored definitions, with mismatch guards: if the expected legacy
-- expression is absent and no claim call is present, the definition is unknown
-- and the migration fails closed instead of silently keeping the old format.
-- ---------------------------------------------------------------------------
do $$
declare
  item record;
  definition text;
begin
  for item in
    select * from (values
      ('public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb)',
       '''APP-'' || to_char(current_date,''YYYYMMDD'') || ''-'' || upper(substr(replace(v_id::text,''-'',''''),1,8))',
       '(select private.claim_af_id(''AF-APP'',''public.customer_applications''::regclass,''application_number''))',
       'APP'),
      ('public.save_reservation_agreement(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
       '''RES-''||to_char(current_date,''YYYYMMDD'')||''-''||upper(substr(replace(v_id::text,''-'',''''),1,8))',
       '(select private.claim_af_id(''AF-RES'',''public.reservation_agreements''::regclass,''reservation_number''))',
       'RES'),
      ('public.submit_ost_accreditation(uuid,uuid,uuid,uuid,jsonb,jsonb,text)',
       '''AF-''||upper(replace(v_id::text,''-'',''''))',
       '(select private.claim_af_id(''AF-ACC'',''private.ost_registration_details''::regclass,''form_number''))',
       'ACC'),
      ('public.submit_ost_renewal(uuid,uuid,uuid,jsonb)',
       '''REN-''||upper(replace(v_id::text,''-'',''''))',
       '(select private.claim_af_id(''AF-REN'',''private.ost_accreditation_renewals''::regclass,''renewal_number''))',
       'REN')
    ) as t(sig, old_expr, new_expr, tag)
  loop
    select pg_get_functiondef(item.sig::regprocedure) into definition;
    if strpos(definition, item.new_expr) > 0 then continue; end if;
    if strpos(definition, item.old_expr) = 0 then
      raise exception 'BUSINESS_ID_DEFINITION_MISMATCH:%', item.tag;
    end if;
    definition := replace(definition, item.old_expr, item.new_expr);
    execute definition;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Entities with no previous business ID get a new UNIQUE column with a
-- claiming DEFAULT, then every historical row is backfilled (a backfill is
-- NOT a rewrite: no business ID existed before). Backfill loops row by row so
-- each claim observes the rows already assigned in this transaction.
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists payment_number text
  default (private.claim_af_id('AF-PAY', 'public.payments'::regclass, 'payment_number'));
alter table public.commissions
  add column if not exists commission_number text
  default (private.claim_af_id('AF-COM', 'public.commissions'::regclass, 'commission_number'));
alter table public.customer_import_jobs
  add column if not exists job_number text
  default (private.claim_af_id('AF-IMP', 'public.customer_import_jobs'::regclass, 'job_number'));
alter table private.ost_import_jobs
  add column if not exists job_number text
  default (private.claim_af_id('AF-IMP', 'private.ost_import_jobs'::regclass, 'job_number'));

do $$
declare r record;
begin
  for r in select id from public.payments where payment_number is null loop
    update public.payments
      set payment_number = private.claim_af_id('AF-PAY', 'public.payments'::regclass, 'payment_number')
      where id = r.id;
  end loop;
  for r in select id from public.commissions where commission_number is null loop
    update public.commissions
      set commission_number = private.claim_af_id('AF-COM', 'public.commissions'::regclass, 'commission_number')
      where id = r.id;
  end loop;
  for r in select id from public.customer_import_jobs where job_number is null loop
    update public.customer_import_jobs
      set job_number = private.claim_af_id('AF-IMP', 'public.customer_import_jobs'::regclass, 'job_number')
      where id = r.id;
  end loop;
  for r in select id from private.ost_import_jobs where job_number is null loop
    update private.ost_import_jobs
      set job_number = private.claim_af_id('AF-IMP', 'private.ost_import_jobs'::regclass, 'job_number')
      where id = r.id;
  end loop;
end $$;

alter table public.payments alter column payment_number set not null;
alter table public.commissions alter column commission_number set not null;
alter table public.customer_import_jobs alter column job_number set not null;
alter table private.ost_import_jobs alter column job_number set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_payment_number_unique') then
    alter table public.payments add constraint payments_payment_number_unique unique (payment_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commissions_commission_number_unique') then
    alter table public.commissions add constraint commissions_commission_number_unique unique (commission_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_import_jobs_job_number_unique') then
    alter table public.customer_import_jobs add constraint customer_import_jobs_job_number_unique unique (job_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ost_import_jobs_job_number_unique') then
    alter table private.ost_import_jobs add constraint ost_import_jobs_job_number_unique unique (job_number);
  end if;
end $$;

comment on column public.payments.payment_number is
  'System payment ID (AF-PAY-XXXXX). The external bank/GCash/OR reference stays in payments.reference.';
comment on column public.commissions.commission_number is
  'Public commission ID (AF-COM-XXXXX). Sale linkage stays on commissions.sale_id.';
comment on column public.customer_import_jobs.job_number is 'Public import job ID (AF-IMP-XXXXX).';

-- ---------------------------------------------------------------------------
-- 6. Staff identity. One stable employee number per person (AF-EMP, assigned
-- once, never changes on role change) plus one sales-person number (AF-SALES,
-- assigned when the person first holds VD/SSM/SM, retained if they leave
-- sales so historical attributions stay stable). No duplicate identity: both
-- live on the canonical staff_users row. OST sellers keep AF-OST.
-- ---------------------------------------------------------------------------
alter table public.staff_users
  add column if not exists employee_number text
  default (private.claim_af_id('AF-EMP', 'public.staff_users'::regclass, 'employee_number'));
alter table public.staff_users
  add column if not exists sales_number text;

do $$
declare r record;
begin
  for r in select id from public.staff_users where employee_number is null loop
    update public.staff_users
      set employee_number = private.claim_af_id('AF-EMP', 'public.staff_users'::regclass, 'employee_number')
      where id = r.id;
  end loop;
  for r in select s.id from public.staff_users s
    join public.staff_role_assignments a on a.staff_id = s.id
    join public.roles ro on ro.id = a.role_id
    where s.sales_number is null
      and ro.slug in ('vice_director', 'senior_sales_manager', 'sales_manager') loop
    update public.staff_users
      set sales_number = private.claim_af_id('AF-SALES', 'public.staff_users'::regclass, 'sales_number')
      where id = r.id;
  end loop;
end $$;

alter table public.staff_users alter column employee_number set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_users_employee_number_unique') then
    alter table public.staff_users add constraint staff_users_employee_number_unique unique (employee_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_users_sales_number_unique') then
    alter table public.staff_users add constraint staff_users_sales_number_unique unique (sales_number);
  end if;
end $$;

create or replace function private.assign_staff_sales_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_slug text;
begin
  select ro.slug into v_slug from public.roles ro where ro.id = new.role_id;
  if v_slug in ('vice_director', 'senior_sales_manager', 'sales_manager') then
    update public.staff_users
      set sales_number = coalesce(
        sales_number,
        private.claim_af_id('AF-SALES', 'public.staff_users'::regclass, 'sales_number')
      )
      where id = new.staff_id and sales_number is null;
  end if;
  return new;
end $$;

revoke all on function private.assign_staff_sales_number() from public, anon, authenticated;

drop trigger if exists staff_role_assignment_sales_number on public.staff_role_assignments;
create trigger staff_role_assignment_sales_number
  after insert or update of role_id on public.staff_role_assignments
  for each row execute function private.assign_staff_sales_number();

comment on column public.staff_users.employee_number is
  'Stable company employee number (AF-EMP-XXXXX). Never changes on role change.';
comment on column public.staff_users.sales_number is
  'Sales-person business ID (AF-SALES-XXXXX), assigned on first VD/SSM/SM role. Null for never-sales staff.';
