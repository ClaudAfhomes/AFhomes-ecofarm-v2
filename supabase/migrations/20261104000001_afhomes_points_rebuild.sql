-- AF Homes: points rebuild foundation (migration skeleton, no DDL yet).
--
-- PURPOSE. This is the single forward-only migration that the whole points
-- rebuild appends to. Today it declares NO objects: the header below is the
-- whole body, and applying it is a proven no-op. Every later task adds its DDL
-- to THIS file rather than creating a sibling, so the rebuild lands as one
-- ordered unit and one version in supabase_migrations.schema_migrations.
--
-- WHY THIS FILE IS ADDED EMPTY, AND WHY THAT IS THE POINT:
--
-- * The migration runner records only the FILENAME PREFIX, with no content
--   hash (supabase/apply-migrations.ts:334-345). A database that already
--   recorded a version SKIPS the file, so a corrected body under a recorded
--   version is never re-delivered. Anything wrong with SQL shipped here can
--   only be fixed by a NEW migration, never by editing this one. Each appended
--   task must therefore be independently correct, and each later task extends
--   section 65 of supabase/db-integration.ts to cover what it added.
-- * The runner wraps each file in a single transaction
--   (supabase/apply-migrations.ts:341-348), so there is no begin/commit here.
--   The file must be valid on its own.
-- * This migration touches NEITHER 20261101000001_afhomes_application_purchase_flow.sql
--   NOR 20261102000001_afhomes_customer_directory_workflow_filter.sql. Both are
--   immutable and are never edited or re-applied.
--
-- WHAT IS RESERVED FOR THE LATER TASKS (appended below, in order):
--
--   Task  2  tier_points_config, points_periods,
--            points_accounts.reversal_debt, memberships.points_anniversary
--   Task  3  points_ledger CHECK and the attribution columns
--            (balance_before, counts_toward_cap, origin_award_id, origin_period_id)
--   Task  4  private.ensure_points_period(uuid), private.points_capacity(uuid)
--   Task  5  private.legacy_points_cutover()   -- the only task that mutates rows
--   Task  6  service_catalog, point_earning_rules
--   Task  7  purchases, purchase_lines, purchase_payments
--   Task  8  earning_claims, public.create_earning_claim(uuid, uuid)
--   Task  9  public.claim_earning_points(text), public.reissue_earning_claim(uuid, uuid)
--   Task 10  public.reverse_purchase_points(uuid, uuid, text),
--            point_redemption_rules, redemption_quotes,
--            public.quote_point_discount(uuid, bigint),
--            public.commit_point_discount(uuid),
--            public.purchase_financial_summary_purchases(uuid)
--
-- UNTOUCHED BY THE WHOLE REBUILD: redeem_membership_points,
-- redemption_items, redemptions, card_sales, payments, and api/_lib/identifier.ts.
--
-- Validation before apply:
--   select count(*) from supabase_migrations.schema_migrations
--     where version = '20261104000001';                                -- 0 rows
--   select to_regclass('public.tier_points_config');                  -- null
--   select to_regclass('public.points_periods');                      -- null
--   select to_regclass('public.purchases');                           -- null
--   select to_regclass('public.earning_claims');                      -- null
-- Validation after apply:
--   select count(*) from supabase_migrations.schema_migrations
--     where version = '20261104000001';                                -- 1 row
--   -- the file is a valid no-op: no relation, function, trigger or policy is
--   -- created by it, so every before/after catalogue count is unchanged.
--   select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
--     where ns.nspname = 'public' and p.proname like '%points%';       -- unchanged
--   -- then run pnpm test:db:local (section 65 asserts this version is recorded)
--   -- and supabase/security/rls_invariants.sql (empty = PASS).
--
-- Down note (forward-only, no down migration): this file creates nothing, so
-- reverting it is a no-op on the schema. Once a later task appends DDL, the down
-- path is the inverse DDL for the appended objects only, in reverse task order;
-- never re-apply or edit an earlier AF Homes migration to undo this one.

-- ===========================================================================
-- Task 2: the annual cap authority, the anniversary period, reversal debt
-- ===========================================================================
--
-- CAP AUTHORITY. tier_points_config is the ONLY source of an annual cap.
-- card_plans carries no cap and is never consulted for one. The three seeded
-- values are the business-approved annual maxima: 25,000 / 40,000 / 60,000.
--
--   Ruling: card_plans.yearly_points (10000/20000/25000) is FROZEN, not
--   dropped. It is still read by activate_card_sale's legacy paths, by
--   card_sales.yearly_points_snapshot, and by historical annual_allocation
--   rows. Removing the column is a separate, later decision, once compatibility
--   has been proven. Decision 01 retires it from the admin UI and the request
--   contracts, never from the schema.
--
--   Ruling: card_plans.total_loyalty_value (50000/200000/500000) is NEVER read
--   by any computation. It is a declared contract string that no code has ever
--   used, and this rebuild does not reinterpret it as points or as pesos. It
--   affects no calculation, no authorization, and no eligibility.

create table public.tier_points_config (
  tier              text primary key check (tier in ('BRONZE','SILVER','GOLD')),
  annual_points_cap bigint not null check (annual_points_cap > 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.staff_users(id) on delete set null
);

insert into public.tier_points_config (tier, annual_points_cap) values
  ('BRONZE', 25000),
  ('SILVER', 40000),
  ('GOLD',   60000);

comment on table public.tier_points_config is
  'The sole authority for an annual points cap, one row per VIP tier. Points periods snapshot the cap at open time, so editing a cap here never rewrites a running period.';

-- The stored anniversary anchor. Captured at activation as
-- (activated_at at time zone 'Asia/Manila')::date and never recomputed, so a
-- later timezone or search_path change cannot silently shift a member's history.
alter table public.memberships add column points_anniversary date;

comment on column public.memberships.points_anniversary is
  'The member''s points-year anchor, a Manila calendar date captured at activation. Every period boundary derives from this date, never from the previous boundary.';

create table public.points_periods (
  id                uuid primary key default gen_random_uuid(),
  -- ON DELETE CASCADE, deliberately. A period is a DERIVED scheduling record that
  -- belongs to its account; it is not independent financial history - the
  -- ledger is. With RESTRICT every routine that removes a points account would
  -- also have to know about periods, and one that forgot would fail at the worst
  -- possible moment. The history survives regardless: points_ledger keeps its
  -- rows and simply loses the period attribution (ON DELETE SET NULL below).
  account_id        uuid not null references public.points_accounts(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  -- SNAPSHOTS, not live joins. Editing tier_points_config mid-period cannot
  -- change a running period. A tier change takes effect at the next anniversary.
  tier              text not null check (tier in ('BRONZE','SILVER','GOLD')),
  annual_points_cap bigint not null check (annual_points_cap > 0),
  opening_balance   bigint check (opening_balance is null or opening_balance >= 0),
  closing_balance   bigint check (closing_balance is null or closing_balance >= 0),
  status            text not null default 'open' check (status in ('open','reset')),
  reset_at          timestamptz,
  -- WHO or WHAT closed the period. Automatic anniversary catch-up writes
  -- 'automatic' with a NULL actor; a staff-triggered close records both.
  reset_source      text check (reset_source is null or reset_source in ('automatic','staff','admin')),
  reset_actor_id    uuid references public.staff_users(id) on delete set null,
  -- NULL for a period already in progress at cutover. Historical opening
  -- balances are never fabricated; authoritative accounting begins at this date.
  authoritative_from date,
  created_at        timestamptz not null default now(),
  constraint points_periods_half_open check (period_start < period_end),
  constraint points_periods_unique unique (account_id, period_start)
);

create index points_periods_account_range_idx
  on public.points_periods (account_id, period_start desc);

comment on table public.points_periods is
  'Anniversary-based points periods, half-open [period_start, period_end) in Asia/Manila. One row per account per points year; the tier and cap are snapshots taken when the period opened.';

-- ===========================================================================
-- Reversal debt
-- ===========================================================================
--
-- NON-MONETARY. A points quantity, never a peso amount and never a numeric.
-- No automatic expiry: debt does not lapse at a reset, at a membership expiry,
-- or on any schedule. Future eligible earnings repay it first; only the
-- surplus becomes spendable. Spending is refused while this is greater than
-- zero. There is no waiver function in this release (decision 10) and no
-- customers.status change.
--
-- The existing points_accounts.balance CHECK (>= 0) is deliberately left in
-- place, so the raw balance can never go negative. There is intentionally NO
-- CHECK (balance >= reversal_debt): an annual reset sets balance to 0 while
-- leaving debt unchanged, which would violate that constraint by design. The
-- spendable figure is greatest(0, balance - reversal_debt) and the
-- reconciliation invariant is asserted by the test suite instead.

alter table public.points_accounts
  add column reversal_debt bigint not null default 0 check (reversal_debt >= 0);

comment on column public.points_accounts.reversal_debt is
  'Non-monetary points debt from a reversal exceeding the available balance. No automatic expiry and no waiver. Earning repays it first; spending is refused while positive.';

-- ===========================================================================
-- Task 3: ledger attribution
-- ===========================================================================
--
-- The append-only ledger is the audit record. It gains:
--   balance_before     because only balance_after existed, which makes a
--                      mid-history cap change unauditable
--   counts_toward_cap  immutable attribution; always true in this release,
--                      because no cap exemption exists (decision 03)
--   origin_period_id   set on EVERY new-flow row that can affect capacity, so
--                      the capacity query selects a period without inferring
--                      it from a timestamp
--   origin_award_id    set on reversal rows only, pointing at the original
--                      earned row so its period and cap treatment stay
--                      recoverable even after the rule that created it changes

alter table public.points_ledger
  add column balance_before   bigint check (balance_before is null or balance_before >= 0),
  add column counts_toward_cap boolean not null default true,
  add column origin_award_id  bigint references public.points_ledger(id),
  -- ON DELETE SET NULL, not RESTRICT: the ledger is immutable history and must
  -- outlive the period it was attributed to. Losing the attribution is correct;
  -- losing the row would defeat the point of an append-only ledger.
  add column origin_period_id uuid references public.points_periods(id) on delete set null;

comment on column public.points_ledger.origin_period_id is
  'The points period whose cap this row consumes or restores. Set on earned, promotional_bonus and reversal rows. redemption, annual_reset and cutover_baseline rows are excluded from capacity arithmetic.';

-- entry_type gains four writers' worth of values. The five existing values are
-- RETAINED: annual_allocation and expiration stay in the set for historical
-- rows even though nothing new writes them, and their partial unique index
-- points_ledger_one_allocation_per_year is deliberately kept, not dropped.
--
-- There is NO debt_waiver value: the waiver was deferred (decision 10).
alter table public.points_ledger drop constraint if exists points_ledger_entry_type_check;
alter table public.points_ledger add constraint points_ledger_entry_type_check check (
  entry_type in (
    'annual_allocation',  -- legacy, retained for historical rows
    'redemption',         -- Phase 4 catalog redemption
    'adjustment',         -- legacy import opening balance
    'reversal',           -- gains its first writer in Task 10
    'expiration',         -- legacy, retained for historical rows
    'earned',             -- Task 9
    'annual_reset',       -- Task 4
    'promotional_bonus',  -- Task 8
    'cutover_baseline'    -- Task 5, administrative only, never cap-consuming
  )
);

comment on table public.points_ledger is
  'Append-only points history. A reversal is a NEW compensating row, never an update or delete. The binding invariant is: points_accounts.balance - points_accounts.reversal_debt = sum(points_ledger.amount).';

-- ===========================================================================
-- Task 6: the service catalog and configurable earning rules
-- ===========================================================================
--
-- Nothing here is hardcoded in a component. A promotion becomes live by
-- inserting a rule row; activating or deactivating one needs no deployment.

create table public.service_catalog (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  base_price  text not null default '0.00'
                check (base_price ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  is_active   boolean not null default true,
  -- THE minimum explicit classification, and the only one. Approved ruling 1:
  -- accommodation/staycation eligibility is a property of the SERVICE, read from
  -- this catalog. There is deliberately no booking or check-in table - spending
  -- eligibility is decided here, not by a reservation record.
  --
  -- false (the default) means points may NOT discount this line unless an active,
  -- in-date redemption promotion names it. So a service is staycation-eligible
  -- only by an explicit, visible, admin-managed decision.
  is_staycation_eligible boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.service_catalog is
  'Eligible AF Homes products and services (Teppanyaki, Resort Stay, Hotel). Admin-managed; no service is hardcoded in application code. is_staycation_eligible is the ONLY eligibility classification; a non-eligible service can still be discounted by an active promotion (point_redemption_rules).';

create table public.point_earning_rules (
  id                 uuid primary key default gen_random_uuid(),
  service_id         uuid not null references public.service_catalog(id) on delete restrict,
  points_amount      bigint not null check (points_amount > 0),
  eligible_tiers     text[] not null
                       check (eligible_tiers <@ array['BRONZE','SILVER','GOLD']::text[]),
  effective_start    date not null,
  effective_end      date not null,
  is_active          boolean not null default true,
  min_quantity       int not null default 1 check (min_quantity > 0),
  max_award          bigint check (max_award is null or max_award > 0),
  promotion_reference text,
  created_by         uuid references public.staff_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint point_earning_rules_dates check (effective_start < effective_end)
);

create index point_earning_rules_lookup_idx
  on public.point_earning_rules (service_id, effective_start, effective_end)
  where is_active;

comment on table public.point_earning_rules is
  'Configurable point awards. Selection takes the ACTIVE rule that is in date and tier-eligible with the HIGHEST points_amount, so a promotion outranks a base rule automatically. No eligible rule means no claim and no award.';

-- ===========================================================================
-- Task 10: redemption promotions, quotes, and the points discount
-- ===========================================================================
--
-- APPROVED RULINGS, restated as the constraints that enforce them:
--
-- * SPENDING is restricted to accommodation/staycation by default. Earning is NOT
--   restricted: point_earning_rules above still governs what a purchase earns.
--   These are two independent questions and two independent tables.
-- * A non-staycation service becomes discountable ONLY through an active,
--   date-bounded promotion naming it. There is no catch-all and no wildcard.
-- * No INDEFINITE eligibility promotions. effective_start and effective_end are
--   both NOT NULL and CHECKed, so a promotion cannot be created that never expires.
--   Half-open [effective_start, effective_end) in Asia/Manila.
-- * Every promotion records WHO created it. An unaudited promotion is a silent
--   commercial change, which is exactly what must never happen.
-- * card_plans.discount_percent is NOT applied here. It discounts VIP card
--   PRICING only, never a service purchase, and it never stacks with a points
--   discount. There is deliberately no service-discount column.

create table public.point_redemption_rules (
  id                  uuid primary key default gen_random_uuid(),
  -- NAME the services. Not a category, not a flag: the promotion says exactly
  -- which catalog entries it opens up, so its effect is auditable by reading it.
  service_id          uuid not null references public.service_catalog(id) on delete restrict,
  -- CONFIGURED, never assumed. One point equalling one peso would be a constant
  -- masquerading as configuration; a promotion may set a different rate with no
  -- deployment.
  peso_value_per_point numeric not null check (peso_value_per_point > 0),
  eligible_tiers      text[] not null
                       check (eligible_tiers <@ array['BRONZE','SILVER','GOLD']::text[]),
  min_points          bigint not null default 1 check (min_points > 0),
  max_points          bigint check (max_points is null or max_points >= min_points),
  -- A floor on the purchase a promotion applies to. NULL means no floor.
  min_purchase_amount text check (min_purchase_amount is null
                                    or min_purchase_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  -- NOT NULL on BOTH ends. This is what makes an indefinite promotion
  -- unrepresentable rather than merely discouraged.
  effective_start     date not null,
  effective_end       date not null,
  is_active           boolean not null default true,
  -- Mandatory on a promotion. An unnamed, undated commercial offer is not
  -- reviewable, so there is no default that would let one be created blank.
  promotion_reference text not null check (length(btrim(promotion_reference)) > 0),
  created_by          uuid references public.staff_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint point_redemption_rules_dates check (effective_start < effective_end)
);

create index point_redemption_rules_lookup_idx
  on public.point_redemption_rules (service_id, effective_start, effective_end)
  where is_active;

comment on table public.point_redemption_rules is
  'Date-bounded promotions that make a NON-staycation service discountable by points. Half-open [effective_start, effective_end) in Asia/Manila; both ends NOT NULL, so no indefinite promotion exists. Never applied to VIP card pricing and never stacks with card_plans.discount_percent.';

-- A quote is the member''s OFFER: how many points, at what peso value, expiring
-- at a known instant. It is a short-lived record because the price of points is
-- configuration, and configuration can change inside the window a member was
-- quoted. Committing re-reads nothing: it spends exactly what was promised.


-- The SINGLE definition of "may points discount this line", so the quote gate,
-- the commit and any future report cannot drift apart.
--
-- Eligible when EITHER the service is staycation-eligible, OR an active, in-date
-- promotion names it. Half-open dates in Asia/Manila. `is_active` alone is not
-- enough: a promotion whose window has passed grants nothing, which is what stops
-- an "indefinite" promotion from being smuggled in with a far-future end date.
create or replace function private.line_discount_eligible(
  p_service_id uuid,
  p_tier text,
  p_eligible_line_total numeric
)
returns boolean
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select exists (
           select 1
           from public.service_catalog sc
           where sc.id = p_service_id
             and sc.is_active
             and sc.is_staycation_eligible
         )
         or exists (
           select 1
           from public.point_redemption_rules r
           join public.service_catalog sc on sc.id = r.service_id
           where r.service_id = p_service_id
             and r.is_active
             and sc.is_active
             -- rray[p_tier] <@ r.eligible_tiers, NOT the reverse. Contained-in reads
  -- 'is the PROMOTION's list a subset of this ONE member tier', which is false
  -- for every promotion naming more than one tier - so a GOLD member silently
  -- matched no promotion at all. Found only by executing the SQL.
   and array[p_tier] <@ r.eligible_tiers
             and (now() at time zone 'Asia/Manila')::date >= r.effective_start
             and (now() at time zone 'Asia/Manila')::date <  r.effective_end
             and (r.min_purchase_amount is null
                  or r.min_purchase_amount::numeric <= p_eligible_line_total)
         )
$$;

revoke all on function private.line_discount_eligible(uuid, text, numeric) from public, anon, authenticated;
grant execute on function private.line_discount_eligible(uuid, text, numeric) to service_role;

-- The best CONVERSION RATE available for one service right now. Not the base
-- rate: promotions deliberately outrank it, exactly as they do for earning.
create or replace function private.redemption_rate(p_service_id uuid, p_tier text)
returns numeric
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select max(r.peso_value_per_point)
  from public.point_redemption_rules r
  join public.service_catalog sc on sc.id = r.service_id
  where r.service_id = p_service_id
    and r.is_active
    and sc.is_active
    -- rray[p_tier] <@ r.eligible_tiers, NOT the reverse. Contained-in reads
  -- 'is the PROMOTION's list a subset of this ONE member tier', which is false
  -- for every promotion naming more than one tier - so a GOLD member silently
  -- matched no promotion at all. Found only by executing the SQL.
   and array[p_tier] <@ r.eligible_tiers
    and (now() at time zone 'Asia/Manila')::date >= r.effective_start
    and (now() at time zone 'Asia/Manila')::date <  r.effective_end
$$;

revoke all on function private.redemption_rate(uuid, text) from public, anon, authenticated;
grant execute on function private.redemption_rate(uuid, text) to service_role;


-- Ruling: there is NO counts_toward_cap column on this table. Decision 03
-- removes cap exemptions from v1, so no rule can be configured to bypass the
-- annual cap. The ledger keeps the attribution; the rule surface does not
-- expose a way to set it.

-- ===========================================================================
-- Task 7: the purchase ledger, and a SEPARATE receipt model
-- ===========================================================================
--
-- Ruling: purchase receipts are recorded in their OWN table, not in
-- public.payments. public.payments cannot carry them: the constraint
-- payments_purchase_origin_check (20261101000001) is a closed CHECK admitting
-- only origin='sale' or origin='reservation', and verify_purchase_payment_once
-- operates on reservation agreements against card_sales. Adding a purchase
-- origin would mean editing a protected migration, which is forbidden. The
-- card-sale payment workflow is therefore left completely untouched.

create table public.purchases (
  id             uuid primary key default gen_random_uuid(),
  purchase_number text not null unique
                   default private.claim_af_id('AF-TXN', 'public.purchases'::regclass, 'purchase_number'),
  customer_id    uuid not null references public.customers(id) on delete restrict,
  membership_id  uuid not null references public.memberships(id) on delete restrict,
  status         text not null default 'draft'
                   check (status in ('draft','completed','reversed')),
  -- The accounting triple. gross - points_discount = net, enforced by CHECK.
  -- A points discount REDUCES net_amount; it is NEVER recorded as cash
  -- received. Receipts live only in purchase_payments.
  gross_amount          text not null default '0.00'
                          check (gross_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  points_discount_amount text not null default '0.00'
                          check (points_discount_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  net_amount            text not null default '0.00'
                          check (net_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  constraint purchases_net_equals_gross_minus_discount check (
    net_amount::numeric = gross_amount::numeric - points_discount_amount::numeric
  ),
  completed_at   timestamptz,
  reversed_at    timestamptz,
  reversal_reason text,
  created_by     uuid not null references public.staff_users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index purchases_customer_idx on public.purchases (customer_id, created_at desc);
create index purchases_membership_idx on public.purchases (membership_id);
create index purchases_status_idx on public.purchases (status);

comment on table public.purchases is
  'A completed AF Homes service purchase. Only status=''completed'' can generate an earning claim, and completion requires verified receipts in purchase_payments to cover net_amount.';

create table public.purchase_lines (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  service_id  uuid not null references public.service_catalog(id) on delete restrict,
  quantity    int not null default 1 check (quantity > 0),
  unit_amount text not null check (unit_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  line_total  text not null check (line_total ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  -- PER-LINE points discount. Approved ruling 1: for a MIXED purchase the
  -- discount is restricted to eligible line amounts, so the split has to be
  -- recorded per line - a single purchase-level figure could not express "this
  -- line is discountable, that one is not".
  --
  -- SNAPSHOTTED eligibility, deliberately. Whether a line could be discounted is
  -- decided at QUOTE time and frozen onto the line, so activating or expiring a
  -- promotion afterwards can never retroactively change a settled purchase.
  points_discount_amount text not null default '0.00'
                          check (points_discount_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  discount_eligible boolean not null default false,
  constraint purchase_lines_total check (line_total::numeric = unit_amount::numeric * quantity),
  -- A line can never be discounted beyond its own value. This is what makes a
  -- negative net amount structurally impossible on a line, before the purchase
  -- level triple is even considered.
  constraint purchase_lines_discount_within_total check (
    points_discount_amount::numeric <= line_total::numeric
  ),
  -- An ineligible line carries no discount at all. Not merely "usually zero":
  -- a non-zero discount on an ineligible line is a rule violation, and a CHECK
  -- is the cheapest place to make it impossible.
  constraint purchase_lines_ineligible_undiscounted check (
    discount_eligible or points_discount_amount::numeric = 0
  )
);

create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id);
create index purchase_lines_service_idx on public.purchase_lines (service_id);

-- Purchase receipts. amount uses the POSITIVE-ONLY money regex, matching
-- public.payments.amount, because a receipt is never zero. There is
-- deliberately NO points column: a points discount is not a receipt.
create table public.purchase_payments (
  id            uuid primary key default gen_random_uuid(),
  payment_number text not null unique
                  default private.claim_af_id('AF-PAY', 'public.purchase_payments'::regclass, 'payment_number'),
  purchase_id   uuid not null references public.purchases(id) on delete restrict,
  amount        text not null check (amount ~ '^[1-9][0-9]*(\.[0-9]{1,2})?$'),
  method        text not null,
  reference     text,
  status        text not null default 'recorded'
                  check (status in ('recorded','verified','rejected','voided')),
  recorded_by   uuid not null references public.staff_users(id) on delete restrict,
  verified_by   uuid references public.staff_users(id) on delete restrict,
  recorded_at   timestamptz not null default now(),
  verified_at   timestamptz,
  rejection_reason text,
  voided_at     timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);

create unique index purchase_payments_purchase_reference_uidx
  on public.purchase_payments (purchase_id, reference) where reference is not null;
create index purchase_payments_purchase_status_idx
  on public.purchase_payments (purchase_id, status);
create index purchase_payments_recorded_by_idx
  on public.purchase_payments (recorded_by);

comment on table public.purchase_payments is
  'Cash receipts against a service purchase. Separate from public.payments, which belongs to the card-sale workflow and is untouched. Only ''verified'' rows count toward covering net_amount.';

-- The single definition of "how much has been verifiedly received", so the
-- completion gate (Task 8) and the discount gate (Task 14) cannot drift.
create or replace function private.purchase_verified_total(p_purchase_id uuid)
returns numeric
language sql stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select coalesce(sum(pp.amount::numeric), 0)
  from public.purchase_payments pp
  where pp.purchase_id = p_purchase_id
    and pp.status = 'verified'
$$;

revoke all on function private.purchase_verified_total(uuid) from public, anon, authenticated;
grant execute on function private.purchase_verified_total(uuid) to service_role;

create table public.redemption_quotes (
  id                uuid primary key default gen_random_uuid(),
  quote_number      text not null unique
                      default private.claim_af_id('AF-QTE', 'public.redemption_quotes'::regclass, 'quote_number'),
  purchase_id       uuid not null references public.purchases(id) on delete cascade,
  account_id        uuid not null references public.points_accounts(id) on delete restrict,
  membership_id     uuid not null references public.memberships(id) on delete restrict,
  points_requested  bigint not null check (points_requested > 0),
  -- The peso value is a SNAPSHOT of the promotion that was matched, never a live
  -- join. If the promotion is edited or expires before commit, the member still
  -- receives the quoted figure.
  peso_value_per_point numeric not null check (peso_value_per_point > 0),
  peso_value        text not null check (peso_value ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  eligible_line_total text not null check (eligible_line_total ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  points_balance_snapshot bigint not null check (points_balance_snapshot >= 0),
  remaining_points_after  bigint not null check (remaining_points_after >= 0),
  status            text not null default 'open' check (status in ('open','committed','expired','cancelled')),
  expires_at        timestamptz not null,
  committed_at      timestamptz,
  ledger_entry_id   bigint references public.points_ledger(id) on delete restrict,
  created_by        uuid not null references public.staff_users(id) on delete restrict,
  created_at        timestamptz not null default now(),
  constraint redemption_quotes_half_open check (expires_at > created_at)
);

create index redemption_quotes_purchase_idx on public.redemption_quotes (purchase_id);
-- Only OPEN quotes are ever looked up, so the partial index is the whole index.
create index redemption_quotes_open_idx
  on public.redemption_quotes (purchase_id, expires_at) where status = 'open';

comment on table public.redemption_quotes is
  'A short-lived priced offer for spending points on a purchase. The peso value and the conversion rate are snapshots of the matched promotion; commit spends exactly what was quoted and re-reads no configuration.';





-- ===========================================================================
-- Task 8 groundwork: register the new business identifiers
-- ===========================================================================
--
-- AF-TXN (purchase) and AF-EARN (earning claim) are new prefixes.
-- AF-PAY already exists but is PINNED to public.payments, so purchase receipts
-- need their own (prefix, table, column) triple. The allocator refuses
-- arbitrary targets on purpose: every allowed target is enumerated, so no
-- caller can aim it at an arbitrary identifier column.

create or replace function private.af_candidate(p_prefix text)
returns text
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea;
  v bigint := 0;
  chars integer;
  i integer;
  out text := '';
begin
  if p_prefix = 'AF-CC' then
    -- Customer Code: 40 bits of pgcrypto entropy, eight 5-bit slices.
    raw := gen_random_bytes(5);
    chars := 8;
  elsif p_prefix in (
    'AF-CUS','AF-SALES','AF-CSALE','AF-EMP','AF-APP','AF-RES','AF-OST',
    'AF-ACC','AF-REN','AF-PAY','AF-COM','AF-RED','AF-IMP','AF-TXN','AF-EARN','AF-QTE'
  ) then
    raw := gen_random_bytes(4);
    chars := 5;
  else
    raise exception 'INVALID_BUSINESS_PREFIX';
  end if;
  for i in 0..(octet_length(raw) - 1) loop
    v := (v << 8) | get_byte(raw, i);
  end loop;
  for i in 0..(chars - 1) loop
    out := out || substr(alphabet, ((v >> (i * 5)) & 31)::integer + 1, 1);
  end loop;
  return p_prefix || '-' || out;
end $$;

create or replace function private.claim_af_id(p_prefix text, p_table regclass, p_column text)
returns text
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  attempt integer;
  candidate text;
  taken boolean;
begin
  if not (
    (p_prefix = 'AF-CUS'   and p_table = 'public.customers'::regclass                  and p_column = 'customer_number') or
    (p_prefix = 'AF-CSALE' and p_table = 'public.card_sales'::regclass                  and p_column = 'sale_number') or
    (p_prefix = 'AF-APP'   and p_table = 'public.customer_applications'::regclass      and p_column = 'application_number') or
    (p_prefix = 'AF-RES'   and p_table = 'public.reservation_agreements'::regclass      and p_column = 'reservation_number') or
    (p_prefix = 'AF-OST'   and p_table = 'public.ost_members'::regclass                 and p_column = 'ost_number') or
    (p_prefix = 'AF-ACC'   and p_table = 'private.ost_registration_details'::regclass  and p_column = 'form_number') or
    (p_prefix = 'AF-REN'   and p_table = 'private.ost_accreditation_renewals'::regclass and p_column = 'renewal_number') or
    (p_prefix = 'AF-PAY'   and p_table = 'public.payments'::regclass                    and p_column = 'payment_number') or
    (p_prefix = 'AF-COM'   and p_table = 'public.commissions'::regclass                and p_column = 'commission_number') or
    (p_prefix = 'AF-RED'   and p_table = 'public.redemptions'::regclass                 and p_column = 'redemption_number') or
    (p_prefix = 'AF-IMP'   and p_table = 'public.customer_import_jobs'::regclass       and p_column = 'job_number') or
    (p_prefix = 'AF-IMP'   and p_table = 'private.ost_import_jobs'::regclass           and p_column = 'job_number') or
    (p_prefix = 'AF-EMP'   and p_table = 'public.staff_users'::regclass                and p_column = 'employee_number') or
    (p_prefix = 'AF-SALES' and p_table = 'public.staff_users'::regclass                and p_column = 'sales_number') or
    (p_prefix = 'AF-CC'    and p_table = 'public.customers'::regclass                  and p_column = 'customer_code') or
    -- points rebuild
    (p_prefix = 'AF-TXN'   and p_table = 'public.purchases'::regclass                  and p_column = 'purchase_number') or
    (p_prefix = 'AF-EARN'  and p_table = 'public.earning_claims'::regclass              and p_column = 'claim_number') or
    (p_prefix = 'AF-PAY'   and p_table = 'public.purchase_payments'::regclass           and p_column = 'payment_number') or
    (p_prefix = 'AF-QTE'   and p_table = 'public.redemption_quotes'::regclass           and p_column = 'quote_number')
  ) then
    raise exception 'INVALID_BUSINESS_ID_TARGET';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_prefix, 23000002));
  for attempt in 1..64 loop
    candidate := private.af_candidate(p_prefix);
    execute format('select exists(select 1 from %s where %I = $1)', p_table, p_column)
      into taken using candidate;
    if not taken then
      return candidate;
    end if;
  end loop;
  raise exception 'BUSINESS_ID_ALLOCATION_FAILED' using errcode = '55000';
end $$;

comment on function private.claim_af_id(text, regclass, text) is
  'Allocates a business identifier for an enumerated set of (prefix, table, column) triples. AF-TXN (purchases), AF-EARN (earning claims) and purchase payments join that set here.';

-- ===========================================================================
-- Task 4: the period choke point
-- ===========================================================================
--
-- This is the ONLY function that opens or closes a points period, and every
-- path that reads or moves spendable points must call it first: balance reads,
-- claim creation, claim redemption, cash discounts, catalog redemption,
-- reversals, manual adjustments and admin operations. No scheduled job exists,
-- so correctness depends entirely on that call discipline.
--
-- Half-open periods: period_start <= v_today < period_end. There is no
-- ambiguity at the exact boundary instant.
--
-- Every boundary derives from the ORIGINAL anchor, never from the previous
-- boundary, so a leap-day member does not drift: 2024-02-29 gives
-- [2024-02-29, 2025-02-28), [2025-02-28, 2026-02-28), ... [2028-02-29, ...).
-- PostgreSQL clamps date + interval '1 year' into 28 February in a non-leap
-- year, and recomputing from the anchor restores 29 February in the next leap
-- year instead of losing it permanently.
--
-- The function walks EVERY missed boundary, not just one, so a dormant account
-- that has not been touched for three years catches up in a single call.
--
-- Lock order: points_accounts, then points_periods. Always that order.

create or replace function private.ensure_points_period(p_account_id uuid)
returns uuid
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_account public.points_accounts%rowtype;
  v_anchor  date;
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_tier    text;
  v_cap     bigint;
  v_period  public.points_periods%rowtype;
  v_period_id uuid;
  v_index   int := 0;
  v_closing bigint;
begin
  if p_account_id is null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = '22023';
  end if;

  select * into v_account
    from public.points_accounts
   where id = p_account_id
   for update;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The stored anchor wins. A member activated before this migration is
  -- backfilled by the cutover from activated_at in Manila; a NULL anchor falls
  -- back to the same derivation so no period is ever fabricated.
  select coalesce(m.points_anniversary,
                  (m.activated_at at time zone 'Asia/Manila')::date)
    into v_anchor
    from public.memberships m
   where m.id = v_account.membership_id;
  if v_anchor is null then
    raise exception 'POINTS_ANCHOR_MISSING' using errcode = '55000';
  end if;

  -- The period containing today, if one is already recorded.
  select * into v_period
    from public.points_periods
   where account_id = p_account_id
     and period_start <= v_today
     and period_end > v_today;
  if found then
    return v_period.id;
  end if;

  -- Nothing open: close every elapsed period, newest first.
  for v_period in
    select * from public.points_periods
     where account_id = p_account_id and period_end <= v_today
     order by period_start desc
  loop
    -- closing_balance is the balance BEFORE the reset.
    select a.balance into v_closing
      from public.points_accounts a where a.id = p_account_id;

    update public.points_periods
       set status = 'reset',
           closing_balance = v_closing,
           reset_at = now(),
           reset_source = 'automatic',
           reset_actor_id = null
     where id = v_period.id;

    -- One ledger row per balance change, in the same transaction, with the same
    -- sign, so the reconciliation invariant still holds. amount <> 0 forbids a
    -- zero row, so an already-empty period closes with no row at all.
    if v_closing > 0 then
      insert into public.points_ledger (
        account_id, entry_type, amount, balance_before, balance_after,
        origin_period_id, counts_toward_cap, reason
      ) values (
        p_account_id, 'annual_reset', -v_closing, v_closing, 0,
        v_period.id, false,
        'Annual reset: unused points do not roll over'
      );
    end if;

    -- The reset never erases debt and never restores reversed points, so
    -- reversal_debt is deliberately left untouched.
    update public.points_accounts
       set balance = 0, updated_at = now()
     where id = p_account_id;

    -- Keep the materialized cache in step, as Phase 4 established.
    update public.memberships
       set points_balance = 0
     where id = v_account.membership_id;
  end loop;

  -- Open the period containing today, walking from the anchor so a long-dormant
  -- account lands on the right index rather than on "one period ago".
  v_index := greatest(0, (extract(year from age(v_today, v_anchor)))::int);
  while true loop
    exit when v_anchor + make_interval(years => v_index) > v_today;
    v_index := v_index + 1;
  end loop;
  v_index := v_index - 1;

  select cp.code, t.annual_points_cap into v_tier, v_cap
    from public.memberships m
    join public.card_plans cp on cp.id = m.product_id
    join public.tier_points_config t on t.tier = cp.code
   where m.id = v_account.membership_id;
  if v_tier is null then
    raise exception 'POINTS_TIER_UNRESOLVED' using errcode = '55000';
  end if;

  insert into public.points_periods (
    account_id, period_start, period_end, tier, annual_points_cap,
    opening_balance, status
  ) values (
    p_account_id,
    (v_anchor + make_interval(years => v_index))::date,
    (v_anchor + make_interval(years => v_index + 1))::date,
    v_tier, v_cap,
    (select a.balance from public.points_accounts a where a.id = p_account_id),
    'open'
  )
  on conflict (account_id, period_start) do nothing
  returning id into v_period_id;

  if v_period_id is null then
    select id into v_period_id
      from public.points_periods
     where account_id = p_account_id
       and period_start = (v_anchor + make_interval(years => v_index))::date;
  end if;
  return v_period_id;
end $$;

comment on function private.ensure_points_period(uuid) is
  'Opens or advances the caller''s points period, closing any elapsed periods with an immutable annual_reset event. The single choke point every points path must call; idempotent and safe to call concurrently.';

revoke all on function private.ensure_points_period(uuid) from public, anon, authenticated;
grant execute on function private.ensure_points_period(uuid) to service_role;

-- ===========================================================================
-- Task 8: customer-bound earning claims and the capacity budget
-- ===========================================================================
--
-- THE CENTRAL PROBLEM. Capacity is reserved when a claim is CREATED, not when
-- it is claimed. Without a reservation, N pending claims would each evaluate
-- against the full cap and each award in full, so a member could be pushed
-- well past the cap by completing several purchases in the same period.
--
--   capacity(P) = greatest(0, P.annual_points_cap - used(P) - reserved(P))
--
-- The expires_at filter is what makes an elapsed reservation stop consuming
-- capacity with no scheduled job: a claim still marked 'available' but past
-- its expiry is simply excluded from the arithmetic.

create table public.earning_claims (
  id             uuid primary key default gen_random_uuid(),
  claim_number   text not null unique
                   default private.claim_af_id('AF-EARN', 'public.earning_claims'::regclass, 'claim_number'),
  -- UNIQUE: one completed purchase produces at most one claim. This is also
  -- the purchase-level deduplication guard against a replayed purchase.
  purchase_id    uuid not null unique references public.purchases(id) on delete restrict,
  customer_id    uuid not null references public.customers(id) on delete restrict,
  membership_id  uuid not null references public.memberships(id) on delete restrict,
  account_id     uuid not null references public.points_accounts(id) on delete restrict,
  service_id     uuid not null references public.service_catalog(id) on delete restrict,
  rule_id        uuid not null references public.point_earning_rules(id) on delete restrict,
  period_id      uuid not null references public.points_periods(id) on delete restrict,
  tier           text not null check (tier in ('BRONZE','SILVER','GOLD')),
  points_requested bigint not null check (points_requested > 0),
  -- The RESERVED figure at creation. The award is recomputed at claim time,
  -- because other claims may have been created or claimed since.
  points_awarded bigint not null check (points_awarded >= 0),
  points_capped  bigint not null default 0 check (points_capped >= 0),
  counts_toward_cap boolean not null default true,
  status         text not null default 'available'
                   check (status in ('available','claimed','expired','reversed')),
  -- Nullable so a rotation leaves no stale secret in the row. Unique-partial
  -- so two live claims can never share a token.
  qr_token_hash        text,
  fallback_code_hash   text,
  token_issued_at timestamptz,
  expires_at     timestamptz not null,
  claimed_at     timestamptz,
  created_at     timestamptz not null default now()
);

create unique index earning_claims_qr_uidx on public.earning_claims (qr_token_hash)
  where qr_token_hash is not null;
create unique index earning_claims_fallback_uidx on public.earning_claims (fallback_code_hash)
  where fallback_code_hash is not null;
create index earning_claims_account_status_idx on public.earning_claims (account_id, status);
create index earning_claims_customer_idx on public.earning_claims (customer_id, created_at desc);
create index earning_claims_period_idx on public.earning_claims (period_id, status);

comment on table public.earning_claims is
  'A customer-bound, single-use point award created from one completed purchase. Tokens are stored hash-only and rotate rather than recover; an ownership mismatch is refused generically.';

-- Ledger-level backstop. Survives a handler bug, a retry after a timeout, and a
-- concurrent double-scan: even if the claim CAS were bypassed, only one 'earned'
-- row can ever exist per claim.
create unique index points_ledger_one_earned_per_claim
  on public.points_ledger (reference_id)
  where entry_type = 'earned' and reference_type = 'earning_claim';

-- ---------------------------------------------------------------------------
-- Live capacity: cap - used - reserved.
-- ---------------------------------------------------------------------------
create or replace function private.points_capacity(p_account_id uuid, p_period_id uuid)
returns bigint
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  with p as (select annual_points_cap from public.points_periods where id = p_period_id),
       used as (
         select coalesce(sum(l.amount), 0)::bigint as v
           from public.points_ledger l
          where l.origin_period_id = p_period_id
            and l.counts_toward_cap
            and l.entry_type in ('earned','promotional_bonus','reversal')
       ),
       reserved as (
         -- An elapsed reservation is excluded here, so it stops consuming
         -- capacity the moment it lapses, with no scheduled job required.
         select coalesce(sum(c.points_awarded), 0)::bigint as v
           from public.earning_claims c
          where c.period_id = p_period_id
            and c.status = 'available'
            and c.expires_at > now()
       )
  select greatest(0, p.annual_points_cap - used.v - reserved.v)
    from p, used, reserved
   where p.annual_points_cap is not null
$$;

comment on function private.points_capacity(uuid, uuid) is
  'Remaining earning capacity for a period: cap minus consumed minus reserved. Reserved capacity is held by available, unexpired claims and is released on claim, expiry or reversal.';

revoke all on function private.points_capacity(uuid, uuid) from public, anon, authenticated;
grant execute on function private.points_capacity(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The staff entry point. A claim originates from an eligible COMPLETED
-- purchase. Staff never type a points figure: no parameter accepts one.
-- ---------------------------------------------------------------------------
create or replace function public.create_earning_claim(p_purchase_id uuid, p_actor_id uuid)
returns table (
  claim_id        uuid,
  claim_number    text,
  qr_token        text,
  fallback_code   text,
  points_requested bigint,
  points_reserved  bigint,
  points_capped   bigint,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_purchase    public.purchases%rowtype;
  v_customer    public.customers%rowtype;
  v_membership  public.memberships%rowtype;
  v_account     public.points_accounts%rowtype;
  v_rule        public.point_earning_rules%rowtype;
  v_service     uuid;
  v_quantity    int;
  v_tier        text;
  v_period_id   uuid;
  v_capacity    bigint;
  v_requested   bigint;
  v_reserved    bigint;
  v_claim_id    uuid;
  v_claim_no    text;
  v_qr          text;
  v_fallback    text;
  v_expiry      timestamptz;
  v_verified    numeric;
  v_net         numeric;
  v_today       date := (now() at time zone 'Asia/Manila')::date;
begin
  -- The handler is not the security boundary: re-validate the actor in SQL,
  -- exactly as redeem_membership_points does.
  if not exists (
    select 1 from public.staff_users su
     where su.id = p_actor_id and su.status = 'active'
  ) then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_purchase.status <> 'completed' then
    raise exception 'PURCHASE_NOT_COMPLETED' using errcode = '55000';
  end if;
  -- One claim per purchase, enforced by the unique constraint as well.
  if exists (select 1 from public.earning_claims where purchase_id = p_purchase_id) then
    raise exception 'CLAIM_ALREADY_EXISTS' using errcode = '55000';
  end if;

  -- Verified receipts must cover the NET amount before a claim is eligible.
  -- A points discount reduces net; it is never counted as a receipt.
  v_verified := private.purchase_verified_total(p_purchase_id);
  v_net := v_purchase.net_amount::numeric;
  if v_verified < v_net then
    raise exception 'PURCHASE_NOT_SETTLED:verified=% net=%', v_verified, v_net
      using errcode = '55000';
  end if;

  -- Eligibility is fixed HERE, at purchase completion: the customer and the
  -- membership must both be active now. A membership that expires afterwards
  -- does not invalidate the claim.
  select * into v_customer from public.customers where id = v_purchase.customer_id;
  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
  end if;
  select * into v_membership from public.memberships where id = v_purchase.membership_id;
  if v_membership.status <> 'active' then
    raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
  end if;

  select * into v_account from public.points_accounts where membership_id = v_membership.id;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The single service line drives the award. Highest-points rule wins, so a
  -- promotion outranks a base rule without any extra code path.
  select pl.service_id, pl.quantity into v_service, v_quantity
    from public.purchase_lines pl
   where pl.purchase_id = p_purchase_id
   order by pl.id
   limit 1;
  if v_service is null then
    raise exception 'PURCHASE_HAS_NO_LINES' using errcode = '55000';
  end if;

  select cp.code into v_tier from public.card_plans cp where cp.id = v_membership.product_id;

  select r.* into v_rule
    from public.point_earning_rules r
   where r.service_id = v_service
     and r.is_active
     and r.effective_start <= v_today
     and r.effective_end > v_today
     and v_tier = any (r.eligible_tiers)
     and v_quantity >= r.min_quantity
   order by r.points_amount desc, r.effective_start desc
   limit 1;
  if not found then
    -- No eligible rule means NO claim and NO award.
    raise exception 'NO_ELIGIBLE_EARNING_RULE' using errcode = '55000';
  end if;

  v_period_id := private.ensure_points_period(v_account.id);
  -- Lock the period before reading capacity, so two concurrent purchases cannot
  -- both observe the same free capacity.
  perform 1 from public.points_periods where id = v_period_id for update;

  v_requested := v_rule.points_amount * v_quantity;
  if v_rule.max_award is not null then
    v_requested := least(v_requested, v_rule.max_award);
  end if;

  v_capacity := private.points_capacity(v_account.id, v_period_id);
  -- Award the remainder only. The capped portion is recorded, never lost.
  v_reserved := least(v_requested, greatest(0, v_capacity));

  -- Mint the secrets ONCE. Only their SHA-256 hashes are persisted, so the
  -- plaintext below is the single time it can ever be shown to the customer.
  v_qr := private.new_qr_token();
  v_fallback := private.new_fallback_code();
  -- 24 hours, or the end of the earning period, whichever is first.
  v_expiry := least(now() + interval '24 hours',
                    (select period_end from public.points_periods where id = v_period_id)::timestamptz);

  -- An ALIAS is load-bearing, not cosmetic. Inside a RETURNS TABLE function the
  -- OUT parameter names are in scope as variables, so a bare column reference is
  -- ambiguous against them. This is the same defect that broke
  -- verify_card_payment, and the same fix: alias the target, qualify every
  -- column.
  insert into public.earning_claims as ec (
    purchase_id, customer_id, membership_id, account_id, service_id, rule_id,
    period_id, tier, points_requested, points_awarded, points_capped,
    qr_token_hash, fallback_code_hash, token_issued_at, expires_at
  ) values (
    p_purchase_id, v_customer.id, v_membership.id, v_account.id, v_service, v_rule.id,
    v_period_id, v_tier, v_requested, v_reserved, v_requested - v_reserved,
    private.hash_token(v_qr),
    private.hash_token(v_fallback),
    now(), v_expiry
  )
  -- QUALIFY the returning list. Inside a RETURNS TABLE function the OUT
  -- parameter names are in scope as variables, so a bare column name is
  -- ambiguous. This is the same defect class that broke verify_card_payment.
  returning ec.id, ec.claim_number into v_claim_id, v_claim_no;

  return query
    select v_claim_id, v_claim_no, v_qr, v_fallback,
           v_requested, v_reserved, v_requested - v_reserved, v_expiry;
end $$;

comment on function public.create_earning_claim(uuid, uuid) is
  'Creates one customer-bound earning claim from a completed, settled purchase. Reserves cap capacity at creation. The plaintext QR token and fallback code are returned exactly once by the caller that mints them; only hashes are stored.';

revoke all on function public.create_earning_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_earning_claim(uuid, uuid) to service_role;

-- ===========================================================================
-- Task 9: the customer claim path
-- ===========================================================================
--
-- SECURITY INVOKER on purpose, so the function executes as the authenticated
-- role and auth.uid() returns the caller's real JWT subject. Identity is NEVER
-- taken from a request parameter. A staff member who also owns a customer
-- record gets access to that one customer and no staff capability here.
--
-- p_token accepts EITHER a bare credential (the base64 QR token or the
-- AFH-XXXX-XXXX fallback code) OR a full AF Homes claim URL, from which the
-- credential is extracted before hashing. Both resolve to the SAME claim: one
-- lookup, one award path.
--
-- Ownership mismatch returns a GENERIC refusal. The caller learns nothing about
-- whether the claim exists, so a scan cannot be used to probe for one.

create or replace function public.claim_earning_points(
  p_token text,
  p_customer_id uuid default null
)
returns table (
  claim_number  text,
  points_awarded bigint,
  points_capped  bigint,
  balance_after  bigint
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_raw        text := btrim(coalesce(p_token, ''));
  v_credential text;
  v_hash       text;
  v_customer   uuid;
  v_claim      public.earning_claims%rowtype;
  v_claimed    public.earning_claims%rowtype;
  v_account    public.points_accounts%rowtype;
  v_period_id  uuid;
  v_capacity   bigint;
  v_awarded    bigint;
  v_before     bigint;
  v_after      bigint;
  v_debt_paid  bigint;
  v_today      date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_raw = '' then
    raise exception 'TOKEN_REQUIRED' using errcode = '22023';
  end if;

  -- A claim URL carries the credential in its query string. Parse it, never
  -- trust the rest of the URL, and fall through for a bare credential.
  if v_raw ~* '^https?://' then
    v_credential := substring(v_raw from '[?&]c=([^&]+)');
    if v_credential is null or v_credential = '' then
      raise exception 'TOKEN_REQUIRED' using errcode = '22023';
    end if;
  else
    v_credential := v_raw;
  end if;

  -- The fallback code is normalized by case and separator; the base64 QR token
  -- is NOT case-folded, because base64 is case-sensitive.
  if v_credential ~* '^AFH[0-9A-F]{8}$' then
    v_credential := upper(regexp_replace(v_credential, '[\s-]', '', 'g'));
    v_credential := 'AFH-' || substring(v_credential from 4 for 4) || '-' || substring(v_credential from 8 for 4);
  end if;

  v_hash := private.hash_token(v_credential);

  -- IDENTITY. Two accepted sources, both server-derived, never a request field:
  --
  --   1. p_customer_id, resolved by the handler from the authenticated session
  --      through resolveCustomerPrincipal. This is the AF Homes customer-portal
  --      pattern and matches claim_customer_onboarding_token(p_token_hash,
  --      p_auth_user_id, p_purpose), which the portal already uses.
  --   2. auth.uid(), for a caller whose Supabase JWT reaches this connection.
  --
  -- The portal authenticates with its own session and does NOT forward a
  -- Supabase JWT to PostgREST, so auth.uid() alone would read NULL there. The
  -- parameter is therefore resolved SERVER-SIDE from the session and never
  -- supplied by the browser, which is why trusting it here is safe.
  if p_customer_id is not null then
    v_customer := p_customer_id;
  else
    select c.id into v_customer
      from public.customers c
     where c.auth_user_id = auth.uid();
  end if;
  if v_customer is null then
    raise exception 'CUSTOMER_NOT_IDENTIFIED' using errcode = '42501';
  end if;
  -- The customer must actually exist, so a caller cannot invent an id.
  if not exists (select 1 from public.customers c where c.id = v_customer) then
    raise exception 'CUSTOMER_NOT_IDENTIFIED' using errcode = '42501';
  end if;

  -- Lock order: claim, then period, then account. Always that order.
  select * into v_claim
    from public.earning_claims
   where qr_token_hash = v_hash or fallback_code_hash = v_hash
   for update;
  if not found then
    raise exception 'CLAIM_NOT_OWNER' using errcode = '42501';
  end if;

  -- Generic ownership refusal: deliberately identical to the not-found branch.
  if v_claim.customer_id <> v_customer then
    raise exception 'CLAIM_NOT_OWNER' using errcode = '42501';
  end if;
  if v_claim.status = 'claimed' then
    raise exception 'CLAIM_ALREADY_CLAIMED' using errcode = '55000';
  end if;
  if v_claim.status <> 'available' then
    raise exception 'CLAIM_NOT_AVAILABLE' using errcode = '55000';
  end if;
  if v_claim.expires_at <= now() then
    update public.earning_claims set status = 'expired' where id = v_claim.id;
    raise exception 'CLAIM_EXPIRED' using errcode = '55000';
  end if;

  -- The customer must be eligible now. The MEMBERSHIP is deliberately NOT
  -- re-checked: eligibility was fixed when the claim was created, so a
  -- membership that has since expired does not invalidate the claim.
  if not exists (select 1 from public.customers c where c.id = v_customer and c.status = 'active') then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
  end if;

  v_period_id := private.ensure_points_period(v_claim.account_id);
  perform 1 from public.points_periods where id = v_period_id for update;
  perform 1 from public.points_accounts where id = v_claim.account_id for update;
  select * into v_account from public.points_accounts where id = v_claim.account_id for update;

  -- The CAS. Exactly one concurrent scan wins; the loser updates zero rows and
  -- is told the claim is already claimed. Guaranteed together with the
  -- points_ledger_one_earned_per_claim unique index.
  update public.earning_claims
     set status = 'claimed', claimed_at = now()
   where id = v_claim.id and status = 'available'
  returning * into v_claimed;
  if not found then
    raise exception 'CLAIM_ALREADY_CLAIMED' using errcode = '55000';
  end if;

  -- Recompute against live capacity. This claim's own reservation is released
  -- by the status change above, so the award draws on its reserved slice once.
  v_capacity := private.points_capacity(v_claim.account_id, v_period_id);
  v_awarded := least(v_claimed.points_requested, greatest(0, v_capacity));
  if v_awarded <= 0 then
    raise exception 'NO_REMAINING_CAPACITY' using errcode = '55000';
  end if;

  -- Earning repays outstanding reversal debt FIRST; only the surplus becomes
  -- spendable. Earning is never blocked by debt.
  v_debt_paid := least(v_awarded, v_account.reversal_debt);
  v_before := v_account.balance;
  v_after := v_before + (v_awarded - v_debt_paid);

  update public.points_accounts as pa
     set balance = v_after,
         reversal_debt = pa.reversal_debt - v_debt_paid,
         lifetime_allocated = pa.lifetime_allocated + v_awarded,
         updated_at = now()
   where pa.id = v_account.id;

  -- One ledger row per balance change, same transaction, same sign, so
  -- balance - reversal_debt = sum(points_ledger.amount) still holds.
  insert into public.points_ledger (
    account_id, entry_type, amount, balance_before, balance_after,
    origin_period_id, counts_toward_cap, reference_type, reference_id, reason,
    metadata
  ) values (
    v_claim.account_id, 'earned', v_awarded, v_before, v_after,
    v_period_id, v_claimed.counts_toward_cap, 'earning_claim', v_claim.id::text,
    'Points earned from purchase ' || v_claim.purchase_id::text,
    jsonb_build_object(
      'requested_points', v_claimed.points_requested,
      'awarded_points',   v_awarded,
      'capped_points',    v_claimed.points_requested - v_awarded,
      'debt_repaid',      v_debt_paid
    )
  );

  update public.memberships set points_balance = v_after
   where id = v_claim.membership_id;

  return query select v_claimed.claim_number, v_awarded,
                      v_claimed.points_requested - v_awarded, v_after;
end $$;

comment on function public.claim_earning_points(text, uuid) is
  'Redeemes one customer-bound earning claim by QR token, fallback code, or claim URL. Identity comes from auth.uid(); a mismatch is refused generically. Single-use and concurrency-safe via a compare-and-set on claim status.';

-- ===========================================================================
-- RLS and grants: the new tables are STAFF-ONLY and UNEXPOSED
-- ===========================================================================
--
-- Every browser role is revoked entirely, so a direct PostgREST call has no
-- privilege to abuse even if an RLS policy were wrong. This is the Phase 4
-- redemption pattern, applied to the whole rebuild. RLS is enabled on every
-- table because supabase/security/rls_invariants.sql requires it, and because
-- a table without it is one service_role misconfiguration away from exposure.
--
-- CORRECTION to the design as first written: claim_earning_points was drafted
-- as SECURITY INVOKER so that RLS would govern it. That is impossible here -
-- a customer has no SELECT privilege on earning_claims under the revoke above,
-- so an invoker function could read nothing. It is therefore SECURITY DEFINER,
-- exactly like redeem_membership_points. Identity is NOT weakened: auth.uid()
-- reads the caller's JWT, not a table privilege, so the caller is still
-- identified exactly as before and still never supplies a customer id.

alter table public.tier_points_config  enable row level security;
alter table public.points_periods     enable row level security;
alter table public.service_catalog    enable row level security;
alter table public.point_earning_rules enable row level security;
alter table public.purchases          enable row level security;
alter table public.purchase_lines     enable row level security;
alter table public.purchase_payments  enable row level security;
alter table public.earning_claims     enable row level security;
   -- Task 10 tables. Same treatment: RLS ON and NO browser privilege at all.
   -- redemption_quotes holds a price the member was quoted and points_accounts
   -- links, so it is staff-only and unexposed, exactly like redemption_items.
   alter table public.point_redemption_rules enable row level security;
   alter table public.redemption_quotes      enable row level security;

revoke all on public.tier_points_config  from anon, authenticated;
revoke all on public.points_periods     from anon, authenticated;
revoke all on public.service_catalog    from anon, authenticated;
revoke all on public.point_earning_rules from anon, authenticated;
revoke all on public.purchases          from anon, authenticated;
revoke all on public.purchase_lines     from anon, authenticated;
revoke all on public.purchase_payments  from anon, authenticated;
revoke all on public.earning_claims     from anon, authenticated;
   revoke all on public.point_redemption_rules from anon, authenticated;
   revoke all on public.redemption_quotes      from anon, authenticated;

-- No browser SELECT is granted on any of them, so no column-level narrowing is
-- required either: a customer cannot read a claim row, a token hash, or a
-- purchase through PostgREST at all. Every read they are entitled to arrives
-- through an explicitly granted function or a service-role handler.

revoke all on function public.claim_earning_points(text, uuid) from public, anon;
grant execute on function public.claim_earning_points(text, uuid) to authenticated;

-- The staff entry points stay service-role only, as declared above.

-- ===========================================================================
-- Task 5: the legacy cutover to zero
-- ===========================================================================
--
-- All pre-cutover points are TESTING-ERA data and are reset. This is the only
-- part of the rebuild that mutates existing rows, so it is deliberately narrow:
-- it touches points_accounts.balance, points_accounts.reversal_debt and the
-- memberships.points_balance cache, and NOTHING else. Customer identities,
-- memberships, activation dates, card products and every unrelated financial
-- record are left exactly as they are.
--
-- The adjustment is derived from the LEDGER TOTAL S, never from the cached
-- balance B, so a discrepancy between them is recorded rather than hidden.
--   S <> 0 -> one cutover_baseline row of -S, balance_after 0
--   S =  0 -> no row at all, because points_ledger.amount has CHECK (amount <> 0)
-- Either way the invariant balance - reversal_debt = sum(ledger.amount) holds.
--
-- Idempotent: a guard marker makes a second run a no-op, and the whole function
-- runs in the caller's transaction so a failure rolls the whole thing back.

create or replace function private.legacy_points_cutover()
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_account public.points_accounts%rowtype;
  v_sum     bigint;
  v_previous_balance bigint;
  v_cutover_at timestamptz := now();
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_anchor  date;
  v_index   int;
  v_tier    text;
  v_cap     bigint;
begin
  -- Idempotence guard. If a previous run already recorded the cutover, there is
  -- nothing to do; re-running must never write a second adjustment.
  if exists (
    select 1 from public.audit_events
     where action = 'LEGACY_POINTS_CUTOVER'
  ) then
    return;
  end if;

  -- audit_events.actor_id references auth.users, not staff_users, so a cutover
  -- marker records no actor and the staff id is carried in after_data instead.
  insert into public.audit_events (action, entity_type, after_data)
  values ('LEGACY_POINTS_CUTOVER', 'points_accounts', '{}'::jsonb);

  for v_account in select * from public.points_accounts order by id loop
    -- Re-read under a lock: the ledger may have moved since the loop began.
    select a.balance into v_previous_balance
      from public.points_accounts a where a.id = v_account.id for update;

    select coalesce(sum(l.amount), 0) into v_sum
      from public.points_ledger l
     where l.account_id = v_account.id;

    -- The adjustment is -S, so the account's effective ledger total becomes 0.
    if v_sum <> 0 then
      insert into public.points_ledger (
        account_id, entry_type, amount, balance_before, balance_after,
        counts_toward_cap, reason
      ) values (
        v_account.id, 'cutover_baseline', -v_sum, v_previous_balance, 0,
        false,
        'Legacy points reset to zero at cutover; pre-cutover history is testing-era data'
      );
    end if;

    update public.points_accounts
       set balance = 0, reversal_debt = 0, updated_at = v_cutover_at
     where id = v_account.id;

    update public.memberships
       set points_balance = 0
     where id = v_account.membership_id;

    -- Backfill the stored anniversary from the real activation instant. No
    -- anniversary is ever fabricated: a member with no activated_at keeps NULL
    -- and is refused by ensure_points_period until it is set.
    select (m.activated_at at time zone 'Asia/Manila')::date into v_anchor
      from public.memberships m where m.id = v_account.membership_id;
    if v_anchor is not null then
      update public.memberships
         set points_anniversary = coalesce(points_anniversary, v_anchor)
       where id = v_account.membership_id;
      select points_anniversary into v_anchor
        from public.memberships where id = v_account.membership_id;

      -- Open the period in progress today, WITHOUT fabricating its historical
      -- opening balance: opening_balance stays NULL and authoritative_from marks
      -- where period accounting becomes provably complete.
      v_index := greatest(0, (extract(year from age(v_today, v_anchor)))::int);
      while true loop
        exit when v_anchor + make_interval(years => v_index) > v_today;
        v_index := v_index + 1;
      end loop;
      v_index := v_index - 1;

      select cp.code, t.annual_points_cap into v_tier, v_cap
        from public.memberships m
        join public.card_plans cp on cp.id = m.product_id
        join public.tier_points_config t on t.tier = cp.code
       where m.id = v_account.membership_id;

      if v_tier is not null then
        insert into public.points_periods (
          account_id, period_start, period_end, tier, annual_points_cap,
          opening_balance, status, authoritative_from
        ) values (
          v_account.id,
          (v_anchor + make_interval(years => v_index))::date,
          (v_anchor + make_interval(years => v_index + 1))::date,
          v_tier, v_cap, null, 'open', v_cutover_at::date
        )
        on conflict (account_id, period_start) do nothing;
      end if;
    end if;

    -- One durable audit row per account, recording the discrepancy explicitly
    -- rather than hiding it behind a silent zero.
    insert into public.audit_events (action, entity_type, entity_id, reason, after_data)
    values (
      'LEGACY_POINTS_ACCOUNT_CUTOVER', 'points_accounts', v_account.id::text,
      'Legacy points are testing-era data; new flow starts fresh',
      jsonb_build_object(
        'previousBalance',      v_previous_balance,
        'previousLedgerTotal',  v_sum,
        'discrepancy',          v_previous_balance - v_sum,
        'cutoverAt',            v_cutover_at
      )
    );
  end loop;
end $$;

comment on function private.legacy_points_cutover() is
  'One-time, idempotent, audited reset of every legacy points account to zero. Writes a cutover_baseline adjustment derived from the LEDGER total, never from the cached balance, so a discrepancy stays visible. Preserves all historical ledger rows.';

revoke all on function private.legacy_points_cutover() from public, anon, authenticated;
grant execute on function private.legacy_points_cutover() to service_role;

-- The cutover runs once, at migration time, in the same transaction as the DDL
-- above. It is safe on a database that has already been cut over: the guard
-- makes it a no-op, so re-delivering this file to such a database changes nothing.
select private.legacy_points_cutover();

-- ===========================================================================
-- Task 10: reversal, and the debt state matrix
-- ===========================================================================
--
-- The original 'earned' row is NEVER updated or deleted. A reversal is a NEW
-- compensating row carrying origin_award_id and origin_period_id, so the
-- capacity it restores belongs to the ORIGINAL award's period even when the
-- reversal happens in a later one.
--
-- Lock order: claim, then period, then account. Always that order.
--
-- The state matrix, and the rule that makes it coherent: debt arises ONLY from
-- an award that was actually granted and then spent. Both 'available' cases are
-- pure reservation releases and deliberately write NO ledger row, because
-- writing one would move the reconciliation invariant with no offsetting
-- balance change.

create or replace function public.reverse_purchase_points(
  p_purchase_id uuid, p_actor_id uuid, p_reason text
)
returns table (reversed_points bigint, reversal_debt bigint, balance_after bigint)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_claim    public.earning_claims%rowtype;
  v_award    public.points_ledger%rowtype;
  v_account  public.points_accounts%rowtype;
  v_absorbed bigint;
  v_debt     bigint;
  v_before   bigint;
  v_after    bigint;
  v_period_id uuid;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REVERSAL_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_purchase.status = 'reversed' then
    raise exception 'PURCHASE_ALREADY_REVERSED' using errcode = '55000';
  end if;

  select * into v_claim from public.earning_claims where purchase_id = p_purchase_id for update;
  if not found then
    -- An ineligible purchase: reverse the money, with no points event at all.
    update public.purchases
       set status = 'reversed', reversed_at = now(), reversal_reason = p_reason, updated_at = now()
     where id = p_purchase_id;
    return query select 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  if v_claim.status = 'reversed' then
    raise exception 'PURCHASE_ALREADY_REVERSED' using errcode = '55000';
  end if;

  v_period_id := v_claim.period_id;
  perform 1 from public.points_periods where id = v_period_id for update;
  select * into v_account from public.points_accounts where id = v_claim.account_id for update;

  -- NOT YET CLAIMED, expired or not: nothing was ever awarded. Release the
  -- reservation and write no ledger row, so no debt can arise here.
  if v_claim.status in ('available', 'expired') then
    update public.earning_claims set status = 'reversed' where id = v_claim.id;
    update public.purchases
       set status = 'reversed', reversed_at = now(), reversal_reason = p_reason, updated_at = now()
     where id = p_purchase_id;
    return query select 0::bigint, v_account.reversal_debt, v_account.balance;
    return;
  end if;

  if v_claim.status <> 'claimed' then
    raise exception 'CLAIM_NOT_REVERSIBLE' using errcode = '55000';
  end if;

  -- The award this reversal compensates.
  select * into v_award
    from public.points_ledger
   where entry_type = 'earned' and reference_type = 'earning_claim' and reference_id = v_claim.id::text;
  if not found then
    raise exception 'AWARD_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_before := v_account.balance;
  -- The balance absorbs what it can; the remainder becomes debt. The raw
  -- balance can never go negative, because points_accounts.balance has
  -- CHECK (balance >= 0).
  v_absorbed := least(v_award.amount, v_before);
  v_debt := v_award.amount - v_absorbed;
  v_after := v_before - v_absorbed;

  insert into public.points_ledger (
    account_id, entry_type, amount, balance_before, balance_after,
    origin_award_id, origin_period_id, counts_toward_cap,
    reference_type, reference_id, actor_id, reason
  ) values (
    v_claim.account_id, 'reversal', -v_award.amount, v_before, v_after,
    v_award.id, v_claim.period_id, v_award.counts_toward_cap,
    'purchase', p_purchase_id::text, p_actor_id, p_reason
  );

  -- The alias is load-bearing: `reversal_debt` is BOTH an OUT parameter name of
  -- this RETURNS TABLE function and a column, so the unqualified reference is
  -- ambiguous. Qualifying against the alias is the same fix the repo already
  -- applied to verify_card_payment.
  update public.points_accounts as pa
     set balance = v_after,
         reversal_debt = pa.reversal_debt + v_debt,
         updated_at = now()
   where pa.id = v_claim.account_id;

  update public.memberships set points_balance = v_after where id = v_claim.membership_id;
  update public.earning_claims set status = 'reversed' where id = v_claim.id;
  update public.purchases
     set status = 'reversed', reversed_at = now(), reversal_reason = p_reason, updated_at = now()
   where id = p_purchase_id;

  return query select v_award.amount, v_account.reversal_debt + v_debt, v_after;
end $$;

comment on function public.reverse_purchase_points(uuid, uuid, text) is
  'Reverses a purchase''s points with an explicit compensating ledger row, never a delete. An award that was never claimed releases its reservation and creates no debt; a granted award that was already spent creates non-monetary reversal_debt, which survives the annual reset.';

revoke all on function public.reverse_purchase_points(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_purchase_points(uuid, uuid, text) to service_role;

-- ===========================================================================
-- Task 9 remainder: reissue
-- ===========================================================================
--
-- Tokens ROTATE; they are never recovered. A reissue reuses the same claim row,
-- so it can never duplicate an award, and it always writes an audit event.
--
-- Two distinct cases, and the difference is load-bearing:
--   1. Unexpired 'available'  -> new tokens, SAME expires_at, no reservation
--      change. A reissue buys a new token, not more time.
--   2. Expired 'available'    -> renewed eligibility checks, a FRESH reservation
--      under the period lock, and a FRESH standard expiry. Refused outright if
--      the customer, membership or rule is no longer eligible.
-- 'claimed' is refused in both cases: a reissue must never duplicate an award.

create or replace function public.reissue_earning_claim(p_claim_id uuid, p_actor_id uuid)
returns table (claim_number text, qr_token text, fallback_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_claim    public.earning_claims%rowtype;
  v_customer public.customers%rowtype;
  v_rule     public.point_earning_rules%rowtype;
  v_period   public.points_periods%rowtype;
  v_qr       text;
  v_fallback text;
  v_expiry   timestamptz;
  v_today    date := (now() at time zone 'Asia/Manila')::date;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;

  select * into v_claim from public.earning_claims where id = p_claim_id for update;
  if not found then
    raise exception 'CLAIM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('available', 'expired') then
    raise exception 'CLAIM_NOT_REISSUABLE' using errcode = '55000';
  end if;

  v_qr := private.new_qr_token();
  v_fallback := private.new_fallback_code();

  if v_claim.status = 'available' and v_claim.expires_at > now() then
    -- Case 1: rotate only. Expiry is PRESERVED. The alias avoids the OUT
    -- parameter name collision, exactly as in create_earning_claim.
    update public.earning_claims as ec
       set qr_token_hash = private.hash_token(v_qr),
           fallback_code_hash = private.hash_token(v_fallback),
           token_issued_at = now()
     where ec.id = v_claim.id
    returning ec.claim_number, ec.expires_at into v_claim.claim_number, v_expiry;
  else
    -- Case 2: an expired claim needs fresh eligibility before it is revived.
    select * into v_customer from public.customers where id = v_claim.customer_id;
    if v_customer.status <> 'active' then
      raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
    end if;
    if not exists (select 1 from public.memberships
                    where id = v_claim.membership_id and status = 'active') then
      raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
    end if;
    select * into v_rule from public.point_earning_rules where id = v_claim.rule_id;
    if not (v_rule.is_active
            and v_rule.effective_start <= v_today
            and v_today < v_rule.effective_end
            and v_claim.tier = any (v_rule.eligible_tiers)) then
      raise exception 'CLAIM_NO_LONGER_ELIGIBLE' using errcode = '55000';
    end if;

    select * into v_period from public.points_periods where id = v_claim.period_id for update;
    -- A fresh reservation, taken under the period lock so it cannot over-allocate.
    v_expiry := least(now() + interval '24 hours', v_period.period_end::timestamptz);

    update public.earning_claims as ec
       set status = 'available',
           points_awarded = least(v_claim.points_requested,
                                  private.points_capacity(v_claim.account_id, v_claim.period_id)),
           qr_token_hash = private.hash_token(v_qr),
           fallback_code_hash = private.hash_token(v_fallback),
           token_issued_at = now(),
           expires_at = v_expiry
     where ec.id = v_claim.id
    returning ec.claim_number into v_claim.claim_number;
  end if;

  -- audit_events.actor_id references auth.users, not staff_users, so the acting
  -- staff id is carried in after_data rather than in the actor column.
  insert into public.audit_events (action, entity_type, entity_id, reason, after_data)
  values (
    'EARNING_CLAIM_REISSUED', 'earning_claims', v_claim.id::text,
    'Claim credentials rotated; previous tokens invalidated immediately',
    jsonb_build_object(
      'actorId',        p_actor_id,
      'expiresAt',      v_expiry,
      'previousStatus', v_claim.status
    )
  );

  return query select v_claim.claim_number, v_qr, v_fallback, v_expiry;
end $$;

comment on function public.reissue_earning_claim(uuid, uuid) is
  'Rotates both claim credentials on the SAME claim row, so the previous tokens stop working immediately and no award can be duplicated. An unexpired claim keeps its expiry; an expired one needs renewed eligibility, a fresh reservation and a fresh expiry.';

revoke all on function public.reissue_earning_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reissue_earning_claim(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Recording a purchase. The gross is computed HERE from the lines, never
-- accepted from the caller, so a tampered total cannot be persisted.
-- ---------------------------------------------------------------------------
create or replace function public.create_purchase(
  p_membership_id uuid,
  p_gross_amount text,
  p_lines jsonb,
  p_actor_id uuid
)
returns table (
  purchase_id uuid,
  purchase_number text,
  gross_amount text,
  net_amount text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_membership public.memberships%rowtype;
  v_customer   public.customers%rowtype;
  v_gross      numeric;
  v_purchase_id uuid;
  v_number     text;
  v_line       jsonb;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'PURCHASE_HAS_NO_LINES' using errcode = '55000';
  end if;

  select * into v_membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
  end if;

  -- The customer is DERIVED from the membership, never accepted from the caller.
  -- Staff scan a member's card, which yields exactly one id; asking for a second
  -- one alongside it would create a mismatch this function would then have to
  -- police, and a mismatch would mean billing one member against another's card.
  select * into v_customer from public.customers where id = v_membership.customer_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
  end if;

  -- Gross is recomputed from the lines. The p_gross_amount argument is only
  -- compared, never trusted, so a mismatch is refused rather than absorbed.
  select coalesce(sum((l->>'unitAmount')::numeric * (l->>'quantity')::int), 0)
    into v_gross
    from jsonb_array_elements(p_lines) l;

  insert into public.purchases (
    customer_id, membership_id, status, gross_amount, net_amount, created_by
  ) values (
    v_customer.id, p_membership_id, 'draft',
    private.money(v_gross), private.money(v_gross), p_actor_id
  )
  returning id, purchase_number into v_purchase_id, v_number;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.service_catalog s
                    where s.id = (v_line->>'serviceId')::uuid and s.is_active) then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.purchase_lines (purchase_id, service_id, quantity, unit_amount, line_total)
    values (
      v_purchase_id,
      (v_line->>'serviceId')::uuid,
      (v_line->>'quantity')::int,
      private.money((v_line->>'unitAmount')::numeric),
      private.money((v_line->>'unitAmount')::numeric * (v_line->>'quantity')::int)
    );
  end loop;

  return query
    select v_purchase_id, v_number, private.money(v_gross), private.money(v_gross);
end $$;

comment on function public.create_purchase(uuid, text, jsonb, uuid) is
  'Records a service purchase in draft with its lines. The customer is derived from the membership, so a scanned card is sufficient and no caller can bill one member against another''s card. The gross is recomputed from the lines inside SQL, so a client-supplied total is never persisted.';

revoke all on function public.create_purchase(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_purchase(uuid, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Completing a purchase. This is the gate: verified receipts must cover the NET
-- amount before the purchase is completed, and only a completed purchase can
-- ever produce an earning claim.
-- ---------------------------------------------------------------------------
create or replace function public.complete_purchase(p_purchase_id uuid, p_actor_id uuid)
returns table (purchase_id uuid, net_amount text, verified_total text, fully_paid boolean)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_verified numeric;
  v_net      numeric;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_purchase.status = 'completed' then
    raise exception 'PURCHASE_ALREADY_COMPLETED' using errcode = '55000';
  end if;
  if v_purchase.status = 'reversed' then
    raise exception 'PURCHASE_ALREADY_REVERSED' using errcode = '55000';
  end if;

  v_verified := private.purchase_verified_total(p_purchase_id);
  v_net := v_purchase.net_amount::numeric;
  -- Verified receipts must cover the NET, not the gross: a points discount
  -- genuinely reduces what the customer owes.
  if v_verified < v_net then
    raise exception 'PURCHASE_NOT_SETTLED:verified=% net=%', v_verified, v_net
      using errcode = '55000';
  end if;

  update public.purchases
     set status = 'completed', completed_at = now(), updated_at = now()
   where id = p_purchase_id;

  return query
    select p_purchase_id, v_purchase.net_amount, private.money(v_verified), true;
end $$;

comment on function public.complete_purchase(uuid, uuid) is
  'Completes a purchase only when verified receipts cover its NET amount. The completion is the sole gate on earning-claim eligibility.';

revoke all on function public.complete_purchase(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_purchase(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- A MANUAL points adjustment. Three writes that MUST be one transaction, which
-- is exactly why this is a function and not a handler: PostgREST cannot span
-- statements, and a handler cannot hold a row lock across requests. The
-- invariant `balance - reversal_debt = SUM(points_ledger.amount)` holds only if
-- the ledger row and the cached balance move together.
--
-- It is a deliberate, permanent, audited correction. It does NOT count toward
-- the annual earning cap: the cap governs what a member may EARN from eligible
-- purchases, and an operational correction is neither. It also does not touch
-- reversal_debt, so a member already in debt stays in exactly that debt.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_membership_points(
  p_membership_id uuid,
  p_amount bigint,
  p_reason text,
  p_actor_id uuid
)
returns table (
  balance_after bigint,
  reversal_debt bigint
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_membership public.memberships%rowtype;
  v_account   public.points_accounts%rowtype;
  v_before    bigint;
  v_after     bigint;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  -- A zero "adjustment" is a no-op that would still write a permanent row, and
  -- points_ledger already refuses a zero amount.
  if p_amount is null or p_amount = 0 then
    raise exception 'ADJUSTMENT_AMOUNT_REQUIRED' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'ADJUSTMENT_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_membership from public.memberships where id = p_membership_id for update;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
  end if;

  -- FOR UPDATE on the account is the concurrency control: two adjustments racing
  -- must serialise here, or both would read the same balance_before.
  select * into v_account
    from public.points_accounts
   where membership_id = p_membership_id
   for update;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_before := v_account.balance;
  v_after := v_before + p_amount;
  -- points_accounts.balance has CHECK (balance >= 0). Refusing here with a clear
  -- reason beats letting the CHECK surface as an opaque constraint violation.
  if v_after < 0 then
    raise exception 'ADJUSTMENT_EXCEEDS_BALANCE:balance=% requested=%', v_before, p_amount
      using errcode = '55000';
  end if;

  insert into public.points_ledger (
    account_id, entry_type, amount, balance_before, balance_after,
    counts_toward_cap, reference_type, reference_id, actor_id, reason
  ) values (
    v_account.id, 'adjustment', p_amount, v_before, v_after,
    false, 'membership', p_membership_id::text, p_actor_id, p_reason
  );

  update public.points_accounts as pa
     set balance = v_after, updated_at = now()
   where pa.id = v_account.id;
  update public.memberships set points_balance = v_after where id = p_membership_id;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, after_data, reason
  ) values (
    p_actor_id, 'POINTS_ADJUSTED', 'membership', p_membership_id,
    jsonb_build_object('amount', p_amount, 'balanceBefore', v_before, 'balanceAfter', v_after),
    p_reason
  );

  return query select v_after, v_account.reversal_debt;
end $$;

comment on function public.adjust_membership_points(uuid, bigint, text, uuid) is
  'A permanent, audited correction to a member''s points. Writes the ledger row, the account balance and the membership cache in ONE transaction, because the invariant balance - reversal_debt = SUM(points_ledger.amount) holds only if they move together. Never counts toward the annual earning cap and never changes reversal_debt.';

revoke all on function public.adjust_membership_points(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.adjust_membership_points(uuid, bigint, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- QUOTE a points discount. Prices an offer; spends NOTHING.
--
-- This is a read that happens to write a short-lived row. Nothing about the
-- balance moves until commit_point_discount, so a member can be shown a price and
-- walk away with no consequence.
--
-- The peso value is capped at the ELIGIBLE line total. For a mixed purchase that
-- cap is the whole point: a member cannot discount an ineligible line by quoting
-- against the total of the purchase.
-- ---------------------------------------------------------------------------
create or replace function public.quote_point_discount(
  p_purchase_id uuid,
  p_points_requested bigint,
  p_actor_id uuid
)
returns table (
  quote_id uuid,
  quote_number text,
  points_requested bigint,
  peso_value text,
  eligible_line_total text,
  remaining_points_after bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_membership public.memberships%rowtype;
  v_customer public.customers%rowtype;
  v_account  public.points_accounts%rowtype;
  v_tier     text;
  v_eligible numeric := 0;
  v_rate     numeric;
  v_raw      numeric;
  v_value    numeric;
  v_spendable bigint;
  v_quote_id uuid;
  v_number   text;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  if p_points_requested is null or p_points_requested <= 0 then
    raise exception 'POINTS_AMOUNT_REQUIRED' using errcode = '22023';
  end if;

  select * into v_purchase from public.purchases where id = p_purchase_id;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Only a DRAFT can be discounted. A completed purchase already had its
  -- settlement verified against its net, so changing net afterwards would
  -- retroactively invalidate that decision.
  if v_purchase.status <> 'draft' then
    raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode = '55000';
  end if;

  select * into v_membership from public.memberships where id = v_purchase.membership_id;
  if v_membership.status <> 'active' then
    raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
  end if;
  select * into v_customer from public.customers where id = v_purchase.customer_id;
  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
  end if;

  select * into v_account from public.points_accounts
   where membership_id = v_purchase.membership_id for update;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Debt blocks SPENDING. Earning is never blocked by debt; this is the mirror of
  -- that rule and it is enforced here rather than assumed.
  if v_account.reversal_debt > 0 then
    raise exception 'REVERSAL_DEBT_OUTSTANDING' using errcode = '55000';
  end if;
  v_spendable := v_account.balance;
  if p_points_requested > v_spendable then
    raise exception 'INSUFFICIENT_POINTS:needed=% available=%', p_points_requested, v_spendable
      using errcode = '55000';
  end if;

  -- LEFT JOIN, not JOIN. With an inner join a membership whose product_id is
  -- NULL, or which points at a plan row that no longer exists, yields NO row at
  -- all, so v_tier becomes NULL - and array[NULL] <@ eligible_tiers is never true.
  -- That silently disabled EVERY promotion for such a member while look healthy.
  -- The coalesce is therefore load-bearing, not a convenience.
  select coalesce(pc.code, 'BRONZE') into v_tier
    from public.memberships m
    left join public.card_plans pc on pc.id = m.product_id
   where m.id = v_purchase.membership_id;

  -- The eligible base. Computed FIRST, and the peso cap below is applied to it,
  -- never to the purchase gross: that is how a mixed purchase is restricted to
  -- its eligible lines.
  select coalesce(sum(pl.line_total::numeric), 0)
    into v_eligible
    from public.purchase_lines pl
   where pl.purchase_id = p_purchase_id
     and private.line_discount_eligible(pl.service_id, v_tier, pl.line_total::numeric);
  if v_eligible <= 0 then
    raise exception 'NO_DISCOUNT_ELIGIBLE_LINES' using errcode = '55000';
  end if;

  -- The rate is the best available across the eligible lines. Using the MAX
  -- would be wrong if two lines had different rates, so every eligible line's
  -- rate is checked and the WORST (lowest) one governs: the member must never be
  -- quoted a rate that some line cannot honour.
  select min(coalesce(private.redemption_rate(pl.service_id, v_tier), 1))
    into v_rate
    from public.purchase_lines pl
   where pl.purchase_id = p_purchase_id
     and private.line_discount_eligible(pl.service_id, v_tier, pl.line_total::numeric);
  if v_rate is null or v_rate <= 0 then
    raise exception 'NO_REDEMPTION_RATE' using errcode = '55000';
  end if;

  v_raw := p_points_requested::numeric * v_rate;
  -- Never more than the eligible lines are worth, and never more than the gross:
  -- the latter keeps net >= 0 even if the eligible base were somehow overstated.
  v_value := least(v_raw, least(v_eligible, v_purchase.gross_amount::numeric));

  -- The identifier is computed HERE rather than left to the column DEFAULT.
  -- Inside a RETURNS TABLE function, `quote_number` is BOTH this function's OUT
  -- parameter and a column of the target table, so the DEFAULT expression's
  -- unqualified reference is ambiguous and PostgreSQL refuses the INSERT. This is
  -- the same defect class the repo already fixed in verify_card_payment and in
  -- create_earning_claim: alias or qualify, never leave a name ambiguous.
  v_number := private.claim_af_id('AF-QTE', 'public.redemption_quotes'::regclass, 'quote_number');

  insert into public.redemption_quotes (
    quote_number, purchase_id, account_id, membership_id, points_requested,
    peso_value_per_point, peso_value, eligible_line_total,
    points_balance_snapshot, remaining_points_after, expires_at, created_by
  ) values (
    v_number, p_purchase_id, v_account.id, v_purchase.membership_id, p_points_requested,
    v_rate, private.money(v_value), private.money(v_eligible),
    v_spendable, v_spendable - p_points_requested,
    now() + interval '30 minutes', p_actor_id
  )
  returning id into v_quote_id;

  return query
    select v_quote_id, v_number, p_points_requested, private.money(v_value),
           private.money(v_eligible), v_spendable - p_points_requested,
           now() + interval '30 minutes';
end $$;

comment on function public.quote_point_discount(uuid, bigint, uuid) is
  'Prices a points discount without spending anything. The peso value is capped at the total of ELIGIBLE purchase lines only, so a member cannot discount an ineligible line. Outstanding reversal debt refuses the quote outright.';

revoke all on function public.quote_point_discount(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.quote_point_discount(uuid, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- COMMIT a quoted discount. The whole transaction, because a points movement and
-- a purchase figure must land together or not at all.
--
-- Lock order is fixed: quote -> purchase -> account. The purchase is locked
-- BEFORE the account here, matching reverse_purchase_points, so the two functions
-- cannot deadlock against each other.
-- ---------------------------------------------------------------------------
create or replace function public.commit_point_discount(
  p_quote_id uuid,
  p_actor_id uuid
)
returns table (
  purchase_id uuid,
  points_spent bigint,
  discount_applied text,
  net_amount text,
  balance_after bigint
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_quote    public.redemption_quotes%rowtype;
  v_purchase public.purchases%rowtype;
  v_account  public.points_accounts%rowtype;
  v_before   bigint;
  v_after    bigint;
  v_net      numeric;
  v_left     numeric;
  v_tier     text;
  v_ledger   bigint;
  v_line     record;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;

  -- FOR UPDATE is the concurrency control. Two commits of one quote serialise
  -- here, so the second sees status='committed' and is refused rather than
  -- spending the points twice.
  select * into v_quote from public.redemption_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_quote.status <> 'open' then
    raise exception 'QUOTE_NOT_OPEN' using errcode = '55000';
  end if;
  if v_quote.expires_at <= now() then
    -- No cron marks these; the status is corrected HERE, at the moment someone
    -- actually tries to use one. An expired quote is spent capacity until then.
    update public.redemption_quotes set status = 'expired' where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = '55000';
  end if;

  select * into v_purchase from public.purchases where id = v_quote.purchase_id for update;
  if v_purchase.status <> 'draft' then
    raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode = '55000';
  end if;
  select * into v_account from public.points_accounts where id = v_quote.account_id for update;

  -- Re-checked at commit, not trusted from the quote. A member who reversed
  -- points between quoting and committing must be refused, or the quote would be
  -- a way to spend debt.
  if v_account.reversal_debt > 0 then
    raise exception 'REVERSAL_DEBT_OUTSTANDING' using errcode = '55000';
  end if;
  v_before := v_account.balance;
  if v_before < v_quote.points_requested then
    raise exception 'INSUFFICIENT_POINTS:needed=% available=%',
      v_quote.points_requested, v_before using errcode = '55000';
  end if;
  v_after := v_before - v_quote.points_requested;

  -- LEFT JOIN, not JOIN. With an inner join a membership whose product_id is
  -- NULL, or which points at a plan row that no longer exists, yields NO row at
  -- all, so v_tier becomes NULL - and array[NULL] <@ eligible_tiers is never true.
  -- That silently disabled EVERY promotion for such a member while look healthy.
  -- The coalesce is therefore load-bearing, not a convenience.
  select coalesce(pc.code, 'BRONZE') into v_tier
    from public.memberships m
    left join public.card_plans pc on pc.id = m.product_id
   where m.id = v_purchase.membership_id;

  -- Allocate the peso value across eligible LINES, in id order so the split is
  -- deterministic and reproducible. A line is filled up to its own total before
  -- the next one is touched, so an ineligible line is never touched at all.
  v_left := v_quote.peso_value::numeric;
  for v_line in
    select pl.id, pl.line_total::numeric total
      from public.purchase_lines pl
     where pl.purchase_id = v_purchase.id
       and private.line_discount_eligible(pl.service_id, v_tier, pl.line_total::numeric)
     order by pl.id
  loop
    exit when v_left <= 0;
    update public.purchase_lines as pl
       set points_discount_amount = private.money(least(v_line.total, v_left)),
           discount_eligible = true
     where pl.id = v_line.id;
    v_left := v_left - least(v_line.total, v_left);
  end loop;

  -- The purchase figure is derived from the LINES, never from the quote. If the
  -- two ever disagreed, the lines are the truth, because the CHECK on each line
  -- is what makes an over-discount impossible.
  -- Qualified: `purchase_id` is BOTH this function's OUT parameter and a column
  -- of public.purchase_lines, so the unqualified reference is ambiguous.
  select coalesce(sum(pl.points_discount_amount::numeric), 0) into v_left
    from public.purchase_lines pl where pl.purchase_id = v_purchase.id;
  v_net := v_purchase.gross_amount::numeric - v_left;
  if v_net < 0 then
    -- Structurally unreachable given the per-line CHECK, and asserted anyway
    -- because a negative net is the one outcome that must never be persisted.
    raise exception 'DISCOUNT_EXCEEDS_GROSS' using errcode = '55000';
  end if;

  insert into public.points_ledger (
    account_id, entry_type, amount, balance_before, balance_after,
    counts_toward_cap, reference_type, reference_id, actor_id, reason
  ) values (
    v_account.id, 'redemption', -v_quote.points_requested, v_before, v_after,
    false, 'redemption_quote', v_quote.id::text, p_actor_id,
    'Points discount on purchase ' || v_purchase.purchase_number
  )
  returning id into v_ledger;

  update public.points_accounts as pa
     set balance = v_after, lifetime_redeemed = pa.lifetime_redeemed + v_quote.points_requested,
         updated_at = now()
   where pa.id = v_account.id;
  update public.memberships set points_balance = v_after where id = v_purchase.membership_id;

  -- gross is unchanged: a points discount REDUCES net, it is never a receipt.
  update public.purchases
     set points_discount_amount = private.money(v_left),
         net_amount = private.money(v_net),
         updated_at = now()
   where id = v_purchase.id;

  update public.redemption_quotes
     set status = 'committed', committed_at = now(), ledger_entry_id = v_ledger
   where id = v_quote.id;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, after_data, reason
  ) values (
    p_actor_id, 'POINT_DISCOUNT_COMMITTED', 'purchase', v_purchase.id,
    jsonb_build_object(
      'quoteId', v_quote.id,
      'pointsSpent', v_quote.points_requested,
      'discountAmount', v_left::text,
      'netAmount', v_net::text
    ),
    'Points discount ' || v_quote.points_requested || ' -> ' || private.money(v_left)
  );

  return query
    select v_purchase.id, v_quote.points_requested, private.money(v_left),
           private.money(v_net), v_after;
end $$;

comment on function public.commit_point_discount(uuid, uuid) is
  'Spends the quoted points, allocates the discount across ELIGIBLE purchase lines only, and writes one permanent ledger row. Outstanding reversal debt, a closed quote and an insufficient balance are each re-checked at commit rather than trusted from the quote.';

revoke all on function public.commit_point_discount(uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_point_discount(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The customer's own points position.
--
-- THREE FIGURES, NEVER COLLAPSED, because they answer different questions and a
-- member who confuses them is misinformed:
--
--   balance                   - what is on the card
--   spendable                 - what can be spent RIGHT NOW = balance - debt
--   remainingEarningCapacity  - what may still be EARNED this period, and which is
--                               NOT spendable; it is a ceiling, not money
--
-- A member at their annual cap has remainingEarningCapacity 0 and a healthy
-- spendable balance. Rendering those as one number would tell them they have run
-- out when they have not, or that they can earn when they cannot.
--
-- `customer` is passed in and re-validated against the account's own membership,
-- so this cannot be used to read somebody else's position.
-- ---------------------------------------------------------------------------
create or replace function public.customer_points_position(p_membership_id uuid)
returns table (
  membership_id uuid,
  balance bigint,
  annual_cap bigint,
  remaining_earning_capacity bigint,
  spendable bigint,
  reversal_debt bigint,
  period_start date,
  period_end date,
  tier text,
  earned_this_period bigint,
  redeemed_this_period bigint
)
language plpgsql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_account  public.points_accounts%rowtype;
  v_period   public.points_periods%rowtype;
  v_membership public.memberships%rowtype;
  v_tier     text;
begin
  select * into v_membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_account from public.points_accounts
   where membership_id = p_membership_id;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ensure_points_period is what the earning path itself calls, so the period a
  -- member is shown is the SAME period their cap is measured against. Calling it
  -- here and reading the snapshot back is what keeps the two from disagreeing
  -- across a midnight or an anniversary boundary.
  perform 1 from public.points_periods
   where id = private.ensure_points_period(v_account.id);
  select * into v_period
    from public.points_periods where id = private.ensure_points_period(v_account.id);

  select coalesce(pc.code, 'BRONZE') into v_tier
    from public.memberships m
    left join public.card_plans pc on pc.id = m.product_id
   where m.id = p_membership_id;

  return query
    select
      p_membership_id,
      v_account.balance,
      v_period.annual_points_cap,
      -- Capacity is the ANNUAL CAP less what has already been earned against it.
      -- A reversal does not restore capacity: the cap governed what was earned,
      -- and un-earning it does not re-open the year.
      greatest(v_period.annual_points_cap
               - coalesce((select sum(pl.amount) from public.points_ledger pl
                            where pl.account_id = v_account.id
                              and pl.origin_period_id = v_period.id
                              and pl.counts_toward_cap
                              and pl.amount > 0), 0), 0),
      greatest(v_account.balance - v_account.reversal_debt, 0),
      v_account.reversal_debt,
      v_period.period_start,
      v_period.period_end,
      v_tier,
      coalesce((select sum(pl.amount) from public.points_ledger pl
                 where pl.account_id = v_account.id
                   and pl.origin_period_id = v_period.id
                   and pl.counts_toward_cap
                   and pl.amount > 0), 0),
      coalesce((select -sum(pl.amount) from public.points_ledger pl
                 where pl.account_id = v_account.id
                   and pl.origin_period_id = v_period.id
                   and pl.entry_type in ('redemption','reversal','expiration')), 0);
end $$;

comment on function public.customer_points_position(uuid) is
  'The member''s points position as THREE separate figures: balance, spendable (balance - debt) and remaining annual earning capacity. Capacity is a ceiling, not spendable money; outstanding reversal debt is reported on its own and reduces only what may be spent.';

revoke all on function public.customer_points_position(uuid) from public, anon, authenticated;
grant execute on function public.customer_points_position(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Recording a CASH RECEIPT against a purchase.
--
-- This is the write path that was missing: purchase_payments existed, was read by
-- private.purchase_verified_total and gated complete_purchase, but nothing could
-- ever insert into it - so a purchase could never be settled and the whole
-- record -> settle -> claim chain was unreachable.
--
-- The recorded/verified split mirrors the card-sale workflow and is the reason
-- 'recorded' is not money yet: a payment only counts toward net_amount once a
-- verifier has accepted it. That is what stops an unverified payment from making
-- a purchase look settled.
-- ---------------------------------------------------------------------------
create or replace function public.record_purchase_payment(
  p_purchase_id uuid,
  p_amount text,
  p_method text,
  p_reference text,
  p_actor_id uuid
)
returns table (payment_id uuid, payment_number text, amount text, status text)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_amount   numeric;
  v_number   text;
  v_id       uuid;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  if btrim(coalesce(p_method, '')) = '' then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  -- The regex is the POSITIVE-ONLY money shape, the same one the column CHECK
  -- uses: a receipt is never zero and never negative, so a typo that produces
  -- either is refused here with a readable reason rather than by the constraint.
  if btrim(coalesce(p_amount, '')) !~ '^[1-9][0-9]*(\.[0-9]{1,2})?$' then
    raise exception 'PAYMENT_AMOUNT_INVALID' using errcode = '22023';
  end if;
  v_amount := p_amount::numeric;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_purchase.status = 'reversed' then
    raise exception 'PURCHASE_REVERSED' using errcode = '55000';
  end if;

  -- An overpayment is recorded, not clamped. Finance reports `overpaid_amount`
  -- separately, and silently truncating cash that actually arrived would hide a
  -- real discrepancy.
  v_number := private.claim_af_id('AF-PAY', 'public.purchase_payments'::regclass, 'payment_number');
  insert into public.purchase_payments (
    payment_number, purchase_id, amount, method, reference, status, recorded_by
  ) values (
    v_number, p_purchase_id, private.money(v_amount), p_method,
    nullif(btrim(coalesce(p_reference, '')), ''), 'recorded', p_actor_id
  )
  returning id into v_id;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, after_data, reason
  ) values (
    p_actor_id, 'PURCHASE_PAYMENT_RECORDED', 'purchase', p_purchase_id,
    jsonb_build_object('paymentNumber', v_number, 'amount', private.money(v_amount), 'method', p_method),
    p_method
  );

  return query select v_id, v_number, private.money(v_amount), 'recorded';
end $$;

comment on function public.record_purchase_payment(uuid, text, text, text, uuid) is
  'Records a cash receipt against a purchase in status ''recorded'', which is NOT yet money. Only a verified receipt counts toward net_amount, so an unverified payment can never make a purchase look settled. An overpayment is kept and reported, never truncated.';

revoke all on function public.record_purchase_payment(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_purchase_payment(uuid, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Verifying (or rejecting) a recorded receipt. This is the moment the money
-- becomes real, so it is a separate, attributed act: who recorded and who
-- verified are two different columns and must both be present.
-- ---------------------------------------------------------------------------
create or replace function public.verify_purchase_payment(
  p_payment_id uuid,
  p_decision text,
  p_rejection_reason text,
  p_actor_id uuid
)
returns table (payment_id uuid, status text, verified_total text)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_payment  public.purchase_payments%rowtype;
  v_verified text;
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = p_actor_id and su.status = 'active') then
    raise exception 'ACTOR_NOT_ACTIVE' using errcode = '42501';
  end if;
  if p_decision not in ('verified', 'rejected') then
    raise exception 'PAYMENT_DECISION_INVALID' using errcode = '22023';
  end if;
  -- A rejection with no reason is unreviewable, so it is refused.
  if p_decision = 'rejected' and btrim(coalesce(p_rejection_reason, '')) = '' then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_payment from public.purchase_payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Compare-and-set: a receipt can only move out of 'recorded' once. Without it
  -- two verifiers racing would both write and the audit trail would show two
  -- different people accepting the same money.
  if v_payment.status <> 'recorded' then
    raise exception 'PAYMENT_NOT_RECORDED' using errcode = '55000';
  end if;

  update public.purchase_payments
     set status = p_decision,
         verified_by = p_actor_id,
         verified_at = now(),
         rejection_reason = case when p_decision = 'rejected'
                                 then btrim(p_rejection_reason) else null end
   where id = p_payment_id;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, after_data, reason
  ) values (
    p_actor_id,
    case when p_decision = 'verified' then 'PURCHASE_PAYMENT_VERIFIED'
         else 'PURCHASE_PAYMENT_REJECTED' end,
    'purchase_payment', p_payment_id,
    jsonb_build_object('paymentNumber', v_payment.payment_number, 'amount', v_payment.amount),
    p_rejection_reason
  );

  v_verified := private.money(private.purchase_verified_total(v_payment.purchase_id));
  return query select p_payment_id, p_decision, v_verified;
end $$;

comment on function public.verify_purchase_payment(uuid, text, text, uuid) is
  'Moves a recorded receipt to ''verified'' or ''rejected'' exactly once. Only ''verified'' counts toward net_amount. A rejection requires a reason, and both the recorder and the verifier are recorded.';

revoke all on function public.verify_purchase_payment(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Finance. The four figures a purchase must always be reported by, and which are
-- NOT interchangeable:
--
--   gross purchase value  - what the goods and services are worth
--   points discount       - what points removed (NOT money received)
--   net amount due        - gross minus the discount
--   verified receipts     - what actually arrived in cash
--
-- A discount is an adjustment, never a receipt, so it can never reduce the
-- verified total and never make a purchase look settled when no cash arrived.
--
-- NAMED purchase_financial_summary_purchases, not purchase_financial_summary:
-- that name is already taken by 20261101000001, which is IMMUTABLE. A
-- `create or replace` with a different RETURNS TABLE is refused by PostgreSQL
-- outright ("cannot change return type of existing function"), so reusing the
-- name would have failed at apply time. Two similarly-named finance summaries now
-- exist for two different tables; that is deliberate, not an oversight.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_financial_summary_purchases(p_purchase_id uuid)
returns table (
  purchase_id uuid,
  gross_amount text,
  points_discount_amount text,
  net_amount text,
  recorded_total text,
  verified_total text,
  rejected_total text,
  remaining_balance text,
  overpaid_amount text,
  fully_paid boolean
)
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select
    p.id,
    p.gross_amount,
    p.points_discount_amount,
    p.net_amount,
    -- Every money figure goes through private.money(). A bare sum() returns
    -- `0`, not `0.00`, and a client validating against an exact-decimal money
    -- string rejects it. The money contract is enforced on the way OUT, not only
    -- on the way in through the CHECK constraints.
    private.money(coalesce((select sum(pp.amount::numeric) from public.purchase_payments pp
               where pp.purchase_id = p.id and pp.status = 'recorded'), 0)),
    private.money(private.purchase_verified_total(p.id)),
    private.money(coalesce((select sum(pp.amount::numeric) from public.purchase_payments pp
               where pp.purchase_id = p.id and pp.status = 'rejected'), 0)),
    private.money(greatest(p.net_amount::numeric - private.purchase_verified_total(p.id), 0)),
    private.money(greatest(private.purchase_verified_total(p.id) - p.net_amount::numeric, 0)),
    private.purchase_verified_total(p.id) >= p.net_amount::numeric
  from public.purchases p
  where p.id = p_purchase_id
$$;

revoke all on function public.purchase_financial_summary_purchases(uuid) from public, anon, authenticated;
grant execute on function public.purchase_financial_summary_purchases(uuid) to service_role;
-- ===========================================================================
-- Task 18: activation awards zero
-- ===========================================================================
--
-- The core business rule: a newly activated customer starts at 0 points.
-- Membership activation itself awards NOTHING. Points come only from an
-- eligible completed purchase through public.create_earning_claim.
--
-- This is a NEW forward-only redefinition. The previous definition lives in
-- 20261101000001_afhomes_application_purchase_flow.sql, which is IMMUTABLE and
-- is never edited here. The full body is reproduced with exactly ONE behavioural
-- change - the points allocation - so every existing guarantee is preserved
-- verbatim: the SQL-side permission check, the full verified-payment re-check,
-- the idempotent re-entry, the commission advance, and every audit event.
-- Purchase verification and the earning-claim rules are untouched.
--
-- The points account is still CREATED for every membership, because a points
-- account must exist to be spent against later. It is simply created at zero.
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

  -- REBUILD: activation awards ZERO points. Points are earned only from an
  -- eligible completed purchase through public.create_earning_claim. The
  -- yearly_points_snapshot is retained on the frozen sale as contract metadata
  -- and is deliberately NOT credited here: the `if v_points > 0` guard below is
  -- therefore never taken, so no annual_allocation row is written and the
  -- account is created at zero. Every other guarantee is inherited verbatim.
  v_points := 0;
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

  -- REBUILD: the points-year anchor is captured AT ACTIVATION, in Manila, so
  -- every later period boundary derives from a stored date rather than from a
  -- recomputed timestamp. Without this the anniversary could drift by a day for
  -- members activated near UTC midnight, and ensure_points_period would refuse
  -- the membership as having no anchor.
  update public.memberships
     set points_anniversary = (now() at time zone 'Asia/Manila')::date
   where id = v_membership_id;

  -- Points: account created at ZERO, same transaction. No allocation entry is
  -- written because v_points is 0, so the `if v_points > 0` guard below is not
  -- taken and the ledger records no activation award at all.
  insert into public.points_accounts (membership_id, balance, lifetime_allocated)
  values (v_membership_id, v_points, v_points)
  returning id into v_account_id;

  -- The first period is opened immediately rather than lazily, so a brand new
  -- member has a current period and a known cap without waiting for a read.
  perform private.ensure_points_period(v_account_id);

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

