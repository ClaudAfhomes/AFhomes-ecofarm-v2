-- AF Homes application-first purchase flow: GATE 2 CONTRACT DRAFT, NOT RELEASEABLE.
-- No shared apply. Transaction RPC bodies/callers are completed only after Gate 2.
-- This draft defines storage, source integrity, immutable evidence and private helpers.
-- Validation after Gate 2, on disposable PostgreSQL only:
--   select attnotnull from pg_attribute where attrelid='public.payments'::regclass and attname='sale_id'; -- false
--   select conname, condeferrable from pg_constraint where conname='payments_reservation_sale_fk'; -- true
--   select count(*) from public.payments p join public.reservation_agreements r on r.id=p.reservation_id
--     where p.sale_id is distinct from r.sale_id or p.customer_id is distinct from r.customer_id; -- 0
--   select count(*) from private.purchase_document_evidence d
--     where not private.purchase_document_fields_valid(d.kind,d.fields); -- 0
--   run supabase/security/rls_invariants.sql: zero violations.
-- Down: forward-only. Once pre-sale payments exist, do not restore NOT NULL or
-- delete terms/evidence/ledger. Disable entrypoints and roll forward a correction.

create table if not exists public.customer_application_purchase_terms (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.customer_applications(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  plan_id uuid not null references public.card_plans(id) on delete restrict,
  seller_staff_id uuid not null references public.staff_users(id) on delete restrict,
  version integer not null check (version > 0),
  capture_kind text not null check (capture_kind in ('submission','review')),
  reason text check (reason is null or length(btrim(reason)) between 5 and 500),
  captured_by uuid not null references public.staff_users(id) on delete restrict,
  captured_at timestamptz not null default now(),
  tier text not null check (tier in ('BRONZE','SILVER','GOLD')),
  payment_scheme text not null check (payment_scheme in ('spot_cash','move_a','installment_4_month','move_b1_40_12','move_b2_25_12')),
  total_price text not null check (total_price ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' and total_price::numeric > 0),
  reservation_fee text not null check (reservation_fee ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' and reservation_fee::numeric = 10000),
  minimum_down_payment text not null check (minimum_down_payment ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  required_initial text not null check (required_initial ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  installment_months integer check (installment_months > 0),
  monthly_amount text check (monthly_amount is null or monthly_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  spot_cash_days integer not null check (spot_cash_days > 0),
  validity_months integer not null check (validity_months > 0 and validity_months % 12 = 0),
  discount_percent integer not null check (discount_percent between 0 and 100),
  yearly_points integer not null check (yearly_points >= 0),
  annual_points_tranches integer not null check (annual_points_tranches > 0),
  holder_limit integer not null check (holder_limit between 1 and 2),
  inclusions jsonb not null check (jsonb_typeof(inclusions) = 'array'),
  commission_rule_id uuid references public.commission_rules(id) on delete restrict,
  commission_rate text not null check (commission_rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'),
  commission_base text not null check (commission_base ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  expected_commission text not null check (expected_commission ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  unique (application_id, version),
  unique (application_id, id),
  unique (id, application_id, customer_id, plan_id, seller_staff_id),
  check (capture_kind <> 'review' or reason is not null),
  check (reservation_fee::numeric <= required_initial::numeric and required_initial::numeric <= total_price::numeric),
  check (commission_base::numeric = total_price::numeric),
  check (expected_commission::numeric = round(commission_base::numeric * commission_rate::numeric,2)),
  check ((payment_scheme='spot_cash' and installment_months is null and monthly_amount is null)
    or (payment_scheme<>'spot_cash' and installment_months is not null and monthly_amount is not null
      and monthly_amount::numeric * installment_months = total_price::numeric-required_initial::numeric)),
  check ((payment_scheme in ('spot_cash','move_a','installment_4_month') and required_initial::numeric=reservation_fee::numeric)
    or (payment_scheme='move_b1_40_12' and required_initial::numeric=round(total_price::numeric*0.40,2) and installment_months=12)
    or (payment_scheme='move_b2_25_12' and required_initial::numeric=round(total_price::numeric*0.25,2) and installment_months=12)),
  check (payment_scheme not in ('move_a','installment_4_month') or installment_months=4),
  check (tier='GOLD' or holder_limit=1),
  check (tier<>'BRONZE' or payment_scheme not in ('move_b1_40_12','move_b2_25_12'))
);
alter table public.customer_application_purchase_terms enable row level security;
revoke all on public.customer_application_purchase_terms from public, anon, authenticated, service_role;
grant select on public.customer_application_purchase_terms to service_role;

alter table public.customer_applications add column if not exists purchase_terms_id uuid;
alter table public.reservation_agreements
  alter column sale_id drop not null,
  add column if not exists origin text not null default 'sale',
  add column if not exists customer_id uuid references public.customers(id) on delete restrict,
  add column if not exists seller_staff_id uuid references public.staff_users(id) on delete restrict,
  add column if not exists purchase_terms_id uuid,
  add column if not exists minimum_down_payment_snapshot text,
  add column if not exists required_initial_snapshot text,
  add column if not exists spot_cash_days_snapshot integer,
  add column if not exists validity_months_snapshot integer,
  add column if not exists commission_rule_id uuid references public.commission_rules(id) on delete restrict,
  add column if not exists commission_rate_snapshot text,
  add column if not exists commission_base_snapshot text,
  add column if not exists expected_commission_snapshot text,
  add column if not exists spot_cash_started_at timestamptz,
  add column if not exists spot_cash_deadline timestamptz,
  add column if not exists finalized_by uuid references public.staff_users(id) on delete restrict,
  add column if not exists finalized_at timestamptz;
alter table public.payments
  alter column sale_id drop not null,
  add column if not exists origin text not null default 'sale',
  add column if not exists reservation_id uuid references public.reservation_agreements(id) on delete restrict;
alter table private.mutation_requests add column if not exists result_receipt jsonb;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.customer_applications'::regclass and conname='application_purchase_terms_fk') then
    alter table public.customer_applications add constraint application_purchase_terms_fk
      foreign key (id,purchase_terms_id) references public.customer_application_purchase_terms(application_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.reservation_agreements'::regclass and conname='reservation_purchase_terms_fk') then
    alter table public.reservation_agreements add constraint reservation_purchase_terms_fk
      foreign key (customer_application_id, purchase_terms_id) references public.customer_application_purchase_terms(application_id,id) on delete restrict;
    alter table public.reservation_agreements add constraint reservation_purchase_identity_fk
      foreign key (purchase_terms_id,customer_application_id,customer_id,plan_id,seller_staff_id)
      references public.customer_application_purchase_terms(id,application_id,customer_id,plan_id,seller_staff_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.reservation_agreements'::regclass and conname='reservation_id_sale_unique') then
    alter table public.reservation_agreements add constraint reservation_id_sale_unique unique(id,sale_id);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.reservation_agreements'::regclass and conname='reservation_purchase_origin_check') then
    alter table public.reservation_agreements add constraint reservation_purchase_origin_check check (
      (origin='sale' and sale_id is not null and purchase_terms_id is null)
      or (origin='application' and customer_application_id is not null and customer_id is not null
        and seller_staff_id is not null and purchase_terms_id is not null
        and minimum_down_payment_snapshot is not null and required_initial_snapshot is not null
        and spot_cash_days_snapshot is not null and validity_months_snapshot is not null
        and commission_rate_snapshot is not null and commission_base_snapshot is not null and expected_commission_snapshot is not null));
    alter table public.reservation_agreements add constraint reservation_finalization_check check (
      origin='sale' or ((sale_id is null and finalized_by is null and finalized_at is null)
        or (sale_id is not null and finalized_by is not null and finalized_at is not null and status='executed')));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.payments'::regclass and conname='payments_purchase_origin_check') then
    alter table public.payments add constraint payments_purchase_origin_check check (
      (origin = 'sale' and sale_id is not null and reservation_id is null)
      or (origin='reservation' and reservation_id is not null and customer_id is not null));
    alter table public.payments add constraint payments_reservation_sale_fk
      foreign key(reservation_id,sale_id) references public.reservation_agreements(id,sale_id)
      on delete restrict deferrable initially deferred;
  end if;
end $$;
create unique index if not exists reservation_one_live_application on public.reservation_agreements(customer_application_id)
  where origin='application' and status<>'cancelled';
create index if not exists payments_reservation_status_idx on public.payments(reservation_id,status);
create unique index if not exists payments_reservation_reference_unique on public.payments(reservation_id,reference)
  where origin='reservation' and reference is not null;

alter table private.mutation_requests drop constraint if exists mutation_requests_operation_check;
alter table private.mutation_requests add constraint mutation_requests_operation_check check (operation in (
  'payment.create','application.create','reservation.create','purchase_terms.review','application.submit',
  'application.decide','reservation.transition','payment.verify','reservation.finalize',
  'purchase.finalize','membership.activate'));

create or replace function private.purchase_test_cleanup_allowed(p_table regclass) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
  select current_setting('afhomes.allow_purchase_test_cleanup',true)='on'
    and current_user=pg_get_userbyid(c.relowner) from pg_class c where c.oid=p_table;
$$;
revoke all on function private.purchase_test_cleanup_allowed(regclass) from public, anon, authenticated, service_role;

create or replace function private.prevent_purchase_evidence_mutation() returns trigger
language plpgsql set search_path=pg_catalog,private,pg_temp as $$
begin
  if tg_op='DELETE' and private.purchase_test_cleanup_allowed(tg_relid) then return old; end if;
  if tg_table_name='customer_application_purchase_terms' then
    raise exception 'PURCHASE_TERMS_IMMUTABLE' using errcode='55000';
  end if;
  raise exception 'PURCHASE_DOCUMENT_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function private.prevent_purchase_evidence_mutation() from public, anon, authenticated, service_role;
drop trigger if exists purchase_terms_immutable on public.customer_application_purchase_terms;
create trigger purchase_terms_immutable before update or delete on public.customer_application_purchase_terms
  for each row execute function private.prevent_purchase_evidence_mutation();

create or replace function private.guard_reservation_purchase_identity() returns trigger
language plpgsql set search_path=pg_catalog,public,private,pg_temp as $$
declare t public.customer_application_purchase_terms%rowtype;
begin
  if tg_op='UPDATE' and new.origin is distinct from old.origin then raise exception 'RESERVATION_SOURCE_IMMUTABLE' using errcode='55000'; end if;
  if new.origin<>'application' then return new; end if;
  select pt.* into t from public.customer_application_purchase_terms pt where pt.id=new.purchase_terms_id;
  if not found then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  if row(new.customer_application_id,new.customer_id,new.plan_id,new.seller_staff_id,new.tier_snapshot,new.payment_scheme_snapshot,
    new.total_price_snapshot::numeric,new.reservation_fee_snapshot::numeric,new.required_initial_snapshot::numeric,new.down_payment_snapshot::numeric,new.validity_years_snapshot,new.inclusions_snapshot,
    new.monthly_amortization_snapshot::numeric,new.installment_months_snapshot,new.validity_months_snapshot,new.spot_cash_days_snapshot,
    new.minimum_down_payment_snapshot::numeric,new.discount_percent_snapshot,new.yearly_points_snapshot,new.annual_points_tranches_snapshot,
    new.holder_limit_snapshot,new.commission_rule_id,new.commission_rate_snapshot::numeric,new.commission_base_snapshot::numeric,new.expected_commission_snapshot::numeric)
    is distinct from row(t.application_id,t.customer_id,t.plan_id,t.seller_staff_id,t.tier,t.payment_scheme,
    t.total_price::numeric,t.reservation_fee::numeric,t.required_initial::numeric,t.required_initial::numeric,t.validity_months/12,jsonb_build_object('items',t.inclusions),t.monthly_amount::numeric,t.installment_months,
    t.validity_months,t.spot_cash_days,t.minimum_down_payment::numeric,t.discount_percent,t.yearly_points,t.annual_points_tranches,
    t.holder_limit,t.commission_rule_id,t.commission_rate::numeric,t.commission_base::numeric,t.expected_commission::numeric) then
    raise exception 'RESERVATION_TERMS_CONFLICT' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    if row(new.purchase_terms_id,new.customer_application_id,new.customer_id,new.plan_id,new.seller_staff_id,new.reservation_date)
      is distinct from row(old.purchase_terms_id,old.customer_application_id,old.customer_id,old.plan_id,old.seller_staff_id,old.reservation_date) then
      raise exception 'RESERVATION_TERMS_IMMUTABLE' using errcode='55000';
    end if;
    if old.sale_id is not null and new.sale_id is distinct from old.sale_id then raise exception 'RESERVATION_SALE_IMMUTABLE' using errcode='55000'; end if;
    if old.status in ('executed','cancelled') and new.status is distinct from old.status then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_reservation_purchase_identity() from public, anon, authenticated, service_role;
drop trigger if exists reservation_purchase_identity on public.reservation_agreements;
create trigger reservation_purchase_identity before insert or update on public.reservation_agreements
  for each row execute function private.guard_reservation_purchase_identity();

create or replace function private.guard_application_purchase_terms() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_table_name='customer_application_purchase_terms' then
    if not exists(select 1 from public.customer_applications a where a.id=new.application_id
      and a.customer_id=new.customer_id and a.plan_id=new.plan_id) then
      raise exception 'APPLICATION_TERMS_IDENTITY_INVALID' using errcode='23514';
    end if;
    return new;
  end if;
  if new.purchase_terms_id is distinct from old.purchase_terms_id and exists(
    select 1 from public.reservation_agreements r where r.customer_application_id=old.id and r.status<>'cancelled') then
    raise exception 'PURCHASE_TERMS_VERSION_FROZEN' using errcode='55000';
  end if;
  if new.purchase_terms_id is not null and not exists(select 1 from public.customer_application_purchase_terms pt
    where pt.id=new.purchase_terms_id and pt.application_id=new.id
      and pt.customer_id=new.customer_id and pt.plan_id=new.plan_id) then
    raise exception 'APPLICATION_TERMS_IDENTITY_INVALID' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_application_purchase_terms() from public, anon, authenticated, service_role;
drop trigger if exists purchase_terms_application_identity on public.customer_application_purchase_terms;
create trigger purchase_terms_application_identity before insert on public.customer_application_purchase_terms
  for each row execute function private.guard_application_purchase_terms();
drop trigger if exists application_purchase_terms_guard on public.customer_applications;
create trigger application_purchase_terms_guard before update of purchase_terms_id,customer_id,plan_id on public.customer_applications
  for each row execute function private.guard_application_purchase_terms();

create or replace function private.guard_purchase_payment_mutation() returns trigger
language plpgsql set search_path=pg_catalog,public,private,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.origin='sale' or private.purchase_test_cleanup_allowed(tg_relid) then return old; end if;
    raise exception 'PURCHASE_PAYMENT_HISTORY_PROTECTED' using errcode='55000';
  end if;
  if new.origin is distinct from old.origin then raise exception 'PAYMENT_SOURCE_IMMUTABLE' using errcode='55000'; end if;
  if old.origin='sale' then return new; end if;
  if row(new.reservation_id,new.customer_id,new.amount,new.payment_type,new.method,new.reference,new.notes,new.receipt_storage_path,new.recorded_by,new.recorded_at,new.payment_number)
    is distinct from row(old.reservation_id,old.customer_id,old.amount,old.payment_type,old.method,old.reference,old.notes,old.receipt_storage_path,old.recorded_by,old.recorded_at,old.payment_number) then
    raise exception 'PURCHASE_PAYMENT_IMMUTABLE' using errcode='55000';
  end if;
  if old.sale_id is not null and new.sale_id is distinct from old.sale_id then raise exception 'PAYMENT_SOURCE_IMMUTABLE' using errcode='55000'; end if;
  if old.status<>'recorded' and row(new.status,new.verified_by,new.verified_at,new.rejection_reason)
    is distinct from row(old.status,old.verified_by,old.verified_at,old.rejection_reason) then raise exception 'PAYMENT_DECISION_IMMUTABLE' using errcode='55000'; end if;
  if old.sale_id is not null and row(new.status,new.verified_by,new.verified_at,new.rejection_reason)
    is distinct from row(old.status,old.verified_by,old.verified_at,old.rejection_reason) then raise exception 'RESERVATION_FINALIZED' using errcode='55000'; end if;
  return new;
end $$;
revoke all on function private.guard_purchase_payment_mutation() from public, anon, authenticated, service_role;
drop trigger if exists purchase_payment_immutable on public.payments;
create trigger purchase_payment_immutable before update or delete on public.payments for each row
  execute function private.guard_purchase_payment_mutation();

create or replace function private.check_purchase_source_consistency() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_reservation uuid; r public.reservation_agreements%rowtype;
begin
  -- No parent FOR UPDATE here: deferred checks must not reverse the RPC lock order.
  if tg_table_name='payments' then v_reservation:=new.reservation_id;
  elsif tg_table_name='customer_applications' then
    select ra.id into v_reservation from public.reservation_agreements ra
      where ra.customer_application_id=new.id and ra.origin='application' and ra.status<>'cancelled';
  elsif tg_table_name='card_sales' then
    select ra.id into v_reservation from public.reservation_agreements ra where ra.sale_id=new.id and ra.origin='application';
  else v_reservation:=new.id; end if;
  if v_reservation is null then return null; end if;
  select ra.* into r from public.reservation_agreements ra where ra.id=v_reservation;
  if not found then return null; end if; -- immediate FK rejects missing parents
  if exists(select 1 from public.payments p where p.reservation_id=r.id and
    (p.origin<>'reservation' or p.sale_id is distinct from r.sale_id or p.customer_id is distinct from r.customer_id)) then
    raise exception 'PAYMENT_SOURCE_INVALID' using errcode='23514';
  end if;
  if r.origin='application' and r.sale_id is not null and not exists(
    select 1 from public.card_sales s join public.customer_applications a on a.id=r.customer_application_id
      where s.id=r.sale_id and s.customer_id=r.customer_id and s.plan_id=r.plan_id
        and s.seller_staff_id=r.seller_staff_id and a.sale_id=s.id) then
    raise exception 'RESERVATION_SALE_SOURCE_INVALID' using errcode='23514';
  end if;
  return null;
end $$;
revoke all on function private.check_purchase_source_consistency() from public, anon, authenticated, service_role;
drop trigger if exists payment_purchase_source_consistency on public.payments;
create constraint trigger payment_purchase_source_consistency after insert or update on public.payments
  deferrable initially deferred for each row execute function private.check_purchase_source_consistency();
drop trigger if exists reservation_purchase_source_consistency on public.reservation_agreements;
create constraint trigger reservation_purchase_source_consistency after insert or update on public.reservation_agreements
  deferrable initially deferred for each row execute function private.check_purchase_source_consistency();

drop trigger if exists application_purchase_source_consistency on public.customer_applications;
create constraint trigger application_purchase_source_consistency after update on public.customer_applications
  deferrable initially deferred for each row execute function private.check_purchase_source_consistency();
drop trigger if exists sale_purchase_source_consistency on public.card_sales;
create constraint trigger sale_purchase_source_consistency after update on public.card_sales
  deferrable initially deferred for each row execute function private.check_purchase_source_consistency();
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
revoke all on function private.purchase_document_fields_valid(text,jsonb) from public, anon, authenticated, service_role;

create table if not exists private.purchase_document_evidence (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reservation','payment_recorded','payment_verified','purchase_finalized','membership_activated')),
  reservation_id uuid references public.reservation_agreements(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  sale_id uuid references public.card_sales(id) on delete restrict,
  membership_id uuid references public.memberships(id) on delete restrict,
  source_id uuid generated always as (coalesce(reservation_id,payment_id,sale_id,membership_id)) stored,
  revision integer not null check (revision > 0),
  schema_version integer not null default 1 check (schema_version=1),
  actor_id uuid not null references public.staff_users(id) on delete restrict,
  captured_at timestamptz not null default now(),
  fields jsonb not null check (private.purchase_document_fields_valid(kind,fields)),
  check (num_nonnulls(reservation_id,payment_id,sale_id,membership_id)=1),
  check ((kind='reservation' and reservation_id is not null)
    or (kind in ('payment_recorded','payment_verified') and payment_id is not null)
    or (kind='purchase_finalized' and sale_id is not null)
    or (kind='membership_activated' and membership_id is not null)),
  unique(kind,source_id,revision)
);
alter table private.purchase_document_evidence enable row level security;
revoke all on private.purchase_document_evidence from public, anon, authenticated, service_role;
drop trigger if exists purchase_document_immutable on private.purchase_document_evidence;
create trigger purchase_document_immutable before update or delete on private.purchase_document_evidence
  for each row execute function private.prevent_purchase_evidence_mutation();

-- Only internal authorized transaction cores may call this builder immediately
-- after the write and while holding the canonical parent locks. It accepts NO
-- generic payload, economics, actor name, status or balance from the browser.
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
  return fields;
end $$;
revoke all on function private.build_purchase_document_fields(text,uuid,uuid) from public, anon, authenticated, service_role;

create or replace function private.append_purchase_document(p_kind text,p_source_id uuid,p_revision integer,p_actor_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result_id uuid; fields jsonb; prior private.purchase_document_evidence%rowtype;
begin
  fields:=private.build_purchase_document_fields(p_kind,p_source_id,p_actor_id);
  select d.* into prior from private.purchase_document_evidence d where d.kind=p_kind and d.source_id=p_source_id and d.revision=p_revision;
  if found then
    if prior.fields is distinct from fields or prior.actor_id is distinct from p_actor_id then raise exception 'PURCHASE_DOCUMENT_VERSION_CONFLICT' using errcode='55000'; end if;
    return prior.id;
  end if;
  insert into private.purchase_document_evidence(kind,reservation_id,payment_id,sale_id,membership_id,revision,actor_id,fields)
  values(p_kind,case when p_kind='reservation' then p_source_id end,
    case when p_kind in ('payment_recorded','payment_verified') then p_source_id end,
    case when p_kind='purchase_finalized' then p_source_id end,
    case when p_kind='membership_activated' then p_source_id end,p_revision,p_actor_id,fields)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function private.append_purchase_document(text,uuid,integer,uuid) from public, anon, authenticated, service_role;

create or replace function private.guard_purchase_mutation_receipt() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if old.result_receipt is not null and new.result_receipt is distinct from old.result_receipt then
    raise exception 'MUTATION_RECEIPT_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.guard_purchase_mutation_receipt() from public, anon, authenticated, service_role;
drop trigger if exists purchase_mutation_receipt_immutable on private.mutation_requests;
create trigger purchase_mutation_receipt_immutable before update on private.mutation_requests
  for each row execute function private.guard_purchase_mutation_receipt();
-- Result receipts accept ONLY non-sensitive transition identity/evidence fields.
create or replace function private.complete_purchase_mutation(p_actor uuid,p_operation text,p_request uuid,p_payload jsonb,p_result uuid,p_receipt jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare k text; v jsonb;
begin
  -- Closed shape, typed per key. The receipt is the replay payload: a retried
  -- request must return the figures the original commit reported, so the finance
  -- operations carry their own verified/balance totals rather than forcing a
  -- caller to re-read them. Every added key is typed here, so widening the list
  -- does not weaken the guard - an untyped money string is still refused.
  if jsonb_typeof(p_receipt) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_receipt) x(k) where not x.k=any(
    array['resultId','status','purchaseTermsId','termsVersion','documentEvidenceId','revision','recordedAt','verifiedAt','finalizedAt',
      'paymentId','reservationId','saleId','saleNumber','commissionId','verifiedBefore','verifiedTotal','recordedTotal','balanceBefore','remainingBalance','fullyPaid'])) then
    raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
  end if;
  if p_result is null or p_receipt->>'resultId' is distinct from p_result::text
    or jsonb_typeof(p_receipt->'status') is distinct from 'string'
    or not ((p_receipt->>'status')=any(array['draft','submitted','approved','rejected','cancelled','executed','recorded','verified','payment_verified','active'])) then
    raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
  end if;
  for k,v in select key,value from jsonb_each(p_receipt) loop
    if k in ('resultId','purchaseTermsId','documentEvidenceId','paymentId','reservationId','saleId','commissionId') then
      -- saleId is null on an unfinalized reservation; a present value must still
      -- be a UUID, and `null` is only ever legal for the source pointers.
      if v is distinct from 'null'::jsonb and (jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='saleNumber' then
      -- An AF business identifier, never free text.
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^AF-[A-Z]+-[A-HJ-NP-Z2-9]{5}$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k in ('termsVersion','revision') then
      if jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[1-9][0-9]*$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k in ('verifiedBefore','verifiedTotal','recordedTotal','balanceBefore','remainingBalance') then
      -- Exact-decimal money text, never a number: a float cannot round-trip a
      -- cent total through JSON.
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='fullyPaid' then
      if jsonb_typeof(v)<>'boolean' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k in ('recordedAt','verifiedAt','finalizedAt') then
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    end if;
  end loop;  perform private.complete_mutation(p_actor,p_operation,p_request,p_payload,p_result);
  update private.mutation_requests mr set result_receipt=p_receipt where mr.actor_id=p_actor and mr.operation=p_operation and mr.request_id=p_request;
end $$;
revoke all on function private.complete_purchase_mutation(uuid,text,uuid,jsonb,uuid,jsonb) from public, anon, authenticated, service_role;

-- ===========================================================================
-- Application-origin reservation (AF-RES with NO card sale)
-- ===========================================================================
-- Approved application -> exact frozen terms -> AF-RES. No card_sales row is
-- created and none is required: the reservation is the first commercial
-- document of the purchase, and the sale only arrives at finalization.
--
-- The economics are COPIED from the immutable terms row, never recomputed and
-- never read from "the current pointer" or the live plan. The reservation stores
-- the exact terms UUID, so a later review or plan change cannot rewrite it.

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
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'purchaseTermsId',p_terms_id,
    'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'reservation.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  -- The reviewer may reserve for an application they do not own; the owner may
  -- reserve their own. Anyone else is refused before any row is written.
  if v_app.created_by is distinct from p_actor_id then
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

-- Reservation lifecycle as one atomic transition per action. Executed is
-- TERMINAL: there is no reopen, no cancel and no refund from it. Finance
-- collection is derived from `executed`, never stored as a separate state.
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
-- Finance collection on an executed reservation (Task E) and verification (Task F)
-- ===========================================================================
-- ONE ledger. A reservation-origin payment is an ordinary row in public.payments
-- with origin='reservation', reservation_id populated, customer_id populated and
-- sale_id NULL until finalization links the existing rows. No second table, no
-- copied rows, no shadow balance.

-- Server-authoritative totals for EITHER source. The reservation branch reads the
-- frozen terms, never the live plan and never today's price.
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
           min(pay.verified_at) filter (where pay.status='verified') as first_verified
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
           min(pay.verified_at) filter (where pay.status='verified') as first_verified
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
      'spotCashDeadline',reservation.spot_cash_deadline)
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
      'firstVerifiedPayment',sale_totals.first_verified,'spotCashDeadline',sale.spot_cash_deadline)
    else null end
  from reservation full outer join totals on true
         full outer join sale on true
         full outer join sale_totals on true
  where reservation.id is not null or sale.id is not null
$$;
revoke all on function public.purchase_financial_summary(uuid) from public, anon, authenticated;
grant execute on function public.purchase_financial_summary(uuid) to service_role;

-- Record an AF-PAY against an EXECUTED reservation. Lock order is parent-first:
-- request lock -> reservation -> sale (if the reservation has been finalized) ->
-- payment rows. Recording NEVER verifies: verified_before = verified_after, so a
-- recorded reservation still reads verified 0.00 and a full remaining balance.
create or replace function public.record_reservation_payment_once(
  p_request_id uuid, p_reservation_id uuid, p_input jsonb, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_amount numeric; v_payment_id uuid; v_payload jsonb; v_result uuid; v_now timestamptz:=now();
  v_receipt uuid; v_balance text; v_verified text;
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

-- The LEGACY verification entry point, forward-replaced so it is parent-first
-- compatible with the new recorder. Signature, result columns and every existing
-- behaviour (sale status advance, commission advance, SALE_FULLY_PAID audit,
-- reason-required rejection) are unchanged; only the LOCK ORDER is. The old body
-- took `payments FOR UPDATE` and then `card_sales FOR UPDATE`, which is the
-- order that deadlocks against a recorder holding the sale before its payments.
create or replace function public.verify_card_payment(
  p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid
)
returns table (
  sale_id uuid, status text, verified_total text, remaining_balance text,
  fully_paid boolean, spot_cash_deadline timestamptz
)
language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_probe public.payments%rowtype; v_payment public.payments%rowtype; v_sale public.card_sales%rowtype;
  v_price numeric; v_verified numeric; v_deadline timestamptz; v_fully_paid boolean;
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

  update public.payments
  set status = p_decision, verified_by = p_actor_id, verified_at = now(),
      rejection_reason = case when p_decision = 'rejected' then btrim(p_reason) else null end
  where id = v_payment.id;

  v_price := coalesce((v_sale.cash_price_snapshot)::numeric, 0);
  -- Every column is qualified: this function's OUT parameters are named `sale_id`
  -- and `status`, so an unqualified reference is ambiguous and fails at runtime.
  select coalesce(sum((p.amount)::numeric), 0) into v_verified
  from public.payments p where p.sale_id = v_sale.id and p.status = 'verified';

  v_deadline := v_sale.spot_cash_deadline;
  if p_decision = 'verified' and v_deadline is null then
    v_deadline := now() + interval '7 days';
    -- coalesce, NOT a self-assignment. The original defect was exactly
    -- `set spot_cash_started_at = v_sale.spot_cash_started_at`, which copied the
    -- existing NULL straight back, so the instant the window opened was never
    -- recorded. Keep this comment: it is the record of why the expression is
    -- written this way.
    update public.card_sales
    set spot_cash_started_at = coalesce(v_sale.spot_cash_started_at, now()),
        spot_cash_deadline = v_deadline, updated_at = now()
    where id = v_sale.id;
  end if;
  v_fully_paid := v_verified >= v_price;

  if v_sale.status in ('draft', 'submitted', 'payment_pending', 'payment_in_progress', 'overdue') then
    if v_fully_paid then
      update public.card_sales set status = 'payment_verified', payment_verified_at = now(),
        fully_paid_at = now(), updated_at = now() where id = v_sale.id;
    else
      update public.card_sales set status = 'payment_in_progress', updated_at = now() where id = v_sale.id;
    end if;
  end if;
  if v_fully_paid then
    update public.commissions c set status = 'payment_verified'
     where c.sale_id = v_sale.id and c.status = 'pending';
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor_id,
      case when p_decision = 'verified' then 'PAYMENT_VERIFIED' else 'PAYMENT_REJECTED' end,
      'payment', v_payment.id::text,
      jsonb_build_object('status', 'recorded', 'amount', v_payment.amount),
      jsonb_build_object('status', p_decision, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  if v_fully_paid then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
      values (p_actor_id, 'SALE_FULLY_PAID', 'card_sale', v_sale.id::text,
        jsonb_build_object('verifiedTotal', private.money(v_verified), 'price', private.money(v_price)));
  end if;
  return query
    select v_sale.id, (select s.status from public.card_sales s where s.id = v_sale.id),
      private.money(v_verified), private.money(greatest(v_price - v_verified, 0)), v_fully_paid, v_deadline;
end $$;
revoke all on function public.verify_card_payment(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_card_payment(uuid,text,text,uuid) to service_role;

-- Verification with PARENT-FIRST, source-aware locking.
--
-- The legacy order was payment -> sale, which can deadlock against the recorder
-- that takes reservation -> payment. Here the source is DISCOVERED unlocked, the
-- parents are locked in a fixed order, and only then is the payment row locked
-- and re-read:
--   reservation-origin : reservation -> sale (if finalized) -> payment
--   sale-origin        : sale -> payment
-- A pre-existing sale lock is therefore never taken before its parent.
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
  v_deadline timestamptz;
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
  -- The request lookup precedes every state check, so a lost response replays.
  v_result:=private.mutation_result(p_actor_id,'payment.verify',p_request_id,v_payload);
  if v_result is not null then
    select r.result_receipt into v_replay from private.mutation_requests r
     where r.actor_id=p_actor_id and r.operation='payment.verify' and r.request_id=p_request_id;
    return v_replay;
  end if;

  -- DISCOVER, unlocked. Reading the source here costs nothing and decides the
  -- lock order; nothing is decided from this snapshot.
  select pay.* into v_probe from public.payments pay where pay.id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;

  if v_probe.origin='reservation' or v_probe.reservation_id is not null then
    -- Reservation first, ALWAYS: it is the parent of both the payments and the
    -- eventual sale.
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
    -- Legacy sale-origin: sale then payment. Never the reverse.
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

  -- Totals from the rows themselves, with the payment already excluded by
  -- status<>'recorded' semantics below: the verified sum is taken AFTER the
  -- decision is applied in memory, so before/after are exact and in cents.
  -- BEFORE the update the payment is still `recorded`, so it contributes nothing
  -- to the verified sum; the comparison is explicit anyway so the figure is
  -- correct regardless of the row's current status.
  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0)
    into v_verified_before
    from public.payments pay
   where pay.status<>'voided'
     and ((v_res.id is not null and pay.reservation_id=v_res.id)
       or (v_res.id is null and pay.sale_id=v_sale.id));
  v_verified_after:=v_verified_before+(case when v_rejected then 0 else v_pay.amount::numeric end);
  v_balance_before:=greatest(v_price-v_verified_before,0);
  v_balance_after:=greatest(v_price-v_verified_after,0);

  update public.payments set status=p_decision,
      verified_by=case when v_rejected then null else p_actor_id end,
      verified_at=case when v_rejected then null else v_now end,
      rejection_reason=case when v_rejected then btrim(p_reason) else null end
   where id=p_payment_id;

  -- The spot-cash window starts at the FIRST VERIFIED payment and uses the
  -- FROZEN days. It is written once and never restarted or recomputed, and the
  -- final sale copies it rather than opening a new window.
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
    -- A rejected payment gets a decision audit, never a verified receipt: the
    -- recorded receipt from the same day is the only evidence of the attempt.
    insert into public.audit_events(actor_id,action,entity_type,entity_id,reason,after_data,request_id)
      values(p_actor_id,'PAYMENT_REJECTED','payment',p_payment_id::text,btrim(p_reason),
        jsonb_build_object('origin',v_pay.origin,'reservationId',v_res.id,'saleId',v_sale.id,
          'amount',v_pay.amount,'status','rejected','verifiedTotal',private.money(v_verified_after),
          'remainingBalance',private.money(v_balance_after)),
        p_request_id::text);
  else
    -- The immutable verified receipt belongs to the PURCHASE flow, and its
    -- builder requires the frozen terms on a reservation. A legacy sale-origin
    -- payment never had any, so it keeps the legacy audit alone rather than
    -- inventing a document it cannot describe.
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

  -- ONE object is both the replay receipt and the return value. Building two
  -- would let them drift, and a replay would then answer with different keys
  -- than the original call did.
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

-- ===========================================================================
-- Task I: the authorized read side of immutable document evidence
-- ===========================================================================
-- A reprint renders the EVIDENCE ROW, never today's business data. This
-- function is the only way out of the private schema, and it authorizes FRESH on
-- every call: possessing a document UUID grants nothing.
--
-- Two properties are load-bearing:
--   * No caller-supplied JSON. The renderer receives the fields the database
--     built field-by-field, never an arbitrary payload, so a caller cannot
--     compose a "historical" document.
--   * Absence is REPORTED, never filled in. A legacy row with no evidence answers
--     `evidenceAvailable:false` with an explicit legacy note; it never invents a
--     before/after balance or a historical price.
create or replace function public.purchase_document(
  p_kind text, p_source_id uuid, p_actor_id uuid, p_revision integer default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_row private.purchase_document_evidence%rowtype;
  v_perm text;
begin
  if p_kind is null or p_kind not in ('reservation','payment_recorded','payment_verified',
     'purchase_finalized','membership_activated') then
    raise exception 'PURCHASE_DOCUMENT_KIND_INVALID' using errcode='22023';
  end if;
  if p_actor_id is null then raise exception 'ACTOR_REQUIRED' using errcode='42501'; end if;

  -- Fresh, per call, from the live role graph. Document kind decides the module;
  -- nothing about the SOURCE decides permission.
  v_perm:=case p_kind
    when 'reservation' then 'sales.card_sales'
    when 'payment_recorded' then 'finance.payment_verification'
    when 'payment_verified' then 'finance.payment_verification'
    when 'purchase_finalized' then 'finance.payment_verification'
    when 'membership_activated' then 'finance.card_activation'
  end;
  if not private.has_permission_for_user(p_actor_id,v_perm,'view')
     and not (p_kind='reservation' and private.has_permission_for_user(p_actor_id,'sales.card_sales','update')) then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;

  select * into v_row from private.purchase_document_evidence e
   where e.kind=p_kind
     and coalesce(e.reservation_id,e.payment_id,e.sale_id,e.membership_id)=p_source_id
     and (p_revision is null or e.revision=p_revision)
   order by e.revision desc limit 1;
  if not found then
    -- Explicitly unavailable. A legacy document with no captured evidence says
    -- so; it never renders a substitute figure.
    return jsonb_build_object('kind',p_kind,'sourceId',p_source_id,'evidenceAvailable',false,
      'revision',p_revision,'unavailableReason',
      'LEGACY_RECORD_WITHOUT_CAPTURED_EVIDENCE');
  end if;
  return jsonb_build_object('kind',v_row.kind,'sourceId',p_source_id,'evidenceAvailable',true,
    'revision',v_row.revision,'schemaVersion',v_row.schema_version,'actor',v_row.actor_id,
    'capturedAt',v_row.captured_at,'fields',v_row.fields);
end $$;
revoke all on function public.purchase_document(text,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.purchase_document(text,uuid,uuid,integer) to service_role;

-- ===========================================================================
-- Task H: activation integration (the EXISTING path, strengthened)
-- ===========================================================================
-- This is a FORWARD REPLACEMENT of public.activate_card_sale. The signature, the
-- result columns, the allocator, the credential rules, the points semantics, the
-- commission advance and the one-time plaintext behaviour are all UNCHANGED.
-- Two things are added:
--
--   1. private.mutation_actor_role(p_actor_id,'finance.card_activation','update').
--      The old body only checked that the actor was non-null, so ANY authenticated
--      caller who reached this function could activate a sale. The permission is
--      now re-resolved from the database inside the transaction that does the
--      work, exactly as every other purchase mutation does it. The handler is not
--      the security boundary; this is.
--
--   2. An immutable membership_activated evidence row inside the same
--      transaction, so a reprint months later renders what was true at
--      activation and not what is true today. It contains NO secret: no QR
--      token, no fallback code, no hash, no onboarding token, no government ID.
--
-- Activation REMAINS separate from finalization. Creating the sale does not
-- activate it, and this function is the only thing that creates a membership.
create or replace function public.activate_card_sale(
  p_sale_id uuid,
  p_actor_id uuid,
  p_validity_months integer default 12
)
returns table (
  membership_id uuid,
  membership_number text,
  fallback_code text,
  qr_token text,
  points_allocated bigint,
  already_active boolean
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sale public.card_sales%rowtype;
  v_price numeric;
  v_verified numeric;
  v_existing public.memberships%rowtype;
  v_membership_id uuid;
  v_membership_number text;
  v_fallback text;
  v_qr text;
  v_points integer;
  v_account_id uuid;
  v_commission_id uuid;
  v_months integer;
  v_expires timestamptz;
  v_receipt uuid;
  v_reservation_id uuid;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  -- NEW: the permission is proved in SQL, against the live role graph, before
  -- any row is touched. A handler that forgot the check cannot activate a sale.
  perform private.mutation_actor_role(p_actor_id,'finance.card_activation','update');
  if coalesce(p_validity_months, 0) <= 0 then
    raise exception 'INVALID_VALIDITY_MONTHS' using errcode = '22023';
  end if;

  select * into v_sale from public.card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_existing from public.memberships where sale_id = v_sale.id;
  if found then
    -- Already activated. Return identifiers without minting new ones: only the
    -- hash is stored, so the plaintext is deliberately NOT reproduced here.
    return query
      select v_existing.id, v_existing.membership_number, null::text, null::text,
             v_existing.yearly_points_allocated::bigint, true;
    return;
  end if;

  if v_sale.status not in ('payment_verified', 'activation_pending') then
    raise exception 'SALE_NOT_ACTIVATABLE:%', v_sale.status using errcode = '55000';
  end if;
  if v_sale.cash_price_snapshot is null then
    raise exception 'SALE_HAS_NO_PRICE_SNAPSHOT' using errcode = '55000';
  end if;

  v_price := (v_sale.cash_price_snapshot)::numeric;
  -- NEW: the financial recheck is here, in SQL, from the persisted payment
  -- rows. It does not trust the queue label, the finalization response, or any
  -- UI state.
  select coalesce(sum((amount)::numeric), 0) into v_verified
  from public.payments
  where sale_id = v_sale.id and status = 'verified';

  if v_verified < v_price then
    raise exception 'SALE_NOT_FULLY_PAID:verified=% price=%', private.money(v_verified), private.money(v_price)
      using errcode = '55000';
  end if;

  -- VIP Stage 1: the frozen sale term wins. A NULL snapshot means the sale
  -- predates schemes, so the caller-supplied parameter applies as before.
  v_months := coalesce(v_sale.validity_months_snapshot, p_validity_months);
  if v_months <= 0 then
    raise exception 'INVALID_VALIDITY_MONTHS' using errcode = '22023';
  end if;
  v_expires := now() + make_interval(months => v_months);

  v_points := coalesce(v_sale.yearly_points_snapshot, 0);
  v_membership_number := private.next_membership_number();
  v_fallback := private.new_fallback_code();
  v_qr := private.new_qr_token();

  insert into public.memberships (
    customer_id, sale_id, membership_number, product_id, fallback_code_hash,
    qr_token_hash, status, points_balance, yearly_points_allocated,
    sale_status_at_activation, activated_by, activated_at, expires_at, renewal_due_at, issued_at
  ) values (
    v_sale.customer_id, v_sale.id, v_membership_number, v_sale.plan_id,
    private.hash_token(v_fallback), private.hash_token(v_qr), 'active', 0, v_points,
    v_sale.status, p_actor_id, now(), v_expires, v_expires, now()
  )
  returning id into v_membership_id;

  -- Points: account + append-only allocation entry, same transaction.
  insert into public.points_accounts (membership_id, balance, lifetime_allocated)
  values (v_membership_id, v_points, v_points)
  returning id into v_account_id;

  if v_points > 0 then
    insert into public.points_ledger (
      account_id, entry_type, amount, balance_after,
      reference_type, reference_id, actor_id, reason
    ) values (
      v_account_id, 'annual_allocation', v_points, v_points,
      'membership', v_membership_id::text, p_actor_id, 'Annual points allocation on activation'
    );
  end if;

  update public.card_sales
  set status = 'active', activated_at = now(), updated_at = now()
  where id = v_sale.id;

  update public.customers set status = 'active', updated_at = now() where id = v_sale.customer_id;

  -- Commission advances to awaiting-qualification. It is NEVER auto-earned:
  -- the qualification rule is undefined in this codebase and must not be
  -- invented here.
  select id into v_commission_id
  from public.commissions
  where sale_id = v_sale.id and status = 'payment_verified'
  for update;
  if found then
    update public.commissions
    set status = 'final_qualification_pending'
    where id = v_commission_id;
  end if;

  -- NEW: immutable activation evidence, in the same transaction. Written only
  -- for an application-origin sale, because the evidence builder describes a
  -- purchase through its reservation and frozen terms; a legacy sale-origin row
  -- has neither and is never given an invented document.
  select r.id into v_reservation_id
  from public.reservation_agreements r
  where r.sale_id = v_sale.id and r.origin = 'application';
  if found then
    v_receipt := private.append_purchase_document('membership_activated', v_membership_id, 1, p_actor_id);
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id, 'MEMBERSHIP_ACTIVATED', 'membership', v_membership_id::text,
    jsonb_build_object('saleStatus', v_sale.status, 'customerStatus', 'prospect'),
    jsonb_build_object(
      'saleId', v_sale.id,
      'membershipNumber', v_membership_number,
      'productId', v_sale.plan_id,
      'pointsAllocated', v_points,
      'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      -- The evidence id is an identifier, never a secret.
      'documentEvidenceId', v_receipt
    )
  );

  -- Plaintext identifiers are returned exactly once, to the authorized
  -- activator, and are never stored or re-displayable.
  return query select v_membership_id, v_membership_number, v_fallback, v_qr, v_points::bigint, false;
end $$;
revoke all on function public.activate_card_sale(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.activate_card_sale(uuid,uuid,integer) to service_role;

-- ===========================================================================
-- Task G: atomic sale finalization (AF-RES -> exactly one AF-CSALE)
-- ===========================================================================
-- The reservation is the FIRST commercial document of a first-time purchase;
-- the card sale arrives only here, once every peso is VERIFIED.
--
-- What this function deliberately does NOT do: it creates no membership, no
-- points account, no credential and no customer activation. Activation is a
-- SEPARATE, separately-authorized transaction (Task H) that re-reads the
-- financial state itself.
--
-- The payment rows are LINKED, never copied. The same AF-PAY UUIDs that were
-- recorded against the reservation keep their ids, their numbers and their
-- history, and simply gain a sale_id. There is no INSERT-copy-delete and no
-- second ledger, so no report can ever count the same money twice.
--
-- Lock order is the approved one and nothing else takes a later row first:
--   request advisory lock -> application -> reservation -> existing sale
--   -> payment rows sorted by UUID -> (new sale row)
-- Payment rows are locked in UUID order because two payments of the same
-- reservation have no other total order, and an unordered pair is a deadlock.

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
revoke all on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) to service_role;

-- ===========================================================================
-- Purchase terms proposal, reviewed capture and atomic application transitions
-- ===========================================================================
-- The browser is non-authoritative here: it may send a request id, a proposal
-- hash it was shown, a seller CANDIDATE and a review reason, and nothing else.
-- Every economic figure, the seller, the status and the frozen terms are
-- derived below from the application, the plan row and the commission rules.
-- The proposal hash is computed over the canonical jsonb the caller was shown,
-- so any change to plan/rule/seller economics invalidates an already rendered
-- proposal instead of being silently accepted.

-- Roles that may appear as the seller of record. Identical to SELLING_ROLES in
-- api/_lib/commerce.ts; a reviewer, Finance operator or finalizer is NOT one.
create or replace function private.purchase_seller_for(p_actor uuid,p_candidate uuid)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_status text; v_role text;
begin
  if p_candidate is null or p_candidate=p_actor then
    select su.status,private.staff_role_slug(su.id) into v_status,v_role
      from public.staff_users su where su.id=p_actor;
    if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
    if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin') then
      raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
    end if;
    return p_actor;
  end if;
  select su.status,private.staff_role_slug(su.id) into v_status,v_role
    from public.staff_users su where su.id=p_candidate;
  if not found then raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501'; end if;
  if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
  if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin') then
    raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
  end if;
  -- Two levels of active downline, matching downlineOf() in api/_handlers/sales.ts:
  -- the candidate is either a DIRECT child of the actor, or a grandchild reached
  -- through one of the actor's own active children.
  if private.staff_role_slug(p_actor) is distinct from 'super_admin' and not exists(
    select 1 from public.referral_relationships r where r.is_active
      and r.subject_staff_id=p_candidate and r.upline_staff_id=p_actor) and not exists(
    select 1 from public.referral_relationships child
      join public.referral_relationships grandchild on grandchild.upline_staff_id=child.subject_staff_id
     where child.is_active and grandchild.is_active
       and child.upline_staff_id=p_actor and grandchild.subject_staff_id=p_candidate) then
    raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501';
  end if;
  return p_candidate;
end $$;
revoke all on function private.purchase_seller_for(uuid,uuid) from public, anon, authenticated, service_role;

-- Narrow transactional counterpart of resolveSchemeEconomics/snapshotSchemeTerms
-- in api/_lib/commerce.ts. Exact numeric only; the plan row is read FOR SHARE so
-- a concurrent configuration writer cannot change the figures mid-capture.
-- Volatile by necessity: FOR SHARE is not permitted in a STABLE function.
create or replace function private.purchase_terms_for_application(
  p_application uuid, p_seller uuid, p_capture_kind text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype;
  v_plan public.card_plans%rowtype;
  v_total numeric; v_fee numeric; v_initial numeric; v_balance numeric; v_monthly numeric;
  v_months integer; v_validity integer; v_rate text; v_rule uuid; v_commission numeric;
  v_inclusions jsonb; v_terms jsonb; v_payload jsonb;
begin
  if p_capture_kind is null or p_capture_kind not in ('submission','review') then
    raise exception 'INVALID_CAPTURE_KIND' using errcode='22023';
  end if;
  select * into v_app from public.customer_applications where id=p_application;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.customers c where c.id=v_app.customer_id and c.status<>'cancelled') then
    raise exception 'CUSTOMER_NOT_ELIGIBLE' using errcode='55000';
  end if;
  select * into v_plan from public.card_plans cp where cp.id=v_app.plan_id and cp.is_active for share;
  if not found then raise exception 'PLAN_NOT_ACTIVE' using errcode='55000'; end if;
  if upper(v_plan.code) not in ('BRONZE','SILVER','GOLD') then raise exception 'INVALID_TIER' using errcode='22023'; end if;

  v_fee:=v_plan.reservation_fee::numeric;
  -- The frozen terms table pins the included reservation amount at exactly
  -- 10000.00 for this path. A plan configured otherwise is refused with a
  -- domain error here rather than failing later as a constraint violation.
  if v_fee<>10000 then raise exception 'RESERVATION_FEE_INVALID' using errcode='55000'; end if;
  v_validity:=v_plan.validity_years*12;
  if v_app.payment_scheme_snapshot='spot_cash' then
    v_total:=v_plan.cash_price::numeric; v_initial:=v_fee; v_months:=null; v_monthly:=null;
  elsif v_app.payment_scheme_snapshot='move_a' then
    if not v_plan.move_a_enabled then raise exception 'SCHEME_NOT_ALLOWED_FOR_TIER' using errcode='55000'; end if;
    v_total:=v_plan.cash_price::numeric; v_initial:=v_fee; v_months:=4;
    v_balance:=v_total-v_initial;
    if mod(v_balance,v_months)<>0 then raise exception 'INEXACT_SCHEDULE' using errcode='55000'; end if;
    v_monthly:=v_balance/v_months;
  elsif v_app.payment_scheme_snapshot='installment_4_month' then
    if v_plan.installment_price::numeric<=0 then raise exception 'INSTALLMENT_PRICE_NOT_SET' using errcode='55000'; end if;
    v_total:=v_plan.installment_price::numeric; v_initial:=v_fee; v_months:=v_plan.standard_installment_months;
    v_balance:=v_total-v_initial;
    if mod(v_balance,v_months)<>0 then raise exception 'INEXACT_SCHEDULE' using errcode='55000'; end if;
    v_monthly:=v_balance/v_months;
  elsif v_app.payment_scheme_snapshot in ('move_b1_40_12','move_b2_25_12') then
    if (v_app.payment_scheme_snapshot='move_b1_40_12' and not v_plan.move_b1_enabled)
       or (v_app.payment_scheme_snapshot='move_b2_25_12' and not v_plan.move_b2_enabled) then
      raise exception 'SCHEME_NOT_ALLOWED_FOR_TIER' using errcode='55000';
    end if;
    if v_plan.installment_price::numeric<=0 then raise exception 'INSTALLMENT_PRICE_NOT_SET' using errcode='55000'; end if;
    v_total:=v_plan.installment_price::numeric;
    v_initial:=round(v_total*case when v_app.payment_scheme_snapshot='move_b1_40_12' then 0.40 else 0.25 end,2);
    v_months:=12; v_balance:=v_total-v_initial;
    if mod(v_balance,v_months)<>0 then raise exception 'INEXACT_SCHEDULE' using errcode='55000'; end if;
    v_monthly:=v_balance/v_months;
  else
    raise exception 'SCHEME_NOT_ALLOWED_FOR_TIER' using errcode='55000';
  end if;
  -- The frozen schedule is exactly 4 months on both standard installment
  -- tracks, which is what the terms table CHECK enforces. A plan configured
  -- otherwise is refused here with a domain error instead of failing later as
  -- an opaque constraint violation.
  if v_app.payment_scheme_snapshot in ('move_a','installment_4_month') and v_months<>4 then
    raise exception 'SCHEME_SCHEDULE_UNAVAILABLE' using errcode='55000';
  end if;

  select rr.rule_id,rr.rate into v_rule,v_rate
    from public.resolve_commission_rule('staff',p_seller,(now() at time zone 'utc')::date) rr;
  v_rate:=coalesce(nullif(v_rate,''),'0');
  v_commission:=round(v_total*v_rate::numeric,2);

  v_inclusions:=jsonb_build_array(
    'Priority reservation: '||case when v_plan.priority_reservation then 'yes' else 'no' end,
    'Monthly annual dues: '||case when v_plan.no_monthly_annual_dues then 'none' else 'applies' end,
    'Total loyalty value: '||v_plan.total_loyalty_value,
    'Annual benefit tranches: '||v_plan.annual_points_tranches::text);

  v_terms:=jsonb_build_object(
    'applicationId',v_app.id,'customerId',v_app.customer_id,'planId',v_plan.id,'sellerStaffId',p_seller,
    'captureKind',p_capture_kind,'tier',upper(v_plan.code),'paymentScheme',v_app.payment_scheme_snapshot,
    'totalPrice',private.money(v_total),'reservationFee',private.money(v_fee),
    'minimumDownPayment',v_plan.minimum_down_payment,'requiredInitial',private.money(v_initial),
    'installmentMonths',v_months,
    'monthlyAmount',case when v_monthly is null then null else private.money(v_monthly) end,
    'spotCashDays',v_plan.spot_cash_days,'validityMonths',v_validity,
    'discountPercent',v_plan.discount_percent,'yearlyPoints',v_plan.yearly_points,
    'annualPointsTranches',v_plan.annual_points_tranches,'holderLimit',v_plan.cardholder_limit,
    'inclusions',v_inclusions,'commissionRuleId',v_rule,'commissionRate',v_rate,
    'commissionBase',private.money(v_total),'expectedCommission',private.money(v_commission));

  -- Hash covers exactly the authoritative payload the caller was shown. `asOf`
  -- is deliberately outside it: it is a clock reading, not an offer input.
  v_payload:=jsonb_build_object('applicationId',v_app.id,
    'offerKind',case when p_capture_kind='review' then 'newly_confirmed_offer' else 'submission' end,
    'terms',v_terms);
  return jsonb_build_object(
    'applicationId',v_app.id,
    'expectedProposalHash',encode(digest(private.normalized_mutation_json(v_payload)::text,'sha256'),'hex'),
    'asOf',now(),'offerKind',v_payload->>'offerKind','terms',v_terms);
end $$;
revoke all on function private.purchase_terms_for_application(uuid,uuid,text) from public, anon, authenticated, service_role;

-- Read side. Authorization is re-resolved here, so possession of an application
-- id grants nothing: the owner may read, anyone else needs the reviewer grant.
create or replace function public.purchase_terms_proposal(
  p_application_id uuid, p_actor_id uuid, p_seller_candidate uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_app public.customer_applications%rowtype; v_seller uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','view');
  select * into v_app from public.customer_applications where id=p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_app.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  end if;
  v_seller:=private.purchase_seller_for(p_actor_id,p_seller_candidate);
  return private.purchase_terms_for_application(p_application_id,v_seller,
    case when v_app.status='approved' then 'review' else 'submission' end);
end $$;
revoke all on function public.purchase_terms_proposal(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.purchase_terms_proposal(uuid,uuid,uuid) to service_role;

-- Old approved applications without commercial evidence get an EXPLICIT review
-- that confirms a new offer as of review time. Current prices are never
-- presented as if they were the historical terms: capture_kind is 'review', the
-- reason is mandatory, the actor/time are recorded, and the reviewer's own
-- seller selection is validated independently.
create or replace function public.review_application_purchase_terms_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text,
  p_reason text, p_seller_candidate uuid default null
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
  if v_reason is null or length(v_reason) not between 5 and 500 then
    raise exception 'REVIEW_REASON_REQUIRED' using errcode='22023';
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

-- Submission freezes the terms in the SAME transaction as the state change.
-- The existing identity/signature/holder rules still run through
-- public.submit_customer_application; approval never recalculates anything.
create or replace function public.submit_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text,
  p_seller_candidate uuid default null
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_seller uuid; v_proposal jsonb;
  v_payload jsonb; v_result uuid; v_version integer; v_terms_id uuid;
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
  -- Re-opened drafts resubmit here and append version N+1; old versions are
  -- immutable and stay readable, nothing is rewritten.
  perform public.submit_customer_application(v_app.id,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,'CUSTOMER_APPLICATION_SUBMITTED','customer_application',v_app.id::text,
      jsonb_build_object('status','draft'),jsonb_build_object('status','submitted',
        'captureKind','submission','purchaseTermsId',v_terms_id,'termsVersion',v_version),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'application.submit',p_request_id,v_payload,v_app.id,
    jsonb_build_object('resultId',v_app.id,'status','submitted','purchaseTermsId',v_terms_id,'termsVersion',v_version));
  return v_app.id;
end $$;
revoke all on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) to service_role;

-- Approve/reject/cancel as one atomic transition plus its audit. Approval never
-- recalculates economics and never re-points the terms; a submitted application
-- without frozen terms cannot be approved.
create or replace function public.decide_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_decision text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_payload jsonb; v_result uuid;
  v_allowed boolean; v_now timestamptz:=now(); v_notes text;
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
  v_notes:=case p_decision when 'draft' then 'CUSTOMER_APPLICATION_REOPENED'
    when 'approved' then 'CUSTOMER_APPLICATION_APPROVED' when 'rejected' then 'CUSTOMER_APPLICATION_REJECTED'
    else 'CUSTOMER_APPLICATION_CANCELLED' end;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,v_notes,'customer_application',v_app.id::text,
      jsonb_build_object('status',v_app.status),
      jsonb_build_object('status',p_decision,'purchaseTermsId',v_app.purchase_terms_id),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'application.decide',p_request_id,v_payload,v_app.id,
    jsonb_build_object('resultId',v_app.id,'status',p_decision,'purchaseTermsId',v_app.purchase_terms_id));
  return v_app.id;
end $$;
revoke all on function public.decide_purchase_application_once(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.decide_purchase_application_once(uuid,uuid,uuid,text) to service_role;

-- IF NOT EXISTS is not permission to accept an incompatible same-name index.
-- Compare the contract after both first application and direct reapplication.
do $$
declare expected record; actual record;
begin
  for expected in select * from (values
    ('public','payments_reservation_status_idx','payments',array['reservation_id','status'],false,null::text),
    ('public','payments_reservation_reference_unique','payments',array['reservation_id','reference'],true,
      '((origin = ''reservation''::text) AND (reference IS NOT NULL))'),
    ('public','reservation_one_live_application','reservation_agreements',array['customer_application_id'],true,
      '((origin = ''application''::text) AND (status <> ''cancelled''::text))'),
    ('public','reservation_id_sale_unique','reservation_agreements',array['id','sale_id'],true,null::text),
    ('private','purchase_document_evidence_kind_source_id_revision_key','purchase_document_evidence',array['kind','source_id','revision'],true,null::text)
  ) contract(schema_name,index_name,table_name,columns,is_unique,predicate) loop
    select idx.indisunique,idx.indisvalid,idx.indisready,tab.relname,
      array(select att.attname::text from unnest(idx.indkey) with ordinality k(attnum,position)
        join pg_attribute att on att.attrelid=idx.indrelid and att.attnum=k.attnum order by k.position) columns,
      pg_get_expr(idx.indpred,idx.indrelid) predicate into actual
      from pg_index idx join pg_class ix on ix.oid=idx.indexrelid join pg_class tab on tab.oid=idx.indrelid
      join pg_namespace ns on ns.oid=ix.relnamespace where ns.nspname=expected.schema_name and ix.relname=expected.index_name;
    if not found or actual.relname is distinct from expected.table_name
      or actual.columns is distinct from expected.columns or actual.indisunique is distinct from expected.is_unique
      or not actual.indisvalid or not actual.indisready or actual.predicate is distinct from expected.predicate then
      raise exception 'PURCHASE_SCHEMA_DRIFT:%',expected.index_name using errcode='55000';
    end if;
  end loop;
end $$;
