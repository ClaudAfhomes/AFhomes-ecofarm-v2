-- AF Homes customer-application referral chain: staff linkage + chain check.
--
-- The paper application's referral block names the upline chain above the
-- seller: SVD, SSM, SM, Referrer (OST). The header stored those as free text
-- (sales_manager_name, vip_referrer, svd_name, ssm_name), so a typo could name
-- nobody. This migration links each level to the Organization instead: four
-- nullable staff references, resolved and chain-checked inside
-- public.save_customer_application.
--
-- Semantics (stated names stay the frozen display record):
-- - Each supplied id must resolve to an ACTIVE staff member whose assigned
--   role is exactly the level's role (vice_director, senior_sales_manager,
--   sales_manager, ost). Inactive staff, a wrong role, or an unknown id is
--   refused. Names can collide; ids cannot.
-- - The chain must AGREE with referral_relationships: every selected level
--   above a selected level must appear in that person's upline ancestry, in
--   order. Gaps are allowed (an SM under an SVD with no SSM named), because
--   the paper form is often partial; CONTRADICTION is refused. This mirrors
--   BR-DUAL-02's agreement idea (upline columns per row must not disagree)
--   without inventing an adjacency rule the business rules never state.
-- - When an id is supplied, the matching *_name column is written from
--   staff_users.full_name by the server - client text for those four names is
--   ignored, so the snapshot can never disagree with the linkage. When no id
--   is supplied, the legacy text behavior is unchanged (nullif passthrough),
--   so older callers and imports keep working.
-- - Nothing here participates in commissions, seller resolution or money. The
--   sale-time seller checks (downline scope, complete hierarchy) are untouched
--   and remain the enforcement point for who may sell.
--
-- forward-only, idempotent: add column if not exists; create or replace
-- function. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='customer_applications'
--      and column_name in
--      ('svd_staff_id','ssm_staff_id','sm_staff_id','referrer_staff_id');  -- 4
--   select prosrc like '%INVALID_HIERARCHY%' from pg_proc
--    where proname='save_customer_application';                           -- t
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): the columns are inert once no caller
-- writes them; drop in a later migration only after every reader is retired.
-- Never rewrite stored values.

-- ---------------------------------------------------------------------------
-- 1. Staff linkage. Nullable UUIDs, restricted like every other staff link.
-- ---------------------------------------------------------------------------
alter table public.customer_applications
  add column if not exists svd_staff_id uuid references public.staff_users(id) on delete restrict,
  add column if not exists ssm_staff_id uuid references public.staff_users(id) on delete restrict,
  add column if not exists sm_staff_id uuid references public.staff_users(id) on delete restrict,
  add column if not exists referrer_staff_id uuid references public.staff_users(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 2. save_customer_application, re-delivered.
--
-- Body copied verbatim from 20261131000001_afhomes_application_referral_chain
-- with EXACTLY these changes: the four id columns on both header writes, and
-- the referral-chain resolution below. The signature is unchanged, so the
-- idempotency wrappers keep working without modification.
-- ---------------------------------------------------------------------------
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
  return v_id;
end $$;

-- CREATE OR REPLACE preserves existing grants; restate the service-role-only
-- policy identically to the applied version (no broadening).
revoke all on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
