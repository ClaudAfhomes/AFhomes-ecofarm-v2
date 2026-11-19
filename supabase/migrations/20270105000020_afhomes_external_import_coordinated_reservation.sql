-- Reuse the provisional RA created with an imported application.
-- Historical terms may bind only through the existing unfunded-draft synchronizer.
-- This migration does not broaden certification authority or relax payment guards.
-- Owner decision 18 Nov 2026: a Reservation Paid claim requires normal combined
-- Application & RA approval before Finance; certification alone is insufficient.
-- Validation:
--   select position('reservation:=private.sync_application_reservation_draft(app,p_actor,terms_id)' in prosrc)>0
--   from pg_proc where oid='private.reconcile_external_customer_import(uuid,uuid,text)'::regprocedure;
--   pnpm test:db:external-import; pnpm test:db:workflow; security/rls_invariants.sql.
-- Down: forward-only. Preserve imported applications, agreements and payment history.
begin;
do $repair$
declare
 definition text;
 old_call text:=$old$reservation:=public.reserve_application_purchase_once(gen_random_uuid(),p_actor,app,terms_id,
   jsonb_build_object('reservationDate',contract_date,'agreementDate',contract_date,'primarySignatureStatus','pending',
    'secondarySignatureStatus',header->>'secondarySignatureStatus','scheduleNotes','[]'::jsonb));$old$;
 new_call text:=$new$-- Reuse the provisional agreement created with this imported application.
  reservation:=private.sync_application_reservation_draft(app,p_actor,terms_id);
  update public.reservation_agreements set reservation_date=contract_date,agreement_date=contract_date
  where id=reservation;$new$;
begin
 old_call:=replace(old_call,E'\r\n',E'\n');new_call:=replace(new_call,E'\r\n',E'\n');
 select replace(pg_get_functiondef('private.reconcile_external_customer_import(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n') into definition;
 definition:=replace(definition,E'\r\n',E'\n');
 if position(new_call in definition)>0 then return; end if;
 if position(old_call in definition)=0 then
   raise exception 'IMPORT_COORDINATED_RESERVATION_REQUIRES_REVIEW';
 end if;
 execute replace(definition,old_call,new_call);
end $repair$;
do $repair$
declare definition text;
 old_call text:='continuation:=private.reconcile_external_customer_import(p_row_id,p_actor_id,p_reason);';
 new_call text:=$new$if exists(select 1 from public.customer_import_rows r where r.id=p_row_id
    and r.normalized_data->'externalSummary'->>'stage'='reservation'
    and not exists(select 1 from private.customer_import_source_rows link
      join private.customer_external_import_receipts receipt on receipt.source_id=link.source_id
      where link.row_id=p_row_id)) then
  perform private.mutation_actor_role(p_actor_id,'sales.customers','create');
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'EXTERNAL_IMPORT_ATTESTATION_REQUIRED';
  end if;
  continuation:=private.import_continuation_result(p_row_id);
  if not exists(select 1 from public.audit_events where entity_type='customer_import_row'
      and entity_id=p_row_id::text and action='IMPORTED_RESERVATION_APPROVAL_REQUIRED') then
    insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'IMPORTED_RESERVATION_APPROVAL_REQUIRED','customer_import_row',p_row_id::text,
      jsonb_build_object('sourceId',continuation->'sourceId','paymentClaimsOnly',true));
  end if;
  return result||jsonb_build_object('saleId',continuation->'saleId','importContinuation',continuation);
 end if;
 continuation:=private.reconcile_external_customer_import(p_row_id,p_actor_id,p_reason);$new$;
begin
 old_call:=replace(old_call,E'\r\n',E'\n');new_call:=replace(new_call,E'\r\n',E'\n');
 select pg_get_functiondef('public.commit_external_customer_import_row(uuid,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,E'\r\n',E'\n');
 if position('IMPORTED_RESERVATION_APPROVAL_REQUIRED' in definition)>0 then return; end if;
 if position(old_call in definition)=0 then raise exception 'EXTERNAL_IMPORT_DISPATCH_REQUIRES_REVIEW'; end if;
 execute replace(definition,old_call,new_call);
end $repair$;
do $repair$
declare definition text;
 old_clause text:=$old$external:=r.normalized_data->'externalSummary';stage:=external->>'stage';$old$;
 new_clause text:=$new$if r.normalized_data->'externalSummary'->>'stage'='reservation'
    and not exists(select 1 from private.customer_import_source_rows link
      join private.customer_external_import_receipts receipt on receipt.source_id=link.source_id
      where link.row_id=p_row) then
  return result||jsonb_build_object('externallyVerified',false,
    'missingRequirements',(result->'missingRequirements')||
      case when result->>'stage'='application' then
        jsonb_build_array('Complete combined Application and RA approval before Finance reviews the imported payment claim.')
      else '[]'::jsonb end);
 end if;
 external:=r.normalized_data->'externalSummary';stage:=external->>'stage';$new$;
begin
 old_clause:=replace(old_clause,E'\r\n',E'\n');new_clause:=replace(new_clause,E'\r\n',E'\n');
 select pg_get_functiondef('private.import_continuation_result(uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,E'\r\n',E'\n');
 if position('Complete combined Application and RA approval before Finance' in definition)>0 then return; end if;
 if position(old_clause in definition)=0 then raise exception 'EXTERNAL_IMPORT_REVIEW_STAGE_REQUIRES_REVIEW'; end if;
 execute replace(definition,old_clause,new_clause);
end $repair$;
do $repair$
declare definition text;
 old_clause text:=$old$if v_after<>v_before then raise exception 'IMPORT_RECORDING_CHANGED_VERIFIED_TOTAL';end if;$old$;
 new_clause text:=$new$perform public.set_payment_receipt_details(v_payment,p_actor_id,jsonb_build_object('paidOn',c.payment_date::text));
  if v_after<>v_before then raise exception 'IMPORT_RECORDING_CHANGED_VERIFIED_TOTAL';end if;$new$;
begin
 old_clause:=replace(old_clause,E'\r\n',E'\n');new_clause:=replace(new_clause,E'\r\n',E'\n');
 select pg_get_functiondef('public.accept_import_payment_claim_once(uuid,uuid,uuid,text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,E'\r\n',E'\n');
 if position(new_clause in definition)>0 then return; end if;
 if position(old_clause in definition)=0 then raise exception 'IMPORT_CLAIM_DATE_REQUIRES_REVIEW'; end if;
 execute replace(definition,old_clause,new_clause);
end $repair$;
notify pgrst,'reload schema';
commit;
