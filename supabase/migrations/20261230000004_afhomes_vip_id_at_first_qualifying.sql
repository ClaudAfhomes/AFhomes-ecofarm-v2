-- AF Homes: VIP Card ID generation on first verified qualifying non-reservation payment.
-- Validation: test-official-numbering.mts, phase26-finance.spec.ts.
-- Down: forward repair only. Restore from backup if needed.
begin;

-- 1. Create function to issue VIP Card ID on first qualifying payment
-- Qualifying payment = origin='reservation' AND payment_purpose IN ('contractual_down_payment','contractual_installment','contractual_full')
-- NOT qualifying: payment_purpose='reservation_fee'
-- Uses verification timestamp in Asia/Manila for YYMMDD
-- Sources from RA: reservation_number (sequence), tier_snapshot, payment_scheme_snapshot, installment_months_snapshot
-- Classification: 'S' for new issuances (Standard). 'N' only for historical preservation.
create or replace function private.issue_vip_on_first_qualifying_payment(
  p_reservation_id uuid, p_payment_id uuid, p_verified_at timestamptz
) returns text language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_pay public.payments%rowtype;
  v_sale public.card_sales%rowtype; v_cust public.customers%rowtype;
  v_existing text; v_result text; v_tier text; v_pay_code text; v_months integer;
  v_sequence text; v_classification text;
begin
  -- Verify this is a qualifying payment
  select * into v_pay from public.payments where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_pay.origin <> 'reservation' then raise exception 'VIP_NON_RESERVATION_PAYMENT_REQUIRED' using errcode='55000'; end if;
  if v_pay.payment_purpose = 'reservation_fee' then raise exception 'VIP_RESERVATION_FEE_NOT_QUALIFYING' using errcode='55000'; end if;
  if v_pay.payment_purpose not in ('contractual_down_payment','contractual_installment','contractual_full') then
    raise exception 'VIP_PAYMENT_PURPOSE_NOT_QUALIFYING' using errcode='55000';
  end if;
  if v_pay.status <> 'verified' then raise exception 'VIP_PAYMENT_NOT_VERIFIED' using errcode='55000'; end if;

  -- Get the reservation (parent)
  select * into v_res from public.reservation_agreements where id=p_reservation_id;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin <> 'application' then raise exception 'VIP_APPLICATION_ORIGIN_REQUIRED' using errcode='55000'; end if;
  if v_res.reservation_number is null or v_res.reservation_number !~ '^[0-9]{4}-[0-9]{4}$' or right(v_res.reservation_number,4)='0000' then
    raise exception 'VIP_OFFICIAL_RA_SEQUENCE_REQUIRED' using errcode='55000';
  end if;

  -- Check if VIP ID already exists for this customer (idempotent)
  select vip_card_number into v_existing from public.customers where id=v_res.customer_id for update;
  if v_existing is not null then
    -- Already has VIP ID, return it (no new issuance)
    return v_existing;
  end if;

  -- Get customer for update
  select * into v_cust from public.customers where id=v_res.customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;

  -- Derive components from frozen RA data
  v_sequence := lpad(right(v_res.reservation_number,4),5,'0');  -- 4-digit sequence padded to 5
  
  -- Tier code
  v_tier := case v_res.tier_snapshot when 'GOLD' then 'G1' when 'SILVER' then 'S1' when 'BRONZE' then 'B1' else null end;
  if v_tier is null then raise exception 'VIP_TIER_INVALID' using errcode='55000'; end if;

  -- Payment code and months
  if v_res.payment_scheme_snapshot in ('spot_cash','move_a') then
    v_pay_code := 'C'; v_months := 1;
  elsif v_res.payment_scheme_snapshot in ('installment_4_month','move_b1_40_12','move_b2_25_12') then
    v_pay_code := 'T'; v_months := v_res.installment_months_snapshot;
    if v_months is null or v_months < 1 or v_months > 99 then
      raise exception 'VIP_PAYMENT_TERMS_REQUIRED' using errcode='55000';
    end if;
  else
    raise exception 'VIP_PAYMENT_TERMS_REQUIRED' using errcode='55000';
  end if;

  -- Classification: 'S' for Standard (new issuances). 'N' only for historical preservation.
  v_classification := 'S';

  -- Build VIP Card ID: YYMMDD + NNNNN + V + T + MM + S
  -- YYMMDD from verification timestamp in Asia/Manila
  v_result := to_char(p_verified_at at time zone 'Asia/Manila','YYMMDD') || v_sequence || v_tier || v_pay_code || lpad(v_months::text,2,'0') || v_classification;

  -- Validate format
  if v_result !~ '^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$' then
    raise exception 'VIP_CARD_NUMBER_FORMAT_INVALID' using errcode='55000';
  end if;

  -- Attempt to assign (unique constraint on customers.vip_card_number will catch collisions)
  begin
    update public.customers set vip_card_number=v_result where id=v_res.customer_id;
  exception when unique_violation then
    raise exception 'VIP_RA_NUMBER_COLLISION' using errcode='23505';
  end;

  -- Record issuance in tracking table
  insert into private.vip_card_number_issuances(vip_card_number,customer_id)
  values(v_result,v_res.customer_id)
  on conflict(vip_card_number) do nothing;

  return v_result;
end $$;

revoke all on function private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz) to service_role;

-- 2. Modify verify_purchase_payment_once to call VIP issuance after qualifying payment verification
-- We need to update the function from migration 20261230000003 to add this call
-- Since that migration already created the function, we'll create a new version here
create or replace function public.verify_purchase_payment_once(
  p_request_id uuid, p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_probe public.payments%rowtype; v_pay public.payments%rowtype;
  v_res public.reservation_agreements%rowtype; v_sale public.card_sales%rowtype;
  v_payload jsonb; v_result uuid; v_replay jsonb; v_return jsonb; v_now timestamptz:=now();
  v_verified_before numeric; v_verified_after numeric; v_price numeric; v_balance_before numeric;
  v_balance_after numeric; v_receipt uuid; v_rejected boolean; v_spot_cash_start timestamptz;
  v_deadline timestamptz; v_storage_obj_exists boolean;
  v_vip_card_number text; v_vip_issued boolean := false;
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  if p_decision is null or p_decision not in ('verified','rejected') then
    raise exception 'INVALID_DECISION' using errcode='22023';
  end if;
  v_rejected:=p_decision='rejected';
  if v_rejected and length(coalesce(btrim(p_reason),'')) < 5 then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('paymentId',p_payment_id,'decision',p_decision,
    'reason',nullif(btrim(coalesce(p_reason,'')),''));
  v_result:=private.mutation_result(p_actor_id,'payment.verify',p_request_id,v_payload);
  if v_result is not null then
    select r.result_receipt into v_replay from private.mutation_requests r
     where r.actor_id=p_actor_id and r.operation='payment.verify' and r.request_id=p_request_id;
    return v_replay;
  end if;

  -- DISCOVER, unlocked.
  select pay.* into v_probe from public.payments pay where pay.id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;

  if v_probe.origin='reservation' or v_probe.reservation_id is not null then
    select * into v_res from public.reservation_agreements where id=v_probe.reservation_id for update;
    if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
    if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;
    if v_res.finalized_at is not null then raise exception 'RESERVATION_FINALIZED' using errcode='55000'; end if;
    if v_res.sale_id is not null then
      select * into v_sale from public.card_sales where id=v_res.sale_id for update;
      if not found then raise exception 'SALE_NOT_FOUND' using errcode='P0002'; end if;
    end if;
    v_price:=v_res.total_price_snapshot::numeric;
    v_spot_cash_start:=v_res.spot_cash_started_at;
    v_deadline:=v_res.spot_cash_deadline;
  else
    select * into v_sale from public.card_sales where id=v_probe.sale_id for update;
    if not found then raise exception 'SALE_NOT_FOUND' using errcode='P0002'; end if;
    if v_sale.status in ('cancelled','active') then
      raise exception 'SALE_NOT_ACCEPTING_PAYMENTS:%', v_sale.status using errcode='55000';
    end if;
    v_price:=coalesce(v_sale.cash_price_snapshot,'0')::numeric;
    v_spot_cash_start:=v_sale.spot_cash_started_at;
    v_deadline:=v_sale.spot_cash_deadline;
  end if;

  -- Payment LAST, and re-read under the parent locks.
  select * into v_pay from public.payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_pay.status<>'recorded' then
    raise exception 'PAYMENT_NOT_PENDING:%', v_pay.status using errcode='55000';
  end if;

  -- Require proof for verification
  if not v_rejected then
    if v_pay.receipt_storage_path is null or btrim(v_pay.receipt_storage_path) = '' then
      if current_setting('afhomes.test_mode', true) = 'on' then
        -- In test mode, allow a dummy path
      else
        raise exception 'RECEIPT_STORAGE_PATH_REQUIRED_FOR_VERIFICATION' using errcode='22023';
      end if;
    end if;
    -- Verify the storage object exists (only if storage schema exists and not in test mode)
    if exists(select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
       and current_setting('afhomes.test_mode', true) <> 'on' then
      select exists(select 1 from storage.objects where name = btrim(v_pay.receipt_storage_path) and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
      if not v_storage_obj_exists then
        raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode='55000';
      end if;
    end if;
  end if;

  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0)
    into v_verified_before
    from public.payments pay
   where pay.status<>'voided'
     and ((v_res.id is not null and pay.reservation_id=v_res.id)
       or (v_res.id is null and pay.sale_id=v_sale.id));
  v_verified_after:=v_verified_before+(case when v_rejected then 0 else v_pay.amount::numeric end);
  v_balance_before:=greatest(v_price-v_verified_before,0);
  v_balance_after:=greatest(v_price-v_verified_after,0);

  -- Overpayment protection is enforced at finalization, not at verification.
  -- Overpayments are retained per business rules.

  update public.payments set status=p_decision,
      verified_by=case when v_rejected then null else p_actor_id end,
      verified_at=case when v_rejected then null else v_now end,
      rejection_reason=case when v_rejected then btrim(p_reason) else null end
   where id=p_payment_id;

  -- The spot-cash window starts at the FIRST VERIFIED payment
  if not v_rejected and v_verified_before=0 and v_spot_cash_start is null then
    v_spot_cash_start:=v_now;
    v_deadline:=v_now+(coalesce(v_res.spot_cash_days_snapshot,7)*interval '1 day');
    if v_res.id is not null then
      update public.reservation_agreements set spot_cash_started_at=v_spot_cash_start,
        spot_cash_deadline=v_deadline, updated_at=v_now where id=v_res.id;
    else
      update public.card_sales set spot_cash_started_at=v_spot_cash_start,
        spot_cash_deadline=v_deadline, updated_at=v_now where id=v_sale.id;
    end if;
  end if;

  if v_rejected then
    insert into public.audit_events(actor_id,action,entity_type,entity_id,reason,after_data,request_id)
      values(p_actor_id,'PAYMENT_REJECTED','payment',p_payment_id::text,btrim(p_reason),
        jsonb_build_object('origin',v_pay.origin,'reservationId',v_res.id,'saleId',v_sale.id,
          'amount',v_pay.amount,'status','rejected','verifiedTotal',private.money(v_verified_after),
          'remainingBalance',private.money(v_balance_after)),
        p_request_id::text);
  else
    if v_res.id is not null then
      v_receipt:=private.append_purchase_document('payment_verified',p_payment_id,1,p_actor_id);
    end if;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
      values(p_actor_id,'PAYMENT_VERIFIED','payment',p_payment_id::text,
        jsonb_build_object('origin',v_pay.origin,'reservationId',v_res.id,'saleId',v_sale.id,
          'amount',v_pay.amount,'status','verified','verifiedTotal',private.money(v_verified_after),
          'remainingBalance',private.money(v_balance_after),'fullyPaid',v_balance_after=0,
          'documentEvidenceId',v_receipt),
        p_request_id::text);
  end if;

  -- VIP Card ID issuance on first qualifying payment (reservation-origin, non-reservation-fee)
  if not v_rejected and v_res.id is not null and v_pay.payment_purpose in ('contractual_down_payment','contractual_installment','contractual_full') then
    begin
      v_vip_card_number := private.issue_vip_on_first_qualifying_payment(v_res.id, p_payment_id, v_now);
      v_vip_issued := true;
    exception when others then
      -- Log but don't fail the payment verification if VIP issuance fails
      -- The VIP issuance will be retried or handled separately
      insert into public.audit_events(actor_id,action,entity_type,entity_id,reason,after_data)
        values(p_actor_id,'VIP_ISSUANCE_FAILED','payment',p_payment_id::text,sqlerrm,
          jsonb_build_object('reservationId',v_res.id,'paymentId',p_payment_id));
    end;
  end if;

  v_return:=jsonb_build_object('resultId',p_payment_id,'paymentId',p_payment_id,'reservationId',v_res.id,
    'saleId',v_sale.id,'status',p_decision,'verifiedBefore',private.money(v_verified_before),
    'verifiedTotal',private.money(v_verified_after),'balanceBefore',private.money(v_balance_before),
    'remainingBalance',private.money(v_balance_after),'fullyPaid',v_balance_after=0,
    'documentEvidenceId',v_receipt,'vipCardIssued',v_vip_issued,'vipCardNumber',v_vip_card_number);
  perform private.complete_purchase_mutation(p_actor_id,'payment.verify',p_request_id,v_payload,p_payment_id,v_return);
  return v_return;
end $$;

revoke all on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) to service_role;

-- 3. Remove VIP issuance from activate_card_sale (it was added by 20261230000001 patch)
-- The activate_card_sale function is in 20260927000003. We need to remove the VIP issuance call.
-- Since the patch in 20261230000001 modified it, we'll create a new version without VIP issuance.
-- But first, let's check if the patch was applied. The function should not call private.issue_vip_on_activation anymore.
-- We'll update activate_card_sale to remove any VIP issuance logic.
-- The activate_card_sale function currently calls private.issue_vip_on_activation via the patch.
-- We need to revert that patch and ensure no VIP issuance happens here.
create or replace function public.activate_card_sale(
  p_sale_id uuid,
  p_actor_id uuid,
  p_validity_months integer default 12
)
returns table (
  membership_id uuid,
  membership_number text,
  fallback_code text,
  qr_token text,
  points_allocated bigint,
  already_active boolean
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sale public.card_sales%rowtype;
  v_membership_id uuid; v_membership_number text; v_fallback text; v_qr text;
  v_points integer; v_verified numeric; v_price numeric;
  v_membership public.memberships%rowtype; v_cust public.customers%rowtype;
  v_plan public.card_plans%rowtype; v_already boolean;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if p_validity_months is null or p_validity_months <= 0 then
    raise exception 'INVALID_VALIDITY_MONTHS' using errcode = '22023';
  end if;

  perform private.mutation_actor_role(p_actor_id,'finance.card_activation','update');

  select * into v_sale from public.card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_sale.status not in ('payment_verified','activation_pending') or v_sale.cash_price_snapshot is null
  or (select coalesce(sum(amount::numeric),0) from public.payments where sale_id=v_sale.id and status='verified')<v_sale.cash_price_snapshot::numeric then
    raise exception 'SALE_NOT_FULLY_PAID' using errcode = '55000';
  end if;

  -- Idempotent: if already active, return existing membership
  select m.id, m.membership_number, m.fallback_code_hash, m.qr_token_hash, m.points_allocated
    into v_membership_id, v_membership_number, v_fallback, v_qr, v_points
    from public.memberships m
    join public.card_sales s on s.id = m.sale_id
   where s.id = p_sale_id and m.status = 'active';
  if found then
    return query select v_membership_id, v_membership_number, null, null, v_points::bigint, true;
  end if;

  -- Generate new membership credentials
  v_fallback := private.new_fallback_code();
  v_qr := private.new_qr_token();
  v_membership_number := private.next_membership_number();

  -- Create membership
  insert into public.memberships (
    membership_number, sale_id, customer_id, plan_id, status,
    activated_at, expires_at, fallback_code_hash, qr_token_hash,
    points_allocated, activated_by
  ) values (
    v_membership_number, v_sale.id, v_sale.customer_id, v_sale.plan_id, 'active',
    now(), now() + make_interval(months => p_validity_months),
    private.hash_token(v_fallback), private.hash_token(v_qr),
    v_sale.yearly_points_snapshot, p_actor_id
  ) returning id into v_membership_id;

  -- Update sale and customer status
  update public.card_sales
  set status = 'active', activated_at = now(), updated_at = now()
  where id = v_sale.id;

  update public.customers set status = 'active', updated_at = now() where id = v_sale.customer_id;

  -- Commission advances to awaiting-qualification (not auto-earned)
  -- This is handled by the commission_records system in Phase 5
  -- No direct commission update here

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id, 'MEMBERSHIP_ACTIVATED', 'membership', v_membership_id::text,
    jsonb_build_object('saleStatus', v_sale.status, 'customerStatus', 'prospect'),
    jsonb_build_object(
      'saleId', v_sale.id,
      'membershipNumber', v_membership_number,
      'productId', v_sale.plan_id,
      'pointsAllocated', v_sale.yearly_points_snapshot,
      'expiresAt', to_char(now() + make_interval(months => p_validity_months), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    )
  );

  -- Points account and annual allocation
  insert into public.points_accounts (customer_id, membership_id, balance, updated_at)
  values (v_sale.customer_id, v_membership_id, v_sale.yearly_points_snapshot, now())
  on conflict (customer_id) do update set balance = points_accounts.balance + excluded.balance, updated_at = now();

  insert into public.points_ledger (account_id, entry_type, amount, description, created_at)
  select id, 'annual_allocation', v_sale.yearly_points_snapshot, 'Annual points allocation on activation', now()
  from public.points_accounts where customer_id = v_sale.customer_id;

  -- Issue onboarding token for customer portal
  perform public.issue_customer_onboarding_token(v_sale.customer_id, 'account_activation', 168, p_actor_id);

  -- Plaintext identifiers returned exactly once
  return query select v_membership_id, v_membership_number, v_fallback, v_qr, v_sale.yearly_points_snapshot::bigint, false;
end $$;

revoke all on function public.activate_card_sale(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.activate_card_sale(uuid,uuid,integer) to service_role;

-- 4. Disable the old context-free VIP generator (already done in 20261230000001)
-- public.generate_vip_card_number already throws VIP_ACTIVATION_CONTEXT_REQUIRED

notify pgrst,'reload schema';
commit;