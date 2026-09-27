-- ===========================================================================
-- Phase 5 reconciliation: deliver the Phase 2 execution-found fixes
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- Two Phase 2 migrations were corrected in the working tree AFTER they were
-- first written:
--
--   20260927000001_afhomes_phase2_business_foundation.sql
--   20260927000003_afhomes_phase2_rpc.sql
--
-- The corrections are not cosmetic. Each of the four defects fixed here was
-- found by EXECUTING the SQL on a real PostgreSQL, while text assertions and
-- the in-memory fake both passed against a broken database:
--
--   1. private.money() wrapped its result in rpad(x, 1, '0'). rpad TRUNCATES,
--      so every formatted total collapsed to its first character: 60,000.00
--      rendered as the string '6'. Every sale_financial_summary figure and
--      every verify_card_payment receipt was wrong.
--   2. verify_card_payment declared OUT parameters named `sale_id` and `status`,
--      so its own unqualified `where sale_id = ... and status = 'verified'` was
--      ambiguous and the function raised on EVERY call.
--   3. verify_card_payment set
--      spot_cash_started_at = v_sale.spot_cash_started_at - a self-assignment
--      that copied the existing NULL straight back, so the instant the spot-cash
--      window opened was never recorded.
--   4. commissions.ost_id was NOT NULL from Phase 1, while the new Phase 2
--      beneficiary CHECK also permits a STAFF beneficiary. The two constraints
--      contradicted each other and no commission could be created for a
--      VD/SSM/SM/Admin sale.
--
-- THE PROBLEM THIS MIGRATION SOLVES
--
-- A migration runner records the version (the timestamp prefix) and SKIPS any
-- version it has already recorded. If the production project already recorded
-- 20260927000001 and 20260927000003, it will skip them permanently and the
-- corrected bodies in those files will NEVER be applied. Production would then
-- run with broken money formatting, a payment-verification function that fails
-- on every call, an unrecorded spot-cash start, and no way to create a
-- commission for a staff sale.
--
-- The fixes are therefore re-delivered here as a NEW, forward-only, idempotent
-- migration. This is deliberately NOT another edit to the two amended files:
-- those stay as the historical record of what Phase 2 was, and this file
-- guarantees the corrected definitions exist no matter which versions any given
-- database has recorded.
--
-- IDEMPOTENCE
--
-- `create or replace function` and `alter column ... drop not null` are both no-ops
-- when the corrected definition is already in place. Applying this file to an
-- already-correct database changes nothing. That is what makes it safe to apply
-- unconditionally, without first having to know whether any target recorded
-- the defective versions.
--
-- ORDERING
--
-- Must run AFTER 20260927000003. It redefines functions over Phase 2 tables;
-- if Phase 2 has never been applied, the runner applies Phase 2 first because
-- migrations run in filename order.
--
-- VALIDATION (run after applying; all must hold)
--
--   -- 1. money formatting is exact, never truncated to one character
--   select private.money(60000)  = '60000.00'  as money_ok,
--          private.money(0.5)     = '0.50'      as money_half_ok,
--          private.money(1234.5)  = '1234.50'   as money_pad_ok;
--
--   -- 2. a staff-beneficiary commission is insertable
--   select is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'commissions'
--      and column_name = 'ost_id';               -- expect: YES
--
--   -- 3. verify_card_payment exists as plpgsql
--   select p.proname, l.lanname
--     from pg_proc p join pg_language l on l.oid = p.prolang
--    where p.proname = 'verify_card_payment';    -- expect: plpgsql, one row
--
--   -- 4. the self-assignment is gone from the INSTALLED definition
--   select prosrc from pg_proc where proname = 'verify_card_payment';
--     -- must contain 'coalesce('
--     -- must NOT contain 'spot_cash_started_at = v_sale.spot_cash_started_at'
--
-- DOWN NOTE
--
-- There is no down migration, by design. Reverting private.money() would
-- reintroduce a defect that silently misreports every money total, and
-- reverting the other three would reintroduce hard failures. Roll back by
-- re-applying the corrected definitions - this file is idempotent - not by
-- restoring the defective bodies.
-- ===========================================================================



-- ---------------------------------------------------------------------------
-- 1. private.money - exact two-decimal text, never length-capped
-- ---------------------------------------------------------------------------
-- NEVER wrap a formatted value in rpad(x, n, c) with n shorter than the value:
-- rpad TRUNCATES. The rpad call below is the only one, and it pads the
-- FRACTIONAL part to exactly two digits, which is the only correct use.

create or replace function private.money(value numeric)
returns text
language sql
immutable
strict
as $$
  select split_part(v, '.', 1) || '.' ||
         rpad(coalesce(nullif(split_part(v, '.', 2), ''), '0'), 2, '0')
  from (select trim_scale(round(value, 2))::text as v) s
$$;

comment on function private.money(numeric) is
  'Exact-decimal money text with exactly two decimals. numeric is arbitrary
precision, so no float ever participates. Never wrap the result in
rpad(x, n, c) with a length shorter than the value: rpad TRUNCATES, which
silently turned every total into its first character. Found by executing this
on a real PostgreSQL.';

-- ---------------------------------------------------------------------------
-- 2. commissions.ost_id - a staff beneficiary is legal
-- ---------------------------------------------------------------------------
-- Phase 1 declared this NOT NULL because the only seller it modelled was an
-- OST. Phase 2 widened the beneficiary CHECK to also allow a staff member, and
-- the two constraints contradicted each other, so no commission could be
-- created for a VD/SSM/SM/Admin sale. This is a no-op when already nullable.

alter table public.commissions
  alter column ost_id drop not null;

-- ---------------------------------------------------------------------------
-- 3. verify_card_payment - qualified references and a real coalesce
-- ---------------------------------------------------------------------------
-- This function declares OUT parameters named `sale_id` and `status`. Every table
-- column referenced inside it MUST therefore be qualified, or the reference is
-- ambiguous and the function raises on EVERY call. The previous definition had
-- three unqualified references and was therefore completely unusable.
--
-- spot_cash_started_at is set with coalesce(), never self-assigned.

create or replace function public.verify_card_payment(
  p_payment_id uuid,
  p_decision text,
  p_reason text,
  p_actor_id uuid
)
returns table (
  sale_id uuid,
  status text,
  verified_total text,
  remaining_balance text,
  fully_paid boolean,
  spot_cash_deadline timestamptz
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_sale public.card_sales%rowtype;
  v_price numeric;
  v_verified numeric;
  v_deadline timestamptz;
  v_fully_paid boolean;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if p_decision not in ('verified', 'rejected') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'recorded' then
    raise exception 'PAYMENT_NOT_PENDING:%', v_payment.status using errcode = '55000';
  end if;

  select * into v_sale from public.card_sales where id = v_payment.sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.payments
  set status = p_decision,
      verified_by = p_actor_id,
      verified_at = now(),
      rejection_reason = case when p_decision = 'rejected' then btrim(p_reason) else null end
  where id = v_payment.id;

  v_price := coalesce((v_sale.cash_price_snapshot)::numeric, 0);
  -- Every column is qualified. This function's OUT parameters are named
  -- `sale_id` and `status`, so an unqualified reference would be ambiguous
  -- between the parameter and the table column and the statement would fail at
  -- runtime. Found by executing this on a real PostgreSQL.
  select coalesce(sum((p.amount)::numeric), 0) into v_verified
  from public.payments p
  where p.sale_id = v_sale.id and p.status = 'verified';

  -- The 7-day spot-cash window opens on the first VERIFIED payment. Computed
  -- once, server-side, in UTC; the client never derives it.
  v_deadline := v_sale.spot_cash_deadline;
  if p_decision = 'verified' and v_deadline is null then
    v_deadline := now() + interval '7 days';
    -- coalesce, NOT a self-assignment. The previous code wrote
    -- spot_cash_started_at = v_sale.spot_cash_started_at, which copies the
    -- existing (NULL) value straight back, so the instant the window opened was
    -- never recorded. Found by executing this on a real PostgreSQL.
    update public.card_sales
      set spot_cash_started_at = coalesce(v_sale.spot_cash_started_at, now()),
          spot_cash_deadline = v_deadline,
          updated_at = now()
      where id = v_sale.id;
  end if;

  v_fully_paid := v_verified >= v_price;

  if v_sale.status in ('draft', 'submitted', 'payment_pending', 'payment_in_progress', 'overdue') then
    if v_fully_paid then
      update public.card_sales
      set status = 'payment_verified',
          payment_verified_at = now(),
          fully_paid_at = now(),
          updated_at = now()
      where id = v_sale.id;
    else
      update public.card_sales
      set status = 'payment_in_progress', updated_at = now()
      where id = v_sale.id;
    end if;
  end if;

  if v_fully_paid then
    update public.commissions c
    set status = 'payment_verified'
    where c.sale_id = v_sale.id and c.status = 'pending';
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id,
    case when p_decision = 'verified' then 'PAYMENT_VERIFIED' else 'PAYMENT_REJECTED' end,
    'payment', v_payment.id::text,
    jsonb_build_object('status', 'recorded', 'amount', v_payment.amount),
    jsonb_build_object('status', p_decision, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  if v_fully_paid then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (
      p_actor_id, 'SALE_FULLY_PAID', 'card_sale', v_sale.id::text,
      jsonb_build_object('verifiedTotal', private.money(v_verified), 'price', private.money(v_price))
    );
  end if;

  return query
  select v_sale.id,
         (select s.status from public.card_sales s where s.id = v_sale.id),
         private.money(v_verified),
         private.money(greatest(v_price - v_verified, 0)),
         v_fully_paid,
         v_deadline;
end $$;

comment on function public.verify_card_payment(uuid, text, text, uuid) is
  'Verifies or rejects a RECORDED payment inside one transaction. Every table
reference is qualified because this function declares OUT parameters named
sale_id and status; an unqualified reference is ambiguous and raised on every
call. spot_cash_started_at is set with coalesce(), never self-assigned.';
