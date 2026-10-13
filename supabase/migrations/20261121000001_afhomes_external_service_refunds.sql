-- Finance-managed external cash repayment; this migration never sends money.
-- Validate locally: refund request/approval/repayment HTTP tests; browser roles have no write grants.
-- Down: forward-only; revoke function execution to retire, preserve all financial history.
-- Existing points compensations remain authoritative; nullable quote permits cash-only earning corrections.
alter table public.purchase_point_refunds alter column quote_id drop not null;
create table if not exists public.service_refunds (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id),
 reference text not null unique check(length(btrim(reference)) between 3 and 120),
 service_value text not null check(service_value ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' and service_value::numeric>0),
 cash_amount text not null check(cash_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
 status text not null default 'pending_approval' check(status in('pending_approval','approved_pending_repayment','partially_repaid','completed','rejected','cancelled')),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 requested_by uuid not null references public.staff_users(id), requested_at timestamptz not null default now(),
 reviewed_by uuid references public.staff_users(id), reviewed_at timestamptz,
 points_restored bigint not null default 0 check(points_restored>=0),
 earned_points_adjusted bigint not null default 0 check(earned_points_adjusted>=0),
 point_refund_id uuid references public.purchase_point_refunds(id)
);
create index if not exists service_refunds_purchase_idx on public.service_refunds(purchase_id,requested_at desc,id desc);
create table if not exists public.service_refund_repayments (
 id uuid primary key default gen_random_uuid(), refund_id uuid not null references public.service_refunds(id),
 amount text not null check(amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' and amount::numeric>0),
 method text not null check(method in('cash','bank_transfer','gcash','other')),
 reference text not null check(length(btrim(reference)) between 3 and 120),
 repaid_at timestamptz not null, recorded_by uuid not null references public.staff_users(id),
 recorded_at timestamptz not null default now(), unique(method,reference)
);
alter table public.service_refund_repayments add column if not exists receipt_path text;
alter table public.service_refunds enable row level security;
alter table public.service_refund_repayments enable row level security;
revoke all on public.service_refunds,public.service_refund_repayments from public,anon,authenticated,service_role;
grant select on public.service_refunds,public.service_refund_repayments to service_role;

create or replace function public.manage_service_refund(p_purchase_id uuid,p_refund_id uuid,p_operation text,p_input jsonb,p_actor_id uuid)
returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_p public.purchases%rowtype;v_f public.service_refunds%rowtype;v_q public.redemption_quotes%rowtype;
 v_payment public.service_refund_repayments%rowtype;v_claim public.earning_claims%rowtype;
 v_value numeric;v_cash numeric;v_collected numeric;v_prior numeric;v_cash_prior numeric;v_paid numeric;
 v_points bigint:=0;v_prior_points bigint:=0;v_point_value numeric:=0;v_point_refund uuid;
 v_before bigint:=0;v_after bigint:=0;v_reversed_before bigint:=0;v_reversed_after bigint:=0;v_adjust bigint:=0;
 v_base numeric;v_method text;v_reference text;v_repaid_at timestamptz;v_id uuid;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.payments','update');
 if p_operation not in('request','approve','reject','cancel','repay') or jsonb_typeof(p_input)<>'object' then raise exception 'REFUND_INPUT_INVALID' using errcode='22023';end if;
 select p.* into v_p from public.purchases p where p.id=p_purchase_id;
 if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode='P0002';end if;
 -- Match existing financial lock order: membership -> purchase -> quote -> account.
 perform 1 from public.memberships m where m.id=v_p.membership_id for update;
 select p.* into v_p from public.purchases p where p.id=p_purchase_id for update;
 if p_operation='request' then
  if v_p.status not in('completed','reversed') then raise exception 'REFUND_PURCHASE_NOT_COMPLETED' using errcode='55000';end if;
  if (p_input->>'serviceReviewConfirmed') is distinct from 'true' or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception 'REFUND_REVIEW_REQUIRED' using errcode='22023';end if;
  if coalesce(p_input->>'serviceValue','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' or coalesce(p_input->>'cashAmount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then raise exception 'REFUND_VALUE_INVALID' using errcode='22023';end if;
  v_value:=(p_input->>'serviceValue')::numeric;v_cash:=(p_input->>'cashAmount')::numeric;
  if v_value<=0 or v_cash>v_value then raise exception 'REFUND_VALUE_INVALID' using errcode='22023';end if;
  v_reference:=btrim(p_input->>'reference');
  if length(coalesce(v_reference,'')) not between 3 and 120 then raise exception 'REFUND_REFERENCE_REQUIRED' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('service-refund:'||v_reference,0));
  select f.* into v_f from public.service_refunds f where f.reference=v_reference;
  if found then
   if v_f.purchase_id<>p_purchase_id or v_f.requested_by<>p_actor_id or v_f.service_value::numeric<>v_value or v_f.cash_amount::numeric<>v_cash or v_f.reason<>p_input->>'reason' then raise exception 'REFUND_REFERENCE_CONFLICT' using errcode='42501';end if;
   return v_f.id;
  end if;
  insert into public.service_refunds(purchase_id,reference,service_value,cash_amount,reason,requested_by)
   values(p_purchase_id,v_reference,private.money(v_value),private.money(v_cash),p_input->>'reason',p_actor_id) returning id into v_id;
 elsif p_operation in('approve','reject','cancel') then
  select f.* into v_f from public.service_refunds f where f.id=p_refund_id and f.purchase_id=p_purchase_id for update;
  if not found then raise exception 'REFUND_NOT_FOUND' using errcode='P0002';end if;
  v_id:=v_f.id;
  if p_operation='approve' and v_f.status in('approved_pending_repayment','partially_repaid','completed') then return v_id;end if;
  if p_operation='reject' and v_f.status='rejected' or p_operation='cancel' and v_f.status='cancelled' then return v_id;end if;
  if v_f.status<>'pending_approval' then raise exception 'REFUND_STATE_CONFLICT' using errcode='55000';end if;
  if p_operation='approve' then
   if (p_input->>'serviceReviewConfirmed') is distinct from 'true' then raise exception 'REFUND_REVIEW_REQUIRED' using errcode='22023';end if;
   v_value:=v_f.service_value::numeric;v_cash:=v_f.cash_amount::numeric;v_base:=v_p.gross_amount::numeric-v_p.tier_discount_amount::numeric;
   select coalesce(sum(f.service_value::numeric),0),coalesce(sum(f.points_restored),0) into v_prior,v_prior_points from public.purchase_point_refunds f where f.purchase_id=p_purchase_id;
   if v_base<=0 or v_prior+v_value>v_base then raise exception 'REFUND_EXCEEDS_PURCHASE' using errcode='55000';end if;
   select q.* into v_q from public.redemption_quotes q where q.purchase_id=p_purchase_id and q.status='committed' and q.approval_consumed_at is not null for update;
   if found then
    v_points:=floor(v_q.points_requested*(v_prior+v_value)/v_base)::bigint-v_prior_points;
    v_point_value:=v_points*v_q.peso_value::numeric/v_q.points_requested;
   end if;
   select least(coalesce(sum(pp.amount::numeric),0),v_p.net_amount::numeric) into v_collected from public.purchase_payments pp where pp.purchase_id=p_purchase_id and pp.status='verified';
   select coalesce(sum(f.cash_amount::numeric),0) into v_cash_prior from public.service_refunds f where f.purchase_id=p_purchase_id and f.status in('approved_pending_repayment','partially_repaid','completed');
   if v_cash>greatest(v_collected-v_cash_prior,0) or v_cash>greatest(round(v_value-v_point_value,2),0) then raise exception 'REFUND_CASH_EXCEEDS_ELIGIBLE' using errcode='55000';end if;
   select ec.* into v_claim from public.earning_claims ec where ec.purchase_id=p_purchase_id for update;
   if found then v_before:=v_claim.points_requested;end if;
   select coalesce(sum(-l.amount),0) into v_reversed_before from public.points_ledger l where l.entry_type='reversal' and l.reference_type='purchase' and l.reference_id=p_purchase_id::text;
   if v_q.id is not null then
    select r.refund_id,r.points_restored into v_point_refund,v_points from public.refund_purchase_redeemed_points(p_purchase_id,v_f.service_value,'SR-'||v_f.id::text,v_f.reason,true,p_actor_id) r;
   else
    if v_claim.id is not null and v_claim.status<>'reversed' then perform private.reconcile_refunded_earning(p_purchase_id,p_actor_id,v_f.reason,v_value,v_prior);end if;
    insert into public.purchase_point_refunds(purchase_id,quote_id,refund_reference,service_value,points_restored,reviewed_by,reason)
     values(p_purchase_id,null,'SR-'||v_f.id::text,v_f.service_value,0,p_actor_id,v_f.reason) returning id into v_point_refund;
    if v_prior+v_value=v_base then update public.purchases p set status='reversed',reversed_at=now(),reversal_reason=v_f.reason,updated_at=now() where p.id=p_purchase_id;end if;
   end if;
   select case when ec.status='reversed' then 0 else ec.points_requested end into v_after from public.earning_claims ec where ec.purchase_id=p_purchase_id;
   select coalesce(sum(-l.amount),0) into v_reversed_after from public.points_ledger l where l.entry_type='reversal' and l.reference_type='purchase' and l.reference_id=p_purchase_id::text;
   v_adjust:=case when v_claim.status='claimed' then greatest(v_reversed_after-v_reversed_before,0) else greatest(v_before-coalesce(v_after,0),0) end;
   update public.service_refunds f set status=case when v_cash=0 then 'completed' else 'approved_pending_repayment' end,reviewed_by=p_actor_id,reviewed_at=now(),points_restored=v_points,earned_points_adjusted=v_adjust,point_refund_id=v_point_refund where f.id=v_id;
  else
   update public.service_refunds f set status=case when p_operation='reject' then 'rejected' else 'cancelled' end,reviewed_by=p_actor_id,reviewed_at=now() where f.id=v_id;
  end if;
 else
  select f.* into v_f from public.service_refunds f where f.id=p_refund_id and f.purchase_id=p_purchase_id for update;
  if not found then raise exception 'REFUND_NOT_FOUND' using errcode='P0002';end if;
  v_id:=v_f.id;
  v_method:=p_input->>'method';v_reference:=btrim(p_input->>'reference');
  if v_method not in('cash','bank_transfer','gcash','other') or length(coalesce(v_reference,'')) not between 3 and 120 or coalesce(p_input->>'amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then raise exception 'REFUND_REPAYMENT_INVALID' using errcode='22023';end if;
  v_cash:=(p_input->>'amount')::numeric;v_repaid_at:=(p_input->>'repaidAt')::timestamptz;
  if v_cash<=0 or v_repaid_at is null or v_repaid_at>clock_timestamp() then raise exception 'REFUND_REPAYMENT_INVALID' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('service-repayment:'||v_method||':'||v_reference,0));
  select rp.* into v_payment from public.service_refund_repayments rp where rp.method=v_method and rp.reference=v_reference;
  if found then
   if v_payment.refund_id<>v_id or v_payment.amount::numeric<>v_cash or v_payment.repaid_at<>v_repaid_at or v_payment.recorded_by<>p_actor_id or v_payment.receipt_path is distinct from p_input->>'receiptPath' then raise exception 'REFUND_REPAYMENT_REFERENCE_CONFLICT' using errcode='42501';end if;
   return v_id;
  end if;
  if p_input->>'receiptPath' is not null and (
   p_input->>'receiptPath' not like 'service-refunds/'||v_id::text||'/'||p_actor_id::text||'/%'
   or exists(select 1 from public.audit_events a where a.entity_type='service_refund' and a.entity_id=v_id::text and a.action='SERVICE_REFUND_RECEIPT_ABANDONED' and a.after_data->>'receiptPath'=p_input->>'receiptPath')
   or not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id where o.bucket_id='afhomes-payment-receipts' and o.name=p_input->>'receiptPath' and b.public=false)
  ) then raise exception 'REFUND_RECEIPT_INVALID' using errcode='22023';end if;
  if v_f.status not in('approved_pending_repayment','partially_repaid') then raise exception 'REFUND_STATE_CONFLICT' using errcode='55000';end if;
  select coalesce(sum(rp.amount::numeric),0) into v_paid from public.service_refund_repayments rp where rp.refund_id=v_id;
  if v_paid+v_cash>v_f.cash_amount::numeric then raise exception 'REFUND_REPAYMENT_EXCEEDS_OUTSTANDING' using errcode='55000';end if;
  insert into public.service_refund_repayments(refund_id,amount,method,reference,repaid_at,recorded_by,receipt_path) values(v_id,private.money(v_cash),v_method,v_reference,v_repaid_at,p_actor_id,p_input->>'receiptPath');
  update public.service_refunds f set status=case when v_paid+v_cash=f.cash_amount::numeric then 'completed' else 'partially_repaid' end where f.id=v_id;
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,reason)
  values(p_actor_id,'SERVICE_REFUND_'||upper(p_operation),'service_refund',v_id::text,jsonb_build_object('purchaseId',p_purchase_id,'operation',p_operation),coalesce(v_f.reason,p_input->>'reason'));
 return v_id;
end $$;
revoke all on function public.manage_service_refund(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.manage_service_refund(uuid,uuid,text,jsonb,uuid) to service_role;
-- Reconciliation serializes with repayment before authorizing deletion of one prepared object.
create or replace function public.reconcile_service_refund_receipt(p_purchase_id uuid,p_refund_id uuid,p_upload_audit_id bigint,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_membership uuid; v_a public.audit_events%rowtype; v_path text;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.payments','update');
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'REFUND_REVIEW_REQUIRED' using errcode='22023';end if;
 select p.membership_id into v_membership from public.purchases p where p.id=p_purchase_id;
 perform 1 from public.memberships m where m.id=v_membership for update;
 perform 1 from public.purchases p where p.id=p_purchase_id for update;
 perform 1 from public.service_refunds f where f.id=p_refund_id and f.purchase_id=p_purchase_id for update;
 if not found then raise exception 'REFUND_NOT_FOUND' using errcode='P0002';end if;
 select a.* into v_a from public.audit_events a where a.id=p_upload_audit_id and a.entity_type='service_refund' and a.entity_id=p_refund_id::text and a.action='SERVICE_REFUND_RECEIPT_PREPARED';
 v_path:=v_a.after_data->>'receiptPath';
 if v_path is null or v_a.actor_id is null or v_path not like 'service-refunds/'||p_refund_id::text||'/'||v_a.actor_id::text||'/%' then raise exception 'REFUND_RECEIPT_INVALID' using errcode='22023';end if;
 if exists(select 1 from public.service_refund_repayments r where r.receipt_path=v_path) then
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,reason)
   values(p_actor_id,'SERVICE_REFUND_RECEIPT_RECONCILED','service_refund',p_refund_id::text,jsonb_build_object('uploadAuditId',p_upload_audit_id::text,'outcome','referenced'),p_reason);
  return jsonb_build_object('status','referenced','receiptPath',null);
 end if;
 if not exists(select 1 from public.audit_events a where a.entity_type='service_refund' and a.entity_id=p_refund_id::text and a.action='SERVICE_REFUND_RECEIPT_ABANDONED' and a.after_data->>'receiptPath'=v_path) then
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,reason)
   values(p_actor_id,'SERVICE_REFUND_RECEIPT_ABANDONED','service_refund',p_refund_id::text,jsonb_build_object('uploadAuditId',p_upload_audit_id::text,'receiptPath',v_path),p_reason);
 end if;
 return jsonb_build_object('status','abandoned','receiptPath',v_path);
end $$;
revoke all on function public.reconcile_service_refund_receipt(uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_service_refund_receipt(uuid,uuid,bigint,uuid,text) to service_role;
create or replace function private.service_refund_receipt_attempts(p_refund_id uuid)
returns jsonb language sql stable security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
 select coalesce(jsonb_agg(x.value order by x.id desc),'[]'::jsonb) from (
 select a.id,jsonb_build_object('auditId',a.id::text,'reference',coalesce(a.after_data->>'reference',''),'preparedAt',a.created_at,
  'status',case when exists(select 1 from public.audit_events b where b.entity_type='service_refund' and b.entity_id=a.entity_id and b.action='SERVICE_REFUND_RECEIPT_ABANDONED' and b.after_data->>'receiptPath'=a.after_data->>'receiptPath') then 'abandoned' else 'unresolved' end) value
 from public.audit_events a where a.entity_type='service_refund' and a.entity_id=p_refund_id::text and a.action='SERVICE_REFUND_RECEIPT_PREPARED'
 and not exists(select 1 from public.service_refund_repayments r where r.receipt_path=a.after_data->>'receiptPath')
 and not exists(select 1 from public.audit_events b where b.entity_type='service_refund' and b.entity_id=a.entity_id and b.action='SERVICE_REFUND_RECEIPT_REMOVED' and b.after_data->>'receiptPath'=a.after_data->>'receiptPath')
 order by a.id desc limit 50) x;
$$;
revoke all on function private.service_refund_receipt_attempts(uuid) from public,anon,authenticated;
create index if not exists service_refund_receipt_audit_idx on public.audit_events(entity_id,action,id desc) where entity_type='service_refund';
create or replace function public.service_refund_history(p_purchase_id uuid,p_customer_id uuid)
returns jsonb language sql stable security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
 select coalesce(jsonb_agg(x.value order by x.requested_at desc,x.id desc),'[]'::jsonb) from (
 select f.id,f.requested_at,jsonb_build_object(
  'id',f.id,'purchaseId',f.purchase_id,'purchaseNumber',p.purchase_number,'reference',f.reference,'status',f.status,
  'serviceValue',f.service_value,'cashAmount',f.cash_amount,'cashRepaid',private.money(coalesce(r.paid,0)),
  'cashOutstanding',private.money(case when f.status in('approved_pending_repayment','partially_repaid','completed') then greatest(f.cash_amount::numeric-coalesce(r.paid,0),0) else 0 end),
  'pointsRestored',f.points_restored,'earnedPointsAdjusted',f.earned_points_adjusted,'reason',f.reason,'requestedAt',f.requested_at,'receiptAttempts',case when p_customer_id is null and p_purchase_id is not null then private.service_refund_receipt_attempts(f.id) else '[]'::jsonb end,'repayments',coalesce(r.entries,'[]'::jsonb)) value
 from public.service_refunds f join public.purchases p on p.id=f.purchase_id
 left join lateral(select sum(rp.amount::numeric) paid,jsonb_agg(jsonb_build_object('id',rp.id,'amount',rp.amount,'method',rp.method,'reference',rp.reference,'repaidAt',rp.repaid_at,'recordedBy',s.full_name,'receiptAttached',rp.receipt_path is not null) order by rp.recorded_at,rp.id) entries
  from public.service_refund_repayments rp join public.staff_users s on s.id=rp.recorded_by where rp.refund_id=f.id) r on true
 where (p_purchase_id is not null or p_customer_id is not null)
  and (p_purchase_id is null or f.purchase_id=p_purchase_id) and (p_customer_id is null or p.customer_id=p_customer_id)
 order by f.requested_at desc,f.id desc limit 100) x;
$$;
revoke all on function public.service_refund_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_refund_history(uuid,uuid) to service_role;
