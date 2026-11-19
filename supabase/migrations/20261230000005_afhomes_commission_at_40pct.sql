-- AF Homes: Commission entitlement at 40% cumulative verified settlement.
-- Persistent commission records created at RA creation, eligible at 40%, payout via authorized action.
-- Validation: phase26-finance.spec.ts, commission lifecycle tests.
-- Down: forward repair only. Restore from backup if needed.
begin;

-- 1. Create commission_records table (persistent, linked to reservation, converted to commissions at finalization)
create table if not exists public.commission_records (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservation_agreements(id) on delete restrict,
  sale_id uuid references public.card_sales(id) on delete restrict,  -- nullable until finalization
  beneficiary_type text not null check (beneficiary_type in ('staff','ost')),
  beneficiary_staff_id uuid references public.staff_users(id) on delete restrict,  -- SM seller (set when type='staff')
  beneficiary_ost_id uuid references public.ost_members(id) on delete restrict,    -- OST upline (set when type='ost')
  commission_rule_id uuid references public.commission_rules(id) on delete restrict,
  rate_snapshot text not null check (rate_snapshot ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'),
  basis_amount_snapshot text not null check (basis_amount_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  expected_amount text not null check (expected_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  cumulative_verified text not null default '0.00' check (cumulative_verified ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  status text not null default 'pending' check (status in ('pending','eligible','paid','cancelled')),
  eligible_at timestamptz,
  paid_at timestamptz,
  paid_reference text,
  qualified_by uuid references public.staff_users(id) on delete restrict,
  qualification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ensure correct beneficiary column is set based on type
  check (
    (beneficiary_type = 'staff' and beneficiary_staff_id is not null and beneficiary_ost_id is null)
    or (beneficiary_type = 'ost' and beneficiary_ost_id is not null and beneficiary_staff_id is null)
  )
);
-- Unique constraint enforces one record per beneficiary per reservation
-- Matches ON CONFLICT clause in create_commission_records function
alter table public.commission_records
  add constraint commission_records_unique_per_reservation_beneficiary
  unique (reservation_id, beneficiary_type, beneficiary_staff_id, beneficiary_ost_id);
alter table public.commission_records enable row level security;
revoke all on public.commission_records from public, anon, authenticated, service_role;
create policy commission_records_read on public.commission_records for select to authenticated
  using (private.has_permission('network.commissions'));
-- Updates go through service role which bypasses RLS; no policy needed for authenticated
-- create policy commission_records_update on public.commission_records for update to authenticated
--   using (private.has_permission('network.commissions'));
-- No GRANT to authenticated needed - all updates go through service role which bypasses RLS
-- grant select, update on public.commission_records to authenticated;

-- Indexes for query performance
create index if not exists commission_records_reservation_idx on public.commission_records (reservation_id);
create index if not exists commission_records_status_idx on public.commission_records (status);
create index if not exists commission_records_beneficiary_staff_idx on public.commission_records (beneficiary_staff_id);
create index if not exists commission_records_beneficiary_ost_idx on public.commission_records (beneficiary_ost_id);

-- 3. Function to create commission records at RA creation
-- Called from reserve_application_purchase_once after RA is created
create or replace function private.create_commission_records(p_reservation_id uuid, p_actor_id uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_terms public.customer_application_purchase_terms%rowtype;
  v_seller_staff_id uuid; v_upline_ost_id uuid; v_commission_rule_id uuid;
  v_rate text; v_basis text; v_expected text;
  v_rec record;
begin
  select * into v_res from public.reservation_agreements where id=p_reservation_id;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin <> 'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;

  select * into v_terms from public.customer_application_purchase_terms where id=v_res.purchase_terms_id;
  if not found then raise exception 'PURCHASE_TERMS_NOT_FOUND' using errcode='P0002'; end if;

  v_seller_staff_id := v_res.seller_staff_id;
  v_rate := v_terms.commission_rate;
  v_basis := v_terms.total_price;
  v_expected := v_terms.expected_commission;
  v_commission_rule_id := v_terms.commission_rule_id;

  -- Validate rate and basis
  if v_rate is null or v_rate !~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$' then
    raise exception 'INVALID_COMMISSION_RATE' using errcode='22023';
  end if;
  if v_basis is null or v_basis !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then
    raise exception 'INVALID_COMMISSION_BASIS' using errcode='22023';
  end if;
  if v_expected is null or v_expected !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then
    raise exception 'INVALID_EXPECTED_COMMISSION' using errcode='22023';
  end if;

  -- Create record for SM seller (always)
  insert into public.commission_records (
    reservation_id, beneficiary_type, beneficiary_staff_id,
    commission_rule_id, rate_snapshot, basis_amount_snapshot, expected_amount,
    cumulative_verified, status
  ) values (
    p_reservation_id, 'staff', v_seller_staff_id,
    v_commission_rule_id, v_rate, v_basis, v_expected,
    '0.00', 'pending'
  ) on conflict (reservation_id, beneficiary_type, beneficiary_staff_id, beneficiary_ost_id) do nothing;

  -- Determine OST upline if exists (only if active authoritative OST upline in referral_relationships)
  select rr.upline_staff_id into v_upline_ost_id
  from public.referral_relationships rr
  join public.ost_members om on om.id = rr.upline_staff_id
  where rr.subject_staff_id = v_seller_staff_id
    and rr.is_active and rr.is_authoritative
    and rr.hierarchy_role = 'ost'
    and om.status = 'active'
  limit 1;

  if v_upline_ost_id is not null then
    insert into public.commission_records (
      reservation_id, beneficiary_type, beneficiary_ost_id,
      commission_rule_id, rate_snapshot, basis_amount_snapshot, expected_amount,
      cumulative_verified, status
    ) values (
      p_reservation_id, 'ost', v_upline_ost_id,
      v_commission_rule_id, v_rate, v_basis, v_expected,
      '0.00', 'pending'
    ) on conflict (reservation_id, beneficiary_type, beneficiary_staff_id, beneficiary_ost_id) do nothing;
  end if;

  -- Audit
  for v_rec in select * from public.commission_records where reservation_id = p_reservation_id loop
    insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
      values(p_actor_id,'COMMISSION_RECORD_CREATED','commission_record',v_rec.id::text,
        jsonb_build_object('reservationId',p_reservation_id,'beneficiaryType',v_rec.beneficiary_type,
          'beneficiaryStaffId',v_rec.beneficiary_staff_id,'beneficiaryOstId',v_rec.beneficiary_ost_id,
          'rate',v_rec.rate_snapshot,'basis',v_rec.basis_amount_snapshot,'expected',v_rec.expected_amount));
  end loop;
end $$;

revoke all on function private.create_commission_records(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.create_commission_records(uuid,uuid) to service_role;

-- 4. Function to update cumulative verified and check 40% threshold
-- Called from verify_purchase_payment_once after each payment verification
create or replace function private.update_commission_cumulative(p_reservation_id uuid, p_actor_id uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype;
  v_cumulative_verified numeric;
  v_cr public.commission_records%rowtype;
  v_eligible boolean;
begin
  select * into v_res from public.reservation_agreements where id=p_reservation_id;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;

  -- Calculate cumulative verified payments for this reservation
  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0)
    into v_cumulative_verified
    from public.payments pay
    where pay.reservation_id = p_reservation_id and pay.status <> 'voided';

  -- Update all commission records for this reservation
  for v_cr in select * from public.commission_records where reservation_id = p_reservation_id for update loop
    -- Update cumulative verified
    update public.commission_records
      set cumulative_verified = private.money(v_cumulative_verified),
          updated_at = now()
      where id = v_cr.id;

    -- Check 40% threshold
    v_eligible := v_cumulative_verified >= (v_cr.basis_amount_snapshot::numeric * 0.40);
    if v_eligible and v_cr.status = 'pending' then
      update public.commission_records
        set status = 'eligible', eligible_at = now(), updated_at = now()
        where id = v_cr.id;

      insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
        values(p_actor_id,'COMMISSION_ELIGIBLE_AUTO','commission_record',v_cr.id::text,
          jsonb_build_object('cumulativeVerified',private.money(v_cumulative_verified),
            'threshold','0.40','basis',v_cr.basis_amount_snapshot));
    end if;
  end loop;
end $$;

revoke all on function private.update_commission_cumulative(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.update_commission_cumulative(uuid,uuid) to service_role;

-- 5. RPC for authorized commission payout (separate action, not automatic)
create or replace function public.request_commission_payout(
  p_commission_record_id uuid, p_actor_id uuid, p_reference text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_cr public.commission_records%rowtype; v_payload jsonb; v_result uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'network.commissions','update');
  if p_actor_id is null then raise exception 'ACTOR_REQUIRED' using errcode='42501'; end if;
  if p_commission_record_id is null then raise exception 'COMMISSION_RECORD_ID_REQUIRED' using errcode='22023'; end if;
  if p_reference is null or length(btrim(p_reference)) < 3 then
    raise exception 'PAYOUT_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  select * into v_cr from public.commission_records where id=p_commission_record_id for update;
  if not found then raise exception 'COMMISSION_RECORD_NOT_FOUND' using errcode='P0002'; end if;
  if v_cr.status <> 'eligible' then
    raise exception 'COMMISSION_NOT_ELIGIBLE_FOR_PAYOUT' using errcode='55000';
  end if;

  -- Idempotency via mutation request
  v_payload:=jsonb_build_object('commissionRecordId',p_commission_record_id,'reference',p_reference);
  v_result:=private.mutation_result(p_actor_id,'commission.payout',gen_random_uuid(),v_payload);
  if v_result is not null then return v_result; end if;

  update public.commission_records
    set status = 'paid', paid_at = now(), paid_reference = btrim(p_reference), updated_at = now()
    where id = p_commission_record_id;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'COMMISSION_PAID','commission_record',p_commission_record_id::text,
      jsonb_build_object('amount',v_cr.expected_amount,'reference',btrim(p_reference),
        'beneficiaryType',v_cr.beneficiary_type,'beneficiaryStaffId',v_cr.beneficiary_staff_id,
        'beneficiaryOstId',v_cr.beneficiary_ost_id));

  perform private.complete_purchase_mutation(p_actor_id,'commission.payout',gen_random_uuid(),v_payload,p_commission_record_id,
    jsonb_build_object('resultId',p_commission_record_id,'status','paid'));

  return p_commission_record_id;
end $$;

revoke all on function public.request_commission_payout(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.request_commission_payout(uuid,uuid,text) to service_role;

-- 6. Modify reserve_application_purchase_once to call create_commission_records
-- The function was redefined in 20261230000002. We need to update it to call create_commission_records.
-- Since we already created the full function in 20261230000002, we'll create a patch here.
do $patch$
declare d text; marker text:='  perform private.complete_purchase_mutation(p_actor_id,''reservation.create'',p_request_id,v_payload,v_id,';
begin
  select pg_get_functiondef('public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) into d;
  if position('private.create_commission_records' in d)=0 then
    if position(marker in d)=0 then raise exception 'RESERVE_COMMISSION_PATCH_MARKER_NOT_FOUND'; end if;
    execute replace(d,marker,
      '  perform private.create_commission_records(v_id,p_actor_id);'||chr(10)||marker);
  end if;
end $patch$;

-- 7. Modify verify_purchase_payment_once to call update_commission_cumulative
-- Already done in 20261230000004

-- 8. Modify finalize_reservation_purchase_once to link commission records to sale
-- The function is in 20261101000001. We need to update it to set sale_id on commission_records.
-- Replace the entire function with updated version that links commission_records.
create or replace function public.finalize_reservation_purchase_once(
  p_request_id uuid, p_reservation_id uuid, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_app_id uuid;
  v_res public.reservation_agreements%rowtype;
  v_terms public.customer_application_purchase_terms%rowtype;
  v_sale public.card_sales%rowtype;
  v_total numeric; v_verified numeric; v_recorded integer; v_pending integer;
  v_sale_id uuid; v_number text; v_result uuid; v_payload jsonb; v_return jsonb;
  v_now timestamptz:=now(); v_receipt uuid; v_balance_due timestamptz;
  v_relationship uuid; v_commission_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('reservationId',p_reservation_id);
  v_result:=private.mutation_result(p_actor_id,'purchase.finalize',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  v_app_id:=(select r.customer_application_id from public.reservation_agreements r where r.id=p_reservation_id);
  if v_app_id is null then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_app from public.customer_applications where id=v_app_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;

  select * into v_res from public.reservation_agreements where id=p_reservation_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;

  if v_res.sale_id is not null then
    select * into v_sale from public.card_sales where id=v_res.sale_id for update;
    if not found then raise exception 'SALE_NOT_FOUND' using errcode='P0002'; end if;
  end if;

  perform 1 from public.payments pay where pay.reservation_id=v_res.id order by pay.id for update;

  if v_res.sale_id is not null then
    if v_res.finalized_at is null then
      raise exception 'RESERVATION_ALREADY_FINALIZED' using errcode='55000';
    end if;
    perform private.complete_purchase_mutation(p_actor_id,'purchase.finalize',p_request_id,
      v_payload,v_res.sale_id,jsonb_build_object('resultId',v_res.sale_id,'saleId',v_res.sale_id,
        'status','payment_verified','reservationId',v_res.id,'fullyPaid',true));
    return v_res.sale_id;
  end if;

  if v_res.status<>'executed' then raise exception 'RESERVATION_NOT_EXECUTED' using errcode='55000'; end if;
  if v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;
  if v_app.sale_id is not null then raise exception 'APPLICATION_ALREADY_FINALIZED' using errcode='55000'; end if;

  if v_res.purchase_terms_id is null then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;
  select * into v_terms from public.customer_application_purchase_terms where id=v_res.purchase_terms_id;
  if not found then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  if v_terms.application_id<>v_res.customer_application_id or v_terms.customer_id<>v_res.customer_id
     or v_terms.plan_id<>v_res.plan_id or v_terms.seller_staff_id<>v_res.seller_staff_id then
    raise exception 'PURCHASE_TERMS_IDENTITY_INVALID' using errcode='23514';
  end if;

  perform private.purchase_seller_for(p_actor_id,v_terms.seller_staff_id);

  v_total:=v_terms.total_price::numeric;
  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0),
         count(*) filter (where pay.status='recorded')::integer,
         coalesce(sum(pay.amount::numeric) filter (where pay.status='recorded'),0)
    into v_verified, v_pending, v_recorded
    from public.payments pay
   where pay.reservation_id=v_res.id and pay.status<>'voided';
  -- A recorded-but-undecided payment is money nobody has decided about. Finalizing
  -- over it would let a later rejection silently unbalance a "paid in full" sale,
  -- so it BLOCKS instead of being ignored.
  if v_pending>0 then raise exception 'RESERVATION_UNDECIDED_PAYMENTS' using errcode='55000'; end if;
  if v_verified < v_total then
    raise exception 'RESERVATION_NOT_FULLY_PAID' using errcode='55000';
  end if;

  v_number:=(select sale_number from public.next_sale_number());
  v_balance_due:=coalesce(
    v_res.spot_cash_deadline,
    (select max(line.payment_date) from public.reservation_agreement_schedule line
      where line.agreement_id=v_res.id),
    v_res.spot_cash_started_at,
    v_now)+make_interval(months=>coalesce(v_terms.installment_months,12));
  select r.id into v_relationship from public.referral_relationships r
   where r.subject_staff_id=v_res.seller_staff_id and r.is_active is true
   order by r.is_authoritative desc nulls last, r.id limit 1;

  insert into public.card_sales(
    sale_number,customer_id,plan_id,seller_type,seller_staff_id,seller_ost_id,
    cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
    payment_scheme,reservation_fee_snapshot,required_initial_snapshot,
    installment_months_snapshot,monthly_amount_snapshot,validity_months_snapshot,
    commission_rate_snapshot,commission_rule_id,commission_base_snapshot,
    expected_commission_snapshot,status,submitted_at,payment_verified_at,fully_paid_at,
    balance_due_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id,created_by)
  values(v_number,v_res.customer_id,v_res.plan_id,'staff',v_res.seller_staff_id,null,
    v_terms.total_price,v_terms.total_price,v_terms.minimum_down_payment,v_terms.yearly_points,
    v_terms.payment_scheme,v_terms.reservation_fee,v_terms.required_initial,
    v_terms.installment_months,v_terms.monthly_amount,v_terms.validity_months,
    v_terms.commission_rate,v_terms.commission_rule_id,v_terms.commission_base,
    v_terms.expected_commission,'payment_verified',v_now,v_now,v_now,
    v_balance_due,v_res.spot_cash_started_at,v_res.spot_cash_deadline,v_relationship,p_actor_id)
  returning id into v_sale_id;

  insert into public.commissions(
    sale_id,ost_id,beneficiary_type,beneficiary_staff_id,amount,rate_snapshot,
    basis_amount_snapshot,commission_rule_id,status)
  values(v_sale_id,null,'staff',v_res.seller_staff_id,v_terms.expected_commission::numeric,
    v_terms.commission_rate,v_terms.commission_base,v_terms.commission_rule_id,'payment_verified')
  returning id into v_commission_id;

  update public.payments set sale_id=v_sale_id where reservation_id=v_res.id and sale_id is null;

  update public.reservation_agreements
     set sale_id=v_sale_id, finalized_at=v_now, finalized_by=p_actor_id, updated_at=v_now
   where id=v_res.id;
  update public.customer_applications
     set sale_id=v_sale_id, updated_at=v_now
   where id=v_app.id and sale_id is null;

  -- Link commission records to sale
  update public.commission_records set sale_id=v_sale_id, updated_at=now() where reservation_id=v_res.id;

  v_receipt:=private.append_purchase_document('purchase_finalized',v_sale_id,1,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'PURCHASE_FINALIZED','card_sale',v_sale_id::text,
      jsonb_build_object('saleNumber',v_number,'saleId',v_sale_id,'reservationId',v_res.id,
        'reservationNumber',v_res.reservation_number,'applicationId',v_app.id,
        'purchaseTermsId',v_terms.id,'termsVersion',v_terms.version,'sellerStaffId',v_res.seller_staff_id,
        'frozenTotal',v_terms.total_price,'verifiedTotal',private.money(v_verified),
        'expectedCommission',v_terms.expected_commission,'commissionId',v_commission_id,
        'documentEvidenceId',v_receipt),
      p_request_id::text);
  v_return:=jsonb_build_object('resultId',v_sale_id,'saleId',v_sale_id,'reservationId',v_res.id,
    'saleNumber',v_number,'status','payment_verified','purchaseTermsId',v_terms.id,
    'termsVersion',v_terms.version,'verifiedTotal',private.money(v_verified),
    'remainingBalance','0.00','fullyPaid',true,'commissionId',v_commission_id,
    'documentEvidenceId',v_receipt);
  perform private.complete_purchase_mutation(p_actor_id,'purchase.finalize',p_request_id,
    v_payload,v_sale_id,v_return);
  return v_sale_id;
end $$;

revoke all on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) to service_role;

-- 9. Modify private.purchase_seller_for to enforce SM-only sale creation
-- The function is in 20261101000001. Currently allows ost, sales_manager, senior_sales_manager, vice_director, admin, super_admin.
-- We need to allow Finance, Admin, Super Admin to finalize any seller; SM only their downline.
create or replace function private.purchase_seller_for(p_actor uuid,p_candidate uuid)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_status text; v_role text;
begin
  if p_candidate is null or p_candidate=p_actor then
    select su.status,private.staff_role_slug(su.id) into v_status,v_role
      from public.staff_users su where su.id=p_actor;
    if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
    -- Allow super_admin, admin, finance to act as their own seller
    if v_role is null or v_role not in ('sales_manager','senior_sales_manager','vice_director','admin','super_admin','finance') then
      raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
    end if;
    return p_actor;
  end if;
  select su.status,private.staff_role_slug(su.id) into v_status,v_role
    from public.staff_users su where su.id=p_candidate;
  if not found then raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501'; end if;
  if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
  -- Finance, Admin, Super Admin can finalize any seller (check actor role FIRST)
  select private.staff_role_slug(p_actor) into v_role;
  if v_role in ('finance','admin','super_admin') then
    if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin','finance') then
      raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
    end if;
    return p_candidate;
  end if;
  -- For other actors (SM, SSM, VD, OST), validate candidate role
  if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin') then
    raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
  end if;
  -- Two levels of active downline
  if private.staff_role_slug(p_actor) is distinct from 'super_admin' and not exists(
    select 1 from public.referral_relationships r where r.is_active
      and r.subject_staff_id=p_candidate and r.upline_staff_id=p_actor) and not exists(
    select 1 from public.referral_relationships child
      join public.referral_relationships grandchild on grandchild.upline_staff_id=child.subject_staff_id
     where child.is_active and grandchild.is_active
       and child.upline_staff_id=p_actor and grandchild.subject_staff_id=p_candidate) then
    raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501';
  end if;
  return p_candidate;
end $$;

revoke all on function private.purchase_seller_for(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.purchase_seller_for(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;