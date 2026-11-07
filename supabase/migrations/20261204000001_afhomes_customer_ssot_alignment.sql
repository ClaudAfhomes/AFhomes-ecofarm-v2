-- AF Homes customer-record SSOT alignment.
--
-- The company's master list for customer records (Primary 24 / Supplementary
-- 22 / OST-IST 7 / VIP Package 9 columns) added two contact facts the record
-- did not store, and three supplementary facts existed but were unreachable
-- through the import pipeline (the guided template wrote them to legacy
-- keys). This migration:
--
-- 1. Adds `customers.landline` (primary) and `customers.supplementary_landline`.
-- 2. Re-delivers `register_customer_application_once`: a new customer created
--    from an application now carries the holder's SUFFIX, SEX (-> gender,
--    lowercased, all three SEX_OPTIONS values satisfy the existing gender
--    CHECK), LANDLINE, and BARANGGAY (into the address jsonb, next to the
--    already-copied line1/line2/city/province/postal code).
-- 3. Re-delivers `import_legacy_member`: the CREATE insert gains the two new
--    columns (landline from p_customer, supplementary_landline from the
--    company object).
-- 4. Re-delivers `commit_customer_import_row`:
--    - the address build gains line2 / barangay / postalCode (previously
--      accepted as headers and silently dropped);
--    - the UPDATE branch replaces the whole-address clobber with a PER-KEY
--      merge, so a city/province/barangay-only correction no longer needs
--      address_line_1 to be present, and blank parts never overwrite stored
--      values;
--    - the UPDATE branch gains landline and supplementary_landline with the
--      same preserve-when-blank rule as the other company columns.
--
-- Column-level grants unchanged: new columns carry no `authenticated` SELECT
-- grant (same least-privilege posture as the other company columns), so
-- supabase/security/rls_invariants.sql stays green.
--
-- forward-only, idempotent: add column if not exists; create or replace
-- functions. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='customers'
--      and column_name in ('landline','supplementary_landline');        -- 2
--   select proname, prosrc like '%supplementaryLandline%' from pg_proc
--    where proname in ('import_legacy_member','commit_customer_import_row');  -- both t
--   select prosrc like '%barangay%' from pg_proc
--    where proname='register_customer_application_once';                -- t
--   select prosrc like '%address->>''postalCode''%' from pg_proc
--    where proname='commit_customer_import_row';                        -- t
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): the columns are inert once no caller
-- writes them; the function bodies are superseded by any later re-delivery.
-- Never rewrite stored values.

-- ---------------------------------------------------------------------------
-- 1. Primary and supplementary landline contact columns. Verbatim storage:
--    no CHECK beyond the shared input validation in the API contracts.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists landline text,
  add column if not exists supplementary_landline text;

comment on column public.customers.landline is
  'Primary landline contact, verbatim. Independent of the mobile stored in phone.';
comment on column public.customers.supplementary_landline is
  'Supplementary holder landline, verbatim. Independent of supplementary_mobile.';

-- ---------------------------------------------------------------------------
-- 2. register_customer_application_once, re-delivered.
--
-- Body copied verbatim from 20261023000001 (the latest definition) with
-- EXACTLY four changes: the customers INSERT gains suffix, gender, landline,
-- and the address jsonb gains barangay. Signature, permissions and
-- idempotency wrappers are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.register_customer_application_once(p_request_id uuid,p_actor_id uuid,p_header jsonb,p_primary jsonb,p_secondary jsonb default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_payload jsonb; v_result uuid; v_customer uuid; v_number text;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','create');
  if p_header ? 'customerId' or p_header ? 'saleId' then raise exception 'INVALID_APPLICATION'; end if;
  v_payload:=jsonb_build_object('newRegistration',true,'header',jsonb_strip_nulls(p_header),'primary',jsonb_strip_nulls(p_primary),'secondary',jsonb_strip_nulls(p_secondary));
  v_result:=private.mutation_result(p_actor_id,'application.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  -- Email is a conflict signal, never an instruction to merge two identities.
  perform pg_advisory_xact_lock(hashtextextended(lower(p_primary->>'email'),23000002));
  if exists(select 1 from public.customers where lower(email)=lower(p_primary->>'email')) then raise exception 'CUSTOMER_EMAIL_CONFLICT'; end if;
  select customer_number into v_number from public.next_customer_number();
  insert into public.customers(customer_number,first_name,middle_name,last_name,suffix,birth_date,gender,email,phone,landline,address,status,created_by)
    values(v_number,p_primary->>'firstName',nullif(p_primary->>'middleName',''),p_primary->>'lastName',nullif(p_primary->>'suffix',''),(p_primary->>'birthDate')::date,
      lower(nullif(p_primary->>'sex','')),lower(p_primary->>'email'),p_primary->>'mobile',nullif(p_primary->>'landline',''),
      jsonb_build_object('line1',p_primary->>'permanentAddressLine1','line2',p_primary->>'permanentAddressLine2','city',p_primary->>'cityMunicipality','province',p_primary->>'province','barangay',p_primary->>'barangay','postalCode',p_primary->>'postalCode','countryCode','PH'),'prospect',p_actor_id) returning id into v_customer;
  v_result:=public.save_customer_application(null,p_actor_id,p_header||jsonb_build_object('customerId',v_customer),p_primary,p_secondary);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'CUSTOMER_APPLICATION_CREATED','customer_application',v_result::text,jsonb_build_object('status','draft','customerId',v_customer));
  perform private.complete_mutation(p_actor_id,'application.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

revoke all on function public.register_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.register_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. import_legacy_member, re-delivered.
--
-- Body copied verbatim from 20261130000001 (the latest definition) with
-- EXACTLY two changes: the customers INSERT gains `landline` (from
-- p_customer) and `supplementary_landline` (from the company object).
-- ---------------------------------------------------------------------------
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
  v_company jsonb;
begin
  if not exists (select 1 from public.staff_users where id = p_actor_id and status = 'active') then
    raise exception 'ACTOR_INACTIVE';
  end if;
  select * into v_job from public.customer_import_jobs where id = p_job_id;
  if not found then raise exception 'IMPORT_JOB_NOT_FOUND'; end if;
  if v_job.status not in ('ready', 'validated', 'committing') then raise exception 'IMPORT_JOB_NOT_COMMITTABLE'; end if;
  if p_plan_id is not null then
    select * into v_plan from public.card_plans where id = p_plan_id and is_active;
    if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  elsif p_require_member or jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 0 then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(19000002, 1);
  -- Membership-number shape carried forward from 20261021000001 (random
  -- allocator surgery): legacy 6-digit values AND 128-bit random codes are
  -- accepted; only legacy numerics participate in the legacy sequence. A
  -- later full-body replace must preserve both, not restore the narrow form.
  if nullif(p_membership->>'membershipNumber','') is not null and (p_membership->>'membershipNumber') !~ '^MBS-([0-9]{6}|[0-9A-F]{8}(-[0-9A-F]{8}){3})$' then raise exception 'IMPORT_BAD_MEMBERSHIP_NUMBER'; end if;
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

  v_company := coalesce(p_customer->'company', '{}'::jsonb);
  select customer_number into v_customer_number from public.next_customer_number();
  insert into public.customers (
    customer_number, email, phone, landline, first_name, middle_name, last_name, suffix,
    birth_date, gender, address, status, notes,
    registration_source, created_by,
    ra_number, company_status, citizenship, civil_status, tin_number,
    occupation_business_name, office_business_address, employed_position,
    supplementary_full_name, supplementary_address, supplementary_birthday,
    supplementary_gender, supplementary_citizenship, supplementary_civil_status,
    supplementary_tin_number, supplementary_mobile, supplementary_email,
    supplementary_landline,
    supplementary_occupation_business_name, supplementary_office_address,
    supplementary_position,
    ost_ist_name, svd_name, ssm_name, sm_name, referrer_name,
    vip_recommender_name, related_contact_no, related_email,
    stated_vip_package, stated_payment_terms, stated_regular_price,
    stated_discount, stated_total_amount, stated_rf, stated_payment_type,
    stated_ref_no, stated_payment_date
  ) values (
    v_customer_number, p_customer->>'email', p_customer->>'phone',
    nullif(p_customer->>'landline',''),
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
    'bulk_import', p_actor_id,
    nullif(v_company->>'raNumber',''), nullif(v_company->>'companyStatus',''),
    nullif(v_company->>'citizenship',''), nullif(v_company->>'civilStatus',''),
    nullif(v_company->>'tinNumber',''),
    nullif(v_company->>'occupationBusinessName',''),
    nullif(v_company->>'officeBusinessAddress',''),
    nullif(v_company->>'employedPosition',''),
    nullif(v_company->>'supplementaryFullName',''),
    nullif(v_company->>'supplementaryAddress',''),
    nullif(v_company->>'supplementaryBirthday','')::date,
    nullif(v_company->>'supplementaryGender',''),
    nullif(v_company->>'supplementaryCitizenship',''),
    nullif(v_company->>'supplementaryCivilStatus',''),
    nullif(v_company->>'supplementaryTinNumber',''),
    nullif(v_company->>'supplementaryMobile',''),
    nullif(v_company->>'supplementaryEmail',''),
    nullif(v_company->>'supplementaryLandline',''),
    nullif(v_company->>'supplementaryOccupationBusinessName',''),
    nullif(v_company->>'supplementaryOfficeAddress',''),
    nullif(v_company->>'supplementaryPosition',''),
    nullif(v_company->>'ostIstName',''), nullif(v_company->>'svdName',''),
    nullif(v_company->>'ssmName',''), nullif(v_company->>'smName',''),
    nullif(v_company->>'referrerName',''),
    nullif(v_company->>'vipRecommenderName',''),
    nullif(v_company->>'relatedContactNo',''),
    nullif(v_company->>'relatedEmail',''),
    nullif(v_company->>'statedVipPackage',''),
    nullif(v_company->>'statedPaymentTerms',''),
    nullif(v_company->>'statedRegularPrice',''),
    nullif(v_company->>'statedDiscount',''),
    nullif(v_company->>'statedTotalAmount',''),
    nullif(v_company->>'statedRf',''),
    nullif(v_company->>'statedPaymentType',''),
    nullif(v_company->>'statedRefNo',''),
    nullif(v_company->>'statedPaymentDate','')::date
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
        if v_membership_number ~ '^MBS-[0-9]{6}$' then perform setval('public.membership_number_seq', greatest((select last_value from public.membership_number_seq), substring(v_membership_number from 5)::bigint), true); end if;
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

-- ---------------------------------------------------------------------------
-- 4. commit_customer_import_row, re-delivered.
--
-- Body copied verbatim from 20261130000001 (the latest definition) with
-- EXACTLY these changes:
--   - v_address gains line2 / barangay / postalCode (blank -> null);
--   - the UPDATE address assignment becomes a per-key merge instead of the
--     replace-only-when-line1-present clobber;
--   - the UPDATE gains landline and supplementary_landline with the
--     preserve-when-blank rule shared by the other company columns.
-- ---------------------------------------------------------------------------
create or replace function public.commit_customer_import_row(p_row_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.customer_import_rows%rowtype;
  v_job public.customer_import_jobs%rowtype;
  v_customer public.customers%rowtype;
  v_member public.memberships%rowtype;
  v_n jsonb;
  v_person jsonb;
  v_company jsonb;
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
  v_company := coalesce(v_n->'company', '{}'::jsonb);
  -- CREATE address: line1/city/province/country keep their established
  -- placeholders so a blank sheet still yields a human record; the optional
  -- parts (line2, barangay, postalCode) stay null rather than placeholders.
  v_address := jsonb_build_object('line1', coalesce(nullif(v_row.raw_data->>'address_line_1',''), 'Imported address'),
    'line2', nullif(v_row.raw_data->>'address_line_2',''),
    'city', coalesce(nullif(v_row.raw_data->>'city',''), 'Imported'),
    'province', coalesce(nullif(v_row.raw_data->>'province',''), 'Imported'),
    'barangay', nullif(v_row.raw_data->>'barangay',''),
    'postalCode', nullif(v_row.raw_data->>'postal_code',''),
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
        'sellerStaffId', v_seller, 'historicalSaleTotal', v_n->>'historicalSaleTotal', 'paymentScheme',v_n->>'paymentScheme', 'historicalReservationFee',v_n->>'historicalReservationFee', 'historicalRequiredInitial',v_n->>'historicalRequiredInitial',
        'company', v_company), v_plan_id,
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
      phone = v_person->>'phone', landline = coalesce(nullif(v_person->>'landline',''), landline),
      birth_date = coalesce(nullif(v_person->>'birthDate','')::date, birth_date),
      gender = coalesce(nullif(v_person->>'gender',''), gender),
      -- Per-key merge: a supplied part replaces its key, a blank part keeps
      -- the stored value. A city/province/barangay-only correction no longer
      -- requires address_line_1, and an address_line_1 import can no longer
      -- wipe the other stored parts with placeholders.
      address = jsonb_build_object(
        'line1', coalesce(nullif(v_row.raw_data->>'address_line_1',''), address->>'line1'),
        'line2', coalesce(nullif(v_row.raw_data->>'address_line_2',''), address->>'line2'),
        'city', coalesce(nullif(v_row.raw_data->>'city',''), address->>'city'),
        'province', coalesce(nullif(v_row.raw_data->>'province',''), address->>'province'),
        'barangay', coalesce(nullif(v_row.raw_data->>'barangay',''), address->>'barangay'),
        'postalCode', coalesce(nullif(v_row.raw_data->>'postal_code',''), address->>'postalCode'),
        'countryCode', coalesce(nullif(v_row.raw_data->>'country',''), address->>'countryCode', 'PH')),
      notes = coalesce(nullif(v_row.raw_data->>'notes',''), notes),
      status = case when v_n->>'category' in ('SUSPENDED','CANCELLED') then v_n->>'customerStatus' else status end,
      ra_number = coalesce(nullif(v_company->>'raNumber',''), ra_number),
      company_status = coalesce(nullif(v_company->>'companyStatus',''), company_status),
      citizenship = coalesce(nullif(v_company->>'citizenship',''), citizenship),
      civil_status = coalesce(nullif(v_company->>'civilStatus',''), civil_status),
      tin_number = coalesce(nullif(v_company->>'tinNumber',''), tin_number),
      occupation_business_name = coalesce(nullif(v_company->>'occupationBusinessName',''), occupation_business_name),
      office_business_address = coalesce(nullif(v_company->>'officeBusinessAddress',''), office_business_address),
      employed_position = coalesce(nullif(v_company->>'employedPosition',''), employed_position),
      supplementary_full_name = coalesce(nullif(v_company->>'supplementaryFullName',''), supplementary_full_name),
      supplementary_address = coalesce(nullif(v_company->>'supplementaryAddress',''), supplementary_address),
      supplementary_birthday = coalesce(nullif(v_company->>'supplementaryBirthday','')::date, supplementary_birthday),
      supplementary_gender = coalesce(nullif(v_company->>'supplementaryGender',''), supplementary_gender),
      supplementary_citizenship = coalesce(nullif(v_company->>'supplementaryCitizenship',''), supplementary_citizenship),
      supplementary_civil_status = coalesce(nullif(v_company->>'supplementaryCivilStatus',''), supplementary_civil_status),
      supplementary_tin_number = coalesce(nullif(v_company->>'supplementaryTinNumber',''), supplementary_tin_number),
      supplementary_mobile = coalesce(nullif(v_company->>'supplementaryMobile',''), supplementary_mobile),
      supplementary_email = coalesce(nullif(v_company->>'supplementaryEmail',''), supplementary_email),
      supplementary_landline = coalesce(nullif(v_company->>'supplementaryLandline',''), supplementary_landline),
      supplementary_occupation_business_name = coalesce(nullif(v_company->>'supplementaryOccupationBusinessName',''), supplementary_occupation_business_name),
      supplementary_office_address = coalesce(nullif(v_company->>'supplementaryOfficeAddress',''), supplementary_office_address),
      supplementary_position = coalesce(nullif(v_company->>'supplementaryPosition',''), supplementary_position),
      ost_ist_name = coalesce(nullif(v_company->>'ostIstName',''), ost_ist_name),
      svd_name = coalesce(nullif(v_company->>'svdName',''), svd_name),
      ssm_name = coalesce(nullif(v_company->>'ssmName',''), ssm_name),
      sm_name = coalesce(nullif(v_company->>'smName',''), sm_name),
      referrer_name = coalesce(nullif(v_company->>'referrerName',''), referrer_name),
      vip_recommender_name = coalesce(nullif(v_company->>'vipRecommenderName',''), vip_recommender_name),
      related_contact_no = coalesce(nullif(v_company->>'relatedContactNo',''), related_contact_no),
      related_email = coalesce(nullif(v_company->>'relatedEmail',''), related_email),
      stated_vip_package = coalesce(nullif(v_company->>'statedVipPackage',''), stated_vip_package),
      stated_payment_terms = coalesce(nullif(v_company->>'statedPaymentTerms',''), stated_payment_terms),
      stated_regular_price = coalesce(nullif(v_company->>'statedRegularPrice',''), stated_regular_price),
      stated_discount = coalesce(nullif(v_company->>'statedDiscount',''), stated_discount),
      stated_total_amount = coalesce(nullif(v_company->>'statedTotalAmount',''), stated_total_amount),
      stated_rf = coalesce(nullif(v_company->>'statedRf',''), stated_rf),
      stated_payment_type = coalesce(nullif(v_company->>'statedPaymentType',''), stated_payment_type),
      stated_ref_no = coalesce(nullif(v_company->>'statedRefNo',''), stated_ref_no),
      stated_payment_date = coalesce(nullif(v_company->>'statedPaymentDate','')::date, stated_payment_date),
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
