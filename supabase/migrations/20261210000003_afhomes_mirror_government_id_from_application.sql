-- ============================================================================
-- Mirror the application's government ID onto the customer record
--
-- PROBLEM
--   The application form captures the government ID number, but the mirror
--   function only copied company-stated fields, so the customer detail page
--   kept showing "Not Recorded". (The type is mirrored from the uploaded
--   document on submit and on review; the number has no document source.)
--
-- FIX
--   `private.mirror_application_onto_customer` now also copies
--   `governmentIdNumber` from the header. Coalesce-only, and the number is
--   skipped when another customer already holds it (the unique index is on
--   (type, number)) so a duplicate cannot abort an application save - the
--   document-review path flags duplicates separately.
--
-- IDEMPOTENCE
--   Coalesce-only and duplicate-guarded; safe to re-run.
-- ============================================================================

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

  update public.customers c
     set citizenship = coalesce(nullif(p_primary->>'citizenship',''), c.citizenship),
         civil_status = coalesce(nullif(p_primary->>'civilStatus',''), c.civil_status),
         tin_number = coalesce(nullif(p_primary->>'tinNumber',''), c.tin_number),
         occupation_business_name = coalesce(nullif(p_primary->>'occupationBusinessName',''), c.occupation_business_name),
         office_business_address = coalesce(nullif(p_primary->>'officeBusinessAddress',''), c.office_business_address),
         employed_position = coalesce(nullif(p_primary->>'employedPosition',''), c.employed_position),
         -- Government ID number: write-only on every read path. Set only when
         -- the customer has none and no other customer already holds it (the
         -- unique index is per type+number; any collision is skipped and the
         -- document-review path flags duplicates separately).
         government_id_number = case
           when c.government_id_number is not null then c.government_id_number
           when nullif(p_header->>'governmentIdNumber','') is null then null
           when exists(
             select 1 from public.customers x
             where x.id <> c.id and x.government_id_number = p_header->>'governmentIdNumber'
           ) then c.government_id_number
           else p_header->>'governmentIdNumber'
         end,
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