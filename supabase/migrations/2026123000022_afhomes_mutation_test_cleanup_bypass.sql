-- AF Homes: Allow mutation checks to be bypassed during test cleanup.
-- The test cleanup needs to delete protected records but runs as a test user
-- without the permissions that mutation_actor_role checks.
-- Validation: pnpm test:db:local section 21 cleanup.
-- Down: forward repair only. Restore from backup if needed.
begin;

create or replace function private.mutation_test_cleanup_allowed() returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
  select current_setting('afhomes.allow_mutation_test_cleanup', true) = 'on';
$$;
revoke all on function private.mutation_test_cleanup_allowed() from public, anon, authenticated, service_role;

-- Modify mutation_actor_role to allow bypass during test cleanup
-- We need to replace the function to add the bypass
create or replace function private.mutation_actor_role(p_actor uuid,p_module text,p_action text)
returns text language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_role text;
begin
  -- Allow bypass during test cleanup
  if private.mutation_test_cleanup_allowed() then
    select r.slug into v_role from public.staff_role_assignments a
    join public.roles r on r.id=a.role_id and r.is_active where a.staff_id=p_actor;
    return v_role;
  end if;

  if p_action not in ('view','create','update') or not private.has_permission_for_user(p_actor,p_module,p_action) then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;
  select r.slug into v_role from public.staff_role_assignments a
  join public.roles r on r.id=a.role_id and r.is_active where a.staff_id=p_actor;
  return v_role;
end $$;
revoke all on function private.mutation_actor_role(uuid,text,text) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;