-- AF Homes Ecofarm v2 Phase 1 foundation.
-- Validation before apply: this is the only file in supabase/migrations.
-- Down: drop storage policies/buckets, public AF Homes tables, then private schema.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.]{2,79}$'),
  name text not null,
  group_name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  primary key (role_id, module_id),
  check (not can_create or can_view),
  check (not can_update or can_view),
  check (not can_delete or can_view)
);

create table public.staff_users (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  full_name text not null,
  department_id uuid references public.departments(id) on delete set null,
  status text not null default 'invited' check (status in ('invited','active','inactive','suspended')),
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_role_assignments (
  staff_id uuid primary key references public.staff_users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid references public.staff_users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create table public.staff_permission_restrictions (
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  deny_view boolean not null default false,
  deny_create boolean not null default false,
  deny_update boolean not null default false,
  deny_delete boolean not null default false,
  primary key (staff_id, module_id),
  check (deny_view or deny_create or deny_update or deny_delete)
);

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role_id uuid not null references public.roles(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  invited_by uuid not null references public.staff_users(id) on delete restrict,
  expires_at timestamptz not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (email, status)
);

create or replace function private.has_permission(permission_key text, action_name text default 'view')
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from staff_users su
    join staff_role_assignments sra on sra.staff_id = su.id
    join roles r on r.id = sra.role_id and r.is_active
    join modules m on m.key = permission_key and m.is_active
    left join role_permissions rp on rp.role_id = r.id and rp.module_id = m.id
    left join staff_permission_restrictions spr on spr.staff_id = su.id and spr.module_id = m.id
    where su.id = (select auth.uid()) and su.status = 'active'
      and case action_name
        when 'view' then (r.slug = 'super_admin' or coalesce(rp.can_view, false)) and not coalesce(spr.deny_view, false)
        when 'create' then (r.slug = 'super_admin' or coalesce(rp.can_create, false)) and not coalesce(spr.deny_create, false) and not coalesce(spr.deny_view, false)
        when 'update' then (r.slug = 'super_admin' or coalesce(rp.can_update, false)) and not coalesce(spr.deny_update, false) and not coalesce(spr.deny_view, false)
        when 'delete' then (r.slug = 'super_admin' or coalesce(rp.can_delete, false)) and not coalesce(spr.deny_delete, false) and not coalesce(spr.deny_view, false)
        else false end
  );
$$;
revoke all on function private.has_permission(text, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.has_permission(text, text) to authenticated;

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  sponsor_staff_id uuid not null references public.staff_users(id) on delete restrict,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  is_active boolean not null default true,
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.ost_applications (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  sponsor_staff_id uuid not null references public.staff_users(id) on delete restrict,
  email text not null,
  phone text not null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  birth_date date not null,
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  registration_details jsonb not null default '{}'::jsonb check (jsonb_typeof(registration_details) = 'object'),
  status text not null default 'submitted' check (status in ('submitted','under_review','changes_requested','approved','rejected','withdrawn')),
  review_notes text,
  reviewed_by uuid references public.staff_users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (email, status)
);

create table public.ost_members (
  id uuid primary key references auth.users(id) on delete restrict,
  application_id uuid not null unique references public.ost_applications(id) on delete restrict,
  sponsor_staff_id uuid not null references public.staff_users(id) on delete restrict,
  ost_number text not null unique,
  full_name text not null,
  email text not null unique,
  phone text not null,
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  approved_by uuid not null references public.staff_users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.card_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,63}$'),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table public.card_plans (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.card_categories(id) on delete restrict,
  code text not null unique,
  name text not null,
  cash_price text not null check (cash_price ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  minimum_down_payment text not null check (minimum_down_payment ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  yearly_points integer not null check (yearly_points > 0),
  commission_rate text not null default '0.04' check (commission_rate ~ '^0\.[0-9]{1,4}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  customer_number text not null unique,
  email text not null,
  phone text not null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  birth_date date,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  status text not null default 'prospect' check (status in ('prospect','payment_pending','qualification_pending','active','inactive','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_email_unique on public.customers (lower(email));

create table public.identity_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('ost_application','customer')),
  ost_application_id uuid references public.ost_applications(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  extracted_data jsonb not null default '{}'::jsonb,
  reviewed_data jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.staff_users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((subject_type = 'ost_application' and ost_application_id is not null and customer_id is null) or (subject_type = 'customer' and customer_id is not null and ost_application_id is null))
);

create table public.card_sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  plan_id uuid not null references public.card_plans(id) on delete restrict,
  seller_type text not null check (seller_type in ('staff','ost')),
  seller_staff_id uuid references public.staff_users(id) on delete restrict,
  seller_ost_id uuid references public.ost_members(id) on delete restrict,
  cash_price text not null check (cash_price ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  balance_due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','down_payment','paid','payment_verified','final_qualification_pending','qualified','activated','cancelled','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((seller_type = 'staff' and seller_staff_id is not null and seller_ost_id is null) or (seller_type = 'ost' and seller_ost_id is not null and seller_staff_id is null))
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.card_sales(id) on delete restrict,
  amount text not null check (amount ~ '^[1-9][0-9]*(\.[0-9]{1,2})?$'),
  method text not null,
  reference text,
  status text not null default 'recorded' check (status in ('recorded','verified','rejected','voided')),
  recorded_by uuid not null references public.staff_users(id) on delete restrict,
  verified_by uuid references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  verified_at timestamptz
);

create table public.final_qualifications (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.card_sales(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','passed','failed','changes_requested')),
  notes text,
  reviewed_by uuid references public.staff_users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id) on delete restrict,
  sale_id uuid not null unique references public.card_sales(id) on delete restrict,
  membership_number text not null unique,
  fallback_code_hash text not null unique,
  status text not null default 'active' check (status in ('active','expired','suspended','cancelled')),
  points_balance bigint not null default 0 check (points_balance >= 0),
  activated_by uuid not null references public.staff_users(id) on delete restrict,
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.card_sales(id) on delete restrict,
  ost_id uuid not null references public.ost_members(id) on delete restrict,
  amount text not null check (amount ~ '^[1-9][0-9]*(\.[0-9]{1,2})?$'),
  status text not null default 'pending' check (status in ('pending','payment_verified','final_qualification_pending','earned','paid','cancelled')),
  earned_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['departments','roles','modules','role_permissions','staff_users','staff_role_assignments','staff_permission_restrictions','staff_invitations','referral_codes','ost_applications','ost_members','card_categories','card_plans','customers','identity_documents','card_sales','payments','final_qualifications','memberships','commissions','audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.departments, public.roles, public.modules, public.role_permissions to authenticated;
create policy departments_read on public.departments for select to authenticated using (private.has_permission('organization.staff'));
create policy roles_read on public.roles for select to authenticated using (private.has_permission('organization.roles'));
create policy modules_read on public.modules for select to authenticated using (private.has_permission('organization.roles'));
create policy role_permissions_read on public.role_permissions for select to authenticated using (private.has_permission('organization.roles'));

grant select on public.staff_users, public.staff_role_assignments, public.staff_permission_restrictions, public.staff_invitations to authenticated;
create policy staff_users_read on public.staff_users for select to authenticated using (id = (select auth.uid()) or private.has_permission('organization.staff'));
create policy staff_roles_read on public.staff_role_assignments for select to authenticated using (staff_id = (select auth.uid()) or private.has_permission('organization.staff'));
create policy staff_restrictions_read on public.staff_permission_restrictions for select to authenticated using (staff_id = (select auth.uid()) or private.has_permission('organization.roles'));
create policy staff_invitations_read on public.staff_invitations for select to authenticated using (private.has_permission('organization.staff'));

grant select on public.referral_codes, public.ost_applications, public.ost_members to authenticated;
create policy referral_codes_read on public.referral_codes for select to authenticated using (sponsor_staff_id = (select auth.uid()) or private.has_permission('network.referrals'));
create policy ost_applications_read on public.ost_applications for select to authenticated using (sponsor_staff_id = (select auth.uid()) or private.has_permission('network.ost_registrations'));
create policy ost_members_read on public.ost_members for select to authenticated using (id = (select auth.uid()) or sponsor_staff_id = (select auth.uid()) or private.has_permission('network.ost_members'));

grant select on public.card_categories, public.card_plans, public.customers, public.card_sales, public.payments, public.final_qualifications, public.memberships, public.commissions to authenticated;
create policy card_categories_read on public.card_categories for select to authenticated using (private.has_permission('sales.card_sales') or private.has_permission('sales.card_plans'));
create policy card_plans_read on public.card_plans for select to authenticated using (private.has_permission('sales.card_sales') or private.has_permission('sales.card_plans'));
create policy customers_read on public.customers for select to authenticated using (auth_user_id = (select auth.uid()) or private.has_permission('sales.customers'));
create policy card_sales_read on public.card_sales for select to authenticated using (seller_staff_id = (select auth.uid()) or seller_ost_id = (select auth.uid()) or private.has_permission('sales.card_sales'));
create policy payments_read on public.payments for select to authenticated using (private.has_permission('finance.payment_verification'));
create policy qualifications_read on public.final_qualifications for select to authenticated using (private.has_permission('finance.final_qualification'));
create policy memberships_read on public.memberships for select to authenticated using (exists (select 1 from public.customers c where c.id = customer_id and c.auth_user_id = (select auth.uid())) or private.has_permission('sales.customers'));
create policy commissions_read on public.commissions for select to authenticated using (ost_id = (select auth.uid()) or private.has_permission('network.commissions'));

grant select on public.identity_documents, public.audit_events to authenticated;
create policy identity_documents_read on public.identity_documents for select to authenticated using (private.has_permission('sales.id_documents') or private.has_permission('network.ost_registrations'));
create policy audit_events_read on public.audit_events for select to authenticated using (private.has_permission('governance.audit'));

insert into public.departments (code, name) values
  ('EXECUTIVE','Executive'),('SALES','Sales'),('FINANCE','Finance'),('HR','Human Resources'),('OPERATIONS','Operations');

insert into public.roles (slug, name, is_system) values
  ('super_admin','Super Admin',true),('admin','Admin',true),('vice_director','Vice Director',true),
  ('senior_sales_manager','Senior Sales Manager',true),('sales_manager','Sales Manager',true),
  ('finance','Finance',true),('hr','HR',true),('employee','Employee',true),('ost','OST',true),('customer','Customer',true);

insert into public.modules (key, name, group_name, sort_order) values
  ('dashboard.view','Dashboard','Dashboard',10),('organization.staff','Staff','Organization',20),
  ('organization.departments','Departments','Organization',21),('organization.roles','Roles & Permissions','Organization',22),
  ('sales.card_sales','Card Sales','Sales & Customers',30),('sales.card_plans','Card Plans','Sales & Customers',31),
  ('sales.customers','Customers','Sales & Customers',32),('sales.id_documents','ID Scan / OCR','Sales & Customers',33),
  ('finance.payment_verification','Payment Verification','Finance',40),('finance.card_activation','Card Activation','Finance',41),
  ('finance.final_qualification','Final Qualification','Finance',42),('finance.commission_payouts','Commission Payouts','Finance',43),
  ('network.ost_registrations','OST Registrations','Network',50),('network.ost_members','OST Members','Network',51),
  ('network.genealogy','Genealogy','Network',52),('network.referrals','Referral & QR Codes','Network',53),
  ('network.commissions','Commissions','Network',54),('network.withdrawals','OST Withdrawals','Network',55),
  ('operations.redemption','Redemption / POS','Operations',60),('operations.catalog','Service & Point Catalog','Operations',61),
  ('governance.audit','Audit Log','CMS & Governance',70),('governance.config','System Configuration','CMS & Governance',71);

insert into public.card_categories (slug, name, sort_order) values ('membership','Membership Cards',10);
insert into public.card_plans (category_id, code, name, cash_price, minimum_down_payment, yearly_points)
select id, v.code, v.name, v.cash_price, v.minimum_down_payment, v.yearly_points
from public.card_categories cross join (values
  ('GOLD','Gold','60000.00','20000.00',60000),
  ('SILVER','Silver','40000.00','15000.00',40000),
  ('BRONZE','Bronze','30000.00','10000.00',25000)
) as v(code,name,cash_price,minimum_down_payment,yearly_points)
where slug = 'membership';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('afhomes-customer-ids','afhomes-customer-ids',false,10485760,array['image/jpeg','image/png','application/pdf']),
  ('afhomes-ost-ids','afhomes-ost-ids',false,10485760,array['image/jpeg','image/png','application/pdf']),
  ('afhomes-payment-receipts','afhomes-payment-receipts',false,10485760,array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy afhomes_customer_ids_read on storage.objects for select to authenticated
using (bucket_id = 'afhomes-customer-ids' and private.has_permission('sales.id_documents'));
create policy afhomes_ost_ids_read on storage.objects for select to authenticated
using (bucket_id = 'afhomes-ost-ids' and private.has_permission('network.ost_registrations'));
create policy afhomes_payment_receipts_read on storage.objects for select to authenticated
using (bucket_id = 'afhomes-payment-receipts' and private.has_permission('finance.payment_verification'));

comment on table public.staff_permission_restrictions is 'Deny-only overrides; they can never add permissions beyond the assigned role.';
comment on table public.identity_documents is 'Private metadata only. Object delivery must use short-lived signed URLs from an authorized server API.';
comment on table public.memberships is 'Created only after verified full payment and passed final qualification; down payments never activate or issue points.';
