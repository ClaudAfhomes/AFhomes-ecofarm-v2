-- F-02: one account gate for caller RPCs, RLS and trusted-actor business guards.
-- Validation: node packages/db-testing/scripts/test-security-remediation.mjs --full
-- select public.afhomes_admin_mfa_required(); -- reviewed deployment policy
-- select * from private.staff_security_policy; -- singleton, no browser access
-- Down: forward-only. Do not remove gates or rewrite staff/business history.
-- Deployment prerequisite: reconcile this server-owned MFA policy with the
-- existing AFHOMES_REQUIRE_ADMIN_MFA flag BEFORE deployment/apply approval.

create table if not exists private.staff_security_policy (
 singleton boolean primary key default true check (singleton),
 admin_mfa_required boolean not null
);
alter table private.staff_security_policy enable row level security;
revoke all on private.staff_security_policy from public,anon,authenticated,service_role;
-- Existing local policy is disabled. ON CONFLICT preserves an operator's choice.
insert into private.staff_security_policy(singleton,admin_mfa_required)
values(true,false) on conflict(singleton) do nothing;

create or replace function public.afhomes_admin_mfa_required()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select coalesce((select p.admin_mfa_required from private.staff_security_policy p where p.singleton),true);
$$;
revoke all on function public.afhomes_admin_mfa_required() from public,anon,authenticated,service_role;
grant execute on function public.afhomes_admin_mfa_required() to authenticated,service_role;

create or replace function private.staff_business_access(p_actor uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select exists(select 1 from public.staff_users s
 join public.staff_role_assignments a on a.staff_id=s.id
 join public.roles r on r.id=a.role_id and r.is_active
 where s.id=p_actor and s.status='active' and not s.must_change_password
 -- Trusted service RPCs retain their server-derived actor; caller wrappers bind auth.uid().
 and (auth.role() is distinct from 'authenticated' or (auth.uid()=p_actor and (
   r.slug not in ('admin','super_admin') or not public.afhomes_admin_mfa_required()
   or auth.jwt()->>'aal'='aal2'))));
$$;
revoke all on function private.staff_business_access(uuid) from public,anon,authenticated,service_role;

create or replace function private.has_permission_for_user(p_staff_id uuid,p_key text,p_action text default 'view')
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select private.staff_business_access(p_staff_id) and exists(select 1 from public.staff_users su
 join public.staff_role_assignments a on a.staff_id=su.id
 join public.roles r on r.id=a.role_id and r.is_active
 join public.modules m on m.key=p_key and m.is_active
 left join public.role_permissions rp on rp.role_id=r.id and rp.module_id=m.id
 left join public.staff_permission_restrictions spr on spr.staff_id=su.id and spr.module_id=m.id
 where su.id=p_staff_id and su.status='active' and not coalesce(spr.deny_view,false)
 and case p_action
 when 'view' then r.slug='super_admin' or coalesce(rp.can_view,false)
 when 'create' then (r.slug='super_admin' or coalesce(rp.can_create,false)) and not coalesce(spr.deny_create,false)
 when 'update' then (r.slug='super_admin' or coalesce(rp.can_update,false)) and not coalesce(spr.deny_update,false)
 when 'delete' then (r.slug='super_admin' or coalesce(rp.can_delete,false)) and not coalesce(spr.deny_delete,false)
 else false end);
$$;
revoke all on function private.has_permission_for_user(uuid,text,text) from public,anon,authenticated,service_role;

create or replace function private.has_permission(permission_key text,action_name text default 'view')
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select private.has_permission_for_user(auth.uid(),permission_key,action_name);
$$;
revoke all on function private.has_permission(text,text) from public,anon,authenticated,service_role;
grant execute on function private.has_permission(text,text) to authenticated;

create or replace function private.mutation_actor_role(p_actor uuid,p_module text,p_action text)
returns text language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_role text;
begin
 if p_action not in ('view','create','update') or not private.has_permission_for_user(p_actor,p_module,p_action) then
   raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
 end if;
 select r.slug into v_role from public.staff_role_assignments a
 join public.roles r on r.id=a.role_id and r.is_active where a.staff_id=p_actor;
 return v_role;
end $$;
revoke all on function private.mutation_actor_role(uuid,text,text) from public,anon,authenticated,service_role;
-- Self-session/portal/recovery functions are deliberately left callable: they
-- must identify the required next step without granting business operations.
