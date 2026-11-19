-- AF Homes: Financial Operations Phase 5 - IST payroll batches, Super Admin approval, disbursement records.
--
-- Monthly payroll (period 'YYYY-MM', Asia/Manila). The figures are computed by the
-- API with the pure engine (packages/shared/src/ist-payroll.ts); SQL stores and
-- GUARDS them. Authority is dynamic RBAC only, no role name is checked:
--   finance.payroll           create/update : build, submit batches, record disbursements
--   finance.payroll_approval  view/update   : approve or return a submitted batch
-- (the approval module is granted to no role row; super_admin holds it by slug).
--   1. payroll_batches: draft -> submitted -> approved | returned (-> draft on edit).
--      One non-returned batch per period. A batch is never approved by its submitter.
--      An approved batch is immutable.
--   2. payroll_lines: one per IST staff member. A line carrying ANY money must be
--      'computed' and reference the APPROVED compensation policy effective for that
--      rank at the start of the month (private.ist_compensation_policy_for);
--      otherwise it is 'blocked' with every money column NULL and a reason. A batch
--      with a blocked line cannot be submitted (PAYROLL_CONFIGURATION_REQUIRED).
--   3. payroll_disbursements: append-only record that a line's net was paid. Amount
--      equals the line net exactly; one per line; a bank reference backs one payout.
--      Recording a disbursement moves no money: there are no automatic transfers,
--      deductions or clawbacks, and no payroll period close in this migration.
-- GOVERNING GATE (owner decision, Q1 pending Presidential approval): live payroll is
-- impossible until public.governing_policy_decisions 'Q1_GOVERNING_COMPENSATION_MODEL'
-- is 'approved'. NO function in this migration can change that row; a future,
-- explicitly authorized migration will. Batches carry a mode: 'live' (needs the gate AND
-- an approved policy) or 'simulation' (figures from historical reference fixtures,
-- labelled by simulation_basis, never submitted/approved/disbursed, never in a payable total).
-- Refusals: IST_PAYROLL_NOT_AUTHORIZED (live without the gate), PAYROLL_SIMULATION_ONLY.
-- Writes to the three tables are refused unless a transaction-local flag set only by
-- the RPCs below is on, so even the service role cannot edit them directly.
-- Validation: pnpm test:db:local (section 84); supabase/security/rls_invariants.sql.
--   select count(*) from public.payroll_batches;   -- 0 until a batch is created
-- Down: forward only. Never delete payroll batches, lines or disbursement history.
begin;

-- ---------------------------------------------------------------------------
-- 1. Governing gate and tables
-- ---------------------------------------------------------------------------
create table if not exists public.governing_policy_decisions (
  key text primary key,
  status text not null default 'pending' check (status in ('pending','approved')),
  decided_by uuid references public.staff_users(id) on delete restrict,
  decided_at timestamptz,
  reference text,
  note text,
  check ((status = 'approved') = (decided_by is not null and decided_at is not null))
);
comment on table public.governing_policy_decisions is
  'Owner decisions that gate financial features. Changed only by an explicitly authorized migration (transaction-local flag); no RPC writes it.';
insert into public.governing_policy_decisions (key, status, note)
values ('Q1_GOVERNING_COMPENSATION_MODEL', 'pending', 'Awaiting Presidential approval of the governing compensation model.')
on conflict (key) do nothing;
alter table public.governing_policy_decisions enable row level security;
revoke all on public.governing_policy_decisions from public, anon, authenticated;

create or replace function private.governing_policy_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if current_setting('afhomes.governing_policy_write', true) is distinct from 'on' then
    raise exception 'GOVERNING_POLICY_LOCKED' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.governing_policy_guard() from public, anon, authenticated, service_role;
drop trigger if exists governing_policy_decisions_guard on public.governing_policy_decisions;
create trigger governing_policy_decisions_guard
  before update or delete on public.governing_policy_decisions
  for each row execute function private.governing_policy_guard();

create or replace function private.ist_payroll_live_authorized() returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.governing_policy_decisions g
                  where g.key = 'Q1_GOVERNING_COMPENSATION_MODEL' and g.status = 'approved')
$$;
revoke all on function private.ist_payroll_live_authorized() from public, anon, authenticated, service_role;

create table if not exists public.payroll_batches (
  id uuid primary key default gen_random_uuid(),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  mode text not null default 'live' check (mode in ('simulation','live')),
  simulation_basis text,
  -- Simulation figures live here, labelled, never in a payable total_* column.
  simulation_total_net text check (simulation_total_net ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  status text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  total_ba text not null default '0.00' check (total_ba ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  total_pa text not null default '0.00' check (total_pa ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  total_pb text not null default '0.00' check (total_pb ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  total_adjustments text not null default '0.00' check (total_adjustments ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  total_withheld text not null default '0.00' check (total_withheld ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  total_net text not null default '0.00' check (total_net ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  line_count integer not null default 0 check (line_count >= 0),
  computed_line_count integer not null default 0 check (computed_line_count >= 0),
  blocked_line_count integer not null default 0 check (blocked_line_count >= 0),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  submitted_by uuid references public.staff_users(id) on delete restrict,
  submitted_at timestamptz,
  decided_by uuid references public.staff_users(id) on delete restrict,
  decided_at timestamptz,
  return_reason text,
  updated_at timestamptz not null default now(),
  check (line_count = computed_line_count + blocked_line_count),
  check ((mode = 'simulation') = (length(btrim(coalesce(simulation_basis, ''))) >= 10)),
  check (mode = 'simulation' or simulation_total_net is null),
  -- A simulation can never be submitted, approved or returned.
  check (mode = 'live' or status = 'draft'),
  check (status not in ('submitted','approved') or (submitted_by is not null and submitted_at is not null)),
  check ((status in ('approved','returned')) = (decided_by is not null and decided_at is not null)),
  check (status <> 'returned' or length(btrim(coalesce(return_reason, ''))) >= 5),
  -- Separation of duties: a batch is never approved by the person who submitted it.
  check (status <> 'approved' or decided_by <> submitted_by)
);
comment on table public.payroll_batches is
  'Monthly IST payroll batch. Figures come from the API engine; SQL guards the lifecycle. An approved batch is immutable. Never pays anything by itself.';
create unique index if not exists payroll_batches_one_live_per_period
  on public.payroll_batches (period, mode) where status <> 'returned';
alter table public.payroll_batches enable row level security;
revoke all on public.payroll_batches from public, anon, authenticated;

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payroll_batches(id) on delete restrict,
  staff_id uuid not null references public.staff_users(id) on delete restrict,
  rank text not null check (rank in ('SM','SSM','SVD')),
  status text not null check (status in ('computed','blocked')),
  blocked_reason text,
  policy_id uuid references public.ist_compensation_policies(id) on delete restrict,
  ba text check (ba ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  pa text check (pa ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  pb text check (pb ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  adjustments text check (adjustments ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  withheld text check (withheld ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  net text check (net ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  -- A computed line carries every figure and its approved policy; a blocked line carries none.
  -- (a LIVE computed line must also cite its approved policy: enforced by payroll_line_guard)
  check (status <> 'computed' or (ba is not null and pa is not null
         and pb is not null and adjustments is not null and withheld is not null and net is not null)),
  check (status <> 'blocked' or (ba is null and pa is null and pb is null and adjustments is null
         and withheld is null and net is null
         and length(btrim(coalesce(blocked_reason, ''))) >= 3))
);
comment on table public.payroll_lines is
  'One IST staff member in a batch. Money is non-null only when the line references the approved compensation policy effective for its rank and month; otherwise the line is blocked with no figures.';
create unique index if not exists payroll_lines_batch_staff_unique on public.payroll_lines (batch_id, staff_id);
create index if not exists payroll_lines_staff_idx on public.payroll_lines (staff_id);
alter table public.payroll_lines enable row level security;
revoke all on public.payroll_lines from public, anon, authenticated;

create table if not exists public.payroll_disbursements (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.payroll_lines(id) on delete restrict,
  amount text not null check (amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
    and case when amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then amount::numeric > 0 else false end),
  method text not null check (length(btrim(method)) between 1 and 40),
  bank_reference text not null check (length(btrim(bank_reference)) between 1 and 100
    and private.normalize_payment_key(bank_reference) is not null),
  paid_on date not null,
  recorded_by uuid not null references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
comment on table public.payroll_disbursements is
  'Append-only record that an approved payroll line was paid. A recorded fact, not a bank transfer made by the system.';
create unique index if not exists payroll_disbursements_one_per_line on public.payroll_disbursements (line_id);
create unique index if not exists payroll_disbursements_reference_unique
  on public.payroll_disbursements (private.normalize_payment_key(bank_reference));
alter table public.payroll_disbursements enable row level security;
revoke all on public.payroll_disbursements from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guards (transaction-local flag set only by the RPCs below)
-- ---------------------------------------------------------------------------
create or replace function private.payroll_batch_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
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
  -- Only a simulation's label may be restated (a re-run states its new basis).
  if new.simulation_basis is distinct from old.simulation_basis and new.mode <> 'simulation' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if new.status in ('submitted','approved') then
    if new.mode = 'simulation' then
      raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000';
    end if;
    if not private.ist_payroll_live_authorized() then
      raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
  end if;
  if not ((old.status, new.status) in (('draft','draft'), ('draft','submitted'),
          ('submitted','approved'), ('submitted','returned'), ('returned','draft'))) then
    raise exception 'PAYROLL_BATCH_TRANSITION_INVALID' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.payroll_batch_guard() from public, anon, authenticated, service_role;
drop trigger if exists payroll_batches_guard on public.payroll_batches;
create trigger payroll_batches_guard
  before insert or update or delete on public.payroll_batches
  for each row execute function private.payroll_batch_guard();

create or replace function private.payroll_line_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_period text; v_status text; v_mode text; v_policy_id uuid;
  v_re constant text := '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$';
begin
  select b.period, b.status, b.mode into v_period, v_status, v_mode from public.payroll_batches b
   where b.id = case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
  -- Lines are editable only while their batch is a draft.
  if v_status is distinct from 'draft' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'PAYROLL_LINE_IMMUTABLE' using errcode = '55000';
  end if;
  if current_setting('afhomes.payroll_write', true) is distinct from 'on' then
    raise exception 'PAYROLL_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if new.status = 'blocked' then
    if new.ba is not null or new.pa is not null or new.pb is not null or new.adjustments is not null
       or new.withheld is not null or new.net is not null
       or length(btrim(coalesce(new.blocked_reason, ''))) < 3 then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
  elsif new.status = 'computed' then
    if new.ba is null or new.pa is null or new.pb is null or new.adjustments is null
       or new.withheld is null or new.net is null
       or new.ba !~ v_re or new.pa !~ v_re or new.pb !~ v_re or new.adjustments !~ v_re
       or new.withheld !~ v_re or new.net !~ v_re then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
    if v_mode = 'simulation' then
      -- Figures from historical reference fixtures: allowed only in a simulation, which must
      -- record the policy snapshot it used and can never become payable.
      if not (new.inputs ? 'policySnapshot') then
        raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
      end if;
    else
      if not private.ist_payroll_live_authorized() then
        raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
      end if;
      -- No payable figure without the approved policy effective for this rank and month.
      select p.id into v_policy_id
        from private.ist_compensation_policy_for(new.rank, to_date(v_period || '-01', 'YYYY-MM-DD')) p;
      if v_policy_id is null or new.policy_id is distinct from v_policy_id then
        raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
      end if;
    end if;
    if new.net::numeric <> greatest(0::numeric,
         new.ba::numeric + new.pa::numeric + new.pb::numeric - new.withheld::numeric - new.adjustments::numeric) then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
  else
    raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.payroll_line_guard() from public, anon, authenticated, service_role;
drop trigger if exists payroll_lines_guard on public.payroll_lines;
create trigger payroll_lines_guard
  before insert or update or delete on public.payroll_lines
  for each row execute function private.payroll_line_guard();

create or replace function private.payroll_disbursement_guard() returns trigger
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
  if v_mode = 'simulation' then
    raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000';
  end if;
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
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
revoke all on function private.payroll_disbursement_guard() from public, anon, authenticated, service_role;
drop trigger if exists payroll_disbursements_guard on public.payroll_disbursements;
create trigger payroll_disbursements_guard
  before insert or update or delete on public.payroll_disbursements
  for each row execute function private.payroll_disbursement_guard();

-- Truncation would bypass every row guard above; refuse it on all four tables.
create or replace function private.payroll_truncate_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'PAYROLL_DIRECT_WRITE_REFUSED' using errcode = '42501';
end $$;
revoke all on function private.payroll_truncate_guard() from public, anon, authenticated, service_role;
create or replace function private.governing_policy_truncate_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'GOVERNING_POLICY_LOCKED' using errcode = '55000';
end $$;
revoke all on function private.governing_policy_truncate_guard() from public, anon, authenticated, service_role;
drop trigger if exists payroll_batches_no_truncate on public.payroll_batches;
create trigger payroll_batches_no_truncate before truncate on public.payroll_batches
  for each statement execute function private.payroll_truncate_guard();
drop trigger if exists payroll_lines_no_truncate on public.payroll_lines;
create trigger payroll_lines_no_truncate before truncate on public.payroll_lines
  for each statement execute function private.payroll_truncate_guard();
drop trigger if exists payroll_disbursements_no_truncate on public.payroll_disbursements;
create trigger payroll_disbursements_no_truncate before truncate on public.payroll_disbursements
  for each statement execute function private.payroll_truncate_guard();
drop trigger if exists governing_policy_decisions_no_truncate on public.governing_policy_decisions;
create trigger governing_policy_decisions_no_truncate before truncate on public.governing_policy_decisions
  for each statement execute function private.governing_policy_truncate_guard();

-- True when every computed line still references the approved policy effective for its rank/month.
create or replace function private.payroll_batch_policies_ok(p_batch_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select not exists (
    select 1 from public.payroll_lines l
      join public.payroll_batches b on b.id = l.batch_id
     where l.batch_id = p_batch_id and l.status = 'computed'
       and (select p.id from private.ist_compensation_policy_for(l.rank, to_date(b.period || '-01', 'YYYY-MM-DD')) p)
           is distinct from l.policy_id)
$$;
revoke all on function private.payroll_batch_policies_ok(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs (service_role only; actor re-validated against dynamic permissions)
-- ---------------------------------------------------------------------------
create or replace function public.create_payroll_batch(
  p_period text, p_actor_id uuid, p_mode text default 'live', p_simulation_basis text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_id uuid; v_old_basis text; v_basis text := nullif(btrim(coalesce(p_simulation_basis, '')), '');
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
  -- Idempotent: the period's existing batch of this mode (any status) is returned, never duplicated.
  select b.id into v_id from public.payroll_batches b where b.period = p_period and b.mode = p_mode
   order by b.created_at desc, b.id limit 1;
  if v_id is not null then
    -- A simulation re-run restates its basis: the label always describes the latest figures.
    if p_mode = 'simulation' then
      select b.simulation_basis into v_old_basis from public.payroll_batches b where b.id = v_id;
      if v_old_basis is distinct from v_basis then
        perform set_config('afhomes.payroll_write', 'on', true);
        update public.payroll_batches b set simulation_basis = v_basis where b.id = v_id;
        perform set_config('afhomes.payroll_write', 'off', true);
        insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
        values (p_actor_id, 'PAYROLL_SIMULATION_BASIS_UPDATED', 'payroll_batch', v_id::text,
          jsonb_build_object('simulationBasis', v_old_basis), jsonb_build_object('simulationBasis', v_basis));
      end if;
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
    jsonb_build_object('period', p_period, 'status', 'draft', 'mode', p_mode));
  return v_id;
end $$;
revoke all on function public.create_payroll_batch(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_payroll_batch(text, uuid, text, text) to service_role;

-- Replaces ALL lines of a draft (or returned, which reopens to draft) batch and
-- recomputes the batch totals from the stored lines.
-- Each element: staffId, rank, status, blockedReason, policyId, ba, pa, pb, adjustments,
-- withheld, net, inputs, result.
create or replace function public.replace_payroll_batch_lines(p_batch_id uuid, p_lines jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v public.payroll_batches%rowtype; e jsonb; k text; v_money text[];
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_re constant text := '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$';
  v_totals jsonb;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
  end if;
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status not in ('draft','returned') then
    raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '55000';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines) x)
     <> (select count(distinct x->>'staffId') from jsonb_array_elements(p_lines) x) then
    raise exception 'PAYROLL_LINE_DUPLICATE' using errcode = '23505';
  end if;

  perform set_config('afhomes.payroll_write', 'on', true);
  if v.status = 'returned' then
    update public.payroll_batches b
       set status = 'draft', submitted_by = null, submitted_at = null, decided_by = null, decided_at = null
     where b.id = v.id;
  end if;
  delete from public.payroll_lines l where l.batch_id = v.id;
  for e in select x from jsonb_array_elements(p_lines) x loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'staffId', '') !~ v_uuid
       or (e->>'policyId' is not null and e->>'policyId' !~ v_uuid)
       or jsonb_typeof(coalesce(e->'inputs', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(e->'result', '{}'::jsonb)) <> 'object' then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
    v_money := array[]::text[];
    foreach k in array array['ba','pa','pb','adjustments','withheld','net'] loop
      if e->>k is not null and e->>k !~ v_re then
        raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
      end if;
      v_money := v_money || coalesce(private.money((e->>k)::numeric), '')::text;
    end loop;
    insert into public.payroll_lines
      (batch_id, staff_id, rank, status, blocked_reason, policy_id, ba, pa, pb, adjustments, withheld, net, inputs, result)
    values (v.id, (e->>'staffId')::uuid, e->>'rank', e->>'status', nullif(btrim(e->>'blockedReason'), ''),
      (e->>'policyId')::uuid, nullif(v_money[1], ''), nullif(v_money[2], ''), nullif(v_money[3], ''),
      nullif(v_money[4], ''), nullif(v_money[5], ''), nullif(v_money[6], ''),
      coalesce(e->'inputs', '{}'::jsonb), coalesce(e->'result', '{}'::jsonb));
  end loop;

  update public.payroll_batches b set
    total_ba = private.money(coalesce((select sum(l.ba::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed' and b.mode = 'live'), 0)),
    total_pa = private.money(coalesce((select sum(l.pa::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed' and b.mode = 'live'), 0)),
    total_pb = private.money(coalesce((select sum(l.pb::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed' and b.mode = 'live'), 0)),
    total_adjustments = private.money(coalesce((select sum(l.adjustments::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed' and b.mode = 'live'), 0)),
    total_withheld = private.money(coalesce((select sum(l.withheld::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed' and b.mode = 'live'), 0)),
    total_net = private.money(coalesce((select sum(l.net::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed' and b.mode = 'live'), 0)),
    simulation_total_net = case when b.mode = 'simulation' then
      private.money(coalesce((select sum(l.net::numeric) from public.payroll_lines l
                 where l.batch_id = b.id and l.status = 'computed'), 0)) end,
    line_count = (select count(*) from public.payroll_lines l where l.batch_id = b.id),
    computed_line_count = (select count(*) from public.payroll_lines l where l.batch_id = b.id and l.status = 'computed'),
    blocked_line_count = (select count(*) from public.payroll_lines l where l.batch_id = b.id and l.status = 'blocked')
   where b.id = v.id
  returning jsonb_build_object('status', b.status, 'mode', b.mode,
    'simulationTotalNet', b.simulation_total_net, 'lineCount', b.line_count,
    'computedLineCount', b.computed_line_count, 'blockedLineCount', b.blocked_line_count,
    'totalBa', b.total_ba, 'totalPa', b.total_pa, 'totalPb', b.total_pb,
    'totalAdjustments', b.total_adjustments, 'totalWithheld', b.total_withheld, 'totalNet', b.total_net)
  into v_totals;
  perform set_config('afhomes.payroll_write', 'off', true);

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'PAYROLL_BATCH_LINES_REPLACED', 'payroll_batch', v.id::text,
    jsonb_build_object('status', v.status, 'lineCount', v.line_count), v_totals);
  return v_totals;
end $$;
revoke all on function public.replace_payroll_batch_lines(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.replace_payroll_batch_lines(uuid, jsonb, uuid) to service_role;

create or replace function public.submit_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.mode = 'simulation' then raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000'; end if;
  if v.status = 'submitted' and v.submitted_by = p_actor_id then return v.status; end if;  -- replay
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '55000'; end if;
  if v.line_count = 0 then raise exception 'PAYROLL_BATCH_EMPTY' using errcode = '55000'; end if;
  if v.blocked_line_count > 0
     or exists (select 1 from public.payroll_lines l where l.batch_id = v.id and l.status = 'blocked')
     or not private.payroll_batch_policies_ok(v.id) then
    raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'submitted', submitted_by = p_actor_id, submitted_at = now(), return_reason = null
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'PAYROLL_BATCH_SUBMITTED', 'payroll_batch', v.id::text,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'submitted', 'period', v.period, 'lineCount', v.line_count, 'totalNet', v.total_net));
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
  if v.mode = 'simulation' then raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000'; end if;
  if v.status = 'approved' and v.decided_by = p_actor_id then return v.status; end if;  -- replay
  -- The governing gate is re-checked at call time, not trusted from submission.
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'PAYROLL_BATCH_NOT_SUBMITTED' using errcode = '55000'; end if;
  if v.submitted_by = p_actor_id then raise exception 'PAYROLL_SELF_APPROVAL' using errcode = '42501'; end if;
  if not private.payroll_batch_policies_ok(v.id) then
    raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'approved', decided_by = p_actor_id, decided_at = now()
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'PAYROLL_BATCH_APPROVED', 'payroll_batch', v.id::text,
    jsonb_build_object('status', 'submitted', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'approved', 'period', v.period, 'totalNet', v.total_net));
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
  if v.mode = 'simulation' then raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000'; end if;
  if v.status = 'returned' and v.decided_by = p_actor_id and v.return_reason = v_reason then
    return v.status;  -- replay
  end if;
  if v.status <> 'submitted' then raise exception 'PAYROLL_BATCH_NOT_SUBMITTED' using errcode = '55000'; end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'returned', decided_by = p_actor_id, decided_at = now(), return_reason = v_reason
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'PAYROLL_BATCH_RETURNED', 'payroll_batch', v.id::text,
    jsonb_build_object('status', 'submitted', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'returned', 'period', v.period), v_reason);
  return 'returned';
end $$;
revoke all on function public.return_payroll_batch(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.return_payroll_batch(uuid, text, uuid) to service_role;

create or replace function public.record_payroll_disbursement(
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
  -- Lock order: batch (share) then line.
  select l.* into v_line from public.payroll_lines l where l.id = p_line_id;
  if not found then raise exception 'PAYROLL_LINE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_batch from public.payroll_batches b where b.id = v_line.batch_id for share;
  select * into v_line from public.payroll_lines l where l.id = p_line_id for update;
  if v_batch.mode = 'simulation' then raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000'; end if;
  -- Re-checked at call time, like approval.
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  -- Replay (decided before the lifecycle checks): same line and same normalized reference.
  select d.id into v_id from public.payroll_disbursements d
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
  if exists (select 1 from public.payroll_disbursements d where d.line_id = v_line.id) then
    raise exception 'PAYROLL_LINE_ALREADY_DISBURSED' using errcode = '23505';
  end if;
  if exists (select 1 from public.payroll_disbursements d
              where private.normalize_payment_key(d.bank_reference) = private.normalize_payment_key(v_ref)) then
    raise exception 'DUPLICATE_PAYOUT_REFERENCE' using errcode = '23505';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  insert into public.payroll_disbursements (line_id, amount, method, bank_reference, paid_on, recorded_by)
  values (v_line.id, v_line.net, v_method, v_ref, p_paid_on, p_actor_id)
  returning id into v_id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'PAYROLL_DISBURSEMENT_RECORDED', 'payroll_disbursement', v_id::text,
    jsonb_build_object('lineId', v_line.id, 'batchId', v_batch.id, 'period', v_batch.period,
      'amount', v_line.net, 'method', v_method, 'paidOn', p_paid_on));
  return v_id;
end $$;
revoke all on function public.record_payroll_disbursement(uuid, text, text, text, date, uuid) from public, anon, authenticated;
grant execute on function public.record_payroll_disbursement(uuid, text, text, text, date, uuid) to service_role;

-- Submitted batches awaiting a holder of finance.payroll_approval.
create or replace function public.pending_payroll_approvals(p_actor_id uuid)
returns table (
  pending_batch_id uuid, pending_period text, pending_line_count integer,
  pending_computed_count integer, pending_total_net text,
  pending_submitted_by uuid, pending_submitted_at timestamptz
) language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_approval', 'view');
  return query
    select b.id, b.period, b.line_count, b.computed_line_count, b.total_net, b.submitted_by, b.submitted_at
      from public.payroll_batches b
     where b.status = 'submitted' and b.mode = 'live'
     order by b.submitted_at, b.id;
end $$;
revoke all on function public.pending_payroll_approvals(uuid) from public, anon, authenticated;
grant execute on function public.pending_payroll_approvals(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
