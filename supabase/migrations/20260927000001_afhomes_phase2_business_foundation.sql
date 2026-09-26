-- AF Homes Phase 2 - business foundation schema.
-- Validation before apply:
--   select count(*) from public.card_plans where cash_price !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$';
--   select status, count(*) from public.customers group by 1;
--   select status, count(*) from public.card_sales group by 1;
--   select count(*) from public.modules where key in ('sales.uplines','finance.points');
-- Down: drop the new tables created here, restore the previous status CHECK
--       constraints on customers/card_sales/commissions, drop the columns added
--       here, and delete the two modules inserted at the end.

-- ===========================================================================
-- 1. Permission modules
-- ---------------------------------------------------------------------------
-- Everything Phase 2 needs already exists as a module except upline
-- correction (a privileged, audited action distinct from issuing referral
-- codes) and the points ledger. Reusing the existing keys keeps ONE
-- authorization system instead of inventing a second.

insert into public.modules (key, name, group_name, sort_order) values
  ('sales.uplines', 'Upline Assignment', 'Sales & Customers', 34),
  ('finance.points', 'Points Ledger', 'Finance', 44)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order;

-- ===========================================================================
-- 2. Card products (`card_plans` IS the product catalogue)
-- ---------------------------------------------------------------------------
-- Reuse, do not duplicate: Bronze/Silver/Gold already live here with the
-- approved economics. Phase 2 only adds the display ordering the catalogue
-- screen needs.

alter table public.card_plans
  add column if not exists sort_order integer not null default 0;

create index if not exists card_plans_active_sort_idx
  on public.card_plans (is_active, sort_order);

-- ===========================================================================
-- 3. Customer master record
-- ---------------------------------------------------------------------------
-- Person-level lifecycle only. The commercial/application lifecycle lives on
-- card_sales.status, so each entity has exactly ONE state machine and the two
-- can never contradict each other.

alter table public.customers drop constraint if exists customers_status_check;
alter table public.customers
  add constraint customers_status_check
  check (status in ('prospect', 'active', 'suspended', 'cancelled'));

alter table public.customers
  add column if not exists suffix text,
  add column if not exists gender text
    check (gender is null or gender in ('male', 'female', 'other', 'undisclosed')),
  add column if not exists government_id_type text,
  add column if not exists government_id_number text,
  add column if not exists registration_source text not null default 'seller_created',
  add column if not exists created_by uuid references public.staff_users(id) on delete set null,
  add column if not exists referred_by_staff_id uuid references public.staff_users(id) on delete set null,
  add column if not exists referral_code_used text,
  add column if not exists notes text;

create index if not exists customers_created_by_idx on public.customers (created_by);
create index if not exists customers_referred_by_idx on public.customers (referred_by_staff_id);
create index if not exists customers_status_idx on public.customers (status);
-- Two people may share a name; the same government ID must not be registered
-- twice. Partial so NULL ids (not yet collected) never collide.
create unique index if not exists customers_gov_id_unique
  on public.customers (lower(coalesce(government_id_type, '')), government_id_number)
  where government_id_number is not null;

-- ===========================================================================
-- 4. Referral / upline hierarchy  (VD -> SSM -> SM -> OST)
-- ---------------------------------------------------------------------------
-- Relational, so one upline can have many downlines. Exactly ONE active
-- authoritative upline per subject. The hierarchy level is the subject's AF
-- Homes role, so there is no second role model to keep in sync.

create table public.referral_relationships (
  id uuid primary key default gen_random_uuid(),
  subject_staff_id uuid not null references public.staff_users(id) on delete restrict,
  upline_staff_id uuid not null references public.staff_users(id) on delete restrict,
  hierarchy_role text not null check (
    hierarchy_role in ('vice_director', 'senior_sales_manager', 'sales_manager', 'ost')
  ),
  -- Once authoritative, a seller cannot move themselves; only an authorized,
  -- audited administrative correction may reassign.
  is_authoritative boolean not null default true,
  is_active boolean not null default true,
  assigned_by uuid references public.staff_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subject_staff_id <> upline_staff_id)
);

-- A subject has at most one ACTIVE upline. Downlines per upline are
-- unconstrained, which is exactly what the hierarchy needs.
create unique index referral_relationships_one_active_upline
  on public.referral_relationships (subject_staff_id)
  where is_active;
create index referral_relationships_upline_idx on public.referral_relationships (upline_staff_id);
create index referral_relationships_role_idx on public.referral_relationships (hierarchy_role);

comment on table public.referral_relationships is
  'Fixed immediate upline per staff account. Immutable for the subject; reassignment requires sales.uplines and is audited.';

-- An OST must have a staff account to participate in the hierarchy.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ost_members_staff_fk') then
    alter table public.ost_members
      add constraint ost_members_staff_fk
      foreign key (id) references public.staff_users(id) on delete restrict;
  end if;
end $$;

-- ===========================================================================
-- 5. Card sale / membership application
-- ---------------------------------------------------------------------------
-- Commercial terms are SNAPSHOT SHOTTEN at creation. A later price change must
-- never alter a historical sale.

alter table public.card_sales drop constraint if exists card_sales_status_check;
alter table public.card_sales
  add constraint card_sales_status_check
  check (status in (
    'draft', 'submitted', 'payment_pending', 'payment_in_progress',
    'payment_verified', 'activation_pending', 'active',
    'cancelled', 'overdue'
  ));

alter table public.card_sales
  add column if not exists cash_price_snapshot text
    check (cash_price_snapshot is null or cash_price_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists minimum_down_payment_snapshot text
    check (minimum_down_payment_snapshot is null or minimum_down_payment_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists yearly_points_snapshot integer
    check (yearly_points_snapshot is null or yearly_points_snapshot >= 0),
  add column if not exists commission_rate_snapshot text
    check (commission_rate_snapshot is null or commission_rate_snapshot ~ '^0\.[0-9]{1,4}$'),
  add column if not exists expected_commission_snapshot text
    check (expected_commission_snapshot is null or expected_commission_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists submitted_at timestamptz,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists fully_paid_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  -- 7-day spot cash. Deadline is computed server-side (UTC) when the first
  -- verified payment lands; no client ever computes it.
  add column if not exists spot_cash_started_at timestamptz,
  add column if not exists spot_cash_deadline timestamptz,
  add column if not exists referral_relationship_id uuid
    references public.referral_relationships(id) on delete set null,
  add column if not exists created_by uuid references public.staff_users(id) on delete set null;

create index if not exists card_sales_customer_idx on public.card_sales (customer_id);
create index if not exists card_sales_plan_idx on public.card_sales (plan_id);
create index if not exists card_sales_seller_staff_idx on public.card_sales (seller_staff_id);
create index if not exists card_sales_seller_ost_idx on public.card_sales (seller_ost_id);
create index if not exists card_sales_status_idx on public.card_sales (status);
create index if not exists card_sales_referral_rel_idx on public.card_sales (referral_relationship_id);
create index if not exists card_sales_created_by_idx on public.card_sales (created_by);
-- One open application per customer per product. A cancelled/active sale does
-- not block a legitimate later purchase.
create unique index card_sales_one_open_per_customer
  on public.card_sales (customer_id, plan_id)
  where status in ('draft', 'submitted', 'payment_pending', 'payment_in_progress',
                   'payment_verified', 'activation_pending');

comment on column public.card_sales.cash_price_snapshot is
  'Price at the moment of sale. Historical sales never re-read card_plans.';
comment on column public.card_sales.spot_cash_deadline is
  'First verified payment + 7 days, computed server-side in UTC. NULL until then.';

-- ===========================================================================
-- 6. Payments
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists payment_type text not null default 'installment'
    check (payment_type in ('down_payment', 'installment', 'full')),
  add column if not exists customer_id uuid references public.customers(id) on delete restrict,
  add column if not exists notes text,
  add column if not exists rejection_reason text,
  add column if not exists voided_at timestamptz,
  -- Private bucket path for a receipt. Never a public URL.
  add column if not exists receipt_storage_path text;

create index if not exists payments_sale_idx on public.payments (sale_id);
create index if not exists payments_customer_idx on public.payments (customer_id);
create index if not exists payments_recorded_by_idx on public.payments (recorded_by);
create index if not exists payments_verified_by_idx on public.payments (verified_by);
create index if not exists payments_status_idx on public.payments (status);
-- Guards against a double-submitted reference for the same sale.
create unique index if not exists payments_sale_reference_unique
  on public.payments (sale_id, reference)
  where reference is not null;

-- ===========================================================================
-- 7. Membership / card
-- ---------------------------------------------------------------------------
-- One membership row per activated sale. The QR token and the fallback member
-- code are two identifiers for the SAME row - never two records - and both are
-- stored hashed so a database leak yields no usable identifier.

alter table public.memberships
  add column if not exists product_id uuid references public.card_plans(id) on delete restrict,
  add column if not exists sale_status_at_activation text,
  add column if not exists yearly_points_allocated integer not null default 0
    check (yearly_points_allocated >= 0),
  add column if not exists qr_token_hash text unique,
  add column if not exists renewal_due_at timestamptz,
  add column if not exists issued_at timestamptz not null default now();

create index if not exists memberships_product_idx on public.memberships (product_id);
create index if not exists memberships_activated_by_idx on public.memberships (activated_by);
create index if not exists memberships_status_idx on public.memberships (status);
create index if not exists memberships_qr_token_idx on public.memberships (qr_token_hash);
create index if not exists memberships_fallback_code_idx on public.memberships (fallback_code_hash);

comment on table public.memberships is
  'One row per activated sale. qr_token_hash and fallback_code_hash are two identifiers for the SAME membership; neither authorizes anything on its own - every use must resolve the row server-side and re-check status, permission and balance.';

-- ===========================================================================
-- 8. Points foundation (account + append-only ledger)
-- ---------------------------------------------------------------------------
-- points_accounts.balance is the materialized current value, always moved in the
-- same transaction as its points_ledger row. The ledger is the auditable
-- history; the balance is a cache that can always be rebuilt from it.

create table public.points_accounts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null unique references public.memberships(id) on delete restrict,
  balance bigint not null default 0 check (balance >= 0),
  lifetime_allocated bigint not null default 0 check (lifetime_allocated >= 0),
  lifetime_redeemed bigint not null default 0 check (lifetime_redeemed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.points_ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.points_accounts(id) on delete restrict,
  entry_type text not null check (
    entry_type in ('annual_allocation', 'redemption', 'adjustment', 'reversal', 'expiration')
  ),
  -- Signed: allocations positive, redemptions/expiry negative, reversals undo.
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reference_type text,
  reference_id text,
  actor_id uuid references public.staff_users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists points_ledger_account_idx on public.points_ledger (account_id, id);
create index if not exists points_ledger_type_idx on public.points_ledger (entry_type);
create index if not exists points_ledger_reference_idx on public.points_ledger (reference_type, reference_id);
create index if not exists points_ledger_actor_idx on public.points_ledger (actor_id);
-- The annual allocation for a given membership/plan-year happens once.
create unique index if not exists points_ledger_one_allocation_per_year
  on public.points_ledger (account_id, reference_id)
  where entry_type = 'annual_allocation';

comment on table public.points_ledger is
  'Append-only points history. A reversal is a NEW compensating row, never an update or delete of an earlier entry.';

-- ===========================================================================
-- 9. Commissions
-- ---------------------------------------------------------------------------
-- 4% of the snapshotted card price. NOT earned at sale creation. The
-- final_qualification_pending -> earned transition is deliberately NOT wired
-- up: the qualification rule is not defined in this codebase and must not be
-- invented.

alter table public.commissions drop constraint if exists commissions_status_check;
alter table public.commissions
  add constraint commissions_status_check
  check (status in (
    'pending', 'payment_verified', 'final_qualification_pending',
    'earned', 'paid', 'cancelled'
  ));

alter table public.commissions
  add column if not exists beneficiary_type text not null default 'ost'
    check (beneficiary_type in ('staff', 'ost')),
  add column if not exists beneficiary_staff_id uuid references public.staff_users(id) on delete restrict,
  add column if not exists beneficiary_ost_id uuid references public.ost_members(id) on delete restrict,
  add column if not exists rate_snapshot text check (rate_snapshot is null or rate_snapshot ~ '^0\.[0-9]{1,4}$'),
  add column if not exists basis_amount_snapshot text
    check (basis_amount_snapshot is null or basis_amount_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists qualified_at timestamptz,
  add column if not exists qualified_by uuid references public.staff_users(id) on delete restrict,
  add column if not exists qualification_notes text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists paid_by uuid references public.staff_users(id) on delete restrict,
  add column if not exists paid_reference text;

-- The seller may be staff (VD/SSM/SM) or an OST, so exactly one side is set.
alter table public.commissions drop constraint if exists commissions_beneficiary_check;
alter table public.commissions
  add constraint commissions_beneficiary_check
  check (
    (beneficiary_type = 'staff' and beneficiary_staff_id is not null and beneficiary_ost_id is null)
    or (beneficiary_type = 'ost' and beneficiary_ost_id is not null and beneficiary_staff_id is null)
  );

create index if not exists commissions_beneficiary_staff_idx on public.commissions (beneficiary_staff_id);
create index if not exists commissions_beneficiary_ost_idx on public.commissions (beneficiary_ost_id);
create index if not exists commissions_status_idx on public.commissions (status);
create index if not exists commissions_qualified_by_idx on public.commissions (qualified_by);
create index if not exists commissions_paid_by_idx on public.commissions (paid_by);
-- One commission per sale: a single-level 4% sale commission.
create unique index if not exists commissions_one_per_sale on public.commissions (sale_id);

comment on column public.commissions.rate_snapshot is
  'Commission rate captured at sale time. Never recomputed from the current product.';
comment on table public.commissions is
  'Single-level sale commission (4%). earned_at is set only by an explicit qualification decision; it is never advanced automatically.';

-- ===========================================================================
-- 10. Customer account onboarding (foundation only)
-- ---------------------------------------------------------------------------
-- A newly activated customer later receives a secure activation link or a
-- one-time code and sets their OWN password. Codes are stored hashed, are
-- single-use, and expire. No plaintext code and no generated password exists
-- anywhere in this repository.

create table public.customer_onboarding_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  membership_id uuid references public.memberships(id) on delete restrict,
  token_hash text not null unique,
  purpose text not null default 'account_activation'
    check (purpose in ('account_activation', 'password_reset')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists customer_onboarding_customer_idx on public.customer_onboarding_tokens (customer_id);
create index if not exists customer_onboarding_expiry_idx on public.customer_onboarding_tokens (expires_at)
  where consumed_at is null;

comment on table public.customer_onboarding_tokens is
  'Hashed, single-use, expiring onboarding tokens. Issue only; redemption happens in the Customer Portal phase.';
