-- AF Homes: remove reservation-agreement signature tracking.
-- Signature is treated as equivalent to approval: an approved application auto-
-- creates and executes its reservation, so tracking and gating on
-- primary/secondary signature status is redundant. The columns, the execute
-- gate, the save-path fields and the auto-workflow signature inputs are all
-- removed. Application-level consent signatures (customer_applications) are
-- deliberately untouched — they are a different concept (form consent).
--
-- Validation after apply:
--   select column_name from information_schema.columns
--     where table_name='reservation_agreements'
--       and column_name in ('primary_signature_status','secondary_signature_status');
--   -- expect 0 rows.
--   select proname from pg_proc where proname in
--     ('save_reservation_agreement','reserve_application_purchase_once',
--      'transition_purchase_reservation_once');
--
-- Down note: forward-only. Restore from backup if needed; columns are not
-- recoverable from this migration.

-- 1. Drop the columns (destructive).
alter table public.reservation_agreements
  drop column if exists primary_signature_status,
  drop column if exists secondary_signature_status;

-- 2. Redefine save_reservation_agreement without signature fields.
create or replace function public.save_reservation_agreement(
  p_agreement_id uuid,
  p_actor_id uuid,
  p_input jsonb,
  p_primary jsonb,
  p_secondary jsonb default null,
  p_schedule jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := coalesce(p_agreement_id, gen_random_uuid());
  v_sale public.card_sales%rowtype;
  v_plan public.card_plans%rowtype;
  v_existing public.reservation_agreements%rowtype;
  v_received numeric := 0;
  v_total numeric;
  v_item jsonb;
  v_line integer := 0;
begin
  if not exists (select 1 from public.staff_users where id=p_actor_id and status='active') then raise exception 'ACTOR_INACTIVE'; end if;
  select * into v_sale from public.card_sales where id=(p_input->>'saleId')::uuid;
  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  select * into v_plan from public.card_plans where id=v_sale.plan_id;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if p_secondary is not null and upper(v_plan.code) <> 'GOLD' then raise exception 'SECONDARY_HOLDER_GOLD_ONLY'; end if;
  select coalesce(sum(amount::numeric),0) into v_received from public.payments where sale_id=v_sale.id and status='verified';
  v_total := v_sale.cash_price::numeric;

  if p_agreement_id is null then
    insert into public.reservation_agreements(
      id,reservation_number,revision_number,reservation_date,agreement_date,sale_id,
      customer_application_id,plan_id,tier_snapshot,inclusions_snapshot,total_price_snapshot,
      reservation_fee_snapshot,down_payment_snapshot,total_payment_received_snapshot,balance_snapshot,
      monthly_amortization_snapshot,installment_months_snapshot,payment_scheme_snapshot,
      discount_percent_snapshot,validity_years_snapshot,yearly_points_snapshot,
      annual_points_tranches_snapshot,holder_limit_snapshot,monthly_amortization_start,
      monthly_amortization_end,payment_due_day,status,created_by
    ) values (
      v_id,'RES-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8)),
      nullif(p_input->>'revisionNumber',''),(p_input->>'reservationDate')::date,(p_input->>'agreementDate')::date,
      v_sale.id,nullif(p_input->>'customerApplicationId','')::uuid,v_plan.id,upper(v_plan.code),
      jsonb_build_object('priorityReservation',v_plan.priority_reservation,'noMonthlyAnnualDues',v_plan.no_monthly_annual_dues,'baseValidityYears',v_plan.base_validity_years,'extensionYears',v_plan.validity_extension_years,'totalLoyaltyValue',v_plan.total_loyalty_value),
      private.money(v_total),v_sale.reservation_fee_snapshot,v_sale.required_initial_snapshot,
      private.money(v_received),private.money(greatest(v_total-v_received,0)),v_sale.monthly_amount_snapshot,
      v_sale.installment_months_snapshot,v_sale.payment_scheme,v_plan.discount_percent,v_plan.validity_years,
      v_sale.yearly_points_snapshot,v_plan.annual_points_tranches,v_plan.cardholder_limit,
      nullif(p_input->>'monthlyAmortizationStart','')::date,nullif(p_input->>'monthlyAmortizationEnd','')::date,
      nullif(p_input->>'paymentDueDay','')::integer,'draft',p_actor_id
    );
  else
    select * into v_existing from public.reservation_agreements where id=p_agreement_id for update;
    if not found then raise exception 'AGREEMENT_NOT_FOUND'; end if;
    if v_existing.status <> 'draft' then raise exception 'AGREEMENT_NOT_EDITABLE'; end if;
    if v_existing.sale_id <> v_sale.id then raise exception 'AGREEMENT_SALE_IMMUTABLE'; end if;
    update public.reservation_agreements set revision_number=nullif(p_input->>'revisionNumber',''),
      reservation_date=(p_input->>'reservationDate')::date,agreement_date=(p_input->>'agreementDate')::date,
      customer_application_id=nullif(p_input->>'customerApplicationId','')::uuid,
      monthly_amortization_start=nullif(p_input->>'monthlyAmortizationStart','')::date,
      monthly_amortization_end=nullif(p_input->>'monthlyAmortizationEnd','')::date,
      payment_due_day=nullif(p_input->>'paymentDueDay','')::integer,
      updated_at=now() where id=v_id;
    delete from public.reservation_agreement_schedule where agreement_id=v_id;
    delete from public.reservation_agreement_holders where agreement_id=v_id;
  end if;

  insert into public.reservation_agreement_holders(agreement_id,holder_type,name,address,contact_number,email,tin_number)
  values(v_id,'PRIMARY',p_primary->>'name',p_primary->>'address',p_primary->>'contactNumber',p_primary->>'email',nullif(p_primary->>'tinNumber',''));
  if p_secondary is not null then
    insert into public.reservation_agreement_holders(agreement_id,holder_type,name,address,contact_number,email,tin_number)
    values(v_id,'SECONDARY',p_secondary->>'name',p_secondary->>'address',p_secondary->>'contactNumber',p_secondary->>'email',nullif(p_secondary->>'tinNumber',''));
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_schedule,'[]'::jsonb)) loop
    v_line := v_line + 1;
    insert into public.reservation_agreement_schedule(agreement_id,line_number,particular,amount_snapshot,payment_date,remarks)
    values(v_id,v_line,v_item->>'particular',private.money((v_item->>'amount')::numeric),nullif(v_item->>'paymentDate','')::date,nullif(v_item->>'remarks',''));
  end loop;
  return v_id;
end $$;

revoke all on function public.save_reservation_agreement(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_reservation_agreement(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;

-- 3. Redefine reserve_application_purchase_once without signature fields.
-- (Reproduced from 20261214 with the signature inputs removed.)
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
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'purchaseTermsId',p_terms_id,
    'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'reservation.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_app.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  end if;
  if v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;
  if v_app.purchase_terms_id is null then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  if p_terms_id is distinct from v_app.purchase_terms_id then
    raise exception 'PURCHASE_TERMS_VERSION_CONFLICT' using errcode='55000';
  end if;
  select * into v_terms from public.customer_application_purchase_terms pt where pt.id=p_terms_id;
  if not found or v_terms.application_id is distinct from v_app.id then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;
  perform private.purchase_seller_for(p_actor_id,v_terms.seller_staff_id);
  if not exists(select 1 from public.customers c where c.id=v_app.customer_id and c.status<>'cancelled') then
    raise exception 'CUSTOMER_NOT_ELIGIBLE' using errcode='55000';
  end if;
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
    payment_due_day,status)
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
    nullif(p_input->>'paymentDueDay','')::integer,'draft');

  insert into public.reservation_agreement_holders(agreement_id,holder_type,name,address,contact_number,email,tin_number)
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

-- 4. Redefine transition_purchase_reservation_once: remove signature gate + signature save fields.
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
  if not v_auto_workflow and v_res.created_by is distinct from p_actor_id then
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
    if v_res.status not in ('draft','submitted','executed') then
      raise exception 'AGREEMENT_NOT_EDITABLE' using errcode='55000';
    end if;
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

-- 5. Redefine decide_purchase_application_once (from 20261214) without signature inputs.
create or replace function public.decide_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_decision text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_payload jsonb; v_result uuid;
  v_allowed boolean; v_now timestamptz:=now(); v_notes text;
  v_res_id uuid; v_res_number text;
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

  if p_decision='approved' then
    perform set_config('afhomes.auto_workflow', 'on', true);

    v_reserve_req_id := md5(p_request_id::text || '-reserve')::uuid;
    v_submit_req_id  := md5(p_request_id::text || '-submit')::uuid;
    v_execute_req_id := md5(p_request_id::text || '-execute')::uuid;
    v_payment_req_id := md5(p_request_id::text || '-payment')::uuid;

    v_res_id := public.reserve_application_purchase_once(
      v_reserve_req_id, p_actor_id, p_application_id, v_app.purchase_terms_id,
      jsonb_build_object(
        'reservationDate', CURRENT_DATE,
        'agreementDate', CURRENT_DATE,
        'scheduleNotes', '[]'::jsonb
      )
    );

    select reservation_number into v_res_number
    from public.reservation_agreements where id=v_res_id;

    perform public.transition_purchase_reservation_once(
      v_submit_req_id, p_actor_id, v_res_id, 'submit', '{}'::jsonb
    );

    perform public.transition_purchase_reservation_once(
      v_execute_req_id, p_actor_id, v_res_id, 'execute', '{}'::jsonb
    );

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

-- 6. Redefine build_purchase_document_fields without signature fields (it reads
--    r.primary_signature_status, which no longer exists after the column drop).
create or replace function private.build_purchase_document_fields(p_kind text,p_source_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.reservation_agreements%rowtype; t public.customer_application_purchase_terms%rowtype;
  p public.payments%rowtype; s public.card_sales%rowtype; m public.memberships%rowtype;
  c public.customers%rowtype; a public.customer_applications%rowtype;
  common jsonb; commercial jsonb; fields jsonb; actor_name text; seller_name text;
  paid numeric; prior numeric; price numeric; primary_name text; primary_address text; secondary_name text; secondary_address text;
begin
  if p_kind='reservation' then select ra.* into r from public.reservation_agreements ra where ra.id=p_source_id;
  elsif p_kind in ('payment_recorded','payment_verified') then
    select pay.* into p from public.payments pay where pay.id=p_source_id;
    select ra.* into r from public.reservation_agreements ra where ra.id=p.reservation_id;
    if (p_kind='payment_recorded' and (p.status<>'recorded' or p_actor_id is distinct from p.recorded_by))
      or (p_kind='payment_verified' and (p.status<>'verified' or p_actor_id is distinct from p.verified_by)) then
      raise exception 'PURCHASE_DOCUMENT_STATE_CONFLICT' using errcode='55000';
    end if;
  elsif p_kind='purchase_finalized' then
    select cs.* into s from public.card_sales cs where cs.id=p_source_id;
    select ra.* into r from public.reservation_agreements ra where ra.sale_id=s.id and ra.origin='application';
    if p_actor_id is distinct from r.finalized_by then raise exception 'PURCHASE_DOCUMENT_ACTOR_CONFLICT' using errcode='42501'; end if;
  elsif p_kind='membership_activated' then
    select mem.* into m from public.memberships mem where mem.id=p_source_id;
    select cs.* into s from public.card_sales cs where cs.id=m.sale_id;
    select ra.* into r from public.reservation_agreements ra where ra.sale_id=s.id and ra.origin='application';
    if p_actor_id is distinct from m.activated_by then raise exception 'PURCHASE_DOCUMENT_ACTOR_CONFLICT' using errcode='42501'; end if;
  else raise exception 'PURCHASE_DOCUMENT_KIND_INVALID' using errcode='22023'; end if;
  if r.id is null or r.origin<>'application' then raise exception 'PURCHASE_DOCUMENT_SOURCE_NOT_FOUND' using errcode='P0002'; end if;
  select pt.* into t from public.customer_application_purchase_terms pt where pt.id=r.purchase_terms_id;
  select app.* into a from public.customer_applications app where app.id=r.customer_application_id;
  select cust.* into c from public.customers cust where cust.id=r.customer_id;
  select st.full_name into actor_name from public.staff_users st where st.id=p_actor_id and st.status='active';
  select st.full_name into seller_name from public.staff_users st where st.id=t.seller_staff_id;
  if actor_name is null then raise exception 'ACTOR_INACTIVE' using errcode='42501'; end if;
  if s.id is null and r.sale_id is not null then select cs.* into s from public.card_sales cs where cs.id=r.sale_id; end if;
  price:=t.total_price::numeric;
  select coalesce(sum(pay.amount::numeric),0) into paid from public.payments pay where pay.reservation_id=r.id and pay.status='verified';
  if (p_kind='purchase_finalized' and (r.finalized_at is null
    or s.status not in ('payment_verified','activation_pending','active') or paid<price
    or exists(select 1 from public.payments pay where pay.reservation_id=r.id and pay.status='recorded')))
    or (p_kind='membership_activated' and (m.status<>'active' or s.status<>'active'
      or m.customer_id is distinct from r.customer_id or paid<price)) then
    raise exception 'PURCHASE_DOCUMENT_STATE_CONFLICT' using errcode='55000';
  end if;
  common:=jsonb_build_object(
    'reservationNumber',r.reservation_number,'saleNumber',s.sale_number,'applicationNumber',a.application_number,
    'customerNumber',c.customer_number,'customerName',concat_ws(' ',c.first_name,nullif(c.middle_name,''),c.last_name,nullif(c.suffix,'')),
    'sellerName',coalesce(seller_name,''),'actorName',actor_name,'totalPrice',t.total_price);
  commercial:=jsonb_build_object('purchaseTermsId',t.id,'termsVersion',t.version,'tier',t.tier,'paymentScheme',t.payment_scheme,
    'reservationFee',t.reservation_fee,'requiredInitial',t.required_initial,'yearlyPoints',t.yearly_points,
    'validityMonths',t.validity_months,'commissionRate',t.commission_rate,'expectedCommission',t.expected_commission,
    'minimumDownPayment',t.minimum_down_payment,'installmentMonths',t.installment_months,'monthlyAmount',t.monthly_amount,
    'spotCashDays',t.spot_cash_days,'discountPercent',t.discount_percent,'annualPointsTranches',t.annual_points_tranches,
    'holderLimit',t.holder_limit,'inclusions',t.inclusions);
  if p_kind='reservation' then
    select h.name,h.address into primary_name,primary_address from public.reservation_agreement_holders h where h.agreement_id=r.id and h.holder_type='PRIMARY';
    select h.name,h.address into secondary_name,secondary_address from public.reservation_agreement_holders h where h.agreement_id=r.id and h.holder_type='SECONDARY';
    fields:=common||commercial||jsonb_build_object('status',r.status,'primaryName',coalesce(primary_name,''),
      'primaryAddress',coalesce(primary_address,''),'secondaryName',secondary_name,'secondaryAddress',secondary_address,'reservationDate',r.reservation_date,'agreementDate',r.agreement_date,
      'revisionNumber',r.revision_number,'monthlyAmortizationStart',r.monthly_amortization_start,
      'monthlyAmortizationEnd',r.monthly_amortization_end,'paymentDueDay',r.payment_due_day,
      'schedule',coalesce((select jsonb_agg(jsonb_build_object('lineNumber',line.line_number,'particular',line.particular,
        'amount',line.amount_snapshot,'paymentDate',line.payment_date,'remarks',line.remarks) order by line.line_number)
        from public.reservation_agreement_schedule line where line.agreement_id=r.id),'[]'::jsonb),'verifiedTotal',private.money(paid),'balance',private.money(greatest(price-paid,0)));
  elsif p_kind in ('payment_recorded','payment_verified') then
    prior:=case when p_kind='payment_verified' then paid-p.amount::numeric else paid end;
    fields:=common||jsonb_build_object('paymentNumber',p.payment_number,'amount',p.amount,'method',p.method,'reference',p.reference,
      'verifiedBefore',private.money(prior),'verifiedAfter',private.money(paid),'balanceBefore',private.money(greatest(price-prior,0)),
      'balanceAfter',private.money(greatest(price-paid,0)),'status',p.status);
  elsif p_kind='purchase_finalized' then
    fields:=common||commercial||jsonb_build_object('status','payment_verified','paymentNumbers',
      coalesce((select jsonb_agg(pay.payment_number order by pay.recorded_at,pay.id) from public.payments pay where pay.reservation_id=r.id and pay.status='verified'),'[]'::jsonb),
      'verifiedTotal',private.money(paid),'remainingBalance',private.money(greatest(price-paid,0)),'finalizedAt',r.finalized_at);
  else
    fields:=common||jsonb_build_object('membershipNumber',m.membership_number,'status','active','tier',t.tier,'yearlyPoints',t.yearly_points,
      'pointsAllocated',m.yearly_points_allocated,'validityMonths',t.validity_months,'verifiedTotal',private.money(paid),'expiresAt',m.expires_at,'activatedAt',m.activated_at);
  end if;
  if not private.purchase_document_fields_valid(p_kind,fields) then raise exception 'PURCHASE_DOCUMENT_FIELDS_INVALID' using errcode='23514'; end if;
  return fields;
end $$;

revoke all on function private.build_purchase_document_fields(text,uuid,uuid) from public, anon, authenticated, service_role;

-- 7. Redefine purchase_document_fields_valid without signature fields.
create or replace function private.purchase_document_fields_valid(p_kind text,p_fields jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare allowed text[]; base text[]; commercial text[]; payments text[]; k text; v jsonb;
begin
  if p_kind is null or jsonb_typeof(p_fields) is distinct from 'object' then return false; end if;
  base:=array['reservationNumber','saleNumber','applicationNumber','customerNumber','customerName','sellerName','actorName','totalPrice'];
  commercial:=array['purchaseTermsId','termsVersion','tier','paymentScheme','reservationFee','requiredInitial','yearlyPoints','validityMonths','commissionRate','expectedCommission','minimumDownPayment','installmentMonths','monthlyAmount','spotCashDays','discountPercent','annualPointsTranches','holderLimit','inclusions'];
  payments:=array['paymentNumber','amount','method','reference','verifiedBefore','verifiedAfter','balanceBefore','balanceAfter','status'];
  allowed:=case p_kind
    when 'reservation' then base||commercial||array['status','primaryName','primaryAddress','secondaryName','verifiedTotal','balance','reservationDate','agreementDate','revisionNumber','monthlyAmortizationStart','monthlyAmortizationEnd','paymentDueDay','secondaryAddress','schedule']
    when 'payment_recorded' then base||payments
    when 'payment_verified' then base||payments
    when 'purchase_finalized' then base||commercial||array['status','paymentNumbers','verifiedTotal','remainingBalance','finalizedAt']
    when 'membership_activated' then base||array['membershipNumber','status','tier','yearlyPoints','pointsAllocated','validityMonths','verifiedTotal','expiresAt','activatedAt']
    else null end;
  if allowed is null or not (p_fields ?& allowed) or exists(select 1 from jsonb_object_keys(p_fields) x(k) where not x.k=any(allowed)) then return false; end if;
  for k,v in select key,value from jsonb_each(p_fields) loop
    if k=any(array['totalPrice','reservationFee','requiredInitial','minimumDownPayment','expectedCommission','amount','verifiedBefore','verifiedAfter','balanceBefore','balanceAfter','verifiedTotal','remainingBalance','balance']) then
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then return false; end if;
    elsif k='commissionRate' then
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$' then return false; end if;
    elsif k=any(array['termsVersion','yearlyPoints','pointsAllocated','validityMonths','spotCashDays','discountPercent','annualPointsTranches','holderLimit']) then
      if jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^(0|[1-9][0-9]*)$' then return false; end if;
    elsif k='schedule' then
      if jsonb_typeof(v)<>'array' then return false; end if;
      for v in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(v)<>'object' then return false; end if;
        if not (v ?& array['lineNumber','particular','amount','paymentDate','remarks'])
          or exists(select 1 from jsonb_object_keys(v) x(k) where not x.k=any(array['lineNumber','particular','amount','paymentDate','remarks']))
          or jsonb_typeof(v->'lineNumber')<>'number' or (v->>'lineNumber') !~ '^[1-9][0-9]*$'
          or jsonb_typeof(v->'particular')<>'string'
          or jsonb_typeof(v->'amount')<>'string' or (v->>'amount') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
          or jsonb_typeof(v->'paymentDate') not in ('string','null')
          or jsonb_typeof(v->'remarks') not in ('string','null') then return false; end if;
      end loop;
    elsif k='installmentMonths' then
      if jsonb_typeof(v)<>'null' and (jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[1-9][0-9]*$') then return false; end if;
    elsif k='monthlyAmount' then
      if jsonb_typeof(v)<>'null' and (jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$') then return false; end if;
    elsif k='paymentDueDay' then
      if jsonb_typeof(v)<>'null' and (jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[1-9][0-9]*$' or (v#>>'{}')::integer>31) then return false; end if;
    elsif k in ('paymentNumbers','inclusions') then
      if jsonb_typeof(v)<>'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(v) a(value) where jsonb_typeof(a.value)<>'string') then return false; end if;
    elsif k=any(array['reservationNumber','saleNumber','applicationNumber','reference','secondaryName','revisionNumber','monthlyAmortizationStart','monthlyAmortizationEnd','secondaryAddress']) then
      if jsonb_typeof(v) not in ('string','null') then return false; end if;
    elsif jsonb_typeof(v)<>'string' then return false;
    end if;
  end loop;
  if p_kind='payment_recorded' then return p_fields->>'status'='recorded'; end if;
  if p_kind='payment_verified' then return p_fields->>'status'='verified'; end if;
  if p_kind='purchase_finalized' then return p_fields->>'status'='payment_verified'; end if;
  if p_kind='membership_activated' then return p_fields->>'status'='active'; end if;
  return true;
end $$;

revoke all on function private.purchase_document_fields_valid(text,jsonb) from public, anon, authenticated, service_role;
