-- AF Homes: Financial Operations Phase 4 - commission payout records, holds, proposed recoveries.
--
-- The existing commission lifecycle, rates, frozen snapshots, beneficiary and the
-- 40% eligibility marker are NOT changed. The states already separate the steps:
--   expected (pending) -> eligible (eligible_at, 40% verified) -> pending review
--   (final_qualification_pending) -> approved (earned, a manual noted decision)
--   -> paid. This migration adds what was missing around them:
--   1. public.commission_payouts: every payout is its own auditable record. A row
--      is written automatically whenever a commission becomes 'paid' (by any
--      path), at most one live payout per commission, and a bank reference can
--      back only one payout. Finance can record a FAILED transfer (commission
--      stays earned / unpaid) and reconcile a paid one against the bank.
--   2. A hold: an approved commission can be withheld with a recorded reason;
--      a withheld commission cannot be paid until the hold is released.
--   3. public.commission_recovery_cases: PROPOSED recoveries (clawback reviews)
--      only. No function approves, offsets, deducts or refunds anything - that
--      needs legal and owner authorization that does not exist (12 Nov 2026).
--   4. commission_type on commissions ('DSC'). 'DRI' is structurally reserved
--      and REFUSED: no DRI entitlement can be created until it is authorized.
-- Validation: pnpm test:db:local (section 83); supabase/security/rls_invariants.sql.
-- Down: forward only. Never delete payout or recovery history.
begin;

-- ---------------------------------------------------------------------------
-- 4. Commission type (DRI reserved, not active)
-- ---------------------------------------------------------------------------
alter table public.commissions add column if not exists commission_type text not null default 'DSC'
  check (commission_type in ('DSC','DRI'));
comment on column public.commissions.commission_type is
  'DSC = Direct Sales Commission (the seller). DRI (referrer income) is reserved and refused by trigger until authorized.';

-- ---------------------------------------------------------------------------
-- 2. Hold
-- ---------------------------------------------------------------------------
alter table public.commissions add column if not exists withheld_at timestamptz;
alter table public.commissions add column if not exists withheld_by uuid references public.staff_users(id) on delete restrict;
alter table public.commissions add column if not exists withheld_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commissions_withheld_consistent') then
    alter table public.commissions add constraint commissions_withheld_consistent check (
      (withheld_at is null and withheld_by is null and withheld_reason is null)
      or (withheld_at is not null and withheld_by is not null and length(btrim(withheld_reason)) >= 5));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Payout records
-- ---------------------------------------------------------------------------
create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete restrict,
  amount text not null check (amount ~ '^[1-9][0-9]*(\.[0-9]{1,2})?$'),
  status text not null check (status in ('paid','failed','reconciled')),
  bank_reference text check (bank_reference is null or length(btrim(bank_reference)) between 1 and 100),
  method text check (method is null or length(btrim(method)) between 1 and 40),
  paid_on date,
  failure_reason text,
  recorded_by uuid references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  reconciled_by uuid references public.staff_users(id) on delete restrict,
  reconciled_at timestamptz,
  check ((status = 'failed') = (failure_reason is not null and length(btrim(failure_reason)) >= 5)),
  check ((status = 'reconciled') = (reconciled_by is not null and reconciled_at is not null)),
  check (status <> 'reconciled' or bank_reference is not null)
);
comment on table public.commission_payouts is
  'One row per commission disbursement attempt. Amount and recipient come from the frozen commission, never from the request. Paid is a recorded fact, not a bank transfer made by the system.';
-- At most one live payout per commission: a commission is never paid twice.
create unique index if not exists commission_payouts_one_live
  on public.commission_payouts (commission_id) where status in ('paid','reconciled');
-- One bank transfer backs one payout.
create unique index if not exists commission_payouts_reference_unique
  on public.commission_payouts (private.normalize_payment_key(bank_reference))
  where bank_reference is not null and status in ('paid','reconciled');
create index if not exists commission_payouts_commission_idx on public.commission_payouts (commission_id);
alter table public.commission_payouts enable row level security;
revoke all on public.commission_payouts from public, anon, authenticated;

create or replace function private.commission_payout_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COMMISSION_PAYOUT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  -- Identity and money never change; a failed attempt stays failed; only a paid
  -- payout may gain a bank reference / date and become reconciled.
  if (new.commission_id, new.amount, new.recorded_by, new.recorded_at) is distinct from
     (old.commission_id, old.amount, old.recorded_by, old.recorded_at)
     or old.status = 'failed' or old.status = 'reconciled'
     or (old.status = 'paid' and new.status not in ('paid','reconciled')) then
    raise exception 'COMMISSION_PAYOUT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.commission_payout_guard() from public, anon, authenticated, service_role;
drop trigger if exists commission_payouts_guard on public.commission_payouts;
create trigger commission_payouts_guard
  before update or delete on public.commission_payouts
  for each row execute function private.commission_payout_guard();

-- Commission-side rules, enforced for every path that writes a commission.
create or replace function private.commission_finops_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.commission_type = 'DRI' then
    raise exception 'DRI_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.commission_type is distinct from old.commission_type then
      raise exception 'COMMISSION_TYPE_IMMUTABLE' using errcode = '55000';
    end if;
    if new.status = 'paid' and old.status is distinct from 'paid' and new.withheld_at is not null then
      raise exception 'COMMISSION_WITHHELD' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.commission_finops_guard() from public, anon, authenticated, service_role;
drop trigger if exists commissions_finops_guard on public.commissions;
create trigger commissions_finops_guard
  before insert or update on public.commissions
  for each row execute function private.commission_finops_guard();

-- Becoming 'paid' always leaves a payout record, whichever path marked it paid.
create or replace function private.commission_paid_payout() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid'
     and coalesce(new.settled_before_system, false) = false
     -- A zero commission (a legal frozen result) has nothing to disburse.
     and new.amount::numeric > 0 then
    insert into public.commission_payouts (commission_id, amount, status, bank_reference, paid_on, recorded_by)
    values (new.id, new.amount, 'paid', nullif(btrim(coalesce(new.paid_reference, '')), ''),
            (coalesce(new.paid_at, now()) at time zone 'Asia/Manila')::date, new.paid_by);
  end if;
  return new;
end $$;
revoke all on function private.commission_paid_payout() from public, anon, authenticated, service_role;
drop trigger if exists commissions_paid_payout on public.commissions;
create trigger commissions_paid_payout
  after update on public.commissions
  for each row execute function private.commission_paid_payout();

-- Hold / release an approved, unpaid commission.
create or replace function public.set_commission_hold(
  p_commission_id uuid, p_actor_id uuid, p_hold boolean, p_reason text
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.commissions%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.mutation_actor_role(p_actor_id, 'network.commissions', 'update');
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'COMMISSION_HOLD_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v from public.commissions where id = p_commission_id for update;
  if not found then raise exception 'COMMISSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status in ('paid','cancelled') then
    raise exception 'COMMISSION_NOT_HOLDABLE' using errcode = '55000';
  end if;
  if coalesce(p_hold, false) = (v.withheld_at is not null) then return v.id; end if;  -- replay
  if p_hold then
    update public.commissions set withheld_at = now(), withheld_by = p_actor_id, withheld_reason = v_reason
     where id = v.id;
  else
    update public.commissions set withheld_at = null, withheld_by = null, withheld_reason = null
     where id = v.id;
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, case when p_hold then 'COMMISSION_WITHHELD' else 'COMMISSION_HOLD_RELEASED' end,
    'commission', v.id::text, jsonb_build_object('withheld', v.withheld_at is not null),
    jsonb_build_object('withheld', p_hold), v_reason);
  return v.id;
end $$;
revoke all on function public.set_commission_hold(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_commission_hold(uuid, uuid, boolean, text) to service_role;

-- A transfer that did not go through: recorded, and the commission stays unpaid.
create or replace function public.record_commission_payout_failure(
  p_commission_id uuid, p_actor_id uuid, p_reason text, p_bank_reference text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.commissions%rowtype; v_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id, 'network.commissions', 'update');
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'COMMISSION_PAYOUT_FAILURE_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v from public.commissions where id = p_commission_id for update;
  if not found then raise exception 'COMMISSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status <> 'earned' then raise exception 'COMMISSION_NOT_PAYABLE' using errcode = '55000'; end if;
  insert into public.commission_payouts (commission_id, amount, status, bank_reference, failure_reason, recorded_by)
  values (v.id, v.amount, 'failed', nullif(btrim(coalesce(p_bank_reference, '')), ''), btrim(p_reason), p_actor_id)
  returning id into v_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
  values (p_actor_id, 'COMMISSION_PAYOUT_FAILED', 'commission_payout', v_id::text,
    jsonb_build_object('commissionId', v.id, 'amount', v.amount, 'status', 'failed'), btrim(p_reason));
  return v_id;
end $$;
revoke all on function public.record_commission_payout_failure(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_commission_payout_failure(uuid, uuid, text, text) to service_role;

-- Match a paid payout to the bank: reference and date confirmed.
create or replace function public.reconcile_commission_payout(
  p_payout_id uuid, p_actor_id uuid, p_bank_reference text, p_paid_on date
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.commission_payouts%rowtype; v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
begin
  perform private.mutation_actor_role(p_actor_id, 'network.commissions', 'update');
  select * into v from public.commission_payouts where id = p_payout_id for update;
  if not found then raise exception 'COMMISSION_PAYOUT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'reconciled' then return v.id; end if;  -- replay
  if v.status <> 'paid' then raise exception 'COMMISSION_PAYOUT_NOT_PAID' using errcode = '55000'; end if;
  v_ref := coalesce(v_ref, v.bank_reference);
  if v_ref is null or length(v_ref) < 3 then
    raise exception 'PAYOUT_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.commission_payouts o
              where o.id <> v.id and o.status in ('paid','reconciled')
                and private.normalize_payment_key(o.bank_reference) = private.normalize_payment_key(v_ref)) then
    raise exception 'DUPLICATE_PAYOUT_REFERENCE' using errcode = '23505';
  end if;
  update public.commission_payouts
     set status = 'reconciled', bank_reference = v_ref, paid_on = p_paid_on,
         reconciled_by = p_actor_id, reconciled_at = now()
   where id = v.id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'COMMISSION_PAYOUT_RECONCILED', 'commission_payout', v.id::text,
    jsonb_build_object('status', 'paid'),
    jsonb_build_object('status', 'reconciled', 'bankReference', v_ref, 'paidOn', p_paid_on));
  return v.id;
end $$;
revoke all on function public.reconcile_commission_payout(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.reconcile_commission_payout(uuid, uuid, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Proposed recoveries (clawback reviews) - PROPOSE ONLY
-- ---------------------------------------------------------------------------
create table if not exists public.commission_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete restrict,
  trigger_kind text not null check (trigger_kind in
    ('sale_cancellation','rescission','downgrade','payment_default','returned_check')),
  payment_adjustment_id uuid references public.payment_adjustments(id) on delete restrict,
  proposed_amount text not null check (proposed_amount ~ '^[1-9][0-9]*(\.[0-9]{1,2})?$'),
  -- No recovery path exists, so this can only ever be zero.
  recovered_amount text not null default '0.00' check (recovered_amount = '0.00'),
  reason text not null check (length(btrim(reason)) >= 5),
  status text not null default 'proposed' check (status in ('proposed','dismissed')),
  requested_by uuid not null references public.staff_users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  dismissed_by uuid references public.staff_users(id) on delete restrict,
  dismissed_at timestamptz,
  dismissal_note text,
  check ((status = 'dismissed') = (dismissed_by is not null and dismissed_at is not null
                                   and length(btrim(coalesce(dismissal_note, ''))) >= 5))
);
comment on table public.commission_recovery_cases is
  'Proposed commission recoveries for review. A case never deducts, offsets, demands or refunds anything: there is no approved status and recovered_amount is constrained to 0.00 until legal and owner authorization exists.';
create unique index if not exists commission_recovery_cases_one_open
  on public.commission_recovery_cases (commission_id, trigger_kind) where status = 'proposed';
create index if not exists commission_recovery_cases_commission_idx on public.commission_recovery_cases (commission_id);
alter table public.commission_recovery_cases enable row level security;
revoke all on public.commission_recovery_cases from public, anon, authenticated;

create or replace function private.commission_recovery_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COMMISSION_RECOVERY_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  if (new.commission_id, new.trigger_kind, new.proposed_amount, new.reason, new.requested_by, new.requested_at)
     is distinct from
     (old.commission_id, old.trigger_kind, old.proposed_amount, old.reason, old.requested_by, old.requested_at)
     or old.status = 'dismissed' then
    raise exception 'COMMISSION_RECOVERY_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.commission_recovery_guard() from public, anon, authenticated, service_role;
drop trigger if exists commission_recovery_cases_guard on public.commission_recovery_cases;
create trigger commission_recovery_cases_guard
  before update or delete on public.commission_recovery_cases
  for each row execute function private.commission_recovery_guard();

create or replace function public.propose_commission_recovery(
  p_commission_id uuid, p_actor_id uuid, p_trigger text, p_amount text, p_reason text,
  p_payment_adjustment_id uuid default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.commissions%rowtype; v_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id, 'network.commissions', 'update');
  if p_trigger not in ('sale_cancellation','rescission','downgrade','payment_default','returned_check') then
    raise exception 'COMMISSION_RECOVERY_TRIGGER_INVALID' using errcode = '22023';
  end if;
  if p_amount is null or p_amount !~ '^[1-9][0-9]*(\.[0-9]{1,2})?$' then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'COMMISSION_RECOVERY_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v from public.commissions where id = p_commission_id for update;
  if not found then raise exception 'COMMISSION_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Only money that was actually paid out can be proposed for recovery.
  if v.status <> 'paid' then raise exception 'COMMISSION_NOT_PAID' using errcode = '55000'; end if;
  if p_amount::numeric > v.amount::numeric then
    raise exception 'COMMISSION_RECOVERY_EXCEEDS_COMMISSION' using errcode = '22023';
  end if;
  if exists (select 1 from public.commission_recovery_cases c
              where c.commission_id = v.id and c.trigger_kind = p_trigger and c.status = 'proposed') then
    raise exception 'COMMISSION_RECOVERY_ALREADY_PROPOSED' using errcode = '23505';
  end if;
  insert into public.commission_recovery_cases
    (commission_id, trigger_kind, payment_adjustment_id, proposed_amount, reason, requested_by)
  values (v.id, p_trigger, p_payment_adjustment_id, p_amount, btrim(p_reason), p_actor_id)
  returning id into v_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
  values (p_actor_id, 'COMMISSION_RECOVERY_PROPOSED', 'commission_recovery_case', v_id::text,
    jsonb_build_object('commissionId', v.id, 'trigger', p_trigger, 'proposedAmount', p_amount,
      'status', 'proposed'), btrim(p_reason));
  return v_id;
end $$;
revoke all on function public.propose_commission_recovery(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.propose_commission_recovery(uuid, uuid, text, text, text, uuid) to service_role;

-- A proposal raised in error can be dismissed with a note (it never had any effect).
create or replace function public.dismiss_commission_recovery(
  p_case_id uuid, p_actor_id uuid, p_note text
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.commission_recovery_cases%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'network.commissions', 'update');
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'COMMISSION_RECOVERY_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v from public.commission_recovery_cases where id = p_case_id for update;
  if not found then raise exception 'COMMISSION_RECOVERY_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'dismissed' then return v.id; end if;
  update public.commission_recovery_cases
     set status = 'dismissed', dismissed_by = p_actor_id, dismissed_at = now(), dismissal_note = btrim(p_note)
   where id = v.id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'COMMISSION_RECOVERY_DISMISSED', 'commission_recovery_case', v.id::text,
    jsonb_build_object('status', 'proposed'), jsonb_build_object('status', 'dismissed'), btrim(p_note));
  return v.id;
end $$;
revoke all on function public.dismiss_commission_recovery(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dismiss_commission_recovery(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
