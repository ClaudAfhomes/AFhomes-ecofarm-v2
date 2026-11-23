-- AF Homes: Financial Operations Phase 6 - payroll close, isolated simulation workflow,
-- month-end pre-close readiness.
--
--   1. Simulation workflow. A mode='simulation' batch now follows the same lifecycle as a
--      live one: draft -> submitted -> approved | returned (-> draft on edit) -> closed,
--      with the SAME permission and separation-of-duties checks (Finance submits with
--      finance.payroll update; the approver holds finance.payroll_approval update and is
--      never the submitter). Simulations bypass ONLY the Q1 governing gate and the
--      approved-policy check (their figures are labelled historical fixtures). Simulated
--      disbursements go to public.payroll_simulation_disbursements, a separate table, so
--      live bank-reference uniqueness, payroll_disbursements and every real total never
--      see them. Nothing simulated touches accounting_periods, payments, commissions,
--      commission_payouts or finance_period_figures. Audit actions are PAYROLL_SIMULATION_*.
--      Simulations are re-runnable: a CLOSED simulation no longer occupies its period
--      (narrowed unique index; create_payroll_batch re-created to skip it), and simulated
--      references are unique per simulation batch, so a rehearsal can reuse demo references.
--      return_payroll_batch now also checks the Q1 gate for live batches (symmetry with
--      approve); an approve replay by the same approver succeeds after the batch closed.
--   2. public.close_payroll_batch: finance.payroll_close update (the existing "Payroll
--      Period Closing" module; Super Admin until delegated). Requires an approved batch,
--      every computed line with net > 0 disbursed (live table or simulation table by
--      mode; blocked and zero-net lines need nothing), and a closer who is not the
--      submitter. A closed batch is frozen by the guard trigger. LIVE close also requires
--      private.ist_payroll_live_authorized(), so it is refused today
--      (IST_PAYROLL_NOT_AUTHORIZED). Idempotent: closing a closed batch returns 'closed'.
--   3. public.accounting_period_readiness: pre-close blockers / warnings from existing data.
--      public.submit_accounting_period (re-created, otherwise identical) refuses with
--      PERIOD_HAS_BLOCKERS while any blocker exists. Live payroll is a WARNING only: the
--      pending Q1 decision must never block closing unrelated finance records.
-- Q1 stays PENDING. No function here reads or writes governing_policy_decisions except the
-- existing read-only private.ist_payroll_live_authorized().
-- New codes: PAYROLL_SELF_CLOSE (42501), PAYROLL_BATCH_NOT_FULLY_DISBURSED (55000),
--   PAYROLL_NOT_SIMULATION (55000), PERIOD_HAS_BLOCKERS (55000).
-- Validation: pnpm test:db:local (sections 85, 86); supabase/security/rls_invariants.sql.
--   select count(*) from public.payroll_simulation_disbursements;          -- 0 until a simulation is disbursed
--   select conname from pg_constraint where conrelid = 'public.payroll_batches'::regclass
--    and conname like 'payroll_batches_v6_%' order by 1;                     -- 6 rows
--   select public.accounting_period_readiness('2027-01', '<finance staff id>');
-- Down: forward only. Never delete closed batches or simulation disbursement history. To
--   disable, revoke execute on close_payroll_batch / record_payroll_simulation_disbursement /
--   accounting_period_readiness and re-create submit_accounting_period from 0003.
begin;

-- ---------------------------------------------------------------------------
-- 1. payroll_batches: 'closed' status, close actor, simulation lifecycle
-- ---------------------------------------------------------------------------
alter table public.payroll_batches add column if not exists closed_by uuid
  references public.staff_users(id) on delete restrict;
alter table public.payroll_batches add column if not exists closed_at timestamptz;

-- Replace the unnamed 0005 lifecycle CHECKs (matched by definition, never by guessed name)
-- with named v6 equivalents that add 'closed' and drop "a simulation is always a draft".
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.payroll_batches'::regclass and con.contype = 'c'
       and con.conname not like 'payroll_batches_v6_%'
       and (con.conname = 'payroll_batches_status_check'
            or pg_get_constraintdef(con.oid) like '%(mode = ''live''::text) OR (status = ''draft''::text)%'
            or pg_get_constraintdef(con.oid) like '%submitted_by IS NOT NULL%'
            or pg_get_constraintdef(con.oid) like '%decided_by IS NOT NULL%'
            or pg_get_constraintdef(con.oid) like '%decided_by <> submitted_by%')
  loop
    execute format('alter table public.payroll_batches drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.payroll_batches drop constraint if exists payroll_batches_v6_status_check;
alter table public.payroll_batches add constraint payroll_batches_v6_status_check
  check (status in ('draft','submitted','approved','returned','closed'));
alter table public.payroll_batches drop constraint if exists payroll_batches_v6_submitted_check;
alter table public.payroll_batches add constraint payroll_batches_v6_submitted_check
  check (status not in ('submitted','approved','closed') or (submitted_by is not null and submitted_at is not null));
alter table public.payroll_batches drop constraint if exists payroll_batches_v6_decided_check;
alter table public.payroll_batches add constraint payroll_batches_v6_decided_check
  check ((status in ('approved','returned','closed')) = (decided_by is not null and decided_at is not null));
alter table public.payroll_batches drop constraint if exists payroll_batches_v6_closed_check;
alter table public.payroll_batches add constraint payroll_batches_v6_closed_check
  check ((status = 'closed') = (closed_by is not null and closed_at is not null));
-- Separation of duties: never approved, nor closed, by the person who submitted it.
alter table public.payroll_batches drop constraint if exists payroll_batches_v6_approver_check;
alter table public.payroll_batches add constraint payroll_batches_v6_approver_check
  check (status not in ('approved','closed') or decided_by <> submitted_by);
alter table public.payroll_batches drop constraint if exists payroll_batches_v6_closer_check;
alter table public.payroll_batches add constraint payroll_batches_v6_closer_check
  check (closed_by is null or closed_by <> submitted_by);

-- Fail loudly if a 0005 lifecycle CHECK survived (a missed match would silently keep
-- simulations draft-only or forbid 'closed').
do $$
begin
  if exists (
    select 1 from pg_constraint con
     where con.conrelid = 'public.payroll_batches'::regclass and con.contype = 'c'
       and con.conname not like 'payroll_batches_v6_%'
       and (con.conname = 'payroll_batches_status_check'
            or pg_get_constraintdef(con.oid) like '%status = ''draft''::text%'
            or pg_get_constraintdef(con.oid) like '%submitted_by%'
            or pg_get_constraintdef(con.oid) like '%decided_by%')
  ) then
    raise exception 'PAYROLL_V6_CONSTRAINT_MIGRATION_INCOMPLETE';
  end if;
end $$;

-- One open batch per period and mode. A CLOSED simulation no longer occupies its period,
-- so a rehearsal can be re-run; a closed LIVE batch still does (live payroll is once per month).
drop index if exists public.payroll_batches_one_live_per_period;
create unique index payroll_batches_one_live_per_period
  on public.payroll_batches (period, mode)
  where status <> 'returned' and not (mode = 'simulation' and status = 'closed');

comment on table public.payroll_batches is
  'Monthly IST payroll batch (live or labelled simulation). Figures come from the API engine; SQL guards the lifecycle draft -> submitted -> approved | returned -> closed. Approved is immutable except approved -> closed; closed is frozen. Never pays anything by itself.';
comment on column public.payroll_batches.closed_by is
  'Holder of finance.payroll_close who closed the batch; never the submitter.';

create or replace function private.payroll_batch_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    -- A closed batch is frozen.
    if old.status = 'closed' then
      raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
    end if;
    -- An approved batch is immutable; its only legal change is approved -> closed,
    -- which may set nothing but the status, the close actor/time and updated_at.
    if old.status = 'approved' and (
         new.status is distinct from 'closed'
         or (to_jsonb(new) - array['status','closed_by','closed_at','updated_at'])
            is distinct from (to_jsonb(old) - array['status','closed_by','closed_at','updated_at'])) then
      raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
    end if;
  end if;
  if current_setting('afhomes.payroll_write', true) is distinct from 'on' then
    raise exception 'PAYROLL_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'PAYROLL_BATCH_TRANSITION_INVALID' using errcode = '55000';
    end if;
    if new.mode = 'live' and not private.ist_payroll_live_authorized() then
      raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.id, new.period, new.created_by, new.created_at, new.mode) is distinct from
     (old.id, old.period, old.created_by, old.created_at, old.mode) then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  -- Only a simulation's label may be restated, and only while it is still editable.
  if new.simulation_basis is distinct from old.simulation_basis
     and (new.mode <> 'simulation' or old.status not in ('draft','returned')) then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  -- Live payroll beyond a draft needs the governing gate; simulations bypass only this.
  if new.mode = 'live' and new.status in ('submitted','approved','closed')
     and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not ((old.status, new.status) in (('draft','draft'), ('draft','submitted'),
          ('submitted','approved'), ('submitted','returned'), ('returned','draft'),
          ('approved','closed'))) then
    raise exception 'PAYROLL_BATCH_TRANSITION_INVALID' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.payroll_batch_guard() from public, anon, authenticated, service_role;
-- (trigger payroll_batches_guard from 0005 already points at this function)

-- ---------------------------------------------------------------------------
-- 2. Simulated disbursements: a separate, labelled, append-only table
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_simulation_disbursements (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.payroll_lines(id) on delete restrict,
  -- Denormalized from the line (guard-checked) so references are unique per rehearsal.
  batch_id uuid not null references public.payroll_batches(id) on delete restrict,
  simulation boolean not null default true check (simulation),
  amount text not null check (amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
    and case when amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then amount::numeric > 0 else false end),
  method text not null check (length(btrim(method)) between 1 and 40),
  bank_reference text not null check (length(btrim(bank_reference)) between 1 and 100
    and private.normalize_payment_key(bank_reference) is not null),
  paid_on date not null,
  recorded_by uuid not null references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
comment on table public.payroll_simulation_disbursements is
  'SIMULATION ONLY. Rehearsal record that a simulated payroll line was "paid". Never money, never in a payable or period total, never checked against live bank references.';
create unique index if not exists payroll_simulation_disbursements_one_per_line
  on public.payroll_simulation_disbursements (line_id);
-- A rehearsal can be repeated with the same demo references: unique per simulation batch only.
create unique index if not exists payroll_simulation_disbursements_batch_reference_unique
  on public.payroll_simulation_disbursements (batch_id, private.normalize_payment_key(bank_reference));
alter table public.payroll_simulation_disbursements enable row level security;
revoke all on public.payroll_simulation_disbursements from public, anon, authenticated;

create or replace function private.payroll_simulation_disbursement_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare v_line public.payroll_lines%rowtype; v_batch_status text; v_mode text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'PAYROLL_DISBURSEMENT_IMMUTABLE' using errcode = '55000';
  end if;
  if current_setting('afhomes.payroll_write', true) is distinct from 'on' then
    raise exception 'PAYROLL_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;
  select * into v_line from public.payroll_lines l where l.id = new.line_id;
  select b.status, b.mode into v_batch_status, v_mode from public.payroll_batches b where b.id = v_line.batch_id;
  if v_mode is distinct from 'simulation' then
    raise exception 'PAYROLL_NOT_SIMULATION' using errcode = '55000';
  end if;
  if new.batch_id is distinct from v_line.batch_id then
    raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
  end if;
  if v_batch_status is distinct from 'approved' then
    raise exception 'PAYROLL_BATCH_NOT_APPROVED' using errcode = '55000';
  end if;
  if v_line.status <> 'computed' or v_line.net::numeric <= 0 then
    raise exception 'PAYROLL_LINE_NOT_PAYABLE' using errcode = '55000';
  end if;
  if new.amount::numeric <> v_line.net::numeric then
    raise exception 'PAYROLL_AMOUNT_MISMATCH' using errcode = '22023';
  end if;
  if new.paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.payroll_simulation_disbursement_guard() from public, anon, authenticated, service_role;
drop trigger if exists payroll_simulation_disbursements_guard on public.payroll_simulation_disbursements;
create trigger payroll_simulation_disbursements_guard
  before insert or update or delete on public.payroll_simulation_disbursements
  for each row execute function private.payroll_simulation_disbursement_guard();
drop trigger if exists payroll_simulation_disbursements_no_truncate on public.payroll_simulation_disbursements;
create trigger payroll_simulation_disbursements_no_truncate before truncate on public.payroll_simulation_disbursements
  for each statement execute function private.payroll_truncate_guard();

-- ---------------------------------------------------------------------------
-- 3. Lifecycle RPCs (same signatures; simulations now allowed, Q1 still gates live)
-- ---------------------------------------------------------------------------
-- Re-created from 0005. Changes: a simulation lookup skips CLOSED simulations (a closed
-- rehearsal never blocks a new one), and a basis is restated only on a draft/returned
-- simulation (a submitted/approved one is returned unchanged).
create or replace function public.create_payroll_batch(
  p_period text, p_actor_id uuid, p_mode text default 'live', p_simulation_basis text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_id uuid; v_status text; v_old_basis text; v_basis text := nullif(btrim(coalesce(p_simulation_basis, '')), '');
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'create');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('live','simulation') then
    raise exception 'PAYROLL_MODE_INVALID' using errcode = '22023';
  end if;
  if p_mode = 'live' then
    -- Live payroll is impossible until the governing compensation model is approved.
    if not private.ist_payroll_live_authorized() then
      raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    v_basis := null;
  elsif v_basis is null or length(v_basis) < 10 then
    raise exception 'PAYROLL_SIMULATION_BASIS_REQUIRED' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('payroll_batch:' || p_period));
  -- Idempotent: the period's existing batch of this mode is returned, never duplicated
  -- (a closed simulation is finished history and is skipped).
  select b.id, b.status, b.simulation_basis into v_id, v_status, v_old_basis
    from public.payroll_batches b
   where b.period = p_period and b.mode = p_mode
     and not (b.mode = 'simulation' and b.status = 'closed')
   order by b.created_at desc, b.id limit 1;
  if v_id is not null then
    if p_mode = 'simulation' and v_status in ('draft','returned') and v_old_basis is distinct from v_basis then
      perform set_config('afhomes.payroll_write', 'on', true);
      update public.payroll_batches b set simulation_basis = v_basis where b.id = v_id;
      perform set_config('afhomes.payroll_write', 'off', true);
      insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
      values (p_actor_id, 'PAYROLL_SIMULATION_BASIS_UPDATED', 'payroll_batch', v_id::text,
        jsonb_build_object('simulationBasis', v_old_basis), jsonb_build_object('simulationBasis', v_basis));
    end if;
    return v_id;
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  insert into public.payroll_batches (period, mode, simulation_basis, created_by)
  values (p_period, p_mode, v_basis, p_actor_id)
  returning id into v_id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'PAYROLL_BATCH_CREATED', 'payroll_batch', v_id::text,
    jsonb_build_object('period', p_period, 'status', 'draft', 'mode', p_mode)
      || case when p_mode = 'simulation' then jsonb_build_object('simulation', true) else '{}'::jsonb end);
  return v_id;
end $$;
revoke all on function public.create_payroll_batch(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_payroll_batch(text, uuid, text, text) to service_role;

create or replace function public.submit_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'submitted' and v.submitted_by = p_actor_id then return v.status; end if;  -- replay
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '55000'; end if;
  if v.line_count = 0 then raise exception 'PAYROLL_BATCH_EMPTY' using errcode = '55000'; end if;
  -- Live: no blocked line and every computed line on its approved policy. A simulation's
  -- figures are labelled fixtures and its blocked lines carry no money, so neither applies.
  if v.mode = 'live' and (v.blocked_line_count > 0
     or exists (select 1 from public.payroll_lines l where l.batch_id = v.id and l.status = 'blocked')
     or not private.payroll_batch_policies_ok(v.id)) then
    raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'submitted', submitted_by = p_actor_id, submitted_at = now(), return_reason = null
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_SUBMITTED' else 'PAYROLL_BATCH_SUBMITTED' end,
    'payroll_batch', v.id::text,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'submitted', 'period', v.period, 'mode', v.mode, 'lineCount', v.line_count)
      || case when v.mode = 'simulation'
              then jsonb_build_object('simulation', true, 'simulationTotalNet', v.simulation_total_net)
              else jsonb_build_object('totalNet', v.total_net) end);
  return 'submitted';
end $$;
revoke all on function public.submit_payroll_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_payroll_batch(uuid, uuid) to service_role;

create or replace function public.approve_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_approval', 'update');
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Replay: the same approver's decision stands even after the batch was closed.
  if v.status in ('approved','closed') and v.decided_by = p_actor_id then return 'approved'; end if;
  -- The governing gate is re-checked at call time for live payroll, not trusted from submission.
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'PAYROLL_BATCH_NOT_SUBMITTED' using errcode = '55000'; end if;
  if v.submitted_by = p_actor_id then raise exception 'PAYROLL_SELF_APPROVAL' using errcode = '42501'; end if;
  if v.mode = 'live' and not private.payroll_batch_policies_ok(v.id) then
    raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'approved', decided_by = p_actor_id, decided_at = now()
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_APPROVED' else 'PAYROLL_BATCH_APPROVED' end,
    'payroll_batch', v.id::text,
    jsonb_build_object('status', 'submitted', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'approved', 'period', v.period, 'mode', v.mode)
      || case when v.mode = 'simulation'
              then jsonb_build_object('simulation', true, 'simulationTotalNet', v.simulation_total_net)
              else jsonb_build_object('totalNet', v.total_net) end);
  return 'approved';
end $$;
revoke all on function public.approve_payroll_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_payroll_batch(uuid, uuid) to service_role;

create or replace function public.return_payroll_batch(p_batch_id uuid, p_reason text, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_approval', 'update');
  if length(v_reason) < 5 then
    raise exception 'PAYROLL_RETURN_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'returned' and v.decided_by = p_actor_id and v.return_reason = v_reason then
    return v.status;  -- replay
  end if;
  -- Symmetric with approve: a live decision needs the governing gate at call time.
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'PAYROLL_BATCH_NOT_SUBMITTED' using errcode = '55000'; end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'returned', decided_by = p_actor_id, decided_at = now(), return_reason = v_reason
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_RETURNED' else 'PAYROLL_BATCH_RETURNED' end,
    'payroll_batch', v.id::text,
    jsonb_build_object('status', 'submitted', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'returned', 'period', v.period, 'mode', v.mode)
      || case when v.mode = 'simulation' then jsonb_build_object('simulation', true) else '{}'::jsonb end,
    v_reason);
  return 'returned';
end $$;
revoke all on function public.return_payroll_batch(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.return_payroll_batch(uuid, text, uuid) to service_role;

-- Simulated disbursement: same rules as the live one, recorded only in the simulation table.
create or replace function public.record_payroll_simulation_disbursement(
  p_line_id uuid, p_amount text, p_method text, p_bank_reference text, p_paid_on date, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_line public.payroll_lines%rowtype; v_batch public.payroll_batches%rowtype; v_id uuid;
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  if p_amount is null or p_amount !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' or p_amount::numeric <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if v_method is null or length(v_method) > 40 then
    raise exception 'PAYROLL_METHOD_REQUIRED' using errcode = '22023';
  end if;
  if private.normalize_payment_key(v_ref) is null or length(v_ref) > 100 then
    raise exception 'PAYOUT_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  -- Lock order (same as the live path): batch (share) then line.
  select l.* into v_line from public.payroll_lines l where l.id = p_line_id;
  if not found then raise exception 'PAYROLL_LINE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_batch from public.payroll_batches b where b.id = v_line.batch_id for share;
  select * into v_line from public.payroll_lines l where l.id = p_line_id for update;
  if v_batch.mode <> 'simulation' then raise exception 'PAYROLL_NOT_SIMULATION' using errcode = '55000'; end if;
  -- Replay (decided before the lifecycle checks): same line and same normalized reference.
  select d.id into v_id from public.payroll_simulation_disbursements d
   where d.line_id = v_line.id
     and private.normalize_payment_key(d.bank_reference) = private.normalize_payment_key(v_ref);
  if v_id is not null then return v_id; end if;
  if v_batch.status <> 'approved' then raise exception 'PAYROLL_BATCH_NOT_APPROVED' using errcode = '55000'; end if;
  if v_line.status <> 'computed' or v_line.net::numeric <= 0 then
    raise exception 'PAYROLL_LINE_NOT_PAYABLE' using errcode = '55000';
  end if;
  if p_amount::numeric <> v_line.net::numeric then
    raise exception 'PAYROLL_AMOUNT_MISMATCH' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_simulation_disbursements d where d.line_id = v_line.id) then
    raise exception 'PAYROLL_LINE_ALREADY_DISBURSED' using errcode = '23505';
  end if;
  -- Uniqueness is checked among this simulation batch's references only; live references
  -- and other rehearsals are never consulted.
  if exists (select 1 from public.payroll_simulation_disbursements d
              where d.batch_id = v_batch.id
                and private.normalize_payment_key(d.bank_reference) = private.normalize_payment_key(v_ref)) then
    raise exception 'DUPLICATE_PAYOUT_REFERENCE' using errcode = '23505';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  insert into public.payroll_simulation_disbursements (line_id, batch_id, amount, method, bank_reference, paid_on, recorded_by)
  values (v_line.id, v_batch.id, v_line.net, v_method, v_ref, p_paid_on, p_actor_id)
  returning id into v_id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'PAYROLL_SIMULATION_DISBURSEMENT_RECORDED', 'payroll_simulation_disbursement', v_id::text,
    jsonb_build_object('simulation', true, 'lineId', v_line.id, 'batchId', v_batch.id, 'period', v_batch.period,
      'amount', v_line.net, 'method', v_method, 'paidOn', p_paid_on));
  return v_id;
end $$;
revoke all on function public.record_payroll_simulation_disbursement(uuid, text, text, text, date, uuid) from public, anon, authenticated;
grant execute on function public.record_payroll_simulation_disbursement(uuid, text, text, text, date, uuid) to service_role;

-- Close an approved, fully disbursed batch. Frozen afterwards.
create or replace function public.close_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype; v_undisbursed integer; v_disbursed numeric;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_close', 'update');
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'closed' then return v.status; end if;  -- idempotent
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'approved' then raise exception 'PAYROLL_BATCH_NOT_APPROVED' using errcode = '55000'; end if;
  if v.submitted_by = p_actor_id then raise exception 'PAYROLL_SELF_CLOSE' using errcode = '42501'; end if;
  -- Every payable line (computed, net > 0) must be disbursed in the table for this mode.
  if v.mode = 'simulation' then
    select count(*) filter (where d.id is null), coalesce(sum(d.amount::numeric), 0)
      into v_undisbursed, v_disbursed
      from public.payroll_lines l
      left join public.payroll_simulation_disbursements d on d.line_id = l.id
     where l.batch_id = v.id and l.status = 'computed' and l.net::numeric > 0;
  else
    select count(*) filter (where d.id is null), coalesce(sum(d.amount::numeric), 0)
      into v_undisbursed, v_disbursed
      from public.payroll_lines l
      left join public.payroll_disbursements d on d.line_id = l.id
     where l.batch_id = v.id and l.status = 'computed' and l.net::numeric > 0;
  end if;
  if v_undisbursed > 0 then
    raise exception 'PAYROLL_BATCH_NOT_FULLY_DISBURSED' using errcode = '55000',
      detail = format('%s payable line(s) not yet disbursed', v_undisbursed);
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b set status = 'closed', closed_by = p_actor_id, closed_at = now()
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_CLOSED' else 'PAYROLL_BATCH_CLOSED' end,
    'payroll_batch', v.id::text,
    jsonb_build_object('status', 'approved', 'submittedBy', v.submitted_by, 'decidedBy', v.decided_by),
    jsonb_build_object('status', 'closed', 'period', v.period, 'mode', v.mode)
      || case when v.mode = 'simulation'
              then jsonb_build_object('simulation', true, 'simulationTotalNet', v.simulation_total_net,
                     'simulatedDisbursedTotal', private.money(v_disbursed))
              else jsonb_build_object('totalNet', v.total_net, 'disbursedTotal', private.money(v_disbursed)) end);
  return 'closed';
end $$;
revoke all on function public.close_payroll_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_payroll_batch(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Month-end pre-close readiness
-- ---------------------------------------------------------------------------
-- Internal (no permission check). Simulations are ignored entirely.
create or replace function private.accounting_period_readiness_items(p_period text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb; n bigint;
begin
  -- Blocker: money recorded but not verified, dated in the period (receipt date, else
  -- the Manila date it was recorded).
  select count(*) into n from public.payments p
   where p.status = 'recorded'
     and to_char(coalesce(p.paid_on, (p.recorded_at at time zone 'Asia/Manila')::date), 'YYYY-MM') = p_period;
  if n > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'PAYMENTS_PENDING_VERIFICATION', 'count', n,
      'message', 'Payments dated in this month are recorded but not yet verified or rejected.');
  end if;
  -- Blocker: proposed (unresolved) payment adjustments effective in the period.
  select count(*) into n from public.payment_adjustments a
   where a.status = 'proposed' and to_char(a.effective_date, 'YYYY-MM') = p_period;
  if n > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'PAYMENT_ADJUSTMENTS_PENDING', 'count', n,
      'message', 'Payment adjustments effective in this month are still proposed.');
  end if;
  -- Blocker: commission payouts marked paid in the period but not reconciled with the bank.
  select count(*) into n from public.commission_payouts o
   where o.status = 'paid'
     and to_char(coalesce(o.paid_on, (o.recorded_at at time zone 'Asia/Manila')::date), 'YYYY-MM') = p_period;
  if n > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'COMMISSION_PAYOUTS_UNRECONCILED', 'count', n,
      'message', 'Commission payouts paid in this month are not yet reconciled with the bank.');
  end if;

  -- Warning: verified money posted to the period with incomplete receipt evidence/details.
  select count(*) into n from public.payments p
   where p.status = 'verified' and p.posting_period = p_period
     and (nullif(btrim(coalesce(p.receipt_storage_path, '')), '') is null
          or p.or_number is null or p.paid_on is null);
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'VERIFIED_PAYMENTS_MISSING_EVIDENCE', 'count', n,
      'message', 'Verified payments in this month are missing the receipt file, OR number or payment date.');
  end if;
  -- Warning: unreviewed same-reference / same-OR matches across contracts.
  select count(*) into n from public.payments p
   where p.status in ('recorded','verified') and p.duplicate_review_note is null
     and (case when p.status = 'verified' then p.posting_period
               else to_char(coalesce(p.paid_on, (p.recorded_at at time zone 'Asia/Manila')::date), 'YYYY-MM') end) = p_period
     and exists (select 1 from private.payment_cross_contract_matches(p.id));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'PAYMENT_REFERENCE_MATCHES', 'count', n,
      'message', 'Payments in this month share a bank reference or OR number with another contract and have no review note.');
  end if;
  -- Warning only: live payroll for the month is not closed (Q1 must never block finance close).
  select count(*) into n from public.payroll_batches b
   where b.mode = 'live' and b.period = p_period and b.status <> 'closed';
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'LIVE_PAYROLL_NOT_CLOSED', 'count', n,
      'message', 'A live payroll batch for this month is not closed. This does not block the period.');
  end if;

  return jsonb_build_object('period', p_period, 'ready', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers, 'warnings', v_warnings);
end $$;
revoke all on function private.accounting_period_readiness_items(text) from public, anon, authenticated, service_role;

create or replace function public.accounting_period_readiness(p_period text, p_actor_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  -- Same read permission as finance_period_summary.
  if not (private.has_permission_for_user(p_actor_id, 'finance.payment_verification', 'view')
          or private.has_permission_for_user(p_actor_id, 'finance.payroll', 'view')
          or private.has_permission_for_user(p_actor_id, 'finance.payroll_close', 'view')) then
    raise exception 'MUTATION_FORBIDDEN' using errcode = '42501';
  end if;
  return private.accounting_period_readiness_items(p_period);
end $$;
revoke all on function public.accounting_period_readiness(text, uuid) from public, anon, authenticated;
grant execute on function public.accounting_period_readiness(text, uuid) to service_role;

-- Re-created from 0003, identical except the PERIOD_HAS_BLOCKERS refusal.
create or replace function public.submit_accounting_period(p_period text, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.accounting_periods%rowtype; v_ready jsonb;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'create');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  -- A month that has not started cannot be submitted (and would block later closes).
  if p_period > to_char(now() at time zone 'Asia/Manila', 'YYYY-MM') then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  insert into public.accounting_periods (period) values (p_period) on conflict (period) do nothing;
  select * into v from public.accounting_periods where period = p_period for update;
  if v.status = 'ready_for_approval' and v.submitted_by = p_actor_id then return v.status; end if;  -- replay
  if v.status <> 'open' then raise exception 'PERIOD_NOT_OPEN' using errcode = '55000'; end if;
  v_ready := private.accounting_period_readiness_items(p_period);
  if jsonb_array_length(v_ready->'blockers') > 0 then
    raise exception 'PERIOD_HAS_BLOCKERS' using errcode = '55000',
      detail = (v_ready->'blockers')::text;
  end if;
  update public.accounting_periods
     set status = 'ready_for_approval', submitted_by = p_actor_id, submitted_at = now(), returned_reason = null
   where period = p_period;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'ACCOUNTING_PERIOD_SUBMITTED', 'accounting_period', p_period,
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'ready_for_approval', 'figures', private.finance_period_figures(p_period)));
  return 'ready_for_approval';
end $$;
revoke all on function public.submit_accounting_period(text, uuid) from public, anon, authenticated;
grant execute on function public.submit_accounting_period(text, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
