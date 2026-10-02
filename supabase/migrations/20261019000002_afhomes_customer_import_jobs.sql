-- AF Homes bulk customer import (jobs + legacy member import).
--
-- Forward-only migration. Creates the import job header/detail model, the
-- Admin-only permission vocabulary, and the per-row legacy import RPC. It
-- never modifies an applied migration and never touches migration #19.
--
-- WHY A LEGACY SALE IS REQUIRED (Part 10 STOP answered):
-- public.memberships.sale_id is NOT NULL (and UNIQUE per sale/customer), so a
-- migrated ACTIVE VIP cannot exist without a card sale. The cleanest honest
-- representation is a legacy card sale whose historical total is supplied explicitly and frozen, whose full-payment
-- requirement is checked against actual dated/method-qualified payment rows, and whose lineage is recorded on the
-- import row (customer_id, membership_id, sale_id). No commission row is
-- created for legacy sales: fabricating seller payouts for migrated history
-- would invent money. An ACTIVE VIP demand without payment history is refused
-- (CONFLICT) rather than faked.
--
-- Validation after apply:
--   select count(*) from public.customer_import_jobs;        -- 0 rows
--   select count(*) from public.customer_import_rows;        -- 0 rows
--   select key from public.modules where key = 'governance.customer_import';
--   select proname from pg_proc where proname = 'import_legacy_member';
-- Down: forward-only. Disable rules/jobs with a later migration; never rewrite
-- imported customers, sales, memberships or ledger rows.

-- ---------------------------------------------------------------------------
-- 1. Import job header/detail (TRANSACTION HEADER / TRANSACTION DETAIL)
-- ---------------------------------------------------------------------------

create table if not exists public.customer_import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('excel', 'csv', 'google_sheets')),
  source_name text not null,
  google_sheet_id text,
  status text not null default 'uploaded' check (status in (
    'uploaded', 'parsing', 'validated', 'ready', 'committing',
    'completed', 'completed_with_errors', 'failed', 'cancelled'
  )),
  total_rows integer not null default 0 check (total_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  inserted_rows integer not null default 0 check (inserted_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  committed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  failed_rows integer not null default 0 check (failed_rows >= 0),
  check ((status <> 'validated' and status <> 'ready') or validated_at is not null),
  check ((status <> 'completed' and status <> 'completed_with_errors') or committed_at is not null),
  check (status not in ('completed','completed_with_errors') or (total_rows=valid_rows+invalid_rows and total_rows=inserted_rows+updated_rows+skipped_rows+failed_rows and invalid_rows=failed_rows)),
  check (status<>'completed' or failed_rows=0),
  check (status<>'completed_with_errors' or failed_rows>0)
);

create table if not exists public.customer_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.customer_import_jobs(id) on delete restrict,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_data) = 'object'),
  normalized_data jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_data) = 'object'),
  validation_status text not null default 'pending' check (validation_status in ('pending', 'valid', 'warning', 'error')),
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  validation_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_warnings) = 'array'),
  action text not null default 'SKIP' check (action in ('CREATE', 'UPDATE', 'SKIP', 'CONFLICT')),
  customer_id uuid references public.customers(id) on delete restrict,
  membership_id uuid references public.memberships(id) on delete restrict,
  sale_id uuid references public.card_sales(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(import_job_id, row_number)
);

create index if not exists customer_import_rows_job_idx
  on public.customer_import_rows(import_job_id, row_number);
create index if not exists customer_import_jobs_status_idx
  on public.customer_import_jobs(status, created_at desc);

alter table public.customer_import_rows add column if not exists committed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Permission vocabulary: Admin-only bulk import (no new system needed)
-- ---------------------------------------------------------------------------
-- The module does not exist until this migration, so no role holds it and
-- every bulk-import endpoint fails closed. The Admin role receives an explicit
-- grant (view/create/update, never delete); super_admin is implicit everywhere.

insert into public.modules (key, name, group_name, sort_order)
values ('governance.customer_import', 'Customer Import', 'Governance', 70)
on conflict (key) do update set name = excluded.name;

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, true, true, false
from public.roles r cross join public.modules m
where r.slug = 'admin' and m.key = 'governance.customer_import'
on conflict (role_id, module_id) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

-- ---------------------------------------------------------------------------
-- 3. Row-level security: SELECT-only browser grants, handler-owned writes
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array['customer_import_jobs', 'customer_import_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'drop policy if exists %I on public.%I', t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.has_permission(%L))',
      t || '_read', t, 'governance.customer_import'
    );
  end loop;
end $$;

-- Legacy provenance is explicit; existing operational rows keep their origin.
alter table public.card_sales add column if not exists origin text not null default 'normal' check(origin in ('normal','legacy_import'));
alter table public.card_sales add column if not exists import_job_id uuid references public.customer_import_jobs(id) on delete restrict;
alter table public.card_sales add column if not exists import_row_id uuid references public.customer_import_rows(id) on delete restrict;
create index if not exists card_sales_origin_idx on public.card_sales(origin,created_at);
-- Unknown historical seller is legal ONLY on explicitly marked imports.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.card_sales'::regclass and contype='c' and pg_get_constraintdef(oid) like '%seller_staff_id IS NOT NULL%' and pg_get_constraintdef(oid) like '%seller_ost_id%' loop
 execute format('alter table public.card_sales drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.card_sales drop constraint if exists card_sales_origin_seller_check;
alter table public.card_sales add constraint card_sales_origin_seller_check check (
 (origin='legacy_import' and ((seller_type='staff' and seller_ost_id is null) or (seller_type='ost' and seller_ost_id is not null and seller_staff_id is null))) or
 (origin='normal' and ((seller_type='staff' and seller_staff_id is not null and seller_ost_id is null) or (seller_type='ost' and seller_ost_id is not null and seller_staff_id is null))));
-- Freeze no current genealogy for historical imports. Normal trigger unchanged.
do $$ declare d text; begin
 select pg_get_functiondef('private.capture_card_sale_hierarchy()'::regprocedure) into d;
 if position('new.origin' in d)=0 then
 d:=replace(d,E'begin\n',E'begin\n  if new.origin = ''legacy_import'' then return new; end if;\n');
 execute d;
 end if;
end $$;
-- Every operational allocator shares the import lock; sequence values never go backwards.
create or replace function private.next_membership_number() returns text language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare n text; begin
 perform pg_advisory_xact_lock(19000002,1);
 loop
 n:='MBS-'||to_char(nextval('public.membership_number_seq'),'FM000000');
 if n !~ '^MBS-[0-9]{6}$' then raise exception 'MEMBERSHIP_NUMBER_EXHAUSTED'; end if;
 exit when not exists(select 1 from public.memberships m where m.membership_number=n);
 end loop; return n;
end $$;
revoke all on function private.next_membership_number() from public,anon,authenticated;
grant execute on function private.next_membership_number() to service_role;
do $$ declare d text; begin
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='activate_card_sale';
 d:=replace(d,'''MBS-'' || to_char(nextval(''public.membership_number_seq''), ''FM000000'')','private.next_membership_number()');
 execute d;
end $$;
create or replace function public.match_import_emails(p_emails text[]) returns table(id uuid,email text) language sql stable set search_path=public,pg_temp as $$
 select c.id,c.email from public.customers c where lower(c.email)=any(select lower(trim(e)) from unnest(p_emails) e);
$$;
revoke all on function public.match_import_emails(text[]) from public,anon,authenticated;
grant execute on function public.match_import_emails(text[]) to service_role;
-- Only documented lifecycle edges. A committing job may be resumed.
create or replace function private.validate_import_job_lifecycle() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='UPDATE' and new.status<>old.status and not (
 (old.status in ('uploaded','parsing') and new.status in ('parsing','validated','ready','failed','cancelled')) or
 (old.status in ('validated','ready') and new.status in ('committing','cancelled','failed')) or
 (old.status='committing' and new.status in ('completed','completed_with_errors','failed'))
 ) then raise exception 'IMPORT_JOB_TRANSITION_INVALID'; end if;
 if new.status='failed' then new.failed_at:=coalesce(new.failed_at,now()); end if;
 if new.status='cancelled' then new.cancelled_at:=coalesce(new.cancelled_at,now()); end if;
 return new;
end $$;
revoke all on function private.validate_import_job_lifecycle() from public,anon,authenticated;
drop trigger if exists customer_import_job_lifecycle on public.customer_import_jobs;
create trigger customer_import_job_lifecycle before insert or update on public.customer_import_jobs for each row execute function private.validate_import_job_lifecycle();

-- ---------------------------------------------------------------------------
-- 4. Legacy member import RPC: one row, one transaction, no invented money
-- ---------------------------------------------------------------------------
--
-- p_customer: { firstName, lastName, middleName, suffix, birthDate, gender,
--   email, phone, address{line1,line2,city,province,postalCode,countryCode},
--   customerStatus, notes, secondaryNote }
-- p_plan_id: resolved active plan for the normalized tier (handler-side).
-- p_payments: [{ amount, date, method, reference }] - historical verified
--   rows ONLY. Empty unless the normalized category carries money.
-- p_membership: { membershipNumber|null, activationDate|null, expiresAt|null,
--   openingBalance int, memberStatus } - memberStatus is the target membership
--   status for ACTIVE VIP imports ('active').
-- p_require_member: when true the row MUST end with an active membership;
--   without payment history that covers the total, the call refuses instead
--   of inventing economics.

create or replace function public.import_legacy_member(
  p_job_id uuid,
  p_actor_id uuid,
  p_customer jsonb,
  p_plan_id uuid,
  p_payments jsonb default '[]'::jsonb,
  p_membership jsonb default null,
  p_require_member boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.customer_import_jobs%rowtype;
  v_plan public.card_plans%rowtype;
  v_customer_id uuid;
  v_customer_number text;
  v_sale_id uuid;
  v_sale_number text;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_item jsonb;
  v_payment_id uuid;
  v_membership_id uuid;
  v_membership_number text;
  v_fallback text;
  v_qr text;
  v_account_id uuid;
  v_allocated integer := 0;
  v_opening bigint := 0;
  v_expires timestamptz;
  v_price numeric;
  v_scheme text;
  v_reservation numeric;
  v_initial numeric;
begin
  if not exists (select 1 from public.staff_users where id = p_actor_id and status = 'active') then
    raise exception 'ACTOR_INACTIVE';
  end if;
  select * into v_job from public.customer_import_jobs where id = p_job_id;
  if not found then raise exception 'IMPORT_JOB_NOT_FOUND'; end if;
  if v_job.status not in ('ready', 'validated', 'committing') then
    raise exception 'IMPORT_JOB_NOT_COMMITTABLE';
  end if;
  if p_plan_id is not null then
    select * into v_plan from public.card_plans where id = p_plan_id and is_active;
    if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  elsif p_require_member or jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 0 then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(19000002, 1);
  if nullif(p_membership->>'membershipNumber','') is not null and (p_membership->>'membershipNumber') !~ '^MBS-[0-9]{6}$' then raise exception 'IMPORT_BAD_MEMBERSHIP_NUMBER'; end if;
  if nullif(p_customer->>'historicalSaleTotal','') is not null and (p_customer->>'historicalSaleTotal') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'IMPORT_BAD_HISTORICAL_TOTAL'; end if;
  v_price := nullif(p_customer->>'historicalSaleTotal','')::numeric;
  if p_require_member and (v_price is null or v_price <= 0) then raise exception 'IMPORT_HISTORICAL_TOTAL_REQUIRED'; end if;
  v_price := coalesce(v_price,v_plan.cash_price::numeric);
  if jsonb_array_length(coalesce(p_payments,'[]'::jsonb))>0 and nullif(p_customer->>'paymentScheme','') is null then raise exception 'IMPORT_PAYMENT_SCHEME_REQUIRED'; end if;
  v_scheme := coalesce(nullif(p_customer->>'paymentScheme',''),'spot_cash');
  if v_scheme not in ('spot_cash','move_a','installment_4_month','move_b1_40_12','move_b2_25_12') then raise exception 'IMPORT_BAD_PAYMENT_SCHEME'; end if;
  if nullif(p_customer->>'historicalReservationFee','') is not null and (p_customer->>'historicalReservationFee') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'IMPORT_BAD_RESERVATION'; end if;
  if nullif(p_customer->>'historicalRequiredInitial','') is not null and (p_customer->>'historicalRequiredInitial') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'IMPORT_BAD_REQUIRED_INITIAL'; end if;
  if jsonb_array_length(coalesce(p_payments,'[]'::jsonb))>0 and v_scheme<>'spot_cash' and (nullif(p_customer->>'historicalReservationFee','') is null or nullif(p_customer->>'historicalRequiredInitial','') is null) then raise exception 'IMPORT_SCHEME_SNAPSHOTS_REQUIRED'; end if;
  v_reservation := coalesce(nullif(p_customer->>'historicalReservationFee','')::numeric,0);
  v_initial := coalesce(nullif(p_customer->>'historicalRequiredInitial','')::numeric,0);
  if p_membership is not null and nullif(p_membership->>'membershipNumber','') is not null then
    if exists (select 1 from public.memberships where membership_number = p_membership->>'membershipNumber') then
      raise exception 'IMPORT_DUPLICATE_MEMBERSHIP';
    end if;
  end if;
  if exists (select 1 from public.customers where lower(email) = lower(p_customer->>'email')) then
    raise exception 'IMPORT_DUPLICATE_EMAIL';
  end if;

  select customer_number into v_customer_number from public.next_customer_number();
  insert into public.customers (
    customer_number, email, phone, first_name, middle_name, last_name, suffix,
    birth_date, gender, address, status, notes,
    registration_source, created_by
  ) values (
    v_customer_number, p_customer->>'email', p_customer->>'phone',
    p_customer->>'firstName', nullif(p_customer->>'middleName',''),
    p_customer->>'lastName', nullif(p_customer->>'suffix',''),
    nullif(p_customer->>'birthDate','')::date,
    nullif(p_customer->>'gender',''),
    coalesce(p_customer->'address', '{"countryCode":"PH"}'::jsonb),
    coalesce(nullif(p_customer->>'customerStatus',''), 'prospect'),
    nullif(
      trim(coalesce(p_customer->>'notes','') ||
        case when nullif(p_customer->>'secondaryNote','') is not null
          then chr(10) || 'Secondary cardholder: ' || (p_customer->>'secondaryNote') else '' end),
      ''
    ),
    'bulk_import', p_actor_id
  ) returning id into v_customer_id;

  -- Historical payment facts reconcile against the supplied frozen total.
  for v_item in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce(v_item->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (v_item->>'amount')::numeric <= 0 or nullif(v_item->>'date','') is null or nullif(v_item->>'method','') is null then
      raise exception 'IMPORT_BAD_PAYMENT';
    end if;
    if (v_item->>'date')::timestamptz > now() then raise exception 'IMPORT_BAD_PAYMENT_DATE'; end if;
    v_total := v_total + (v_item->>'amount')::numeric;
  end loop;

  if p_require_member or v_total > 0 then
    if p_require_member and v_total = 0 then
      raise exception 'IMPORT_NOT_FULLY_PAID';
    end if;
    select sale_number into v_sale_number from public.next_sale_number();
    insert into public.card_sales (
      sale_number, customer_id, plan_id, seller_type, seller_staff_id,
      cash_price, cash_price_snapshot, minimum_down_payment_snapshot,
      yearly_points_snapshot, payment_scheme, reservation_fee_snapshot,
      required_initial_snapshot, validity_months_snapshot,
      commission_rate_snapshot, expected_commission_snapshot,
      status, submitted_at, balance_due_at, created_by, origin, import_job_id
    ) values (
      v_sale_number, v_customer_id, v_plan.id, 'staff',
      nullif(p_customer->>'sellerStaffId','')::uuid,
      private.money(v_price), private.money(v_price), private.money(v_initial),
      v_plan.yearly_points, v_scheme, private.money(v_reservation),
      private.money(v_initial), v_plan.validity_years * 12,
      '0', '0.00',
      'submitted', now(), now() + interval '365 days', p_actor_id, 'legacy_import', p_job_id
    ) returning id into v_sale_id;

    for v_item in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
      insert into public.payments (
        sale_id, customer_id, amount, method, reference, payment_type,
        status, recorded_by, verified_by, recorded_at, verified_at, notes
      ) values (
        v_sale_id, v_customer_id, private.money((v_item->>'amount')::numeric),
        v_item->>'method',
        nullif(v_item->>'reference',''), 'full',
        'verified', p_actor_id, p_actor_id,
        (v_item->>'date')::timestamptz, now(),
        'Legacy import'
      ) returning id into v_payment_id;
      v_paid := v_paid + (v_item->>'amount')::numeric;
    end loop;

    if p_require_member then
      if v_paid <> v_price then
        raise exception 'IMPORT_NOT_FULLY_PAID';
      end if;
      update public.card_sales
      set status = 'payment_verified', payment_verified_at = now(), updated_at = now()
      where id = v_sale_id;

      if p_membership is not null and nullif(p_membership->>'membershipNumber','') is not null then
        v_membership_number := p_membership->>'membershipNumber';
        perform setval('public.membership_number_seq', greatest((select last_value from public.membership_number_seq), substring(v_membership_number from 5)::bigint), true);
      else
        v_membership_number := private.next_membership_number();
      end if;
      v_fallback := private.new_fallback_code();
      v_qr := private.new_qr_token();
      v_allocated := coalesce(v_plan.yearly_points, 0);
      v_opening := coalesce(nullif(p_membership->>'openingBalance','')::bigint, 0);
      if v_opening < 0 then raise exception 'IMPORT_BAD_OPENING_BALANCE'; end if;
      v_expires := coalesce(
        nullif(p_membership->>'expiresAt','')::timestamptz,
        coalesce(nullif(p_membership->>'activationDate','')::timestamptz, now())
          + make_interval(years => v_plan.validity_years)
      );
      insert into public.memberships (
        customer_id, sale_id, membership_number, product_id,
        fallback_code_hash, qr_token_hash, status, points_balance,
        yearly_points_allocated, sale_status_at_activation,
        activated_by, activated_at, expires_at, renewal_due_at, issued_at
      ) values (
        v_customer_id, v_sale_id, v_membership_number, v_plan.id,
        private.hash_token(v_fallback), private.hash_token(v_qr),
        coalesce(nullif(p_membership->>'memberStatus',''), 'active'), v_opening,
        v_allocated, 'payment_verified',
        p_actor_id,
        coalesce(nullif(p_membership->>'activationDate','')::timestamptz, now()),
        v_expires, v_expires, now()
      ) returning id into v_membership_id;

      -- An imported balance is existing history, not a new annual award.
      -- Zero is a real balance; never replace it with the plan allocation.
      insert into public.points_accounts (membership_id, balance, lifetime_allocated)
      values (v_membership_id, v_opening, v_opening)
      returning id into v_account_id;
      if v_opening > 0 then
        insert into public.points_ledger (
          account_id, entry_type, amount, balance_after,
          reference_type, reference_id, actor_id, reason
        ) values (
          v_account_id, 'adjustment', v_opening, v_opening,
          'customer_import', p_job_id::text, p_actor_id, 'Imported opening balance'
        );
      end if;

      update public.card_sales
      set status = 'active', activated_at = now(), updated_at = now() where id = v_sale_id;
      update public.customers
      set status = coalesce(nullif(p_customer->>'customerStatus',''), 'active'), updated_at = now() where id = v_customer_id;
    elsif v_paid > 0 then
      update public.card_sales
      set status = 'payment_pending', updated_at = now() where id = v_sale_id;
      update public.customers
      set status = coalesce(nullif(p_customer->>'customerStatus',''), 'active'), updated_at = now() where id = v_customer_id;
    end if;
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_id, 'CUSTOMER_IMPORTED', 'customer_import_row', p_job_id::text,
    jsonb_build_object('customerId', v_customer_id, 'saleId', v_sale_id, 'membershipId', v_membership_id)
  );

  return jsonb_build_object(
    'customerId', v_customer_id,
    'saleId', v_sale_id,
    'membershipId', v_membership_id,
    'membershipNumber', v_membership_number
  );
end $$;

revoke all on function public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean) to service_role;

-- Atomic source-row commit: locks the source and writes the normal graph,
-- referral, source linkage and audit in one transaction. Retries return the
-- linked identities. UPDATE preserves financial history and existing tier.
create or replace function public.commit_customer_import_row(p_row_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.customer_import_rows%rowtype;
  v_job public.customer_import_jobs%rowtype;
  v_customer public.customers%rowtype;
  v_member public.memberships%rowtype;
  v_n jsonb;
  v_person jsonb;
  v_plan_id uuid;
  v_out jsonb;
  v_address jsonb;
  v_sponsor uuid;
  v_seller uuid;
  v_code text;
  v_seller_code text;
  v_target text;
  v_tier text;
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
    return jsonb_build_object('customerId', v_row.customer_id, 'membershipId', v_row.membership_id, 'saleId', v_row.sale_id);
  end if;
  if v_job.status not in ('ready', 'validated', 'committing') then raise exception 'IMPORT_JOB_NOT_COMMITTABLE'; end if;
  if v_row.validation_status not in ('valid', 'warning') or v_row.action not in ('CREATE', 'UPDATE') then
    raise exception 'IMPORT_ROW_INVALID';
  end if;
  v_n := v_row.normalized_data;
  if nullif(v_row.raw_data->>'membership_number','') is not null and exists(select 1 from public.memberships m where m.membership_number=v_row.raw_data->>'membership_number' and m.customer_id is distinct from v_row.customer_id) then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
  if nullif(v_row.raw_data->>'customer_number','') is not null and exists(select 1 from public.customers c where c.customer_number=v_row.raw_data->>'customer_number' and c.id is distinct from v_row.customer_id) then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
  if v_row.action='UPDATE' and exists(select 1 from public.customers c where lower(c.email)=lower(v_n->'person'->>'email') and c.id<>v_row.customer_id) then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
  v_person := v_n->'person';
  v_address := jsonb_build_object('line1', coalesce(nullif(v_row.raw_data->>'address_line_1',''), 'Imported address'),
    'city', coalesce(nullif(v_row.raw_data->>'city',''), 'Imported'),
    'province', coalesce(nullif(v_row.raw_data->>'province',''), 'Imported'),
    'countryCode', coalesce(nullif(v_row.raw_data->>'country',''), 'PH'));
  if nullif(v_n->>'tier','') is not null then
    select id into v_plan_id from public.card_plans where code = v_n->>'tier' and is_active;
    if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  end if;
  v_code := upper(trim(coalesce(nullif(v_row.raw_data->>'referral_code',''), v_row.raw_data->>'seller_code', '')));
  if v_code <> '' then
    select rc.sponsor_staff_id into v_sponsor from public.referral_codes rc
    join public.staff_users su on su.id = rc.sponsor_staff_id and su.status = 'active'
    where rc.code_hash = private.hash_token(v_code) and rc.is_active
      and rc.expires_at > now() and rc.use_count < rc.max_uses;
    if not found then raise exception 'IMPORT_REFERRAL_INVALID'; end if;
  end if;
  v_seller_code := upper(trim(coalesce(v_row.raw_data->>'seller_code', '')));
  if v_seller_code <> '' then
    select rc.sponsor_staff_id into v_seller from public.referral_codes rc
    join public.staff_users su on su.id = rc.sponsor_staff_id and su.status = 'active'
    where rc.code_hash = private.hash_token(v_seller_code) and rc.is_active
      and rc.expires_at > now() and rc.use_count < rc.max_uses;
    if not found then raise exception 'IMPORT_REFERRAL_INVALID'; end if;
  end if;
  if v_row.action = 'CREATE' then
    v_out := public.import_legacy_member(v_row.import_job_id, p_actor_id,
      v_person || jsonb_build_object('address', v_address, 'customerStatus', v_n->>'customerStatus',
        'notes', v_row.raw_data->>'notes', 'secondaryNote', v_n->>'secondaryNote',
        'sellerStaffId', v_seller, 'historicalSaleTotal', v_n->>'historicalSaleTotal', 'paymentScheme',v_n->>'paymentScheme', 'historicalReservationFee',v_n->>'historicalReservationFee', 'historicalRequiredInitial',v_n->>'historicalRequiredInitial'), v_plan_id,
      case when v_n->'payment' is null or v_n->'payment' = 'null'::jsonb then '[]'::jsonb else jsonb_build_array(v_n->'payment') end,
      case when (v_n->>'requireMember')::boolean then jsonb_build_object('membershipNumber', v_n->'membershipNumber',
        'activationDate', v_n->'activationDate', 'expiresAt', v_n->'expiresAt',
        'openingBalance', v_n->'openingBalance', 'memberStatus', v_n->>'memberStatus') else null end,
      (v_n->>'requireMember')::boolean);
    if v_sponsor is not null then
      update public.customers set referred_by_staff_id = v_sponsor, referral_code_used = v_code
      where id = (v_out->>'customerId')::uuid;
    end if;
  else
    select * into v_customer from public.customers where id = v_row.customer_id for update;
    if not found then raise exception 'IMPORT_UPDATE_WITHOUT_CUSTOMER'; end if;
    select * into v_member from public.memberships where customer_id=v_customer.id for update;
    if v_row.membership_id is not null and (v_member.id is null or v_member.id <> v_row.membership_id) then raise exception 'IMPORT_IDENTIFIER_CONFLICT'; end if;
    if v_member.id is not null then
      select * into v_member from public.memberships where id = v_row.membership_id and customer_id = v_customer.id for update;
      if not found then raise exception 'IMPORT_STATUS_CONFLICT'; end if;
      select cp.code into v_tier from public.card_sales cs join public.card_plans cp on cp.id = cs.plan_id where cs.id = v_member.sale_id;
      if nullif(v_n->>'tier','') is not null and v_tier <> v_n->>'tier' then raise exception 'IMPORT_TIER_CONFLICT'; end if;
      if v_n->>'category' = 'ACTIVE_VIP' and v_member.status <> 'active' then raise exception 'IMPORT_REACTIVATION_CONFLICT:existing=%,requested=active', v_member.status; end if;
      v_target := case v_n->>'category' when 'SUSPENDED' then 'suspended' when 'EXPIRED' then 'expired' when 'CANCELLED' then 'cancelled' else v_member.status end;
      if v_member.status <> v_target and v_member.status <> 'active' then raise exception 'IMPORT_STATUS_CONFLICT'; end if;
      update public.memberships set status = v_target where id = v_member.id;
    elsif (v_n->>'requireMember')::boolean then
      raise exception 'IMPORT_EXISTING_CUSTOMER_NEEDS_MEMBERSHIP';
    end if;
    update public.customers set
      first_name = v_person->>'firstName', last_name = v_person->>'lastName',
      middle_name = nullif(v_person->>'middleName',''), suffix = nullif(v_person->>'suffix',''),
      phone = v_person->>'phone', birth_date = coalesce(nullif(v_person->>'birthDate','')::date, birth_date),
      gender = coalesce(nullif(v_person->>'gender',''), gender),
      address = case when nullif(v_row.raw_data->>'address_line_1','') is not null then v_address else address end,
      notes = coalesce(nullif(v_row.raw_data->>'notes',''), notes),
      status = case when v_n->>'category' in ('SUSPENDED','CANCELLED') then v_n->>'customerStatus' else status end,
      updated_at = now() where id = v_customer.id;
    v_out := jsonb_build_object('customerId', v_customer.id, 'membershipId', v_member.id, 'saleId', v_member.sale_id);
  end if;
  update public.card_sales set import_row_id=p_row_id where id=(v_out->>'saleId')::uuid and origin='legacy_import';
  update public.customer_import_rows set customer_id = (v_out->>'customerId')::uuid,
    membership_id = (v_out->>'membershipId')::uuid, sale_id = (v_out->>'saleId')::uuid, committed_at = now()
    where id = p_row_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data)
  values(p_actor_id, 'CUSTOMER_IMPORT_ROW_COMMITTED', 'customer_import_row', p_row_id::text,
    v_out || jsonb_build_object('importJobId', v_row.import_job_id, 'sourceType', v_job.source_type));
  return v_out;
end $$;
revoke all on function public.commit_customer_import_row(uuid,uuid) from public, anon, authenticated;
grant execute on function public.commit_customer_import_row(uuid,uuid) to service_role;

-- Shared customer search covers every normal member regardless of source.
create or replace function public.search_customer_ids(p_search text)
returns table(customer_id uuid) language sql stable set search_path = public, pg_temp as $$
  select c.id from public.customers c
  left join public.memberships m on m.customer_id = c.id
  left join public.card_plans cp on cp.id = m.product_id
  where lower(concat_ws(' ', c.first_name, c.middle_name, c.last_name, c.suffix)) like '%' || lower(p_search) || '%'
    or lower(c.customer_number) like '%' || lower(p_search) || '%'
    or lower(c.email) like '%' || lower(p_search) || '%'
    or c.phone like '%' || p_search || '%'
    or lower(m.membership_number) like '%' || lower(regexp_replace(p_search, '^AFHOMES:', '', 'i')) || '%'
    or lower(cp.code) = lower(p_search)
    or m.fallback_code_hash = private.hash_token(upper(regexp_replace(p_search, '[-[:space:]]', '', 'g')));
$$;
revoke all on function public.search_customer_ids(text) from public, anon, authenticated;
grant execute on function public.search_customer_ids(text) to service_role;

-- Shared normal-record directory: filters/sorts precede the final page limit.
create or replace function public.customer_directory(p_filters jsonb default '{}'::jsonb)
returns table(record jsonb,total_count bigint) language sql stable set search_path=public,pg_temp as $$
 with base as (
 select c.*,concat_ws(' ',c.first_name,c.middle_name,c.last_name,c.suffix) as full_name,
 m.id as membership_id,m.membership_number,m.status as member_status,m.activated_at,m.expires_at,
 cp.code as tier,coalesce(pa.balance,0) as available_points,coalesce(cs.seller_staff_id,cs.seller_ost_id) as seller_id,su.full_name as seller_name,
 coalesce(pay.paid,0) as verified_paid,coalesce(cs.cash_price_snapshot::numeric,0) as frozen_total,
 cs.reservation_fee_snapshot::numeric as reservation_fee,cs.required_initial_snapshot::numeric as required_initial,
 m.fallback_code_hash,m.qr_token_hash
 from public.customers c left join public.memberships m on m.customer_id=c.id
 left join public.points_accounts pa on pa.membership_id=m.id
 left join lateral(select s.* from public.card_sales s where s.customer_id=c.id and s.status<>'cancelled' order by s.created_at desc,s.id limit 1) cs on true
 left join public.card_plans cp on cp.id=coalesce(m.product_id,cs.plan_id)
 left join public.staff_users su on su.id=coalesce(cs.seller_staff_id,cs.seller_ost_id)
 left join lateral(select sum(p.amount::numeric) as paid from public.payments p where p.sale_id=cs.id and p.status='verified') pay on true
 ), categorized as (
 select b.*,case
 when b.status='cancelled' or b.member_status='cancelled' then 'CANCELLED'
 when b.status='suspended' or b.member_status='suspended' then 'SUSPENDED'
 when b.member_status='expired' or (b.member_status='active' and b.expires_at<=now()) then 'EXPIRED'
 when b.member_status='active' then 'ACTIVE_VIP'
 when b.verified_paid=0 then case when b.status='prospect' then 'PENDING' else 'ACTIVE' end
 when b.verified_paid>=b.frozen_total then 'FULLY_PAID_AWAITING_ACTIVATION'
 when b.required_initial>b.reservation_fee and b.verified_paid>=b.required_initial then 'DOWN_PAYMENT_COMPLETED'
 when b.reservation_fee>0 and b.verified_paid>=b.reservation_fee then 'RESERVATION_PAID'
 else 'PARTIALLY_PAID' end as derived_category,
 case when b.verified_paid=0 then 'no_payment' when b.verified_paid>=b.frozen_total then 'fully_paid' else 'partially_paid' end as payment_status
 from base b
 ), filtered as (
 select d.* from categorized d where
 (coalesce(p_filters->>'category','')='' or d.derived_category=p_filters->>'category') and
 (coalesce(p_filters->>'status','')='' or d.status=p_filters->>'status') and
 (coalesce(p_filters->>'tier','')='' or d.tier=p_filters->>'tier') and
 (coalesce(p_filters->>'seller','')='' or d.seller_id=(p_filters->>'seller')::uuid) and
 (coalesce(p_filters->>'from','')='' or d.created_at>=(p_filters->>'from')::date) and
 (coalesce(p_filters->>'to','')='' or d.created_at<(p_filters->>'to')::date+interval '1 day') and
 (not coalesce((p_filters->>'membersOnly')::boolean,false) or d.membership_id is not null) and
 (coalesce(p_filters->>'search','')='' or lower(d.full_name) like '%'||lower(p_filters->>'search')||'%' or
 lower(d.customer_number) like '%'||lower(p_filters->>'search')||'%' or lower(d.email) like '%'||lower(p_filters->>'search')||'%' or
 lower(d.membership_number) like '%'||lower(regexp_replace(p_filters->>'search','^AFHOMES:','','i'))||'%' or
 d.fallback_code_hash=private.hash_token(p_filters->>'identifier') or d.qr_token_hash=private.hash_token(p_filters->>'search'))
 )
 select (to_jsonb(f)-'government_id_number'-'fallback_code_hash'-'qr_token_hash')||jsonb_build_object('available_points',f.available_points::text,'verified_paid',private.money(f.verified_paid),'government_id_masked',case when f.government_id_number is null then null when length(trim(f.government_id_number))<=4 then repeat('*',length(trim(f.government_id_number))) else repeat('*',greatest(length(trim(f.government_id_number))-4,3))||right(trim(f.government_id_number),4) end,'derivedCategory',f.derived_category,'memberships',case when f.membership_id is null then null else jsonb_build_object('id',f.membership_id,'status',f.member_status) end), count(*) over()
 from filtered f
 order by
 case when p_filters->>'sort'='name' then lower(f.full_name) end,
 case when p_filters->>'sort'='tier' then f.tier end,
 case when p_filters->>'sort'='category' then f.derived_category end,
 case when p_filters->>'sort'='payment_status' then f.payment_status end,
 case when p_filters->>'sort'='membership_status' then f.member_status end,
 case when p_filters->>'sort'='verified_paid' then f.verified_paid end desc,
 f.created_at desc,f.id
 limit least(greatest(coalesce((p_filters->>'limit')::integer,50),1),5000)
 offset greatest(coalesce((p_filters->>'offset')::integer,0),0);
$$;
revoke all on function public.customer_directory(jsonb) from public,anon,authenticated;
grant execute on function public.customer_directory(jsonb) to service_role;
