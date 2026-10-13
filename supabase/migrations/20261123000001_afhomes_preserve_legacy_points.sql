-- AF Homes: preserve approved legacy balances with an explicit cutover compensation.
-- Requires the locked, temporary preflight snapshot and ALL selected migrations
-- in ONE transaction. Applying this alone fails closed. Historical files stay immutable.
-- Validate: unchanged original ledger payloads; old balance = final balance;
-- balance - reversal_debt = ledger sum; no imported points consume new earning caps.
-- Down: rollback the entire uncommitted batch, or restore the verified pre-batch backup.
-- Never delete these compensating entries after a committed migration.
do $$
declare b record; current_total bigint; restoration_id bigint;
begin
 if to_regclass('pg_temp.afhomes_legacy_points_before') is null or to_regclass('pg_temp.afhomes_legacy_ledger_before') is null then
  if not exists(select 1 from public.points_accounts) and exists(select 1 from public.audit_events where action='LEGACY_POINTS_CUTOVER') then
   return; -- Empty fresh installs have no historical entitlement to compensate.
  end if;
  raise exception 'LEGACY_PRESERVATION_SNAPSHOT_REQUIRED';
 end if;
 if exists(select 1 from public.audit_events where action='LEGACY_POINTS_PRESERVATION_COMPLETED') then return; end if;
 if not exists(select 1 from public.audit_events where action='LEGACY_POINTS_CUTOVER') then
  raise exception 'LEGACY_CUTOVER_ACCOUNTING_REQUIRED';
 end if;
 if exists(select 1 from pg_temp.afhomes_legacy_ledger_before old left join public.points_ledger l on l.id=old.id where l.id is null or not(to_jsonb(l) @> old.payload)) then
  raise exception 'LEGACY_LEDGER_HISTORY_CHANGED';
 end if;
 for b in select * from pg_temp.afhomes_legacy_points_before order by account_id loop
  if not exists(select 1 from public.points_accounts a where a.id=b.account_id and a.membership_id=b.membership_id and a.balance=0 and a.reversal_debt=0) then
   raise exception 'UNEXPECTED_POST_CUTOVER_ACCOUNT';
  end if;
  select coalesce(sum(l.amount),0) into current_total from public.points_ledger l where l.account_id=b.account_id;
  if current_total<>0 then raise exception 'POST_CUTOVER_LEDGER_NOT_ZERO'; end if;
  restoration_id:=null;
  if b.balance>0 then
   insert into public.points_ledger(account_id,entry_type,amount,balance_before,balance_after,counts_toward_cap,reason,metadata)
   values(b.account_id,'cutover_baseline',b.balance,0,b.balance,false,
     'Owner preservation policy: restore verified legacy opening points after audited cutover',
     jsonb_build_object('policy','preserve_legacy_points','originalLedgerTotal',b.ledger_total,'originalBalance',b.balance))
   returning id into restoration_id;
  end if;
  update public.points_accounts a set balance=b.balance where a.id=b.account_id;
  update public.memberships m set points_balance=b.balance where m.id=b.membership_id;
  insert into public.audit_events(action,entity_type,entity_id,reason,before_data,after_data)
  values('LEGACY_POINTS_PRESERVED','points_accounts',b.account_id::text,
    'Verified historical entitlement preserved; derived membership cache reconciled; no new earning award or cash created',
    jsonb_build_object('balance',b.balance,'membershipCache',b.membership_balance),
    jsonb_build_object('balance',b.balance,'ledgerTotal',b.ledger_total,'restorationLedgerId',restoration_id));
 end loop;
 if exists(select 1 from pg_temp.afhomes_legacy_points_before captured join public.points_accounts a on a.id=captured.account_id where a.balance<>captured.balance or a.reversal_debt<>0 or a.balance-a.reversal_debt<>(select coalesce(sum(l.amount),0) from public.points_ledger l where l.account_id=a.id)) then
  raise exception 'LEGACY_PRESERVATION_RECONCILIATION_FAILED';
 end if;
 insert into public.audit_events(action,entity_type,after_data) values('LEGACY_POINTS_PRESERVATION_COMPLETED','points_accounts',jsonb_build_object('accounts',(select count(*) from pg_temp.afhomes_legacy_points_before)));
end $$;
