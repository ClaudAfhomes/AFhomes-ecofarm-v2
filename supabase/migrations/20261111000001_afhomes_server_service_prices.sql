-- Server-authoritative operational prices and serialized idempotency.
-- Validation: pnpm test:db:local, including forged-zero-price and concurrent retries.
-- select count(*) from public.purchases where gross_amount::numeric < 0;
-- Down: do not restore browser-provided prices or unguarded retry lookups.
create or replace function public.create_purchase(
  p_membership_id uuid, p_gross_amount text, p_lines jsonb, p_reference text, p_actor_id uuid
) returns table (purchase_id uuid, purchase_number text, gross_amount text, tier_discount_amount text, net_amount text)
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_member public.memberships%rowtype;
  v_customer public.customers%rowtype;
  v_existing public.purchases%rowtype;
  v_service public.service_catalog%rowtype;
  v_discount public.service_tier_discounts%rowtype;
  v_reference text := nullif(btrim(p_reference), '');
  v_id uuid;
  v_number text;
  v_tier text;
  v_line jsonb;
  v_quantity int;
  v_total numeric;
  v_reduction numeric;
  v_gross numeric := 0;
  v_discounts numeric := 0;
begin
  perform private.mutation_actor_role(p_actor_id, 'operations.sales', 'create');
  if v_reference is null or length(v_reference) > 120 then
    raise exception 'SALE_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('operational-sale:' || v_reference, 0));
  select p.* into v_existing from public.purchases p where p.idempotency_reference = v_reference;
  if found then
    if v_existing.created_by <> p_actor_id or v_existing.membership_id <> p_membership_id then
      raise exception 'SALE_REFERENCE_CONFLICT' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.purchase_number, v_existing.gross_amount, v_existing.tier_discount_amount, v_existing.net_amount;
    return;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> 1 then
    raise exception 'PURCHASE_HAS_NO_LINES' using errcode = '22023';
  end if;
  select m.* into v_member from public.memberships m where m.id = p_membership_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_member.status <> 'active' or v_member.expires_at <= now() then
    raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '55000';
  end if;
  select c.* into v_customer from public.customers c where c.id = v_member.customer_id;
  if v_customer.status <> 'active' then raise exception 'CUSTOMER_NOT_ACTIVE' using errcode = '55000'; end if;
  select cp.code into v_tier from public.card_plans cp where cp.id = v_member.product_id;
  insert into public.purchases as p (customer_id, membership_id, status, gross_amount, net_amount, tier_discount_amount, tier_snapshot, idempotency_reference, created_by)
  values (v_customer.id, v_member.id, 'draft', '0.00', '0.00', '0.00', v_tier, v_reference, p_actor_id)
  returning p.id, p.purchase_number into v_id, v_number;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line->>'quantity')::int;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'PURCHASE_QUANTITY_INVALID' using errcode = '22023';
    end if;
    select s.* into v_service from public.service_catalog s where s.id = (v_line->>'serviceId')::uuid and s.is_active and s.availability = 'available' for share;
    if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
    select d.* into v_discount from public.service_tier_discounts d
    where d.service_id = v_service.id and d.tier = v_tier and d.is_active
      and d.effective_start <= (now() at time zone 'Asia/Manila')::date
      and d.effective_end > (now() at time zone 'Asia/Manila')::date
    order by d.created_at desc, d.id desc limit 1 for share;
    v_total := v_service.base_price::numeric * v_quantity;
    v_reduction := least(v_total, round(v_total * coalesce(v_discount.discount_rate, 0) / 100, 2));
    insert into public.purchase_lines (purchase_id, service_id, quantity, unit_amount, line_total, tier_discount_amount, tier_discount_rate, tier, tier_discount_rule_id, service_name_snapshot, pricing_unit_snapshot)
    values (v_id, v_service.id, v_quantity, v_service.base_price, private.money(v_total), private.money(v_reduction), v_discount.discount_rate, case when v_discount.id is not null then v_tier end, v_discount.id, v_service.name, coalesce(v_service.details->>'pricingUnit','unit'));
    v_gross := v_gross + v_total;
    v_discounts := v_discounts + v_reduction;
  end loop;
  update public.purchases as p set gross_amount = private.money(v_gross), tier_discount_amount = private.money(v_discounts), net_amount = private.money(v_gross - v_discounts) where p.id = v_id;
  return query select v_id, v_number, private.money(v_gross), private.money(v_discounts), private.money(v_gross - v_discounts);
end $$;
revoke all on function public.create_purchase(uuid,text,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.create_purchase(uuid,text,jsonb,text,uuid) to service_role;
