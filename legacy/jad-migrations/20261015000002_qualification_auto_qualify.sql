-- Auto-qualification on reaching the configured sales threshold.
--
-- QUALIFICATION_MIN_SALES was a configurable row with no consumer:
-- qualification was granted only by manual admin action
-- (PATCH /admin/members/:id), so the configured minimum meant nothing.
-- This migration re-creates `sale_qualify` (full replace, same signature and
-- idempotency semantics as 20260923000001) with one addition: after the
-- commissions are issued, the seller's QUALIFYING_SALE count is compared
-- against SystemConfig QUALIFICATION_MIN_SALES (default 1); when the count
-- reaches the threshold, `Member.isQualified` is set in the same
-- transaction and noted in the audit detail. Manual admin grant/revoke is
-- untouched and stays additive.
--
-- One-time backfill: members already at/over the threshold are qualified.
-- NOTE: this can qualify members an admin deliberately left unqualified - 
-- that is the owner-approved meaning of the configured minimum; the audit
-- log distinguishes manual grants (`MEMBER_UPDATED`) from these
-- (`SALE_QUALIFIED` detail note).
-- Down: re-run 20260923000001_sale_qualify.sql to restore the
-- commission-only body (backfilled flags stay; revoke manually if needed).

create or replace function public.sale_qualify(
  p_id text,
  p_actor uuid,
  p_role text,
  p_patch jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sale record;
  v_direct_rate text;
  v_referral_rate text;
  v_min_sales_raw text;
  v_min_sales integer := 1;
  v_qualifying_count integer := 0;
  v_is_qualified boolean := false;
  v_base numeric;
  v_direct_amount text;
  v_referral_amount text;
  v_sponsor uuid;
  v_now timestamptz := now();
  v_existing integer;
  v_detail text := '';
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select * into v_sale from "Sale" where id = p_id for update;
  if v_sale.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Sale not found','status',404));
  end if;
  if v_sale.status <> 'PAYMENT_VERIFIED' and v_sale.status <> 'QUALIFYING_SALE' then
    return jsonb_build_object('error', jsonb_build_object('code','CONFLICT','message', format('Cannot transition sale from %s to QUALIFYING_SALE.', v_sale.status),'status',409));
  end if;
  -- Apply validated field edits (customer/seller existence is pre-checked by
  -- the API layer); status itself is set below.
  update "Sale" set
    "propertyId" = coalesce((v_patch ->> 'propertyId'), "propertyId"),
    "propertyName" = coalesce((v_patch ->> 'propertyName'), "propertyName"),
    "propertyValue" = coalesce((v_patch ->> 'propertyValue'), "propertyValue"),
    "customerId" = coalesce((v_patch ->> 'customerId'), "customerId"),
    "customerName" = coalesce((v_patch ->> 'customerName'), "customerName"),
    "sellerId" = coalesce((v_patch ->> 'sellerId'), "sellerId"),
    "sellerName" = coalesce((v_patch ->> 'sellerName'), "sellerName"),
    status = 'QUALIFYING_SALE',
    "updatedAt" = v_now
    where id = p_id
    returning * into v_sale;
  -- Rates (validated shapes; fail loud on misconfiguration, never silently).
  select value into v_direct_rate from "SystemConfig" where key = 'COMMISSION_DIRECT_RATE';
  select value into v_referral_rate from "SystemConfig" where key = 'COMMISSION_REFERRAL_RATE';
  if v_direct_rate is null or v_direct_rate !~ '^[0-9]+(\.[0-9]{1,4})?$'
     or v_referral_rate is null or v_referral_rate !~ '^[0-9]+(\.[0-9]{1,4})?$' then
    -- Roll back the whole transition on bad config (single transaction).
    raise exception 'Commission rates are not configured';
  end if;
  if v_sale."propertyValue" !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Sale property value is not a valid amount';
  end if;
  if v_sale."sellerId" is null then
    raise exception 'Sale has no seller; cannot issue commissions';
  end if;
  v_base := v_sale."propertyValue"::numeric;
  -- Idempotency: never duplicate commissions for a sale (safe re-entry).
  select count(*) into v_existing from "Commission" where "saleId" = p_id;
  if v_existing = 0 then
    v_direct_amount := to_char(round(v_base * v_direct_rate::numeric, 2), 'FM99999999999999999999.00');
    insert into "Commission"
      (id, "memberId", "commissionType", "saleId", "baseValue", rate, amount, status, "createdAt")
      values ('com-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
              v_sale."sellerId", 'DIRECT_COMMISSION', p_id, v_sale."propertyValue",
              v_direct_rate, v_direct_amount, 'PENDING', v_now);
    select "sponsorId" into v_sponsor from "Member" where id = v_sale."sellerId";
    if v_sponsor is not null then
      v_referral_amount := to_char(round(v_base * v_referral_rate::numeric, 2), 'FM99999999999999999999.00');
      insert into "Commission"
        (id, "memberId", "commissionType", "saleId", "baseValue", rate, amount, status, "createdAt")
        values ('com-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
                v_sponsor, 'DIRECT_REFERRAL', p_id, v_sale."propertyValue",
                v_referral_rate, v_referral_amount, 'PENDING', v_now);
      v_detail := 'Direct + referral commissions issued (PENDING).';
    else
      v_detail := 'Direct commission issued (PENDING); no sponsor linked, referral skipped.';
    end if;
  else
    v_detail := 'Sale already qualified; existing commissions kept (no duplicates).';
  end if;
  -- Auto-qualification: the configured minimum qualifying-sales count
  -- (QUALIFICATION_MIN_SALES, default 1) grants isQualified in this same
  -- transaction. Malformed config falls back to 1; a missing row means 1.
  select value into v_min_sales_raw from "SystemConfig" where key = 'QUALIFICATION_MIN_SALES';
  if v_min_sales_raw is not null and v_min_sales_raw ~ '^[0-9]+$'
     and v_min_sales_raw::integer >= 1 then
    v_min_sales := v_min_sales_raw::integer;
  end if;
  select count(*) into v_qualifying_count from "Sale"
    where "sellerId" = v_sale."sellerId" and status = 'QUALIFYING_SALE';
  select coalesce("isQualified", false) into v_is_qualified from "Member"
    where id = v_sale."sellerId";
  if v_qualifying_count >= v_min_sales and not v_is_qualified then
    update "Member" set "isQualified" = true where id = v_sale."sellerId";
    v_detail := v_detail || format(' Member auto-qualified (%s/%s qualifying sales).', v_qualifying_count, v_min_sales);
  end if;
  insert into "AuditLog" (action, actor_id, actor_role, target_type, target_id, target_name, detail, created_at)
    values ('SALE_QUALIFIED', p_actor, p_role, 'Sale', p_id,
            v_sale."propertyName" || ' - ' || v_sale."customerName",
            'Qualified sale ' || p_id || '. ' || v_detail, v_now);
  select to_jsonb(s) into v_sale from "Sale" s where s.id = p_id;
  return jsonb_build_object('sale', v_sale);
end;
$$;

-- Only the service-role API layer may invoke this (it writes money-adjacent
-- records and audits as any actor id it is given).
revoke execute on function public.sale_qualify(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sale_qualify(text, uuid, text, jsonb) to service_role;

-- One-time backfill: qualify members already at/over the configured
-- threshold. Idempotent (only flips false → true). See header note about
-- deliberately-unqualified members.
DO $$
declare
  v_threshold integer := 1;
  v_raw text;
begin
  select value into v_raw from "SystemConfig" where key = 'QUALIFICATION_MIN_SALES';
  if v_raw is not null and v_raw ~ '^[0-9]+$' and v_raw::integer >= 1 then
    v_threshold := v_raw::integer;
  end if;
  update "Member" m
    set "isQualified" = true
    where coalesce(m."isQualified", false) = false
      and (select count(*) from "Sale" s
             where s."sellerId" = m.id and s.status = 'QUALIFYING_SALE') >= v_threshold;
end $$;

-- NOTE (down): re-run 20260923000001_sale_qualify.sql.
