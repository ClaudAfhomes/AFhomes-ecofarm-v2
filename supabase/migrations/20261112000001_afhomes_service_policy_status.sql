-- Future catalog policy availability; preserves sale snapshots and points history.
-- Validate: SELECT has_function_privilege('authenticated',
--   'public.set_service_policy_active(text,uuid,boolean,uuid)', 'EXECUTE'); -- false
-- Down: revoke service-role execution; do not remove policy or audit history.
begin;
alter table public.point_earning_rules add column if not exists updated_at timestamptz not null default now();
create or replace function public.set_service_policy_active(
  p_kind text, p_id uuid, p_active boolean, p_actor_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_before jsonb; v_after jsonb;
begin
  perform private.mutation_actor_role(p_actor_id, 'operations.catalog', 'update');
  if p_active is null then raise exception 'POLICY_STATUS_REQUIRED' using errcode='22023'; end if;
  if p_kind = 'earning_rule' then
    select to_jsonb(r) into v_before from public.point_earning_rules r where r.id=p_id for update;
    if not found then raise exception 'POLICY_NOT_FOUND' using errcode='P0002'; end if;
    update public.point_earning_rules r set is_active=p_active, updated_at=now() where r.id=p_id returning to_jsonb(r) into v_after;
  elsif p_kind = 'tier_discount' then
    select to_jsonb(r) into v_before from public.service_tier_discounts r where r.id=p_id for update;
    if not found then raise exception 'POLICY_NOT_FOUND' using errcode='P0002'; end if;
    update public.service_tier_discounts r set is_active=p_active where r.id=p_id returning to_jsonb(r) into v_after;
  else
    raise exception 'POLICY_KIND_INVALID' using errcode='22023';
  end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_id,'SERVICE_POLICY_STATUS_CHANGED',p_kind,p_id,v_before,v_after);
  return p_active;
end $$;
revoke all on function public.set_service_policy_active(text,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_service_policy_active(text,uuid,boolean,uuid) to service_role;
commit;
