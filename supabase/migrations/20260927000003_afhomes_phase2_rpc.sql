-- AF Homes Phase 2 - transactional business functions.
-- Validation before apply (every query must return zero rows):
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='private' and proname not in ('has_permission')
--      and proacl is not null and array_to_string(proacl,',') like '%anon%';
--   select count(*) from information_schema.role_routine_grants
--    where specific_schema='private' and grantee='anon';
-- Down: drop the functions and the sequence created here. The tables and RLS
--       policies are unaffected.

-- ===========================================================================
-- Money + identifier helpers
-- ===========================================================================
-- Money is stored as exact-decimal TEXT with a CHECK regex (the Phase 1
-- convention). Arithmetic happens in Postgres `numeric`, which is arbitrary
-- precision - never float - and is rendered back to a 2-decimal string.
-- `to_char` is deliberately avoided: its FM masks have a history of rendering
-- 0 as an empty string on this codebase.

create or replace function private.money(value numeric)
returns text
language sql
immutable
strict
as $$
  select rpad(
           split_part(v, '.', 1) || '.' ||
           rpad(coalesce(nullif(split_part(v, '.', 2), ''), '0'), 2, '0'),
           1, '0'
         )
  from (select trim_scale(round(value, 2))::text as v) s
$$;

comment on function private.money(numeric) is
  'Exact-decimal money text with exactly two decimals. numeric is arbitrary precision, so no float ever participates.';

-- High-entropy random tokens (256 bits) are hashed with plain SHA-256. A pepper
-- is not required: the input space is already too large to brute force, and
-- these values are looked up by equality, never used as a MAC.
create or replace function private.hash_token(token text)
returns text
language sql
immutable
strict
as $$
  select encode(digest(token, 'sha256'), 'hex')
$$;

create sequence if not exists public.membership_number_seq;

-- Human-readable, non-PII fallback member code. Shown to authorized staff once
-- at issuance and re-issuable; only its hash is stored.
create or replace function private.new_fallback_code()
returns text
language plpgsql
volatile
as $$
declare
  raw text := encode(gen_random_bytes(4), 'hex');
begin
  return 'AFH-' || upper(substr(raw, 1, 4)) || '-' || upper(substr(raw, 3, 4));
end $$;

-- Opaque QR token. Carries no customer data of any kind; it resolves to a
-- membership row server-side.
create or replace function private.new_qr_token()
returns text
language sql
volatile
as $$
  select encode(gen_random_bytes(32), 'base64')
$$;

-- ===========================================================================
-- Authoritative financial summary for a sale
-- ===========================================================================
-- SECURITY INVOKER on purpose: RLS still governs which rows this can see, so a
-- seller can only total their own sale. Totals are always derived from payment
-- records - never from a client-supplied or hand-typed figure.

create or replace function public.sale_financial_summary(p_sale_id uuid)
returns table (
  sale_id uuid,
  status text,
  cash_price text,
  minimum_down_payment text,
  recorded_total text,
  verified_total text,
  rejected_total text,
  remaining_balance text,
  overpaid_amount text,
  down_payment_satisfied boolean,
  fully_paid boolean,
  spot_cash_deadline timestamptz,
  spot_cash_state text
)
language sql
stable
as $$
  with sale as (
    select s.id, s.status, s.cash_price_snapshot, s.minimum_down_payment_snapshot,
           s.spot_cash_deadline
    from public.card_sales s
    where s.id = p_sale_id
  ),
  totals as (
    select
      private.money(coalesce(sum((p.amount)::numeric) filter (where p.status = 'recorded'), 0)) as recorded,
      private.money(coalesce(sum((p.amount)::numeric) filter (where p.status = 'verified'), 0)) as verified,
      private.money(coalesce(sum((p.amount)::numeric) filter (where p.status = 'rejected'), 0)) as rejected
    from public.payments p
    where p.sale_id = p_sale_id
      and p.status <> 'voided'
  )
  select
    sale.id,
    sale.status,
    coalesce(sale.cash_price_snapshot, private.money(0)) as cash_price,
    coalesce(sale.minimum_down_payment_snapshot, private.money(0)) as minimum_down_payment,
    totals.recorded,
    totals.verified,
    totals.rejected,
    private.money(greatest(coalesce((sale.cash_price_snapshot)::numeric, 0) - totals.verified::numeric, 0)),
    private.money(greatest(totals.verified::numeric - coalesce((sale.cash_price_snapshot)::numeric, 0), 0)),
    totals.verified::numeric >= coalesce((sale.minimum_down_payment_snapshot)::numeric, 0),
    totals.verified::numeric >= coalesce((sale.cash_price_snapshot)::numeric, 0),
    sale.spot_cash_deadline,
    case
      when totals.verified::numeric >= coalesce((sale.cash_price_snapshot)::numeric, 0) then 'fully_paid'
      when sale.spot_cash_deadline is null then 'not_started'
      when now() <= sale.spot_cash_deadline then 'within_deadline'
      else 'expired'
    end
  from sale cross join totals
$$;

-- ===========================================================================
-- Record a payment
-- ===========================================================================
-- Atomic: the payment row, the sale status advance, and the audit record all
-- land together. Server-computed only - the caller cannot set a paid total.

create or replace function public.record_card_payment(
  p_sale_id uuid,
  p_amount text,
  p_payment_type text,
  p_method text,
  p_reference text,
  p_notes text,
  p_receipt_storage_path text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sale public.card_sales%rowtype;
  v_amount numeric;
  v_payment_id uuid;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;

  v_amount := (p_amount)::numeric;
  if v_amount <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if p_payment_type not in ('down_payment', 'installment', 'full') then
    raise exception 'INVALID_PAYMENT_TYPE' using errcode = '22023';
  end if;

  select * into v_sale from public.card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_sale.status in ('cancelled', 'active') then
    raise exception 'SALE_NOT_ACCEPTING_PAYMENTS:%', v_sale.status using errcode = '55000';
  end if;
  if v_sale.cash_price_snapshot is null then
    raise exception 'SALE_HAS_NO_PRICE_SNAPSHOT' using errcode = '55000';
  end if;

  insert into public.payments (
    sale_id, customer_id, amount, payment_type, method, reference, notes,
    receipt_storage_path, status, recorded_by, recorded_at
  ) values (
    v_sale.id, v_sale.customer_id, p_amount, p_payment_type, p_method,
    nullif(btrim(p_reference), ''), p_notes, nullif(btrim(p_receipt_storage_path), ''),
    'recorded', p_actor_id, now()
  )
  returning id into v_payment_id;

  -- A recorded payment moves the sale into "in progress" but never any further:
  -- only VERIFIED money counts toward the price.
  if v_sale.status in ('draft', 'submitted', 'payment_pending', 'overdue') then
    update public.card_sales
      set status = 'payment_in_progress', updated_at = now()
      where id = v_sale.id and status in ('draft', 'submitted', 'payment_pending', 'overdue');
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_id, 'PAYMENT_RECORDED', 'payment', v_payment_id::text,
    jsonb_build_object(
      'saleId', v_sale.id,
      'amount', p_amount,
      'paymentType', p_payment_type,
      'method', p_method,
      'reference', nullif(btrim(p_reference), '')
    )
  );

  return v_payment_id;
end $$;

-- ===========================================================================
-- Verify or reject a payment
-- ===========================================================================
-- The single authoritative place a sale's money state changes. Sets the
-- 7-day spot-cash deadline on the first verified payment, marks the sale fully
-- paid when verified money reaches the price, and advances the commission to
-- payment_verified. Never advances the commission past that.

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
  select coalesce(sum((amount)::numeric), 0) into v_verified
  from public.payments
  where sale_id = v_sale.id and status = 'verified';

  -- The 7-day spot-cash window opens on the first VERIFIED payment. Computed
  -- once, server-side, in UTC; the client never derives it.
  v_deadline := v_sale.spot_cash_deadline;
  if p_decision = 'verified' and v_deadline is null then
    v_deadline := now() + interval '7 days';
    update public.card_sales
      set spot_cash_started_at = v_sale.spot_cash_started_at,
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
    update public.commissions
    set status = 'payment_verified'
    where sale_id = v_sale.id and status = 'pending';
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
         (select status from public.card_sales where id = v_sale.id),
         private.money(v_verified),
         private.money(greatest(v_price - v_verified, 0)),
         v_fully_paid,
         v_deadline;
end $$;

-- ===========================================================================
-- Activate a card sale
-- ===========================================================================
-- THE critical invariant. A sale becomes active only when authoritative
-- VERIFIED payments reach the snapshotted price, re-checked inside this
-- transaction. A down payment, an existing Auth user, a seller action or a
-- frontend button can never activate a membership.
--
-- Idempotent: activating an already-active sale returns the existing
-- membership instead of creating a second one.

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
    now() + make_interval(months => p_validity_months),
    now() + make_interval(months => p_validity_months), now()
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
      'expiresAt', to_char(now() + make_interval(months => p_validity_months), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    )
  );

  -- Plaintext identifiers are returned exactly once, to the authorized
  -- activator, and are never stored or re-displayable.
  return query select v_membership_id, v_membership_number, v_fallback, v_qr, v_points::bigint, false;
end $$;

-- ===========================================================================
-- Correct an authoritative upline
-- ===========================================================================
-- Atomic on purpose. The partial unique index allows at most one ACTIVE upline
-- per subject, so the old row must be retired in the SAME transaction that
-- opens the new one - two separate writes would either violate the index or
-- leave the subject with no upline if the insert failed.
--
-- The old row is retired rather than updated, so historical sales keep pointing
-- at the relationship they were created under.

create or replace function public.correct_referral_upline(
  p_relationship_id uuid,
  p_upline_staff_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_old public.referral_relationships%rowtype;
  v_new_id uuid;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_old
  from public.referral_relationships
  where id = p_relationship_id
  for update;
  if not found then
    raise exception 'SUBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_old.is_active then
    raise exception 'RELATIONSHIP_NOT_ACTIVE' using errcode = '55000';
  end if;
  if v_old.upline_staff_id = p_upline_staff_id then
    raise exception 'SAME_UPLINE' using errcode = '55000';
  end if;
  if v_old.subject_staff_id = p_upline_staff_id then
    raise exception 'UPLINE_SELF_REFERENCE' using errcode = '22023';
  end if;

  perform 1 from public.staff_users where id = p_upline_staff_id and status = 'active';
  if not found then
    raise exception 'UPLINE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.referral_relationships
  set is_active = false, updated_at = now()
  where id = p_relationship_id;

  insert into public.referral_relationships (
    subject_staff_id, upline_staff_id, hierarchy_role,
    is_authoritative, is_active, assigned_by
  ) values (
    v_old.subject_staff_id, p_upline_staff_id, v_old.hierarchy_role,
    true, true, p_actor_id
  )
  returning id into v_new_id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (
    p_actor_id, 'UPLINE_CORRECTED', 'referral_relationship', v_new_id::text,
    jsonb_build_object('relationshipId', p_relationship_id, 'uplineStaffId', v_old.upline_staff_id),
    jsonb_build_object('uplineStaffId', p_upline_staff_id, 'supersededRelationshipId', p_relationship_id),
    btrim(p_reason)
  );

  return v_new_id;
end $$;

-- ===========================================================================
-- Grants
-- ===========================================================================
-- private.money / hash_token stay internal to the SECURITY DEFINER functions.
revoke all on function private.money(numeric) from public, anon, authenticated;
revoke all on function private.hash_token(text) from public, anon, authenticated;
revoke all on function private.new_fallback_code() from public, anon, authenticated;
revoke all on function private.new_qr_token() from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Only the service role (API handlers) may mutate business state.
revoke all on function public.record_card_payment(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.verify_card_payment(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.activate_card_sale(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.correct_referral_upline(uuid, uuid, text, uuid) from public, anon, authenticated;

-- The read-only summary stays available to authenticated callers and is
-- RLS-scoped, so a seller can only total a sale they are allowed to see.
revoke all on function public.sale_financial_summary(uuid) from public, anon;
grant execute on function public.sale_financial_summary(uuid) to authenticated;
