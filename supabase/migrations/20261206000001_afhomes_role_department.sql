-- AF Homes role-department link.
--
-- A role belongs to exactly one department (many roles, one department).
-- `public.roles.department_id` is nullable so pre-existing and system rows
-- stay valid; they read as "Unassigned" until an edit assigns them. New
-- custom roles must pick a department (enforced in the API + role form),
-- and the roles list can be filtered by department. The departments page
-- deliberately shows no roles column.
--
-- `update_operational_role` is extended in place: when `p_input` carries
-- `departmentId` it is validated (must be an active department) and applied
-- in the same transaction as the name/permission rewrite. Callers that omit
-- the key keep the current value, so older payloads keep working.
--
-- forward-only, idempotent: add column if not exists, create index if not
-- exists, create or replace the function. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select data_type from information_schema.columns
--    where table_schema='public' and table_name='roles'
--      and column_name='department_id';  -- 1 row, uuid
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='roles'
--      and indexname='roles_department_id_idx';  -- 1 row
--   select department_id from public.roles limit 1;  -- null until assigned
--
-- Down: drop index roles_department_id_idx, drop the foreign key, drop the
-- column (destroys the assignment data), and restore the previous
-- `update_operational_role` body from
-- 20261029000001_afhomes_operational_access_functions.sql.

alter table public.roles
  add column if not exists department_id uuid references public.departments(id) on delete set null;

create index if not exists roles_department_id_idx on public.roles(department_id);

-- Same body as 20261029000001 plus the departmentId branch: validated only
-- when the key is present, applied atomically with the rest of the update.
create or replace function public.update_operational_role(p_actor uuid,p_role uuid,p_input jsonb)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_actor_role text; v_role public.roles%rowtype; v_permission jsonb; v_module_id uuid; v_department_id uuid;
begin
 v_actor_role:=private.mutation_actor_role(p_actor,'organization.roles','update');
 select * into v_role from public.roles where id=p_role for update;
 if not found then raise exception 'NOT_FOUND: Role not found'; end if;
 if v_role.slug in ('admin','super_admin','customer') or exists(select 1 from public.staff_role_assignments where staff_id=p_actor and role_id=p_role)
 or (v_role.is_system and v_actor_role<>'super_admin') then raise exception 'FORBIDDEN: Protected role'; end if;
 if p_input ? 'departmentId' and p_input->>'departmentId' is not null then
  select id into v_department_id from public.departments where id=(p_input->>'departmentId')::uuid and is_active;
  if v_department_id is null then raise exception 'VALIDATION_ERROR: Unknown department'; end if;
 end if;
 if p_input ? 'permissions' then
  for v_permission in select value from jsonb_array_elements(p_input->'permissions') loop
   select id into v_module_id from public.modules where key=v_permission->>'moduleKey' and is_active;
   if v_module_id is null then raise exception 'VALIDATION_ERROR: Unknown module'; end if;
   if v_actor_role<>'super_admin' and (
    (coalesce((v_permission->>'canView')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','view')) or
    (coalesce((v_permission->>'canCreate')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','create')) or
    (coalesce((v_permission->>'canUpdate')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','update')) or
    (coalesce((v_permission->>'canDelete')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','delete')))
    then raise exception 'FORBIDDEN: Cannot grant permissions you do not possess'; end if;
  end loop;
  delete from public.role_permissions where role_id=p_role;
  insert into public.role_permissions(role_id,module_id,can_view,can_create,can_update,can_delete)
  select p_role,m.id,(p->>'canView')::boolean,(p->>'canCreate')::boolean,(p->>'canUpdate')::boolean,(p->>'canDelete')::boolean
  from jsonb_array_elements(p_input->'permissions') p join public.modules m on m.key=p->>'moduleKey';
 end if;
 update public.roles set name=coalesce(p_input->>'name',name),description=case when p_input ? 'description' then p_input->>'description' else description end,
  department_id=case when p_input ? 'departmentId' and p_input->>'departmentId' is not null then v_department_id
   when p_input ? 'departmentId' then null else department_id end,
  is_active=coalesce((p_input->>'isActive')::boolean,is_active),updated_at=now() where id=p_role;
 insert into public.audit_events(actor_id,action,entity_type,entity_id) values(p_actor,'ROLE_PERMISSIONS_UPDATED','role',p_role::text);
end $$;
revoke all on function public.update_operational_role(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_operational_role(uuid,uuid,jsonb) to service_role;
