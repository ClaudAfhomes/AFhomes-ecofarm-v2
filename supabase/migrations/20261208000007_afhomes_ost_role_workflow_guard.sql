-- AF Homes: generic staff/profile role edits must not bypass OST conversion.
-- The existing conversion ledger authorizes only its own in-transaction change.
-- Initial OST creation still inserts its assignment through the installer.
-- Validate: node packages/db-testing/scripts/test-ost-lifecycle.mjs (loopback only).
-- SELECT count(*) FROM pg_trigger WHERE tgname='ost_role_workflow_guard'; -- 1
-- Audit: supabase/security/rls_invariants.sql (zero findings).
-- Down: disable generic OST role changes at API level, then retire these guards
-- in a forward migration if an approved replacement exists. Preserve history.
begin;

create or replace function private.guard_ost_role_workflow() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_old text; v_new text;
begin
  select slug into v_old from public.roles where id=old.role_id;
  if tg_op='DELETE' then
    if v_old='ost' and exists(select 1 from public.ost_members where id=old.staff_id) then
      raise exception 'OST_ROLE_WORKFLOW_REQUIRED' using errcode='42501';
    end if;
    return old;
  end if;
  if new.role_id=old.role_id and new.staff_id=old.staff_id then return new; end if;
  select slug into v_new from public.roles where id=new.role_id;
  if v_old='ost' and new.staff_id=old.staff_id and v_new in ('vice_director','senior_sales_manager','sales_manager') and private.ost_kind_transfer_authorized(old.staff_id) then return new; end if;
  if v_old='ost' and exists(select 1 from public.ost_members where id=old.staff_id) then
    raise exception 'OST_ROLE_WORKFLOW_REQUIRED' using errcode='42501';
  end if;
  if v_new='ost' and not exists (
    select 1 from private.ost_ist_conversions c
    join private.sale_team_accreditations a on a.staff_id=c.staff_id
      and a.kind='OST' and a.aa_number=c.to_aa_number
    where c.staff_id=old.staff_id and new.staff_id=old.staff_id
      and c.from_role=v_old and c.created_at=now()
      and c.approved_by=new.assigned_by
      and private.staff_role_slug(c.approved_by) in ('admin','super_admin')
  ) then
    raise exception 'OST_ROLE_WORKFLOW_REQUIRED' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_role_workflow() from public,anon,authenticated,service_role;
drop trigger if exists ost_role_workflow_guard on public.staff_role_assignments;
create trigger ost_role_workflow_guard before update or delete on public.staff_role_assignments
for each row execute function private.guard_ost_role_workflow();

create or replace function private.guard_ost_edge_authority() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if old.hierarchy_role='ost' and new.is_authoritative is distinct from old.is_authoritative then
    raise exception 'OST_GENEALOGY_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_ost_edge_authority() from public,anon,authenticated,service_role;
drop trigger if exists ost_edge_authority_guard on public.referral_relationships;
create trigger ost_edge_authority_guard before update of is_authoritative on public.referral_relationships
for each row execute function private.guard_ost_edge_authority();

commit;
