-- AF Homes: Full-payment activation gate, payment blocking after verified settlement, historical compatibility.
-- Validation: test-official-numbering.mts, phase26-finance.spec.ts, application-purchase-flow.spec.ts.
-- Down: forward repair only. Restore from backup if needed.
begin;

-- 1. Update activate_card_sale to handle both origins (VIP issuance removed, so no RA sequence requirement for activation)
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
  v_membership_id uuid; v_membership_number text; v_fallback text; v_qr text;
  v_points integer; v_verified numeric; v_price numeric;
  v_membership public.memberships%rowtype; v_cust public.customers%rowtype;
  v_plan public.card_plans%rowtype; v_already boolean;
  v_res public.reservation_agreements%rowtype;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if p_validity_months is null or p_validity_months <= 0 then
    raise exception 'INVALID_VALIDITY_MONTHS' using errcode = '22023';
  end if;

  perform private.mutation_actor_role(p_actor_id,'finance.card_activation','update');

  select * into v_sale from public.card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotent: if already active, return existing membership
  select m.id, m.membership_number, m.fallback_code_hash, m.qr_token_hash, m.yearly_points_allocated
    into v_membership_id, v_membership_number, v_fallback, v_qr, v_points
    from public.memberships m
   where m.sale_id = p_sale_id and m.status = 'active';
  if found then
    return query select v_membership_id, v_membership_number, null, null, v_points::bigint, true;
    return;
  end if;

  -- Validate activation conditions
  if (select status from public.card_sales where id = p_sale_id) not in ('payment_verified','activation_pending') then
    raise exception 'SALE_NOT_ACTIVATABLE' using errcode = '55000';
  end if;
  if v_sale.cash_price_snapshot is null
  or (select coalesce(sum(amount::numeric),0) from public.payments where sale_id=v_sale.id and status='verified')<v_sale.cash_price_snapshot::numeric then
    raise exception 'SALE_NOT_FULLY_PAID' using errcode = '55000';
  end if;

  -- Generate new membership credentials
  v_fallback := private.new_fallback_code();
  v_qr := private.new_qr_token();
  v_membership_number := private.next_membership_number();

  -- Create membership
  insert into public.memberships (
    membership_number, sale_id, customer_id, status,
    activated_at, expires_at, fallback_code_hash, qr_token_hash,
    yearly_points_allocated, activated_by
  ) values (
    v_membership_number, v_sale.id, v_sale.customer_id, 'active',
    now(), now() + make_interval(months => coalesce(v_sale.validity_months_snapshot, p_validity_months)),
    private.hash_token(v_fallback), private.hash_token(v_qr),
    v_sale.yearly_points_snapshot, p_actor_id
  ) returning id into v_membership_id;

  -- Get plan tier for points period
  select * into v_plan from public.card_plans where id = v_sale.plan_id;

  -- Update sale and customer status
  update public.card_sales
  set status = 'active', activated_at = now(), updated_at = now()
  where id = v_sale.id;

  update public.customers set status = 'active', updated_at = now() where id = v_sale.customer_id;

  -- Commission records are handled by the commission_records system (Phase 4)
  -- At finalization, commission_records were linked to sale_id.
  -- If commission_records exist for this sale and are 'eligible', they remain eligible for payout.
  -- If 'pending', they remain pending (manual gate).
  -- No direct commission update here - payout is via request_commission_payout.

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id, 'MEMBERSHIP_ACTIVATED', 'membership', v_membership_id::text,
    jsonb_build_object('saleStatus', v_sale.status, 'customerStatus', 'prospect'),
    jsonb_build_object(
      'saleId', v_sale.id,
      'membershipNumber', v_membership_number,
      'productId', v_sale.plan_id,
      'pointsAllocated', 0,
      'expiresAt', to_char(now() + make_interval(months => coalesce(v_sale.validity_months_snapshot, p_validity_months)), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    )
  );

  -- Create immutable activation evidence
  perform private.append_purchase_document('membership_activated', v_membership_id, 1, p_actor_id);

  -- REBUILD: activation awards ZERO points. Points are earned only from eligible completed purchases.
  -- Create points_account with zero balance (required for membership)
  insert into public.points_accounts (membership_id, balance, updated_at)
  values (v_membership_id, 0, now())
  on conflict on constraint points_accounts_membership_id_key do nothing;

  -- Open first points period at activation (Manila date anchor)
  insert into public.points_periods (account_id, period_start, period_end, tier, annual_points_cap, created_at)
  select pa.id,
    (now() at time zone 'Asia/Manila')::date,
    ((now() at time zone 'Asia/Manila')::date + interval '1 year')::date,
    v_plan.code,
    v_sale.yearly_points_snapshot,
    now()
  from public.points_accounts pa where pa.membership_id = v_membership_id;

  -- Set points anniversary on membership (Manila date)
  update public.memberships
  set points_anniversary = (now() at time zone 'Asia/Manila')::date
  where id = v_membership_id;

  -- Update commission status to final_qualification_pending (awaiting manual gate)
  update public.commissions
  set status = 'final_qualification_pending'
  where sale_id = v_sale.id and status = 'payment_verified';

  -- No points_ledger entry created at activation (no annual_allocation).

  -- Issue onboarding token for customer portal
  perform public.issue_customer_onboarding_token(v_sale.customer_id, 'account_activation', 168, p_actor_id);

  -- Plaintext identifiers returned exactly once
  return query select v_membership_id, v_membership_number, v_fallback, v_qr, 0::bigint, false;
end $$;

revoke all on function public.activate_card_sale(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.activate_card_sale(uuid,uuid,integer) to service_role;

-- 2. Add helper function to check commission 40% eligibility (for UI)
create or replace function private.check_commission_40pct_eligibility(
  p_cumulative_verified text, p_basis_amount text
) returns boolean language sql immutable set search_path=pg_catalog,pg_temp as $$
  select p_cumulative_verified::numeric >= (p_basis_amount::numeric * 0.40)
$$;

revoke all on function private.check_commission_40pct_eligibility(text,text) from public, anon, authenticated, service_role;
grant execute on function private.check_commission_40pct_eligibility(text,text) to service_role;

-- 3. The VIP Card ID classification handling:
-- The 20261223000003 migration added classification 'S'/'N' to the format check.
-- New issuances use 'S' (Standard). 'N' (Non-Standard) only for historical preservation.
-- The private.issue_vip_on_first_qualifying_payment uses 'S' for new issuances.

-- 4. Historical VIP IDs preserved (trigger from 20261223000003)
-- private.protect_vip_card_number trigger prevents changes to existing vip_card_number

-- 5. Official RA numbering collision handling
-- The 20261230000001 migration handles VIP_RA_NUMBER_COLLISION on duplicate sequences

notify pgrst,'reload schema';
commit;