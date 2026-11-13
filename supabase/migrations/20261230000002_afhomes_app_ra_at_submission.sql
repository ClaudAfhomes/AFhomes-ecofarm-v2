-- AF Homes: Create Customer Application and linked official RA at submission.
-- Signed application document required for approval. Reservation payment proof not required at submission.
-- Validation: test-official-numbering.mts (real PostgreSQL concurrency, retries, activation, RLS).
-- Down: forward repair only. Restore from backup if needed.
begin;

-- 1. Add a column to track signed application document upload
-- The existing customer_application_documents table with document_type='valid_id' links to identity_documents
-- We need to verify the document exists and is reviewed before approval

-- 2. Create new submit function with mutation idempotency that creates RA at submission
create or replace function public.submit_customer_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text,
  p_seller_candidate uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_seller uuid; v_proposal jsonb;
  v_payload jsonb; v_result uuid; v_version integer; v_terms_id uuid;
  v_res_id uuid; v_res_number text; v_reserve_req_id uuid;
  v_signed_app_doc_exists boolean;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'expectedProposalHash',p_expected_hash,
    'sellerCandidateId',p_seller_candidate);
  v_result:=private.mutation_result(p_actor_id,'application.submit',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_app.status<>'draft' then raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='55000'; end if;

  v_seller:=private.purchase_seller_for(p_actor_id,p_seller_candidate);
  v_proposal:=private.purchase_terms_for_application(v_app.id,v_seller,'submission');
  if (v_proposal->>'expectedProposalHash') is distinct from p_expected_hash then
    raise exception 'PURCHASE_PROPOSAL_CHANGED' using errcode='55000';
  end if;

  select coalesce(max(version),0)+1 into v_version from public.customer_application_purchase_terms
    where application_id=v_app.id;
  insert into public.customer_application_purchase_terms(
    application_id,customer_id,plan_id,seller_staff_id,version,capture_kind,reason,captured_by,captured_at,
    tier,payment_scheme,total_price,reservation_fee,minimum_down_payment,required_initial,
    installment_months,monthly_amount,spot_cash_days,validity_months,discount_percent,yearly_points,
    annual_points_tranches,holder_limit,inclusions,commission_rule_id,commission_rate,commission_base,expected_commission)
  values(v_app.id,v_app.customer_id,v_app.plan_id,v_seller,v_version,'submission',null,p_actor_id,now(),
    v_proposal->'terms'->>'tier',v_proposal->'terms'->>'paymentScheme',v_proposal->'terms'->>'totalPrice',
    v_proposal->'terms'->>'reservationFee',v_proposal->'terms'->>'minimumDownPayment',
    v_proposal->'terms'->>'requiredInitial',(v_proposal->'terms'->>'installmentMonths')::integer,
    v_proposal->'terms'->>'monthlyAmount',(v_proposal->'terms'->>'spotCashDays')::integer,
    (v_proposal->'terms'->>'validityMonths')::integer,(v_proposal->'terms'->>'discountPercent')::integer,
    (v_proposal->'terms'->>'yearlyPoints')::integer,(v_proposal->'terms'->>'annualPointsTranches')::integer,
    (v_proposal->'terms'->>'holderLimit')::integer,v_proposal->'terms'->'inclusions',
    (v_proposal->'terms'->>'commissionRuleId')::uuid,v_proposal->'terms'->>'commissionRate',
    v_proposal->'terms'->>'commissionBase',v_proposal->'terms'->>'expectedCommission')
  returning id into v_terms_id;

  update public.customer_applications set purchase_terms_id=v_terms_id where id=v_app.id;

  -- Verify signed application document exists (valid_id document_type linked to identity_documents)
  select exists(select 1 from public.customer_application_documents cad
    join public.identity_documents idoc on idoc.id=cad.identity_document_id
    where cad.application_id=v_app.id and cad.document_type='valid_id'
      and idoc.subject_type='customer' and idoc.customer_id=v_app.customer_id
      and idoc.reviewed_at is not null) into v_signed_app_doc_exists;
  if not v_signed_app_doc_exists then
    raise exception 'SIGNED_APPLICATION_DOCUMENT_REQUIRED' using errcode='55000';
  end if;

  -- Submit the application (reuses existing transition logic)
  perform public.submit_customer_application(v_app.id,p_actor_id);

  -- Create linked RA in draft status (atomic with submission)
  v_reserve_req_id := md5(p_request_id::text || '-reserve')::uuid;
  v_res_id := public.reserve_application_purchase_once(
    v_reserve_req_id, p_actor_id, v_app.id, v_terms_id,
    jsonb_build_object(
      'reservationDate', CURRENT_DATE,
      'agreementDate', CURRENT_DATE,
      'scheduleNotes', '[]'::jsonb
    )
  );

  select reservation_number into v_res_number
  from public.reservation_agreements where id=v_res_id;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,'CUSTOMER_APPLICATION_SUBMITTED','customer_application',v_app.id::text,
      jsonb_build_object('status','draft'),jsonb_build_object('status','submitted',
        'captureKind','submission','purchaseTermsId',v_terms_id,'termsVersion',v_version,
        'reservationId',v_res_id,'reservationNumber',v_res_number),
      p_request_id::text);

  perform private.complete_purchase_mutation(p_actor_id,'application.submit',p_request_id,v_payload,v_app.id,
    jsonb_build_object('resultId',v_app.id,'status','submitted','purchaseTermsId',v_terms_id,'termsVersion',v_version,
      'reservationId',v_res_id,'reservationNumber',v_res_number));

  return jsonb_build_object('applicationId',v_app.id,'reservationId',v_res_id,'reservationNumber',v_res_number);
end $$;

revoke all on function public.submit_customer_application_once(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_customer_application_once(uuid,uuid,uuid,text,uuid) to service_role;

-- 3. Modify decide_purchase_application_once to require signed application document for approval
-- The existing function is in 20261214000001 and 20261216000001. We need to update the latest version.
-- The 20261216 version removed signature columns but kept the auto-workflow. We need to add document verification.
create or replace function public.decide_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_decision text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_payload jsonb; v_result uuid;
  v_allowed boolean; v_now timestamptz:=now(); v_notes text;
  v_res_id uuid; v_res_number text;
  v_reserve_req_id uuid; v_submit_req_id uuid; v_payment_req_id uuid;
  v_signed_app_doc_exists boolean; v_secondary_exists boolean;
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

  -- For approval: require signed application document (valid_id, reviewed)
  if p_decision='approved' then
    select exists(select 1 from public.customer_application_documents cad
      join public.identity_documents idoc on idoc.id=cad.identity_document_id
      where cad.application_id=v_app.id and cad.document_type='valid_id'
        and idoc.subject_type='customer' and idoc.customer_id=v_app.customer_id
        and idoc.reviewed_at is not null) into v_signed_app_doc_exists;
    if not v_signed_app_doc_exists then
      raise exception 'SIGNED_APPLICATION_DOCUMENT_REQUIRED' using errcode='55000';
    end if;
  end if;

  update public.customer_applications set
    status=p_decision, updated_at=v_now,
    submitted_at=case when p_decision in ('approved','rejected') then coalesce(submitted_at,v_now) else submitted_at end,
    approved_at=case when p_decision='approved' then v_now else approved_at end,
    rejected_at=case when p_decision='rejected' then v_now else rejected_at end
   where id=v_app.id;

  -- AUTO-WORKFLOW: On approval, create or transition RA to submitted (not execute yet)
  if p_decision='approved' then
    perform set_config('afhomes.auto_workflow', 'on', true);

    -- Check if secondary holder exists for signature requirements
    select exists(select 1 from public.customer_application_holders h
                  where h.application_id=v_app.id and h.holder_type='SECONDARY')
      into v_secondary_exists;

    -- Derive stable request IDs for each sub-operation (idempotent per parent request)
    v_reserve_req_id := md5(p_request_id::text || '-reserve')::uuid;
    v_submit_req_id  := md5(p_request_id::text || '-submit')::uuid;
    v_payment_req_id := md5(p_request_id::text || '-payment')::uuid;

    -- 1. Find or create RA (for backward compatibility with pre-reservation approvals)
    select id into v_res_id from public.reservation_agreements where customer_application_id=v_app.id;
    if v_res_id is null then
      -- Create reservation for legacy approved applications without reservation
      v_res_id := public.reserve_application_purchase_once(
        v_reserve_req_id, p_actor_id, v_app.id, v_app.purchase_terms_id,
        jsonb_build_object(
          'reservationDate', CURRENT_DATE,
          'agreementDate', CURRENT_DATE,
          'scheduleNotes', '[]'::jsonb
        )
      );
    end if;
    select reservation_number into v_res_number from public.reservation_agreements where id=v_res_id;

    -- 2. Submit reservation (signatures already received from application document)
    perform public.transition_purchase_reservation_once(
      v_submit_req_id, p_actor_id, v_res_id, 'submit', '{}'::jsonb
    );

    -- 3. Execute reservation - require actual signed RA document upload (not auto-generated)
    -- The auto-workflow stops at 'submitted'. Execution requires a real signed RA document
    -- uploaded via upload_signed_ra_document, not an auto-generated placeholder.
    -- Payment recording is also deferred until after execution.

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

-- 4. Modify transition_purchase_reservation_once to require signed RA document for execute
-- The existing function is in 20261216000001. We need to add document verification for execute action.
-- Add a table for signed RA documents (separate from payment documents)
create table if not exists public.reservation_agreement_signed_documents (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.reservation_agreements(id) on delete restrict,
  identity_document_id uuid not null references public.identity_documents(id) on delete restrict,
  signed_by uuid references public.staff_users(id) on delete set null,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(agreement_id)
);
alter table public.reservation_agreement_signed_documents enable row level security;
revoke all on public.reservation_agreement_signed_documents from public, anon, authenticated, service_role;
create policy reservation_agreement_signed_documents_read on public.reservation_agreement_signed_documents
  for select to authenticated using (private.has_permission('sales.card_sales') or private.has_permission('finance.payment_verification'));
grant select on public.reservation_agreement_signed_documents to authenticated;

-- The transition function needs to be updated. We'll create a new version that checks for signed RA document on execute.
-- The existing function in 20261216000001 has the signature columns removed. We need to add document check.
-- Since the function was redefined in 20261216, we update it here.
create or replace function public.transition_purchase_reservation_once(
  p_request_id uuid, p_actor_id uuid, p_reservation_id uuid, p_action text, p_input jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_payload jsonb; v_result uuid; v_now timestamptz:=now(); v_status text; v_revision integer;
  v_receipt uuid; v_action text; v_item jsonb; v_line integer;
  v_signed_ra_doc_exists boolean;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
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
  if v_res.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  end if;
  if v_res.origin<>'application' then
    raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000';
  end if;
  select * into v_app from public.customer_applications where id=v_res.customer_application_id;
  if not found or v_app.status<>'approved' then
    raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000';
  end if;

  if v_action='save' then
    if v_res.status not in ('draft','submitted') then raise exception 'AGREEMENT_NOT_EDITABLE' using errcode='55000'; end if;
    update public.reservation_agreements set
      revision_number=coalesce(nullif(p_input->>'revisionNumber',''),revision_number),
      monthly_amortization_start=coalesce(nullif(p_input->>'monthlyAmortizationStart','')::date,monthly_amortization_start),
      monthly_amortization_end=coalesce(nullif(p_input->>'monthlyAmortizationEnd','')::date,monthly_amortization_end),
      payment_due_day=coalesce(nullif(p_input->>'paymentDueDay','')::integer,payment_due_day),
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
    -- Require signed RA document for execution
    select exists(select 1 from public.reservation_agreement_signed_documents rasd
      join public.identity_documents idoc on idoc.id=rasd.identity_document_id
      where rasd.agreement_id=v_res.id and idoc.reviewed_at is not null) into v_signed_ra_doc_exists;
    if not v_signed_ra_doc_exists then
      raise exception 'SIGNED_RA_DOCUMENT_REQUIRED' using errcode='55000';
    end if;
    update public.reservation_agreements set status='executed',executed_at=v_now,updated_at=v_now
     where id=v_res.id;
  elsif v_action='reopen' then
    if v_res.status<>'submitted' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    update public.reservation_agreements set status='draft',updated_at=v_now where id=v_res.id;
  elsif v_action='cancel' then
    if v_res.status='executed' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    update public.reservation_agreements set status='cancelled',updated_at=v_now where id=v_res.id;
  end if;

  v_status:=case v_action when 'save' then v_res.status when 'submit' then 'submitted'
    when 'execute' then 'executed' when 'reopen' then 'draft' else 'cancelled' end;
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

notify pgrst,'reload schema';
commit;