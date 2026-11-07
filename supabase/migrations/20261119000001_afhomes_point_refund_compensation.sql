-- Finance-authorized point refunds append compensations; no cash is created.
-- Validation: disposable PostgreSQL duplicate, partial/full refund and debt cases.
-- Down: revoke refund RPC. Preserve refund, approval and ledger history.
alter table public.earning_claims add column if not exists min_quantity_snapshot integer check(min_quantity_snapshot>0);
create or replace function private.reverse_refunded_earning_award(
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
  perform private.mutation_actor_role(p_actor_id, 'operations.payments', 'update');
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

  return query select v_award.amount, v_account.reversal_debt + v_debt, v_after;
end $$;


revoke all on function private.reverse_refunded_earning_award(uuid,uuid,text) from public,anon,authenticated,service_role;

create table if not exists public.purchase_point_refunds(
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.purchases(id),quote_id uuid not null references public.redemption_quotes(id),
 refund_reference text not null unique,service_value text not null,points_restored bigint not null check(points_restored>=0),
 ledger_entry_id bigint references public.points_ledger(id),reviewed_by uuid not null references public.staff_users(id),reason text not null,
 reviewed_at timestamptz not null default now(),
 check(service_value ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),check(service_value::numeric>0),check(length(btrim(reason))>=3)
);
alter table public.purchase_point_refunds enable row level security;
revoke all on public.purchase_point_refunds from public,anon,authenticated;
grant select, insert on public.purchase_point_refunds to service_role;
revoke update, delete, truncate on public.purchase_point_refunds from service_role;

create or replace function public.refund_purchase_redeemed_points(p_purchase_id uuid,p_service_value text,p_reference text,p_reason text,p_service_review_confirmed boolean,p_actor_id uuid)
returns table(points_restored bigint,balance_after bigint,refund_id uuid)
language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_p public.purchases%rowtype;v_q public.redemption_quotes%rowtype;v_a public.points_accounts%rowtype;v_existing public.purchase_point_refunds%rowtype;
 v_value numeric;v_before_value numeric;v_base numeric;v_already bigint;v_restore bigint;v_repay bigint;v_ledger bigint;v_id uuid;v_claim public.earning_claims%rowtype;v_min_qty int;v_qty numeric;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.payments','update');
 if p_service_review_confirmed is distinct from true or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'REFUND_REVIEW_REQUIRED' using errcode='22023';end if;
 if length(btrim(coalesce(p_reference,'')))<3 or length(p_reference)>120 then raise exception 'REFUND_REFERENCE_REQUIRED' using errcode='22023';end if;
 if p_service_value is null or p_service_value !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then raise exception 'REFUND_VALUE_INVALID' using errcode='22023';end if;
 v_value:=p_service_value::numeric;if v_value<=0 then raise exception 'REFUND_VALUE_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('point-refund:'||p_reference,0));
 select f.* into v_existing from public.purchase_point_refunds f where f.refund_reference=p_reference;
 if found then
  if v_existing.purchase_id<>p_purchase_id or v_existing.reviewed_by<>p_actor_id or v_existing.service_value::numeric<>v_value or v_existing.reason<>p_reason then raise exception 'REFUND_REFERENCE_CONFLICT' using errcode='42501';end if;
  select a.* into v_a from public.points_accounts a join public.purchases p on p.membership_id=a.membership_id where p.id=p_purchase_id;
  return query select v_existing.points_restored,v_a.balance,v_existing.id;return;
 end if;
 select p.* into v_p from public.purchases p where p.id=p_purchase_id;
 if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode='P0002';end if;
 perform 1 from public.memberships m where m.id=v_p.membership_id for update;
 select p.* into v_p from public.purchases p where p.id=p_purchase_id for update;
 if v_p.status not in('completed','reversed') then raise exception 'PURCHASE_NOT_COMPLETED' using errcode='55000';end if;
 select q.* into v_q from public.redemption_quotes q where q.purchase_id=v_p.id and q.status='committed' and q.approval_consumed_at is not null for update;
 if not found then raise exception 'NO_REDEEMED_POINTS' using errcode='55000';end if;
 select coalesce(sum(f.service_value::numeric),0),coalesce(sum(f.points_restored),0) into v_before_value,v_already from public.purchase_point_refunds f where f.quote_id=v_q.id;
 v_base:=v_p.gross_amount::numeric-v_p.tier_discount_amount::numeric;
 if v_before_value+v_value>v_base then raise exception 'REFUND_EXCEEDS_PURCHASE' using errcode='55000';end if;
 -- Cumulative rounding makes split refunds restore exactly the original count
 -- at a full refund, while never returning more than was deducted.
 v_restore:=floor(v_q.points_requested*(v_before_value+v_value)/v_base)::bigint-v_already;
 perform private.ensure_points_period(v_q.account_id);
 select ec.* into v_claim from public.earning_claims ec where ec.purchase_id=v_p.id for update;
 if found and v_claim.status<>'reversed' then
  v_min_qty:=v_claim.min_quantity_snapshot;
  if v_min_qty is null and v_before_value+v_value<v_base then raise exception 'REFUND_LEGACY_EARNING_REVIEW_REQUIRED' using errcode='55000';end if;
  select sum(l.quantity)*(1-(v_before_value+v_value)/v_base) into v_qty from public.purchase_lines l where l.purchase_id=v_p.id and l.service_id=v_claim.service_id;
  if v_before_value+v_value=v_base or v_qty<coalesce(v_min_qty,1) then perform private.reverse_refunded_earning_award(v_p.id,p_actor_id,p_reason);end if;
 end if;
 select a.* into v_a from public.points_accounts a where a.id=v_q.account_id for update;
 v_repay:=least(v_a.reversal_debt,v_restore);
 if v_restore>0 then
  insert into public.points_ledger(account_id,entry_type,amount,balance_before,balance_after,counts_toward_cap,reference_type,reference_id,actor_id,reason)
  values(v_a.id,'adjustment',v_restore,v_a.balance,v_a.balance+v_restore-v_repay,false,'point_refund',p_reference,p_actor_id,p_reason) returning id into v_ledger;
  update public.points_accounts a set balance=a.balance+v_restore-v_repay,reversal_debt=a.reversal_debt-v_repay,updated_at=now() where a.id=v_a.id;
  update public.memberships m set points_balance=v_a.balance+v_restore-v_repay where m.id=v_p.membership_id;
 end if;
 insert into public.purchase_point_refunds as f(purchase_id,quote_id,refund_reference,service_value,points_restored,ledger_entry_id,reviewed_by,reason)
 values(v_p.id,v_q.id,p_reference,private.money(v_value),v_restore,v_ledger,p_actor_id,p_reason) returning f.id into v_id;
 if v_before_value+v_value=v_base then update public.purchases p set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where p.id=v_p.id;end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,reason)
 values(p_actor_id,'POINT_REDEMPTION_REFUNDED','purchase',v_p.id,jsonb_build_object('refundId',v_id,'quoteId',v_q.id,'serviceValue',private.money(v_value),'pointsRestored',v_restore,'serviceReviewConfirmed',true),p_reason);
 return query select v_restore,v_a.balance+v_restore-v_repay,v_id;
end $$;
revoke all on function public.refund_purchase_redeemed_points(uuid,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.refund_purchase_redeemed_points(uuid,text,text,text,boolean,uuid) to service_role;

create or replace function public.cancel_reserved_point_purchase(p_purchase_id uuid,p_reason text,p_actor_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_p public.purchases%rowtype;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.payments','update');
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'REFUND_REVIEW_REQUIRED' using errcode='22023';end if;
 select p.* into v_p from public.purchases p where p.id=p_purchase_id;
 if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode='P0002';end if;
 perform 1 from public.memberships m where m.id=v_p.membership_id for update;
 select p.* into v_p from public.purchases p where p.id=p_purchase_id for update;
 if v_p.status='reversed' then return;end if;
 if v_p.status<>'draft' then raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode='55000';end if;
 perform private.release_point_reservations(v_p.membership_id,v_p.id);
 update public.purchases p set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where p.id=v_p.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,reason) values(p_actor_id,'POINT_PURCHASE_CANCELLED','purchase',v_p.id,p_reason);
end $$;
revoke all on function public.cancel_reserved_point_purchase(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_reserved_point_purchase(uuid,text,uuid) to service_role;

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
  if exists(select 1 from public.redemption_quotes q where q.purchase_id=p_purchase_id and ((q.status='open' and q.reserved_at is not null) or q.approval_consumed_at is not null)) then raise exception 'POINT_REFUND_REVIEW_REQUIRED' using errcode='55000';end if;
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
  v_refunded numeric;
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

  select coalesce(sum(f.service_value::numeric),0) into v_refunded from public.purchase_point_refunds f where f.purchase_id=p_purchase_id;
  if v_refunded>0 then
    v_quantity:=floor(v_quantity*(1-v_refunded/(v_purchase.gross_amount::numeric-v_purchase.tier_discount_amount::numeric)))::integer;
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
    period_id, tier, points_requested, points_awarded, points_capped, min_quantity_snapshot,
    qr_token_hash, fallback_code_hash, token_issued_at, expires_at
  ) values (
    p_purchase_id, v_customer.id, v_membership.id, v_account.id, v_service, v_rule.id,
    v_period_id, v_tier, v_requested, v_reserved, v_requested - v_reserved, v_rule.min_quantity,
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
