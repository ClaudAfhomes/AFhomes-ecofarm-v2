-- AF Homes: record the facts of an EXTERNAL commission payment (method, date, evidence).
--
-- Commission money is paid outside AF Homes; Finance records the completed payment.
-- Until now the paid decision captured only an optional reference, and the automatic
-- payout row (private.commission_paid_payout, 20270105000004) dated every payout "today"
-- with no method. This migration:
--   1. adds commissions.paid_method / paid_on / paid_evidence_reference (optional at the
--      database level so historical and settled-before-system rows stay valid; the API
--      requires all three for new payments together with a reference). The evidence
--      reference follows the payroll proof rule (20270105000013): 10-500 characters;
--   2. refuses a payment date in the future (Asia/Manila);
--   3. freezes the three facts once a commission is paid, as 20270105000014 already
--      does for paid_at, paid_by, paid_reference - a recorded payment is history;
--   4. makes the payout trigger copy the method and the actual payment date;
--   5. narrows the browser grant to an explicit column list. `authenticated` held a
--      table-wide SELECT (Phase 1), so a beneficiary who passes commissions_read could
--      read Finance's evidence reference through PostgREST although the API masks it.
--      RLS picks the row, column grants pick the columns (the Phase 3 lesson in
--      docs/agents/afhomes-db-testing.md): every existing column stays readable exactly
--      as before EXCEPT paid_evidence_reference. RLS and commissions_read are unchanged.
-- Amount, rate, basis, beneficiary and the one-live-payout / one-reference-per-payout
-- indexes are NOT changed. No partial payout, approval or transfer path is added.
--
-- Validation:
--   select count(*) from information_schema.columns where table_schema='public'
--     and table_name='commissions'
--     and column_name in ('paid_method','paid_on','paid_evidence_reference');           -- 3
--   select count(*) from pg_trigger where tgname='zz_commission_paid_details_guard'
--     and not tgisinternal;                                                          -- 1
--   select position('paid_method' in prosrc)>0 from pg_proc
--     where proname='commission_paid_payout';                                        -- t
--   select has_table_privilege('authenticated','public.commissions','SELECT');        -- f
--   select has_column_privilege('authenticated','public.commissions',
--     'paid_evidence_reference','SELECT');                                            -- f
--   select count(*) from pg_attribute where attrelid='public.commissions'::regclass
--     and attnum>0 and not attisdropped
--     and not has_column_privilege('authenticated',attrelid,attnum,'SELECT');          -- 1
--   supabase/security/rls_invariants.sql returns no rows; pnpm test:db:local.
-- Down: forward only. Never clear recorded payment facts. To relax the guard, ship a new
--   migration that drops zz_commission_paid_details_guard. Never restore the table-wide
--   browser SELECT: it re-exposes the evidence reference. A later column a browser must
--   read needs its own column grant.
begin;

alter table public.commissions add column if not exists paid_method text;
alter table public.commissions add column if not exists paid_on date;
alter table public.commissions add column if not exists paid_evidence_reference text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commissions_paid_method_check') then
    alter table public.commissions add constraint commissions_paid_method_check
      check (paid_method is null or length(btrim(paid_method)) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commissions_paid_evidence_reference_check') then
    alter table public.commissions add constraint commissions_paid_evidence_reference_check
      check (paid_evidence_reference is null
             or length(btrim(paid_evidence_reference)) between 10 and 500);
  end if;
  -- Payment facts exist only on a paid commission.
  if not exists (select 1 from pg_constraint where conname = 'commissions_paid_details_only_when_paid') then
    alter table public.commissions add constraint commissions_paid_details_only_when_paid
      check (status = 'paid'
             or (paid_method is null and paid_on is null and paid_evidence_reference is null));
  end if;
end $$;
comment on column public.commissions.paid_method is
  'How the external commission payment was made (as recorded by Finance). Null on historical rows.';
comment on column public.commissions.paid_on is
  'Date the external commission payment was made (Asia/Manila). Null on historical rows.';
comment on column public.commissions.paid_evidence_reference is
  'Supporting document or external payment evidence reference recorded with the payment. Null on historical rows.';

-- paid_at / paid_by / paid_reference are already frozen by z_commission_decision_guard
-- (20270105000014); this extends the same rule, with the same code, to the three new facts.
create or replace function private.commission_paid_details_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid'
     and new.paid_on is not null and new.paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  if old.status = 'paid'
     and (new.paid_method, new.paid_on, new.paid_evidence_reference)
         is distinct from (old.paid_method, old.paid_on, old.paid_evidence_reference) then
    raise exception 'COMMISSION_FINANCIAL_DETAILS_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.commission_paid_details_guard() from public, anon, authenticated, service_role;
-- Named to fire LAST among the BEFORE UPDATE triggers, so the established refusals
-- (IMPORT_COMMISSION_ALREADY_SETTLED, COMMISSION_WITHHELD, ...) keep their own codes.
drop trigger if exists zz_commission_paid_details_guard on public.commissions;
create trigger zz_commission_paid_details_guard before update on public.commissions
  for each row execute function private.commission_paid_details_guard();

-- Same rule as 20270105000004; now carries the recorded method and actual payment date.
create or replace function private.commission_paid_payout() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid'
     and coalesce(new.settled_before_system, false) = false
     -- A zero commission (a legal frozen result) has nothing to disburse.
     and new.amount::numeric > 0 then
    insert into public.commission_payouts (commission_id, amount, status, bank_reference, method, paid_on, recorded_by)
    values (new.id, new.amount, 'paid',
            case when private.normalize_payment_key(new.paid_reference) is null then null
                 else btrim(new.paid_reference) end,
            nullif(btrim(coalesce(new.paid_method, '')), ''),
            coalesce(new.paid_on, (coalesce(new.paid_at, now()) at time zone 'Asia/Manila')::date),
            new.paid_by);
  end if;
  return new;
end $$;
revoke all on function private.commission_paid_payout() from public, anon, authenticated, service_role;

-- 5. Browser column list: every column of public.commissions (30 of 31) except
-- paid_evidence_reference. anon holds nothing here (Phase 1 revoked it) and stays so.
-- Revoking the table privilege also clears any column grants, so this pair is re-runnable.
revoke select on public.commissions from authenticated;
grant select (
  id, sale_id, ost_id, amount, status, earned_at, paid_at, created_at,
  beneficiary_type, beneficiary_staff_id, beneficiary_ost_id, rate_snapshot,
  basis_amount_snapshot, qualified_at, qualified_by, qualification_notes,
  cancelled_at, cancellation_reason, paid_by, paid_reference,
  commission_rule_id, commission_number, settled_before_system, eligible_at,
  commission_type, withheld_at, withheld_by, withheld_reason,
  paid_method, paid_on
) on public.commissions to authenticated;

notify pgrst, 'reload schema';
commit;
