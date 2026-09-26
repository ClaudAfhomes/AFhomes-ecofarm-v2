-- Withdrawal money-format fix: wallet-cell masks must render zero as 0.00.
--
-- `to_char(x, 'FM99999999999999999999.00')` (the '.00' vs '990.00' quirk)
-- renders zero as `.00` - FM strips every 9 of the integer part, so the
-- whole-number field disappears. The `Wallet` money CHECK constraints
-- (`wallet_available_check` / `wallet_pending_check`, money_amount_check
-- format) reject that string with `violates check constraint` -> the whole
-- transaction rolls back. Seen live (2026-09-20): POST
-- /admin/withdrawals/:id/complete 500 INTERNAL "wallet_pending_check" - the
-- first completion moved pendingAmount to exactly 0.00.
--
-- This migration re-creates all three withdrawal money functions with the
-- proven mask `FM999999999999999999990.00` (same fix class as
-- 20261017000005_commission_clear_format_fix + sale_qualify family). Bodies
-- byte-match the live definitions (withdraw_reserve carries the 20261015
-- min/max limits; complete/reject from 20260920000001) apart from the mask.
--
-- Down: drop and re-create the three functions with the '.00'-mask bodies
-- from 20260920000001_money_functions.sql / 20261015000001_withdrawal_limits.sql.
--
create or replace function public.withdraw_reserve(
  p_member uuid,
  p_account_id text,
  p_amount text,
  p_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_account record;
  v_available text;
  v_id text;
  v_now timestamptz := now();
  v_wire jsonb;
  v_min text;
  v_max text;
begin
  if p_key is null or p_key = '' then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Idempotency-Key header is required.','status',400));
  end if;
  select response into v_replay from "IdempotencyKey"
    where key = 'POST:/me/withdrawals:' || p_key and "memberId" = p_member
      and ("expiresAt" is null or "expiresAt" > now());
  if v_replay is not null then
    return jsonb_build_object('created', false, 'withdrawal', v_replay);
  end if;
  if not public.money_amount_check(p_amount) then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Enter a valid amount.','status',400));
  end if;
  if p_amount::numeric <= 0 then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Enter a withdrawal amount greater than zero.','status',400));
  end if;
  -- Configured minimum (fail-open on missing/malformed rows).
  select value into v_min from "SystemConfig" where key = 'MIN_WITHDRAWAL_AMOUNT';
  if v_min is not null and v_min ~ '^[0-9]+(\.[0-9]{1,2})?$'
     and p_amount::numeric < v_min::numeric then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message', format('The withdrawal amount is below the minimum of %s.', v_min),'status',400));
  end if;
  select * into v_account from "PayoutAccount"
    where id = p_account_id and "memberId" = p_member;
  if v_account.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Payout account not found.','status',404));
  end if;
  if v_account.status <> 'CONFIRMED' then
    return jsonb_build_object('error', jsonb_build_object('code','PAYOUT_ACCOUNT_UNVERIFIED','message','Only verified payout accounts can be used for withdrawal.','status',422));
  end if;
  insert into "Wallet"("memberId","availableBalance","pendingAmount","totalWithdrawals","totalEarned")
    values (p_member, '0.00','0.00','0.00','0.00') on conflict ("memberId") do nothing;
  select "availableBalance" into v_available from "Wallet"
    where "memberId" = p_member for update;
  if p_amount::numeric > v_available::numeric then
    return jsonb_build_object('error', jsonb_build_object('code','INSUFFICIENT_BALANCE','message','The withdrawal amount exceeds your Available Balance.','status',409));
  end if;
  -- Configured maximum, checked after the balance so over-balance requests
  -- keep the INSUFFICIENT_BALANCE contract; the cap binds affordable amounts.
  select value into v_max from "SystemConfig" where key = 'MAX_WITHDRAWAL_AMOUNT';
  if v_max is not null and v_max ~ '^[0-9]+(\.[0-9]{1,2})?$'
     and p_amount::numeric > v_max::numeric then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message', format('The withdrawal amount exceeds the maximum of %s.', v_max),'status',400));
  end if;
  v_id := 'wdr-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  insert into "Withdrawal"
    (id, "memberId", "payoutAccountId", "accountMethod", "accountName",
     "accountIdentifierMasked", amount, status, "reservedAt", "createdAt")
  values
    (v_id, p_member, v_account.id, v_account.method, v_account."accountName",
     public.mask_identifier(v_account."accountIdentifier"), p_amount, 'RESERVED', v_now, v_now);
  insert into "LedgerEntry" (id, "memberId", "entryType", direction, amount, "createdAt")
    values ('led-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
            p_member, 'WITHDRAWAL_RESERVATION', 'DEBIT', p_amount, v_now);
  update "Wallet"
     set "availableBalance" = to_char(v_available::numeric - p_amount::numeric, 'FM999999999999999999990.00'),
         "pendingAmount" = to_char(coalesce("pendingAmount",'0.00')::numeric + p_amount::numeric, 'FM999999999999999999990.00'),
         "totalWithdrawals" = coalesce("totalWithdrawals",'0.00'),
         "totalEarned" = coalesce("totalEarned",'0.00')
   where "memberId" = p_member;
  v_wire := jsonb_build_object(
    'id', v_id, 'amount', p_amount, 'status', 'RESERVED',
    'payoutAccount', jsonb_build_object('id', v_account.id, 'method', v_account.method,
      'accountName', v_account."accountName",
      'accountIdentifierMasked', public.mask_identifier(v_account."accountIdentifier")),
    'reservedAt', v_now, 'createdAt', v_now);
  insert into "IdempotencyKey" (key, "memberId", response, "expiresAt", "createdAt")
    values ('POST:/me/withdrawals:' || p_key, p_member, v_wire,
            now() + interval '24 hours', v_now);
  return jsonb_build_object('created', true, 'withdrawal', v_wire);
end;
$$;
revoke execute on function public.withdraw_reserve(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.withdraw_reserve(uuid, text, text, text) to service_role;

create or replace function public.withdrawal_complete(
  p_id text, p_actor uuid, p_role text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_w record;
  v_now timestamptz := now();
  v_pending text;
begin
  select * into v_w from "Withdrawal" where id = p_id for update;
  if v_w.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Withdrawal not found','status',404));
  end if;
  if v_w.status not in ('RESERVED','REQUESTED') then
    return jsonb_build_object('error', jsonb_build_object('code','CONFLICT','message', format('Only reserved withdrawals can be completed (current: %s).', v_w.status),'status',409));
  end if;
  update "Withdrawal" set status='COMPLETED', "completedAt"=v_now where id=p_id;
  if v_w."memberId" is not null then
    insert into "LedgerEntry" (id, "memberId", "entryType", direction, amount, "createdAt")
      values ('led-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
              v_w."memberId", 'WITHDRAWAL_COMPLETION', 'DEBIT', v_w.amount, v_now);
    select "pendingAmount" into v_pending from "Wallet" where "memberId" = v_w."memberId";
    update "Wallet"
       set "pendingAmount" = to_char(coalesce(v_pending,'0.00')::numeric - v_w.amount::numeric, 'FM999999999999999999990.00'),
           "totalWithdrawals" = to_char(coalesce("totalWithdrawals",'0.00')::numeric + v_w.amount::numeric, 'FM999999999999999999990.00')
     where "memberId" = v_w."memberId";
  end if;
  insert into "AuditLog" (action, actor_id, actor_role, target_type, target_id, target_name, detail, created_at)
    values ('WITHDRAWAL_COMPLETED', p_actor, p_role, 'Withdrawal', p_id,
            'Withdrawal ' || p_id || ' - ' || v_w.amount, 'Completed withdrawal ' || p_id, v_now);
  return jsonb_build_object('status', 'COMPLETED', 'completedAt', v_now, 'amount', v_w.amount);
end;
$$;

-- Staff reject: RESERVED/REQUESTED -> REJECTED (reason mandatory, <=500).
create or replace function public.withdrawal_reject(
  p_id text, p_reason text, p_actor uuid, p_role text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_w record;
  v_now timestamptz := now();
  v_avail text;
begin
  if p_reason is null or trim(p_reason) = '' then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Rejection reason is required.','status',400));
  end if;
  if length(p_reason) > 500 then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Rejection reason must be 500 characters or fewer.','status',400));
  end if;
  select * into v_w from "Withdrawal" where id = p_id for update;
  if v_w.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Withdrawal not found','status',404));
  end if;
  if v_w.status not in ('RESERVED','REQUESTED') then
    return jsonb_build_object('error', jsonb_build_object('code','CONFLICT','message', format('Only reserved withdrawals can be rejected (current: %s).', v_w.status),'status',409));
  end if;
  update "Withdrawal" set status='REJECTED', "rejectedAt"=v_now, "rejectionReason"=p_reason where id=p_id;
  if v_w."memberId" is not null then
    insert into "LedgerEntry" (id, "memberId", "entryType", direction, amount, "createdAt")
      values ('led-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
              v_w."memberId", 'WITHDRAWAL_REVERSAL', 'CREDIT', v_w.amount, v_now);
    select "availableBalance" into v_avail from "Wallet" where "memberId" = v_w."memberId";
    update "Wallet"
       set "availableBalance" = to_char(coalesce(v_avail,'0.00')::numeric + v_w.amount::numeric, 'FM999999999999999999990.00'),
           "pendingAmount" = to_char(coalesce("pendingAmount",'0.00')::numeric - v_w.amount::numeric, 'FM999999999999999999990.00')
     where "memberId" = v_w."memberId";
  end if;
  insert into "AuditLog" (action, actor_id, actor_role, target_type, target_id, target_name, detail, created_at)
    values ('WITHDRAWAL_REJECTED', p_actor, p_role, 'Withdrawal', p_id,
            'Withdrawal ' || p_id || ' - ' || v_w.amount,
            'Rejected withdrawal ' || p_id || ': ' || p_reason, v_now);
  return jsonb_build_object('status', 'REJECTED', 'rejectedAt', v_now, 'amount', v_w.amount);
end;
$$;

-- Restrict execution: these SECURITY DEFINER functions must only ever be
-- invoked by the service-role client (the API handlers). Anonymous and
-- authenticated users get no EXECUTE - otherwise any signed-in member could
-- call withdrawal_complete/reject on arbitrary ids, or withdraw_reserve
-- against another member's wallet.
revoke execute on function public.withdrawal_complete(text, uuid, text) from public, anon, authenticated;
grant execute on function public.withdrawal_complete(text, uuid, text) to service_role;

revoke execute on function public.withdrawal_reject(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.withdrawal_reject(text, text, uuid, text) to service_role;

-- Validation gate (post-apply; every row must show good=true, bad=false):
--   select p.proname, p.prosrc like '%990.00%' as good, p.prosrc like '%999.00%' as bad
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in
--      ('withdraw_reserve','withdrawal_complete','withdrawal_reject');
--
