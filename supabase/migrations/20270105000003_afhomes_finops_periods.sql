-- AF Homes: Financial Operations Phase 3 - accounting periods and closed-month protection.
--
--   1. public.accounting_periods: one row per accounting month (Asia/Manila),
--      open -> ready_for_approval -> closed. Finance prepares and submits
--      (finance.payroll create); the closing authority closes or returns it
--      (finance.payroll_close update - Super Admin until delegated). The person
--      who submitted a period can never be the one who closes it. Periods close
--      in order and only after the month has ended. Closing is idempotent and
--      stores an immutable snapshot of the period's verified figures plus the
--      outstanding items disclosed at close.
--   2. A payment verified into a closed period can no longer change or be
--      deleted. A late receipt keeps its actual payment date and is posted to the
--      month it is verified in, which is always still open (a month cannot close
--      before it ends), so a closed month's figures never move.
--   3. public.finance_period_summary: the read-only figures behind the Finance
--      dashboard cards and the pre-close checklist.
-- No pending item blocks a close by itself: which items must block is an owner
-- policy that is not decided, so they are DISCLOSED in the snapshot instead.
-- Validation: pnpm test:db:local (section 82); supabase/security/rls_invariants.sql.
-- Down: forward only. Never delete a closed period or its snapshot.
begin;

create table if not exists public.accounting_periods (
  period text primary key check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'open' check (status in ('open','ready_for_approval','closed')),
  timezone text not null default 'Asia/Manila' check (timezone = 'Asia/Manila'),
  submitted_by uuid references public.staff_users(id) on delete restrict,
  submitted_at timestamptz,
  closed_by uuid references public.staff_users(id) on delete restrict,
  closed_at timestamptz,
  returned_reason text,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_by is not null and closed_at is not null and snapshot is not null)),
  check (status = 'open' or submitted_by is not null),
  -- Separation of duties: never closed by the person who submitted it.
  check (closed_by is null or closed_by <> submitted_by)
);
comment on table public.accounting_periods is
  'Accounting months (Asia/Manila). A closed row and its snapshot are immutable; later corrections post to an open period.';
alter table public.accounting_periods enable row level security;
revoke all on public.accounting_periods from public, anon, authenticated;

create or replace function private.accounting_period_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if old.status = 'closed' then
    raise exception 'CLOSED_PERIOD_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.accounting_period_guard() from public, anon, authenticated, service_role;
drop trigger if exists accounting_periods_guard on public.accounting_periods;
create trigger accounting_periods_guard
  before update or delete on public.accounting_periods
  for each row execute function private.accounting_period_guard();

-- 2. Money verified into a closed period never moves.
create or replace function private.payment_closed_period_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.posting_period is not null
     and exists (select 1 from public.accounting_periods p
                  where p.period = old.posting_period and p.status = 'closed')
     and (tg_op = 'DELETE'
          or (new.status, new.amount, new.posting_period) is distinct from (old.status, old.amount, old.posting_period)) then
    raise exception 'CLOSED_PERIOD_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.payment_closed_period_guard() from public, anon, authenticated, service_role;
drop trigger if exists payments_closed_period_guard on public.payments;
create trigger payments_closed_period_guard
  before update or delete on public.payments
  for each row execute function private.payment_closed_period_guard();

-- Money can never be verified INTO a closed period. Runs after
-- payments_verification_guard (trigger name order), which has already stamped
-- the Manila month. Whenever a row becomes verified - by update, or inserted
-- already verified by an import - the target period row is created if missing
-- and share-locked; a closed target is redirected to the next open month. The
-- close takes FOR UPDATE on the same row, so a verification that straddles
-- month end either lands before the close reads its figures or is redirected.
create or replace function private.payment_open_period_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_status text; v_period text := new.posting_period; v_tries integer := 0;
begin
  if new.status <> 'verified' or v_period is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'verified' then return new; end if;
  loop
    insert into public.accounting_periods (period) values (v_period) on conflict (period) do nothing;
    select p.status into v_status from public.accounting_periods p where p.period = v_period for share;
    exit when v_status is distinct from 'closed';
    v_period := to_char(to_date(v_period || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
    v_tries := v_tries + 1;
    if v_tries > 600 then raise exception 'CLOSED_PERIOD_IMMUTABLE' using errcode = '55000'; end if;
  end loop;
  new.posting_period := v_period;
  return new;
end $$;
revoke all on function private.payment_open_period_guard() from public, anon, authenticated, service_role;
drop trigger if exists payments_w_open_period_guard on public.payments;
create trigger payments_w_open_period_guard
  before insert or update on public.payments
  for each row execute function private.payment_open_period_guard();

-- 3. Period figures (no permission check: internal).
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

create or replace function public.finance_period_summary(p_period text, p_actor_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  if not (private.has_permission_for_user(p_actor_id, 'finance.payment_verification', 'view')
          or private.has_permission_for_user(p_actor_id, 'finance.payroll', 'view')
          or private.has_permission_for_user(p_actor_id, 'finance.payroll_close', 'view')) then
    raise exception 'MUTATION_FORBIDDEN' using errcode = '42501';
  end if;
  return private.finance_period_figures(p_period);
end $$;
revoke all on function public.finance_period_summary(text, uuid) from public, anon, authenticated;
grant execute on function public.finance_period_summary(text, uuid) to service_role;

-- Finance submits the month for closing.
create or replace function public.submit_accounting_period(p_period text, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.accounting_periods%rowtype;
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

-- The closing authority sends it back for correction.
create or replace function public.return_accounting_period(p_period text, p_actor_id uuid, p_reason text)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.accounting_periods%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_close', 'update');
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'PERIOD_RETURN_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v from public.accounting_periods where period = p_period for update;
  if not found then raise exception 'PERIOD_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status <> 'ready_for_approval' then raise exception 'PERIOD_NOT_READY' using errcode = '55000'; end if;
  update public.accounting_periods
     set status = 'open', submitted_by = null, submitted_at = null, returned_reason = btrim(p_reason)
   where period = p_period;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'ACCOUNTING_PERIOD_RETURNED', 'accounting_period', p_period,
    jsonb_build_object('status', 'ready_for_approval', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'open'), btrim(p_reason));
  return 'open';
end $$;
revoke all on function public.return_accounting_period(text, uuid, text) from public, anon, authenticated;
grant execute on function public.return_accounting_period(text, uuid, text) to service_role;

-- The closing authority closes it: once, in order, after the month has ended.
create or replace function public.close_accounting_period(p_period text, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.accounting_periods%rowtype; v_figures jsonb; v_snapshot jsonb;
  v_last_day date;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_close', 'update');
  select * into v from public.accounting_periods where period = p_period for update;
  if not found then raise exception 'PERIOD_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Closing twice never duplicates anything: the first snapshot is returned.
  if v.status = 'closed' then return v.snapshot; end if;
  if v.status <> 'ready_for_approval' then raise exception 'PERIOD_NOT_READY' using errcode = '55000'; end if;
  if v.submitted_by = p_actor_id then raise exception 'PERIOD_SELF_APPROVAL' using errcode = '42501'; end if;
  v_last_day := (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  if (now() at time zone 'Asia/Manila')::date <= v_last_day then
    raise exception 'PERIOD_NOT_ENDED' using errcode = '55000';
  end if;
  v_figures := private.finance_period_figures(p_period);
  if jsonb_array_length(v_figures->'earlierOpenPeriods') > 0 then
    raise exception 'PERIOD_OUT_OF_ORDER' using errcode = '55000';
  end if;
  v_snapshot := v_figures || jsonb_build_object(
    'status', 'closed', 'closedAt', now(), 'closedBy', p_actor_id,
    'submittedBy', v.submitted_by, 'timezone', 'Asia/Manila', 'calculationVersion', '2027-01-05.3');
  update public.accounting_periods
     set status = 'closed', closed_by = p_actor_id, closed_at = now(), snapshot = v_snapshot
   where period = p_period;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'ACCOUNTING_PERIOD_CLOSED', 'accounting_period', p_period,
    jsonb_build_object('status', 'ready_for_approval'), v_snapshot);
  return v_snapshot;
end $$;
revoke all on function public.close_accounting_period(text, uuid) from public, anon, authenticated;
grant execute on function public.close_accounting_period(text, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
