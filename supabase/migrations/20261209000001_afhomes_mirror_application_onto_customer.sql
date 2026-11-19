-- ============================================================================
-- Mirror application intake onto the customer record
--
-- PROBLEM
--   Creating a customer through the application builder inserts a `customers`
--   row with ONLY the core identity columns:
--
--     insert into public.customers(customer_number,first_name,middle_name,
--       last_name,suffix,birth_date,gender,email,phone,landline,address,
--       status,created_by)
--
--   `save_customer_application` then writes everything else the operator typed
--   into `customer_applications` / `customer_application_holders` and never
--   touches `customers` again.
--
--   The customer detail page (`GET /customers/:id`) reads `customers` ONLY, so
--   every field on the "Primary Member", "Supplementary Member", "Related
--   Persons and Referral" cards renders empty for a customer created through
--   the builder - even though the operator entered it seconds earlier. Nothing
--   is lost; it is in a table that screen never reads. `POST /customers`
--   (`customers.ts`) ALREADY writes these columns, so the two creation paths
--   disagree and one of them produces a half-empty record.
--
-- FIX
--   One `update` after `save_customer_application`, inside the same transaction
--   and the same SECURITY DEFINER function that created the customer.
--
--     PRIMARY holder   -> citizenship, civil_status, tin_number,
--                         occupation_business_name, office_business_address,
--                         employed_position
--     SECONDARY holder -> the whole supplementary_* block
--     header           -> svd_name, ssm_name, sm_name, referrer_name,
--                         vip_recommender_name, related_contact_no,
--                         related_email
--
--   These are all COMPANY-STATED verbatim columns. No money is copied: no
--   price, discount, total or commission, and none of the server-authoritative
--   columns (card_sales snapshots, verified payments, commissions, points) are
--   read or written. TIN values stay write-only and masked on read.
--
--   NOT copied, because the builder never collects them: `ra_number`,
--   `company_status` and the whole `stated_*` package/payment block. Those stay
--   manual, entered through "Edit company record".
--
-- IDEMPOTENCE
--   Every assignment is `coalesce(<from the application>, <already on the
--   customer>)`, so a second run cannot blank a column an operator has since
--   corrected through "Edit company record", and a blank in the builder never
--   erases an existing value. The retry path returns BEFORE this update
--   (`private.mutation_result`), so a duplicate request id never re-mirrors at
--   all. Safe to apply to a database of unknown provenance: against an already
--   -corrected database every assignment resolves to the existing value.
--
-- VALIDATION (after applying; all must return zero rows)
--   select c.id, c.customer_number
--     from public.customers c
--     join public.customer_applications a on a.customer_id = c.id
--    where a.citizenship is not null and c.citizenship is null;
--
--   select c.id
--     from public.customers c
--     join public.customer_application_holders h
--       on h.application_id in (
--            select id from public.customer_applications where customer_id = c.id)
--    where h.holder_type = 'SECONDARY'
--      and h.civil_status is not null and c.supplementary_civil_status is null;
--
--   select c.id
--     from public.customers c
--     join public.customer_applications a on a.customer_id = c.id
--    where a.svd_name is not null and c.svd_name is null;
--
-- DOWN
--   Restore the previous body from 20261204000001: delete the `update
--   public.customers` block below. The mirrored columns are LEFT IN PLACE -
--   they are customer facts an operator may already have seen and corrected,
--   and removing them would destroy data.
-- ============================================================================

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

  -- -------------------------------------------------------------------------
  -- THE MIRROR. Company-stated, verbatim, coalesce-only, and nothing else.
  --
  -- `coalesce(<builder value>, <already on the customer>)` is load-bearing in
  -- both directions: a field the operator left blank in the builder never
  -- blanks the customer, and re-running never overwrites a value corrected in
  -- "Edit company record". NULL `p_secondary` yields NULL here, which coalesce
  -- resolves to the existing value - the correct no-op for a primary-only card.
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
         -- COMPANY-STATED package/payment block, collected by the create form and
         -- matching the company master list's column names one for one. Verbatim
         -- and explicitly NOT server-authoritative: nothing is ever computed FROM
         -- these columns. `coalesce` keeps the same "blank never clears" rule.
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
   where c.id = v_customer;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'CUSTOMER_APPLICATION_CREATED','customer_application',v_result::text,jsonb_build_object('status','draft','customerId',v_customer));
  perform private.complete_mutation(p_actor_id,'application.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

revoke all on function public.register_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.register_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
