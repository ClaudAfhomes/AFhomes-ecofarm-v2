-- Withdrawal min/max enforcement (config wiring).
--
-- MIN_WITHDRAWAL_AMOUNT / MAX_WITHDRAWAL_AMOUNT were configurable rows with
-- no consumer: `withdraw_reserve` only rejected non-positive amounts and
-- over-balance requests, so the configured limits were decorative. This
-- migration re-creates `withdraw_reserve` (full replace, same signature and
-- idempotency semantics as 20260924000001) with two added guards:
--   - amount < MIN_WITHDRAWAL_AMOUNT → VALIDATION_ERROR (400)
--   - amount > MAX_WITHDRAWAL_AMOUNT → VALIDATION_ERROR (400)
-- Limits are read from SystemConfig per call so super_admin edits apply
-- immediately without redeploy (BR-CFG-001). Missing or malformed config
-- skips the corresponding guard instead of failing (fail-open on
-- misconfiguration, never block legitimate withdrawals silently).
-- Down: re-run 20260924000001_payout_unification.sql to restore the
-- limit-free body.

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
     set "availableBalance" = to_char(v_available::numeric - p_amount::numeric, 'FM99999999999999999999.00'),
         "pendingAmount" = to_char(coalesce("pendingAmount",'0.00')::numeric + p_amount::numeric, 'FM99999999999999999999.00'),
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

-- NOTE (down): re-run 20260924000001_payout_unification.sql.
