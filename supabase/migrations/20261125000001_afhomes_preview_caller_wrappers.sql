-- AF Homes: caller-bound Preview wrappers for the VIP points lifecycle.
--
-- Preview intentionally holds no SUPABASE_SERVICE_ROLE_KEY, so every handler
-- path that needs the service role answers 500/503 there. These wrappers let
-- an authenticated caller use the SAME business logic through their own JWT:
--
--   STAFF    auth.uid() -> private.mutation_actor_role(auth.uid(), module, action)
--            for writes, private.has_permission_for_user(auth.uid(), module,'view')
--            for reads, then delegation to the existing trusted service RPC.
--            The actor/permission is ALWAYS server-derived; no wrapper accepts
--            an actor id, a customer id, a price, a rate or a balance.
--   CUSTOMER auth.uid() -> customers.auth_user_id -> the caller's own customer
--            row (active only), then delegation. No wrapper accepts a customer
--            id, so one customer can never name another.
--
-- There are deliberately NO new RLS policies and NO new table grants here:
-- VIP/financial tables stay unreadable and unwritable to browser roles
-- directly. PostgREST can only reach these 41 function entry points, each of
-- which re-validates its actor before touching anything.
--
-- Dependencies: every trusted RPC through 20261124000001. This file runs LAST
-- in the release batch and inside the atomic preservation transaction without
-- change: it creates functions and grants only, holds no locks, writes no
-- business rows, and contains no BEGIN/COMMIT envelope.
--
-- Every `return query` below is followed by a bare `return;`. That is
-- redundant on stable PostgreSQL but load-bearing on the disposable PG 18
-- beta used for local rehearsal, where `RETURN QUERY` falls through to the
-- next statement instead of exiting (proven: two sequential return-queries
-- both execute and their rows accumulate). Without the guard, the photo
-- wrapper's append path falls into the manage path and fails.
-- Validate: 41 preview_* functions exist; authenticated may execute all 41;
-- anon may execute none; a permissionless staff call raises 42501; a stranger
-- customer call raises 42501; direct VIP table writes stay denied.
-- Down note: forward-only; revoke these grants / drop these functions to
-- retire. Never delete business history.

-- ===========================================================================
-- 0. Shared guards
-- ===========================================================================

create or replace function private.preview_require_staff(p_module text, p_action text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501'; end if;
  perform private.mutation_actor_role(v_actor, p_module, p_action);
  return v_actor;
end $$;
revoke all on function private.preview_require_staff(text, text) from public, anon, authenticated;
grant execute on function private.preview_require_staff(text, text) to service_role;

create or replace function private.preview_require_customer(p_active_only boolean default true)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid; v_status text;
begin
  select c.id, c.status into v_customer, v_status
  from public.customers c where c.auth_user_id = auth.uid();
  if v_customer is null then raise exception 'PREVIEW_CUSTOMER_REQUIRED' using errcode = '42501'; end if;
  if p_active_only and v_status is distinct from 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  return v_customer;
end $$;
revoke all on function private.preview_require_customer(boolean) from public, anon, authenticated;
grant execute on function private.preview_require_customer(boolean) to service_role;

create or replace function private.preview_customer_membership(p_customer_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_membership uuid;
begin
  select m.id into v_membership from public.memberships m
  where m.customer_id = p_customer_id and m.status = 'active'
  order by m.activated_at desc nulls last limit 1;
  if v_membership is null then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_membership;
end $$;
revoke all on function private.preview_customer_membership(uuid) from public, anon, authenticated;
grant execute on function private.preview_customer_membership(uuid) to service_role;

-- ===========================================================================
-- 1. Customer wrappers: identity is auth.uid(), never a parameter
-- ===========================================================================

create or replace function public.preview_customer_claim(p_token text)
returns table (claim_number text, points_awarded bigint, points_capped bigint, balance_after bigint)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid := private.preview_require_customer(true);
begin
  return query select * from public.claim_earning_points(p_token, v_customer);
  return;
end $$;

create or replace function public.preview_customer_claim_preview(p_token text)
returns table (claim_number text, purchase_number text, service_name text, points_requested bigint, points_awarded bigint, points_capped bigint, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_customer uuid := private.preview_require_customer(true);
  v_credential text := nullif(btrim(p_token), '');
  v_compact text;
  v_hash text;
begin
  if v_credential is null then raise exception 'INVALID_CLAIM_TOKEN' using errcode = '22023'; end if;
  v_compact := upper(replace(replace(v_credential, '-', ''), ' ', ''));
  if v_compact ~ '^AFH[0-9A-F]{8}$' then
    v_credential := 'AFH-' || substr(v_compact, 4, 4) || '-' || substr(v_compact, 8, 4);
  end if;
  v_hash := private.hash_token(v_credential);
  return query
    select ec.claim_number, p.purchase_number, sc.name,
           ec.points_requested, ec.points_awarded, ec.points_capped, ec.expires_at
    from public.earning_claims ec
    join public.purchases p on p.id = ec.purchase_id
    join public.service_catalog sc on sc.id = ec.service_id
    where ec.customer_id = v_customer
      and (ec.qr_token_hash = v_hash or ec.fallback_code_hash = v_hash)
    limit 1;
  if not found then raise exception 'CLAIM_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.preview_customer_decide(p_quote_id uuid, p_approve boolean)
returns text language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid := private.preview_require_customer(true);
begin
  if p_approve is null then raise exception 'APPROVAL_DECISION_REQUIRED' using errcode = '22023'; end if;
  return public.decide_point_redemption_approval(p_quote_id, v_customer, auth.uid(), p_approve);
end $$;

create or replace function public.preview_customer_position()
returns table (membership_id uuid, balance bigint, annual_cap bigint, remaining_earning_capacity bigint, spendable bigint, reversal_debt bigint, period_start date, period_end date, tier text, earned_this_period bigint, redeemed_this_period bigint)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid := private.preview_require_customer(true);
begin
  return query select * from public.customer_points_position(private.preview_customer_membership(v_customer));
  return;
end $$;

create or replace function public.preview_customer_ledger(p_cursor_occurred_at timestamptz default null, p_cursor_id bigint default null, p_entry_type text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_customer uuid := private.preview_require_customer(true);
  v_account uuid;
  v_rows jsonb;
  v_last jsonb;
  v_next jsonb := null;
begin
  if p_entry_type is not null and p_entry_type <> 'redemption' then
    raise exception 'INVALID_HISTORY_FILTER' using errcode = '22023';
  end if;
  if (p_cursor_occurred_at is null) <> (p_cursor_id is null) then
    raise exception 'INVALID_HISTORY_CURSOR' using errcode = '22023';
  end if;
  select a.id into v_account from public.points_accounts a
  where a.membership_id = private.preview_customer_membership(v_customer);
  if v_account is null then return jsonb_build_object('rows', '[]'::jsonb, 'next_cursor', null, 'quotes', '[]'::jsonb, 'claims', '[]'::jsonb, 'purchases', '[]'::jsonb, 'redemptions', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc, l.id desc), '[]'::jsonb) into v_rows
  from (
    select l.id, l.entry_type, l.amount, l.balance_after, l.reason, l.reference_type, l.reference_id, l.created_at
    from public.points_ledger l
    where l.account_id = v_account
      and (p_entry_type is null or l.entry_type = p_entry_type)
      and (p_cursor_occurred_at is null or l.created_at < p_cursor_occurred_at
        or (l.created_at = p_cursor_occurred_at and l.id < p_cursor_id))
    order by l.created_at desc, l.id desc
    limit 101
  ) l;
  if jsonb_array_length(v_rows) > 100 then
    v_last := v_rows->100;
    v_rows := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality e(e, ord) where ord <= 100);
    v_next := jsonb_build_object('occurredAt', v_last->>'created_at', 'id', v_last->>'id');
  end if;
  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next,
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'quote_number', q.quote_number)), '[]'::jsonb)
      from public.redemption_quotes q where q.id in (select (e->>'reference_id')::uuid from jsonb_array_elements(v_rows) e where e->>'reference_type' = 'redemption_quote') and q.approval_customer_id = v_customer),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'claim_number', c.claim_number)), '[]'::jsonb)
      from public.earning_claims c where c.id in (select (e->>'reference_id')::uuid from jsonb_array_elements(v_rows) e where e->>'reference_type' = 'earning_claim') and c.customer_id = v_customer),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'purchase_number', p.purchase_number)), '[]'::jsonb)
      from public.purchases p where p.id in (select (e->>'reference_id')::uuid from jsonb_array_elements(v_rows) e where e->>'reference_type' = 'purchase') and p.customer_id = v_customer),
    'redemptions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'redemption_number', r.redemption_number, 'item_name_snapshot', r.item_name_snapshot, 'item_code_snapshot', r.item_code_snapshot, 'quantity', r.quantity, 'total_points', r.total_points, 'customer_id', r.customer_id)), '[]'::jsonb)
      from public.redemptions r where r.id in (select (e->>'reference_id')::uuid from jsonb_array_elements(v_rows) e where e->>'entry_type' = 'redemption') and r.customer_id = v_customer)
  );
end $$;

create or replace function public.preview_customer_approvals()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid := private.preview_require_customer(true);
begin
  return (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
    from (select q.id, q.quote_number, q.purchase_id, q.points_requested, q.peso_value_per_point, q.peso_value, q.status, q.expires_at, q.approval_expires_at, q.approved_at, q.rejected_at, q.approval_consumed_at, q.approval_snapshot, q.created_at
      from public.redemption_quotes q where q.approval_customer_id = v_customer order by q.created_at desc limit 50) q);
end $$;

create or replace function public.preview_customer_refunds()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid := private.preview_require_customer(true);
begin
  return public.service_refund_history(null, v_customer);
end $$;

create or replace function public.preview_customer_reissue(p_membership_id uuid)
returns table (membership_id uuid, fallback_code text, qr_token text)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_customer uuid := private.preview_require_customer(true);
begin
  return query select * from public.reissue_membership_credentials(p_membership_id, v_customer, auth.uid());
  return;
end $$;

-- ===========================================================================
-- 2. Staff write wrappers: permission first, then the trusted RPC as actor
-- ===========================================================================

create or replace function public.preview_staff_save_service(p_service_id uuid, p_input jsonb)
returns setof public.service_catalog language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.catalog', case when p_service_id is null then 'create' else 'update' end);
begin
  return query select * from public.save_service_catalog(p_service_id, p_input, v_actor);
  return;
end $$;

create or replace function public.preview_staff_service_photo(p_service_id uuid, p_photo_id text, p_operation text, p_path text, p_alt text)
returns setof public.service_catalog language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.catalog', 'update');
begin
  if p_operation not in ('remove', 'cover', 'replace', 'append') then
    raise exception 'INVALID_PHOTO_OPERATION' using errcode = '22023';
  end if;
  if p_operation = 'append' then
    if p_path is null then raise exception 'PHOTO_PATH_REQUIRED' using errcode = '22023'; end if;
    return query select * from public.append_service_photo(p_service_id, p_path, p_alt, v_actor);
    return;
  end if;
  return query select * from public.manage_service_photo(p_service_id, p_photo_id, p_operation, p_path, p_alt, v_actor);
  return;
end $$;

create or replace function public.preview_staff_set_policy_active(p_kind text, p_id uuid, p_active boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.catalog', 'update');
begin
  if p_kind not in ('earning_rule', 'tier_discount') then
    raise exception 'INVALID_POLICY_KIND' using errcode = '22023';
  end if;
  return public.set_service_policy_active(p_kind, p_id, p_active, v_actor);
end $$;

create or replace function public.preview_staff_tier_discount_create(p_input jsonb)
returns setof public.service_tier_discounts language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.catalog', 'create');
begin
  if jsonb_typeof(p_input) <> 'object' then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  return query with ins as (
    insert into public.service_tier_discounts (service_id, tier, discount_rate, effective_start, effective_end, is_active, created_by)
    values (
      nullif(p_input->>'serviceId', '')::uuid,
      p_input->>'tier',
      (p_input->>'discountRate')::numeric,
      (p_input->>'effectiveStart')::date,
      (p_input->>'effectiveEnd')::date,
      true,
      v_actor
    ) returning *
  ), aud as (
    insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data)
    select v_actor, 'SERVICE_TIER_DISCOUNT_CREATED', 'service_tier_discount', ins.id::text,
      jsonb_build_object('serviceId', ins.service_id, 'tier', ins.tier, 'discountRate', ins.discount_rate)
    from ins returning 1
  ) select * from ins;
end $$;

create or replace function public.preview_staff_earning_rule_create(p_input jsonb)
returns table (id uuid, points_amount bigint, effective_start date, effective_end date, is_active boolean)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.catalog', 'create');
begin
  if jsonb_typeof(p_input) <> 'object' then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  if not exists (select 1 from public.service_catalog s where s.id = nullif(p_input->>'serviceId', '')::uuid and s.is_active) then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query with ins as (
    insert into public.point_earning_rules (service_id, points_amount, eligible_tiers, effective_start, effective_end, is_active, min_quantity, max_award, promotion_reference, created_by)
    values (
      nullif(p_input->>'serviceId', '')::uuid,
      (p_input->>'pointsAmount')::bigint,
      (select coalesce(array_agg(e order by e), '{}') from jsonb_array_elements_text(p_input->'eligibleTiers') e(e)),
      (p_input->>'effectiveStart')::date,
      (p_input->>'effectiveEnd')::date,
      coalesce((p_input->>'isActive')::boolean, true),
      coalesce((p_input->>'minQuantity')::int, 1),
      nullif(p_input->>'maxAward', '')::bigint,
      nullif(btrim(p_input->>'promotionReference'), ''),
      v_actor
    ) returning public.point_earning_rules.id, public.point_earning_rules.service_id, public.point_earning_rules.points_amount, public.point_earning_rules.effective_start, public.point_earning_rules.effective_end, public.point_earning_rules.is_active
  ), aud as (
    insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data)
    select v_actor, 'EARNING_RULE_CREATED', 'point_earning_rules', ins.id::text,
      jsonb_build_object('serviceId', ins.service_id, 'pointsAmount', ins.points_amount)
    from ins returning 1
  ) select ins.id, ins.points_amount, ins.effective_start, ins.effective_end, ins.is_active from ins;
end $$;

create or replace function public.preview_staff_redemption_rule_create(p_input jsonb)
returns setof public.point_redemption_rules language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.catalog', 'create');
begin
  if jsonb_typeof(p_input) <> 'object' then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  if not exists (select 1 from public.service_catalog s where s.id = nullif(p_input->>'serviceId', '')::uuid and s.is_active) then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_input->>'ruleKind' = 'accommodation'
    and not exists (select 1 from public.service_catalog s where s.id = nullif(p_input->>'serviceId', '')::uuid and s.is_staycation_eligible) then
    raise exception 'ACCOMMODATION_SERVICE_REQUIRED' using errcode = '22023';
  end if;
  return query with ins as (
    insert into public.point_redemption_rules (service_id, rule_kind, peso_value_per_point, eligible_tiers, min_points, max_points, min_purchase_amount, effective_start, effective_end, is_active, promotion_reference, allow_discount_stacking, created_by)
    values (
      nullif(p_input->>'serviceId', '')::uuid,
      coalesce(p_input->>'ruleKind', 'promotion'),
      (p_input->>'pesoValuePerPoint')::numeric,
      (select coalesce(array_agg(e order by e), '{}') from jsonb_array_elements_text(p_input->'eligibleTiers') e(e)),
      coalesce((p_input->>'minPoints')::bigint, 1),
      nullif(p_input->>'maxPoints', '')::bigint,
      nullif(p_input->>'minPurchaseAmount', ''),
      (p_input->>'effectiveStart')::date,
      (p_input->>'effectiveEnd')::date,
      coalesce((p_input->>'isActive')::boolean, true),
      nullif(btrim(p_input->>'promotionReference'), ''),
      coalesce((p_input->>'allowDiscountStacking')::boolean, false),
      v_actor
    ) returning *
  ), aud as (
    insert into public.audit_events(actor_id, action, entity_type, entity_id, after_data)
    select v_actor, 'REDEMPTION_RULE_CREATED', 'point_redemption_rules', ins.id::text,
      jsonb_build_object('serviceId', ins.service_id, 'pesoValuePerPoint', ins.peso_value_per_point,
        'effectiveStart', ins.effective_start, 'effectiveEnd', ins.effective_end,
        'promotionReference', ins.promotion_reference, 'allowDiscountStacking', ins.allow_discount_stacking)
    from ins returning 1
  ) select * from ins;
end $$;

create or replace function public.preview_staff_redemption_rule_patch(p_id uuid, p_patch jsonb)
returns setof public.point_redemption_rules language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_actor uuid := private.preview_require_staff('operations.catalog', 'update');
  v_before public.point_redemption_rules%rowtype;
  v_after public.point_redemption_rules%rowtype;
begin
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  select r.* into v_before from public.point_redemption_rules r where r.id = p_id for update;
  if not found then raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if (p_patch->>'minPoints')::bigint is not null and (p_patch->>'maxPoints')::bigint is not null
    and (p_patch->>'minPoints')::bigint > (p_patch->>'maxPoints')::bigint then
    raise exception 'INVALID_PROMOTION_RANGE' using errcode = '22023';
  end if;
  update public.point_redemption_rules r set
    peso_value_per_point = coalesce(nullif(p_patch->>'pesoValuePerPoint', '')::numeric, r.peso_value_per_point),
    eligible_tiers = coalesce((select array_agg(e order by e) from jsonb_array_elements_text(p_patch->'eligibleTiers') e(e)), r.eligible_tiers),
    min_points = coalesce((p_patch->>'minPoints')::bigint, r.min_points),
    max_points = case when p_patch ? 'maxPoints' then nullif(p_patch->>'maxPoints', '')::bigint else r.max_points end,
    min_purchase_amount = case when p_patch ? 'minPurchaseAmount' then nullif(p_patch->>'minPurchaseAmount', '') else r.min_purchase_amount end,
    effective_start = coalesce((p_patch->>'effectiveStart')::date, r.effective_start),
    effective_end = coalesce((p_patch->>'effectiveEnd')::date, r.effective_end),
    is_active = coalesce((p_patch->>'isActive')::boolean, r.is_active),
    promotion_reference = coalesce(nullif(btrim(p_patch->>'promotionReference'), ''), r.promotion_reference),
    allow_discount_stacking = coalesce((p_patch->>'allowDiscountStacking')::boolean, r.allow_discount_stacking),
    updated_at = now()
  where r.id = p_id returning * into v_after;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (v_actor, 'REDEMPTION_RULE_UPDATED', 'point_redemption_rules', p_id::text, to_jsonb(v_before), to_jsonb(v_after));
  return query select * from public.point_redemption_rules r where r.id = p_id;
  return;
end $$;

create or replace function public.preview_staff_create_purchase(p_membership_id uuid, p_lines jsonb, p_reference text, p_apply_tier_discount boolean default true)
returns table (purchase_id uuid, purchase_number text, gross_amount text, tier_discount_amount text, net_amount text)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.sales', 'create');
begin
  -- Gross is ALWAYS server-priced from the catalog; the browser names services
  -- and quantities only, exactly like the service path ('0.00' there too).
  return query select * from public.create_purchase(p_membership_id, '0.00', p_lines, p_reference, v_actor, p_apply_tier_discount);
  return;
end $$;

create or replace function public.preview_staff_record_payment(p_purchase_id uuid, p_amount text, p_method text, p_reference text)
returns table (payment_id uuid, payment_number text, amount text, status text)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.sales', 'create');
begin
  return query select * from public.record_purchase_payment(p_purchase_id, p_amount, p_method, p_reference, v_actor);
  return;
end $$;

create or replace function public.preview_staff_verify_payment(p_payment_id uuid, p_decision text, p_rejection_reason text)
returns table (payment_id uuid, status text, verified_total text)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.payments', 'update');
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'INVALID_PAYMENT_DECISION' using errcode = '22023';
  end if;
  return query select * from public.verify_purchase_payment(p_payment_id, p_decision, p_rejection_reason, v_actor);
  return;
end $$;

create or replace function public.preview_staff_prepare_quote(p_purchase_id uuid, p_points_requested bigint)
returns table (quote_id uuid, quote_number text, points_requested bigint, peso_value text, eligible_line_total text, remaining_points_after bigint, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.redemption', 'create');
begin
  return query select * from public.prepare_customer_point_redemption(p_purchase_id, p_points_requested, v_actor);
  return;
end $$;

create or replace function public.preview_staff_complete_purchase(p_purchase_id uuid)
returns table (purchase_id uuid, net_amount text, verified_total text, fully_paid boolean)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.sales', 'create');
begin
  return query select * from public.complete_purchase(p_purchase_id, v_actor);
  return;
end $$;

create or replace function public.preview_staff_reverse_purchase(p_purchase_id uuid, p_reason text)
returns table (reversed_points bigint, reversal_debt bigint, balance_after bigint)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.redemption', 'update');
begin
  return query select * from public.reverse_purchase_points(p_purchase_id, v_actor, p_reason);
  return;
end $$;

create or replace function public.preview_staff_adjust_points(p_membership_id uuid, p_amount bigint, p_reason text)
returns table (balance_after bigint, reversal_debt bigint)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.redemption', 'update');
begin
  return query select * from public.adjust_membership_points(p_membership_id, p_amount, p_reason, v_actor);
  return;
end $$;

create or replace function public.preview_staff_create_claim(p_purchase_id uuid)
returns table (claim_id uuid, claim_number text, qr_token text, fallback_code text, points_requested bigint, points_reserved bigint, points_capped bigint, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.redemption', 'create');
begin
  return query select * from public.create_earning_claim(p_purchase_id, v_actor);
  return;
end $$;

create or replace function public.preview_staff_reissue_claim(p_claim_id uuid)
returns table (claim_number text, qr_token text, fallback_code text, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.redemption', 'create');
begin
  return query select * from public.reissue_earning_claim(p_claim_id, v_actor);
  return;
end $$;

create or replace function public.preview_staff_refund_points(p_purchase_id uuid, p_service_value text, p_reference text, p_reason text, p_service_review_confirmed boolean)
returns table (points_restored bigint, balance_after bigint, refund_id uuid)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.payments', 'update');
begin
  return query select * from public.refund_purchase_redeemed_points(p_purchase_id, p_service_value, p_reference, p_reason, p_service_review_confirmed, v_actor);
  return;
end $$;

create or replace function public.preview_staff_cancel_reserved(p_purchase_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.payments', 'update');
begin
  perform public.cancel_reserved_point_purchase(p_purchase_id, p_reason, v_actor);
end $$;

create or replace function public.preview_staff_manage_refund(p_purchase_id uuid, p_refund_id uuid, p_operation text, p_input jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.payments', 'update');
begin
  if p_operation not in ('request', 'approve', 'reject', 'cancel', 'repay') or jsonb_typeof(p_input) <> 'object' then
    raise exception 'INVALID_REFUND_OPERATION' using errcode = '22023';
  end if;
  return public.manage_service_refund(p_purchase_id, p_refund_id, p_operation, p_input, v_actor);
end $$;

create or replace function public.preview_staff_reconcile_receipt(p_purchase_id uuid, p_refund_id uuid, p_upload_audit_id bigint, p_reason text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := private.preview_require_staff('operations.payments', 'update');
begin
  return public.reconcile_service_refund_receipt(p_purchase_id, p_refund_id, p_upload_audit_id, v_actor, p_reason);
end $$;

-- ===========================================================================
-- 3. Staff read wrappers: permission-gated, scoped, no PII beyond the job
-- ===========================================================================

create or replace function public.preview_staff_purchases(p_customer_id uuid default null, p_mine_only boolean default false, p_page integer default 0)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_all boolean := private.has_permission_for_user(v_actor, 'sales.customers', 'view')
    or private.has_permission_for_user(v_actor, 'operations.payments', 'view');
  v_mine boolean := private.has_permission_for_user(v_actor, 'operations.sales', 'view');
begin
  if v_actor is null or (not v_all and not v_mine) then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  if p_page is null or p_page < 0 then raise exception 'INVALID_PAGE' using errcode = '22023'; end if;
  return jsonb_build_object(
    'purchases', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb)
      from (select p.id, p.purchase_number, p.customer_id, p.membership_id, p.status, p.gross_amount, p.tier_discount_amount, p.tier_snapshot, p.points_discount_amount, p.net_amount, p.created_by, p.completed_at, p.reversed_at, p.reversal_reason, p.created_at
        from public.purchases p
        where (v_all or p.created_by = v_actor)
          and (p_customer_id is null or p.customer_id = p_customer_id)
        order by p.created_at desc, p.id desc limit 200 offset (p_page * 200)) p),
    'payments', (select coalesce(jsonb_agg(to_jsonb(pay) order by pay.purchase_id), '[]'::jsonb)
      from (select pay.purchase_id, pay.amount, pay.status from public.purchase_payments pay
        where pay.purchase_id in (select p.id from public.purchases p where (v_all or p.created_by = v_actor)
          and (p_customer_id is null or p.customer_id = p_customer_id)
          order by p.created_at desc, p.id desc limit 200 offset (p_page * 200))) pay),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'first_name', c.first_name, 'middle_name', c.middle_name, 'last_name', c.last_name)), '[]'::jsonb)
      from public.customers c where c.id in (select distinct p.customer_id from public.purchases p
        where (v_all or p.created_by = v_actor) and (p_customer_id is null or p.customer_id = p_customer_id))),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'full_name', s.full_name)), '[]'::jsonb)
      from public.staff_users s where s.id in (select distinct p.created_by from public.purchases p
        where (v_all or p.created_by = v_actor) and (p_customer_id is null or p.customer_id = p_customer_id))),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('purchase_id', ec.purchase_id, 'status', ec.status)), '[]'::jsonb)
      from public.earning_claims ec where ec.purchase_id in (select p.id from public.purchases p
        where (v_all or p.created_by = v_actor) and (p_customer_id is null or p.customer_id = p_customer_id))),
    'lines', (select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb)
      from (select pl.id, pl.purchase_id, pl.service_id, pl.service_name_snapshot, pl.pricing_unit_snapshot, pl.quantity, pl.unit_amount, pl.line_total, pl.tier_discount_amount, pl.tier_discount_rate, pl.tier
        from public.purchase_lines pl where pl.purchase_id in (select p.id from public.purchases p
          where (v_all or p.created_by = v_actor) and (p_customer_id is null or p.customer_id = p_customer_id))) pl)
  );
end $$;

create or replace function public.preview_staff_payments(p_purchase_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.payments', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(pay) order by pay.recorded_at desc), '[]'::jsonb)
    from (select id, payment_number, amount, method, reference, status, recorded_by, verified_by, recorded_at, verified_at, rejection_reason
      from public.purchase_payments where purchase_id = p_purchase_id order by recorded_at desc) pay);
end $$;

create or replace function public.preview_staff_claim(p_claim_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.redemption', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return (select to_jsonb(ec) from (select id, claim_number, customer_id, purchase_id, account_id, status, points_requested, points_awarded, points_capped, period_id, expires_at, claimed_at, created_at
    from public.earning_claims where id = p_claim_id) ec);
end $$;

create or replace function public.preview_staff_claims(p_page integer default 0)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.redemption', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  if p_page is null or p_page < 0 then raise exception 'INVALID_PAGE' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(ec) order by ec.created_at desc, ec.id desc), '[]'::jsonb)
    from (select ec.id, ec.claim_number, ec.customer_id, ec.purchase_id, ec.status, ec.points_requested, ec.points_awarded, ec.points_capped, ec.expires_at, ec.claimed_at, ec.created_at,
      c.customer_number, c.first_name, c.middle_name, c.last_name, m.membership_number, p.purchase_number, sc.name as service_name
      from public.earning_claims ec
      join public.customers c on c.id = ec.customer_id
      join public.memberships m on m.id = ec.membership_id
      join public.purchases p on p.id = ec.purchase_id
      join public.service_catalog sc on sc.id = ec.service_id
      order by ec.created_at desc, ec.id desc limit 200 offset (p_page * 200)) ec);
end $$;

create or replace function public.preview_staff_summary(p_purchase_id uuid)
returns table (purchase_id uuid, gross_amount text, tier_discount_amount text, points_discount_amount text, net_amount text, recorded_total text, verified_total text, rejected_total text, remaining_balance text, overpaid_amount text, fully_paid boolean)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501'; end if;
  -- Same rule as the service path: Finance reads first, otherwise the seller.
  if not private.has_permission_for_user(v_actor, 'operations.payments', 'view')
    and not private.has_permission_for_user(v_actor, 'operations.sales', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return query select * from public.purchase_financial_summary_purchases(p_purchase_id);
  return;
end $$;

create or replace function public.preview_staff_settlement(p_purchase_id uuid)
returns table (purchase_id uuid, purchase_number text, status text, gross_amount text, tier_discount_amount text, points_discount_amount text, net_amount text, recorded_total text, verified_total text, rejected_total text, remaining_amount text, verified_receipts int, rejected_receipts int, pending_receipts int, fully_paid boolean, claimable boolean, claim_id uuid, claim_status text)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501'; end if;
  if not private.has_permission_for_user(v_actor, 'operations.payments', 'view')
    and not private.has_permission_for_user(v_actor, 'operations.sales', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return query select * from public.operational_purchase_settlement(p_purchase_id);
  return;
end $$;

create or replace function public.preview_staff_services()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.catalog', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  -- Photo bytes stay in Storage: signed URLs need the service key, so Preview
  -- receives the stored photo metadata and renders no images for now.
  return (select coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
    from (select id, code, name, description, base_price, is_active, is_staycation_eligible, published, availability, photos, details
      from public.service_catalog order by name limit 200) s);
end $$;

create or replace function public.preview_staff_tier_discounts()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.catalog', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.service_id, t.tier), '[]'::jsonb)
    from (select id, service_id, tier, discount_rate, effective_start, effective_end, is_active
      from public.service_tier_discounts order by service_id, tier) t);
end $$;

create or replace function public.preview_staff_earning_rules()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.catalog', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    from (select id, service_id, points_amount, eligible_tiers, effective_start, effective_end, is_active, min_quantity, max_award, promotion_reference, created_at, updated_at
      from public.point_earning_rules order by created_at desc) r);
end $$;

create or replace function public.preview_staff_redemption_rules()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501'; end if;
  if not private.has_permission_for_user(v_actor, 'operations.sales', 'view')
    and not private.has_permission_for_user(v_actor, 'operations.catalog', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    from (select * from public.point_redemption_rules order by created_at desc) r);
end $$;

create or replace function public.preview_staff_point_refunds(p_purchase_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.payments', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.reviewed_at desc), '[]'::jsonb)
    from (select id, service_value, points_restored, refund_reference, reason, reviewed_by, reviewed_at
      from public.purchase_point_refunds where purchase_id = p_purchase_id order by reviewed_at desc) r);
end $$;

create or replace function public.preview_staff_refund_history(p_purchase_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.payments', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  return public.service_refund_history(p_purchase_id, null);
end $$;

create or replace function public.preview_staff_resolve_member(p_identifier text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_raw text := nullif(btrim(p_identifier), '');
  v_compact text;
  v_norm text;
  v_hash text;
  v_card text;
  v_row record;
  v_matched text := null;
  v_balance bigint;
begin
  if auth.uid() is null or not private.has_permission_for_user(auth.uid(), 'operations.redemption', 'view') then
    raise exception 'PREVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  if v_raw is null or char_length(v_raw) < 4 or char_length(v_raw) > 200 then return null; end if;
  v_compact := upper(replace(replace(v_raw, '-', ''), ' ', ''));
  if v_compact ~ '^AFH[0-9A-F]{8}$' then
    v_norm := 'AFH-' || substr(v_compact, 4, 4) || '-' || substr(v_compact, 8, 4);
  else
    v_norm := v_raw;
  end if;
  v_hash := private.hash_token(v_norm);
  select m.* into v_row from public.memberships m
  where m.qr_token_hash = v_hash or m.fallback_code_hash = v_hash limit 1;
  if found then
    v_matched := case when v_row.qr_token_hash = v_hash then 'qr' else 'fallback_code' end;
  else
    v_card := upper(v_raw);
    if v_card like 'AFHOMES:%' then v_card := btrim(substr(v_card, 10)); end if;
    if v_card ~ '^MBS-[A-Z0-9-]{1,64}$' then
      select m.* into v_row from public.memberships m where m.membership_number = v_card limit 1;
      if found then v_matched := 'card_number'; end if;
    end if;
    if v_matched is null and v_card ~ '^MBS-[A-Z0-9-]{1,64}$' then
      select m.* into v_row from public.memberships m
      where m.id = (select a.membership_id from private.resolve_membership_code(v_card) a limit 1);
      if found then v_matched := 'legacy_alias'; end if;
    end if;
  end if;
  if v_matched is null then return null; end if;
  select a.balance into v_balance from public.points_accounts a where a.membership_id = v_row.id;
  return jsonb_build_object(
    'membershipId', v_row.id,
    'membershipNumber', v_row.membership_number,
    'customerId', v_row.customer_id,
    'customerDisplayName', (select btrim(concat_ws(' ', c.first_name, c.middle_name, c.last_name, c.suffix)) from public.customers c where c.id = v_row.customer_id),
    'customerStatus', (select c.status from public.customers c where c.id = v_row.customer_id),
    'productName', (select p.name from public.card_plans p where p.id = v_row.product_id),
    'membershipStatus', v_row.status,
    'expired', v_row.expires_at is not null and v_row.expires_at <= now(),
    'redeemable', (select c.status from public.customers c where c.id = v_row.customer_id) = 'active'
      and v_row.status = 'active' and (v_row.expires_at is null or v_row.expires_at > now()),
    'blockedReason', case
      when (select c.status from public.customers c where c.id = v_row.customer_id) is distinct from 'active'
        then 'The customer account is ' || (select c.status from public.customers c where c.id = v_row.customer_id) || '.'
      when v_row.status is distinct from 'active' then 'The membership is ' || v_row.status || '.'
      when v_row.expires_at is not null and v_row.expires_at <= now() then 'The membership has expired.'
      else null end,
    'pointsBalance', coalesce(v_balance, v_row.points_balance, 0),
    'matchedBy', v_matched
  );
end $$;

-- ===========================================================================
-- 4. Grants: authenticated only, never anon, no table changes
-- ===========================================================================
--
-- Every preview entry point is hidden from anon and executable by
-- authenticated only. The DEFINER owner performs the reads and the
-- delegation, and each function re-validates its caller first.

do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'preview\_%' loop
    execute format('revoke all on function %s from public, anon', f.oid::regprocedure);
    execute format('grant execute on function %s to authenticated', f.oid::regprocedure);
  end loop;
end $$;