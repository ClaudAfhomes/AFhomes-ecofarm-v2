-- Forward-only claim lifecycle repair. No balances or historical rows are reset.
-- Validation: pnpm test:db:local; pnpm test:db:harness.
-- select has_function_privilege('authenticated', 'public.claim_earning_points(text,uuid)', 'execute'); -- false
-- select count(*) from public.earning_claims c join public.points_ledger l
--   on l.reference_id = c.id::text and l.reference_type = 'earning_claim'
--   and l.entry_type = 'earned' where c.points_awarded <> l.amount;
-- Down: retain secure authorization; restore only reviewed function definitions.

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

  -- Membership precedes account so anniversary resets and cache updates cannot
  -- deadlock with authorized manual adjustments.
  perform 1 from public.memberships m where m.id = (
    select a.membership_id from public.points_accounts a where a.id = p_account_id
  ) for update;
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
     where account_id = p_account_id and period_end <= v_today and status = 'open'
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
  perform private.mutation_actor_role(p_actor_id, 'operations.redemption', 'create');

  perform 1 from public.memberships m where m.id = (select p.membership_id from public.purchases p where p.id = p_purchase_id) for update;
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
  if v_membership.status <> 'active' or v_membership.expires_at <= now() then
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
                    ((select period_end from public.points_periods where id = v_period_id)::timestamp at time zone 'Asia/Manila'));

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

  -- Discover the membership without a lock, then lock and re-resolve the
  -- credential so a concurrent rotation cannot use the old credential.
  perform 1 from public.memberships m where m.id = (
    select ec.membership_id from public.earning_claims ec
    where ec.qr_token_hash = v_hash or ec.fallback_code_hash = v_hash
  ) for update;
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

  update public.earning_claims as ec
     set points_awarded = v_awarded, points_capped = v_claimed.points_requested - v_awarded
   where ec.id = v_claim.id;

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
  perform private.mutation_actor_role(p_actor_id, 'operations.redemption', 'update');
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REVERSAL_REASON_REQUIRED' using errcode = '22023';
  end if;

  perform 1 from public.memberships m where m.id = (select p.membership_id from public.purchases p where p.id = p_purchase_id) for update;
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
  select * into v_account from public.points_accounts where id = v_claim.account_id for update;
  perform 1 from public.points_periods where id = v_period_id for update;

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
  v_period_id uuid;
  v_reserved bigint;
  v_qr       text;
  v_fallback text;
  v_expiry   timestamptz;
  v_current_tier text;
  v_today    date := (now() at time zone 'Asia/Manila')::date;
begin
  perform private.mutation_actor_role(p_actor_id, 'operations.redemption', 'create');
  perform 1 from public.memberships m where m.id = (select ec.membership_id from public.earning_claims ec where ec.id = p_claim_id) for update;

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
    if not exists (select 1 from public.memberships m
                    where m.id = v_claim.membership_id and m.status = 'active' and m.expires_at > now()) then
      raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
    end if;
    if not exists (select 1 from public.purchases p where p.id = v_claim.purchase_id and p.status = 'completed' and private.purchase_verified_total(p.id) >= p.net_amount::numeric) then
      raise exception 'PURCHASE_NOT_SETTLED' using errcode = '55000';
    end if;
    select cp.code into v_current_tier from public.memberships m join public.card_plans cp on cp.id=m.product_id where m.id=v_claim.membership_id;
    select * into v_rule from public.point_earning_rules where id = v_claim.rule_id;
    if not (v_rule.is_active
            and v_rule.effective_start <= v_today
            and v_today < v_rule.effective_end
            and v_current_tier = any (v_rule.eligible_tiers)
            and exists (select 1 from public.purchase_lines pl where pl.purchase_id=v_claim.purchase_id and pl.service_id=v_claim.service_id and pl.quantity>=v_rule.min_quantity)) then
      raise exception 'CLAIM_NO_LONGER_ELIGIBLE' using errcode = '55000';
    end if;

    v_period_id := private.ensure_points_period(v_claim.account_id);
    select * into v_period from public.points_periods where id = v_period_id for update;
    v_reserved := least(v_claim.points_requested, private.points_capacity(v_claim.account_id, v_period_id));
    if v_reserved <= 0 then
      raise exception 'NO_REMAINING_CAPACITY' using errcode = '55000';
    end if;
    -- A fresh reservation, taken under the period lock so it cannot over-allocate.
    v_expiry := least(now() + interval '24 hours', (v_period.period_end::timestamp at time zone 'Asia/Manila'));

    update public.earning_claims as ec
       set status = 'available',
           period_id = v_period_id,
           points_awarded = v_reserved,
           points_capped = v_claim.points_requested - v_reserved,
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
  perform private.mutation_actor_role(p_actor_id, 'operations.redemption', 'update');
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
