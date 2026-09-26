-- Phase 3A - Atomic money functions (review F-07 / F-08 / F-23 / F-28; ADR-001).
--
-- The withdrawal reserve/complete/reject flows were N sequential PostgREST
-- writes from the API process (no transaction). These SECURITY DEFINER
-- functions run each flow as ONE transaction: row-lock the wallet, validate
-- state, write ledger + wallet + idempotency (and audit for staff actions).
-- Errors are RETURNED (never raised) as {error:{code,message,status}} so the
-- API maps them to the standard envelope without string-scraping.
-- Down: drop the five functions (note at the bottom).

create or replace function public.mask_identifier(p text) returns text
language sql immutable as $$
  select case when length(coalesce(p,'')) <= 4 then '••••'
              else '•••• ' || right(p, 4) end;
$$;

create or replace function public.money_amount_check(a text) returns boolean
language sql immutable as $$
  select a ~ '^[0-9]+(\.[0-9]{1,2})?$';
$$;

-- Reserve a withdrawal. Returns {created:boolean, withdrawal:{...wire}} or
-- {error:{code,message,status}}.
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
begin
  if p_key is null or p_key = '' then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Idempotency-Key header is required.','status',400));
  end if;
  -- Replay protection (24h TTL; null expiresAt = legacy no-expiry).
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
  select * into v_account from "MemberPayoutAccount"
    where id = p_account_id and "memberId" = p_member;
  if v_account.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Payout account not found.','status',404));
  end if;
  if v_account.status <> 'CONFIRMED' then
    return jsonb_build_object('error', jsonb_build_object('code','PAYOUT_ACCOUNT_UNVERIFIED','message','Only verified payout accounts can be used for withdrawal.','status',422));
  end if;
  -- Lock the wallet (created on demand). Insert-then-lock is safe when the
  -- row does not exist yet under concurrency.
  insert into "Wallet"("memberId","availableBalance","pendingAmount","totalWithdrawals","totalEarned")
    values (p_member, '0.00','0.00','0.00','0.00') on conflict ("memberId") do nothing;
  select "availableBalance" into v_available from "Wallet"
    where "memberId" = p_member for update;
  if p_amount::numeric > v_available::numeric then
    return jsonb_build_object('error', jsonb_build_object('code','INSUFFICIENT_BALANCE','message','The withdrawal amount exceeds your Available Balance.','status',409));
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

-- Staff complete: RESERVED/REQUESTED -> COMPLETED (audited in the same tx).
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
       set "pendingAmount" = to_char(coalesce(v_pending,'0.00')::numeric - v_w.amount::numeric, 'FM99999999999999999999.00'),
           "totalWithdrawals" = to_char(coalesce("totalWithdrawals",'0.00')::numeric + v_w.amount::numeric, 'FM99999999999999999999.00')
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
       set "availableBalance" = to_char(coalesce(v_avail,'0.00')::numeric + v_w.amount::numeric, 'FM99999999999999999999.00'),
           "pendingAmount" = to_char(coalesce("pendingAmount",'0.00')::numeric - v_w.amount::numeric, 'FM99999999999999999999.00')
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
revoke execute on function public.withdraw_reserve(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.withdraw_reserve(uuid, text, text, text) to service_role;

revoke execute on function public.withdrawal_complete(text, uuid, text) from public, anon, authenticated;
grant execute on function public.withdrawal_complete(text, uuid, text) to service_role;

revoke execute on function public.withdrawal_reject(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.withdrawal_reject(text, text, uuid, text) to service_role;

revoke execute on function public.money_amount_check(text) from public, anon, authenticated;
revoke execute on function public.mask_identifier(text) from public, anon, authenticated;

-- NOTE (down): drop public.withdraw_reserve, public.withdrawal_complete,
-- public.withdrawal_reject, public.money_amount_check, public.mask_identifier.
