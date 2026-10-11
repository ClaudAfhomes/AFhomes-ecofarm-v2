-- Run only inside the approved atomic migration batch, before November 4.
-- Captures real opening accounting; never invents missing ledger history.
lock table public.memberships, public.points_accounts, public.points_ledger, public.audit_events in access exclusive mode;
create temporary table afhomes_legacy_points_before on commit drop as
 select a.id account_id, a.membership_id, a.balance,
        coalesce((select sum(l.amount) from public.points_ledger l where l.account_id=a.id),0)::bigint ledger_total,
        m.points_balance membership_balance
 from public.points_accounts a join public.memberships m on m.id=a.membership_id;
create temporary table afhomes_legacy_ledger_before on commit drop as
 select l.id, to_jsonb(l) payload from public.points_ledger l;
do $$ begin
 if exists(select 1 from pg_temp.afhomes_legacy_points_before b where b.balance<>b.ledger_total) then
  raise exception 'LEGACY_POINTS_DISCREPANCY: review required; no balance or history was changed';
 end if;
 if exists(select 1 from public.audit_events where action='LEGACY_POINTS_CUTOVER') then
  raise exception 'LEGACY_CUTOVER_ALREADY_OCCURRED: restore assessment required';
 end if;
end $$;
