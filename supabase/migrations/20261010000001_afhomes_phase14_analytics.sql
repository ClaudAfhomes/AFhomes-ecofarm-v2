-- AF Homes Ecofarm v2 PHASE 14: immutable historical sale hierarchy snapshots.
-- Validation: pnpm test:db:local && supabase/security/rls_invariants.sql returns no rows.
-- Down: drop the snapshot trigger/functions/table. Existing commercial rows are untouched.

create table public.card_sale_hierarchy_snapshots (
  sale_id uuid not null references public.card_sales(id) on delete restrict,
  ancestor_staff_id uuid not null references public.staff_users(id) on delete restrict,
  ancestor_role text not null check (ancestor_role in (
    'vice_director', 'senior_sales_manager', 'sales_manager', 'ost'
  )),
  depth smallint not null check (depth between 0 and 3),
  captured_at timestamptz not null,
  primary key (sale_id, ancestor_staff_id),
  unique (sale_id, depth)
);

comment on table public.card_sale_hierarchy_snapshots is
  'Immutable complete seller ancestry captured when a sale is created. No legacy backfill: an absent complete snapshot is historically unattributed for team analytics.';

create index card_sale_hierarchy_snapshots_ancestor_idx
  on public.card_sale_hierarchy_snapshots (ancestor_staff_id, sale_id);

alter table public.card_sale_hierarchy_snapshots enable row level security;
revoke all on public.card_sale_hierarchy_snapshots from anon, authenticated;
grant select on public.card_sale_hierarchy_snapshots to service_role;

create or replace function private.capture_card_sale_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_current uuid := coalesce(new.seller_staff_id, new.seller_ost_id);
  v_role text;
  v_upline uuid;
  v_depth smallint := 0;
  v_expected_depth smallint;
begin
  if v_current is null then
    raise exception 'SALE_SELLER_REQUIRED' using errcode = '23514';
  end if;

  v_role := private.staff_role_slug(v_current);
  v_expected_depth := case v_role
    when 'vice_director' then 0
    when 'senior_sales_manager' then 1
    when 'sales_manager' then 2
    when 'ost' then 3
    else null
  end;
  if v_expected_depth is null then
    raise exception 'SALE_SELLER_HIERARCHY_ROLE_REQUIRED' using errcode = '23514';
  end if;

  loop
    insert into public.card_sale_hierarchy_snapshots
      (sale_id, ancestor_staff_id, ancestor_role, depth, captured_at)
    values (new.id, v_current, v_role, v_depth, new.created_at);

    exit when v_role = 'vice_director';
    select rr.upline_staff_id into v_upline
    from public.referral_relationships rr
    where rr.subject_staff_id = v_current
      and rr.is_authoritative
      and rr.is_active;
    if v_upline is null then
      raise exception 'SALE_COMPLETE_HIERARCHY_REQUIRED' using errcode = '23514';
    end if;
    v_current := v_upline;
    v_role := private.staff_role_slug(v_current);
    v_depth := v_depth + 1;
    if v_depth > 3 then
      raise exception 'SALE_HIERARCHY_TOO_DEEP' using errcode = '23514';
    end if;
  end loop;

  if v_depth <> v_expected_depth then
    raise exception 'SALE_COMPLETE_HIERARCHY_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.capture_card_sale_hierarchy() from public, anon, authenticated;

create or replace function private.prevent_card_sale_hierarchy_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Explicit database-owner maintenance (used by the disposable integration
  -- harness) may remove rows deliberately. Application roles have no grant and
  -- no code path sets this transaction-local flag.
  if current_setting('afhomes.allow_snapshot_maintenance', true) = 'on' then
    return old;
  end if;
  raise exception 'SALE_HIERARCHY_SNAPSHOT_IMMUTABLE' using errcode = '55000';
end;
$$;
revoke all on function private.prevent_card_sale_hierarchy_mutation() from public, anon, authenticated;

create trigger card_sales_capture_hierarchy
after insert on public.card_sales
for each row execute function private.capture_card_sale_hierarchy();

create trigger card_sale_hierarchy_snapshots_immutable
before update or delete on public.card_sale_hierarchy_snapshots
for each row execute function private.prevent_card_sale_hierarchy_mutation();
