-- Every application write path reaches the customer record.
--
-- Validation queries (run in this order after applying):
--   1. select count(*) from pg_proc
--       where proname = 'mirror_application_onto_customer'
--         and pronamespace = 'private'::regnamespace;                       -- 1
--   2. select prosrc from pg_proc
--       where proname = 'save_customer_application';                        -- contains
--                                                    mirror_application_onto_customer
--   3. select private.backfill_application_onto_customer();                 -- 0 on a
--                                                                           re-run
--   4. select count(*) from public.customer_applications a
--       join public.customers c on c.id = a.customer_id
--       where a.ra_number is not null and c.ra_number is null;              -- 0
--
-- Down: revert save_customer_application to its 20261131000002 body and drop
-- private.mirror_application_onto_customer + the backfill. The copied columns
-- stay on the customer row; they are company-stated and were always read from
-- there, so dropping the function removes no data.
--
-- WHY. An operator filled in every field of /admin/customers/new and the
-- Company record tab of /admin/customers/:id read "Not Recorded" for almost all
-- of it. The copy from the application onto the customer existed in exactly one
-- place - register_customer_application_once, and even that migration had never
-- been applied. So:
--
--   * an application created for an ALREADY-EXISTING customer
--     (create_customer_application_once) never wrote to `customers` at all;
--   * every later DRAFT EDIT went through save_customer_application, which
--     touched only `customer_applications` and its holders, so a correction
--     could never propagate either;
--   * rows written before the mirror existed were never backfilled.
--
-- The fix is deliberately one call site rather than three. BOTH wrappers
-- (register and create-for-existing) already funnel through
-- save_customer_application, so mirroring there covers registration, an
-- application for an existing customer, and every subsequent edit with a
-- single change. register_customer_application_once keeps its own inline copy
-- from 20261209000001: the two are identical and coalesce-only, so the second
-- pass is a no-op rather than a conflict, and leaving it means this migration
-- does not have to re-deliver that function as well.

/* ------------------------------------------------------------------ */
/* 0. Refuse to guess the target.                                      */
/*                                                                     */
/* This file is the ~200th migration and assumes Phase 1 through        */
/* 20261209000001 already ran. Applying it alone to a database without  */
/* the chain fails with a bare `3F000: schema "private" does not        */
/* exist`, which reads like a bug in this file rather than a wrong      */
/* target. Say so explicitly instead.                                   */
/* ------------------------------------------------------------------ */
do $$
begin
  if to_regnamespace('private') is null then
    raise exception
      'AFHOMES_MIGRATIONS_NOT_APPLIED: schema "private" is missing, so no AFHomes migration has run on this database. Apply the full ordered set with `pnpm db:migrate`, not this file alone.';
  end if;
end $$;

/* ------------------------------------------------------------------ */
/* 1. The mirror, lifted out of the register function.                 */
/* ------------------------------------------------------------------ */
create or replace function private.mirror_application_onto_customer(
  p_customer_id uuid,
  p_header jsonb,
  p_primary jsonb,
  p_secondary jsonb
) returns void language plpgsql security definer
  set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if p_customer_id is null then
    return;
  end if;

  -- THE MIRROR. Company-stated, verbatim, coalesce-only, and nothing else.
  --
  -- The rule, stated exactly so it is not over-claimed: the BUILDER WINS
  -- whenever it supplies a value, and a field the operator left blank never
  -- blanks what is already on the customer. So a correction typed on the form
  -- always reaches the record, and clearing a field on the form does not erase
  -- a corrected value. (An earlier draft of this file's comment claimed a hand
  -- correction was "never overwritten"; that is true only of the blank case,
  -- and section 78 now asserts the real rule rather than the stronger claim.)
  --
  -- NULL `p_secondary` yields NULL here, which coalesce resolves to the
  -- existing value - the correct no-op for a primary-only card.
  --
  -- The referral chain uses the same rule: the ORGANIZATION-resolved snapshot
  -- already on the row wins, and the typed name is only the fallback, so a staff
  -- linkage is never overwritten by free text.
  -- -------------------------------------------------------------------------
  update public.customers c
     set citizenship = coalesce(nullif(p_primary->>'citizenship',''), c.citizenship),
         civil_status = coalesce(nullif(p_primary->>'civilStatus',''), c.civil_status),
         tin_number = coalesce(nullif(p_primary->>'tinNumber',''), c.tin_number),
         occupation_business_name = coalesce(nullif(p_primary->>'occupationBusinessName',''), c.occupation_business_name),
         office_business_address = coalesce(nullif(p_primary->>'officeBusinessAddress',''), c.office_business_address),
         employed_position = coalesce(nullif(p_primary->>'employedPosition',''), c.employed_position),
         -- COMPANY-STATED package/payment block, matching the company master
         -- list's column names one for one. Verbatim and explicitly NOT
         -- server-authoritative: nothing is ever computed FROM these columns.
         ra_number = coalesce(nullif(p_header->>'raNumber',''), c.ra_number),
         company_status = coalesce(nullif(p_header->>'companyStatus',''), c.company_status),
         stated_vip_package = coalesce(nullif(p_header->>'statedVipPackage',''), c.stated_vip_package),
         stated_payment_terms = coalesce(nullif(p_header->>'statedPaymentTerms',''), c.stated_payment_terms),
         stated_regular_price = coalesce(nullif(p_header->>'statedRegularPrice',''), c.stated_regular_price),
         stated_discount = coalesce(nullif(p_header->>'statedDiscount',''), c.stated_discount),
         stated_total_amount = coalesce(nullif(p_header->>'statedTotalAmount',''), c.stated_total_amount),
         stated_rf = coalesce(nullif(p_header->>'statedRf',''), c.stated_rf),
         stated_payment_type = coalesce(nullif(p_header->>'statedPaymentType',''), c.stated_payment_type),
         stated_ref_no = coalesce(nullif(p_header->>'statedRefNo',''), c.stated_ref_no),
         stated_payment_date = coalesce((p_header->>'statedPaymentDate')::date, c.stated_payment_date),
         svd_name = coalesce(nullif(p_header->>'svdName',''), c.svd_name),
         ssm_name = coalesce(nullif(p_header->>'ssmName',''), c.ssm_name),
         sm_name = coalesce(nullif(p_header->>'salesManagerName',''), c.sm_name),
         referrer_name = coalesce(nullif(p_header->>'vipReferrer',''), c.referrer_name),
         vip_recommender_name = coalesce(nullif(p_header->>'vipRecommenderName',''), c.vip_recommender_name),
         related_contact_no = coalesce(nullif(p_header->>'recommenderContact',''), c.related_contact_no),
         related_email = coalesce(nullif(p_header->>'recommenderEmail',''), c.related_email),
         supplementary_full_name = coalesce(nullif(trim(concat_ws(' ',p_secondary->>'firstName',p_secondary->>'lastName')),''), c.supplementary_full_name),
         supplementary_address = coalesce(nullif(concat_ws(', ',nullif(p_secondary->>'permanentAddressLine1',''),nullif(p_secondary->>'cityMunicipality',''),nullif(p_secondary->>'province','')),''), c.supplementary_address),
         supplementary_birthday = coalesce((p_secondary->>'birthDate')::date, c.supplementary_birthday),
         supplementary_gender = coalesce(lower(nullif(p_secondary->>'sex','')), c.supplementary_gender),
         supplementary_citizenship = coalesce(nullif(p_secondary->>'citizenship',''), c.supplementary_citizenship),
         supplementary_civil_status = coalesce(nullif(p_secondary->>'civilStatus',''), c.supplementary_civil_status),
         supplementary_tin_number = coalesce(nullif(p_secondary->>'tinNumber',''), c.supplementary_tin_number),
         supplementary_landline = coalesce(nullif(p_secondary->>'landline',''), c.supplementary_landline),
         supplementary_mobile = coalesce(nullif(p_secondary->>'mobile',''), c.supplementary_mobile),
         supplementary_email = coalesce(nullif(p_secondary->>'email',''), c.supplementary_email),
         supplementary_occupation_business_name = coalesce(nullif(p_secondary->>'occupationBusinessName',''), c.supplementary_occupation_business_name),
         supplementary_office_address = coalesce(nullif(p_secondary->>'officeBusinessAddress',''), c.supplementary_office_address),
         supplementary_position = coalesce(nullif(p_secondary->>'employedPosition',''), c.supplementary_position)
   where c.id = p_customer_id;
end $$;

revoke all on function private.mirror_application_onto_customer(uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;

/* ------------------------------------------------------------------ */
/* 2. save_customer_application, re-delivered with ONE added call.     */
/*                                                                     */
/* Body copied verbatim from 20261131000002_afhomes_application_referral_staff
   with EXACTLY one change: the mirror call after the holders are written,
   plus v_customer. Every validation, referral-chain resolution and status
   gate is untouched - the function still refuses a non-draft edit and still
   raises ACTOR_INACTIVE / PLAN_NOT_FOUND / INVALID_HIERARCHY exactly as before. */
/* ------------------------------------------------------------------ */
create or replace function public.save_customer_application(
  p_application_id uuid,
  p_actor_id uuid,
  p_header jsonb,
  p_primary jsonb,
  p_secondary jsonb default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := coalesce(p_application_id, gen_random_uuid());
  v_existing public.customer_applications%rowtype;
  v_plan public.card_plans%rowtype;
  v_tier text;
  v_svd_name text;
  v_ssm_name text;
  v_sm_name text;
  v_referrer_name text;
  v_customer uuid;
begin
  if not exists (select 1 from public.staff_users where id = p_actor_id and status = 'active') then
    raise exception 'ACTOR_INACTIVE';
  end if;
  select * into v_plan from public.card_plans where id = (p_header->>'planId')::uuid and is_active;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  v_tier := upper(v_plan.code);
  if v_tier not in ('BRONZE','SILVER','GOLD') then raise exception 'INVALID_TIER'; end if;
  if p_secondary is not null and v_tier <> 'GOLD' then raise exception 'SECONDARY_HOLDER_GOLD_ONLY'; end if;

  -- Referral chain: ids win, legacy text is the fallback. Each supplied id is
  -- checked against the Organization (active staff, exact role) and then
  -- against the levels above it (ancestry agreement, gaps allowed). Client
  -- text for the four names is ignored whenever an id resolves; otherwise the
  -- legacy nullif passthrough is unchanged.
  <<resolve_chain>>
  declare
    v_refusal text;
  begin
    -- One statement resolves the refusal AND the snapshots: the CTEs below
    -- belong to this statement alone, and the bare aggregate always returns
    -- exactly one row over the four supplied levels.
    with
    supplied(level, expected_role, raw_id) as (
      values
        ('svd', 'vice_director', nullif(p_header->>'svdStaffId','')),
        ('ssm', 'senior_sales_manager', nullif(p_header->>'ssmStaffId','')),
        ('sm', 'sales_manager', nullif(p_header->>'smStaffId','')),
        ('referrer', 'ost', nullif(p_header->>'referrerStaffId',''))
    ),
    -- The join compares as TEXT (lower-cased): casting the untrusted value
    -- would be unsafe, because PostgreSQL does not evaluate the ON-clause
    -- guards in order and a malformed id would raise 22P02 instead of the
    -- refusal below. A malformed or unknown id simply matches no staff row.
    resolved as (
      select s.level, s.expected_role,
        case
          when s.raw_id is null then null
          when u.id is null then 'SUBJECT_NOT_FOUND'
          when u.status <> 'active' then 'SELLER_INACTIVE'
          when coalesce((
            select r.slug from public.staff_role_assignments a
            join public.roles r on r.id = a.role_id
            where a.staff_id = u.id
          ), '') <> s.expected_role then 'SELLER_ROLE_NOT_A_SELLER'
          else null
        end as refusal,
        u.id as staff_id, u.full_name as full_name
      from supplied s
      left join public.staff_users u on u.id::text = lower(s.raw_id)
    )
    select max(refusal),
      -- Names: an id snapshots the Organization spelling; otherwise the legacy
      -- client text passes through exactly as before.
      coalesce(max(case when level = 'svd' and staff_id is not null then full_name end),
               nullif(p_header->>'svdName','')),
      coalesce(max(case when level = 'ssm' and staff_id is not null then full_name end),
               nullif(p_header->>'ssmName','')),
      coalesce(max(case when level = 'sm' and staff_id is not null then full_name end),
               nullif(p_header->>'salesManagerName','')),
      coalesce(max(case when level = 'referrer' and staff_id is not null then full_name end),
               nullif(p_header->>'vipReferrer',''))
      into v_refusal, v_svd_name, v_ssm_name, v_sm_name, v_referrer_name
    from resolved;
    if v_refusal is not null then raise exception '%', v_refusal; end if;

    -- Chain agreement over the RESOLVED ids only: text-only levels carry no
    -- linkage and cannot contradict anything. Ancestry is walked from
    -- referral_relationships with a depth cap, so a cycle stops contributing
    -- rather than looping.
    if exists (
      with recursive
      supplied(level, expected_role, raw_id) as (
        values
          ('svd', 'vice_director', nullif(p_header->>'svdStaffId','')),
          ('ssm', 'senior_sales_manager', nullif(p_header->>'ssmStaffId','')),
          ('sm', 'sales_manager', nullif(p_header->>'smStaffId','')),
          ('referrer', 'ost', nullif(p_header->>'referrerStaffId',''))
      ),
      resolved as (
        select s.level, u.id as staff_id
        from supplied s
        join public.staff_users u
          on u.id::text = lower(s.raw_id)
         and u.status = 'active'
      ),
      ancestry(level, ancestor, depth) as (
        select r.level, rel.upline_staff_id, 1
        from resolved r
        join public.referral_relationships rel
          on rel.subject_staff_id = r.staff_id and rel.is_active
        union
        select a.level, rel.upline_staff_id, a.depth + 1
        from ancestry a
        join public.referral_relationships rel
          on rel.subject_staff_id = a.ancestor and rel.is_active
        where a.depth < 8
      ),
      ordered(level, ord) as (
        values ('svd', 1), ('ssm', 2), ('sm', 3), ('referrer', 4)
      )
      select 1
      from resolved lo
      join ordered o_lo on o_lo.level = lo.level
      join resolved hi on hi.staff_id is not null
      join ordered o_hi on o_hi.level = hi.level and o_hi.ord < o_lo.ord
      where lo.staff_id is not null
        and not exists (
          select 1 from ancestry
          where ancestry.level = lo.level and ancestry.ancestor = hi.staff_id
        )
      limit 1
    ) then raise exception 'INVALID_HIERARCHY'; end if;
  end resolve_chain;

  if p_application_id is null then
    insert into public.customer_applications(
      id, application_number, customer_id, sale_id, plan_id, tier_snapshot,
      payment_scheme_snapshot, vip_amount_snapshot, discount_percent_snapshot,
      validity_years_snapshot, yearly_points_snapshot, annual_points_tranches_snapshot,
      holder_limit_snapshot, sales_manager_name, svd_name, ssm_name, vip_recommender_name,
      recommender_contact, recommender_email, vip_referrer, acquisition_channels,
      consent_acknowledged, acknowledged_at, primary_signature_status,
      secondary_signature_status, valid_id_received, reservation_payment_proof_received,
      status, created_by,
      svd_staff_id, ssm_staff_id, sm_staff_id, referrer_staff_id
    ) values (
      v_id, 'APP-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(v_id::text,'-',''),1,8)),
      (p_header->>'customerId')::uuid, nullif(p_header->>'saleId','')::uuid, v_plan.id, v_tier,
      p_header->>'paymentScheme', v_plan.cash_price, v_plan.discount_percent,
      v_plan.validity_years, v_plan.yearly_points, v_plan.annual_points_tranches,
      v_plan.cardholder_limit, v_sm_name, v_svd_name, v_ssm_name, nullif(p_header->>'vipRecommenderName',''),
      nullif(p_header->>'recommenderContact',''), nullif(p_header->>'recommenderEmail',''),
      v_referrer_name, coalesce(array(select jsonb_array_elements_text(p_header->'acquisitionChannels')), '{}'),
      coalesce((p_header->>'consentAcknowledged')::boolean,false), (p_header->>'acknowledgedAt')::date,
      p_header->>'primarySignatureStatus', nullif(p_header->>'secondarySignatureStatus',''),
      coalesce((p_header->>'validIdReceived')::boolean,false),
      coalesce((p_header->>'reservationPaymentProofReceived')::boolean,false), 'draft', p_actor_id,
      nullif(p_header->>'svdStaffId','')::uuid, nullif(p_header->>'ssmStaffId','')::uuid,
      nullif(p_header->>'smStaffId','')::uuid, nullif(p_header->>'referrerStaffId','')::uuid
    );
  else
    select * into v_existing from public.customer_applications where id = p_application_id for update;
    if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
    if v_existing.status <> 'draft' then raise exception 'APPLICATION_NOT_EDITABLE'; end if;
    update public.customer_applications set
      customer_id=(p_header->>'customerId')::uuid, sale_id=nullif(p_header->>'saleId','')::uuid,
      plan_id=v_plan.id, tier_snapshot=v_tier, payment_scheme_snapshot=p_header->>'paymentScheme',
      vip_amount_snapshot=v_plan.cash_price, discount_percent_snapshot=v_plan.discount_percent,
      validity_years_snapshot=v_plan.validity_years, yearly_points_snapshot=v_plan.yearly_points,
      annual_points_tranches_snapshot=v_plan.annual_points_tranches, holder_limit_snapshot=v_plan.cardholder_limit,
      sales_manager_name=v_sm_name,
      svd_name=v_svd_name, ssm_name=v_ssm_name,
      vip_recommender_name=nullif(p_header->>'vipRecommenderName',''),
      recommender_contact=nullif(p_header->>'recommenderContact',''), recommender_email=nullif(p_header->>'recommenderEmail',''),
      vip_referrer=v_referrer_name, acquisition_channels=coalesce(array(select jsonb_array_elements_text(p_header->'acquisitionChannels')), '{}'),
      consent_acknowledged=coalesce((p_header->>'consentAcknowledged')::boolean,false), acknowledged_at=(p_header->>'acknowledgedAt')::date,
      primary_signature_status=p_header->>'primarySignatureStatus', secondary_signature_status=nullif(p_header->>'secondarySignatureStatus',''),
      valid_id_received=coalesce((p_header->>'validIdReceived')::boolean,false),
      reservation_payment_proof_received=coalesce((p_header->>'reservationPaymentProofReceived')::boolean,false), updated_at=now(),
      svd_staff_id=nullif(p_header->>'svdStaffId','')::uuid,
      ssm_staff_id=nullif(p_header->>'ssmStaffId','')::uuid,
      sm_staff_id=nullif(p_header->>'smStaffId','')::uuid,
      referrer_staff_id=nullif(p_header->>'referrerStaffId','')::uuid
    where id=v_id;
    delete from public.customer_application_holders where application_id=v_id;
  end if;

  insert into public.customer_application_holders(application_id,holder_type,last_name,first_name,middle_name,suffix,birth_date,sex,citizenship,civil_status,permanent_address_line_1,permanent_address_line_2,city_municipality,province,barangay,province_code,city_municipality_code,barangay_code,postal_code,landline,mobile,email,tin_number,occupation_business_name,office_business_address,business_industry,employed_position,printed_name)
  select v_id,'PRIMARY',p_primary->>'lastName',p_primary->>'firstName',nullif(p_primary->>'middleName',''),nullif(p_primary->>'suffix',''),(p_primary->>'birthDate')::date,nullif(p_primary->>'sex',''),nullif(p_primary->>'citizenship',''),nullif(p_primary->>'civilStatus',''),p_primary->>'permanentAddressLine1',nullif(p_primary->>'permanentAddressLine2',''),p_primary->>'cityMunicipality',p_primary->>'province',nullif(p_primary->>'barangay',''),nullif(p_primary->>'provinceCode',''),nullif(p_primary->>'cityMunicipalityCode',''),nullif(p_primary->>'barangayCode',''),nullif(p_primary->>'postalCode',''),nullif(p_primary->>'landline',''),p_primary->>'mobile',p_primary->>'email',nullif(p_primary->>'tinNumber',''),nullif(p_primary->>'occupationBusinessName',''),nullif(p_primary->>'officeBusinessAddress',''),nullif(p_primary->>'businessIndustry',''),nullif(p_primary->>'employedPosition',''),p_primary->>'printedName';
  if p_secondary is not null then
    insert into public.customer_application_holders(application_id,holder_type,last_name,first_name,middle_name,suffix,birth_date,sex,citizenship,civil_status,permanent_address_line_1,permanent_address_line_2,city_municipality,province,barangay,province_code,city_municipality_code,barangay_code,postal_code,landline,mobile,email,tin_number,occupation_business_name,office_business_address,business_industry,employed_position,printed_name)
    select v_id,'SECONDARY',p_secondary->>'lastName',p_secondary->>'firstName',nullif(p_secondary->>'middleName',''),nullif(p_secondary->>'suffix',''),(p_secondary->>'birthDate')::date,nullif(p_secondary->>'sex',''),nullif(p_secondary->>'citizenship',''),nullif(p_secondary->>'civilStatus',''),p_secondary->>'permanentAddressLine1',nullif(p_secondary->>'permanentAddressLine2',''),p_secondary->>'cityMunicipality',p_secondary->>'province',nullif(p_secondary->>'barangay',''),nullif(p_secondary->>'provinceCode',''),nullif(p_secondary->>'cityMunicipalityCode',''),nullif(p_secondary->>'barangayCode',''),nullif(p_secondary->>'postalCode',''),nullif(p_secondary->>'landline',''),p_secondary->>'mobile',p_secondary->>'email',nullif(p_secondary->>'tinNumber',''),nullif(p_secondary->>'occupationBusinessName',''),nullif(p_secondary->>'officeBusinessAddress',''),nullif(p_secondary->>'businessIndustry',''),nullif(p_secondary->>'employedPosition',''),p_secondary->>'printedName';
  end if;

  -- THE FIX, in one place. Both wrappers already call this function, so this
  -- single line covers registration, an application raised against an existing
  -- customer, and every later draft edit. It runs last, so the holders it
  -- mirrors are the ones just written.
  select a.customer_id into v_customer from public.customer_applications a where a.id = v_id;
  perform private.mirror_application_onto_customer(v_customer, p_header, p_primary, p_secondary);
  return v_id;
end $$;

/* ------------------------------------------------------------------ */
/* 3. The backfill, as a callable function so it can be tested and       */
/*    re-run. Deliberately coalesce-only: it fills the blanks the mirror   */
/*    never reached and never overwrites a hand correction.               */
/* ------------------------------------------------------------------ */
create or replace function private.backfill_application_onto_customer()
returns integer language plpgsql security definer
  set search_path = pg_catalog, public, private, pg_temp as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select a.customer_id,
      -- Only columns that EXIST on customer_applications can be rebuilt here.
      -- ra_number, company_status and the stated_* package block are NOT
      -- application columns: they were added to `customers` alone and exist in
      -- an application only inside the JSON the builder sent. So for rows
      -- written before the mirror, that block is unrecoverable from the
      -- application and can only re-enter through "Edit company record". The
      -- referral chain and every holder fact below are recoverable, and those
      -- are the fields the Company record tab was actually blank on.
      jsonb_build_object(
        'salesManagerName', a.sales_manager_name,
        'svdName', a.svd_name,
        'ssmName', a.ssm_name,
        'vipReferrer', a.vip_referrer,
        'vipRecommenderName', a.vip_recommender_name,
        'recommenderContact', a.recommender_contact,
        'recommenderEmail', a.recommender_email
      ) as header,
      (
        select jsonb_build_object(
          'firstName', h.first_name,
          'lastName', h.last_name,
          'birthDate', h.birth_date,
          'sex', h.sex,
          'citizenship', h.citizenship,
          'civilStatus', h.civil_status,
          'tinNumber', h.tin_number,
          'landline', h.landline,
          'mobile', h.mobile,
          'email', h.email,
          'permanentAddressLine1', h.permanent_address_line_1,
          'cityMunicipality', h.city_municipality,
          'province', h.province,
          'occupationBusinessName', h.occupation_business_name,
          'officeBusinessAddress', h.office_business_address,
          'employedPosition', h.employed_position
        )
        from public.customer_application_holders h
        where h.application_id = a.id and h.holder_type = 'PRIMARY'
      ) as primary,
      (
        select jsonb_build_object(
          'firstName', h.first_name,
          'lastName', h.last_name,
          'birthDate', h.birth_date,
          'sex', h.sex,
          'citizenship', h.citizenship,
          'civilStatus', h.civil_status,
          'tinNumber', h.tin_number,
          'landline', h.landline,
          'mobile', h.mobile,
          'email', h.email,
          'permanentAddressLine1', h.permanent_address_line_1,
          'cityMunicipality', h.city_municipality,
          'province', h.province,
          'occupationBusinessName', h.occupation_business_name,
          'officeBusinessAddress', h.office_business_address,
          'employedPosition', h.employed_position
        )
        from public.customer_application_holders h
        where h.application_id = a.id and h.holder_type = 'SECONDARY'
      ) as secondary
    from public.customer_applications a
    where a.customer_id is not null
    order by a.created_at nulls last
  loop
    -- An application with no primary holder carries no intake to copy.
    if r.primary is null then
      continue;
    end if;
    perform private.mirror_application_onto_customer(r.customer_id, r.header, r.primary, r.secondary);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function private.backfill_application_onto_customer()
  from public, anon, authenticated;

/* ------------------------------------------------------------------ */
/* 4. Run the backfill once.                                             */
/* ------------------------------------------------------------------ */
select private.backfill_application_onto_customer();