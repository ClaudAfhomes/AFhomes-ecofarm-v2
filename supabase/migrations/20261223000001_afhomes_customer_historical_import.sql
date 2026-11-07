-- Historical customer reconciliation using the canonical customer/VIP ID allocators.
-- Validation: run test:db:external-import and test:db:local on disposable PostgreSQL;
-- run security/rls_invariants.sql (empty = PASS). Browser roles retain SELECT-only access.
-- Down: forward repair only; never delete certified settlements, identifiers or points evidence.
begin;
do $$declare definition text;external_definition text;needle text;replacement text;begin
 select pg_get_functiondef('public.finalize_reservation_purchase_once(uuid,uuid,uuid)'::regprocedure) into definition;
 if position('private.finalize_external_reservation_purchase_once' in definition)>0 then
  select replace(pg_get_functiondef('private.finalize_reservation_before_external(uuid,uuid,uuid)'::regprocedure),'FUNCTION private.finalize_reservation_before_external(', 'FUNCTION public.finalize_reservation_purchase_once(') into definition;
 else
  execute replace(definition,'FUNCTION public.finalize_reservation_purchase_once(', 'FUNCTION private.finalize_reservation_before_external(');
 end if;
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

alter table private.customer_external_import_receipts drop constraint if exists customer_external_import_receipts_destination_check;
alter table private.customer_external_import_receipts add constraint customer_external_import_receipts_destination_check
 check(destination in ('application','reservation','finance','activation','active','inactive'));

-- Supplied/generated identifiers may be filled in on a later export without changing the purchase.
create or replace function private.import_business_intent(p_row uuid) returns text
language sql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
 select private.import_hash(jsonb_build_object(
  'person',coalesce(r.normalized_data->'customerFacts'->'person',r.normalized_data->'person'),
  'company',coalesce(r.normalized_data->'customerFacts'->'company',r.normalized_data->'company','{}')-
    array['raNumber','existingVipControlNumber','existingCardActivationStatus','existingStayPointsTotal','existingCardActivationDate','existingCardValidUntil','vipPurchaseDate','contractClassification','paymentTermMonths'],
  'claims',coalesce((select jsonb_agg(value-'customerKey'-'paymentKey' order by (value-'customerKey'-'paymentKey')::text) from jsonb_array_elements(coalesce(r.normalized_data->'paymentClaims','[]'))),'[]'),
  'existingReservation',nullif(r.raw_data->>'existing_reservation_reference','')))
 from public.customer_import_rows r where r.id=p_row
$$;
revoke all on function private.import_business_intent(uuid) from public,anon,authenticated,service_role;

-- One opening balance per membership, independent of file hashes and subsequent spending.
create table if not exists private.customer_import_points_baselines (
 membership_id uuid primary key references public.memberships(id) on delete restrict,
 row_id uuid not null references public.customer_import_rows(id) on delete restrict,
 confirmed_points bigint not null check(confirmed_points between 0 and 1000000000),
 actor_id uuid not null references public.staff_users(id) on delete restrict,
 created_at timestamptz not null default now()
);
alter table private.customer_import_points_baselines enable row level security;
revoke all on private.customer_import_points_baselines from public,anon,authenticated,service_role;
do $$begin
 if not exists(select 1 from pg_trigger where tgname='customer_import_points_baseline_immutable') then
  create trigger customer_import_points_baseline_immutable before update or delete on private.customer_import_points_baselines
   for each row execute function private.prevent_purchase_evidence_mutation();
 end if;
end $$;

create or replace function private.import_customer_vip_number(p_row uuid,p_customer uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare raw jsonb; certified boolean; existing text; supplied text; number text; scheme text; months integer; attempt integer;
begin
 perform private.import_source_actor(p_row,p_actor,'update');
 select raw_data,coalesce((normalized_data->>'externalVerified')::boolean,false) into strict raw,certified from public.customer_import_rows where id=p_row;
 select vip_card_number into existing from public.customers where id=p_customer for update;
 supplied:=nullif(raw->>'existing_vip_control_number','');
 if supplied is not null and supplied !~ '^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$' then raise exception 'IMPORT_VIP_NUMBER_FORMAT_CONFLICT';end if;
 if supplied is not null and nullif(raw->>'contract_classification','') is not null
  and (right(supplied,1)='N') is distinct from (raw->>'contract_classification'='Non-Standard') then raise exception 'IMPORT_VIP_CLASSIFICATION_CONFLICT';end if;
 if existing is not null then
  if supplied is not null and supplied<>existing then raise exception 'IMPORT_VIP_NUMBER_CONFLICT';end if;
  if nullif(raw->>'contract_classification','') is not null
   and (right(existing,1)='N') is distinct from (raw->>'contract_classification'='Non-Standard') then raise exception 'IMPORT_VIP_CLASSIFICATION_CONFLICT';end if;
  return;
 end if;
 if supplied is not null and not certified then raise exception 'IMPORT_VIP_EXISTING_EVIDENCE_REQUIRED';end if;
 if supplied is null then
  if raw->>'contract_classification'='Non-Standard' then raise exception 'IMPORT_VIP_CLASSIFICATION_UNSUPPORTED';end if;
  scheme:=case when raw->>'stated_payment_scheme_code' in ('spot_cash','move_a') then 'CASH' else 'INSTALLMENT' end;
  months:=case raw->>'stated_payment_scheme_code' when 'installment_4_month' then 4 when 'move_b1_40_12' then 12 when 'move_b2_25_12' then 12 else 1 end;
  if nullif(raw->>'payment_term_months','') is not null and (raw->>'payment_term_months')::integer<>months then raise exception 'IMPORT_VIP_TERM_CONFLICT';end if;
  -- Manually preserved numbers may occupy sequence values. Never reuse them.
  for attempt in 1..1000 loop
   number:=public.generate_vip_card_number(raw->>'vip_tier',scheme,months);
   begin
    update public.customers set vip_card_number=number where id=p_customer;
    return;
   exception when unique_violation then null;
   end;
  end loop;
  raise exception 'IMPORT_VIP_NUMBER_ALLOCATION_EXHAUSTED';
 end if;
 if exists(select 1 from public.customers where vip_card_number=supplied and id<>p_customer) then raise exception 'IMPORT_VIP_NUMBER_CONFLICT';end if;
 update public.customers set vip_card_number=supplied where id=p_customer;
end $$;
revoke all on function private.import_customer_vip_number(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.import_customer_membership(p_row uuid,p_sale uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare raw jsonb; s public.card_sales%rowtype; m public.memberships%rowtype; account public.points_accounts%rowtype;
 points bigint; previous bigint; activation date; expiry date; state text; claimed text;
begin
 perform private.import_source_actor(p_row,p_actor,'update');
 perform private.mutation_actor_role(p_actor,'finance.card_activation','update');
 select raw_data into strict raw from public.customer_import_rows where id=p_row;
 select * into strict s from public.card_sales where id=p_sale for update;
 if s.cash_price_snapshot::numeric<>(select coalesce(sum(p.amount::numeric),0) from public.payments p where p.sale_id=s.id and p.status='verified') then raise exception 'SALE_NOT_FULLY_PAID';end if;
 claimed:=coalesce(nullif(raw->>'existing_card_activation_status',''),case raw->>'stated_status' when 'Active VIP' then 'Active' else raw->>'stated_status' end);
 state:=case claimed when 'Active' then 'active' when 'Expired' then 'expired' when 'Cancelled' then 'cancelled' else 'suspended' end;
 activation:=nullif(raw->>'existing_card_activation_date','')::date;expiry:=nullif(raw->>'existing_card_valid_until','')::date;
 select * into m from public.memberships where customer_id=s.customer_id for update;
 if m.id is not null then
  if m.sale_id<>s.id or m.status<>state or (activation is not null and activation<>(m.activated_at at time zone 'Asia/Manila')::date)
   or (expiry is not null and expiry<>(m.expires_at at time zone 'Asia/Manila')::date) then raise exception 'IMPORT_MEMBERSHIP_HISTORY_CONFLICT';end if;
 else
  if activation is null or expiry is null then raise exception 'IMPORT_MEMBERSHIP_DATES_REQUIRED';end if;
  if activation>current_date or expiry<=activation or (state='active' and expiry<=current_date) or (state='expired' and expiry>current_date) then raise exception 'IMPORT_MEMBERSHIP_DATES_CONFLICT';end if;
  insert into public.memberships(customer_id,sale_id,membership_number,product_id,fallback_code_hash,qr_token_hash,status,points_balance,yearly_points_allocated,
   activated_by,activated_at,expires_at,renewal_due_at,issued_at,points_anniversary,sale_status_at_activation)
  values(s.customer_id,s.id,private.next_membership_number(),s.plan_id,private.hash_token(private.new_fallback_code()),private.hash_token(private.new_qr_token()),state,0,0,
   p_actor,activation::timestamp at time zone 'Asia/Manila',expiry::timestamp at time zone 'Asia/Manila',expiry::timestamp at time zone 'Asia/Manila',activation::timestamp at time zone 'Asia/Manila',activation,s.status)
  returning * into m;
  insert into public.points_accounts(membership_id) values(m.id);
  update public.card_sales set status='active',activated_at=m.activated_at where id=s.id;
  update public.customers set status=case when state in ('active','expired') then 'active' when state='cancelled' then 'cancelled' else 'suspended' end where id=s.customer_id;
 end if;
 select * into strict account from public.points_accounts where membership_id=m.id for update;
 if state<>'active' or nullif(raw->>'existing_stay_points_total','') is null then return;end if;
 points:=(raw->>'existing_stay_points_total')::bigint;
 if points<0 or points>1000000000 then raise exception 'IMPORT_POINTS_INVALID';end if;
 select confirmed_points into previous from private.customer_import_points_baselines where membership_id=m.id;
 if found then
  if previous<>points then raise exception 'IMPORT_POINTS_BASELINE_CONFLICT';end if;
  return;
 end if;
 perform private.ensure_points_period(account.id);
 select * into strict account from public.points_accounts where id=account.id for update;
 if account.reversal_debt<>0 or (account.balance<>points and (account.balance<>0 or exists(select 1 from public.points_ledger where account_id=account.id))) then raise exception 'IMPORT_POINTS_EXISTING_HISTORY_REVIEW_REQUIRED';end if;
 insert into private.customer_import_points_baselines(membership_id,row_id,confirmed_points,actor_id) values(m.id,p_row,points,p_actor);
 if account.balance=0 and points>0 then
  insert into public.points_ledger(account_id,entry_type,amount,balance_after,reference_type,reference_id,actor_id,reason,metadata,balance_before,counts_toward_cap)
  values(account.id,'cutover_baseline',points,points,'customer_import',p_row::text,p_actor,'Confirmed remaining historical Stay Points',jsonb_build_object('importRowId',p_row,'confirmedRemainingBalance',points),0,false);
  update public.points_accounts set balance=points,lifetime_allocated=lifetime_allocated+points,updated_at=now() where id=account.id;
 end if;
 update public.memberships set points_balance=points where id=m.id;
end $$;
revoke all on function private.import_customer_membership(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.import_target_version(p_row uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_customer uuid; v_source uuid; v_reference text; v_raw jsonb;
begin
 v_customer:=private.import_customer_for(p_row);
 select raw_data into strict v_raw from public.customer_import_rows where id=p_row;
 v_reference:=private.import_normal_key(coalesce(nullif(v_raw->>'purchase_reference',''),'legacy-import-'||p_row::text));
 select source_id into v_source from private.customer_import_source_rows where row_id=p_row;
 if v_source is null then select id into v_source from private.customer_import_purchase_sources where issuer_scope='afhomes' and (normalized_reference=v_reference or private.import_normal_key(purchase_reference)=v_reference);end if;
 return private.import_hash(jsonb_build_object(
 'customer',(select to_jsonb(c) from public.customers c where id=v_customer),
 'source',(select to_jsonb(s) from private.customer_import_purchase_sources s where id=v_source),
 'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.customer_applications a where customer_id=v_customer),'[]'),
 'holders',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.customer_application_holders h join public.customer_applications a on a.id=h.application_id where a.customer_id=v_customer),'[]'),
 'terms',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_application_purchase_terms t where customer_id=v_customer),'[]'),
 'reservations',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.reservation_agreements a where customer_id=v_customer),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where customer_id=v_customer),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from private.customer_import_payment_claims c where source_id=v_source),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.memberships m where m.customer_id=v_customer),'[]'),
 'points',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.points_accounts a join public.memberships m on m.id=a.membership_id where m.customer_id=v_customer),'[]'),
 'team',coalesce((select jsonb_agg(to_jsonb(s) order by s.staff_id,s.role_slug) from public.match_company_import_staff(array[v_raw->>'vd_name',v_raw->>'ssm_name',v_raw->>'sm_name',v_raw->>'referrer_name',v_raw->>'recommender_name']) s),'[]')
 ));
end $$;

create or replace function private.reconcile_external_customer_import(p_row uuid,p_actor uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare r public.customer_import_rows%rowtype; s private.customer_import_purchase_sources%rowtype;
 a public.customer_applications%rowtype; plan public.card_plans%rowtype;
 receipt private.customer_external_import_receipts%rowtype; existing_res public.reservation_agreements%rowtype;
 existing_payment public.payments%rowtype; candidates uuid[];
 app uuid; terms_id uuid; reservation uuid; sale uuid; seller uuid; payment uuid;
 summary jsonb; header jsonb; terms jsonb; proposal jsonb; claim record;
 total numeric; paid numeric; fee numeric; initial_amount numeric; months integer; monthly numeric;
 contract_date date; stage text; scheme text; n integer; certified boolean; historical boolean;
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
 if found then
  if r.normalized_data->'externalSummary'->>'stage' in ('active','inactive') then perform private.import_customer_membership(p_row,receipt.sale_id,p_actor);end if;
  perform private.import_customer_vip_number(p_row,s.customer_id,p_actor);
  return private.import_continuation_result(p_row);
 end if;
 perform 1 from public.customers where id=s.customer_id for update;
 perform private.import_check_team(r.raw_data);
 summary:=r.normalized_data->'externalSummary'; stage:=summary->>'stage';
 historical:=stage in ('active','inactive'); certified:=summary->>'settlement'='certified';
 total:=(r.raw_data->>'stated_total')::numeric;fee:=(r.raw_data->>'stated_rf')::numeric;
 contract_date:=(r.raw_data->>'contract_date')::date;scheme:=r.raw_data->>'stated_payment_scheme_code';
 if contract_date>current_date or total<=0 or fee<>10000 then raise exception 'EXTERNAL_IMPORT_TERMS_INVALID';end if;
 select coalesce(sum(c.amount::numeric),0),count(*) into paid,n from private.customer_import_payment_claims c where source_id=s.id;
 if exists(select 1 from private.customer_import_payment_claims where source_id=s.id and status in ('held','rejected')) then raise exception 'EXTERNAL_IMPORT_EXISTING_PAYMENT_REVIEW_REQUIRED';end if;
 if certified then
  if n<>0 or stage not in ('activation','active','inactive') then raise exception 'EXTERNAL_IMPORT_CERTIFICATION_CONFLICT';end if;
  paid:=total;
 end if;
 if paid<> (summary->>'paid')::numeric or total<>(summary->>'total')::numeric or total-paid<>(summary->>'balance')::numeric or paid>total then raise exception 'EXTERNAL_IMPORT_TOTAL_CONFLICT';end if;
 if not coalesce(case stage
  when 'application' then r.raw_data->>'stated_status'='Pending' and paid=0
  when 'reservation' then r.raw_data->>'stated_status'='Reservation Paid' and paid=fee
  when 'finance' then r.raw_data->>'stated_status' in ('Partially Paid','Down Payment') and paid>0 and paid<total
  when 'activation' then r.raw_data->>'stated_status'='Fully Paid' and paid=total
  when 'active' then (r.raw_data->>'stated_status'='Active VIP' or r.raw_data->>'existing_card_activation_status'='Active') and paid=total
  when 'inactive' then (r.raw_data->>'stated_status' in ('Inactive','Expired','Suspended','Cancelled') or r.raw_data->>'existing_card_activation_status' in ('Inactive','Expired','Suspended','Cancelled')) and paid=total else false end,false) then raise exception 'EXTERNAL_IMPORT_STATUS_CONFLICT';end if;
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
  if (existing_res.status='executed' and stage='reservation') or (existing_res.sale_id is not null and stage not in ('activation','active','inactive')) then raise exception 'EXTERNAL_IMPORT_STATUS_CONFLICT';end if;
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
  if certified and not exists(select 1 from public.payments p where p.reservation_id=reservation) then
   if sale is not null then raise exception 'EXTERNAL_IMPORT_EXISTING_PAYMENT_REVIEW_REQUIRED';end if;
   insert into public.payments(reservation_id,origin,customer_id,amount,payment_type,method,reference,notes,status,recorded_by,verified_by,verified_at)
   values(reservation,'reservation',s.customer_id,private.money(total),'full','historical_certification',s.purchase_reference,
    'Certified historical settlement; individual receipt dates and methods unavailable. '||p_reason,'verified',p_actor,p_actor,now());
  end if;
  if (select coalesce(sum(p.amount::numeric) filter(where p.status='verified'),0) from public.payments p where p.reservation_id=reservation)<>paid
    or exists(select 1 from public.payments p where p.reservation_id=reservation and p.status='recorded') then raise exception 'EXTERNAL_IMPORT_TOTAL_CONFLICT';end if;
  update public.reservation_agreements set total_payment_received_snapshot=private.money(paid),balance_snapshot=private.money(total-paid) where id=reservation and finalized_at is null;
  if stage in ('activation','active','inactive') and sale is null then sale:=private.finalize_external_reservation_purchase_once(gen_random_uuid(),reservation,p_actor);end if;
 end if;
 perform private.import_customer_vip_number(p_row,s.customer_id,p_actor);
 if s.purchase_reference is distinct from (select vip_card_number from public.customers where id=s.customer_id) then
  update private.customer_import_purchase_sources set purchase_reference=(select vip_card_number from public.customers where id=s.customer_id) where id=s.id;
 end if;
 if historical then perform private.import_customer_membership(p_row,sale,p_actor);end if;
 insert into private.customer_external_import_receipts(source_id,application_id,reservation_id,sale_id,confirmed_by,source_hash,reason,paid_total,remaining_balance,destination)
 values(s.id,app,reservation,sale,p_actor,private.import_source_hash(p_row),p_reason,private.money(paid),private.money(total-paid),stage);
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
 values(p_actor,'EXTERNAL_CUSTOMER_HISTORY_CONFIRMED','customer_import_row',p_row::text,
  jsonb_build_object('sourceId',s.id,'applicationId',app,'reservationId',reservation,'saleId',sale,'destination',stage,'paid',private.money(paid),'balance',private.money(total-paid),'reason',p_reason));
 return private.import_continuation_result(p_row);
end $$;
create or replace function private.import_continuation_result(p_row uuid,p_proposed_facts jsonb default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare member public.memberships%rowtype; customer uuid; result jsonb;r public.customer_import_rows%rowtype; external jsonb;stage text;path text;financial jsonb;
 existing_res public.reservation_agreements%rowtype;mismatches jsonb;
begin
 result:=private.import_continuation_before_external(p_row,p_proposed_facts);
 select * into strict r from public.customer_import_rows where id=p_row;
 if r.normalized_data->>'externalVerified' is distinct from 'true' then return result;end if;
 external:=r.normalized_data->'externalSummary';stage:=external->>'stage';
 customer:=private.import_customer_for(p_row);
 result:=result||jsonb_build_object('vipControlNumberPreview',jsonb_build_object(
  'existing',coalesce((select vip_card_number from public.customers where id=customer),nullif(r.raw_data->>'existing_vip_control_number','')),
  'generated',null,'source',case when coalesce((select vip_card_number from public.customers where id=customer),nullif(r.raw_data->>'existing_vip_control_number','')) is null then 'generated' else 'provided' end),
  'historicalPointsPreview',jsonb_build_object('eligible',stage='active' and external->>'existingPoints' is not null,
   'stayPointsTotal',external->>'existingPoints','reason',case when stage='active' then 'Confirmed remaining balance; repeat imports do not credit twice.' else 'Preserved as source history; this lifecycle receives no spendable points.' end));
 if r.raw_data->>'purchase_reference' like 'AUTO-VIP-%' and result->>'sourceId' is null then result:=result||jsonb_build_object('purchaseReference',null);end if;

 if nullif(r.raw_data->>'existing_vip_control_number','') is not null and exists(select 1 from public.customers c where c.vip_card_number=r.raw_data->>'existing_vip_control_number' and c.id is distinct from customer) then
  return result||jsonb_build_object('stage','review','conflicts',jsonb_build_array(jsonb_build_object('field','purchase_reference','message','This VIP card ID belongs to another customer.')));
 end if;
 if stage in ('active','inactive') then
  select * into member from public.memberships where customer_id=customer;
  if member.id is not null and exists(select 1 from private.customer_import_points_baselines b where b.membership_id=member.id and nullif(r.raw_data->>'existing_stay_points_total','') is not null and b.confirmed_points<>(r.raw_data->>'existing_stay_points_total')::bigint) then
   return result||jsonb_build_object('stage','review','conflicts',jsonb_build_array(jsonb_build_object('field','existing_stay_points_total','message','A different historical balance is already recorded. Reconcile the ledger instead of importing another opening balance.')));
  end if;
  if member.id is null and (nullif(r.raw_data->>'existing_card_activation_date','') is null or nullif(r.raw_data->>'existing_card_valid_until','') is null) then
   return result||jsonb_build_object('stage','review','missingRequirements',jsonb_build_array('Historical activation and valid-until dates are needed to create this membership; existing memberships keep their actual dates.'));
  end if;
 end if;

 if result->>'sourceId' is not null and exists(select 1 from private.customer_external_import_receipts where source_id=(result->>'sourceId')::uuid) then
  if result->>'reservationId' is not null then
   financial:=public.purchase_financial_summary((result->>'reservationId')::uuid);
   external:=external||jsonb_build_object('paid',financial->>'verifiedTotal','balance',financial->>'remainingBalance');
  end if;
  return result||jsonb_build_object('stage',case when stage in ('active','inactive') then stage else result->>'stage' end,'externalSummary',external,'externallyVerified',true);
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
   ('stated_status','The workbook status would reverse an executed or finalized reservation.',existing_res.status='cancelled' or existing_res.status='executed' and stage='reservation' or existing_res.sale_id is not null and stage not in ('activation','active','inactive'))
  ) checks(field,message,conflict);
  if jsonb_array_length(mismatches)>0 then return result||jsonb_build_object('stage','review','conflicts',(result->'conflicts')||mismatches);end if;
 end if;
 path:=case stage when 'application' then '/admin/customers/applications' when 'reservation' then '/admin/sales/reservations' when 'finance' then '/admin/finance/payments' when 'activation' then '/admin/finance/activation' when 'active' then '/admin/customers' when 'inactive' then '/admin/customers' end;
 return result||jsonb_build_object('stage',stage,'missingRequirements','[]'::jsonb,'externalSummary',external,'externallyVerified',true,
  'nextAction',jsonb_build_object('label','View imported business records','path',path));
end $$;
revoke all on function private.import_continuation_result(uuid,jsonb) from public,anon,authenticated,service_role;

-- Read-model repair only. No customer, payment, membership or history rows are rewritten.
-- Preserve the installed identifier matching, filters, pagination and privileges.
do $$
declare definition text; start_at integer; end_at integer; keep_allowances boolean;
begin
 select pg_get_functiondef('public.customer_directory(jsonb)'::regprocedure) into definition;
 keep_allowances:=position('weekday_available_points' in definition)>0;
 start_at:=strpos(definition,'with base as (');
 end_at:=strpos(definition,'), categorized as (');
 if start_at=0 or end_at<=start_at or strpos(definition,'lower(d.customer_number) like')=0 then
  raise exception 'CUSTOMER_PURCHASE_SUMMARY_DIRECTORY_PRECONDITION';
 end if;
 definition:=substr(definition,1,start_at-1)||$base$with base as (
 select c.*,concat_ws(' ',c.first_name,c.middle_name,c.last_name,c.suffix) as full_name,
 m.id as membership_id,m.membership_number,m.status as member_status,m.activated_at,m.expires_at,
 cp.code as tier,coalesce(pa.balance,0) as available_points,
 coalesce(fin.seller_id,application.referrer_staff_id) as seller_id,su.full_name as seller_name,
 coalesce(fin.paid,0) as verified_paid,coalesce(fin.total,0) as frozen_total,
 fin.reservation_fee,fin.required_initial,
 coalesce(fin.open_reservation_total,0) as open_reservation_total,
 coalesce(fin.open_reservation_paid,0) as open_reservation_paid,
 m.fallback_code_hash,m.qr_token_hash
 from public.customers c
 left join public.memberships m on m.customer_id=c.id
 left join public.points_accounts pa on pa.membership_id=m.id
 left join lateral (
  select sum(purchase.total) as total,sum(purchase.paid) as paid,
   sum(purchase.reservation_fee) as reservation_fee,sum(purchase.required_initial) as required_initial,
   sum(purchase.total) filter(where purchase.is_reservation) as open_reservation_total,
   sum(purchase.paid) filter(where purchase.is_reservation) as open_reservation_paid,
   (array_agg(purchase.plan_id order by purchase.created_at desc,purchase.id))[1] as plan_id,
   (array_agg(purchase.seller_id order by purchase.created_at desc,purchase.id))[1] as seller_id
  from (
   select s.id,s.created_at,s.plan_id,coalesce(s.seller_staff_id,s.seller_ost_id) as seller_id,
    s.cash_price_snapshot::numeric as total,s.reservation_fee_snapshot::numeric as reservation_fee,
    s.required_initial_snapshot::numeric as required_initial,false as is_reservation,
    (select coalesce(sum(p.amount::numeric),0) from public.payments p where p.sale_id=s.id and p.status='verified') as paid
   from public.card_sales s where s.customer_id=c.id and s.status<>'cancelled'
   union all
   select r.id,r.created_at,r.plan_id,r.seller_staff_id,r.total_price_snapshot::numeric,
    r.reservation_fee_snapshot::numeric,r.required_initial_snapshot::numeric,true,
    (select coalesce(sum(p.amount::numeric),0) from public.payments p where p.reservation_id=r.id and p.status='verified')
   from public.reservation_agreements r
   where r.customer_id=c.id and r.status in ('submitted','executed') and r.sale_id is null
  ) purchase
 ) fin on true
 left join lateral (
  select a.plan_id,a.referrer_staff_id from public.customer_applications a
  where a.customer_id=c.id and a.status not in ('cancelled','rejected')
  order by a.created_at desc,a.id limit 1
 ) application on true
 left join public.card_plans cp on cp.id=coalesce(m.product_id,fin.plan_id,application.plan_id)
 left join public.staff_users su on su.id=coalesce(fin.seller_id,application.referrer_staff_id)
 $base$||substr(definition,end_at);
 if keep_allowances then definition:=replace(definition,'coalesce(pa.balance,0) as available_points,','coalesce(pa.balance,0) as available_points,greatest(least(pa.weekday_balance,pa.balance),0) as weekday_available_points,greatest(least(pa.weekend_balance,pa.balance),0) as weekend_available_points,');end if;
 -- Some installed directory versions lost the company-ID search branch.
 if strpos(definition,'lower(d.ra_number) like')=0 then
  definition:=replace(definition,'lower(d.customer_number) like',
   'lower(d.ra_number) like ''%''||lower(p_filters->>''search'')||''%'' or lower(d.customer_number) like');
 end if;
 execute definition;
end $$;
revoke all on function public.customer_directory(jsonb) from public,anon,authenticated;
grant execute on function public.customer_directory(jsonb) to service_role;


do $$declare definition text;needle text:='normalized_reference=private.import_normal_key(v_reference)';begin
 select pg_get_functiondef('private.commit_customer_import_source(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure) into definition;
 if position(needle in definition)=0 then raise exception 'IMPORT_VIP_SOURCE_ALIAS_PRECONDITION';end if;
 if position('lower(purchase_reference)' in definition)=0 then
  definition:=replace(definition,needle,'(normalized_reference=private.import_normal_key(v_reference) or lower(purchase_reference)=lower(v_reference))');
  execute definition;
 end if;
end $$;

-- A v5 intake assigns its identifiers even when individual payments still need review.
do $$declare definition text;needle text:='  return jsonb_build_object(''customerId'',v_result->''customerId''';begin
 select pg_get_functiondef('public.commit_customer_import_row(uuid,uuid)'::regprocedure) into definition;
 if position('private.import_customer_vip_number' in definition)=0 then
  if position(needle in definition)=0 then raise exception 'IMPORT_VIP_INTAKE_PRECONDITION';end if;
  execute replace(definition,needle,
  '  if r.raw_data ? ''existing_vip_control_number'' then
    perform private.import_customer_vip_number(p_row_id,(v_result->>''customerId'')::uuid,p_actor_id);
    update private.customer_import_purchase_sources set purchase_reference=(select vip_card_number from public.customers where id=(v_result->>''customerId'')::uuid) where id=(v_result->>''sourceId'')::uuid;
    v_result:=private.import_continuation_result(p_row_id);
   end if;
  '||needle);
 end if;
end $$;

do $$declare definition text;needle text;begin
 select pg_get_functiondef('private.commit_customer_import_source(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure) into definition;
 needle:='s.intent_hash<>v_intent';
 if position('private.import_business_intent' in definition)=0 then
  if position(needle in definition)=0 then raise exception 'IMPORT_BUSINESS_INTENT_DRIFT';end if;
  definition:=replace(definition,needle,'(s.intent_hash<>v_intent and private.import_business_intent(s.original_row_id)<>private.import_business_intent(p_row_id))');
  needle:='  insert into private.customer_import_payment_claims';
  if position(needle in definition)=0 then raise exception 'IMPORT_PAYMENT_ALIAS_DRIFT';end if;
  definition:=replace(definition,needle,
  '  if v_claim->>''paymentKey'' like ''AUTO-%'' and (select count(*) from private.customer_import_payment_claims where source_id=s.id and fingerprint=v_fingerprint and claim_reference like ''AUTO-%'')=1 then
    v_claim:=jsonb_set(v_claim,''{paymentKey}'',to_jsonb((select claim_reference from private.customer_import_payment_claims where source_id=s.id and fingerprint=v_fingerprint and claim_reference like ''AUTO-%'')));
   end if;
  '||needle);
  execute definition;
 end if;
end $$;

-- Preserve the published ID formats at their boundaries instead of truncating a serial.
do $$declare definition text;begin
 select pg_get_functiondef('private.assign_company_customer_id()'::regprocedure) into definition;
 if position('greatest(4,length(v_serial::text))' in definition)=0 then
  if position('lpad(v_serial::text, 4, ''0'')' in definition)=0 then raise exception 'CUSTOMER_ID_ALLOCATOR_DRIFT';end if;
  execute replace(definition,'lpad(v_serial::text, 4, ''0'')','lpad(v_serial::text, greatest(4,length(v_serial::text)), ''0'')');
 end if;
 select pg_get_functiondef('public.generate_vip_card_number(text,text,integer)'::regprocedure) into definition;
 if position('VIP_CARD_NUMBER_RANGE_EXHAUSTED' in definition)=0 then
  if position('v_seq := nextval(''private.vip_card_number_seq'');' in definition)=0 then raise exception 'VIP_ALLOCATOR_DRIFT';end if;
  execute replace(definition,'v_seq := nextval(''private.vip_card_number_seq'');',
   'v_seq := nextval(''private.vip_card_number_seq''); if v_seq>99999 then raise exception ''VIP_CARD_NUMBER_RANGE_EXHAUSTED'';end if;');
 end if;
end $$;

commit;
