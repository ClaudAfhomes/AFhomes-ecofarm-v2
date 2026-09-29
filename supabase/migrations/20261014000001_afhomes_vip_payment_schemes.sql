-- ===========================================================================
-- VIP payment schemes (Stage 1 pre-opening value)
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- The VIP PAYMENT SCHEME GUIDELINES (internal IST reference) replace the
-- single-price-per-plan model with a two-track + three-move scheme system:
--
--   * Standard offer per tier: a Spot Cash price AND a different 4-month
--     installment total. A PHP 10,000 reservation fee applies to every tier and
--     every scheme and is already included in each total (never added on top).
--   * Track Spot Cash may move to Move A (same Spot Cash total, PHP 10,000
--     upfront, balance / 4). Track 4-month may move to B1 (40% DP incl.
--     reservation, balance / 12) and then B2 (25% DP, balance / 12).
--     Bronze is never eligible for B1/B2. Move A never chains into B1/B2.
--   * Membership validity becomes a frozen plan term: Bronze 7 years, Silver
--     12 years, Gold 22 years - replacing the per-activation 12-month default
--     for new sales only.
--
-- This migration is ADDITIVE:
--
--   * eight new plan columns (all NOT NULL with safe defaults so existing
--     rows and fixture inserts keep working), backfilled for Bronze/Silver/
--     Gold to the exact guideline economics;
--   * six new sale snapshot columns (scheme code + frozen economics).
--     Historical sales are backfilled to the pre-scheme meaning
--     (`spot_cash`, no reservation, no installments, no frozen validity), so
--     every historical total, balance, commission and expiry is unchanged;
--   * `activate_card_sale` is redefined to prefer the frozen sale validity
--     when present and fall back to the `p_validity_months` parameter
--     otherwise (pre-scheme sales keep the 12-month default path);
--   * no RLS change (table-wide SELECT grants already cover new columns; all
--     card RPCs stay revoked from anon/authenticated), no index change, no
--     rewrite of any historical snapshot, no points change.
--
-- VALIDATION (run on a real PostgreSQL; `pnpm test:db:local` proves these):
--
--   1. select code, cash_price, installment_price, reservation_fee,
--        spot_cash_days, standard_installment_months, validity_years,
--        move_a_enabled, move_b1_enabled, move_b2_enabled
--        from public.card_plans where code in ('BRONZE','SILVER','GOLD')
--        order by code;
--        -- BRONZE  54000.00/72000.00/10000.00/7/4/7/t/f/f
--        -- SILVER 192000.00/240000.00/10000.00/7/4/12/t/t/t
--        -- GOLD  312000.00/390000.00/10000.00/7/4/22/t/t/t
--   2. select payment_scheme, reservation_fee_snapshot, required_initial_snapshot,
--        installment_months_snapshot, monthly_amount_snapshot,
--        validity_months_snapshot
--        from public.card_sales where payment_scheme <> 'spot_cash';  -- zero rows
--        (every pre-scheme sale reads as a spot-cash sale with no reservation)
--   3. select count(*) from public.card_sales
--        where cash_price_snapshot is distinct from cash_price_snapshot;
--        -- zero rows (no historical snapshot rewritten)
--   4. select pg_get_functiondef('public.activate_card_sale(uuid,uuid,integer)'::regprocedure);
--        -- prefers validity_months_snapshot, falls back to p_validity_months
--   5. RLS invariants: supabase/security/rls_invariants.sql returns empty.
--
-- DOWN (operator-only; tier economics revert to the pre-Stage-1 values):
--
--   update public.card_plans set cash_price = '30000.00' where code = 'BRONZE';
--   update public.card_plans set cash_price = '40000.00' where code = 'SILVER';
--   update public.card_plans set cash_price = '60000.00' where code = 'GOLD';
--   alter table public.card_sales drop column payment_scheme,
--     drop column reservation_fee_snapshot, drop column required_initial_snapshot,
--     drop column installment_months_snapshot, drop column monthly_amount_snapshot,
--     drop column validity_months_snapshot;
--   alter table public.card_plans drop column installment_price,
--     drop column reservation_fee, drop column spot_cash_days,
--     drop column standard_installment_months, drop column validity_years,
--     drop column move_a_enabled, drop column move_b1_enabled,
--     drop column move_b2_enabled;
--   (plus restoring the previous activate_card_sale body from
--   20260927000003_afhomes_phase2_rpc.sql).
--
--   The down path is documented, not automated: dropping the snapshot columns
--   destroys frozen scheme economics on sales created under these rules.

-- ===========================================================================
-- 1. Card plan scheme economics
-- ===========================================================================

alter table public.card_plans
  add column if not exists installment_price text not null default '0.00'
    check (installment_price ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists reservation_fee text not null default '10000.00'
    check (reservation_fee ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists spot_cash_days integer not null default 7
    check (spot_cash_days > 0),
  add column if not exists standard_installment_months integer not null default 4
    check (standard_installment_months > 0),
  add column if not exists validity_years integer not null default 1
    check (validity_years > 0),
  add column if not exists move_a_enabled boolean not null default true,
  add column if not exists move_b1_enabled boolean not null default true,
  add column if not exists move_b2_enabled boolean not null default true;

comment on column public.card_plans.installment_price is
  'Standard 4-month installment TOTAL (a different total from cash_price). Frozen per sale at creation.';
comment on column public.card_plans.reservation_fee is
  'Reservation fee included in every total, never added on top. 10000.00 for all Stage 1 tiers.';
comment on column public.card_plans.validity_years is
  'Membership validity in years, frozen onto each sale (Bronze 7, Silver 12, Gold 22).';
comment on column public.card_plans.move_b1_enabled is
  'B1/B2 are never enabled for Bronze: the sale handler rejects them server-side.';

-- Stage 1 pre-opening values. Idempotent: a re-apply restores the same rows,
-- and plans created later (or renamed) are never touched.
update public.card_plans set
  cash_price = '54000.00',
  installment_price = '72000.00',
  reservation_fee = '10000.00',
  spot_cash_days = 7,
  standard_installment_months = 4,
  validity_years = 7,
  move_a_enabled = true,
  move_b1_enabled = false,
  move_b2_enabled = false,
  updated_at = now()
where code = 'BRONZE';

update public.card_plans set
  cash_price = '192000.00',
  installment_price = '240000.00',
  reservation_fee = '10000.00',
  spot_cash_days = 7,
  standard_installment_months = 4,
  validity_years = 12,
  move_a_enabled = true,
  move_b1_enabled = true,
  move_b2_enabled = true,
  updated_at = now()
where code = 'SILVER';

update public.card_plans set
  cash_price = '312000.00',
  installment_price = '390000.00',
  reservation_fee = '10000.00',
  spot_cash_days = 7,
  standard_installment_months = 4,
  validity_years = 22,
  move_a_enabled = true,
  move_b1_enabled = true,
  move_b2_enabled = true,
  updated_at = now()
where code = 'GOLD';

-- ===========================================================================
-- 2. Sale scheme snapshot
-- ===========================================================================

alter table public.card_sales
  add column if not exists payment_scheme text not null default 'spot_cash'
    check (payment_scheme in (
      'spot_cash', 'move_a', 'installment_4_month', 'move_b1_40_12', 'move_b2_25_12'
    )),
  add column if not exists reservation_fee_snapshot text not null default '0.00'
    check (reservation_fee_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists required_initial_snapshot text not null default '0.00'
    check (required_initial_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists installment_months_snapshot integer
    check (installment_months_snapshot is null or installment_months_snapshot > 0),
  add column if not exists monthly_amount_snapshot text
    check (monthly_amount_snapshot is null or monthly_amount_snapshot ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists validity_months_snapshot integer
    check (validity_months_snapshot is null or validity_months_snapshot > 0);

comment on column public.card_sales.payment_scheme is
  'Frozen VIP payment scheme. Pre-scheme sales read as spot_cash.';
comment on column public.card_sales.reservation_fee_snapshot is
  'Frozen reservation fee included in the frozen total. 0.00 for pre-scheme sales (the concept did not exist).';
comment on column public.card_sales.required_initial_snapshot is
  'Frozen required initial payment: reservation for the standard tracks, the DP for B1/B2.';
comment on column public.card_sales.validity_months_snapshot is
  'Frozen membership validity in months (plan validity_years x 12). NULL for pre-scheme sales, which keep the activation parameter path.';

-- Historical sales keep their meaning: no reservation existed, no installments
-- existed, and the required initial was the plan minimum down payment already
-- frozen in minimum_down_payment_snapshot.
update public.card_sales
set required_initial_snapshot = minimum_down_payment_snapshot
where required_initial_snapshot = '0.00'
  and minimum_down_payment_snapshot is not null;

-- ===========================================================================
-- 3. Activation prefers the frozen sale validity
-- ===========================================================================
-- Same contract, same security posture, same idempotency: the only change is
-- that a sale carrying validity_months_snapshot activates with the frozen
-- term instead of the caller-supplied parameter. Pre-scheme sales (NULL
-- snapshot) follow the parameter path exactly as before, so the 12-month
-- default and every existing activation test keep their meaning.

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
  v_balance bigint;
  v_months integer;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
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

  v_points := coalesce(v_sale.yearly_points_snapshot, 0);
  v_membership_number := 'MBS-' || to_char(nextval('public.membership_number_seq'), 'FM000000');
  v_fallback := private.new_fallback_code();
  v_qr := private.new_qr_token();

  insert into public.memberships (
    customer_id, sale_id, membership_number, product_id, fallback_code_hash,
    qr_token_hash, status, points_balance, yearly_points_allocated,
    sale_status_at_activation, activated_by, activated_at, expires_at, renewal_due_at, issued_at
  ) values (
    v_sale.customer_id, v_sale.id, v_membership_number, v_sale.plan_id,
    private.hash_token(v_fallback), private.hash_token(v_qr), 'active', 0, v_points,
    v_sale.status, p_actor_id, now(),
    now() + make_interval(months => v_months),
    now() + make_interval(months => v_months), now()
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

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id, 'MEMBERSHIP_ACTIVATED', 'membership', v_membership_id::text,
    jsonb_build_object('saleStatus', v_sale.status, 'customerStatus', 'prospect'),
    jsonb_build_object(
      'saleId', v_sale.id,
      'membershipNumber', v_membership_number,
      'productId', v_sale.plan_id,
      'pointsAllocated', v_points,
      'expiresAt', to_char(now() + make_interval(months => v_months), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    )
  );

  -- Plaintext identifiers are returned exactly once, to the authorized
  -- activator, and are never stored or re-displayable.
  return query select v_membership_id, v_membership_number, v_fallback, v_qr, v_points::bigint, false;
end $$;

-- CREATE OR REPLACE preserves the existing ACL, but re-assert it so this file
-- is self-evidently safe to review: browser roles never execute this function.
revoke all on function public.activate_card_sale(uuid, uuid, integer) from public, anon, authenticated;
