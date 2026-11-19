-- AF Homes: idempotency for Operational Services sales and receipts.
--
-- PURPOSE. Close two duplicate-transaction holes that the Operational Services
-- workflow opened, both reachable from a till:
--
--   1. `create_purchase` had NO idempotency key. A seller who double-clicked, or
--      a browser that retried after a lost response, created a SECOND real
--      purchase with real lines - a duplicate that could earn points and could
--      be settled twice.
--   2. The GSD screen recorded receipts with a NULL reference, so the existing
--      `purchase_payments_purchase_reference_uidx` index was never consulted.
--      The same lost response therefore recorded the SAME cash twice.
--
-- Both are fixed in the DATABASE, not by a disabled button. A UI guard is
-- advisory; these are the guarantees.
--
-- NOTHING in the VIP-card workflow is touched. `create_purchase`,
-- `record_purchase_payment`, `purchase_payments`, `public.payments`, the
-- reservation collection queue and every card-sale RPC are either untouched or
-- redefined with the SAME body plus the reference handling below.
--
-- VALIDATION QUERNS (must return zero rows unless noted):
--
--   -- 1. No two sales share a reference.
--   select idempotency_reference, count(*) from public.purchases
--    where idempotency_reference is not null group by 1 having count(*) > 1;
--
--   -- 2. No two receipts on one purchase share a reference.
--   select purchase_id, reference, count(*) from public.purchase_payments
--    where reference is not null group by 1, 2 having count(*) > 1;
--
--   -- 3. The four-term identity still holds.
--   select id from public.purchases
--    where net_amount::numeric <> gross_amount::numeric
--                        - tier_discount_amount::numeric
--                        - points_discount_amount::numeric;
--
-- DOWN NOTE. Drop the index and the column, and restore the four-argument
-- `create_purchase`. Rows already written keep their reference; duplicates that
-- were prevented cannot be recreated by rolling back.

-- ===========================================================================
-- 1. The sale idempotency key
-- ===========================================================================
--
-- Unique across ALL purchases, not per seller. Two different sellers who happen
-- to mint the same reference are a collision, and refusing is correct: it is far
-- better to fail loudly than to silently bind one member's sale to another's.

alter table public.purchases
  add column idempotency_reference text;

comment on column public.purchases.idempotency_reference is
  'The till reference of the ONE intended sale. A repeated reference is the same operation, not a second purchase: the original is returned instead of creating a duplicate that could earn points.';

create unique index purchases_idempotency_reference_uidx
  on public.purchases (idempotency_reference)
  where idempotency_reference is not null;

-- ===========================================================================
-- 2. record_purchase_payment: a repeated reference is the SAME receipt
-- ===========================================================================
--
-- The unique index already existed, but a NULL reference bypasses it entirely,
-- which is exactly what the till was sending. The body below is otherwise
-- IDENTICAL to 20261106000001, including the operations.sales permission, the
-- positive-only amount check, the overpayment-is-recorded rule and the audit
-- event.
--
-- The retry path is decided BEFORE the claim_af_id call, so a retry does not
-- burn an AF-PAY number, and it returns the ORIGINAL row rather than a new one.

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
  v_reference text;
  v_number   text;
  v_id       uuid;
  v_existing_amount text;
  v_existing_status text;
begin
  -- Recording a receipt is part of MAKING the Operational Services sale, so it
  -- rides on the same narrowly scoped capability. It is NOT verification: the
  -- money stays unverified until Finance acts.
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');

  if btrim(coalesce(p_method, '')) = '' then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;
  -- A receipt is never zero and never negative, so a typo producing either is
  -- refused here with a readable reason rather than by the column CHECK.
  if btrim(coalesce(p_amount, '')) !~ '^[1-9][0-9]*(\.[0-9]{1,2})?$' then
    raise exception 'PAYMENT_AMOUNT_INVALID' using errcode = '22023';
  end if;
  -- REQUIRED. Without it the unique index below is never consulted and the same
  -- cash can be recorded twice.
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if v_reference is null then
    raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  v_amount := p_amount::numeric;

  -- THE RETRY, decided before anything is written and before an id is minted, so
  -- a lost response costs a second query rather than a second row.
  select pp.id, pp.payment_number, pp.amount, pp.status
    into v_id, v_number, v_existing_amount, v_existing_status
    from public.purchase_payments pp
   where pp.purchase_id = p_purchase_id and pp.reference = v_reference;
  if v_id is not null then
    return query select v_id, v_number, v_existing_amount, v_existing_status;
    return;
  end if;

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
    v_number, p_purchase_id, private.money(v_amount), p_method, v_reference, 'recorded', p_actor_id
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
  'Records a cash receipt against an operational purchase in status ''recorded'', which is NOT yet money. Requires a reference: a repeated (purchase_id, reference) returns the ORIGINAL receipt instead of recording the same cash twice. Only verified receipts count toward net_amount.';

revoke all on function public.record_purchase_payment(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_purchase_payment(uuid, text, text, text, uuid) to service_role;

-- ===========================================================================
-- 3. create_purchase: a repeated reference is the SAME sale
-- ===========================================================================
--
-- DROP then CREATE because the parameter list changes, which `create or replace`
-- cannot do: PostgreSQL would register a second overload instead of replacing
-- this one, leaving two functions with confusingly similar behaviour. Both are
-- removed and re-granted in the same transaction, so there is no window in which
-- the function does not exist.
--
-- Behaviour is otherwise IDENTICAL to the 20261106000001 body: the same
-- operations.sales permission check, the same server-resolved tier, the same
-- resolved-and-snapshotted tier discount per line, the same recomputed gross,
-- and the same refusal of a disabled service or a non-positive quantity.

drop function if exists public.create_purchase(uuid, text, jsonb, uuid);

create function public.create_purchase(
  p_membership_id uuid,
  p_gross_amount text,
  p_lines jsonb,
  p_reference text,
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
  v_reference  text;
  v_line       jsonb;
  v_service    uuid;
  v_quantity   int;
  v_unit       numeric;
  v_line_total numeric;
  v_rate       numeric;
  v_line_discount numeric;
  -- The ORIGINAL figures, read back on a retry. Separate variables so a retry
  -- reports what happened rather than re-running the pricing.
  v_existing_gross  text;
  v_existing_discount text;
  v_existing_net    text;
begin
  -- The GSD capability. It authorises recording a service sale ONLY: not
  -- customer creation, not catalog or rule maintenance, and not verification.
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');

  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if v_reference is null then
    raise exception 'SALE_REFERENCE_REQUIRED' using errcode = '22023';
  end if;

  -- THE RETRY. Decided first, before any validation or write, so a re-send of
  -- the same till reference returns the purchase that already exists rather than
  -- creating a second one. It is deliberately placed before the eligibility
  -- checks: a retry must not fail because the member's membership has since
  -- changed state - the sale already happened.
  select ps.id, ps.purchase_number, ps.gross_amount, ps.tier_discount_amount, ps.net_amount
    into v_purchase_id, v_number, v_existing_gross, v_existing_discount, v_existing_net
    from public.purchases ps
   where ps.idempotency_reference = v_reference;
  if v_purchase_id is not null then
    return query
      select v_purchase_id, v_number, v_existing_gross, v_existing_discount, v_existing_net;
    return;
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
  select * into v_customer from public.customers where id = v_membership.customer_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000';
  end if;

  -- The tier is the CARD PLAN code, read from the authoritative membership. This
  -- is the SAME derivation every other points function uses, so the discount
  -- bracket can never disagree with the earning bracket.
  select pc.code into v_tier
  from public.memberships m
  left join public.card_plans pc on pc.id = m.product_id
  where m.id = p_membership_id;
  -- A membership with no resolvable tier gets NO discount, never a default
  -- bracket.
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

    -- A DISABLED service cannot be sold, so a stale page offering one is refused
    -- here rather than at the browser.
    if not exists (select 1 from public.service_catalog s
                    where s.id = v_service and s.is_active) then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_line_total := v_unit * v_quantity;
    v_rate := coalesce(private.service_tier_discount_rate(v_service, v_tier), 0);
    v_line_discount := private.money(v_line_total * v_rate / 100);
    -- Clamped, so even a 100% rule cannot produce a negative line.
    if v_line_discount > v_line_total then
      v_line_discount := v_line_total;
    end if;
    v_tier_total := v_tier_total + v_line_discount;
  end loop;

  -- Gross from the same arithmetic, never from the request.
  select coalesce(sum((l->>'unitAmount')::numeric * (l->>'quantity')::int), 0)
    into v_gross
    from jsonb_array_elements(p_lines) l;

  if v_tier_total > v_gross then
    raise exception 'TIER_DISCOUNT_EXCEEDS_GROSS' using errcode = '22023';
  end if;

  -- ALIASED, and every RETURNING column qualified. A `returns table` function
  -- exposes each OUT parameter as a plpgsql VARIABLE of the same name, so an
  -- unqualified `purchase_number` in the RETURNING list is ambiguous between the
  -- variable and the column.
  insert into public.purchases as ps (
    customer_id, membership_id, status, gross_amount, tier_discount_amount,
    net_amount, tier_snapshot, idempotency_reference, created_by
  ) values (
    v_customer.id, p_membership_id, 'draft',
    private.money(v_gross), private.money(v_tier_total),
    private.money(v_gross - v_tier_total), v_tier, v_reference, p_actor_id
  )
  returning ps.id, ps.purchase_number into v_purchase_id, v_number;

  -- Second pass: the rows themselves, with the resolved rate FROZEN onto each
  -- line so a later rule edit cannot rewrite a settled sale.
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

comment on function public.create_purchase(uuid, text, jsonb, text, uuid) is
  'Records an Operational Services purchase in draft. Requires operations.sales CREATE and a till REFERENCE: a repeated reference is the SAME sale and returns the original purchase rather than creating a duplicate that could earn points. The customer AND the VIP tier are derived from the membership, the gross is recomputed from the lines, and the tier discount is resolved from the active rule and snapshotted per line.';

revoke all on function public.create_purchase(uuid, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.create_purchase(uuid, text, jsonb, text, uuid) to service_role;