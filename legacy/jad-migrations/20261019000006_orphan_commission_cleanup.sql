-- One-time cleanup: remove orphaned commissions whose sale no longer exists.
--
-- `Commission` has no FK on `saleId`, so deleting a Sale left orphan rows
-- behind. They still render in the member's commissions list with links to a
-- missing sale (404). For each orphaned AVAILABLE commission, reverse the
-- credited money first (debit Wallet availableBalance/totalEarned, append a
-- COMMISSION_REVERSAL DEBIT ledger entry, audit), then delete the row so it
-- disappears from the member's list. Non-AVAILABLE orphans (no wallet effect)
-- are deleted outright. Insufficient wallet balance is skipped with a notice
-- (BI-001: never negative) instead of failing the whole batch.
--
-- Idempotent: re-running finds zero orphans and changes nothing.
--
-- Pre-apply validation (run first):
--   select c.id, c."saleId", c."memberId", c."commissionType", c.amount, c.status
--   from "Commission" c
--   where not exists (select 1 from "Sale" s where s.id = c."saleId");
--
-- Down: none (deleted rows cannot be restored; reversal ledger entries and
-- audit notes are append-only and stay as the record).

DO $$
declare
  v_orph record;
  v_avail text;
  v_earned text;
  v_now timestamptz := now();
  v_reversed integer := 0;
  v_removed integer := 0;
begin
  for v_orph in
    select id, "memberId", "commissionType", amount, status
    from "Commission" c
    where not exists (select 1 from "Sale" s where s.id = c."saleId")
    order by "createdAt"
    for update skip locked
  loop
    if v_orph.status = 'AVAILABLE' and public.money_amount_check(v_orph.amount) then
      insert into "Wallet"("memberId","availableBalance","pendingAmount","totalWithdrawals","totalEarned")
        values (v_orph."memberId", '0.00','0.00','0.00','0.00') on conflict ("memberId") do nothing;
      select "availableBalance", "totalEarned" into v_avail, v_earned
        from "Wallet" where "memberId" = v_orph."memberId" for update;
      if coalesce(v_avail,'0.00')::numeric >= v_orph.amount::numeric
         and coalesce(v_earned,'0.00')::numeric >= v_orph.amount::numeric then
        update "Wallet"
          set "availableBalance" = to_char(coalesce(v_avail,'0.00')::numeric - v_orph.amount::numeric, 'FM999999999999999999990.00'),
              "totalEarned" = to_char(coalesce(v_earned,'0.00')::numeric - v_orph.amount::numeric, 'FM999999999999999999990.00')
          where "memberId" = v_orph."memberId";
        insert into "LedgerEntry" (id, "memberId", "entryType", direction, amount, "createdAt")
          values ('led-' || lower(substr(md5(random()::text || clock_timestamp()::text || v_orph.id), 1, 12)),
                  v_orph."memberId", 'COMMISSION_REVERSAL', 'DEBIT', v_orph.amount, v_now);
        insert into "AuditLog" (action, actor_id, actor_role, target_type, target_id, target_name, detail, created_at)
          values ('COMMISSION_REVERSED', null, 'system', 'Commission', v_orph.id,
                  v_orph."commissionType" || ' - ' || v_orph.amount,
                  'Reversed orphan commission ' || v_orph.id || ' (' || v_orph.amount || '); sale no longer exists.', v_now);
        v_reversed := v_reversed + 1;
      else
        raise notice 'orphan cleanup skipped reversal for % (insufficient wallet balance); row deleted without reversal', v_orph.id;
      end if;
    end if;
    delete from "Commission" where id = v_orph.id;
    v_removed := v_removed + 1;
  end loop;
  raise notice 'orphan commission cleanup: % reversed, % removed', v_reversed, v_removed;
end $$;
