-- AF Homes: preserve the first commission qualification and paid decision under concurrent requests.
-- The API uses status compare-and-set updates. This guard additionally protects completed
-- decision metadata for every database writer, including service_role. Payout reconciliation
-- continues through commission_payouts and never rewrites the original commission decision.
-- Validation: pnpm --filter api exec vitest run _handlers/commission-concurrency.spec.ts
--   pnpm test:db:local (commission decision regressions), supabase/security/rls_invariants.sql.
--   select count(*) from pg_trigger where tgname='z_commission_decision_guard' and not tgisinternal; -- 1
-- Down: forward only. Never replace the original qualification or payment provenance.
begin;

create or replace function private.commission_decision_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if (old.qualified_at is not null or old.qualified_by is not null or old.status in ('earned','paid','cancelled'))
     and (new.qualified_at,new.qualified_by,new.qualification_notes)
       is distinct from (old.qualified_at,old.qualified_by,old.qualification_notes) then
    raise exception 'COMMISSION_FINANCIAL_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  if old.earned_at is not null and new.earned_at is distinct from old.earned_at then
    raise exception 'COMMISSION_FINANCIAL_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  if old.cancelled_at is not null
     and (new.cancelled_at,new.cancellation_reason) is distinct from (old.cancelled_at,old.cancellation_reason) then
    raise exception 'COMMISSION_FINANCIAL_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  if old.status='paid' and (new.status,new.paid_at,new.paid_by,new.paid_reference)
       is distinct from (old.status,old.paid_at,old.paid_by,old.paid_reference) then
    raise exception 'COMMISSION_FINANCIAL_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.commission_decision_guard() from public,anon,authenticated,service_role;
drop trigger if exists commissions_z_decision_guard on public.commissions;
drop trigger if exists z_commission_decision_guard on public.commissions;
-- Run after import_commission_already_settled so its established refusal keeps its error code.
create trigger z_commission_decision_guard before update on public.commissions
for each row execute function private.commission_decision_guard();

notify pgrst,'reload schema';
commit;
