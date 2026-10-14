-- Official VIP identity, forward-only. Requires 20261204000001 annual counters.
-- Validate: SELECT control_number,count(*) FROM private.vip_control_numbers GROUP BY 1 HAVING count(*)>1;
-- Run supabase/security/rls_invariants.sql; confirm old identifiers/evidence unchanged.
-- Down: disable new issuance in a reviewed forward fix; retain all issued numbers,
-- links, counters and dual-format readers. Never recycle or renumber purchases.
create table if not exists private.vip_control_numbers (
  control_number text primary key check (control_number ~ '^[0-9]{6}(?!00000)[0-9]{5}(B1|S1|G1)(C01|T(0[1-9]|[1-9][0-9]))S$'),
  issued_on date not null,
  annual_sequence integer not null check (annual_sequence between 1 and 99999),
  tier text not null check (tier in ('BRONZE','SILVER','GOLD')),
  payment_scheme text not null,
  installment_months integer,
  plan_id uuid not null references public.card_plans(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  seller_staff_id uuid not null references public.staff_users(id) on delete restrict,
  seller_aa_snapshot text,
  issued_by uuid not null references public.staff_users(id) on delete restrict,
  original_reservation_id uuid unique references public.reservation_agreements(id) deferrable initially deferred,
  original_sale_id uuid unique references public.card_sales(id) deferrable initially deferred,
  issued_at timestamptz not null default now(),
  check (num_nonnulls(original_reservation_id,original_sale_id)=1),
  unique(issued_on,annual_sequence)
);
create unique index if not exists vip_control_year_sequence on private.vip_control_numbers ((extract(year from issued_on)),annual_sequence);
alter table private.vip_control_numbers enable row level security;
revoke all on private.vip_control_numbers from public,anon,authenticated,service_role;
alter table public.card_sales add column if not exists official_vip_number text references private.vip_control_numbers(control_number) deferrable initially deferred;
alter table public.reservation_agreements add column if not exists official_vip_number text references private.vip_control_numbers(control_number) deferrable initially deferred;
create unique index if not exists card_sales_official_vip_number_unique on public.card_sales(official_vip_number)
  where official_vip_number is not null;

create or replace function private.next_official_vip_sequence(p_date date) returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare y integer:=extract(year from p_date); n integer; high_water integer;
begin
  if p_date is null or y not between 1000 and 9999 then raise exception 'VIP_ISSUANCE_DATE_INVALID' using errcode='22023'; end if;
  select coalesce(max(v.annual_sequence),0) into high_water from private.vip_control_numbers v where extract(year from v.issued_on)=y;
  insert into private.official_id_counters as counter(domain,issuance_year,last_value)
    values('vip',y,high_water+1) on conflict(domain,issuance_year) do update
    set last_value=greatest(counter.last_value,high_water)+1 returning last_value into n;
  return n;
exception when check_violation then raise exception 'VIP_SEQUENCE_EXHAUSTED' using errcode='55000';
end $$;
revoke all on function private.next_official_vip_sequence(date) from public,anon,authenticated,service_role;

create or replace function private.issue_vip_control_number(
  p_customer uuid,p_seller uuid,p_plan uuid,p_scheme text,p_months integer,p_actor uuid,
  p_reservation uuid default null,p_sale uuid default null
) returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare plan public.card_plans%rowtype; d date:=(now() at time zone 'Asia/Manila')::date;
  n integer; code text; tier_code text; number text; aa text;
begin
  perform private.mutation_actor_role(p_actor,'sales.card_sales','create');
  if num_nonnulls(p_reservation,p_sale)<>1 then raise exception 'VIP_SOURCE_INVALID' using errcode='22023'; end if;
  select v.control_number into number from private.vip_control_numbers v
    where (p_reservation is not null and v.original_reservation_id=p_reservation)
       or (p_sale is not null and v.original_sale_id=p_sale);
  if number is not null then return number; end if;
  if not exists(select 1 from public.customers c where c.id=p_customer and c.status not in ('cancelled','suspended')) then
    raise exception 'CUSTOMER_NOT_ELIGIBLE' using errcode='55000';
  end if;
  if not exists(select 1 from public.staff_users st join public.staff_role_assignments a on a.staff_id=st.id
    join public.roles r on r.id=a.role_id and r.is_active where st.id=p_seller and st.status='active'
      and r.slug in ('super_admin','admin','vice_director','senior_sales_manager','sales_manager','ost')) then
    raise exception 'SELLER_NOT_ELIGIBLE' using errcode='42501';
  end if;
  select cp.* into plan from public.card_plans cp where cp.id=p_plan and cp.is_active for share;
  if not found then raise exception 'VIP_PLAN_NOT_ACTIVE' using errcode='55000'; end if;
  tier_code:=case upper(plan.code) when 'BRONZE' then 'B1' when 'SILVER' then 'S1' when 'GOLD' then 'G1' end;
  if tier_code is null then raise exception 'VIP_TIER_NOT_APPROVED' using errcode='55000'; end if;
  if p_scheme='spot_cash' and p_months is null then code:='C01';
  elsif p_scheme in ('move_a','installment_4_month')
    and p_months=plan.standard_installment_months and p_months between 1 and 99
    and (p_scheme<>'move_a' or plan.move_a_enabled) then code:='T'||lpad(p_months::text,2,'0');
  elsif p_scheme='move_b1_40_12' and plan.move_b1_enabled and upper(plan.code)<>'BRONZE' and p_months=12 then code:='T12';
  elsif p_scheme='move_b2_25_12' and plan.move_b2_enabled and upper(plan.code)<>'BRONZE' and p_months=12 then code:='T12';
  else raise exception 'VIP_PAYMENT_OFFER_NOT_APPROVED' using errcode='55000'; end if;
  if p_scheme not in ('spot_cash','move_a') and (plan.installment_price is null or plan.installment_price::numeric<=0) then raise exception 'VIP_PAYMENT_OFFER_NOT_APPROVED' using errcode='55000'; end if;
  n:=private.next_official_vip_sequence(d);
  number:=to_char(d,'YYMMDD')||lpad(n::text,5,'0')||tier_code||code||'S';
  select acc.aa_number into aa from private.sale_team_accreditations acc
    where acc.staff_id=p_seller and acc.status='active' and acc.starts_on<=d and acc.expires_on>=d;
  insert into private.vip_control_numbers(control_number,issued_on,annual_sequence,tier,payment_scheme,
    installment_months,plan_id,customer_id,seller_staff_id,seller_aa_snapshot,issued_by,original_reservation_id,original_sale_id)
    values(number,d,n,upper(plan.code),p_scheme,p_months,p_plan,p_customer,p_seller,aa,p_actor,p_reservation,p_sale);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor,'VIP_CONTROL_NUMBER_ISSUED','vip_purchase',coalesce(p_reservation,p_sale)::text,
      jsonb_build_object('controlNumber',number,'tier',upper(plan.code),'paymentScheme',p_scheme,'installmentMonths',p_months,'contractFlag','S'));
  return number;
exception when check_violation then
  raise exception 'VIP_SEQUENCE_EXHAUSTED_OR_INVALID' using errcode='55000';
end $$;
revoke all on function private.issue_vip_control_number(uuid,uuid,uuid,text,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.guard_vip_control_identity() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' and private.purchase_test_cleanup_allowed(tg_relid) then return old; end if;
  raise exception 'VIP_CONTROL_IDENTITY_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function private.guard_vip_control_identity() from public,anon,authenticated,service_role;
drop trigger if exists vip_control_identity_immutable on private.vip_control_numbers;
create trigger vip_control_identity_immutable before update or delete on private.vip_control_numbers
  for each row execute function private.guard_vip_control_identity();

create or replace function private.guard_purchase_vip_number() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare identity private.vip_control_numbers%rowtype; sale public.card_sales%rowtype;
begin
  if tg_op='UPDATE' and old.official_vip_number is not null and new.official_vip_number is distinct from old.official_vip_number then
    raise exception 'VIP_NUMBER_IMMUTABLE' using errcode='55000';
  end if;
  if tg_table_name='reservation_agreements' then
   if new.sale_id is not null then
    select cs.* into sale from public.card_sales cs where cs.id=new.sale_id;
    if sale.official_vip_number is not null then
      if new.official_vip_number is not null and new.official_vip_number is distinct from sale.official_vip_number then
        raise exception 'VIP_PURCHASE_IDENTITY_CONFLICT' using errcode='23514';
      end if;
      new.official_vip_number:=sale.official_vip_number;
      if tg_op='INSERT' and new.origin='sale' then
        new.customer_id:=sale.customer_id; new.seller_staff_id:=sale.seller_staff_id;
        new.payment_scheme_snapshot:=sale.payment_scheme; new.installment_months_snapshot:=sale.installment_months_snapshot;
        new.tier_snapshot:=(select v.tier from private.vip_control_numbers v where v.control_number=sale.official_vip_number);
      end if;
    end if;
   end if;
  end if;
  if new.official_vip_number is null then return new; end if;
  select v.* into identity from private.vip_control_numbers v where v.control_number=new.official_vip_number;
  if not found or identity.customer_id is distinct from new.customer_id or identity.plan_id is distinct from new.plan_id then
    raise exception 'VIP_PURCHASE_IDENTITY_CONFLICT' using errcode='23514';
  end if;
  if tg_table_name='card_sales' then
    if new.seller_staff_id is distinct from identity.seller_staff_id or new.payment_scheme is distinct from identity.payment_scheme
      or new.installment_months_snapshot is distinct from identity.installment_months
      or not (identity.original_sale_id is not distinct from new.id or exists(select 1 from public.reservation_agreements ra
        where ra.id=identity.original_reservation_id and ra.official_vip_number=identity.control_number
          and ra.customer_id=new.customer_id and ra.sale_id=new.id)) then
      raise exception 'VIP_ENCODED_TERMS_CONFLICT' using errcode='55000';
    end if;
  else
    if not (identity.original_reservation_id is not distinct from new.id or (new.sale_id is not null and exists(
      select 1 from public.card_sales cs where cs.id=new.sale_id and cs.official_vip_number=identity.control_number))) then
      raise exception 'VIP_PURCHASE_IDENTITY_CONFLICT' using errcode='23514';
    end if;
    if new.seller_staff_id is distinct from identity.seller_staff_id or new.tier_snapshot is distinct from identity.tier
      or new.payment_scheme_snapshot is distinct from identity.payment_scheme
      or new.installment_months_snapshot is distinct from identity.installment_months then
      raise exception 'VIP_ENCODED_TERMS_CONFLICT' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_purchase_vip_number() from public,anon,authenticated,service_role;
drop trigger if exists vip_purchase_identity on public.card_sales;
create trigger vip_purchase_identity before insert or update on public.card_sales
  for each row execute function private.guard_purchase_vip_number();
drop trigger if exists vip_purchase_identity on public.reservation_agreements;
create trigger vip_purchase_identity before insert or update on public.reservation_agreements
  for each row execute function private.guard_purchase_vip_number();

alter table private.mutation_requests drop constraint if exists mutation_requests_operation_check;
alter table private.mutation_requests add constraint mutation_requests_operation_check check (operation in (
  'payment.create','application.create','reservation.create','purchase_terms.review','application.submit',
  'application.decide','reservation.transition','payment.verify','reservation.finalize',
  'purchase.finalize','membership.activate','customer.create','sale.create'));

-- Only the authorized API supplies the explicit, server-computed frozen row.
-- Sale, number, commission, audit and durable retry result commit together.
create or replace function public.submit_card_sale_once(p_request_id uuid,p_actor_id uuid,p_input jsonb,p_sale jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result_id uuid; sale public.card_sales%rowtype; number text; role text;
begin
  role:=private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  result_id:=private.mutation_result(p_actor_id,'sale.create',p_request_id,p_input);
  if result_id is not null then return result_id; end if;
  sale:=jsonb_populate_record(null::public.card_sales,p_sale);
  if sale.customer_id is distinct from (p_input->>'customerId')::uuid
    or sale.plan_id is distinct from (p_input->>'productId')::uuid
    or sale.payment_scheme is distinct from p_input->>'paymentScheme'
    or sale.created_by is distinct from p_actor_id or sale.seller_type<>'staff'
    or sale.status<>'submitted' or role not in ('super_admin','admin','vice_director','senior_sales_manager','sales_manager','ost') then
    raise exception 'SALE_SUBMISSION_INVALID' using errcode='42501';
  end if;
  perform 1 from public.customers c where c.id=sale.customer_id and c.status<>'cancelled' for update;
  if not found then raise exception 'CUSTOMER_NOT_ELIGIBLE' using errcode='55000'; end if;
  if exists(select 1 from public.memberships m where m.customer_id=sale.customer_id) then
    raise exception 'CUSTOMER_ALREADY_HAS_MEMBERSHIP' using errcode='55000';
  end if;
  if sale.seller_staff_id is distinct from p_actor_id and role<>'super_admin'
    and not exists(select 1 from public.referral_relationships rel where rel.subject_staff_id=sale.seller_staff_id
      and rel.upline_staff_id=p_actor_id and rel.is_active) then
    raise exception 'SELLER_OUTSIDE_DOWNLINE' using errcode='42501';
  end if;
  if not exists(select 1 from public.staff_users st join public.staff_role_assignments a on a.staff_id=st.id
    join public.roles r on r.id=a.role_id and r.is_active where st.id=sale.seller_staff_id and st.status='active'
      and r.slug in ('super_admin','admin','vice_director','senior_sales_manager','sales_manager','ost')) then
    raise exception 'SELLER_NOT_ELIGIBLE' using errcode='42501';
  end if;
  select sn.sale_number into strict number from public.next_sale_number() sn;
  insert into public.card_sales(sale_number,customer_id,plan_id,seller_type,seller_staff_id,seller_ost_id,
    cash_price,cash_price_snapshot,minimum_down_payment_snapshot,payment_scheme,reservation_fee_snapshot,
    required_initial_snapshot,installment_months_snapshot,monthly_amount_snapshot,validity_months_snapshot,
    yearly_points_snapshot,commission_rate_snapshot,commission_rule_id,commission_base_snapshot,
    expected_commission_snapshot,status,submitted_at,balance_due_at,referral_relationship_id,created_by)
  values(number,sale.customer_id,sale.plan_id,'staff',sale.seller_staff_id,null,sale.cash_price,sale.cash_price_snapshot,
    sale.minimum_down_payment_snapshot,sale.payment_scheme,sale.reservation_fee_snapshot,sale.required_initial_snapshot,
    sale.installment_months_snapshot,sale.monthly_amount_snapshot,sale.validity_months_snapshot,sale.yearly_points_snapshot,
    sale.commission_rate_snapshot,sale.commission_rule_id,sale.commission_base_snapshot,sale.expected_commission_snapshot,
    'submitted',now(),sale.balance_due_at,sale.referral_relationship_id,p_actor_id) returning id into result_id;
  number:=private.issue_vip_control_number(sale.customer_id,sale.seller_staff_id,sale.plan_id,sale.payment_scheme,
    sale.installment_months_snapshot,p_actor_id,null,result_id);
  update public.card_sales set official_vip_number=number where id=result_id;
  insert into public.commissions(sale_id,ost_id,beneficiary_type,beneficiary_staff_id,amount,rate_snapshot,
    basis_amount_snapshot,commission_rule_id,status)
    values(result_id,null,'staff',sale.seller_staff_id,sale.expected_commission_snapshot,sale.commission_rate_snapshot,
      sale.commission_base_snapshot,sale.commission_rule_id,'pending');
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'APPLICATION_SUBMITTED','card_sale',result_id::text,
      jsonb_build_object('saleNumber',(select cs.sale_number from public.card_sales cs where cs.id=result_id),
        'customerId',sale.customer_id,'productId',sale.plan_id,'sellerStaffId',sale.seller_staff_id,
        'paymentScheme',sale.payment_scheme,'frozenTotal',sale.cash_price_snapshot,
        'expectedCommission',sale.expected_commission_snapshot,'officialVipNumber',number),p_request_id::text);
  perform private.complete_mutation(p_actor_id,'sale.create',p_request_id,p_input,result_id);
  return result_id;
end $$;
revoke all on function public.submit_card_sale_once(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_card_sale_once(uuid,uuid,jsonb,jsonb) to service_role;

create or replace function private.purchase_document_fields_valid(p_kind text,p_fields jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare allowed text[]; base text[]; commercial text[]; payments text[]; k text; v jsonb;
begin
  if p_kind is null or jsonb_typeof(p_fields) is distinct from 'object' then return false; end if;
  base:=array['reservationNumber','saleNumber','applicationNumber','customerNumber','customerName','sellerName','actorName','totalPrice'];
  commercial:=array['purchaseTermsId','termsVersion','tier','paymentScheme','reservationFee','requiredInitial','yearlyPoints','validityMonths','commissionRate','expectedCommission','minimumDownPayment','installmentMonths','monthlyAmount','spotCashDays','discountPercent','annualPointsTranches','holderLimit','inclusions'];
  payments:=array['paymentNumber','amount','method','reference','verifiedBefore','verifiedAfter','balanceBefore','balanceAfter','status'];
  allowed:=case p_kind
    when 'reservation' then base||commercial||array['status','primaryName','primaryAddress','secondaryName','verifiedTotal','balance','reservationDate','agreementDate','revisionNumber','monthlyAmortizationStart','monthlyAmortizationEnd','paymentDueDay','primarySignatureStatus','secondarySignatureStatus','secondaryAddress','schedule']
    when 'payment_recorded' then base||payments
    when 'payment_verified' then base||payments
    when 'purchase_finalized' then base||commercial||array['status','paymentNumbers','verifiedTotal','remainingBalance','finalizedAt']
    when 'membership_activated' then base||array['membershipNumber','status','tier','yearlyPoints','pointsAllocated','validityMonths','verifiedTotal','expiresAt','activatedAt']
    else null end;
  if allowed is null or not (p_fields ?& allowed) or exists(select 1 from jsonb_object_keys(p_fields) x(k) where not x.k=any(allowed||array['officialVipNumber','sellerAaNumber','linkedVipNumber'])) then return false; end if;
  if p_fields ? 'officialVipNumber' and (p_fields->>'officialVipNumber' is null or p_fields->>'officialVipNumber' !~ '^[0-9]{6}(?!00000)[0-9]{5}(B1|S1|G1)(C01|T(0[1-9]|[1-9][0-9]))S$') then return false; end if;
  if (p_fields ? 'sellerAaNumber' or p_fields ? 'linkedVipNumber') and (
    not (p_fields ?& array['officialVipNumber','sellerAaNumber','linkedVipNumber'])
    or p_fields->>'linkedVipNumber' is distinct from ((p_fields->>'officialVipNumber')||' - '||(p_fields->>'sellerAaNumber'))) then return false; end if;
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
    elsif k=any(array['reservationNumber','saleNumber','applicationNumber','reference','secondaryName','revisionNumber','monthlyAmortizationStart','monthlyAmortizationEnd','secondarySignatureStatus','secondaryAddress']) then
      if jsonb_typeof(v) not in ('string','null') then return false; end if;
    elsif jsonb_typeof(v)<>'string' then return false;
    end if;
  end loop;
  if p_kind='payment_recorded' then return p_fields->>'status'='recorded'; end if;
  if p_kind='payment_verified' then return p_fields->>'status'='verified'; end if;
  if p_kind='purchase_finalized' then return p_fields->>'status'='payment_verified'; end if;
  if p_kind='membership_activated' then return p_fields->>'status'='active'; end if;
  return p_fields->>'status' in ('draft','submitted','executed','cancelled');
end $$;

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
      'primarySignatureStatus',r.primary_signature_status,'secondarySignatureStatus',r.secondary_signature_status,
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
  if r.official_vip_number is not null then
    fields:=fields||jsonb_build_object('officialVipNumber',r.official_vip_number);
    select v.seller_aa_snapshot into seller_name from private.vip_control_numbers v where v.control_number=r.official_vip_number;
    if seller_name is not null then
      fields:=fields||jsonb_build_object('sellerAaNumber',seller_name,'linkedVipNumber',r.official_vip_number||' - '||seller_name);
    end if;
  end if;
  return fields;
end $$;

create or replace function public.transition_purchase_reservation_once(
  p_request_id uuid, p_actor_id uuid, p_reservation_id uuid, p_action text, p_input jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_payload jsonb; v_result uuid; v_now timestamptz:=now(); v_status text; v_revision integer;
  v_receipt uuid; v_action text; v_item jsonb; v_line integer;
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
  -- The owning seller edits and executes their own agreement; cross-cutting
  -- oversight needs sales.card_sales update. This is the existing D2 gate, not a
  -- new vocabulary.
  if v_res.created_by is distinct from p_actor_id then
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
    if v_res.status<>'draft' then raise exception 'AGREEMENT_NOT_EDITABLE' using errcode='55000'; end if;
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
    update public.reservation_agreements set
      official_vip_number=coalesce(official_vip_number,private.issue_vip_control_number(
        v_res.customer_id,v_res.seller_staff_id,v_res.plan_id,v_res.payment_scheme_snapshot,
        v_res.installment_months_snapshot,p_actor_id,v_res.id,null)),
      status='executed',executed_at=v_now,updated_at=v_now
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
create or replace function public.finalize_reservation_purchase_once(
  p_request_id uuid, p_reservation_id uuid, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_app_id uuid;
  v_res public.reservation_agreements%rowtype;
  v_terms public.customer_application_purchase_terms%rowtype;
  v_sale public.card_sales%rowtype;
  v_total numeric; v_verified numeric; v_recorded integer; v_pending integer;
  v_sale_id uuid; v_number text; v_result uuid; v_payload jsonb; v_return jsonb;
  v_now timestamptz:=now(); v_receipt uuid; v_balance_due timestamptz;
  v_relationship uuid; v_commission_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('reservationId',p_reservation_id);
  -- The request replay is consulted BEFORE any business lock, so a retry after a
  -- lost response returns the original sale instead of racing a second one.
  v_result:=private.mutation_result(p_actor_id,'purchase.finalize',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  -- 1. application (parent). The pointer is DISCOVERED with an unlocked read and
  --    re-read under the lock; nothing is decided from this snapshot.
  v_app_id:=(select r.customer_application_id from public.reservation_agreements r where r.id=p_reservation_id);
  if v_app_id is null then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_app from public.customer_applications where id=v_app_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;

  -- 2. reservation (parent of both the payments and the eventual sale)
  select * into v_res from public.reservation_agreements where id=p_reservation_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;

  -- 3. an existing sale (parent of the commission and of the membership later)
  if v_res.sale_id is not null then
    select * into v_sale from public.card_sales where id=v_res.sale_id for update;
    if not found then raise exception 'SALE_NOT_FOUND' using errcode='P0002'; end if;
  end if;

  -- 4. payment rows, in UUID order. Two payments of one reservation have no
  --    other total order; locking them by id is what makes the pair safe.
  perform 1 from public.payments pay where pay.reservation_id=v_res.id order by pay.id for update;

  -- Idempotent replay by a DIFFERENT request id: the reservation is already
  -- linked, so the existing sale IS the answer. The unique linkage below is the
  -- authoritative guarantee that a second sale can never be created.
  if v_res.sale_id is not null then
    if v_res.finalized_at is null then
      raise exception 'RESERVATION_ALREADY_FINALIZED' using errcode='55000';
    end if;
    perform private.complete_purchase_mutation(p_actor_id,'purchase.finalize',p_request_id,
      v_payload,v_res.sale_id,jsonb_build_object('resultId',v_res.sale_id,'saleId',v_res.sale_id,
        'status','payment_verified','reservationId',v_res.id,'fullyPaid',true));
    return v_res.sale_id;
  end if;

  -- 5. lifecycle: only an EXECUTED, not-yet-finalized reservation can finalize.
  if v_res.status<>'executed' then raise exception 'RESERVATION_NOT_EXECUTED' using errcode='55000'; end if;
  if v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;
  if v_app.sale_id is not null then raise exception 'APPLICATION_ALREADY_FINALIZED' using errcode='55000'; end if;

  -- 6. frozen terms: the exact stored terms UUID, re-read under the locks. The
  --    reservation guard already proved the snapshots equal this row.
  if v_res.purchase_terms_id is null then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;
  select * into v_terms from public.customer_application_purchase_terms where id=v_res.purchase_terms_id;
  if not found then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  if v_terms.application_id<>v_res.customer_application_id or v_terms.customer_id<>v_res.customer_id
     or v_terms.plan_id<>v_res.plan_id or v_terms.seller_staff_id<>v_res.seller_staff_id then
    raise exception 'PURCHASE_TERMS_IDENTITY_INVALID' using errcode='23514';
  end if;

  -- 7. seller validity. The seller is the FROZEN one: never the actor, never the
  --    finalizer, never whoever is reviewing. An inactive seller cannot produce a
  --    new commercial record.
  if not exists(select 1 from public.staff_users s where s.id=v_res.seller_staff_id and s.status='active') then
    raise exception 'SELLER_INACTIVE' using errcode='42501';
  end if;

  -- 8. money, recomputed from the payment rows under the locks.
  v_total:=v_terms.total_price::numeric;
  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0),
         count(*) filter (where pay.status='recorded')::integer,
         coalesce(sum(pay.amount::numeric) filter (where pay.status='recorded'),0)
    into v_verified, v_pending, v_recorded
    from public.payments pay
   where (pay.reservation_id=v_res.id or pay.sale_id=v_res.sale_id) and pay.status<>'voided';
  -- A recorded-but-undecided payment is money nobody has decided about. Finalizing
  -- over it would let a later rejection silently unbalance a "paid in full" sale,
  -- so it BLOCKS instead of being ignored.
  if v_pending>0 then raise exception 'RESERVATION_UNDECIDED_PAYMENTS' using errcode='55000'; end if;
  if v_verified<v_total then
    raise exception 'RESERVATION_NOT_FULLY_PAID:verified=% total=%',
      private.money(v_verified),private.money(v_total) using errcode='55000';
  end if;

  -- 9. an unrelated open sale for the same customer is a conflict, never adopted.
  if exists(select 1 from public.card_sales s
             where s.customer_id=v_res.customer_id and s.origin='normal'
               and s.status not in ('cancelled','active','rejected')) then
    raise exception 'SALE_ALREADY_EXISTS' using errcode='55000';
  end if;

  v_number:=(select sale_number from public.next_sale_number());
  -- balance_due_at is DERIVED from the frozen schedule or the carried spot-cash
  -- deadline. It is never a fresh "now + 365 days" placeholder: that would invent
  -- a term the customer never agreed to.
  v_balance_due:=coalesce(
    v_res.spot_cash_deadline,
    (select max(line.payment_date) from public.reservation_agreement_schedule line
      where line.agreement_id=v_res.id),
    v_res.spot_cash_started_at,
    v_now)+make_interval(months=>coalesce(v_terms.installment_months,12));
  select r.id into v_relationship from public.referral_relationships r
   where r.subject_staff_id=v_res.seller_staff_id and r.is_active is true
   order by r.is_authoritative desc nulls last, r.id limit 1;

  -- 10. the ONE sale. Its economics are COPIED from the immutable terms row; a
  --     live plan edit, price change or rule change cannot reach this row.
  insert into public.card_sales(
    sale_number,customer_id,plan_id,seller_type,seller_staff_id,seller_ost_id,
    cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
    payment_scheme,reservation_fee_snapshot,required_initial_snapshot,
    installment_months_snapshot,monthly_amount_snapshot,validity_months_snapshot,
    commission_rate_snapshot,commission_rule_id,commission_base_snapshot,
    expected_commission_snapshot,status,submitted_at,payment_verified_at,fully_paid_at,
    balance_due_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id,created_by)
  values(v_number,v_res.customer_id,v_res.plan_id,'staff',v_res.seller_staff_id,null,
    v_terms.total_price,v_terms.total_price,v_terms.minimum_down_payment,v_terms.yearly_points,
    v_terms.payment_scheme,v_terms.reservation_fee,v_terms.required_initial,
    v_terms.installment_months,v_terms.monthly_amount,v_terms.validity_months,
    v_terms.commission_rate,v_terms.commission_rule_id,v_terms.commission_base,
    v_terms.expected_commission,'payment_verified',v_now,v_now,v_now,
    v_balance_due,v_res.spot_cash_started_at,v_res.spot_cash_deadline,v_relationship,p_actor_id)
  returning id into v_sale_id;
  -- The existing sale-hierarchy capture trigger has already run on this INSERT.
  -- It raises when the current ancestry is incomplete, which aborts THIS
  -- transaction whole: no sale, no link, no evidence, no audit. Nothing is
  -- inferred or backfilled to make it pass.

  -- 11. one commission, payment_verified, NEVER earned. Qualification stays a
  --     separate manual decision that this codebase does not define.
  insert into public.commissions(
    sale_id,ost_id,beneficiary_type,beneficiary_staff_id,amount,rate_snapshot,
    basis_amount_snapshot,commission_rule_id,status)
  values(v_sale_id,null,'staff',v_res.seller_staff_id,v_terms.expected_commission::numeric,
    v_terms.commission_rate,v_terms.commission_base,v_terms.commission_rule_id,'payment_verified')
  returning id into v_commission_id;

  -- 12. link the ORIGINAL payment rows. Same ids, same numbers, same history;
  --     reservation_id is KEPT so the money stays traceable to the agreement.
  update public.payments set sale_id=v_sale_id where reservation_id=v_res.id and sale_id is null;

  -- 13. link the agreement and the application. The unique constraints on the
  --     links, not this function, are the authoritative "exactly one sale".
  update public.reservation_agreements
     set sale_id=v_sale_id, finalized_at=v_now, finalized_by=p_actor_id, updated_at=v_now
   where id=v_res.id;
  update public.customer_applications
     set sale_id=v_sale_id, updated_at=v_now
   where id=v_app.id and sale_id is null;

  if v_res.official_vip_number is not null then
    update public.card_sales set official_vip_number=v_res.official_vip_number where id=v_sale_id;
  end if;
  v_receipt:=private.append_purchase_document('purchase_finalized',v_sale_id,1,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'PURCHASE_FINALIZED','card_sale',v_sale_id::text,
      jsonb_build_object('saleNumber',v_number,'saleId',v_sale_id,'reservationId',v_res.id,
        'reservationNumber',v_res.reservation_number,'applicationId',v_app.id,
        'purchaseTermsId',v_terms.id,'termsVersion',v_terms.version,'sellerStaffId',v_res.seller_staff_id,
        'frozenTotal',v_terms.total_price,'verifiedTotal',private.money(v_verified),
        'expectedCommission',v_terms.expected_commission,'commissionId',v_commission_id,
        'documentEvidenceId',v_receipt),
      p_request_id::text);
  v_return:=jsonb_build_object('resultId',v_sale_id,'saleId',v_sale_id,'reservationId',v_res.id,
    'saleNumber',v_number,'status','payment_verified','purchaseTermsId',v_terms.id,
    'termsVersion',v_terms.version,'verifiedTotal',private.money(v_verified),
    'remainingBalance','0.00','fullyPaid',true,'commissionId',v_commission_id,
    'documentEvidenceId',v_receipt);
  perform private.complete_purchase_mutation(p_actor_id,'purchase.finalize',p_request_id,
    v_payload,v_sale_id,v_return);
  return v_sale_id;
end $$;
