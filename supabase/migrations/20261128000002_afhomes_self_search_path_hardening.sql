-- AF Homes: pin the self-service RPCs to the hardened search_path order.
--
-- `afhomes_self_portals`, `afhomes_self_session` and `afhomes_self_customer_profile`
-- (20261122) pin `pg_catalog,private,public,pg_temp`, which section 15 of the
-- database suite does not allowlist: `private` before `public` lets an object in
-- `private` shadow one in `public` for any unqualified name the body resolves.
-- The bodies below are byte-identical to 20261122 except the path order, which
-- becomes the codebase-standard `pg_catalog,public,private,pg_temp`.
--
-- Behavior is preserved: every table reference in these bodies is
-- schema-qualified (`public.*`, `private.*`), builtins resolve from
-- `pg_catalog` in either order, and `auth.uid()` resolves through the same
-- platform mechanism it uses today (proven by calling
-- `public.afhomes_self_session()` against the live database: it resolves and
-- returns null for a key-based caller instead of raising).
--
-- Forward-only. Does not touch 20261122 or any other applied migration: three
-- `create or replace` statements plus the idempotent revoke/grant pair.
--
-- Validation before apply (live, read-only):
--   select proname, array_to_string(proconfig, ',') from pg_proc
--    where proname in ('afhomes_self_portals','afhomes_self_session','afhomes_self_customer_profile');
--   -- each shows search_path=pg_catalog,private,public,pg_temp.
-- Validation after apply:
--   select proname, array_to_string(proconfig, ',') from pg_proc
--    where proname in ('afhomes_self_portals','afhomes_self_session','afhomes_self_customer_profile');
--   -- each shows search_path=pg_catalog,public,private,pg_temp; then run
--   -- pnpm test:db:local (section 15 pins every SECURITY DEFINER function).
--
-- Down note (forward-only, no down migration): path order is a hardening
-- property, not data. Reverting would re-trip section 15 with no benefit.
create or replace function public.afhomes_self_portals()
returns jsonb language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select jsonb_build_object(
  'staff',(select jsonb_build_object('roleSlug',r.slug,'roleName',r.name,'status',s.status,'mustChangePassword',s.must_change_password)
    from public.staff_users s left join public.staff_role_assignments a on a.staff_id=s.id left join public.roles r on r.id=a.role_id where s.id=auth.uid()),
  'customer',(select jsonb_build_object('status',c.status) from public.customers c where c.auth_user_id=auth.uid()),
  'ost',(select jsonb_build_object('status',o.status,'ostNumber',o.ost_number) from public.ost_members o where o.id=auth.uid()))
 where auth.uid() is not null;
$$;
create or replace function public.afhomes_self_session()
returns jsonb language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select jsonb_build_object('id',s.id,'email',s.email,'fullName',s.full_name,'status',s.status,
  'roleId',r.id,'roleSlug',r.slug,'roleName',r.name,'mustChangePassword',s.must_change_password,'testPurgeEnabled',false,
  'permissions',coalesce((select jsonb_agg(jsonb_build_object('moduleKey',m.key,
   'canView',private.has_permission_for_user(s.id,m.key,'view'),
   'canCreate',private.has_permission_for_user(s.id,m.key,'create'),
   'canUpdate',private.has_permission_for_user(s.id,m.key,'update'),
   'canDelete',private.has_permission_for_user(s.id,m.key,'delete')) order by m.sort_order,m.key)
   from public.modules m where m.is_active),'[]'::jsonb))
 from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id join public.roles r on r.id=a.role_id
 where s.id=auth.uid() and s.status='active' and r.is_active;
$$;
create or replace function public.afhomes_self_customer_profile()
returns jsonb language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
 select jsonb_build_object('id',c.id,'customerNumber',c.customer_number,'customerCode',c.customer_code,
  'firstName',c.first_name,'middleName',c.middle_name,'lastName',c.last_name,'suffix',c.suffix,
  'fullName',concat_ws(' ',c.first_name,c.middle_name,c.last_name,c.suffix),'email',c.email,'phone',c.phone,
  'dateOfBirth',c.birth_date,'addressLine1',c.address->>'line1','addressLine2',c.address->>'line2',
  'city',c.address->>'city','province',c.address->>'province','countryCode',coalesce(c.address->>'countryCode',c.address->>'country_code'),
  'status',c.status,'activatedAt',c.updated_at,'updatedAt',c.updated_at)
 from public.customers c where c.auth_user_id=auth.uid();
$$;
revoke all on function public.afhomes_self_portals(),public.afhomes_self_session(),public.afhomes_self_customer_profile() from public,anon,authenticated,service_role;
grant execute on function public.afhomes_self_portals(),public.afhomes_self_session(),public.afhomes_self_customer_profile() to authenticated;
