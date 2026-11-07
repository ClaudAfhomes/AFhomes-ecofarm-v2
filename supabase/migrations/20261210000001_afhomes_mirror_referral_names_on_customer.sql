-- ============================================================================
-- Mirror referral-chain resolved names onto the customer record
--
-- PROBLEM
--   `save_customer_application` resolves the referral chain (SVD/SSM/SM/Referrer)
--   from staff ids into `v_svd_name` / `v_ssm_name` / `v_sm_name` /
--   `v_referrer_name` and stores them on `customer_applications`. It then calls
--   `private.mirror_application_onto_customer(v_customer, p_header, ...)`, but
--   `p_header` is the ORIGINAL client payload, which carries `svdStaffId` etc.
--   and never the resolved names. The mirror reads `p_header->>'svdName'` and
--   friends, so for a staff-selected chain every one of them is NULL and the
--   customer row keeps "Not Recorded" even though the application has the name.
--   (Text-only entries worked, because the client does send `vipRecommenderName`
--   and the referral text fields it actually collects.)
--
-- FIX
--   Pass the resolved names into the mirror by merging them onto a copy of the
--   header. `coalesce` in the mirror keeps the same blank-never-clears rule, and
--   a second pass (register's inline mirror) stays a no-op.
--
-- IDEMPOTENCE
--   Coalesce-only mirror + backfill. Safe to re-run.
--
-- VALIDATION
--   select count(*) from public.customer_applications a
--     join public.customers c on c.id = a.customer_id
--    where a.svd_name is not null and c.svd_name is null;   -- 0
-- ============================================================================

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

  <<resolve_chain>>
  declare
    v_refusal text;
  begin
    with
    supplied(level, expected_role, raw_id) as (
      values
        ('svd', 'vice_director', nullif(p_header->>'svdStaffId','')),
        ('ssm', 'senior_sales_manager', nullif(p_header->>'ssmStaffId','')),
        ('sm', 'sales_manager', nullif(p_header->>'smStaffId','')),
        ('referrer', 'ost', nullif(p_header->>'referrerStaffId',''))
    ),
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

  -- Mirror with the RESOLVED names merged onto the header, so a staff-selected
  -- chain reaches the customer row instead of being dropped (the bug: the
  -- mirror previously read the client text fields, which are absent for a
  -- staff selection).
  select a.customer_id into v_customer from public.customer_applications a where a.id = v_id;
  perform private.mirror_application_onto_customer(
    v_customer,
    p_header || jsonb_build_object(
      'svdName', v_svd_name,
      'ssmName', v_ssm_name,
      'salesManagerName', v_sm_name,
      'vipReferrer', v_referrer_name
    ),
    p_primary,
    p_secondary
  );
  return v_id;
end $$;

-- Re-run backfill so rows written by the (buggy) live path get repaired.
select private.backfill_application_onto_customer();