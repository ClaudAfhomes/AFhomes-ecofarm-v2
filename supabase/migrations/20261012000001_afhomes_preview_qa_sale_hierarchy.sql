-- AF Homes preview QA: preserve legal Admin/Super Admin card sales after Phase 14.
-- Validation: pnpm test:db:local; Admin/Super Admin sales create no genealogy
-- snapshot, while VD/SSM/SM/OST sales still require and freeze a complete chain.
-- Down: restore the Phase 14 function body (which rejects non-genealogy sellers).

create or replace function private.capture_card_sale_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
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

  -- Admin and Super Admin have always been legal sellers, but they are not
  -- genealogy roles and therefore have no hierarchy to snapshot. Never invent
  -- an upline for them; their sales remain globally and seller-attributed.
  if v_role in ('admin', 'super_admin') then
    return new;
  end if;

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
