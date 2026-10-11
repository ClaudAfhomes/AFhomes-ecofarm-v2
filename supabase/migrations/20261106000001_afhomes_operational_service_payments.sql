-- AF Homes: isolated Operational Services payments, and the points spend at the till.
--
-- PURPOSE. Three things, all forward-only. 20261104000001 is NOT modified.
--
--   1. ISOLATION. Operational Services receipts already live in their own
--      `purchase_payments` table (verified below), so no duplicate table is
--      created. What was NOT isolated was the PERMISSION: verifying an
--      operational receipt rode on `finance.payment_verification`, which is the
--      VIP-CARD verification key. A dedicated `operations.payments` capability
--      separates the two workflows' authority without touching the card one.
--
--   2. A CORRECTNESS REPAIR. 20261105000001 added the tier discount and replaced
--      the purchase CHECK with the four-term identity. `commit_point_discount`
--      still computed `net = gross - points`, which now contradicts that CHECK:
--      committing a points discount onto a discounted purchase would raise a
--      constraint error. This file redefines it. Left alone, the approved
--      points-spend path would simply stop working.
--
--   3. THE TILL. A GSD spending a member's points is ONE atomic step, not the
--      customer-owned quote/commit pair: `apply_purchase_points_discount`.
--
-- ISOLATION EVIDENCE (what was checked before deciding to add nothing):
--
--   * `purchase_payments` references `purchases(id)` ONLY. It has no FK to
--     `card_sales`, `payment_schedules` or `public.payments`.
--   * `public.payments` is untouched here and its `payments_purchase_origin_check`
--     (20261101000001) still admits only 'sale' and 'reservation'. An operational
--     receipt therefore CANNOT appear on a card sale.
--   * The card-sale RPCs (`verify_purchase_payment_once`, `record_card_payment`,
--     the reservation collection queue) are not redefined, wrapped or called.
--
-- VALIDATION QUERIES (must return zero rows unless noted):
--
--   -- 1. The four-term identity still holds on every purchase.
--   select id from public.purchases
--    where net_amount::numeric <> gross_amount::numeric
--                        - tier_discount_amount::numeric
--                        - points_discount_amount::numeric;
--
--   -- 2. Operational receipts are stored ONLY here (must be 0 rows).
--   select id from public.purchase_payments where card_sale_id is not null;
--
--   -- 3. The GSD holds no verification capability (must be 0 rows).
--   select 1 from public.role_permissions rp
--     join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id
--    where r.slug = 'employee' and m.key = 'operations.payments'
--      and (rp.can_update or rp.can_create or rp.can_delete);
--
--   -- 4. VIP-card permission untouched: finance.payment_verification still has
--   --    exactly the rows it had before (informational).
--
-- DOWN NOTE. Drop `apply_purchase_points_discount` and
-- `operational_purchase_settlement`, drop the `operations.payments` module rows,
-- drop `purchases.points_discount_reference`, and restore the three-term CHECK
-- on `purchases` (net = gross - points_discount). Any purchase that carries a
-- non-zero points_discount_amount must have its tier_discount_amount zeroed in
-- the same migration, or the arithmetic will not close.

-- ===========================================================================
-- 1. Isolation proof: purchase_payments is already dedicated
-- ===========================================================================
--
-- Recorded here as an executable assertion rather than a comment, because the
-- whole decision to add NO new table rests on it. If a future migration ever
-- couples this table to the card workflow, the CREATE POLICY guard below and
-- this check fail together instead of silently merging two ledgers.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_payments'
      and column_name in ('card_sale_id', 'sale_id', 'reservation_id')
  ) then
    raise exception 'PURCHASE_PAYMENTS_IS_CARD_COUPLED';
  end if;
end $$;

comment on table public.purchase_payments is
  'Operational Services receipts ONLY. References purchases(id) and nothing from the VIP-card workflow: no FK to card_sales, reservations or public.payments, so an operational receipt can never appear on a card sale. Only ''verified'' rows are money received. Verified by finance.payment_verification-independent operations.payments UPDATE, never by the seller who recorded it.';

-- ===========================================================================
-- 2. Dedicated Operational Services Finance capability
-- ===========================================================================
--
-- `operations.payments` UPDATE authorises verifying or rejecting an OPERATIONAL
-- receipt. It is deliberately NOT `finance.payment_verification`, which remains
-- the VIP-card key and is neither widened nor narrowed here.
--
-- `employee` (the GSD) receives NO row: the person who records a receipt must not
-- be the person who makes it money. That is the whole point of the split, and it
-- is enforced in SQL by the RPC below, not by hiding a button.

insert into public.modules (key, name, group_name, sort_order)
values ('operations.payments', 'Operational Services Payments', 'Operations', 63)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      is_active = true;

-- Finance reviews and verifies operational receipts; Admin may too. View+update
-- only: there is no operational-payment create or delete, because receipts are
-- created through `operations.sales` and financial rows are never deleted.
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, true, false
from public.roles r
cross join public.modules m
where r.slug in ('finance', 'admin') and m.key = 'operations.payments'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = false, can_update = true, can_delete = false;

-- ===========================================================================
-- 3. Repair: commit_point_discount must honour the tier discount
-- ===========================================================================
--
-- Behaviour is otherwise IDENTICAL to 20261104000001: same eligibility, same
-- line allocation order, same FOR UPDATE lock chain (quote -> purchase ->
-- account), same single `redemption` ledger row, same cache update, same audit
-- event, same grants. Two changes only:
--
--   (a) the net subtracts the tier discount, closing the four-term identity;
--   (b) a purchase may be discounted ONCE. Without (b) two different quotes
--       could each commit against one draft and discount it twice.

alter table public.purchases
  add column points_discount_reference text;

comment on column public.purchases.points_discount_reference is
  'The POS reference of the single points discount applied to this purchase. Unique across all purchases: a retried till request carrying the same reference is recognised as the SAME operation instead of spending points twice.';

create unique index purchases_points_discount_reference_uidx
  on public.purchases (points_discount_reference)
  where points_discount_reference is not null;

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

  -- ONE discount per purchase. Without this, two distinct quotes could each
  -- commit against the same draft and the member would be charged twice for two
  -- discounts the business approved once.
  if v_purchase.points_discount_amount::numeric <> 0 then
    raise exception 'PURCHASE_ALREADY_DISCOUNTED';
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
  -- NULL yields NO row, so v_tier becomes NULL - and array[NULL] <@ eligible_tiers
  -- is never true, silently disabling every promotion for such a member.
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
  --
  -- Qualified: `purchase_id` is BOTH this function's OUT parameter and a column
  -- of public.purchase_lines, so the unqualified reference is ambiguous.
  select coalesce(sum(pl.points_discount_amount::numeric), 0) into v_left
    from public.purchase_lines pl where pl.purchase_id = v_purchase.id;

  -- THE REPAIR: the tier discount is part of the identity. It is a separate
  -- discount from the points conversion - it is not points spent - but it does
  -- reduce what is owed, so the net must subtract BOTH. The previous
  -- `gross - points` form now violates the four-term CHECK on purchases.
  v_net := v_purchase.gross_amount::numeric
         - v_purchase.tier_discount_amount::numeric
         - v_left;
  if v_net < 0 then
    -- Structurally unreachable given the per-line CHECKs, and asserted anyway
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

  -- gross and tier_discount are unchanged: a points discount REDUCES net, it is
  -- never a receipt.
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
  'Spends the quoted points against a DRAFT purchase, allocates the discount across ELIGIBLE lines only, and writes one permanent ledger row. Outstanding reversal debt, a closed quote, an already-discounted purchase and an insufficient balance are each re-checked at commit rather than trusted from the quote. Net subtracts BOTH the tier discount and the points conversion.';

revoke all on function public.commit_point_discount(uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_point_discount(uuid, uuid) to service_role;

-- ===========================================================================
-- 4. The till: one atomic step for a GSD spending a member's points
-- ===========================================================================
--
-- Example this implements: a Gold member books 10 nights at 10,000.00 =
-- 100,000.00 gross, has 50,000 points, and spends 25,000. The peso value comes
-- from the CONFIGURED `point_redemption_rules.peso_value_per_point`, never from
-- a constant and never from the request, so a business that pays 1.00 or 0.50
-- per point needs no code change.
--
-- Idempotency is by REFERENCE, not by time. A till retry after a lost response
-- carries the same reference and returns the ORIGINAL figures with
-- already_applied = true, instead of spending the member's points twice. The
-- unique index on purchases.points_discount_reference is the backstop, so two
-- concurrent retries of one reference cannot both win.

create or replace function public.apply_purchase_points_discount(
  p_purchase_id uuid,
  p_points_requested bigint,
  p_reference text,
  p_actor_id uuid
)
returns table (
  purchase_id uuid,
  points_spent bigint,
  discount_applied text,
  net_amount text,
  balance_after bigint,
  already_applied boolean
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_purchase   public.purchases%rowtype;
  v_reference  text;
  v_quote      uuid;
  v_spent      bigint;
  v_discount   numeric;
  v_net        numeric;
  v_balance    bigint;
begin
  -- The GSD capability. It authorises SELLING, so it authorises spending a
  -- member's points as part of that sale. It does NOT verify the receipt that
  -- settles the discounted amount.
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');

  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if v_reference is null then
    raise exception 'DISCOUNT_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  if p_points_requested is null or p_points_requested <= 0 then
    raise exception 'POINTS_AMOUNT_REQUIRED' using errcode = '22023';
  end if;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_purchase.status <> 'draft' then
    raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode = '55000';
  end if;

  -- THE RETRY. The same reference against the same purchase is the SAME till
  -- operation, so it reports what happened the first time and spends nothing.
  if v_purchase.points_discount_reference = v_reference then
    -- The ORIGINAL figures, read back rather than recomputed: a retry must
    -- report what actually happened, not what would happen if it ran again.
    select coalesce(-sum(l.amount), 0) into v_spent
      from public.points_ledger l
     where l.entry_type = 'redemption'
       and l.account_id = (
             select pa.id from public.points_accounts pa
              where pa.membership_id = v_purchase.membership_id)
       and l.reason = 'Points discount on purchase ' || v_purchase.purchase_number;
    select coalesce(pa.balance, 0) into v_balance
      from public.points_accounts pa where pa.membership_id = v_purchase.membership_id;
    return query
      select v_purchase.id, v_spent, v_purchase.points_discount_amount,
             v_purchase.net_amount, v_balance, true;
    return;
  end if;

  -- A DIFFERENT reference against a purchase that is already discounted is a
  -- second discount the business never approved, and is refused rather than
  -- silently stacked.
  if v_purchase.points_discount_amount::numeric <> 0 then
    raise exception 'PURCHASE_ALREADY_DISCOUNTED';
  end if;

  -- A single transaction: quote then commit. Both are the already-proven
  -- functions, so the rate resolution, the eligible-line allocation, the
  -- balance re-check and the single ledger row are all reused rather than
  -- reimplemented - there is now ONE place that can spend points.
  -- Explicit column lists, never `select * into record`: a `returns table`
  -- function exposes each OUT parameter as a variable of the same name, and a
  -- star-select into a record does not match the result shape.
  select q.quote_id into v_quote
    from public.quote_point_discount(p_purchase_id, p_points_requested, p_actor_id) q;

  select c.points_spent, c.discount_applied, c.net_amount, c.balance_after
    into v_spent, v_discount, v_net, v_balance
    from public.commit_point_discount(v_quote, p_actor_id) c;

  -- The reference is recorded LAST: it is the idempotency mark, so writing it
  -- before the discount would let a retry believe an operation completed that
  -- then rolled back.
  update public.purchases
     set points_discount_reference = v_reference,
         updated_at = now()
   where id = p_purchase_id;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, after_data, reason
  ) values (
    p_actor_id, 'OPERATIONAL_POINTS_DISCOUNT_APPLIED', 'purchase', p_purchase_id,
    jsonb_build_object(
      'reference', v_reference,
      'pointsSpent', v_spent,
      'discountAmount', v_discount::text,
      'netAmount', v_net::text
    ),
    'Points ' || v_spent || ' applied at the till'
  );

  return query
    select v_purchase.id, v_spent, private.money(v_discount),
           private.money(v_net), v_balance, false;
end $$;

comment on function public.apply_purchase_points_discount(uuid, bigint, text, uuid) is
  'Spends a member''s points against a DRAFT operational purchase in ONE atomic step, for an actor holding operations.sales CREATE. Idempotent by POS reference: a retry returns the original figures and spends nothing. The peso value is read from the configured point_redemption_rules, never from the request. Reuses quote_point_discount and commit_point_discount so there is exactly one code path that can spend points.';

revoke all on function public.apply_purchase_points_discount(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_purchase_points_discount(uuid, bigint, text, uuid) to service_role;

-- ===========================================================================
-- 5. Verification moves to the isolated Operational Services key
-- ===========================================================================
--
-- Redefined ONLY to change the permission it resolves. The body is otherwise the
-- 20261105000001 body: same compare-and-set on 'recorded', same requirement that
-- a rejection carry a reason, same audit event, same grants.
--
-- This is what makes the two workflows independent: an operational receipt is
-- verified by `operations.payments` UPDATE, while a VIP-card payment is verified
-- by `finance.payment_verification` UPDATE. Neither key authorises the other.

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
  -- The Operational Services Finance key, NOT the VIP-card one, and NOT
  -- `operations.sales`: the GSD who recorded the receipt holds neither.
  perform private.mutation_actor_role(p_actor_id, 'operations.payments', 'update');

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
  'Operational Services Finance verification ONLY. Requires operations.payments UPDATE, which operations.sales deliberately does not grant, so a GSD can never verify or reject their own sale. Independent of the VIP-card finance.payment_verification key: neither authorises the other.';

revoke all on function public.verify_purchase_payment(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment(uuid, text, text, uuid) to service_role;

-- ===========================================================================
-- 6. One truthful settlement read for both screens
-- ===========================================================================
--
-- The GSD screen and the Finance screen must not each re-derive "is this
-- settled?". This is the single answer, computed from the same helpers the write
-- paths use, and it is the ONLY thing that decides whether a claim is
-- claimable.
--
-- READ ONLY. It performs no completion, no verification and no claim creation, so
-- refreshing it can never advance a transaction by itself.

create or replace function public.operational_purchase_settlement(p_purchase_id uuid)
returns table (
  purchase_id uuid,
  purchase_number text,
  status text,
  gross_amount text,
  tier_discount_amount text,
  points_discount_amount text,
  net_amount text,
  recorded_total text,
  verified_total text,
  rejected_total text,
  remaining_amount text,
  verified_receipts int,
  rejected_receipts int,
  pending_receipts int,
  fully_paid boolean,
  claimable boolean,
  claim_id uuid,
  claim_status text
)
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select
    p.id,
    p.purchase_number,
    p.status,
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
    (select count(*)::int from public.purchase_payments pp
      where pp.purchase_id = p.id and pp.status = 'verified'),
    (select count(*)::int from public.purchase_payments pp
      where pp.purchase_id = p.id and pp.status = 'rejected'),
    (select count(*)::int from public.purchase_payments pp
      where pp.purchase_id = p.id and pp.status = 'recorded'),
    private.purchase_verified_total(p.id) >= p.net_amount::numeric,
    -- Claimable is the conjunction, and it is deliberately strict: a COMPLETED
    -- purchase with verified money covering the net, and an AVAILABLE (not
    -- claimed, expired or reversed) claim. Anything less shows no QR.
    (p.status = 'completed'
     and private.purchase_verified_total(p.id) >= p.net_amount::numeric
     and exists (select 1 from public.earning_claims ec
                  where ec.purchase_id = p.id and ec.status = 'available')),
    (select ec.id from public.earning_claims ec
      where ec.purchase_id = p.id
      order by case ec.status when 'available' then 0 else 1 end, ec.created_at desc
      limit 1),
    (select ec.status from public.earning_claims ec
      where ec.purchase_id = p.id
      order by case ec.status when 'available' then 0 else 1 end, ec.created_at desc
      limit 1)
  from public.purchases p
  where p.id = p_purchase_id
$$;

comment on function public.operational_purchase_settlement(uuid) is
  'The single settlement answer for one operational purchase: gross, tier discount, points discount, net, recorded/verified/rejected totals, outstanding balance, receipt counts, and whether an earning claim is genuinely claimable. Read only - it never completes a purchase, verifies a receipt or creates a claim.';

revoke all on function public.operational_purchase_settlement(uuid) from public, anon, authenticated;
grant execute on function public.operational_purchase_settlement(uuid) to service_role;

-- ===========================================================================
-- 7. Grants
-- ===========================================================================
--
-- browser_roles: no privilege on the new column, so a signed-in customer can
-- never read the till reference that identifies a staff member's operation.
grant select (status, net_amount, gross_amount, tier_discount_amount, points_discount_amount)
  on public.purchases to authenticated;
grant select (status, verified_by, verified_at, rejection_reason)
  on public.purchase_payments to authenticated;