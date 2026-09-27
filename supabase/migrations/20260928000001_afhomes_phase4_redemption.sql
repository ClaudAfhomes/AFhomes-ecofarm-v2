-- ===========================================================================
-- AF Homes Phase 4 - staff redemption of customer points.
-- ===========================================================================
-- Validation before apply (every query must return zero rows):
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname in ('public','private') and p.prosecdef
--      and array_to_string(coalesce(p.proconfig, '{}'), ',') not like '%search_path%';
--   select has_table_privilege('authenticated','public.redemptions','select');
--   select has_table_privilege('authenticated','public.redemption_items','select');
--   select m.points_balance = coalesce(a.balance, 0)
--     from public.memberships m
--     left join public.points_accounts a on a.membership_id = m.id
--    where m.points_balance <> coalesce(a.balance, 0);
--
-- Down: drop public.redeem_membership_points, public.next_redemption_number and
--       the redemption_number sequence; drop the two tables. Note that
--       memberships.points_balance backfill below is NOT reversible - it
--       repairs a column that was wrong before this migration.
--
-- No new module keys. `operations.redemption` and `operations.catalog` already
-- exist from Phase 1, so redemption adds NO new authorization vocabulary: one
-- permission system, reused.

-- ===========================================================================
-- 1. Redemption catalog
-- ===========================================================================
-- Database-backed, so no redemption item is ever hardcoded in a component. An
-- item is deactivated, never deleted: a redemption must always be able to point
-- at the item it was priced from.
--
-- points_cost is an exact bigint count of points. Points are NOT currency, so
-- this is deliberately NOT money: no numeric/text decimal, no `private.money`,
-- no rounding. Whole units only, because no business requirement for fractional
-- points exists and inventing one would be inventing policy.
--
-- The upper bound is a data-integrity guard, not a business rule: it exists only
-- so `points_cost * quantity` cannot overflow a bigint. It is orders of
-- magnitude above any plausible points balance.

create table if not exists public.redemption_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  category text not null default 'general',
  points_cost bigint not null check (points_cost > 0 and points_cost <= 1000000000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.redemption_items is
  'Redeemable AF Homes items and services, priced in whole points. Deactivated, never deleted, so historical redemptions always keep a resolvable item. No image column: nothing needs one yet and an unused nullable column is an invitation to store customer-adjacent binaries.';

create index if not exists redemption_items_active_sort_idx
  on public.redemption_items (is_active, sort_order, name);

-- ===========================================================================
-- 2. Redemption transactions
-- ===========================================================================
-- An auditable record with SNAPSHOTS of the item. Editing an item's name or
-- price must never rewrite history, so the redemption stores its own copies.
-- This is the same rule as card_sales' commercial snapshots.
--
-- `status` includes 'voided' and the void columns are present so a future
-- reversal has a home, but NOTHING in this phase writes them: the authorization
-- and accounting rule for a void is an unresolved business decision, and the
-- check below makes a half-recorded void impossible. A future void must APPEND a
-- compensating `points_ledger` row of type 'reversal'; the original debit is
-- never edited, because the ledger is append-only history.

create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  redemption_number text not null unique,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  points_account_id uuid not null references public.points_accounts(id) on delete restrict,
  redemption_item_id uuid not null references public.redemption_items(id) on delete restrict,

  -- Item snapshots. History is frozen here; the catalog may change freely.
  item_code_snapshot text not null,
  item_name_snapshot text not null,
  points_cost_snapshot bigint not null check (points_cost_snapshot > 0),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 99),
  total_points bigint not null check (total_points > 0),
  check (total_points = points_cost_snapshot * quantity),

  -- Balance snapshots. Recorded so the receipt is reproducible and so an
  -- idempotent replay returns the ORIGINAL figures rather than reconstructing
  -- them from a balance that may since have moved for unrelated reasons.
  balance_before_snapshot bigint not null check (balance_before_snapshot >= 0),
  balance_after_snapshot bigint not null check (balance_after_snapshot >= 0),
  check (balance_after_snapshot = balance_before_snapshot - total_points),

  -- The acting staff member. Resolved from the authenticated session on the
  -- server; a redemption can never be attributed to a caller-supplied id.
  redeemed_by uuid not null references public.staff_users(id) on delete restrict,
  redeemed_by_name text not null,

  status text not null default 'completed' check (status in ('completed', 'voided')),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),

  -- Reserved for a future, explicitly-specified void rule. Unused in Phase 4.
  voided_at timestamptz,
  voided_by uuid references public.staff_users(id) on delete restrict,
  void_reason text,
  check (
    (status = 'completed' and voided_at is null and voided_by is null and void_reason is null)
    or
    (status = 'voided' and voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

comment on table public.redemptions is
  'Points redemption transactions. Item name, code and price are snapshotted, so later catalog edits cannot alter history. Void columns are schema-only: no handler writes them because the void authorization and accounting rule is an unresolved business decision.';

-- Idempotency. Scoped to the acting staff member, not globally: a global key
-- would let one staff member collide with (and thereby read) another member's
-- receipt, and a POS retry always comes from the same member who issued it.
-- The index is created after the ALTER below, once the column exists.

create index if not exists redemptions_membership_idx
  on public.redemptions (membership_id, created_at desc);
create index if not exists redemptions_item_idx
  on public.redemptions (redemption_item_id, created_at desc);
create index if not exists redemptions_redeemed_by_idx
  on public.redemptions (redeemed_by, created_at desc);
create index if not exists redemptions_created_idx
  on public.redemptions (created_at desc);

-- ===========================================================================
-- 3. Idempotency key column
-- ===========================================================================
-- Nullable so the constraint is a plain unique index (Postgres treats NULLs as
-- distinct, so a redemption written by anything other than this function could
-- omit it). Every redemption created through public.redeem_membership_points
-- sets it, and the function requires it.
--
-- The key is a client-generated opaque string. It is a de-duplication token, not
-- a secret: it authorizes nothing and carries no membership data.

alter table public.redemptions
  add column if not exists idempotency_key text
  check (idempotency_key is null or (length(idempotency_key) between 8 and 200));

create unique index if not exists redemptions_actor_idempotency_uidx
  on public.redemptions (redeemed_by, idempotency_key);

-- Redemption numbers, following the existing next_sale_number convention.
create sequence if not exists public.redemption_number_seq;
revoke all on sequence public.redemption_number_seq from public, anon, authenticated;
grant usage on sequence public.redemption_number_seq to service_role;

create or replace function public.next_redemption_number()
returns table (redemption_number text)
language sql
volatile
as $$
  select 'RDM-' || to_char(nextval('public.redemption_number_seq'), 'FM000000')
$$;

comment on function public.next_redemption_number() is
  'Sequential, human-quotable redemption number. Display only - it authorizes nothing.';

-- ===========================================================================
-- 4. memberships.points_balance is a materialized cache, and it was wrong
-- ===========================================================================
-- Phase 1 added `memberships.points_balance`; Phase 2's activation RPC inserted
-- it as 0 and only ever credited `points_accounts`. So the column has read 0 for
-- every member since activation, and the staff identifier lookup
-- (GET /memberships/resolve) reports `pointsBalance: 0` - a member with 60,000
-- points looks like they have none. The customer portal reads it too.
--
-- `points_accounts` is the authoritative balance (Phase 2 decision). The column
-- stays as a cache, is repaired here, and is kept in step by the redemption
-- function. Chosen over deleting the column because six Phase 2/3 readers
-- already depend on it, and a cache that lies is worse than no cache.

update public.memberships m
set points_balance = coalesce(a.balance, 0)
from (
  select membership_id, balance from public.points_accounts
) a
where a.membership_id = m.id
  and m.points_balance <> a.balance;

-- ===========================================================================
-- 5. The redemption transaction
-- ===========================================================================
-- ONE function, ONE transaction. Supabase REST/PostgREST cannot span statements
-- in a transaction, and an API handler cannot hold a row lock across requests,
-- so the balance check and the debit MUST live in the database together.
--
-- Lock order is fixed and total: membership -> customer -> item -> points
-- account. Always this order, so two concurrent redemptions can never deadlock
-- by taking the same two locks in opposite orders.
--
-- The points account lock is the serialization point for overspending. It is
-- taken BEFORE the balance is read, so the read is of the post-commit value and
-- a second terminal sees the already-debited balance.
--
-- Nothing from the client is trusted except: WHICH membership, WHICH item, HOW
-- MANY, and the de-duplication key. The price, the balance, the status, the
-- product and the acting staff identity are all read or re-derived here.

create or replace function public.redeem_membership_points(
  p_membership_id uuid,
  p_redemption_item_id uuid,
  p_quantity integer,
  p_idempotency_key text,
  p_actor_id uuid
)
returns table (
  redemption_id uuid,
  redemption_number text,
  item_code text,
  item_name text,
  unit_points bigint,
  quantity integer,
  total_points bigint,
  balance_before bigint,
  balance_after bigint,
  customer_name text,
  membership_number text,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_membership public.memberships%rowtype;
  v_customer public.customers%rowtype;
  v_item public.redemption_items%rowtype;
  v_account public.points_accounts%rowtype;
  v_existing public.redemptions%rowtype;
  v_actor public.staff_users%rowtype;
  v_total bigint;
  v_after bigint;
  v_name text;
  v_number text;
  v_completed_at timestamptz;
begin
  ------------------------------------------------------------------
  -- 0. The actor is re-validated here, not trusted from the caller.
  --    The handler resolves this from the session, but a SECURITY DEFINER
  --    function must not take an id on faith: a suspended or deleted employee
  --    must not be able to redeem even if a handler bug passed their id.
  ------------------------------------------------------------------
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(p_quantity, 0) < 1 or p_quantity > 99 then
    raise exception 'INVALID_QUANTITY:%', coalesce(p_quantity, 0) using errcode = '22023';
  end if;

  select * into v_actor from public.staff_users s where s.id = p_actor_id;
  if not found then
    raise exception 'ACTOR_NOT_STAFF' using errcode = '42501';
  end if;
  if v_actor.status <> 'active' then
    raise exception 'ACTOR_NOT_ACTIVE:%', v_actor.status using errcode = '42501';
  end if;

  ------------------------------------------------------------------
  -- 1. Lock the membership, then the customer. Both FOR UPDATE, in that order.
  ------------------------------------------------------------------
  select * into v_membership from public.memberships m
  where m.id = p_membership_id for update;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_customer from public.customers c
  where c.id = v_membership.customer_id for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE:%', v_customer.status using errcode = '55000';
  end if;
  v_name := trim(concat_ws(' ', v_customer.first_name, v_customer.middle_name, v_customer.last_name));

  -- 2. The membership must be live. `expires_at` is authoritative (it is set at
  --    activation from the approved validity in months). Expiry here is a
  --    REFUSAL only - this function does not flip `status` to 'expired', because
  --    what happens to a membership after it lapses is an unresolved renewal
  --    policy and must not be defined as a side effect of a redemption.
  if v_membership.status <> 'active' then
    raise exception 'MEMBERSHIP_NOT_ACTIVE:%', v_membership.status using errcode = '55000';
  end if;
  if v_membership.expires_at <= now() then
    raise exception 'MEMBERSHIP_EXPIRED' using errcode = '55000';
  end if;

  ------------------------------------------------------------------
  -- 3. Lock the item and read the price FROM THE DATABASE. A client-supplied
  --    cost is never consulted, let alone trusted.
  ------------------------------------------------------------------
  select * into v_item from public.redemption_items i
  where i.id = p_redemption_item_id for update;
  if not found then
    raise exception 'REDEMPTION_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_item.is_active then
    raise exception 'REDEMPTION_ITEM_INACTIVE:%', v_item.code using errcode = '55000';
  end if;

  ------------------------------------------------------------------
  -- 4. Lock the points account. THIS is the serialization point: every
  --    redemption against this membership queues here, and the balance read
  --    below is of the committed value.
  ------------------------------------------------------------------
  select * into v_account from public.points_accounts a
  where a.membership_id = p_membership_id for update;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  ------------------------------------------------------------------
  -- 5. Idempotency, checked AFTER the locks.
  --    Deliberately late: a retry arrives after the original committed, so it
  --    must observe the original's row and return that same receipt - even
  --    though the balance has since dropped below the item cost. Checked early,
  --    a retry racing the original would slip through and the unique index would
  --    turn it into a 500 instead of a receipt.
  ------------------------------------------------------------------
  select * into v_existing from public.redemptions r
  where r.redeemed_by = p_actor_id and r.idempotency_key = p_idempotency_key;
  if found then
    -- Return the original receipt verbatim, from its own snapshots. The CURRENT
    -- account balance is not substituted: a retry must show the figures the
    -- customer was actually charged, not today's balance.
    return query
      select v_existing.id, v_existing.redemption_number,
             v_existing.item_code_snapshot, v_existing.item_name_snapshot,
             v_existing.points_cost_snapshot, v_existing.quantity, v_existing.total_points,
             v_existing.balance_before_snapshot, v_existing.balance_after_snapshot,
             v_name, v_membership.membership_number, v_existing.completed_at;
    return;
  end if;

  ------------------------------------------------------------------
  -- 6. Price it and prove the balance is sufficient. Both are bigint maths on
  --    whole points; no decimal, no rounding, no float.
  ------------------------------------------------------------------
  v_total := v_item.points_cost * p_quantity;
  if v_total <= 0 or v_total > 99000000000 then
    raise exception 'INVALID_TOTAL_POINTS' using errcode = '22023';
  end if;
  if v_account.balance < v_total then
    -- The business-safe refusal: what is short, never the balance itself, so a
    -- probing caller learns nothing it could not already see from the preview.
    raise exception 'INSUFFICIENT_POINTS:need %', v_total using errcode = '55000';
  end if;
  v_after := v_account.balance - v_total;

  ------------------------------------------------------------------
  -- 7. Record the transaction. Snapshots are frozen here.
  ------------------------------------------------------------------
  v_number := (select r.redemption_number from public.next_redemption_number() r);
  v_completed_at := now();

  insert into public.redemptions (
    redemption_number,
    membership_id, customer_id, points_account_id, redemption_item_id,
    item_code_snapshot, item_name_snapshot, points_cost_snapshot,
    quantity, total_points, balance_before_snapshot, balance_after_snapshot,
    redeemed_by, redeemed_by_name, status, completed_at, idempotency_key
  ) values (
    v_number,
    v_membership.id, v_customer.id, v_account.id, v_item.id,
    v_item.code, v_item.name, v_item.points_cost,
    p_quantity, v_total, v_account.balance, v_after,
    p_actor_id, v_actor.full_name, 'completed', v_completed_at, p_idempotency_key
  )
  returning id into v_existing.id;

  ------------------------------------------------------------------
  -- 8. Append exactly one ledger movement. The original rows are never edited;
  --    a future reversal appends a compensating `reversal` entry.
  ------------------------------------------------------------------
  insert into public.points_ledger (
    account_id, entry_type, amount, balance_after,
    reference_type, reference_id, actor_id, reason, metadata
  ) values (
    v_account.id, 'redemption', -v_total, v_after,
    'redemption', v_existing.id::text, p_actor_id,
    'Redeemed ' || v_item.name || ' (' || v_item.code || ')'
      || case when p_quantity > 1 then ' x' || p_quantity::text else '' end,
    jsonb_build_object('redemptionNumber', v_number, 'itemCode', v_item.code)
  );

  ------------------------------------------------------------------
  -- 9. Debit. The account CHECK (balance >= 0) is the last line of defence; the
  --    balance check in step 6 is what makes it unreachable.
  ------------------------------------------------------------------
  update public.points_accounts
  set balance = v_after,
      lifetime_redeemed = lifetime_redeemed + v_total,
      updated_at = now()
  where id = v_account.id;

  -- Keep the materialized cache honest (see the backfill above).
  update public.memberships
  set points_balance = v_after
  where id = v_membership.id;

  ------------------------------------------------------------------
  -- 10. Audit. No QR token, no fallback code, no government ID, no password -
  --     only ids and the points figure.
  ------------------------------------------------------------------
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_id, 'REDEMPTION_COMPLETED', 'redemption', v_existing.id::text,
    jsonb_build_object(
      'redemptionNumber', v_number,
      'membershipId', v_membership.id,
      'itemCode', v_item.code,
      'totalPoints', v_total
    )
  );

  return query
    select v_existing.id, v_number, v_item.code, v_item.name,
           v_item.points_cost, p_quantity, v_total,
           v_account.balance, v_after,
           v_name, v_membership.membership_number, v_completed_at;
end $$;

comment on function public.redeem_membership_points(uuid, uuid, integer, text, uuid) is
  'Redeems points for an item in ONE transaction: locks membership, customer, item and points account in that fixed order, re-validates the acting staff member, reads the price from the catalog, proves the balance, then writes the redemption, exactly one negative ledger entry, the debited balance, the materialized cache and the audit event. Idempotent per (staff, key). Any failure rolls all of it back.';

-- Service role only. A browser role - including an authenticated customer - can
-- never call this, so no customer-direct redemption is reachable.
revoke all on function public.redeem_membership_points(uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.next_redemption_number() from public, anon, authenticated;

-- ===========================================================================
-- 6. RLS
-- ===========================================================================
-- Both tables are staff-only. The customer reaches their own redemption history
-- through their points ledger, which is already RLS-scoped to them, so there is
-- deliberately NO customer policy and NO customer grant on either table: an
-- unexposed surface should be unexposed, not exposed-and-filtered.

alter table public.redemption_items enable row level security;
alter table public.redemptions enable row level security;

create policy redemption_items_read on public.redemption_items
  for select to authenticated
  using (
    private.has_permission('operations.catalog')
    or private.has_permission('operations.redemption')
  );

create policy redemptions_read on public.redemptions
  for select to authenticated
  using (private.has_permission('operations.redemption'));

-- No INSERT/UPDATE/DELETE policy exists for either table. Writes go only
-- through public.redeem_membership_points with the service role, so the points
-- balance and the ledger can never be edited directly - by a customer or by
-- staff. The catalog is maintained by the service role from an authorized
-- handler, still never by a browser role.

-- Browser roles get NOTHING on these tables. Every read in the product goes
-- through the service-role API, so a direct PostgREST call has no privilege to
-- abuse in the first place.
revoke all on public.redemption_items from anon, authenticated;
revoke all on public.redemptions from anon, authenticated;

comment on table public.redemptions is
  'Points redemption transactions. Item name, code and price are snapshotted, so later catalog edits cannot alter history. Void columns are schema-only: no handler writes them because the void authorization and accounting rule is an unresolved business decision. No browser role holds any privilege on this table - staff read it through the API, and a customer reads their own history through their points ledger.';

-- ===========================================================================
-- 7. Grant consistency
-- ===========================================================================
-- The Phase 3 migration narrowed `points_ledger` to an explicit column list for
-- the browser roles. Redemption adds no ledger columns, so that grant is still
-- correct; this is asserted in the database suite rather than re-granted here.
