-- AF Homes: Automatic reservation creation and initial payment on application approval.
-- When an application is approved, this extends the approval RPC to atomically:
--  1. Create the application-origin reservation (draft, signatures=received)
--  2. Submit the reservation
--  3. Execute the reservation (signatures already received)
--  4. Record the ₱10,000 reservation fee payment (recorded, awaiting verification)
-- All steps share the parent request_id namespace for idempotency.
--
-- Uses a session-local setting (afhomes.auto_workflow) to signal the auto-workflow
-- context to sub-RPCs, allowing them to bypass seller/finance permission checks
-- since the parent approval already authorized the workflow.

-- ===========================================================================
-- Extended reservation creation: allow application approvers (sales.customers.update)
-- ===========================================================================
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
  -- Approval workflow has sales.customers.update; sellers also have this (baseline)
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'purchaseTermsId',p_terms_id,
    'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'reservation.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  -- The reviewer may reserve for an application they do not own; the owner may
  -- reserve their own. Anyone else is refused before any row is written.
  -- The auto-workflow (triggered by application approval) is already authorized
  -- by sales.customers.update on the parent, so the cross-seller card_sales gate
  -- is bypassed there; manual reservation creation keeps the existing gate.
  if v_app.created_by is distinct from p_actor_id
     and current_setting('afhomes.auto_workflow', true) is distinct from 'on' then
    -- Cross-seller oversight still requires sales.card_sales.update
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
        h.city_municipality,h.province,h.postal_code),
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
      v_primary.permanent_address_line_2,v_primary.city_municipality,v_primary.province,v_primary.postal_code)),
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

-- ===========================================================================
-- Extended transition_purchase_reservation_once: auto-workflow bypass for submit/execute
-- ===========================================================================
create or replace function public.transition_purchase_reservation_once(
  p_request_id uuid, p_actor_id uuid, p_reservation_id uuid, p_action text, p_input jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_payload jsonb; v_result uuid; v_now timestamptz:=now(); v_status text; v_revision integer;
  v_receipt uuid; v_action text; v_item jsonb; v_line integer;
  v_auto_workflow boolean;
begin
  -- Auto-workflow (triggered by application approval) bypasses seller permission checks
  v_auto_workflow := current_setting('afhomes.auto_workflow', true) = 'on';
  if not v_auto_workflow then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  end if;
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_action:=coalesce(p_action,'');
  if v_action not in ('save','submit','execute','reopen','cancel') then
    raise exception 'INVALID_AGREEMENT_ACTION' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('reservationId',p_reservation_id,'action',v_action,
    'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'reservation.transition',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_res from public.reservation_agreements where id=p_reservation_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  -- The owning seller edits and executes their own agreement; cross-cutting
  -- oversight needs sales.card_sales update. This is the existing D2 gate, not a
  -- new vocabulary.
  if not v_auto_workflow and v_res.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  end if;
  if v_res.origin<>'application' then
    -- Legacy sale-origin agreements keep their existing wrapper; this RPC is the
    -- application-origin lifecycle only.
    raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000';
  end if;
  select * into v_app from public.customer_applications where id=v_res.customer_application_id;
  if not found or v_app.status<>'approved' then
    raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000';
  end if;

  if v_action='save' then
    -- Full reservation editing is allowed on draft, submitted and executed
    -- agreements so Pending and Paid reservations can be maintained directly.
    -- Cancelled agreements stay immutable.
    if v_res.status not in ('draft','submitted','executed') then
      raise exception 'AGREEMENT_NOT_EDITABLE' using errcode='55000';
    end if;
    update public.reservation_agreements set
      revision_number=coalesce(nullif(p_input->>'revisionNumber',''),revision_number),
      monthly_amortization_start=coalesce(nullif(p_input->>'monthlyAmortizationStart','')::date,monthly_amortization_start),
      monthly_amortization_end=coalesce(nullif(p_input->>'monthlyAmortizationEnd','')::date,monthly_amortization_end),
      payment_due_day=coalesce(nullif(p_input->>'paymentDueDay','')::integer,payment_due_day),
      primary_signature_status=coalesce(nullif(p_input->>'primarySignatureStatus',''),primary_signature_status),
      secondary_signature_status=coalesce(nullif(p_input->>'secondarySignatureStatus',''),secondary_signature_status),
      updated_at=v_now
     where id=v_res.id;
    delete from public.reservation_agreement_schedule where agreement_id=v_res.id;
    v_line:=0;
    for v_item in select value from jsonb_array_elements(coalesce(p_input->'scheduleNotes','[]'::jsonb)) loop
      v_line:=v_line+1;
      insert into public.reservation_agreement_schedule(agreement_id,line_number,particular,amount_snapshot,payment_date,remarks)
      values(v_res.id,v_line,v_item->>'particular',private.money((v_item->>'amount')::numeric),
        nullif(v_item->>'paymentDate','')::date,nullif(v_item->>'remarks',''));
    end loop;
  elsif v_action='submit' then
    if v_res.status<>'draft' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    if (select count(*) from public.reservation_agreement_holders h
         where h.agreement_id=v_res.id and h.holder_type='PRIMARY')<>1 then
      raise exception 'PRIMARY_HOLDER_REQUIRED' using errcode='23514';
    end if;
    update public.reservation_agreements set status='submitted',submitted_at=coalesce(submitted_at,v_now),updated_at=v_now
     where id=v_res.id;
  elsif v_action='execute' then
    if v_res.status<>'submitted' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    -- Execution is the signed contract. A missing primary signature, or a
    -- secondary signature that was promised but not received, blocks it.
    if v_res.primary_signature_status is distinct from 'received' then
      raise exception 'PRIMARY_SIGNATURE_REQUIRED' using errcode='22023';
    end if;
    if exists(select 1 from public.reservation_agreement_holders h
               where h.agreement_id=v_res.id and h.holder_type='SECONDARY')
      and v_res.secondary_signature_status is distinct from 'received' then
      raise exception 'SECONDARY_SIGNATURE_REQUIRED' using errcode='22023';
    end if;
    update public.reservation_agreements set status='executed',executed_at=v_now,updated_at=v_now
     where id=v_res.id;
  elsif v_action='reopen' then
    if v_res.status<>'submitted' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    update public.reservation_agreements set status='draft',updated_at=v_now where id=v_res.id;
  else
    if v_res.status not in ('draft','submitted') then
      raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000';
    end if;
    update public.reservation_agreements set status='cancelled',updated_at=v_now where id=v_res.id;
  end if;

  v_status:=case v_action when 'save' then v_res.status when 'submit' then 'submitted'
    when 'execute' then 'executed' when 'reopen' then 'draft' else 'cancelled' end;
  -- Revision is strictly monotonic per agreement: the next one is always the
  -- highest recorded plus one. Counting instead would collide with revision 1
  -- and raise PURCHASE_DOCUMENT_VERSION_CONFLICT on the first transition.
  select coalesce(max(d.revision),0)+1 into v_revision from private.purchase_document_evidence d
   where d.kind='reservation' and d.source_id=v_res.id;
  v_receipt:=private.append_purchase_document('reservation',v_res.id,v_revision,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,case v_action when 'submit' then 'RESERVATION_AGREEMENT_SUBMITTED'
      when 'execute' then 'RESERVATION_AGREEMENT_EXECUTED' when 'reopen' then 'RESERVATION_AGREEMENT_REOPENED'
      when 'cancel' then 'RESERVATION_AGREEMENT_CANCELLED' else 'RESERVATION_AGREEMENT_UPDATED' end,
      'reservation_agreement',v_res.id::text,
      jsonb_build_object('status',v_res.status),jsonb_build_object('status',v_status),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'reservation.transition',p_request_id,v_payload,v_res.id,
    jsonb_build_object('resultId',v_res.id,'status',v_status,'documentEvidenceId',v_receipt,'revision',v_revision));
  return v_res.id;
end $$;

revoke all on function public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb) to service_role;

-- ===========================================================================
-- Extended record_reservation_payment_once: auto-workflow bypass for fee recording
-- ===========================================================================
create or replace function public.record_reservation_payment_once(
  p_request_id uuid, p_reservation_id uuid, p_input jsonb, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_amount numeric; v_payment_id uuid; v_payload jsonb; v_result uuid; v_now timestamptz:=now();
  v_receipt uuid; v_balance text; v_verified text;
  v_auto_workflow boolean;
begin
  -- Auto-workflow (triggered by application approval) bypasses finance permission checks
  v_auto_workflow := current_setting('afhomes.auto_workflow', true) = 'on';
  if not v_auto_workflow then
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

  -- One row in the EXISTING ledger. sale_id stays NULL until finalization links
  -- the very same rows; nothing is copied and no second table exists.
  insert into public.payments(
    sale_id,reservation_id,origin,customer_id,amount,payment_type,method,reference,notes,
    receipt_storage_path,status,recorded_by,recorded_at)
  values(null,v_res.id,'reservation',v_res.customer_id,private.money(v_amount),
    coalesce(p_input->>'paymentType','installment'),p_input->>'method',
    nullif(btrim(coalesce(p_input->>'reference','')),''),nullif(coalesce(p_input->>'notes',''),''),
    nullif(btrim(coalesce(p_input->>'receiptStoragePath','')),''),'recorded',p_actor_id,v_now)
  returning id into v_payment_id;

  -- A duplicate reference on the same reservation is refused by the
  -- `payments_reservation_reference_unique` partial index, which the INSERT above
  -- already trips. No second guard is added here: it could only ever be
  -- unreachable code.

  v_receipt:=private.append_purchase_document('payment_recorded',v_payment_id,1,p_actor_id);
  -- Recording moves the RECORDED total only. The verified total and the balance
  -- are read again so the receipt and the mutation receipt carry the same figures
  -- the queue will show.
  select private.money(coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0))::text,
         private.money(greatest(v_res.total_price_snapshot::numeric-
           coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0),0))::text
    into v_verified, v_balance
    from public.payments pay where pay.reservation_id=v_res.id and pay.status<>'voided';
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'PAYMENT_RECORDED','payment',v_payment_id::text,
      jsonb_build_object('origin','reservation','reservationId',v_res.id,'amount',private.money(v_amount),
        'status','recorded','method',p_input->>'method','verifiedTotal',v_verified,
        'documentEvidenceId',v_receipt),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'payment.create',p_request_id,v_payload,v_payment_id,
    jsonb_build_object('resultId',v_payment_id,'status','recorded','reservationId',v_res.id,
      'saleId',v_res.sale_id,'documentEvidenceId',v_receipt,
      'verifiedTotal',v_verified,'remainingBalance',v_balance));
  return v_payment_id;
end $$;

revoke all on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) to service_role;

-- ===========================================================================
-- Extended application approval: auto-create reservation, execute, record fee
-- ===========================================================================
create or replace function public.decide_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_decision text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_payload jsonb; v_result uuid;
  v_allowed boolean; v_now timestamptz:=now(); v_notes text;
  -- Auto-workflow variables
  v_res_id uuid; v_res_number text; v_secondary_exists boolean;
  v_reserve_req_id uuid; v_submit_req_id uuid; v_execute_req_id uuid; v_payment_req_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  if p_decision is null or p_decision not in ('approved','rejected','cancelled','draft') then
    raise exception 'INVALID_DECISION' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'decision',p_decision);
  v_result:=private.mutation_result(p_actor_id,'application.decide',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  v_allowed:=case v_app.status
    when 'draft' then p_decision='cancelled'
    when 'submitted' then p_decision in ('approved','rejected','cancelled','draft')
    when 'approved' then p_decision='cancelled'
    when 'rejected' then p_decision in ('draft','cancelled')
    else false end;
  if not v_allowed then raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='55000'; end if;
  if p_decision='approved' and v_app.purchase_terms_id is null then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;
  -- A live reservation owns the commercial record; the application cannot be
  -- cancelled out from under it.
  if p_decision='cancelled' and exists(select 1 from public.reservation_agreements r
      where r.customer_application_id=v_app.id and r.status<>'cancelled') then
    raise exception 'RESERVATION_ALREADY_EXISTS' using errcode='55000';
  end if;

  update public.customer_applications set
    status=p_decision, updated_at=v_now,
    submitted_at=case when p_decision in ('approved','rejected') then coalesce(submitted_at,v_now) else submitted_at end,
    approved_at=case when p_decision='approved' then v_now else approved_at end,
    rejected_at=case when p_decision='rejected' then v_now else rejected_at end
   where id=v_app.id;

  -- AUTO-WORKFLOW: On approval, create reservation, execute it, and record initial fee payment
  if p_decision='approved' then
    -- Enable auto-workflow mode for sub-RPCs (bypasses seller/finance permission checks)
    perform set_config('afhomes.auto_workflow', 'on', true);

    -- Check if secondary holder exists for signature requirements
    select exists(select 1 from public.customer_application_holders h
                  where h.application_id=v_app.id and h.holder_type='SECONDARY')
      into v_secondary_exists;

    -- Derive stable request IDs for each sub-operation (idempotent per parent request)
    -- Using md5 hash of parent request_id + suffix to generate deterministic UUIDs
    v_reserve_req_id := md5(p_request_id::text || '-reserve')::uuid;
    v_submit_req_id  := md5(p_request_id::text || '-submit')::uuid;
    v_execute_req_id := md5(p_request_id::text || '-execute')::uuid;
    v_payment_req_id := md5(p_request_id::text || '-payment')::uuid;

    -- 1. Create reservation (draft, signatures=received)
    v_res_id := public.reserve_application_purchase_once(
      v_reserve_req_id, p_actor_id, p_application_id, v_app.purchase_terms_id,
      jsonb_build_object(
        'reservationDate', CURRENT_DATE,
        'agreementDate', CURRENT_DATE,
        'primarySignatureStatus', 'received',
        'secondarySignatureStatus', CASE WHEN v_secondary_exists THEN 'received' ELSE 'pending' END,
        'scheduleNotes', '[]'::jsonb
      )
    );

    -- Fetch the reservation number for payment reference
    select reservation_number into v_res_number
    from public.reservation_agreements where id=v_res_id;

    -- 2. Submit reservation
    perform public.transition_purchase_reservation_once(
      v_submit_req_id, p_actor_id, v_res_id, 'submit', '{}'::jsonb
    );

    -- 3. Execute reservation (signatures already received)
    perform public.transition_purchase_reservation_once(
      v_execute_req_id, p_actor_id, v_res_id, 'execute', '{}'::jsonb
    );

    -- 4. Record ₱10,000 reservation fee payment
    perform public.record_reservation_payment_once(
      v_payment_req_id, v_res_id,
      jsonb_build_object(
        'amount', '10000.00',
        'paymentType', 'down_payment',
        'method', 'cash',
        'reference', 'RES-FEE-' || v_res_number,
        'notes', 'Automatic reservation fee on application approval'
      ),
      p_actor_id
    );

    -- Disable auto-workflow mode
    perform set_config('afhomes.auto_workflow', 'off', true);
  end if;

  v_notes:=case p_decision when 'draft' then 'CUSTOMER_APPLICATION_REOPENED'
    when 'approved' then 'CUSTOMER_APPLICATION_APPROVED' when 'rejected' then 'CUSTOMER_APPLICATION_REJECTED'
    else 'CUSTOMER_APPLICATION_CANCELLED' end;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,v_notes,'customer_application',v_app.id::text,
      jsonb_build_object('status',v_app.status),
      jsonb_build_object('status',p_decision,'purchaseTermsId',v_app.purchase_terms_id,
        'reservationId', CASE WHEN p_decision='approved' THEN v_res_id END),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'application.decide',p_request_id,v_payload,v_app.id,
    jsonb_build_object('resultId',v_app.id,'status',p_decision,'purchaseTermsId',v_app.purchase_terms_id,
      'reservationId', CASE WHEN p_decision='approved' THEN v_res_id END));
  return v_app.id;
end $$;

revoke all on function public.decide_purchase_application_once(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.decide_purchase_application_once(uuid,uuid,uuid,text) to service_role;