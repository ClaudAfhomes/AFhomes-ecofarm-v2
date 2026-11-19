-- Opt-in historical reconciliation. No existing rows are promoted by this migration.
-- Order follows the repository's future-dated migration chain (CLI scaffold 20261020082945).
-- Roll forward only: accepted external history, payments and source receipts are immutable.
create table private.customer_external_import_receipts (
 source_id uuid primary key references private.customer_import_purchase_sources(id) on delete restrict,
 application_id uuid not null unique references public.customer_applications(id) on delete restrict,
 reservation_id uuid unique references public.reservation_agreements(id) on delete restrict,
 sale_id uuid unique references public.card_sales(id) on delete restrict,
 confirmed_by uuid not null references public.staff_users(id) on delete restrict,
 confirmed_at timestamptz not null default now(),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 reason text not null check(length(btrim(reason)) between 10 and 500),
 paid_total text not null, remaining_balance text not null,
 destination text not null check(destination in ('application','reservation','finance','activation'))
);
alter table private.customer_external_import_receipts enable row level security;
revoke all on private.customer_external_import_receipts from public,anon,authenticated,service_role;
create trigger external_import_receipt_immutable before update or delete on private.customer_external_import_receipts
 for each row execute function private.prevent_purchase_evidence_mutation();

-- External acceptance is not a claim that a customer's signature/consent was collected here.
alter table public.customer_applications alter column acknowledged_at drop not null;
create function private.require_application_acknowledgment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if exists(select 1 from public.customer_applications a where a.id=new.id and a.acknowledged_at is null
  and not exists(select 1 from private.customer_external_import_receipts e where e.application_id=a.id)) then
  raise exception 'APPLICATION_ACKNOWLEDGMENT_REQUIRED';
 end if;
 return null;
end $$;
revoke all on function private.require_application_acknowledgment() from public,anon,authenticated,service_role;
create constraint trigger application_acknowledgment_required after insert or update on public.customer_applications
 deferrable initially deferred for each row execute function private.require_application_acknowledgment();

-- Preserve all finalization gates. Historical sales carry import provenance and must
-- not capture today's genealogy as though it existed on the original contract date.
-- The old installer used an LF-only replacement; CRLF function bodies missed its guard.
do $$declare definition text;patched text;begin
 select pg_get_functiondef('private.capture_card_sale_hierarchy()'::regprocedure) into definition;
 if position('new.origin' in definition)=0 then
  patched:=regexp_replace(definition,'\mbegin\M',E'begin\n  if new.origin = ''legacy_import'' then return new; end if;','i');
  if patched=definition then raise exception 'EXTERNAL_IMPORT_HIERARCHY_GUARD_DRIFT';end if;
  execute patched;
 end if;
end $$;
do $$declare definition text;external_definition text;needle text;replacement text;begin
 select pg_get_functiondef('public.finalize_reservation_purchase_once(uuid,uuid,uuid)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION public.finalize_reservation_purchase_once(', 'FUNCTION private.finalize_reservation_before_external(');
 external_definition:=replace(definition,'FUNCTION public.finalize_reservation_purchase_once(', 'FUNCTION private.finalize_external_reservation_purchase_once(');
 needle:='expected_commission_snapshot,status,submitted_at,payment_verified_at,fully_paid_at,';
 if position(needle in external_definition)=0 then raise exception 'EXTERNAL_IMPORT_FINALIZER_DRIFT';end if;
 external_definition:=replace(external_definition,needle,'expected_commission_snapshot,origin,import_job_id,import_row_id,status,submitted_at,payment_verified_at,fully_paid_at,');
 needle:='v_terms.expected_commission,''payment_verified'',v_now,v_now,v_now,';
 replacement:='v_terms.expected_commission,''legacy_import'',
  (select ir.import_job_id from private.customer_import_purchase_sources src join public.customer_import_rows ir on ir.id=src.original_row_id where src.application_id=v_app.id and src.superseded_by is null),
  (select src.original_row_id from private.customer_import_purchase_sources src where src.application_id=v_app.id and src.superseded_by is null),
  ''payment_verified'',v_now,v_now,v_now,';
 if position(needle in external_definition)=0 then raise exception 'EXTERNAL_IMPORT_FINALIZER_DRIFT';end if;
 execute replace(external_definition,needle,replacement);
end $$;
revoke all on function private.finalize_reservation_before_external(uuid,uuid,uuid),private.finalize_external_reservation_purchase_once(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.finalize_reservation_purchase_once(p_request_id uuid,p_reservation_id uuid,p_actor_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if exists(select 1 from private.customer_external_import_receipts where reservation_id=p_reservation_id) then
  return private.finalize_external_reservation_purchase_once(p_request_id,p_reservation_id,p_actor_id);
 end if;
 return private.finalize_reservation_before_external(p_request_id,p_reservation_id,p_actor_id);
end $$;
revoke all on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) to service_role;

create function private.reconcile_external_customer_import(p_row uuid,p_actor uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,extensions,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype; s private.customer_import_purchase_sources%rowtype;
 a public.customer_applications%rowtype; plan public.card_plans%rowtype;
 receipt private.customer_external_import_receipts%rowtype; existing_res public.reservation_agreements%rowtype;
 existing_payment public.payments%rowtype; candidates uuid[];
 app uuid; terms_id uuid; reservation uuid; sale uuid; seller uuid; payment uuid;
 summary jsonb; header jsonb; terms jsonb; proposal jsonb; claim record;
 total numeric; paid numeric; fee numeric; initial_amount numeric; months integer; monthly numeric;
 contract_date date; stage text; scheme text; n integer;
begin
 perform private.import_source_actor(p_row,p_actor,'update');
 perform private.mutation_actor_role(p_actor,'sales.customers','create');
 perform private.mutation_actor_role(p_actor,'sales.card_sales','create');
 perform private.mutation_actor_role(p_actor,'finance.payment_verification','update');
 if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'EXTERNAL_IMPORT_ATTESTATION_REQUIRED';end if;
 select * into strict r from public.customer_import_rows where id=p_row for update;
 if r.normalized_data->>'externalVerified' is distinct from 'true' then raise exception 'EXTERNAL_IMPORT_PREVIEW_REQUIRED';end if;
 select src.* into strict s from private.customer_import_source_rows link join private.customer_import_purchase_sources src on src.id=link.source_id where link.row_id=p_row for update of src;
 select * into receipt from private.customer_external_import_receipts where source_id=s.id;
 if found then return private.import_continuation_result(p_row);end if;
 perform 1 from public.customers where id=s.customer_id for update;
 perform private.import_check_team(r.raw_data);
 summary:=r.normalized_data->'externalSummary'; stage:=summary->>'stage';
 total:=(r.raw_data->>'stated_total')::numeric;fee:=(r.raw_data->>'stated_rf')::numeric;
 contract_date:=(r.raw_data->>'contract_date')::date;scheme:=r.raw_data->>'stated_payment_scheme_code';
 if contract_date>current_date or total<=0 or fee<>10000 then raise exception 'EXTERNAL_IMPORT_TERMS_INVALID';end if;
 select coalesce(sum(c.amount::numeric),0),count(*) into paid,n from private.customer_import_payment_claims c where source_id=s.id;
 if exists(select 1 from private.customer_import_payment_claims where source_id=s.id and status in ('held','rejected')) then raise exception 'EXTERNAL_IMPORT_EXISTING_PAYMENT_REVIEW_REQUIRED';end if;
 if paid<> (summary->>'paid')::numeric or total<>(summary->>'total')::numeric or total-paid<>(summary->>'balance')::numeric or paid>total then raise exception 'EXTERNAL_IMPORT_TOTAL_CONFLICT';end if;
 if not coalesce(case stage
  when 'application' then r.raw_data->>'stated_status'='Pending' and paid=0
  when 'reservation' then r.raw_data->>'stated_status'='Reservation Paid' and paid=fee
  when 'finance' then r.raw_data->>'stated_status' in ('Partially Paid','Down Payment') and paid>0 and paid<total
  when 'activation' then r.raw_data->>'stated_status'='Fully Paid' and paid=total else false end,false) then raise exception 'EXTERNAL_IMPORT_STATUS_CONFLICT';end if;
 select * into strict plan from public.card_plans where upper(code)=r.raw_data->>'vip_tier' and is_active;
 if nullif(r.raw_data->>'referrer_staff_id','') is null then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED';end if;
 seller:=private.purchase_seller_for(p_actor,(r.raw_data->>'referrer_staff_id')::uuid);
 if s.application_id is not null then
  app:=s.application_id;
  select * into strict a from public.customer_applications where id=app for update;
  select * into existing_res from public.reservation_agreements where customer_application_id=app and status<>'cancelled' order by created_at desc limit 1 for update;
  if stage='application' or a.status<>'approved' or existing_res.id is null or existing_res.customer_id<>s.customer_id
   or existing_res.seller_staff_id<>seller or existing_res.total_price_snapshot::numeric<>total or existing_res.reservation_fee_snapshot::numeric<>fee
   or existing_res.tier_snapshot<>plan.code or existing_res.payment_scheme_snapshot<>scheme or existing_res.reservation_date<>contract_date then
   raise exception 'EXTERNAL_IMPORT_EXISTING_APPLICATION_REVIEW_REQUIRED';end if;
  if (existing_res.status='executed' and stage='reservation') or (existing_res.sale_id is not null and stage<>'activation') then raise exception 'EXTERNAL_IMPORT_STATUS_CONFLICT';end if;
  reservation:=existing_res.id;terms_id:=a.purchase_terms_id;sale:=existing_res.sale_id;
 else
 header:=jsonb_build_object('customerId',s.customer_id,'planId',plan.id,'paymentScheme',scheme,
  'consentAcknowledged',false,'acknowledgedAt',null,'primarySignatureStatus','pending',
  'secondarySignatureStatus',case when r.normalized_data->'customerFacts'->'secondary'<>'null'::jsonb then 'pending' end,
  'validIdReceived',false,'reservationPaymentProofReceived',false,'acquisitionChannels','[]'::jsonb,
  'svdStaffId',nullif(r.raw_data->>'vd_staff_id',''),'ssmStaffId',nullif(r.raw_data->>'ssm_staff_id',''),
  'smStaffId',nullif(r.raw_data->>'sm_staff_id',''),'referrerStaffId',nullif(r.raw_data->>'referrer_staff_id',''),
  'vipRecommenderName',r.raw_data->>'recommender_name','recommenderContact',r.raw_data->>'recommender_contact','recommenderEmail',r.raw_data->>'recommender_email');
 app:=public.save_customer_application(null,p_actor,header,r.normalized_data->'customerFacts'->'primary',nullif(r.normalized_data->'customerFacts'->'secondary','null'::jsonb));
 update private.customer_import_purchase_sources set application_id=app where id=s.id;
 end if;
 if stage<>'application' then
  if reservation is null then
  proposal:=private.purchase_terms_for_application(app,seller,'submission');terms:=proposal->'terms';
  months:=(terms->>'installmentMonths')::integer;
  initial_amount:=case scheme when 'move_b1_40_12' then round(total*0.40,2) when 'move_b2_25_12' then round(total*0.25,2) else fee end;
  if months is not null then monthly:=(total-initial_amount)/months;
   if monthly<>round(monthly,2) then raise exception 'EXTERNAL_IMPORT_INEXACT_SCHEDULE';end if;
  end if;
  terms_id:=gen_random_uuid();
  insert into public.customer_application_purchase_terms(id,application_id,customer_id,plan_id,seller_staff_id,version,capture_kind,reason,captured_by,
   tier,payment_scheme,total_price,reservation_fee,minimum_down_payment,required_initial,installment_months,monthly_amount,
   spot_cash_days,validity_months,discount_percent,yearly_points,annual_points_tranches,holder_limit,inclusions,
   commission_rule_id,commission_rate,commission_base,expected_commission)
  values(terms_id,app,s.customer_id,plan.id,seller,1,'review',p_reason,p_actor,plan.code,scheme,private.money(total),private.money(fee),
   private.money(initial_amount),private.money(initial_amount),months,case when months is not null then private.money(monthly) end,
   (terms->>'spotCashDays')::integer,(terms->>'validityMonths')::integer,(terms->>'discountPercent')::integer,
   (terms->>'yearlyPoints')::integer,(terms->>'annualPointsTranches')::integer,(terms->>'holderLimit')::integer,terms->'inclusions',
   null,'0',private.money(total),'0.00');
  update public.customer_applications set purchase_terms_id=terms_id,status='approved',submitted_at=now(),approved_at=now(),vip_amount_snapshot=private.money(total) where id=app;
  reservation:=public.reserve_application_purchase_once(gen_random_uuid(),p_actor,app,terms_id,
   jsonb_build_object('reservationDate',contract_date,'agreementDate',contract_date,'primarySignatureStatus','pending',
    'secondarySignatureStatus',header->>'secondarySignatureStatus','scheduleNotes','[]'::jsonb));
  end if;
  -- Acceptance comes from the immutable external receipt, not fictitious local signatures/documents.
  update public.reservation_agreements set status=case when stage='reservation' then 'submitted' else 'executed' end,
   submitted_at=coalesce(submitted_at,now()),executed_at=case when stage<>'reservation' then coalesce(executed_at,now()) else executed_at end where id=reservation and status<>'executed';
  for claim in select * from private.customer_import_payment_claims where source_id=s.id order by payment_date,id for update loop
   perform pg_advisory_xact_lock(hashtextextended('import-payment:'||claim.fingerprint,0));
   select array_agg(p.id) into candidates from public.payments p where p.customer_id=s.customer_id and p.status not in ('voided','rejected') and p.amount::numeric=claim.amount::numeric
     and p.method=claim.method and (p.reference=claim.bank_reference and nullif(claim.bank_reference,'') is not null
       or p.id=claim.payment_id or exists(select 1 from private.customer_import_payment_claims old where old.payment_id=p.id and old.fingerprint=claim.fingerprint));
   if cardinality(candidates)>1 then raise exception 'EXTERNAL_IMPORT_POSSIBLE_DUPLICATE_PAYMENT';end if;
   payment:=null;
   if cardinality(candidates)=1 then
    select * into strict existing_payment from public.payments where id=candidates[1] for update;
    if existing_payment.reservation_id is distinct from reservation or existing_payment.status<>'verified' or (existing_payment.recorded_at at time zone 'Asia/Manila')::date<>claim.payment_date then raise exception 'EXTERNAL_IMPORT_POSSIBLE_DUPLICATE_PAYMENT';end if;
    payment:=existing_payment.id;
   else
    if sale is not null then raise exception 'EXTERNAL_IMPORT_EXISTING_PAYMENT_REVIEW_REQUIRED';end if;
   insert into public.payments(reservation_id,origin,customer_id,amount,payment_type,method,reference,notes,status,recorded_by,recorded_at,verified_by,verified_at)
   values(reservation,'reservation',s.customer_id,claim.amount,case claim.purpose when 'reservation' then 'down_payment' else claim.purpose end,
    claim.method,nullif(claim.bank_reference,''),'Externally verified historical import: '||s.purchase_reference||'. '||claim.notes,
    'verified',p_actor,claim.payment_date::timestamptz,p_actor,now()) returning id into payment;
   end if;
   update private.customer_import_payment_claims set payment_id=payment,status='matched',reviewed_by=p_actor,review_reason=p_reason where id=claim.id;
  end loop;
  if (select coalesce(sum(p.amount::numeric) filter(where p.status='verified'),0) from public.payments p where p.reservation_id=reservation)<>paid
    or exists(select 1 from public.payments p where p.reservation_id=reservation and p.status='recorded') then raise exception 'EXTERNAL_IMPORT_TOTAL_CONFLICT';end if;
  update public.reservation_agreements set total_payment_received_snapshot=private.money(paid),balance_snapshot=private.money(total-paid) where id=reservation and finalized_at is null;
  if stage='activation' and sale is null then sale:=private.finalize_external_reservation_purchase_once(gen_random_uuid(),reservation,p_actor);end if;
 end if;
 insert into private.customer_external_import_receipts(source_id,application_id,reservation_id,sale_id,confirmed_by,source_hash,reason,paid_total,remaining_balance,destination)
 values(s.id,app,reservation,sale,p_actor,private.import_source_hash(p_row),p_reason,private.money(paid),private.money(total-paid),stage);
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
 values(p_actor,'EXTERNAL_CUSTOMER_HISTORY_CONFIRMED','customer_import_row',p_row::text,
  jsonb_build_object('sourceId',s.id,'applicationId',app,'reservationId',reservation,'saleId',sale,'destination',stage,'paid',private.money(paid),'balance',private.money(total-paid),'reason',p_reason));
 return private.import_continuation_result(p_row);
end $$;
revoke all on function private.reconcile_external_customer_import(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.commit_external_customer_import_row(p_row_id uuid,p_actor_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result jsonb;continuation jsonb;
begin
 result:=public.commit_customer_import_row(p_row_id,p_actor_id);
 continuation:=private.reconcile_external_customer_import(p_row_id,p_actor_id,p_reason);
 return result||jsonb_build_object('saleId',continuation->'saleId','importContinuation',continuation);
end $$;
revoke all on function public.commit_external_customer_import_row(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.commit_external_customer_import_row(uuid,uuid,text) to service_role;

do $$declare definition text;begin
 select pg_get_functiondef('private.import_continuation_result(uuid,jsonb)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION private.import_continuation_result(', 'FUNCTION private.import_continuation_before_external(');
end $$;
revoke all on function private.import_continuation_before_external(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function private.import_continuation_result(p_row uuid,p_proposed_facts jsonb default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result jsonb;r public.customer_import_rows%rowtype; external jsonb;stage text;path text;financial jsonb;
 existing_res public.reservation_agreements%rowtype;mismatches jsonb;
begin
 result:=private.import_continuation_before_external(p_row,p_proposed_facts);
 select * into strict r from public.customer_import_rows where id=p_row;
 if r.normalized_data->>'externalVerified' is distinct from 'true' then return result;end if;
 external:=r.normalized_data->'externalSummary';stage:=external->>'stage';
 if result->>'sourceId' is not null and exists(select 1 from private.customer_external_import_receipts where source_id=(result->>'sourceId')::uuid) then
  if result->>'reservationId' is not null then
   financial:=public.purchase_financial_summary((result->>'reservationId')::uuid);
   external:=external||jsonb_build_object('paid',financial->>'verifiedTotal','balance',financial->>'remainingBalance');
  end if;
  return result||jsonb_build_object('externalSummary',external,'externallyVerified',true);
 end if;
 if result->>'applicationId' is not null and result->>'reservationId' is null then
  return result||jsonb_build_object('stage','review','conflicts',jsonb_build_array(jsonb_build_object('field','external_history','message','Existing application needs explicit reconciliation; import will not replace approved history.')));
 end if;
 if result->>'reservationId' is not null then
  select * into strict existing_res from public.reservation_agreements where id=(result->>'reservationId')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('field',field,'message',message)) filter(where conflict),'[]'::jsonb) into mismatches
  from (values
   ('contract_date','Contract date differs from the existing reservation date.',existing_res.reservation_date is distinct from (r.raw_data->>'contract_date')::date),
   ('stated_total','Contract total differs from the frozen reservation total.',existing_res.total_price_snapshot::numeric is distinct from (r.raw_data->>'stated_total')::numeric),
   ('stated_rf','Included reservation fee differs from the frozen reservation fee.',existing_res.reservation_fee_snapshot::numeric is distinct from (r.raw_data->>'stated_rf')::numeric),
   ('vip_tier','VIP tier differs from the existing reservation.',existing_res.tier_snapshot is distinct from r.raw_data->>'vip_tier'),
   ('stated_payment_scheme','Payment terms differ from the existing reservation.',existing_res.payment_scheme_snapshot is distinct from r.raw_data->>'stated_payment_scheme_code'),
   ('referrer_staff_id','The registered seller differs from the existing reservation seller.',existing_res.seller_staff_id::text is distinct from r.raw_data->>'referrer_staff_id'),
   ('stated_status','The workbook status would reverse an executed or finalized reservation.',existing_res.status='cancelled' or existing_res.status='executed' and stage='reservation' or existing_res.sale_id is not null and stage<>'activation')
  ) checks(field,message,conflict);
  if jsonb_array_length(mismatches)>0 then return result||jsonb_build_object('stage','review','conflicts',(result->'conflicts')||mismatches);end if;
 end if;
 path:=case stage when 'application' then '/admin/customers/applications' when 'reservation' then '/admin/sales/reservations' when 'finance' then '/admin/finance/payments' when 'activation' then '/admin/finance/activation' end;
 return result||jsonb_build_object('stage',stage,'missingRequirements','[]'::jsonb,'externalSummary',external,'externallyVerified',true,
  'nextAction',jsonb_build_object('label','View imported business records','path',path));
end $$;
revoke all on function private.import_continuation_result(uuid,jsonb) from public,anon,authenticated,service_role;
