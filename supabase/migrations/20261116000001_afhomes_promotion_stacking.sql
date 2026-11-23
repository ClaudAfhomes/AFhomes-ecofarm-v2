-- AF Homes: explicit promotion-controlled discount stacking (approved Option C).
-- Validation: pnpm test:db:local (sections 69 tier cases, new section 70).
-- select allow_discount_stacking from public.point_redemption_rules limit 1;
-- Down: drop the column; restore the prior quote/commit bodies. No rows rewritten.
--
-- POLICY. By default the two discounts never combine: a purchase carrying a VIP
-- tier discount refuses points spending, and a points discount never touches a
-- tiered purchase. An Admin/Super Admin may create a promotion with
-- allow_discount_stacking to authorize both on that promotion's service, tier
-- and window. A spending promotion WITHOUT the flag still authorizes spending
-- alone; it never authorizes stacking.
--
-- MECHANICS. The gate lives in quote (early refusal with a clear reason) and is
-- revalidated in commit (a promotion deactivated between quoting and committing
-- must refuse, exactly like an expired quote). apply_purchase_points_discount
-- inherits both by calling quote then commit. The peso value is additionally
-- capped at the REMAINING amount (gross minus tier), so a stacked discount can
-- never exceed what is still due and net can never go negative. The four-term
-- identity net = gross - tier - points is preserved by 20261115000001.
alter table public.point_redemption_rules
  add column if not exists allow_discount_stacking boolean not null default false;

comment on column public.point_redemption_rules.allow_discount_stacking is
  'Explicit stacking authorization. When true, this promotion permits a points discount on a purchase that already carries a VIP tier discount, for this service, tier and window only. False (the default) authorizes spending alone, never stacking.';

-- The single definition of "may this spend combine with a tier discount", so
-- quote, commit and any future report cannot drift apart. Per eligible line
-- that already carries a tier discount, a stacking-authorized promotion must
-- name that service, cover the member tier, and be active and in-date. Lines
-- with no tier discount, and lines no points touch, need nothing.
create or replace function private.stacking_authorized(p_purchase_id uuid, p_tier text)
returns boolean
language sql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
  select not exists (
    select 1
      from public.purchase_lines pl
     where pl.purchase_id = p_purchase_id
       and pl.tier_discount_amount::numeric > 0
       and private.line_discount_eligible(pl.service_id, p_tier, pl.line_total::numeric)
       and not exists (
         select 1
           from public.point_redemption_rules r
          where r.service_id = pl.service_id
            and r.is_active
            and r.allow_discount_stacking
            and p_tier = any (r.eligible_tiers)
            and r.effective_start <= (now() at time zone 'Asia/Manila')::date
            and r.effective_end > (now() at time zone 'Asia/Manila')::date
       )
  );
$$;

comment on function private.stacking_authorized(uuid, text) is
  'True when no points-discounted line on the purchase also carries a tier discount without its own stacking promotion. Pure read; the two callers enforce it.';

revoke all on function private.stacking_authorized(uuid, text) from public, anon, authenticated;
grant execute on function private.stacking_authorized(uuid, text) to service_role;

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

  -- No automatic stacking. A purchase that already carries a VIP tier discount
  -- takes points too ONLY through an explicit stacking promotion; the member
  -- completes with the tier discount, takes the points-only path, or waits for
  -- an authorized stack. Checked here for an early, legible refusal and again
  -- at commit, because a promotion can be deactivated in between.
  if not private.stacking_authorized(p_purchase_id, v_tier) then
    raise exception 'STACKING_NOT_AUTHORIZED' using errcode = '55000';
  end if;

  -- Nothing left to discount. A 100% tier rate covers the whole gross; quoting
  -- points against it would spend the member's balance for a PHP0.00 discount,
  -- so the quote is refused instead. Same code as a settled purchase: in both
  -- cases there is no amount due for points to reduce.
  if v_purchase.gross_amount::numeric - v_purchase.tier_discount_amount::numeric <= 0 then
    raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode = '55000';
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
  -- Never more than the eligible lines are worth, never more than the gross,
  -- and never more than the REMAINING amount once a tier discount is on the
  -- purchase: the latter keeps a stacked net >= 0 even before commit checks it.
  -- With no tier discount the remaining amount IS the gross, so unstacked
  -- quotes price exactly as before.
  v_value := least(
    v_raw,
    least(v_eligible, v_purchase.gross_amount::numeric),
    v_purchase.gross_amount::numeric - v_purchase.tier_discount_amount::numeric
  );

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
  'Prices a points discount without spending anything. Refuses unstacked tier+points combinations with STACKING_NOT_AUTHORIZED, and caps the peso value at the remaining amount. Outstanding reversal debt refuses the quote outright.';

revoke all on function public.quote_point_discount(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.quote_point_discount(uuid, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- COMMIT a quoted discount, revalidating the stacking authorization: a
-- promotion deactivated after quoting must refuse here, exactly like an
-- expired quote. Otherwise byte-identical to 20261115000001, including net =
-- gross - tier - points.
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

  -- Stacking is revalidated at commit, not trusted from the quote: a promotion
  -- deactivated or expired after quoting must refuse here.
  if not private.stacking_authorized(v_purchase.id, v_tier) then
    raise exception 'STACKING_NOT_AUTHORIZED' using errcode = '55000';
  end if;

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
  -- The four-term identity: the tier figure is a per-purchase SNAPSHOT taken at
  -- sale time, so it is read back, never recomputed.
  v_net := v_purchase.gross_amount::numeric
           - v_purchase.tier_discount_amount::numeric
           - v_left;
  if v_net < 0 then
    -- Structurally unreachable given the per-line CHECK and the quote cap, and
    -- asserted anyway because a negative net is the one outcome that must never
    -- be persisted.
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
  'Spends the quoted points and keeps the four-term identity net = gross - tier - points. Revalidates the stacking authorization at commit: a promotion lost after quoting refuses here.';

revoke all on function public.commit_point_discount(uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_point_discount(uuid, uuid) to service_role;
