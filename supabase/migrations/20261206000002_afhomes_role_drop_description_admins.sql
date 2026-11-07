-- AF Homes roles: drop description, default Admins department.
--
-- Role descriptions are removed everywhere: the column goes away, so no UI,
-- contract, or API may read or write it. A role is identified by name plus
-- its department and page access.
--
-- The `admin` and `super_admin` system roles default to the `Admins`
-- department (created here when missing). Only rows still unassigned are
-- moved, so a deliberate reassignment is never clobbered.
--
-- forward-only, idempotent: department insert is conflict-safe, the role
-- update touches only null links, the column drop is guarded, and the
-- function is created or replaced. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='roles'
--      and column_name='description';  -- 0
--   select code, name from public.departments where code='ADMINS';  -- 1 row
--   select slug, department_id from public.roles
--    where slug in ('admin','super_admin');  -- both non-null
--
-- Down: re-add the description column (values lost), and restore the
-- description branch of `update_operational_role` from
-- 20261206000001_afhomes_role_department.sql.

insert into public.departments(code, name) values('ADMINS', 'Admins')
on conflict do nothing;

update public.roles set department_id = (
  select id from public.departments
  where code = 'ADMINS'
  order by created_at limit 1
)
where slug in ('admin', 'super_admin') and department_id is null;

-- Same body as 20261206000001 minus the description branch: the column no
-- longer exists, so any reference to it would fail at runtime.
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
 update public.roles set name=coalesce(p_input->>'name',name),
  department_id=case when p_input ? 'departmentId' and p_input->>'departmentId' is not null then v_department_id
   when p_input ? 'departmentId' then null else department_id end,
  is_active=coalesce((p_input->>'isActive')::boolean,is_active),updated_at=now() where id=p_role;
 insert into public.audit_events(actor_id,action,entity_type,entity_id) values(p_actor,'ROLE_PERMISSIONS_UPDATED','role',p_role::text);
end $$;
revoke all on function public.update_operational_role(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_operational_role(uuid,uuid,jsonb) to service_role;

do $$
begin
 if exists (select 1 from information_schema.columns
  where table_schema='public' and table_name='roles' and column_name='description') then
  alter table public.roles drop column description;
 end if;
end $$;
