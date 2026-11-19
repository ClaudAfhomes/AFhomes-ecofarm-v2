-- AF Homes: commit_point_discount must keep the four-term identity.
-- Validation: pnpm test:db:local (section 69 tier case).
-- select net_amount, tier_discount_amount, points_discount_amount, gross_amount
--   from public.purchases where false;
-- Down: restore the prior body. No rows rewritten by this file itself.
--
-- WHY. commit_point_discount predates service_tier_discounts (20261105) and was
-- never updated for it. It recomputed net as gross minus the points discount
-- only, silently dropping an already-snapshotted tier discount. On a purchase
-- WITH a tier discount the write either trips the four-term CHECK
-- (net = gross - tier - points) or, were the CHECK absent, overcharges the
-- member by the tier amount. The fix subtracts the stored tier figure, which is
-- a snapshot and therefore the truth for this purchase, not today's rule.
-- Nothing else in the function changes: same locks, same ledger row, same
-- idempotency through apply_purchase_points_discount.
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

  select * into v_quote from public.redemption_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_quote.status <> 'open' then
    raise exception 'QUOTE_NOT_OPEN' using errcode = '55000';
  end if;
  if v_quote.expires_at <= now() then
    update public.redemption_quotes set status = 'expired' where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = '55000';
  end if;

  select * into v_purchase from public.purchases where id = v_quote.purchase_id for update;
  if v_purchase.status <> 'draft' then
    raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode = '55000';
  end if;
  select * into v_account from public.points_accounts where id = v_quote.account_id for update;

  if v_account.reversal_debt > 0 then
    raise exception 'REVERSAL_DEBT_OUTSTANDING' using errcode = '55000';
  end if;
  v_before := v_account.balance;
  if v_before < v_quote.points_requested then
    raise exception 'INSUFFICIENT_POINTS:needed=% available=%',
      v_quote.points_requested, v_before using errcode = '55000';
  end if;
  v_after := v_before - v_quote.points_requested;

  select coalesce(pc.code, 'BRONZE') into v_tier
    from public.memberships m
    left join public.card_plans pc on pc.id = m.product_id
   where m.id = v_purchase.membership_id;

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

  select coalesce(sum(pl.points_discount_amount::numeric), 0) into v_left
    from public.purchase_lines pl where pl.purchase_id = v_purchase.id;
  -- The four-term identity: the tier figure is a per-purchase SNAPSHOT taken at
  -- sale time, so it is read back, never recomputed. Dropping it here is what
  -- used to overcharge tier-discounted purchases or trip the CHECK.
  v_net := v_purchase.gross_amount::numeric
           - v_purchase.tier_discount_amount::numeric
           - v_left;
  if v_net < 0 then
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
  'Spends the quoted points and keeps the four-term identity net = gross - tier - points: the tier figure is the snapshotted truth for the purchase, never recomputed.';

revoke all on function public.commit_point_discount(uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_point_discount(uuid, uuid) to service_role;
