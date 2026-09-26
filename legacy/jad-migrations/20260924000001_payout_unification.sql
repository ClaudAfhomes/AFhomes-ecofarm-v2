-- Payout unification (owner decision D2): one PayoutAccount model.
--
-- Member submissions (pa-*) lived in MemberPayoutAccount while the admin
-- queue (pac-*) lived in PayoutAccount, so member accounts never reached
-- admin review and admin decisions never reached members. Both surfaces
-- already validate against the same payoutAccountSchema wire contract - 
-- only storage was split.
--
-- This migration extends PayoutAccount with the member-owned columns,
-- moves every pa-* row over (masking computed with the same rule as the
-- API maskIdentifier helper), drops MemberPayoutAccount, and links
-- Withdrawal.payoutAccountId (closes F-12 - every legacy wdr-* reference
-- resolves in the unified table). Idempotent; no row is modified in place.
-- Down: drop the FK, recreate MemberPayoutAccount, move pa-* rows back,
-- drop the added columns.

alter table "PayoutAccount" add column if not exists "memberId" uuid references "Member"(id) on delete restrict;
alter table "PayoutAccount" add column if not exists "accountIdentifier" text;

insert into "PayoutAccount"
  (id, method, "accountName", "accountIdentifier", "accountIdentifierMasked",
   status, "isPrimary", "createdAt", "rejectionReason", "memberId")
  select
    id, method, "accountName", "accountIdentifier",
    case
      when length(trim(coalesce("accountIdentifier", ''))) <= 4 then '••••'
      else '•••• ' || right(trim("accountIdentifier"), 4)
    end,
    status, "isPrimary", "createdAt", "rejectionReason", "memberId"
  from "MemberPayoutAccount"
on conflict (id) do nothing;

drop table if exists "MemberPayoutAccount";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Withdrawal_payoutAccountId_fkey') THEN
    alter table "Withdrawal" add constraint "Withdrawal_payoutAccountId_fkey"
      foreign key ("payoutAccountId") references "PayoutAccount"(id);
  END IF;
END $$;

-- withdraw_reserve reads the unified table from now on (full replace; the
-- body is unchanged apart from the table name).
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
