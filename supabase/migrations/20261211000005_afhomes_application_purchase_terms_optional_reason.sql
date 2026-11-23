-- AF Homes: make the purchase-terms review reason optional.
--
-- The GSD/employee workflow now auto-confirms purchase terms on approval, so no
-- human-entered review reason is collected. The reason column and audit field
-- remain (for backward compatibility with already-reviewed records) but are
-- nullable and no longer length-validated when absent.
--
-- Base body: 20261101000001_afhomes_application_purchase_flow.sql (review RPC).
--
-- Validation after apply:
--   select proname, proargnames from pg_proc where proname='review_application_purchase_terms_once';
--   -- p_reason should have a default (null).
--   select * from public.customer_application_purchase_terms limit 1; -- reason may be null
--
-- Down note: forward-only.

-- Allow null reason for review capture kind.
alter table public.customer_application_purchase_terms
  drop constraint if exists customer_application_purchase_terms_reason_check;

alter table public.customer_application_purchase_terms
  add constraint customer_application_purchase_terms_reason_check
  check (reason is null or length(btrim(reason)) between 5 and 500);

-- (capture_kind <> 'review' or reason is not null) constraint: relax to allow null reason on review.
alter table public.customer_application_purchase_terms
  drop constraint if exists customer_application_purchase_terms_review_reason_check;

-- Redefine the RPC with optional reason.
create or replace function public.review_application_purchase_terms_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text,
  p_reason text default null, p_seller_candidate uuid default null
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_seller uuid; v_proposal jsonb;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_payload jsonb; v_result uuid; v_version integer; v_terms_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'expectedProposalHash',p_expected_hash,
    'reason',v_reason,'sellerCandidateId',p_seller_candidate);
  v_result:=private.mutation_result(p_actor_id,'purchase_terms.review',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;
  if exists(select 1 from public.reservation_agreements r
             where r.customer_application_id=v_app.id and r.status<>'cancelled') then
    raise exception 'RESERVATION_ALREADY_EXISTS' using errcode='55000';
  end if;

  v_seller:=private.purchase_seller_for(p_actor_id,p_seller_candidate);
  v_proposal:=private.purchase_terms_for_application(v_app.id,v_seller,'review');
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
  values(v_app.id,v_app.customer_id,v_app.plan_id,v_seller,v_version,'review',
    v_reason,p_actor_id,now(),
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

  update public.customer_applications set purchase_terms_id=v_terms_id, updated_at=now() where id=v_app.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,reason,after_data,request_id)
    values(p_actor_id,'PURCHASE_TERMS_REVIEWED','customer_application',v_app.id::text,v_reason,
      jsonb_build_object('captureKind','review','purchaseTermsId',v_terms_id,'termsVersion',v_version,
        'sellerStaffId',v_seller,'paymentScheme',v_proposal->'terms'->>'paymentScheme',
        'totalPrice',v_proposal->'terms'->>'totalPrice','offerKind','newly_confirmed_offer'),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'purchase_terms.review',p_request_id,v_payload,v_terms_id,
    jsonb_build_object('resultId',v_terms_id,'status','approved','purchaseTermsId',v_terms_id,'termsVersion',v_version));
  return v_terms_id;
end $$;
revoke all on function public.review_application_purchase_terms_once(uuid,uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.review_application_purchase_terms_once(uuid,uuid,uuid,text,text,uuid) to service_role;