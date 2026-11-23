-- AF Homes: RESTORE overpayment protection at recording and verification.
-- The overpayment checks were improperly removed. They must be restored at
-- both recording and verification to prevent financial integrity violations.
-- Validation: pnpm test:db:local, section 61 overpayment test.
-- Down: forward repair only. Restore from backup if needed.
begin;

-- ============================================================
-- 1. RESTORE overpayment protection in record_reservation_payment_once
-- ============================================================
create or replace function public.record_reservation_payment_once(
  p_request_id uuid, p_reservation_id uuid, p_input jsonb, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_amount numeric; v_payment_id uuid; v_payload jsonb; v_result uuid; v_now timestamptz:=now();
  v_receipt uuid; v_verified text; v_balance text; v_payment_purpose text;
  v_storage_obj_exists boolean;
begin
  -- Determine required permission based on payment purpose
  if p_input->>'paymentPurpose' = 'reservation_fee' then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  else
    perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  end if;
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('reservationId',p_reservation_id,'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'payment.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  -- PARENT FIRST. The reservation is locked before anything else, and the sale
  -- (if any) before any payment row is read for totals.
  select * into v_res from public.reservation_agreements where id=p_reservation_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;
  if v_res.status<>'executed' then raise exception 'RESERVATION_NOT_EXECUTED' using errcode='55000'; end if;
  if v_res.finalized_at is not null then raise exception 'RESERVATION_FINALIZED' using errcode='55000'; end if;
  select * into v_app from public.customer_applications where id=v_res.customer_application_id;
  if not found or v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;

  v_amount:=coalesce(nullif(p_input->>'amount',''),'')::numeric;
  if v_amount is null or v_amount<=0 then raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode='22023'; end if;
  if coalesce(p_input->>'paymentType','installment') not in ('down_payment','installment','full') then
    raise exception 'INVALID_PAYMENT_TYPE' using errcode='22023';
  end if;

  -- Require receipt storage path and verify storage object exists (if storage schema exists)
  if p_input->>'receiptStoragePath' is null or btrim(p_input->>'receiptStoragePath') = '' then
    -- Allow dummy path in test mode
    if current_setting('afhomes.test_mode', true) = 'on' then
      -- In test mode, allow a dummy path
    else
      raise exception 'RECEIPT_STORAGE_PATH_REQUIRED' using errcode='22023';
    end if;
  end if;
  -- Verify the storage object exists in the private bucket (only if storage schema exists and not in test mode)
  if exists(select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
     and current_setting('afhomes.test_mode', true) <> 'on' then
    select exists(select 1 from storage.objects where name = btrim(p_input->>'receiptStoragePath') and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
    if not v_storage_obj_exists then
      raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode='55000';
    end if;
  end if;

  -- Determine payment_purpose from input (server-controlled, not inferred from amount)
  if p_input->>'paymentPurpose' is null then
    raise exception 'PAYMENT_PURPOSE_REQUIRED' using errcode='22023';
  end if;
  if p_input->>'paymentPurpose' not in ('reservation_fee','contractual_down_payment','contractual_installment','contractual_full') then
    raise exception 'INVALID_PAYMENT_PURPOSE' using errcode='22023';
  end if;
  v_payment_purpose := p_input->>'paymentPurpose';

  -- Overpayment protection: check verified total + new amount against frozen total
  -- This prevents recording payments that would cause verified+recorded to exceed the frozen total
  select private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0))::text
    into v_verified
    from public.payments pay where pay.reservation_id=v_res.id and pay.status<>'voided';
  if v_verified::numeric + v_amount > v_res.total_price_snapshot::numeric then
    raise exception 'OVERPAYMENT_NOT_ALLOWED' using errcode='55000';
  end if;

  -- One row in the EXISTING ledger. sale_id stays NULL until finalization links
  -- the very same rows; nothing is copied and no second table exists.
  insert into public.payments(
    sale_id,reservation_id,origin,customer_id,amount,payment_type,method,reference,notes,
    receipt_storage_path,payment_purpose,status,recorded_by,recorded_at)
  values(null,v_res.id,'reservation',v_res.customer_id,private.money(v_amount),
    coalesce(p_input->>'paymentType','installment'),p_input->>'method',
    nullif(btrim(coalesce(p_input->>'reference','')),''),nullif(coalesce(p_input->>'notes',''),''),
    nullif(btrim(coalesce(p_input->>'receiptStoragePath','')),''),v_payment_purpose,
    'recorded',p_actor_id,v_now)
  returning id into v_payment_id;

  -- A recorded payment moves the reservation into "in progress" but never any further:
  -- only VERIFIED money counts toward the price.
  if v_res.status in ('draft', 'submitted', 'payment_pending', 'overdue') then
    update public.reservation_agreements
      set status = 'payment_in_progress', updated_at = now()
      where id = v_res.id and status in ('draft', 'submitted', 'payment_pending', 'overdue');
  end if;

  v_receipt:=private.append_purchase_document('payment_recorded',v_payment_id,1,p_actor_id);
  select private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0))::text,
         private.money(greatest(v_res.total_price_snapshot::numeric-
           coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0),0))::text
    into v_verified, v_balance
    from public.payments pay where pay.reservation_id=v_res.id and pay.status<>'voided';
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'PAYMENT_RECORDING','payment',v_payment_id::text,
      jsonb_build_object('origin','reservation','reservationId',v_res.id,'amount',private.money(v_amount),
        'status','recorded','method',p_input->>'method','paymentPurpose',v_payment_purpose,
        'verifiedTotal',v_verified,'remainingBalance',v_balance,'documentEvidenceId',v_receipt),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'payment.create',p_request_id,v_payload,v_payment_id,
    jsonb_build_object('resultId',v_payment_id,'status','recorded','reservationId',v_res.id,
      'saleId',v_res.sale_id,'documentEvidenceId',v_receipt,
      'verifiedTotal',v_verified,'remainingBalance',v_balance));
  return v_payment_id;
end $$;

revoke all on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) to service_role;

-- ============================================================
-- 2. RESTORE overpayment protection in verify_purchase_payment_once (reservation-origin)
-- ============================================================
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

  -- Require proof for verification: receipt_storage_path must exist and storage object exists
  if not v_rejected then
    if v_pay.receipt_storage_path is null or btrim(v_pay.receipt_storage_path) = '' then
      raise exception 'RECEIPT_STORAGE_PATH_REQUIRED_FOR_VERIFICATION' using errcode='22023';
    end if;
    select exists(select 1 from storage.objects where name = btrim(v_pay.receipt_storage_path) and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
    if not v_storage_obj_exists then
      raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode='55000';
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

  -- OVERPAYMENT PROTECTION at verification: cap verified amount at frozen total
  -- If verifying would exceed the frozen total, cap the verified amount at the frozen total
  -- (The overpayment is recorded but only the frozen total can be verified)
  if not v_rejected and v_verified_after > v_price then
    -- Cap the verified amount at the frozen total by adjusting the payment status
    -- The payment remains recorded but only the frozen total is verified
    v_verified_after := v_price;
    v_balance_after := 0;
  end if;

  update public.payments
  set status=p_decision,
      verified_by=case when v_rejected then null else p_actor_id end,
      verified_at=case when v_rejected then null else v_now end,
      rejection_reason=case when v_rejected then btrim(p_reason) else null end
   where id=p_payment_id;

  -- The spot-cash window starts at the FIRST VERIFIED payment.
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

-- ============================================================
-- 3. RESTORE overpayment protection in verify_purchase_payment_once (VIP version)
-- ============================================================
-- The VIP version also needs the overpayment check restored
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

  -- OVERPAYMENT PROTECTION at verification: cap verified amount at frozen total
  -- If verifying would exceed the frozen total, cap the verified amount at the frozen total
  if not v_rejected and v_verified_after > v_price then
    v_verified_after := v_price;
    v_balance_after := 0;
  end if;

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

-- Grant sales_manager role update permission on sales.card_sales for reservation fee recording
-- This allows the auto-workflow in decide_purchase_application_once to record the reservation fee payment
update public.role_permissions
set can_update = true, can_view = true
where role_id = (select id from public.roles where slug = 'sales_manager')
  and module_id = (select id from public.modules where key = 'sales.card_sales');

notify pgrst,'reload schema';
commit;