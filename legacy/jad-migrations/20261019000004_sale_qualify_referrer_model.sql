-- Sale qualification now pays the sale's selected referrer (referrer model).
--
-- Change: the 4% DIRECT_REFERRAL commission is paid to `Sale.referrerId`
-- (the member picked from the seller's direct referrals) when set; when no
-- referrer is selected, no referral commission is issued. This replaces the
-- prior sponsor-based payee (`Member.sponsorId` of the seller). Free-text
-- referrers are disallowed in the UI (members only).
-- Existing sponsor-paid referral commissions are left as-is (no clawback);
-- the backfill in 20261019000003 matched referrerName to referrerId for
-- legacy sales.
--
-- Also preserves the return-shape fix from 20261019000002
-- (`to_jsonb(s) into v_sale_json` → flat `{"sale":{…}}`).
--
-- Pre-apply validation (run first):
--   select count(*) from "Sale" where "referrerId" is not null
--     and not exists (select 1 from "Member" m where m.id = "referrerId");
--   select count(*) from "Sale" where status='QUALIFYING_SALE'
--     and "referrerId" is not null
--     and not exists (select 1 from "Commission" c
--       where c."saleId" = "Sale".id and c."commissionType"='DIRECT_REFERRAL');
--
-- Down: re-run 20261019000002_sale_qualify_return_fix.sql (reverts to
-- sponsor-based referral).

create or replace function public.sale_qualify(
  p_id text,
  p_actor uuid,
  p_role text,
  p_patch jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sale record;
  v_sale_json jsonb;
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
  v_referrer uuid;
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
  update "Sale" set
    "propertyId" = coalesce((v_patch ->> 'propertyId'), "propertyId"),
    "propertyName" = coalesce((v_patch ->> 'propertyName'), "propertyName"),
    "propertyValue" = coalesce((v_patch ->> 'propertyValue'), "propertyValue"),
    "customerId" = coalesce((v_patch ->> 'customerId'), "customerId"),
    "customerName" = coalesce((v_patch ->> 'customerName'), "customerName"),
    "sellerId" = coalesce((v_patch ->> 'sellerId')::uuid, "sellerId"),
    "sellerName" = coalesce((v_patch ->> 'sellerName'), "sellerName"),
    "referrerId" = coalesce((v_patch ->> 'referrerId')::uuid, "referrerId"),
    "referrerName" = coalesce((v_patch ->> 'referrerName'), "referrerName"),
    status = 'QUALIFYING_SALE',
    "updatedAt" = v_now
    where id = p_id
    returning * into v_sale;
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
  -- Referrer-based DIRECT_REFERRAL: the member picked on the sale.
  v_referrer := v_sale."referrerId";
  if v_referrer is not null and v_referrer <> v_sale."sellerId" then
    if v_existing_referral = 0 then
      -- Validate the referrer is a real member (API already validates for
      -- new submissions; this is the defense for legacy/admin edits).
      if exists (select 1 from "Member" where id = v_referrer) then
        v_referral_amount := to_char(round(v_base * v_referral_rate::numeric, 2), 'FM99999999999999999999.00');
        v_referral_id := 'com-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
        insert into "Commission"
          (id, "memberId", "commissionType", "saleId", "baseValue", rate, amount, status, "createdAt")
          values (v_referral_id,
                  v_referrer, 'DIRECT_REFERRAL', p_id, v_sale."propertyValue",
                  v_referral_rate, v_referral_amount, 'PENDING', v_now);
        v_detail := v_detail || ' Referral commission issued and credited to referrer (AVAILABLE).';
      else
        v_detail := v_detail || ' Referrer not found, referral skipped.';
      end if;
    else
      v_detail := v_detail || ' Referral commission already exists (no duplicate).';
    end if;
  else
    -- No referrer selected or self-referral → no referral commission.
    if v_referrer = v_sale."sellerId" then
      v_detail := v_detail || ' Self-referral, referral skipped.';
    else
      v_detail := v_detail || ' No referrer selected, referral skipped.';
    end if;
  end if;
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
  select to_jsonb(s) into v_sale_json from "Sale" s where s.id = p_id;
  return jsonb_build_object('sale', v_sale_json);
end;
$$;

revoke execute on function public.sale_qualify(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sale_qualify(text, uuid, text, jsonb) to service_role;

-- Backfill: for already-qualified sales with a referrer but no referral row,
-- issue the missing DIRECT_REFERRAL via the normal clearing path.
-- Idempotent; uses current referral rate.
DO $$
declare
  v_rate text;
begin
  select value into v_rate from "SystemConfig" where key = 'COMMISSION_REFERRAL_RATE';
  if v_rate is null or v_rate !~ '^[0-9]+(\.[0-9]{1,4})?$' then
    raise notice 'referrer backfill skipped: COMMISSION_REFERRAL_RATE missing or malformed';
    return;
  end if;
  insert into "Commission"
    (id, "memberId", "commissionType", "saleId", "baseValue", rate, amount, status, "createdAt")
  select 'com-' || lower(substr(md5(random()::text || clock_timestamp()::text || s.id), 1, 12)),
         s."referrerId", 'DIRECT_REFERRAL', s.id, s."propertyValue", v_rate,
         to_char(round(s."propertyValue"::numeric * v_rate::numeric, 2), 'FM99999999999999999999.00'),
         'PENDING', now()
  from "Sale" s
  where s.status = 'QUALIFYING_SALE'
    and s."referrerId" is not null
    and s."propertyValue" ~ '^[0-9]+(\.[0-9]{1,2})?$'
    and not exists (
      select 1 from "Commission" c
      where c."saleId" = s.id and c."commissionType" = 'DIRECT_REFERRAL'
    );
  -- Immediately credit the newly inserted pending referrals.
  perform public.commission_clear_batch(0, null, 'system');
end $$;
