-- Sale qualification with immediate wallet credit (no 7-day wait).
--
-- Prior behavior: `sale_qualify` created Commission rows as PENDING and never
-- touched Wallet/Ledger - the amount only moved on a separate 7-day clearing
-- (commission_clear_batch via cron/manual, COMMISSION_CLEARING_DAYS='7').
-- New behavior: commissions are credited to the member's wallet immediately
-- within the same atomic transaction. The 7-day clearing functions/cron/manual
-- endpoint are retained as a dormant safety net for any legacy PENDING rows.
--
-- Implementation: after inserting each new PENDING commission, the same
-- transaction calls the audited `commission_clear(id, actor, role)` for that
-- commission, yielding AVAILABLE + clearedAt + LedgerEntry CREDIT + Wallet
-- availableBalance/totalEarned movement. Per-type idempotency is preserved
-- (only newly inserted rows are cleared, so re-entry never double-credits).
-- Auto-qualification, rate validation, and SALE_QUALIFIED audit are unchanged.
--
-- One-time sweep: all currently-PENDING commissions are cleared (window 0 =
-- all rows, regardless of age) so existing members see their pending amounts
-- immediately without waiting. Idempotent; re-running clears whatever is
-- still PENDING.
--
-- Pre-apply validation (run first):
--   -- pending rows before (expect legacy count, 0 after sweep):
--   select count(*) from "Commission" where status = 'PENDING';
--   -- show directly due referrals that the new logic will emit on re-entry:
--   select s.id from "Sale" s join "Member" m on m.id = s."sellerId"
--   where s.status = 'QUALIFYING_SALE' and m."sponsorId" is not null
--     and not exists (select 1 from "Commission" c
--       where c."saleId" = s.id and c."commissionType" = 'DIRECT_REFERRAL');
--
-- Down: re-run 20261017000002_sale_qualify_referral_fix.sql (re-creates the
-- PENDING-only variant) and keep the formatting fix from
-- 20261017000005_commission_clear_format_fix.sql.

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
  v_direct_id text;
  v_referral_id text;
  v_sponsor uuid;
  v_now timestamptz := now();
  v_existing_direct integer;
  v_existing_referral integer;
  v_detail text := '';
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_clear_res jsonb;
begin
  select * into v_sale from "Sale" where id = p_id for update;
  if v_sale.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Sale not found','status',404));
  end if;
  if v_sale.status <> 'PAYMENT_VERIFIED' and v_sale.status <> 'QUALIFYING_SALE' then
    return jsonb_build_object('error', jsonb_build_object('code','CONFLICT','message', format('Cannot transition sale from %s to QUALIFYING_SALE.', v_sale.status),'status',409));
  end if;
  -- Apply validated field edits; sellerId is uuid, so cast explicitly.
  update "Sale" set
    "propertyId" = coalesce((v_patch ->> 'propertyId'), "propertyId"),
    "propertyName" = coalesce((v_patch ->> 'propertyName'), "propertyName"),
    "propertyValue" = coalesce((v_patch ->> 'propertyValue'), "propertyValue"),
    "customerId" = coalesce((v_patch ->> 'customerId'), "customerId"),
    "customerName" = coalesce((v_patch ->> 'customerName'), "customerName"),
    "sellerId" = coalesce((v_patch ->> 'sellerId')::uuid, "sellerId"),
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
    raise exception 'Commission rates are not configured';
  end if;
  if v_sale."propertyValue" !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Sale property value is not a valid amount';
  end if;
  if v_sale."sellerId" is null then
    raise exception 'Sale has no seller; cannot issue commissions';
  end if;
  v_base := v_sale."propertyValue"::numeric;
  -- Idempotency per commissionType (never duplicate a row; safe re-entry).
  select count(*) into v_existing_direct from "Commission"
    where "saleId" = p_id and "commissionType" = 'DIRECT_COMMISSION';
  select count(*) into v_existing_referral from "Commission"
    where "saleId" = p_id and "commissionType" = 'DIRECT_REFERRAL';
  v_direct_id := null;
  v_referral_id := null;
  if v_existing_direct = 0 then
    v_direct_amount := to_char(round(v_base * v_direct_rate::numeric, 2), 'FM99999999999999999999.00');
    v_direct_id := 'com-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    insert into "Commission"
      (id, "memberId", "commissionType", "saleId", "baseValue", rate, amount, status, "createdAt")
      values (v_direct_id,
              v_sale."sellerId", 'DIRECT_COMMISSION', p_id, v_sale."propertyValue",
              v_direct_rate, v_direct_amount, 'PENDING', v_now);
    v_detail := 'Direct commission issued and credited (AVAILABLE).';
  else
    v_detail := 'Direct commission already exists (no duplicate).';
  end if;
  select "sponsorId" into v_sponsor from "Member" where id = v_sale."sellerId";
  if v_sponsor is not null then
    if v_existing_referral = 0 then
      v_referral_amount := to_char(round(v_base * v_referral_rate::numeric, 2), 'FM99999999999999999999.00');
      v_referral_id := 'com-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
      insert into "Commission"
        (id, "memberId", "commissionType", "saleId", "baseValue", rate, amount, status, "createdAt")
        values (v_referral_id,
                v_sponsor, 'DIRECT_REFERRAL', p_id, v_sale."propertyValue",
                v_referral_rate, v_referral_amount, 'PENDING', v_now);
      v_detail := v_detail || ' Referral commission issued and credited (AVAILABLE).';
    else
      v_detail := v_detail || ' Referral commission already exists (no duplicate).';
    end if;
  else
    v_detail := v_detail || ' No sponsor linked, referral skipped.';
  end if;
  -- Credit newly created commissions immediately (same transaction; wallet +
  -- ledger + audit per commission_clear, failure rolls back the whole qualify).
  if v_direct_id is not null then
    select public.commission_clear(v_direct_id, p_actor, p_role) into v_clear_res;
    if (v_clear_res ? 'error') then
      raise exception 'Failed to credit direct commission: %', (v_clear_res -> 'error' ->> 'message');
    end if;
  end if;
  if v_referral_id is not null then
    select public.commission_clear(v_referral_id, p_actor, p_role) into v_clear_res;
    if (v_clear_res ? 'error') then
      raise exception 'Failed to credit referral commission: %', (v_clear_res -> 'error' ->> 'message');
    end if;
  end if;
  -- Auto-qualification.
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

revoke execute on function public.sale_qualify(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sale_qualify(text, uuid, text, jsonb) to service_role;

-- One-time sweep: credit any currently-PENDING commissions immediately so
-- existing members do not wait for the daily cron. Window 0 = all PENDING
-- rows regardless of createdAt. Idempotent (re-applying clears 0 rows).
select public.commission_clear_batch(0, null, 'system');
