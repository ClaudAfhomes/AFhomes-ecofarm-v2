-- AF Homes: customer_points_position failed on EVERY call, then on first call.
-- Validation: pnpm test:db:local (sections 69 and 71 call it first).
-- select * from public.customer_points_position('00000000-0000-0000-0000-000000000000');
-- Down: restore the prior body. No rows rewritten by this file itself.
--
-- WHY, in two parts. First, inside a RETURNS TABLE function the OUT parameter
-- names are in scope as variables, so `where membership_id = p_membership_id`
-- is ambiguous between the points_accounts column and the OUT parameter:
-- PostgreSQL raises 42702 on every call. Same defect class as
-- verify_card_payment and create_earning_claim; this function was never covered
-- by the DB suite until section 69 called it, so the customer position endpoint
-- could never return.
-- Second, the function was marked STABLE while WRITING through
-- ensure_points_period (period creation, anniversary resets). PostgreSQL
-- requires side-effecting functions to be VOLATILE ("to prevent calls from
-- being optimized away"); the false STABLE promise made the FIRST call per
-- fresh account return NULL period fields while the row existed immediately
-- after. Reproduced 10+ times as STABLE, fixed as VOLATILE, verified by
-- flip-flop. Nothing else changes.
create or replace function public.customer_points_position(p_membership_id uuid)
returns table (
  membership_id uuid,
  balance bigint,
  annual_cap bigint,
  remaining_earning_capacity bigint,
  spendable bigint,
  reversal_debt bigint,
  period_start date,
  period_end date,
  tier text,
  earned_this_period bigint,
  redeemed_this_period bigint
)
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_account  public.points_accounts%rowtype;
  v_period   public.points_periods%rowtype;
  v_membership public.memberships%rowtype;
  v_period_id uuid;
  v_tier     text;
begin
  select * into v_membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- QUALIFIED: `membership_id` is both a column of points_accounts and an OUT
  -- parameter of this function, so the bare name is ambiguous (SQLSTATE 42702).
  select * into v_account from public.points_accounts as pa
   where pa.membership_id = p_membership_id;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ASSIGNMENT, never a volatile call inside a WHERE over a table scan. A
  -- `where id = ensure(...)` qual is evaluated PER SCANNED ROW, so on an empty
  -- points_periods table ensure NEVER RUNS, v_period stays null, and every
  -- period field comes back null (remaining capacity reads as 0) on the first
  -- call for a fresh database. The direct call always executes.
  -- The open period is then resolved BY ACCOUNT, not by the returned id, so a
  -- stale return can never point the read at the wrong row.
  v_period_id := private.ensure_points_period(v_account.id);
  perform 1 from public.points_periods where id = v_period_id;
  select * into v_period from public.points_periods as pp
   where pp.account_id = v_account.id and pp.status = 'open'
   order by pp.period_start desc limit 1;

  select coalesce(pc.code, 'BRONZE') into v_tier
    from public.memberships m
    left join public.card_plans pc on pc.id = m.product_id
   where m.id = p_membership_id;

  return query
    select
      p_membership_id,
      v_account.balance,
      v_period.annual_points_cap,
      -- CASTS are load-bearing: sum(bigint) is numeric, and the OUT parameters
      -- are bigint, so an uncast select fails with "structure of query does not
      -- match function result type" on every call.
      greatest(v_period.annual_points_cap
               - coalesce((select sum(pl.amount) from public.points_ledger pl
                            where pl.account_id = v_account.id
                              and pl.origin_period_id = v_period.id
                              and pl.counts_toward_cap
                              and pl.amount > 0), 0), 0)::bigint,
      greatest(v_account.balance - v_account.reversal_debt, 0),
      v_account.reversal_debt,
      v_period.period_start,
      v_period.period_end,
      v_tier,
      coalesce((select sum(pl.amount) from public.points_ledger pl
                 where pl.account_id = v_account.id
                   and pl.origin_period_id = v_period.id
                   and pl.counts_toward_cap
                   and pl.amount > 0), 0)::bigint,
      coalesce((select -sum(pl.amount) from public.points_ledger pl
                 where pl.account_id = v_account.id
                   and pl.origin_period_id = v_period.id
                   and pl.entry_type in ('redemption','reversal','expiration')), 0)::bigint;
end $$;

comment on function public.customer_points_position(uuid) is
  'Three figures, never collapsed: balance, spendable and remaining earning capacity. Alias-qualified after the ambiguous-column fix.';

revoke all on function public.customer_points_position(uuid) from public, anon, authenticated;
grant execute on function public.customer_points_position(uuid) to service_role;
