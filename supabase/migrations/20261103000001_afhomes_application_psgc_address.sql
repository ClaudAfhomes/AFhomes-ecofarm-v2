-- AF Homes: verified PSGC geography on Customer Application holders.
--
-- The Customer Application address moves from free text to a verified
-- province -> city/municipality -> barangay hierarchy. This migration gives the
-- table somewhere to put the codes and the barangay, and re-delivers the two
-- already-applied functions whose bodies hard-code the old column list.
--
-- COMPATIBILITY, stated plainly:
--
-- * Every new column is NULLABLE. No existing row is touched, no address is
--   rewritten, and no code is backfilled. An application created before the
--   structured selectors keep reading back exactly as stored, with no fabricated
--   geography - absence of a code means "predates the selectors", not "wrong".
-- * `city_municipality` and `province` stay NOT NULL and keep their meaning. They
--   remain the display names; the codes are the new identity.
-- * Historical documents are unaffected: exports render an absent barangay as a
--   blank cell, and the reservation address join below skips NULLs, so a legacy
--   application produces a byte-identical reservation address.
--
-- WHY TWO FUNCTIONS ARE RE-ISSUED RATHER THAN EDITED IN PLACE:
--
-- The migration runner SKIPS any version a database has already recorded. Editing
-- 20261019000001 or 20261101000001 in the working tree would therefore never reach
-- a database that recorded them - it would look applied and do nothing. Both files
-- are immutable, so this forward-only migration re-delivers the two affected
-- bodies verbatim except for the added columns. That is the same pattern Phase 5
-- used to repair already-applied SQL.
--
-- The two functions are re-issued BYTE-FOR-BYTE apart from the noted changes. If
-- you edit anything else here, diff against the originals.
--
-- Validation before apply:
--   select column_name from information_schema.columns
--     where table_name = 'customer_application_holders'
--       and column_name in ('barangay','province_code','city_municipality_code','barangay_code');
--   -- 0 rows
-- Validation after apply:
--   -- 4 rows
--   select count(*) from public.customer_application_holders
--     where barangay is null and province_code is null;                -- unchanged from before
--   select count(*) from public.customer_application_holders
--     where num_nonnulls(province_code,city_municipality_code,barangay_code) not in (0,3);  -- 0
--   select count(*) from pg_proc where proname='save_customer_application'
--     and prosrc like '%barangay_code%';                              -- 1
--   select count(*) from pg_proc where proname='reserve_application_purchase_once'
--     and prosrc like '%h.barangay%';                                  -- 1
--   -- then run pnpm test:db:local and supabase/security/rls_invariants.sql
--
-- Down: drop the three constraints and the four columns, then re-apply the two
--   function bodies from 20261019000001 / 20261101000001. There is no automated
--   down path; the addresses themselves are never lost, because the display names
--   were never changed.

-- ---------------------------------------------------------------- columns ----
alter table public.customer_application_holders
  add column if not exists barangay text,
  add column if not exists province_code text,
  add column if not exists city_municipality_code text,
  add column if not exists barangay_code text;

comment on column public.customer_application_holders.barangay is
  'Official barangay name. NULL for applications created before the structured selectors.';
comment on column public.customer_application_holders.province_code is
  'Official 10-digit PSGC province code. NULL means unverified legacy free text.';

-- ------------------------------------------------------------ constraints ----
-- Added only when absent, so this migration is safe to apply twice.
do $$ begin
  -- PSGC codes are 10 digits. A shorter value is a different PSGC vintage, not a
  -- near-miss, so it is refused rather than accepted into a code column.
  if not exists (select 1 from pg_constraint where conname='customer_application_holders_psgc_code_shape') then
    alter table public.customer_application_holders add constraint customer_application_holders_psgc_code_shape
      check (
        (province_code is null or province_code ~ '^[0-9]{10}$') and
        (city_municipality_code is null or city_municipality_code ~ '^[0-9]{10}$') and
        (barangay_code is null or barangay_code ~ '^[0-9]{10}$')
      );
  end if;

  -- All three codes or none. A half-verified hierarchy would persist a
  -- parent/child pair that no authority confirmed, which is precisely the
  -- inconsistency the selector cascade exists to prevent.
  if not exists (select 1 from pg_constraint where conname='customer_application_holders_psgc_triple') then
    alter table public.customer_application_holders add constraint customer_application_holders_psgc_triple
      check (num_nonnulls(province_code, city_municipality_code, barangay_code) in (0, 3));
  end if;

  -- A barangay name is only meaningful alongside a verified locality.
  if not exists (select 1 from pg_constraint where conname='customer_application_holders_barangay_needs_locality') then
    alter table public.customer_application_holders add constraint customer_application_holders_barangay_needs_locality
      check (barangay is null or city_municipality_code is not null);
  end if;
end $$;

-- ------------------------------------------------- save_customer_application --
-- Re-delivered from 20261019000001. ONLY change: `barangay,province_code,
-- city_municipality_code,barangay_code` added to both INSERT column lists, and
-- the matching values in both SELECTs.
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
begin
  if not exists (select 1 from public.staff_users where id = p_actor_id and status = 'active') then
    raise exception 'ACTOR_INACTIVE';
  end if;
  select * into v_plan from public.card_plans where id = (p_header->>'planId')::uuid and is_active;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  v_tier := upper(v_plan.code);
  if v_tier not in ('BRONZE','SILVER','GOLD') then raise exception 'INVALID_TIER'; end if;
  if p_secondary is not null and v_tier <> 'GOLD' then raise exception 'SECONDARY_HOLDER_GOLD_ONLY'; end if;

  if p_application_id is null then
    insert into public.customer_applications(
      id, application_number, customer_id, sale_id, plan_id, tier_snapshot,
      payment_scheme_snapshot, vip_amount_snapshot, discount_percent_snapshot,
      validity_years_snapshot, yearly_points_snapshot, annual_points_tranches_snapshot,
      holder_limit_snapshot, sales_manager_name, vip_recommender_name,
      recommender_contact, recommender_email, vip_referrer, acquisition_channels,
      consent_acknowledged, acknowledged_at, primary_signature_status,
      secondary_signature_status, valid_id_received, reservation_payment_proof_received,
      status, created_by
    ) values (
      v_id, 'APP-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(v_id::text,'-',''),1,8)),
      (p_header->>'customerId')::uuid, nullif(p_header->>'saleId','')::uuid, v_plan.id, v_tier,
      p_header->>'paymentScheme', v_plan.cash_price, v_plan.discount_percent,
      v_plan.validity_years, v_plan.yearly_points, v_plan.annual_points_tranches,
      v_plan.cardholder_limit, nullif(p_header->>'salesManagerName',''), nullif(p_header->>'vipRecommenderName',''),
      nullif(p_header->>'recommenderContact',''), nullif(p_header->>'recommenderEmail',''),
      nullif(p_header->>'vipReferrer',''), coalesce(array(select jsonb_array_elements_text(p_header->'acquisitionChannels')), '{}'),
      coalesce((p_header->>'consentAcknowledged')::boolean,false), (p_header->>'acknowledgedAt')::date,
      p_header->>'primarySignatureStatus', nullif(p_header->>'secondarySignatureStatus',''),
      coalesce((p_header->>'validIdReceived')::boolean,false),
      coalesce((p_header->>'reservationPaymentProofReceived')::boolean,false), 'draft', p_actor_id
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
      sales_manager_name=nullif(p_header->>'salesManagerName',''), vip_recommender_name=nullif(p_header->>'vipRecommenderName',''),
      recommender_contact=nullif(p_header->>'recommenderContact',''), recommender_email=nullif(p_header->>'recommenderEmail',''),
      vip_referrer=nullif(p_header->>'vipReferrer',''), acquisition_channels=coalesce(array(select jsonb_array_elements_text(p_header->'acquisitionChannels')), '{}'),
      consent_acknowledged=coalesce((p_header->>'consentAcknowledged')::boolean,false), acknowledged_at=(p_header->>'acknowledgedAt')::date,
      primary_signature_status=p_header->>'primarySignatureStatus', secondary_signature_status=nullif(p_header->>'secondarySignatureStatus',''),
      valid_id_received=coalesce((p_header->>'validIdReceived')::boolean,false),
      reservation_payment_proof_received=coalesce((p_header->>'reservationPaymentProofReceived')::boolean,false), updated_at=now()
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

-- ------------------------------------------ reserve_application_purchase_once --
-- Re-delivered from 20261101000001 (immutable). ONLY change: `h.barangay` added
-- to the SECONDARY holder address, and `v_primary.barangay` to the PRIMARY one.
--
-- `concat_ws` SKIPS null arguments, so a legacy application - whose barangay is
-- NULL - yields exactly the address string it produced before this migration.
create or replace function public.reserve_application_purchase_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_terms_id uuid, p_input jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_terms public.customer_application_purchase_terms%rowtype;
  v_id uuid:=gen_random_uuid(); v_number text; v_result uuid; v_payload jsonb;
  v_receipt uuid; v_primary public.customer_application_holders%rowtype; v_secondary jsonb;
  v_schedule jsonb;
  v_line integer:=0; v_item jsonb; v_balance numeric;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'purchaseTermsId',p_terms_id,
    'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'reservation.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  -- The reviewer may reserve for an application they do not own; the owner may
  -- reserve their own. Anyone else is refused before any row is written.
  if v_app.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  end if;
  if v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;
  if v_app.purchase_terms_id is null then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  -- An exact terms id is required, and it must be the one the application froze:
  -- a request may not reach forward to a newer version.
  if p_terms_id is distinct from v_app.purchase_terms_id then
    raise exception 'PURCHASE_TERMS_VERSION_CONFLICT' using errcode='55000';
  end if;
  select * into v_terms from public.customer_application_purchase_terms pt where pt.id=p_terms_id;
  if not found or v_terms.application_id is distinct from v_app.id then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;
  -- The seller must still be a valid seller of record. A frozen historical seller
  -- that has since been suspended cannot open new commercial work.
  perform private.purchase_seller_for(p_actor_id,v_terms.seller_staff_id);
  if not exists(select 1 from public.customers c where c.id=v_app.customer_id and c.status<>'cancelled') then
    raise exception 'CUSTOMER_NOT_ELIGIBLE' using errcode='55000';
  end if;
  -- One live reservation per application. A cancelled agreement frees the
  -- application; a legacy sale-origin agreement linked to it also blocks.
  if exists(select 1 from public.reservation_agreements r
             where r.customer_application_id=v_app.id and r.status<>'cancelled') then
    raise exception 'RESERVATION_ALREADY_EXISTS' using errcode='55000';
  end if;

  select * into v_primary from public.customer_application_holders h
   where h.application_id=v_app.id and h.holder_type='PRIMARY';
  if v_primary is null then raise exception 'PRIMARY_HOLDER_REQUIRED' using errcode='23514'; end if;
  select jsonb_build_object('holderType',h.holder_type,
      'name',concat_ws(' ',h.first_name,h.middle_name,h.last_name,h.suffix),
      'address',concat_ws(', ',h.permanent_address_line_1,h.permanent_address_line_2,
        h.barangay,h.city_municipality,h.province,h.postal_code),
      'contactNumber',h.mobile,'email',h.email,'tinNumber',h.tin_number)
    into v_secondary from public.customer_application_holders h
   where h.application_id=v_app.id and h.holder_type='SECONDARY';

  v_number:=private.claim_af_id('AF-RES','public.reservation_agreements'::regclass,'reservation_number');
  v_balance:=0;
  insert into public.reservation_agreements(
    id,reservation_number,revision_number,reservation_date,agreement_date,sale_id,origin,
    customer_application_id,customer_id,seller_staff_id,purchase_terms_id,plan_id,created_by,
    tier_snapshot,inclusions_snapshot,total_price_snapshot,reservation_fee_snapshot,
    down_payment_snapshot,total_payment_received_snapshot,balance_snapshot,
    monthly_amortization_snapshot,installment_months_snapshot,payment_scheme_snapshot,
    discount_percent_snapshot,validity_years_snapshot,validity_months_snapshot,yearly_points_snapshot,
    annual_points_tranches_snapshot,holder_limit_snapshot,minimum_down_payment_snapshot,
    required_initial_snapshot,spot_cash_days_snapshot,commission_rule_id,commission_rate_snapshot,
    commission_base_snapshot,expected_commission_snapshot,monthly_amortization_start,monthly_amortization_end,
    payment_due_day,primary_signature_status,secondary_signature_status,status)
  values(v_id,v_number,nullif(p_input->>'revisionNumber',''),
    (p_input->>'reservationDate')::date,(p_input->>'agreementDate')::date,null,'application',
    v_app.id,v_app.customer_id,v_terms.seller_staff_id,v_terms.id,v_app.plan_id,p_actor_id,
    v_terms.tier,jsonb_build_object('items',v_terms.inclusions),v_terms.total_price,v_terms.reservation_fee,
    v_terms.required_initial,private.money(v_balance),private.money(v_terms.total_price::numeric-v_balance),
    v_terms.monthly_amount,v_terms.installment_months,v_terms.payment_scheme,
    v_terms.discount_percent,v_terms.validity_months/12,v_terms.validity_months,v_terms.yearly_points,
    v_terms.annual_points_tranches,v_terms.holder_limit,v_terms.minimum_down_payment,
    v_terms.required_initial,v_terms.spot_cash_days,v_terms.commission_rule_id,v_terms.commission_rate,
    v_terms.commission_base,v_terms.expected_commission,
    nullif(p_input->>'monthlyAmortizationStart','')::date,nullif(p_input->>'monthlyAmortizationEnd','')::date,
    nullif(p_input->>'paymentDueDay','')::integer,p_input->>'primarySignatureStatus',
    nullif(p_input->>'secondarySignatureStatus',''),'draft');

  insert into public.reservation_agreement_holders(agreement_id,holder_type,name,address,contact_number,email,tin_number)
  -- coalesce, never nullif: `nullif(x, mobile)` is NULL whenever the request
  -- omits the field, which would blank a NOT NULL holder column instead of
  -- falling back to the frozen application holder.
  values(v_id,'PRIMARY',concat_ws(' ',v_primary.first_name,v_primary.middle_name,v_primary.last_name,v_primary.suffix),
    coalesce(nullif(p_input->>'primaryAddress',''),concat_ws(', ',v_primary.permanent_address_line_1,
      v_primary.permanent_address_line_2,v_primary.barangay,v_primary.city_municipality,v_primary.province,v_primary.postal_code)),
    coalesce(nullif(p_input->>'primaryContactNumber',''),v_primary.mobile,v_primary.landline),
    coalesce(nullif(p_input->>'primaryEmail',''),v_primary.email),
    nullif(coalesce(p_input->>'primaryTinNumber',v_primary.tin_number),''));
  if v_secondary is not null then
    insert into public.reservation_agreement_holders(agreement_id,holder_type,name,address,contact_number,email,tin_number)
    select v_id,'SECONDARY',v_secondary->>'name',
      coalesce(nullif(p_input->>'secondaryAddress',''),v_secondary->>'address'),
      coalesce(nullif(p_input->>'secondaryContactNumber',''),v_secondary->>'contactNumber'),
      coalesce(nullif(p_input->>'secondaryEmail',''),v_secondary->>'email'),
      nullif(coalesce(p_input->>'secondaryTinNumber',v_secondary->>'tinNumber'),'');
  end if;
  v_schedule:=coalesce(p_input->'scheduleNotes','[]'::jsonb);
  for v_item in select value from jsonb_array_elements(v_schedule) loop
    v_line:=v_line+1;
    insert into public.reservation_agreement_schedule(agreement_id,line_number,particular,amount_snapshot,payment_date,remarks)
    values(v_id,v_line,v_item->>'particular',private.money((v_item->>'amount')::numeric),
      nullif(v_item->>'paymentDate','')::date,nullif(v_item->>'remarks',''));
  end loop;

  v_receipt:=private.append_purchase_document('reservation',v_id,1,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'RESERVATION_AGREEMENT_CREATED','reservation_agreement',v_id::text,
      jsonb_build_object('status','draft','origin','application','applicationId',v_app.id,
        'purchaseTermsId',v_terms.id,'termsVersion',v_terms.version,'reservationNumber',v_number),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'reservation.create',p_request_id,v_payload,v_id,
    jsonb_build_object('resultId',v_id,'status','draft','purchaseTermsId',v_terms.id,
      'termsVersion',v_terms.version,'documentEvidenceId',v_receipt,'revision',1));
  return v_id;
end $$;

revoke all on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) to service_role;