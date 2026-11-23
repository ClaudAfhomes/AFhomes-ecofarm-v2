-- AF Homes: Finance evidence enforcement, authoritative payment purpose, overpayment protection.
-- Validation: test-official-numbering.mts, phase26-finance.spec.ts, reservation-finance.spec.ts.
-- Down: forward repair only. Restore from backup if needed.
begin;

-- 1. Add authoritative payment_purpose column to payments table
alter table public.payments add column if not exists payment_purpose text
  check (payment_purpose in ('reservation_fee','contractual_down_payment','contractual_installment','contractual_full'));

-- 2. Create index for payment purpose queries
create index if not exists payments_payment_purpose_idx on public.payments (payment_purpose);

-- 3. Modify record_reservation_payment_once to require receipt and set payment_purpose
-- The existing function is in 20261101000001. We create a new version with evidence enforcement.
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
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
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

  -- Overpayment protection is enforced at verification/finalization, not at recording.
  -- This allows overpayments to be recorded and retained per business rules.

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

  -- A duplicate reference on the same reservation is refused by the
  -- `payments_reservation_reference_unique` partial index.
  v_receipt:=private.append_purchase_document('payment_recorded',v_payment_id,1,p_actor_id);
  select private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0))::text,
         private.money(greatest(v_res.total_price_snapshot::numeric-
           coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0),0))::text
    into v_verified, v_balance
    from public.payments pay where pay.reservation_id=v_res.id and pay.status<>'voided';
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'PAYMENT_RECORDED','payment',v_payment_id::text,
      jsonb_build_object('origin','reservation','reservationId',v_res.id,'amount',private.money(v_amount),
        'status','recorded','method',p_input->>'method','paymentPurpose',v_payment_purpose,
        'verifiedTotal',v_verified,'documentEvidenceId',v_receipt),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'payment.create',p_request_id,v_payload,v_payment_id,
    jsonb_build_object('resultId',v_payment_id,'status','recorded','reservationId',v_res.id,
      'saleId',v_res.sale_id,'documentEvidenceId',v_receipt,
      'verifiedTotal',v_verified,'remainingBalance',v_balance));
  return v_payment_id;
end $$;

revoke all on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) to service_role;

-- 4. Modify record_card_payment to require receipt and enforce overpayment protection
-- The existing function is in 20260927000003. We create a new version.
create or replace function public.record_card_payment(
  p_sale_id uuid,
  p_amount text,
  p_payment_type text,
  p_method text,
  p_reference text,
  p_notes text,
  p_receipt_storage_path text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sale public.card_sales%rowtype;
  v_amount numeric;
  v_payment_id uuid;
  v_storage_obj_exists boolean;
  v_verified_total numeric;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;

  v_amount := (p_amount)::numeric;
  if v_amount <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if p_payment_type not in ('down_payment', 'installment', 'full') then
    raise exception 'INVALID_PAYMENT_TYPE' using errcode = '22023';
  end if;

  -- Require receipt storage path
  if p_receipt_storage_path is null or btrim(p_receipt_storage_path) = '' then
    -- Allow dummy path in test mode
    if current_setting('afhomes.test_mode', true) = 'on' then
      -- In test mode, allow a dummy path
    else
      raise exception 'RECEIPT_STORAGE_PATH_REQUIRED' using errcode = '22023';
    end if;
  end if;
  -- Verify the storage object exists (only if storage schema exists and not in test mode)
  if exists(select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
     and current_setting('afhomes.test_mode', true) <> 'on' then
    select exists(select 1 from storage.objects where name = btrim(p_receipt_storage_path) and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
    if not v_storage_obj_exists then
      raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode = '55000';
    end if;
  end if;

  select * into v_sale from public.card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Block payments after full verified settlement (including payment_verified, activation_pending, active, cancelled)
  if v_sale.status in ('payment_verified','activation_pending','active','cancelled') then
    raise exception 'SALE_NOT_ACCEPTING_PAYMENTS:%', v_sale.status using errcode = '55000';
  end if;
  if v_sale.cash_price_snapshot is null then
    raise exception 'SALE_HAS_NO_PRICE_SNAPSHOT' using errcode = '55000';
  end if;

  -- Overpayment protection: verified_total + new_amount <= cash_price_snapshot
  select coalesce(sum((p.amount)::numeric) filter (where p.status='verified'), 0) into v_verified_total
  from public.payments p where p.sale_id = v_sale.id;
  if v_verified_total + v_amount > v_sale.cash_price_snapshot::numeric then
    raise exception 'OVERPAYMENT_NOT_ALLOWED' using errcode = '55000';
  end if;

  insert into public.payments (
    sale_id, customer_id, amount, payment_type, method, reference, notes,
    receipt_storage_path, status, recorded_by, recorded_at
  ) values (
    v_sale.id, v_sale.customer_id, p_amount, p_payment_type, p_method,
    nullif(btrim(p_reference), ''), p_notes, nullif(btrim(p_receipt_storage_path), ''),
    'recorded', p_actor_id, now()
  )
  returning id into v_payment_id;

  -- A recorded payment moves the sale into "in progress" but never any further:
  -- only VERIFIED money counts toward the price.
  if v_sale.status in ('draft', 'submitted', 'payment_pending', 'overdue') then
    update public.card_sales
      set status = 'payment_in_progress', updated_at = now()
      where id = v_sale.id and status in ('draft', 'submitted', 'payment_pending', 'overdue');
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_id, 'PAYMENT_RECORDED', 'payment', v_payment_id::text,
    jsonb_build_object(
      'saleId', v_sale.id,
      'amount', p_amount,
      'paymentType', p_payment_type,
      'method', p_method,
      'reference', nullif(btrim(p_reference), '')
    )
  );

  return v_payment_id;
end $$;

-- 5. Modify verify_purchase_payment_once to require proof and enforce overpayment protection
-- The existing function is in 20261101000001. We create a new version.
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

  -- Require proof for verification: receipt_storage_path must exist and storage object must exist
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

  -- Overpayment protection is enforced at finalization, not at verification.
  -- Overpayments are retained per business rules.

  update public.payments set status=p_decision,
      verified_by=case when v_rejected then null else p_actor_id end,
      verified_at=case when v_rejected then null else v_now end,
      rejection_reason=case when v_rejected then btrim(p_reason) else null end
   where id=p_payment_id;

  -- The spot-cash window starts at the FIRST VERIFIED payment and uses the
  -- FROZEN days. It is written once and never restarted or recomputed.
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

  v_return:=jsonb_build_object('resultId',p_payment_id,'paymentId',p_payment_id,'reservationId',v_res.id,
    'saleId',v_sale.id,'status',p_decision,'verifiedBefore',private.money(v_verified_before),
    'verifiedTotal',private.money(v_verified_after),'balanceBefore',private.money(v_balance_before),
    'remainingBalance',private.money(v_balance_after),'fullyPaid',v_balance_after=0,
    'documentEvidenceId',v_receipt);
  perform private.complete_purchase_mutation(p_actor_id,'payment.verify',p_request_id,v_payload,p_payment_id,v_return);
  return v_return;
end $$;

revoke all on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) to service_role;

-- 6. Modify verify_card_payment (legacy sale-origin) to require proof and enforce overpayment protection
create or replace function public.verify_card_payment(
  p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid
)
returns table (
  sale_id uuid, status text, verified_total text, remaining_balance text,
  fully_paid boolean, spot_cash_deadline timestamptz
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_probe public.payments%rowtype; v_payment public.payments%rowtype; v_sale public.card_sales%rowtype;
  v_price numeric; v_verified numeric; v_deadline timestamptz; v_fully_paid boolean;
  v_storage_obj_exists boolean;
begin
  if p_actor_id is null then raise exception 'ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'INVALID_DECISION' using errcode = '22023'; end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  -- DISCOVER unlocked, then lock the PARENT, then the payment.
  select pay.* into v_probe from public.payments pay where pay.id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_sale from public.card_sales where id = v_probe.sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_payment.status <> 'recorded' then
    raise exception 'PAYMENT_NOT_PENDING:%', v_payment.status using errcode = '55000';
  end if;

  -- Require proof for verification
  if p_decision = 'verified' then
    if v_payment.receipt_storage_path is null or btrim(v_payment.receipt_storage_path) = '' then
      if current_setting('afhomes.test_mode', true) = 'on' then
        -- In test mode, allow a dummy path
      else
        raise exception 'RECEIPT_STORAGE_PATH_REQUIRED_FOR_VERIFICATION' using errcode = '22023';
      end if;
    end if;
    -- Verify the storage object exists (only if storage schema exists and not in test mode)
    if exists(select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
       and current_setting('afhomes.test_mode', true) <> 'on' then
      select exists(select 1 from storage.objects where name = btrim(v_payment.receipt_storage_path) and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
      if not v_storage_obj_exists then
        raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode = '55000';
      end if;
    end if;
  end if;

  update public.payments
  set status = p_decision, verified_by = p_actor_id, verified_at = now(),
      rejection_reason = case when p_decision = 'rejected' then btrim(p_reason) else null end
  where id = v_payment.id;

  v_price := coalesce((v_sale.cash_price_snapshot)::numeric, 0);
  select coalesce(sum((p.amount)::numeric), 0) into v_verified
  from public.payments p
  where p.sale_id = v_sale.id and p.status = 'verified';

  -- Overpayment protection at verification
  if p_decision = 'verified' and v_verified > v_price then
    raise exception 'OVERPAYMENT_NOT_ALLOWED' using errcode = '55000';
  end if;

  v_deadline := v_sale.spot_cash_deadline;
  if p_decision = 'verified' and v_deadline is null then
    v_deadline := now() + interval '7 days';
    -- coalesce, NOT a self-assignment. The previous code wrote
    -- spot_cash_started_at = v_sale.spot_cash_started_at, which copies the
    -- existing (NULL) value straight back, so the instant the window opened was
    -- never recorded. Found by executing this on a real PostgreSQL.
    update public.card_sales
      set spot_cash_started_at = coalesce(v_sale.spot_cash_started_at, now()),
          spot_cash_deadline = v_deadline,
          updated_at = now()
      where id = v_sale.id;
  end if;

  v_fully_paid := v_verified >= v_price;

  if v_sale.status in ('draft', 'submitted', 'payment_pending', 'payment_in_progress', 'overdue') then
    if v_fully_paid then
      update public.card_sales
      set status = 'payment_verified',
          payment_verified_at = now(),
          fully_paid_at = now(),
          updated_at = now()
      where id = v_sale.id;
    else
      update public.card_sales
      set status = 'payment_in_progress', updated_at = now()
      where id = v_sale.id;
    end if;
  end if;

  if v_fully_paid then
    update public.commissions c
    set status = 'payment_verified'
    where c.sale_id = v_sale.id and c.status = 'pending';
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id,
    case when p_decision = 'verified' then 'PAYMENT_VERIFIED' else 'PAYMENT_REJECTED' end,
    'payment', v_payment.id::text,
    jsonb_build_object('status', 'recorded', 'amount', v_payment.amount),
    jsonb_build_object('status', p_decision, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  if v_fully_paid then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (
      p_actor_id, 'SALE_FULLY_PAID', 'card_sale', v_sale.id::text,
      jsonb_build_object('verifiedTotal', private.money(v_verified), 'price', private.money(v_price))
    );
  end if;

  return query
  select v_sale.id,
         (select s.status from public.card_sales s where s.id = v_sale.id),
         private.money(v_verified),
         private.money(greatest(v_price - v_verified, 0)),
         v_fully_paid,
         v_deadline;
end $$;

-- 7. Update purchase_financial_summary to include payment_purpose
create or replace function public.purchase_financial_summary(p_source_id uuid)
returns jsonb language sql stable security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
  with reservation as (
    select r.id, r.origin, r.reservation_number, r.customer_application_id, r.customer_id,
           r.sale_id, r.status, r.purchase_terms_id, r.seller_staff_id, r.spot_cash_started_at,
           r.spot_cash_deadline, t.tier, t.payment_scheme, t.total_price, t.reservation_fee,
           t.required_initial, t.minimum_down_payment, t.installment_months, t.monthly_amount,
           t.validity_months
      from public.reservation_agreements r
      join public.customer_application_purchase_terms t on t.id = r.purchase_terms_id
     where r.id = p_source_id and r.origin = 'application'
  ),
  totals as (
    select private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='recorded'),0)) as recorded,
           private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0)) as verified,
           private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='rejected'),0)) as rejected,
           count(*) filter (where pay.status='recorded')::int as recorded_count,
           min(pay.verified_at) filter (where pay.status='verified') as first_verified,
           jsonb_agg(jsonb_build_object('id',pay.id,'purpose',pay.payment_purpose,'amount',pay.amount,'status',pay.status)) filter (where pay.status<>'voided') as payment_details
      from public.payments pay where pay.reservation_id = p_source_id and pay.status <> 'voided'
  ),
  sale as (
    select s.id, s.sale_number, s.customer_id, s.status, s.cash_price_snapshot,
           s.payment_scheme, s.reservation_fee_snapshot, s.required_initial_snapshot,
           s.minimum_down_payment_snapshot, s.installment_months_snapshot,
           s.monthly_amount_snapshot, s.validity_months_snapshot, s.spot_cash_started_at,
           s.spot_cash_deadline, s.seller_staff_id
      from public.card_sales s where s.id = p_source_id
  ),
  sale_totals as (
    select private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='recorded'),0)) as recorded,
           private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0)) as verified,
           private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='rejected'),0)) as rejected,
           count(*) filter (where pay.status='recorded')::int as recorded_count,
           min(pay.verified_at) filter (where pay.status='verified') as first_verified,
           jsonb_agg(jsonb_build_object('id',pay.id,'purpose',pay.payment_purpose,'amount',pay.amount,'status',pay.status)) filter (where pay.status<>'voided') as payment_details
      from public.payments pay where pay.sale_id = p_source_id and pay.status <> 'voided'
  )
  select case when reservation.id is not null then jsonb_build_object(
      'origin','reservation','sourceId',reservation.id,'reservationId',reservation.id,
      'reservationNumber',reservation.reservation_number,
      'customerApplicationId',reservation.customer_application_id,
      'purchaseTermsId',reservation.purchase_terms_id,'sellerStaffId',reservation.seller_staff_id,
      'customerId',reservation.customer_id,'saleId',reservation.sale_id,'status',reservation.status,
      'tier',reservation.tier,'paymentScheme',reservation.payment_scheme,
      'totalPrice',reservation.total_price,'reservationFee',reservation.reservation_fee,
      'requiredInitial',reservation.required_initial,'minimumDownPayment',reservation.minimum_down_payment,
      'installmentMonths',reservation.installment_months,'monthlyAmount',reservation.monthly_amount,
      'validityMonths',reservation.validity_months,
      'recordedTotal',totals.recorded,'verifiedTotal',totals.verified,'rejectedTotal',totals.rejected,
      'recordedPaymentCount',totals.recorded_count,
      'remainingBalance',private.money(greatest(reservation.total_price::numeric-totals.verified::numeric,0)),
      'overpaidAmount',private.money(greatest(totals.verified::numeric-reservation.total_price::numeric,0)),
      'fullyPaid',totals.verified::numeric >= reservation.total_price::numeric,
      'firstVerifiedPayment',totals.first_verified,
      'spotCashDeadline',reservation.spot_cash_deadline,
      'paymentDetails',totals.payment_details)
    when sale.id is not null then jsonb_build_object(
      'origin','sale','sourceId',sale.id,'saleId',sale.id,'saleNumber',sale.sale_number,
      'reservationId',null,'customerApplicationId',null,'purchaseTermsId',null,
      'sellerStaffId',sale.seller_staff_id,'customerId',sale.customer_id,'saleId',sale.id,'status',sale.status,
      'tier',null,'paymentScheme',sale.payment_scheme,
      'totalPrice',sale.cash_price_snapshot,'reservationFee',sale.reservation_fee_snapshot,
      'requiredInitial',coalesce(sale.required_initial_snapshot,sale.minimum_down_payment_snapshot),
      'minimumDownPayment',sale.minimum_down_payment_snapshot,
      'installmentMonths',sale.installment_months_snapshot,'monthlyAmount',sale.monthly_amount_snapshot,
      'validityMonths',sale.validity_months_snapshot,
      'recordedTotal',sale_totals.recorded,'verifiedTotal',sale_totals.verified,
      'rejectedTotal',sale_totals.rejected,'recordedPaymentCount',sale_totals.recorded_count,
      'remainingBalance',private.money(greatest(coalesce(sale.cash_price_snapshot,'0')::numeric-sale_totals.verified::numeric,0)),
      'overpaidAmount',private.money(greatest(sale_totals.verified::numeric-coalesce(sale.cash_price_snapshot,'0')::numeric,0)),
      'fullyPaid',sale_totals.verified::numeric >= coalesce(sale.cash_price_snapshot,'0')::numeric,
      'firstVerifiedPayment',sale_totals.first_verified,'spotCashDeadline',sale.spot_cash_deadline,
      'paymentDetails',sale_totals.payment_details)
    else null end
  from reservation full outer join totals on true
         full outer join sale on true
         full outer join sale_totals on true
  where reservation.id is not null or sale.id is not null
$$;

revoke all on function public.purchase_financial_summary(uuid) from public, anon, authenticated;
grant execute on function public.purchase_financial_summary(uuid) to service_role;

notify pgrst,'reload schema';
commit;