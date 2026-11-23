-- AF Homes official customer application and IST reservation agreements.
-- Source: the four operator-supplied one-page paper forms. This migration is
-- forward-only, creates transaction snapshots only, and is intentionally
-- unapplied. It never updates existing customers, sales, payments or ledgers.

create table public.customer_applications (
  id uuid primary key default gen_random_uuid(),
  application_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  sale_id uuid unique references public.card_sales(id) on delete restrict,
  plan_id uuid not null references public.card_plans(id) on delete restrict,
  tier_snapshot text not null check (tier_snapshot in ('BRONZE','SILVER','GOLD')),
  payment_scheme_snapshot text not null,
  vip_amount_snapshot text not null check (vip_amount_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  discount_percent_snapshot integer not null check (discount_percent_snapshot between 0 and 100),
  validity_years_snapshot integer not null check (validity_years_snapshot > 0),
  yearly_points_snapshot integer not null check (yearly_points_snapshot >= 0),
  annual_points_tranches_snapshot integer not null check (annual_points_tranches_snapshot > 0),
  holder_limit_snapshot integer not null check (holder_limit_snapshot between 1 and 2),
  sales_manager_name text,
  vip_recommender_name text,
  recommender_contact text,
  recommender_email text,
  vip_referrer text,
  acquisition_channels text[] not null default '{}' check (
    acquisition_channels <@ array['CMP','DRP','GDP Corporate','Walk-In','GDP Public Servant','Referral','FB Ads']::text[]
  ),
  consent_acknowledged boolean not null,
  acknowledged_at date not null,
  primary_signature_status text not null check (primary_signature_status in ('pending','received')),
  secondary_signature_status text check (secondary_signature_status in ('pending','received')),
  valid_id_received boolean not null default false,
  reservation_payment_proof_received boolean not null default false,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','cancelled')),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  check ((status <> 'submitted') or submitted_at is not null),
  check ((status <> 'approved') or (submitted_at is not null and approved_at is not null)),
  check ((status <> 'rejected') or (submitted_at is not null and rejected_at is not null))
);

create table public.customer_application_holders (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.customer_applications(id) on delete restrict,
  holder_type text not null check (holder_type in ('PRIMARY','SECONDARY')),
  last_name text not null,
  first_name text not null,
  middle_name text,
  suffix text,
  birth_date date not null,
  sex text,
  citizenship text,
  civil_status text,
  permanent_address_line_1 text not null,
  permanent_address_line_2 text,
  city_municipality text not null,
  province text not null,
  postal_code text,
  landline text,
  mobile text not null,
  email text not null,
  tin_number text,
  occupation_business_name text,
  office_business_address text,
  business_industry text,
  employed_position text,
  printed_name text not null,
  created_at timestamptz not null default now(),
  unique(application_id, holder_type)
);

create table public.customer_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.customer_applications(id) on delete restrict,
  document_type text not null check (document_type in ('valid_id','reservation_payment_proof')),
  identity_document_id uuid references public.identity_documents(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (num_nonnulls(identity_document_id, payment_id) = 1)
);

create table public.reservation_agreements (
  id uuid primary key default gen_random_uuid(),
  reservation_number text not null unique,
  revision_number text,
  reservation_date date not null,
  agreement_date date not null,
  sale_id uuid not null unique references public.card_sales(id) on delete restrict,
  customer_application_id uuid references public.customer_applications(id) on delete restrict,
  plan_id uuid not null references public.card_plans(id) on delete restrict,
  tier_snapshot text not null check (tier_snapshot in ('BRONZE','SILVER','GOLD')),
  inclusions_snapshot jsonb not null check (jsonb_typeof(inclusions_snapshot) = 'object'),
  total_price_snapshot text not null check (total_price_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  reservation_fee_snapshot text not null check (reservation_fee_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  down_payment_snapshot text not null check (down_payment_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  total_payment_received_snapshot text not null check (total_payment_received_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  balance_snapshot text not null check (balance_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  monthly_amortization_snapshot text check (monthly_amortization_snapshot is null or monthly_amortization_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  installment_months_snapshot integer check (installment_months_snapshot is null or installment_months_snapshot > 0),
  payment_scheme_snapshot text not null,
  discount_percent_snapshot integer not null check (discount_percent_snapshot between 0 and 100),
  validity_years_snapshot integer not null check (validity_years_snapshot > 0),
  yearly_points_snapshot integer not null check (yearly_points_snapshot >= 0),
  annual_points_tranches_snapshot integer not null check (annual_points_tranches_snapshot > 0),
  holder_limit_snapshot integer not null check (holder_limit_snapshot between 1 and 2),
  monthly_amortization_start date,
  monthly_amortization_end date,
  payment_due_day integer check (payment_due_day is null or payment_due_day between 1 and 31),
  primary_signature_status text not null check (primary_signature_status in ('pending','received')),
  secondary_signature_status text check (secondary_signature_status in ('pending','received')),
  status text not null default 'draft' check (status in ('draft','submitted','executed','cancelled')),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  executed_at timestamptz,
  check ((status <> 'submitted') or submitted_at is not null),
  check ((status <> 'executed') or (submitted_at is not null and executed_at is not null))
);

create table public.reservation_agreement_holders (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.reservation_agreements(id) on delete restrict,
  holder_type text not null check (holder_type in ('PRIMARY','SECONDARY')),
  name text not null,
  address text not null,
  contact_number text not null,
  email text not null,
  tin_number text,
  created_at timestamptz not null default now(),
  unique(agreement_id, holder_type)
);

create table public.reservation_agreement_schedule (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.reservation_agreements(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  particular text not null,
  amount_snapshot text not null check (amount_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  payment_date date,
  remarks text,
  created_at timestamptz not null default now(),
  unique(agreement_id, line_number)
);

create table public.reservation_agreement_documents (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.reservation_agreements(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(agreement_id, payment_id)
);

create or replace function private.validate_official_form_holders()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_tier text; v_limit integer;
begin
  if tg_table_name = 'customer_application_holders' then
    select tier_snapshot, holder_limit_snapshot into v_tier, v_limit
      from public.customer_applications where id = new.application_id;
  else
    select tier_snapshot, holder_limit_snapshot into v_tier, v_limit
      from public.reservation_agreements where id = new.agreement_id;
  end if;
  if new.holder_type = 'SECONDARY' and (v_tier <> 'GOLD' or v_limit < 2) then
    raise exception 'SECONDARY_HOLDER_GOLD_ONLY';
  end if;
  return new;
end $$;

create trigger customer_application_holder_tier before insert or update on public.customer_application_holders
for each row execute function private.validate_official_form_holders();
create trigger reservation_agreement_holder_tier before insert or update on public.reservation_agreement_holders
for each row execute function private.validate_official_form_holders();

create index customer_applications_customer_idx on public.customer_applications(customer_id, created_at desc);
create index customer_application_holders_name_idx on public.customer_application_holders(last_name, first_name);
create index reservation_agreements_sale_idx on public.reservation_agreements(sale_id);
create index reservation_agreement_schedule_parent_idx on public.reservation_agreement_schedule(agreement_id, line_number);

-- Atomic header/detail writes. These functions are callable only by the
-- service role; the HTTP handler performs permission checks, and the function
-- independently refuses inactive actors and non-draft edits.
create or replace function public.save_customer_application(
  p_application_id uuid,
  p_actor_id uuid,
  p_header jsonb,
  p_primary jsonb,
  p_secondary jsonb default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := coalesce(p_application_id, gen_random_uuid());
  v_existing public.customer_applications%rowtype;
  v_plan public.card_plans%rowtype;
  v_tier text;
begin
  if not exists (select 1 from public.staff_users where id = p_actor_id and status = 'active') then
    raise exception 'ACTOR_INACTIVE';
  end if;
  select * into v_plan from public.card_plans where id = (p_header->>'planId')::uuid and is_active;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  v_tier := upper(v_plan.code);
  if v_tier not in ('BRONZE','SILVER','GOLD') then raise exception 'INVALID_TIER'; end if;
  if p_secondary is not null and v_tier <> 'GOLD' then raise exception 'SECONDARY_HOLDER_GOLD_ONLY'; end if;

  if p_application_id is null then
    insert into public.customer_applications(
      id, application_number, customer_id, sale_id, plan_id, tier_snapshot,
      payment_scheme_snapshot, vip_amount_snapshot, discount_percent_snapshot,
      validity_years_snapshot, yearly_points_snapshot, annual_points_tranches_snapshot,
      holder_limit_snapshot, sales_manager_name, vip_recommender_name,
      recommender_contact, recommender_email, vip_referrer, acquisition_channels,
      consent_acknowledged, acknowledged_at, primary_signature_status,
      secondary_signature_status, valid_id_received, reservation_payment_proof_received,
      status, created_by
    ) values (
      v_id, 'APP-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(v_id::text,'-',''),1,8)),
      (p_header->>'customerId')::uuid, nullif(p_header->>'saleId','')::uuid, v_plan.id, v_tier,
      p_header->>'paymentScheme', v_plan.cash_price, v_plan.discount_percent,
      v_plan.validity_years, v_plan.yearly_points, v_plan.annual_points_tranches,
      v_plan.holder_limit, nullif(p_header->>'salesManagerName',''), nullif(p_header->>'vipRecommenderName',''),
      nullif(p_header->>'recommenderContact',''), nullif(p_header->>'recommenderEmail',''),
      nullif(p_header->>'vipReferrer',''), coalesce(array(select jsonb_array_elements_text(p_header->'acquisitionChannels')), '{}'),
      coalesce((p_header->>'consentAcknowledged')::boolean,false), (p_header->>'acknowledgedAt')::date,
      p_header->>'primarySignatureStatus', nullif(p_header->>'secondarySignatureStatus',''),
      coalesce((p_header->>'validIdReceived')::boolean,false),
      coalesce((p_header->>'reservationPaymentProofReceived')::boolean,false), 'draft', p_actor_id
    );
  else
    select * into v_existing from public.customer_applications where id = p_application_id for update;
    if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
    if v_existing.status <> 'draft' then raise exception 'APPLICATION_NOT_EDITABLE'; end if;
    update public.customer_applications set
      customer_id=(p_header->>'customerId')::uuid, sale_id=nullif(p_header->>'saleId','')::uuid,
      plan_id=v_plan.id, tier_snapshot=v_tier, payment_scheme_snapshot=p_header->>'paymentScheme',
      vip_amount_snapshot=v_plan.cash_price, discount_percent_snapshot=v_plan.discount_percent,
      validity_years_snapshot=v_plan.validity_years, yearly_points_snapshot=v_plan.yearly_points,
      annual_points_tranches_snapshot=v_plan.annual_points_tranches, holder_limit_snapshot=v_plan.holder_limit,
      sales_manager_name=nullif(p_header->>'salesManagerName',''), vip_recommender_name=nullif(p_header->>'vipRecommenderName',''),
      recommender_contact=nullif(p_header->>'recommenderContact',''), recommender_email=nullif(p_header->>'recommenderEmail',''),
      vip_referrer=nullif(p_header->>'vipReferrer',''), acquisition_channels=coalesce(array(select jsonb_array_elements_text(p_header->'acquisitionChannels')), '{}'),
      consent_acknowledged=coalesce((p_header->>'consentAcknowledged')::boolean,false), acknowledged_at=(p_header->>'acknowledgedAt')::date,
      primary_signature_status=p_header->>'primarySignatureStatus', secondary_signature_status=nullif(p_header->>'secondarySignatureStatus',''),
      valid_id_received=coalesce((p_header->>'validIdReceived')::boolean,false),
      reservation_payment_proof_received=coalesce((p_header->>'reservationPaymentProofReceived')::boolean,false), updated_at=now()
    where id=v_id;
    delete from public.customer_application_holders where application_id=v_id;
  end if;

  insert into public.customer_application_holders(application_id,holder_type,last_name,first_name,middle_name,suffix,birth_date,sex,citizenship,civil_status,permanent_address_line_1,permanent_address_line_2,city_municipality,province,postal_code,landline,mobile,email,tin_number,occupation_business_name,office_business_address,business_industry,employed_position,printed_name)
  select v_id,'PRIMARY',p_primary->>'lastName',p_primary->>'firstName',nullif(p_primary->>'middleName',''),nullif(p_primary->>'suffix',''),(p_primary->>'birthDate')::date,nullif(p_primary->>'sex',''),nullif(p_primary->>'citizenship',''),nullif(p_primary->>'civilStatus',''),p_primary->>'permanentAddressLine1',nullif(p_primary->>'permanentAddressLine2',''),p_primary->>'cityMunicipality',p_primary->>'province',nullif(p_primary->>'postalCode',''),nullif(p_primary->>'landline',''),p_primary->>'mobile',p_primary->>'email',nullif(p_primary->>'tinNumber',''),nullif(p_primary->>'occupationBusinessName',''),nullif(p_primary->>'officeBusinessAddress',''),nullif(p_primary->>'businessIndustry',''),nullif(p_primary->>'employedPosition',''),p_primary->>'printedName';
  if p_secondary is not null then
    insert into public.customer_application_holders(application_id,holder_type,last_name,first_name,middle_name,suffix,birth_date,sex,citizenship,civil_status,permanent_address_line_1,permanent_address_line_2,city_municipality,province,postal_code,landline,mobile,email,tin_number,occupation_business_name,office_business_address,business_industry,employed_position,printed_name)
    select v_id,'SECONDARY',p_secondary->>'lastName',p_secondary->>'firstName',nullif(p_secondary->>'middleName',''),nullif(p_secondary->>'suffix',''),(p_secondary->>'birthDate')::date,nullif(p_secondary->>'sex',''),nullif(p_secondary->>'citizenship',''),nullif(p_secondary->>'civilStatus',''),p_secondary->>'permanentAddressLine1',nullif(p_secondary->>'permanentAddressLine2',''),p_secondary->>'cityMunicipality',p_secondary->>'province',nullif(p_secondary->>'postalCode',''),nullif(p_secondary->>'landline',''),p_secondary->>'mobile',p_secondary->>'email',nullif(p_secondary->>'tinNumber',''),nullif(p_secondary->>'occupationBusinessName',''),nullif(p_secondary->>'officeBusinessAddress',''),nullif(p_secondary->>'businessIndustry',''),nullif(p_secondary->>'employedPosition',''),p_secondary->>'printedName';
  end if;
  return v_id;
end $$;

create or replace function public.submit_customer_application(p_application_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.staff_users where id=p_actor_id and status='active') then raise exception 'ACTOR_INACTIVE'; end if;
  if not exists (select 1 from public.customer_applications where id=p_application_id and consent_acknowledged and primary_signature_status='received') then
    raise exception 'APPLICATION_REVIEW_INCOMPLETE';
  end if;
  update public.customer_applications set status='submitted', submitted_at=coalesce(submitted_at,now()), updated_at=now()
   where id=p_application_id and status='draft';
  if not found then raise exception 'INVALID_APPLICATION_TRANSITION'; end if;
  if (select count(*) from public.customer_application_holders where application_id=p_application_id and holder_type='PRIMARY') <> 1 then
    raise exception 'PRIMARY_HOLDER_REQUIRED';
  end if;
  return p_application_id;
end $$;

revoke all on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.submit_customer_application(uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.submit_customer_application(uuid,uuid) to service_role;

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
      monthly_amortization_end,payment_due_day,primary_signature_status,
      secondary_signature_status,status,created_by
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
      nullif(p_input->>'paymentDueDay','')::integer,p_input->>'primarySignatureStatus',
      nullif(p_input->>'secondarySignatureStatus',''),'draft',p_actor_id
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
      primary_signature_status=p_input->>'primarySignatureStatus',secondary_signature_status=nullif(p_input->>'secondarySignatureStatus',''),
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

create or replace function public.submit_reservation_agreement(p_agreement_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.staff_users where id=p_actor_id and status='active') then raise exception 'ACTOR_INACTIVE'; end if;
  update public.reservation_agreements set status='submitted',submitted_at=coalesce(submitted_at,now()),updated_at=now()
   where id=p_agreement_id and status='draft';
  if not found then raise exception 'INVALID_AGREEMENT_TRANSITION'; end if;
  if (select count(*) from public.reservation_agreement_holders where agreement_id=p_agreement_id and holder_type='PRIMARY') <> 1 then raise exception 'PRIMARY_HOLDER_REQUIRED'; end if;
  return p_agreement_id;
end $$;

revoke all on function public.save_reservation_agreement(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.submit_reservation_agreement(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_reservation_agreement(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.submit_reservation_agreement(uuid,uuid) to service_role;

do $$ declare t text; begin
  foreach t in array array['customer_applications','customer_application_holders','customer_application_documents','reservation_agreements','reservation_agreement_holders','reservation_agreement_schedule','reservation_agreement_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.has_permission(''sales.customers'') or private.has_permission(''sales.card_sales''))', t || '_read', t);
  end loop;
end $$;
