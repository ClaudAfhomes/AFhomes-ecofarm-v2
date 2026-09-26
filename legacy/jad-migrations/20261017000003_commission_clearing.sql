-- Commission clearing (PENDING -> AVAILABLE) with wallet + ledger movement.
--
-- Commissions are issued PENDING by `sale_qualify` but nothing ever cleared
-- them: no endpoint, no scheduler, no wallet movement. Members see PENDING
-- rows in the commissions list and the dashboard Pending card, but the
-- amounts never reach the wallet, ledger, or Total Earned - while the member
-- UI copy still promises "Clears to Available after 7-day clearing period".
--
-- This adds the missing mechanism, following the atomic money-function
-- pattern (withdraw_reserve/withdrawal_complete): SECURITY DEFINER, single
-- transaction, row-lock the wallet, validate state, write ledger + wallet +
-- audit in one unit, errors RETURNED (never raised) as {error:{...}}.
--   commission_clear(p_id, p_actor, p_role) - clear one PENDING commission.
--   commission_clear_batch(p_window_days, p_actor, p_role) - clear every
--     PENDING commission at/older than the window (SystemConfig
--     COMMISSION_CLEARING_DAYS, default 7; explicit arg wins).
-- Wallet.pendingAmount is RECOMPUTED from remaining PENDING rows (self-healing:
-- issuance never maintained the stored value, so decrementing could go
-- negative). EXECUTE restricted to service_role (money invariant).
--
-- Pre-apply validation (run first):
--   -- due-but-uncleared commissions (expect 0 after a successful clear run):
--   select c.id, c."memberId", c."commissionType", c.amount, c."createdAt"
--   from "Commission" c
--   where c.status = 'PENDING'
--     and c."createdAt" <= now() - make_interval(days => 7);
--
-- Down: drop public.commission_clear_batch, drop public.commission_clear
-- (cleared rows keep AVAILABLE; reverse manually if needed).

-- Clearing window config (days). Insert-only; admin edits the value in place.
insert into "SystemConfig" (key, label, value, category)
values ('COMMISSION_CLEARING_DAYS', 'Commission Clearing Window (days)', '7', 'Commissions')
on conflict (key) do nothing;

create or replace function public.commission_clear(
  p_id text,
  p_actor uuid,
  p_role text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c record;
  v_avail text;
  v_pending_sum text;
  v_now timestamptz := now();
begin
  select * into v_c from "Commission" where id = p_id for update;
  if v_c.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Commission not found','status',404));
  end if;
  if v_c.status <> 'PENDING' then
    return jsonb_build_object('error', jsonb_build_object('code','CONFLICT','message', format('Only PENDING commissions can be cleared (current: %s).', v_c.status),'status',409));
  end if;
  if not public.money_amount_check(v_c.amount) then
    return jsonb_build_object('error', jsonb_build_object('code','VALIDATION_ERROR','message','Stored commission amount is malformed.','status',422));
  end if;
  -- Wallet upsert (created on demand) + lock. Insert-then-lock is safe when
  -- the row does not exist yet under concurrency.
  insert into "Wallet"("memberId","availableBalance","pendingAmount","totalWithdrawals","totalEarned")
    values (v_c."memberId", '0.00','0.00','0.00','0.00') on conflict ("memberId") do nothing;
  select "availableBalance" into v_avail from "Wallet" where "memberId" = v_c."memberId" for update;
  -- Flip the commission.
  update "Commission" set status = 'AVAILABLE', "clearedAt" = v_now where id = p_id;
  -- Ledger CREDIT (entryType mirrors the commission type).
  insert into "LedgerEntry" (id, "memberId", "entryType", direction, amount, "createdAt")
    values ('led-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
            v_c."memberId", v_c."commissionType", 'CREDIT', v_c.amount, v_now);
  -- Recompute the pending sum (self-healing; issuance never maintained the
  -- stored pendingAmount, so a blind decrement could go negative).
  select to_char(coalesce(sum(amount::numeric), 0), 'FM99999999999999999999.00') into v_pending_sum
    from "Commission" where "memberId" = v_c."memberId" and status = 'PENDING';
  -- Wallet movement: available += amount, pending = recomputed, earned += amount.
  update "Wallet"
    set "availableBalance" = to_char(coalesce(v_avail,'0.00')::numeric + v_c.amount::numeric, 'FM99999999999999999999.00'),
        "pendingAmount" = v_pending_sum,
        "totalEarned" = to_char(coalesce("totalEarned",'0.00')::numeric + v_c.amount::numeric, 'FM99999999999999999999.00')
    where "memberId" = v_c."memberId";
  insert into "AuditLog" (action, actor_id, actor_role, target_type, target_id, target_name, detail, created_at)
    values ('COMMISSION_CLEARED', p_actor, p_role, 'Commission', p_id,
            v_c."commissionType" || ' - ' || v_c.amount,
            'Cleared commission ' || p_id || ' (' || v_c.amount || ').', v_now);
  return jsonb_build_object('status', 'AVAILABLE', 'clearedAt', v_now, 'amount', v_c.amount);
end;
$$;

create or replace function public.commission_clear_batch(
  p_window_days integer default null,
  p_actor uuid default null,
  p_role text default 'system'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_days integer := 7;
  v_raw text;
  v_cutoff timestamptz;
  v_cleared integer := 0;
  v_total numeric := 0;
  v_c record;
  v_res jsonb;
begin
  if p_window_days is not null and p_window_days >= 0 then
    v_days := p_window_days;
  else
    select value into v_raw from "SystemConfig" where key = 'COMMISSION_CLEARING_DAYS';
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_days := v_raw::integer;
    end if;
  end if;
  v_cutoff := now() - make_interval(days => v_days);
  for v_c in
    select id from "Commission"
    where status = 'PENDING' and "createdAt" <= v_cutoff
    order by "createdAt" for update skip locked
  loop
    select public.commission_clear(v_c.id, p_actor, p_role) into v_res;
    if (v_res ->> 'status') = 'AVAILABLE' then
      v_cleared := v_cleared + 1;
      v_total := v_total + coalesce((v_res ->> 'amount')::numeric, 0);
    end if;
  end loop;
  return jsonb_build_object(
    'cleared', v_cleared,
    'total', to_char(v_total, 'FM99999999999999999999.00'),
    'windowDays', v_days
  );
end;
$$;

-- Money invariant: only the service-role API layer may invoke these.
revoke execute on function public.commission_clear(text, uuid, text) from public, anon, authenticated;
grant execute on function public.commission_clear(text, uuid, text) to service_role;
revoke execute on function public.commission_clear_batch(integer, uuid, text) from public, anon, authenticated;
grant execute on function public.commission_clear_batch(integer, uuid, text) to service_role;