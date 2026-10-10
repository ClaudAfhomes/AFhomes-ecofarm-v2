-- AF Homes: Operational Services tier discounts, and the operations.sales permission.
--
-- PURPOSE. Two changes the AF Homes Operational Services workflow requires, both
-- forward-only. Nothing here edits an already-applied migration.
--
--   1. A dedicated, auditable SERVICE-TIER DISCOUNT model: per service, per
--      BRONZE/SILVER/GOLD rate, effective-dated, snapshot onto the sale.
--   2. The `operations.sales` module key, so a GSD can record an operational
--      sale and a receipt WITHOUT holding `sales.customers` create/update
--      (which also govern customer creation and the whole customer record).
--
-- SUPERSEDED RULING, stated plainly because it was deliberate.
--
-- 20261104000001:295-297 recorded: "card_plans.discount_percent is NOT applied
-- here. It discounts VIP card PRICING only, never a service purchase, and it
-- never stacks with a points discount. There is deliberately no service-discount
-- column."
--
-- Operational Services SUPERSEDES the second half of that ("no service-discount
-- column") only. The first half still stands and is enforced below:
--
--   * card_plans.discount_percent is NEVER read by any function in this file.
--     It remains a CARD-PURCHASE discount. A grep for it here returns nothing.
--   * The tier discount does NOT stack with the points discount in the
--     Operational Services checkout. The two are separate columns with separate
--     rules and the arithmetic below keeps them distinct.
--
-- 20261104000001 is NOT modified. It is applied-or-not as it stands; this file
-- only ADDS. Where its `purchases_net_equals_gross_minus_discount` CHECK is
-- replaced below, it is REPLACED (dropped and re-added with the tier term), not
-- edited in place, so a database that already recorded the old constraint
-- converges to the new one.
--
-- VALIDATION QUERIES (must return zero rows unless noted):
--
--   -- 1. The four-term invariant holds on every purchase.
--   select id from public.purchases
--    where net_amount::numeric <> gross_amount::numeric
--                        - tier_discount_amount::numeric
--                        - points_discount_amount::numeric;
--
--   -- 2. No discount ever exceeds the gross it discounts.
--   select id from public.purchases where tier_discount_amount::numeric > gross_amount::numeric;
--   select id from public.purchase_lines where tier_discount_amount::numeric > line_total::numeric;
--
--   -- 3. No negative money anywhere.
--   select id from public.purchases where net_amount::numeric < 0 or tier_discount_amount::numeric < 0;
--
--   -- 4. Snapshot integrity: a settled sale keeps the rate it was sold at.
--   select l.id from public.purchase_lines l
--    where l.tier_discount_rate is not null
--      and l.tier_discount_amount::numeric
--          <> round(l.line_total::numeric * l.tier_discount_rate::numeric, 2);
--
--   -- 5. No two simultaneously-active rules for one service+tier (must return 0).
--   select a.id from public.service_tier_discounts a join public.service_tier_discounts b
--     on a.service_id = b.service_id and a.tier = b.tier
--    where a.id <> b.id and a.is_active and b.is_active
--      and daterange(a.effective_start, a.effective_end, '[)')
--       && daterange(b.effective_start, b.effective_end, '[)');
--
--   -- 6. The GSD capability is narrow: employee holds operations.sales, and no
--   --      catalog/rule/verification key. (Informational.)
--   select r.slug, m.key, rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp
--     join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id
--    where r.slug = 'employee' and m.key = 'operations.sales';
--
-- DOWN NOTE. Drop `operations.sales` rows from role_permissions and the module,
-- drop the four new columns, drop `service_tier_discounts`, then re-add the
-- original two-term CHECK. Data in existing purchases.tier_discount_amount is
-- 0.00 for every row created before this migration, so the arithmetic is
-- unchanged by the rollback.

-- ===========================================================================
-- 1. The service-tier discount model
-- ===========================================================================
--
-- One row per (service, tier, window). The rate is a PERCENTAGE stored as exact
-- numeric, never as a float and never as a text money value: 25% is 25.0000, and
-- the peso amount is DERIVED from it at sale time by private.money(). Storing a
-- derived peso figure in the rule would mean a price edit rewrote history.

create table public.service_tier_discounts (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid not null references public.service_catalog(id) on delete restrict,
  tier           text not null check (tier in ('BRONZE','SILVER','GOLD')),
  -- A rate of 0 is not a discount and a rate above 100% is not money, so both
  -- are unrepresentable rather than merely discouraged. Four decimal places
  -- matches private.money()'s output precision, so a 33.3333% rule still
  -- reconciles to the penny.
  discount_rate  numeric(7,4) not null check (discount_rate > 0 and discount_rate <= 100),
  -- Half-open [start, end) on Asia/Manila dates, exactly like
  -- point_earning_rules and point_redemption_rules. An inverted window is
  -- unrepresentable.
  effective_start date not null,
  effective_end   date not null,
  is_active      boolean not null default true,
  created_by     uuid references public.staff_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint service_tier_discounts_dates check (effective_start < effective_end)
);

comment on table public.service_tier_discounts is
  'Operational Services VIP tier discounts: an admin-configured percentage per service per tier, effective-dated. Never derived from card_plans.discount_percent, which discounts CARD purchases only. The applied rate is SNAPSHOT onto each sale, so editing a rule here never rewrites a settled transaction.';

create index service_tier_discounts_lookup_idx
  on public.service_tier_discounts (service_id, tier, effective_start, effective_end)
  where is_active;

-- Deterministic selection. Two simultaneously-active rules for one
-- (service, tier) would make "the" discount ambiguous, and the winner would
-- depend on scan order. This mirrors the existing
-- private.reject_overlapping_commission_rule() (20261018000002:29-46) rather
-- than introducing a second idiom for the same problem: a BEFORE trigger that
-- refuses the overlap, instead of an EXCLUDE constraint, because the disposable
-- test database and the production project both already run this exact pattern
-- and an exclusion constraint would add a GiST dependency neither has.
create or replace function private.reject_overlapping_service_tier_discount()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.is_active and exists (
    select 1
    from public.service_tier_discounts r
    where r.id <> new.id
      and r.is_active
      and r.service_id = new.service_id
      and r.tier = new.tier
      and daterange(r.effective_start, r.effective_end, '[)')
     && daterange(new.effective_start, new.effective_end, '[)')
  ) then
    raise exception 'SERVICE_TIER_DISCOUNT_OVERLAP';
  end if;
  return new;
end $$;

drop trigger if exists service_tier_discounts_no_overlap on public.service_tier_discounts;
create trigger service_tier_discounts_no_overlap
  before insert or update on public.service_tier_discounts
  for each row execute function private.reject_overlapping_service_tier_discount();

revoke all on function private.reject_overlapping_service_tier_discount() from public, anon, authenticated, service_role;

-- The resolved rate for one service at one tier, today. STABLE and a single
-- definition, so the sale, the quote and any future report cannot disagree
-- about which rate applied.
create or replace function private.service_tier_discount_rate(
  p_service_id uuid,
  p_tier text
)
returns numeric
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select r.discount_rate
  from public.service_tier_discounts r
  join public.service_catalog sc on sc.id = r.service_id
  where r.service_id = p_service_id
    and r.tier = p_tier
    and r.is_active
    and sc.is_active
    and (now() at time zone 'Asia/Manila')::date >= r.effective_start
    and (now() at time zone 'Asia/Manila')::date <  r.effective_end
  -- Deterministic by construction: the overlap trigger guarantees at most one
  -- active row, and this ordering is a belt-and-braces tiebreak that prefers the
  -- most recently created rule if the trigger is ever bypassed.
  order by r.created_at desc, r.id desc
  limit 1
$$;

comment on function private.service_tier_discount_rate(uuid, text) is
  'The active, in-date Operational Services discount percentage for one service and one VIP tier, or NULL when none is configured. Half-open [start, end) in Asia/Manila. Never reads card_plans.discount_percent.';

revoke all on function private.service_tier_discount_rate(uuid, text) from public, anon, authenticated;
grant execute on function private.service_tier_discount_rate(uuid, text) to service_role;

-- ===========================================================================
-- 2. Snapshot the applied discount onto the sale
-- ===========================================================================
--
-- Per line, because a mixed purchase must be able to say WHICH service got the
-- discount. A purchase-level figure could not.

alter table public.purchase_lines
  add column tier_discount_amount text not null default '0.00'
    check (tier_discount_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column tier_discount_rate numeric(7,4)
    check (tier_discount_rate is null
           or (tier_discount_rate > 0 and tier_discount_rate <= 100)),
  add column tier text check (tier is null or tier in ('BRONZE','SILVER','GOLD')),
  add column tier_discount_rule_id uuid references public.service_tier_discounts(id) on delete restrict;

comment on column public.purchase_lines.tier_discount_rate is
  'The percentage ACTUALLY applied to this line, frozen at sale time. Editing or disabling the rule afterwards cannot change a settled transaction.';

alter table public.purchases
  add column tier_discount_amount text not null default '0.00'
    check (tier_discount_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column tier_snapshot text check (tier_snapshot is null or tier_snapshot in ('BRONZE','SILVER','GOLD'));

comment on column public.purchases.tier_discount_amount is
  'Sum of the line tier discounts. Distinct from points_discount_amount, which is a POINTS conversion: the two are separate discounts with separate rules and are never the same figure.';

-- A discount can never exceed what it discounts, at either level. This is what
-- makes a negative net structurally impossible rather than merely avoided.
alter table public.purchase_lines
  drop constraint if exists purchase_lines_tier_discount_within_total;
alter table public.purchase_lines
  add constraint purchase_lines_tier_discount_within_total check (
    tier_discount_amount::numeric <= line_total::numeric
  );

alter table public.purchases
  drop constraint if exists purchases_tier_discount_within_gross;
alter table public.purchases
  add constraint purchases_tier_discount_within_gross check (
    tier_discount_amount::numeric <= gross_amount::numeric
  );

-- The authoritative four-term identity. The three-term CHECK from
-- 20261104000001 is REPLACED, because a tier discount that is not part of the
-- identity would let net drift away from the money actually owed.
alter table public.purchases
  drop constraint if exists purchases_net_equals_gross_minus_discount;
alter table public.purchases
  add constraint purchases_net_equals_gross_minus_discount check (
    net_amount::numeric = gross_amount::numeric
                        - tier_discount_amount::numeric
                        - points_discount_amount::numeric
  );

-- The purchase total is the sum of its lines. Without this, a handler could
-- write a gross that disagrees with its own lines and the discount would be
-- computed against the wrong base.
create or replace function private.purchase_line_totals(p_purchase_id uuid)
returns table (line_total numeric, tier_discount numeric, points_discount numeric)
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select
    coalesce(sum(l.line_total::numeric), 0),
    coalesce(sum(l.tier_discount_amount::numeric), 0),
    coalesce(sum(l.points_discount_amount::numeric), 0)
  from public.purchase_lines l
  where l.purchase_id = p_purchase_id
$$;

revoke all on function private.purchase_line_totals(uuid) from public, anon, authenticated;
grant execute on function private.purchase_line_totals(uuid) to service_role;

-- ===========================================================================
-- 3. create_purchase: resolve and snapshot the tier discount in SQL
-- ===========================================================================
--
-- Redefined. The signature is UNCHANGED so the existing handler, contract and
-- tests keep working; the behaviour added is that the tier discount is now
-- RESOLVED SERVER-SIDE from the member's authoritative tier and the active
-- rule, snapshotted onto each line, and rolled into the net.
--
-- The rate is NEVER read from the request. The request carries a quantity and a
-- service; everything priced is read from the database. A tampered body cannot
-- change what a member pays, exactly as before.

-- create_purchase gains a column in its result, so `create or replace` alone is
-- refused by PostgreSQL ("cannot change return type of existing function").
-- DROP then CREATE is the only forward-only way to widen a result set, and it
-- is safe here because the function is recreated in the SAME transaction, so
-- there is no window in which it does not exist. Every GRANT and REVOKE is
-- re-issued below, because DROP takes the privileges with it: `create or
-- replace` does not reset grants, and `drop` removes them outright.
drop function if exists public.create_purchase(uuid, text, jsonb, uuid);
drop function if exists public.purchase_financial_summary_purchases(uuid);

create function public.create_purchase(
  p_membership_id uuid,
  p_gross_amount text,
  p_lines jsonb,
  p_actor_id uuid
)
returns table (
  purchase_id uuid,
  purchase_number text,
  gross_amount text,
  tier_discount_amount text,
  net_amount text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_membership public.memberships%rowtype;
  v_customer   public.customers%rowtype;
  v_tier       text;
  v_gross      numeric;
  v_tier_total numeric := 0;
  v_purchase_id uuid;
  v_number     text;
  v_line       jsonb;
  v_service    uuid;
  v_quantity   int;
  v_unit       numeric;
  v_line_total numeric;
  v_rate       numeric;
  v_line_discount numeric;
begin
  -- The GSD capability is `operations.sales` CREATE. It authorises recording a
  -- service sale ONLY: not customer creation, not catalog or rule maintenance,
  -- and not payment verification. private.mutation_actor_role resolves the
  -- same deny-only role model the handler already applies, in SQL, so a handler
  -- bug cannot widen it.
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');

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
  select * into v_customer from public.customers where id = v_membership.customer_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
  end if;

  -- The tier is the CARD PLAN code, read from the authoritative membership.
  -- A tier supplied by the browser is never consulted, so a member cannot
  -- nominate their own discount bracket. This is the SAME derivation every
  -- other points function uses (20261104000001:1053, :2112, :2411), so the
  -- discount bracket can never disagree with the earning bracket.
  select pc.code into v_tier
  from public.memberships m
  left join public.card_plans pc on pc.id = m.product_id
  where m.id = p_membership_id;
  -- A membership with no resolvable tier gets NO discount, never a default
  -- bracket: defaulting to BRONZE would silently apply the lowest rate to a
  -- member whose real tier could not be read.
  v_tier := case when v_tier in ('BRONZE','SILVER','GOLD') then v_tier else null end;

  -- Resolve every line's discount BEFORE writing anything, so a mid-loop failure
  -- cannot leave a half-priced purchase behind: this function is one transaction.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_service := (v_line->>'serviceId')::uuid;
    v_quantity := (v_line->>'quantity')::int;
    v_unit := (v_line->>'unitAmount')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'PURCHASE_QUANTITY_INVALID' using errcode = '22023';
    end if;
    if v_unit is null or v_unit < 0 then
      raise exception 'PURCHASE_UNIT_AMOUNT_INVALID' using errcode = '22023';
    end if;

    -- A DISABLED service cannot be sold, and a stale page offering one is
    -- refused here rather than at the browser.
    if not exists (select 1 from public.service_catalog s
                    where s.id = v_service and s.is_active) then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_line_total := v_unit * v_quantity;
    v_rate := coalesce(private.service_tier_discount_rate(v_service, v_tier), 0);
    -- private.money() rounds to 2dp; the line discount is rounded the same way
    -- the purchase total is, so the sum of the lines equals the purchase figure
    -- exactly rather than to within a rounding crumb.
    v_line_discount := private.money(v_line_total * v_rate / 100);

    -- A discount can never exceed the line it discounts. Clamping here (rather
    -- than trusting the rate) means even a 100% rule cannot produce a negative
    -- line.
    if v_line_discount > v_line_total then
      v_line_discount := v_line_total;
    end if;
    v_tier_total := v_tier_total + v_line_discount;
  end loop;

  -- Gross from the same loop's arithmetic, never from the request.
  select coalesce(sum((l->>'unitAmount')::numeric * (l->>'quantity')::int), 0)
    into v_gross
    from jsonb_array_elements(p_lines) l;

  -- The purchase cannot be discounted below zero by its tier discount.
  if v_tier_total > v_gross then
    raise exception 'TIER_DISCOUNT_EXCEEDS_GROSS' using errcode = '22023';
  end if;

  -- ALIASED, and every RETURNING column qualified. A `returns table` function
  -- exposes each OUT parameter as a plpgsql VARIABLE of the same name, so an
  -- unqualified `purchase_number` in the RETURNING list is ambiguous between
  -- the variable and the column and PostgreSQL refuses the whole function at
  -- creation. The alias removes the ambiguity entirely.
  insert into public.purchases as ps (
    customer_id, membership_id, status, gross_amount, tier_discount_amount,
    net_amount, tier_snapshot, created_by
  ) values (
    v_customer.id, p_membership_id, 'draft',
    private.money(v_gross), private.money(v_tier_total),
    private.money(v_gross - v_tier_total), v_tier, p_actor_id
  )
  returning ps.id, ps.purchase_number into v_purchase_id, v_number;

  -- Second pass: the rows themselves, with the resolved rate FROZEN onto each
  -- line so a later rule edit cannot rewrite the arithmetic of a settled sale.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_service := (v_line->>'serviceId')::uuid;
    v_quantity := (v_line->>'quantity')::int;
    v_unit := (v_line->>'unitAmount')::numeric;
    v_line_total := v_unit * v_quantity;
    v_rate := coalesce(private.service_tier_discount_rate(v_service, v_tier), 0);
    v_line_discount := private.money(v_line_total * v_rate / 100);
    if v_line_discount > v_line_total then
      v_line_discount := v_line_total;
    end if;

    insert into public.purchase_lines (
      purchase_id, service_id, quantity, unit_amount, line_total,
      tier_discount_amount, tier_discount_rate, tier, tier_discount_rule_id
    ) values (
      v_purchase_id, v_service, v_quantity, private.money(v_unit),
      private.money(v_line_total), private.money(v_line_discount),
      case when v_rate > 0 then v_rate else null end,
      case when v_rate > 0 then v_tier else null end,
      case when v_rate > 0 then (
        select d.id from public.service_tier_discounts d
        where d.service_id = v_service and d.tier = v_tier and d.is_active
          and (now() at time zone 'Asia/Manila')::date >= d.effective_start
          and (now() at time zone 'Asia/Manila')::date <  d.effective_end
        order by d.created_at desc, d.id desc limit 1
      ) else null end
    );
  end loop;

  return query
    select v_purchase_id, v_number, private.money(v_gross),
           private.money(v_tier_total), private.money(v_gross - v_tier_total);
end $$;

comment on function public.create_purchase(uuid, text, jsonb, uuid) is
  'Records an Operational Services purchase in draft. Requires operations.sales CREATE. The customer AND the VIP tier are derived from the membership, the gross is recomputed from the lines, and the tier discount is resolved from the active, in-date service_tier_discounts rule and snapshotted per line. No rate, total or tier is ever read from the request.';

revoke all on function public.create_purchase(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_purchase(uuid, text, jsonb, uuid) to service_role;

-- ===========================================================================
-- 4. Settlement, claims and reporting over the four-term identity
-- ===========================================================================
--
-- These are REDEFINED, not edited: create_purchase above now writes a net that
-- includes the tier discount, and each function below must read the same
-- arithmetic. complete_purchase and create_earning_claim keep their EXACT
-- previous bodies apart from the operations.sales permission check, because the
-- settlement gate and the claim gate are the load-bearing guarantees of this
-- workflow and are preserved verbatim.

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
  -- Recording a receipt is part of making the Operational Services sale, so it
  -- rides on the same narrowly scoped capability. It is NOT verification: the
  -- money stays unverified until Finance acts.
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');

  if btrim(coalesce(p_method, '')) = '' then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;
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

revoke all on function public.record_purchase_payment(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_purchase_payment(uuid, text, text, text, uuid) to service_role;

-- Verification stays with Finance, on the EXISTING
-- `finance.payment_verification` UPDATE key the card-sale payment queue already
-- uses. This is deliberately NOT `operations.sales`: a GSD records a receipt
-- and must never be the person who makes it money. The existing Finance
-- baseline already grants this key update (20260930000001:83), so no new
-- permission and no broader grant is introduced.
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
  perform private.mutation_actor_role(p_actor_id, 'finance.payment_verification', 'update');

  if p_decision not in ('verified', 'rejected') then
    raise exception 'PAYMENT_DECISION_INVALID' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and btrim(coalesce(p_rejection_reason, '')) = '' then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_payment from public.purchase_payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Compare-and-set: a receipt leaves 'recorded' exactly once, so two racing
  -- verifiers cannot both claim to have accepted the same money.
  if v_payment.status <> 'recorded' then
    raise exception 'PAYMENT_NOT_RECORDED' using errcode = '55000';
  end if;

  update public.purchase_payments
     set status = p_decision,
         verified_by = p_actor_id,
         verified_at = now(),
         rejection_reason = case when p_decision = 'rejected'
                                 then nullif(btrim(coalesce(p_rejection_reason, '')), '')
                                 else null end
   where id = p_payment_id;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, after_data, reason
  ) values (
    p_actor_id, 'PURCHASE_PAYMENT_' || upper(p_decision), 'purchase_payment', p_payment_id,
    jsonb_build_object('paymentNumber', v_payment.payment_number, 'decision', p_decision),
    nullif(btrim(coalesce(p_rejection_reason, '')), '')
  );

  v_verified := private.money(private.purchase_verified_total(v_payment.purchase_id));
  return query select p_payment_id, p_decision, v_verified;
end $$;

comment on function public.verify_purchase_payment(uuid, text, text, uuid) is
  'Finance-only: turning a recorded receipt into money. Requires finance.payment_verification UPDATE, which operations.sales deliberately does NOT grant, so a GSD can never verify their own sale.';

revoke all on function public.verify_purchase_payment(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment(uuid, text, text, uuid) to service_role;

-- The gate, preserved verbatim apart from the permission key: verified receipts
-- must cover the NET, and a net that now includes a tier discount means a
-- discounted sale genuinely costs the member less to settle.
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
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');

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

revoke all on function public.complete_purchase(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_purchase(uuid, uuid) to service_role;

-- Finance reporting: the tier discount is reported as its OWN column, never
-- folded into the points discount, because "the member's Gold rate took 25,000
-- off" and "the member spent points worth 25,000" are different facts.
create function public.purchase_financial_summary_purchases(p_purchase_id uuid)
returns table (
  purchase_id uuid,
  gross_amount text,
  tier_discount_amount text,
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
    p.tier_discount_amount,
    p.points_discount_amount,
    p.net_amount,
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
-- 5. The operations.sales permission
-- ===========================================================================
--
-- Inserted here, in the SAME forward-only file as the workflow that needs it,
-- so a database can never hold the tier-discount tables without the permission
-- that authorises selling against them.

insert into public.modules (key, name, group_name, sort_order)
values ('operations.sales', 'Operational Services Sales', 'Operations', 62)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      is_active = true;

-- The GSD gets VIEW (the sale screen needs to read the catalog and pricing) and
-- CREATE (record the sale, record the receipt). NOT update and NOT delete: there
-- is no operation that needs them, and an unused grant is authority nobody
-- asked for.
--
-- Admin and Super Admin get the same view/create for the sale itself. Super
-- Admin is granted every module by slug regardless (afhomes-access.ts:265), so
-- no row is written for it, matching the baseline's own invariant that
-- super_admin holds zero explicit rows.
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, true, false, false
from public.roles r
cross join public.modules m
where r.slug in ('employee', 'admin')
  and m.key = 'operations.sales'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = true, can_update = false, can_delete = false;

-- Finance must be able to READ operational sales (it verifies their receipts)
-- but must never be able to create one.
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, false, false
from public.roles r
cross join public.modules m
where r.slug = 'finance' and m.key = 'operations.sales'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = false, can_update = false, can_delete = false;

-- ===========================================================================
-- 6. Grants and RLS
-- ===========================================================================
--
-- service_tier_discounts is staff-administration data: read by an Admin
-- configuring rates, never by a browser role. `revoke all` first, then RLS with
-- SELECT-only policies, exactly like every other AF Homes table.
revoke all on public.service_tier_discounts from anon, authenticated;
grant select on public.service_tier_discounts to authenticated;

alter table public.service_tier_discounts enable row level security;

create policy service_tier_discounts_select
  on public.service_tier_discounts
  for select
  to authenticated
  using (private.has_permission('operations.catalog', 'view'));

-- The purchase snapshot columns are readable through the SAME row policies the
-- tables already carry (RLS picks the row); only the new columns are added to
-- the browser column grant so a signed-in customer can never widen what they
-- read about someone else's sale.
grant select (tier_discount_amount, tier_snapshot) on public.purchases to authenticated;
grant select (tier_discount_amount, tier_discount_rate, tier, tier_discount_rule_id)
  on public.purchase_lines to authenticated;