-- AF Homes: Financial Operations Phase 7 - governed resolution of payment adjustment proposals (Q13).
--
-- 0002 created public.payment_adjustments as PROPOSE ONLY. This adds the resolution path,
-- gated TWICE because the decision authority is NOT decided (open question Q13):
--   (a) dynamic RBAC: new module finance.payment_adjustment_decision (update). No role row
--       grants it; super_admin holds it by slug like every module, and it can be delegated
--       later through role management. No role name is checked anywhere.
--   (b) owner decision: public.governing_policy_decisions 'Q13_PAYMENT_ADJUSTMENT_AUTHORITY',
--       seeded 'pending'. While pending, public.resolve_payment_adjustment refuses EVERY
--       decision (PAYMENT_ADJUSTMENT_AUTHORITY_PENDING). No function here writes that row; a
--       future, explicitly authorized migration will.
--   1. public.resolve_payment_adjustment(adjustment, decision, note, actor): proposed ->
--      approved | rejected | withdrawn. Note >= 5 chars. Same decision by the same actor is an
--      idempotent replay (decided before the lifecycle checks); anything else on a resolved
--      row is refused. One audit_events row per resolution (PAYMENT_ADJUSTMENT_APPROVED /
--      _REJECTED / _WITHDRAWN). Lock order: payment -> adjustment -> accounting period (the
--      same order as propose_payment_adjustment and payment verification).
--   2. The guard trigger is replaced: a status change is accepted only from the RPC
--      (transaction-local flag afhomes.payment_adjustment_write), 'approved' additionally only
--      while Q13 is approved; resolved rows are frozen; DELETE stays refused. The flag is not
--      trusted (any direct connection can set a GUC): for 'approved' the guard re-checks the
--      decider <> requester, verified payment, cumulative cap and an OPEN posting period.
--      TRUNCATE is refused by a statement trigger; service_role loses DELETE and TRUNCATE.
--   3. Separation of duties: approve/reject are never by the requester (unchanged). The 0002
--      CHECK is relaxed NARROWLY so the requester may WITHDRAW their own proposal; withdrawal
--      moves no money. (Whether someone other than the requester may withdraw is open: the
--      RPC currently allows any holder of the decision permission.)
--   4. Effects. rejected / withdrawn change nothing else. approved NEVER edits or deletes the
--      original payment: it stamps posting_period = the Asia/Manila month of the decision
--      (refused unless that period is 'open') and is disclosed in finance_period_figures as
--      approvedAdjustmentsCount / approvedAdjustmentsTotal (keys added; verifiedTotal is NOT
--      netted). Cumulative approved adjustments can never exceed the payment amount.
--      OPEN POLICY (not implemented, deliberately): what an approved reversal / returned check /
--      refund does to commission eligibility, activation, the contract balance, card status or
--      a refund disbursement. No refund authority, clawback or automatic deduction exists.
--   5. Readiness is unchanged: only 'proposed' rows block (PAYMENT_ADJUSTMENTS_PENDING).
-- New codes: PAYMENT_ADJUSTMENT_AUTHORITY_PENDING (42501), PAYMENT_ADJUSTMENT_NOT_FOUND (P0002),
--   PAYMENT_ADJUSTMENT_DECISION_INVALID (22023), PAYMENT_ADJUSTMENT_NOTE_REQUIRED (22023),
--   PAYMENT_ADJUSTMENT_ALREADY_RESOLVED (55000), PAYMENT_ADJUSTMENT_SELF_DECISION (42501),
--   PAYMENT_ADJUSTMENT_DIRECT_WRITE_REFUSED (42501), PAYMENT_ADJUSTMENT_V7_CONSTRAINT_MIGRATION_INCOMPLETE.
--   Reused: MUTATION_FORBIDDEN, PAYMENT_NOT_VERIFIED, PAYMENT_ADJUSTMENT_EXCEEDS_PAYMENT,
--   PERIOD_NOT_OPEN, PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED, PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE.
-- Validation: pnpm test:db:local (section 87); supabase/security/rls_invariants.sql.
--   select key, status from public.governing_policy_decisions order by key;   -- Q13 row 'pending'
--   select count(*) from public.role_permissions rp join public.modules m on m.id = rp.module_id
--    where m.key = 'finance.payment_adjustment_decision';                      -- 0
--   select conname from pg_constraint where conrelid = 'public.payment_adjustments'::regclass
--    and conname like 'payment_adjustments_v7_%' order by 1;                    -- 2 rows
-- Down: forward only. Never delete resolved adjustments or their audit events. To disable,
--   revoke execute on public.resolve_payment_adjustment; Q13 pending already refuses everything.
begin;

-- ---------------------------------------------------------------------------
-- 1. Authority: RBAC module (no role row) + governing decision (pending)
-- ---------------------------------------------------------------------------
insert into public.modules (key, name, group_name, sort_order) values
  ('finance.payment_adjustment_decision', 'Payment Adjustment Decisions', 'Finance', 49)
on conflict (key) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

insert into public.governing_policy_decisions (key, status, note)
values ('Q13_PAYMENT_ADJUSTMENT_AUTHORITY', 'pending',
        'Awaiting owner decision on who may approve, reject or withdraw payment adjustments.')
on conflict (key) do nothing;

create or replace function private.payment_adjustment_authority_approved() returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.governing_policy_decisions g
                  where g.key = 'Q13_PAYMENT_ADJUSTMENT_AUTHORITY' and g.status = 'approved')
$$;
revoke all on function private.payment_adjustment_authority_approved() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Constraints (0002 CHECK matched by definition, never by guessed name)
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.payment_adjustments'::regclass and con.contype = 'c'
       and con.conname not like 'payment_adjustments_v7_%'
       and pg_get_constraintdef(con.oid) like '%decided_by <> requested_by%'
  loop
    execute format('alter table public.payment_adjustments drop constraint %I', c.conname);
  end loop;
end $$;

-- Whoever approves or rejects is never the person who asked; the requester may withdraw.
alter table public.payment_adjustments drop constraint if exists payment_adjustments_v7_decider_check;
alter table public.payment_adjustments add constraint payment_adjustments_v7_decider_check
  check (decided_by is null or decided_by <> requested_by or status = 'withdrawn');
-- An approved adjustment always names the accounting month it is posted to.
alter table public.payment_adjustments drop constraint if exists payment_adjustments_v7_posting_check;
alter table public.payment_adjustments add constraint payment_adjustments_v7_posting_check
  check (status <> 'approved' or posting_period is not null);

do $$
begin
  if exists (
    select 1 from pg_constraint con
     where con.conrelid = 'public.payment_adjustments'::regclass and con.contype = 'c'
       and con.conname not like 'payment_adjustments_v7_%'
       and pg_get_constraintdef(con.oid) like '%decided_by <> requested_by%'
  ) then
    raise exception 'PAYMENT_ADJUSTMENT_V7_CONSTRAINT_MIGRATION_INCOMPLETE';
  end if;
end $$;

comment on table public.payment_adjustments is
  'Linked corrections to a verified payment. The original payment row is never edited or deleted. Resolved only through public.resolve_payment_adjustment, gated by finance.payment_adjustment_decision AND governing decision Q13 (pending = nothing can be resolved). An approved row is disclosed in its posting_period figures; its effect on commissions, activation, balances or refunds is an open policy question and nothing applies it. Deliberate consequence: a payment with adjustment history cannot be deleted (on delete restrict).';

-- ---------------------------------------------------------------------------
-- 3. Guard: status changes only through the RPC; resolved rows are frozen
-- ---------------------------------------------------------------------------
create or replace function private.payment_adjustment_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare v_amount numeric; v_status text; v_approved numeric; v_period_status text;
begin
  -- TRUNCATE (statement trigger) and DELETE would erase history; both are refused.
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    -- A row is always born proposed (propose_payment_adjustment).
    if new.status = 'approved' then
      raise exception 'PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    if new.status <> 'proposed' then
      raise exception 'PAYMENT_ADJUSTMENT_DIRECT_WRITE_REFUSED' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.payment_id, new.kind, new.amount, new.reason, new.effective_date, new.requested_by, new.requested_at)
     is distinct from
     (old.payment_id, old.kind, old.amount, old.reason, old.effective_date, old.requested_by, old.requested_at) then
    raise exception 'PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  -- A resolved row never changes again.
  if old.status <> 'proposed' then
    if new is distinct from old then
      raise exception 'PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE' using errcode = '55000';
    end if;
    return new;
  end if;
  if (new.status, new.decided_by, new.decided_at, new.decision_note, new.posting_period)
     is not distinct from (old.status, old.decided_by, old.decided_at, old.decision_note, old.posting_period) then
    return new;  -- e.g. evidence_path on a still-proposed row (unchanged 0002 behaviour)
  end if;
  -- Any decision field changes: only the RPC may do it.
  if current_setting('afhomes.payment_adjustment_write', true) is distinct from 'on' then
    if new.status = 'approved' then
      raise exception 'PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    raise exception 'PAYMENT_ADJUSTMENT_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;
  if new.status = 'approved' then
    if not private.payment_adjustment_authority_approved() then
      raise exception 'PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    -- The flag is a GUC any direct connection can set, so it is not trusted: every approval
    -- invariant the RPC checks is re-checked here. The RPC already holds the payment lock
    -- (re-locking is a no-op); a direct write takes it here.
    if new.decided_by is null or new.decided_by = new.requested_by then
      raise exception 'PAYMENT_ADJUSTMENT_SELF_DECISION' using errcode = '42501';
    end if;
    select p.amount::numeric, p.status into v_amount, v_status
      from public.payments p where p.id = new.payment_id for update;
    if v_status is distinct from 'verified' then
      raise exception 'PAYMENT_NOT_VERIFIED' using errcode = '55000';
    end if;
    select coalesce(sum(a.amount::numeric), 0) into v_approved
      from public.payment_adjustments a
     where a.payment_id = new.payment_id and a.status = 'approved' and a.id <> new.id;
    if v_approved + new.amount::numeric > v_amount then
      raise exception 'PAYMENT_ADJUSTMENT_EXCEEDS_PAYMENT' using errcode = '22023';
    end if;
    select ap.status into v_period_status from public.accounting_periods ap
     where ap.period = new.posting_period for share;
    if v_period_status is distinct from 'open' then
      raise exception 'PERIOD_NOT_OPEN' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.payment_adjustment_guard() from public, anon, authenticated, service_role;
drop trigger if exists payment_adjustments_guard on public.payment_adjustments;
create trigger payment_adjustments_guard
  before insert or update or delete on public.payment_adjustments
  for each row execute function private.payment_adjustment_guard();
drop trigger if exists payment_adjustments_no_truncate on public.payment_adjustments;
create trigger payment_adjustments_no_truncate
  before truncate on public.payment_adjustments
  for each statement execute function private.payment_adjustment_guard();
-- Defence in depth: the server role never deletes or truncates adjustment history.
revoke truncate, delete on public.payment_adjustments from service_role;

-- ---------------------------------------------------------------------------
-- 4. The resolution RPC
-- ---------------------------------------------------------------------------
create or replace function public.resolve_payment_adjustment(
  p_adjustment_id uuid, p_decision text, p_note text, p_actor_id uuid
) returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_adj public.payment_adjustments%rowtype;
  v_pay public.payments%rowtype;
  v_payment_id uuid;
  v_note text := btrim(coalesce(p_note, ''));
  v_period text;
  v_period_status text;
  v_approved numeric;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payment_adjustment_decision', 'update');
  if p_decision is null or p_decision not in ('approved','rejected','withdrawn') then
    raise exception 'PAYMENT_ADJUSTMENT_DECISION_INVALID' using errcode = '22023';
  end if;
  if length(v_note) < 5 then
    raise exception 'PAYMENT_ADJUSTMENT_NOTE_REQUIRED' using errcode = '22023';
  end if;
  -- Q13: who may decide is not settled. Re-checked on every call, never trusted from earlier.
  if not private.payment_adjustment_authority_approved() then
    raise exception 'PAYMENT_ADJUSTMENT_AUTHORITY_PENDING' using errcode = '42501';
  end if;

  -- Fixed lock order: payment -> adjustment -> accounting period.
  select a.payment_id into v_payment_id from public.payment_adjustments a where a.id = p_adjustment_id;
  if not found then raise exception 'PAYMENT_ADJUSTMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.* into v_pay from public.payments p where p.id = v_payment_id for update;
  select a.* into v_adj from public.payment_adjustments a where a.id = p_adjustment_id for update;

  -- Idempotency is decided before any lifecycle check: a lost-response retry succeeds.
  if v_adj.status = p_decision and v_adj.decided_by = p_actor_id then
    return v_adj.status;
  end if;
  if v_adj.status <> 'proposed' then
    raise exception 'PAYMENT_ADJUSTMENT_ALREADY_RESOLVED' using errcode = '55000';
  end if;
  if p_decision in ('approved','rejected') and v_adj.requested_by = p_actor_id then
    raise exception 'PAYMENT_ADJUSTMENT_SELF_DECISION' using errcode = '42501';
  end if;

  if p_decision = 'approved' then
    if v_pay.status <> 'verified' then
      raise exception 'PAYMENT_NOT_VERIFIED' using errcode = '55000';
    end if;
    select coalesce(sum(a.amount::numeric), 0) into v_approved
      from public.payment_adjustments a
     where a.payment_id = v_pay.id and a.status = 'approved';
    if v_approved + v_adj.amount::numeric > v_pay.amount::numeric then
      raise exception 'PAYMENT_ADJUSTMENT_EXCEEDS_PAYMENT' using errcode = '22023';
    end if;
    -- Posted to the Manila month of the decision, which must still be open. The share lock
    -- serializes with close_accounting_period (FOR UPDATE on the same row).
    v_period := to_char(now() at time zone 'Asia/Manila', 'YYYY-MM');
    insert into public.accounting_periods (period) values (v_period) on conflict (period) do nothing;
    select ap.status into v_period_status from public.accounting_periods ap
     where ap.period = v_period for share;
    if v_period_status is distinct from 'open' then
      raise exception 'PERIOD_NOT_OPEN' using errcode = '55000';
    end if;
  end if;

  perform set_config('afhomes.payment_adjustment_write', 'on', true);
  update public.payment_adjustments a
     set status = p_decision, decided_by = p_actor_id, decided_at = now(), decision_note = v_note,
         posting_period = case when p_decision = 'approved' then v_period else a.posting_period end
   where a.id = v_adj.id;
  perform set_config('afhomes.payment_adjustment_write', 'off', true);

  -- OPEN POLICY: an approved adjustment changes no payment, verified total, balance,
  -- commission, activation or card status here. Those downstream effects await a decision.
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'PAYMENT_ADJUSTMENT_' || upper(p_decision), 'payment_adjustment', v_adj.id::text,
    jsonb_build_object('status', 'proposed', 'requestedBy', v_adj.requested_by),
    jsonb_strip_nulls(jsonb_build_object('status', p_decision, 'paymentId', v_adj.payment_id,
      'kind', v_adj.kind, 'amount', v_adj.amount, 'postingPeriod', v_period)),
    v_note);
  return p_decision;
end $$;
revoke all on function public.resolve_payment_adjustment(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_payment_adjustment(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Period figures: re-created from 0003, identical except two disclosure keys
-- ---------------------------------------------------------------------------
create or replace function private.finance_period_figures(p_period text)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
  select jsonb_build_object(
    'period', p_period,
    'status', coalesce((select a.status from public.accounting_periods a where a.period = p_period), 'open'),
    'verifiedCount', (select count(*) from public.payments p
                       where p.status = 'verified' and p.posting_period = p_period),
    'verifiedTotal', private.money(coalesce((select sum(p.amount::numeric) from public.payments p
                       where p.status = 'verified' and p.posting_period = p_period), 0)),
    'latePostings', (select count(*) from public.payments p
                       where p.status = 'verified' and p.posting_period = p_period
                         and p.paid_on is not null and to_char(p.paid_on, 'YYYY-MM') < p_period),
    -- Fingerprint of exactly which payments make up the period: proves later
    -- that the live set still equals what was closed.
    'paymentSetHash', md5(coalesce((select string_agg(p.id::text, ',' order by p.id) from public.payments p
                       where p.status = 'verified' and p.posting_period = p_period), '')),
    -- Verified money that belongs to no period at all (should always be 0).
    'unassignedVerified', (select count(*) from public.payments p
                       where p.status = 'verified' and p.posting_period is null),
    -- Outstanding items are system-wide, not tied to a month.
    'pendingVerification', (select count(*) from public.payments p where p.status = 'recorded'),
    'heldForDuplicateReview', (select count(*) from public.payments p
                       where p.status = 'recorded' and p.duplicate_review_note is null
                         and exists (select 1 from private.payment_cross_contract_matches(p.id))),
    'proposedAdjustments', (select count(*) from public.payment_adjustments a where a.status = 'proposed'),
    -- Approved adjustments posted to this month. Disclosed only: verifiedTotal is NOT netted,
    -- because what an approved adjustment does to collections is an open policy question.
    'approvedAdjustmentsCount', (select count(*) from public.payment_adjustments a
                       where a.status = 'approved' and a.posting_period = p_period),
    'approvedAdjustmentsTotal', private.money(coalesce((select sum(a.amount::numeric)
                       from public.payment_adjustments a
                       where a.status = 'approved' and a.posting_period = p_period), 0)),
    'earlierOpenPeriods', coalesce((
      select jsonb_agg(x.period order by x.period) from (
        select distinct p.posting_period as period from public.payments p
         where p.status = 'verified' and p.posting_period < p_period
        union
        select a.period from public.accounting_periods a where a.period < p_period
      ) x
      where not exists (select 1 from public.accounting_periods c
                         where c.period = x.period and c.status = 'closed')), '[]'::jsonb)
  )
$$;
revoke all on function private.finance_period_figures(text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
