-- Read-only caller-bound authentication recovery, independent of the pending points chain.
-- Dependencies: already-applied foundation, Phase 3 column grants, staff password lifecycle,
-- customer-code upgrade and operational-access permission functions (through 20261029000001).
-- Validate: anonymous execution denied; self-only staff/customer reads; deny-only restrictions;
-- no DML or points/schema changes. Rehearse on disposable PostgreSQL before owner-approved apply.
-- Down note: forward-only; revoke these three RPC grants to retire. Never remove business history.
create or replace function public.afhomes_self_portals()
returns jsonb language sql stable security definer
set search_path=pg_catalog,private,public,pg_temp as $$
 select jsonb_build_object(
  'staff',(select jsonb_build_object('roleSlug',r.slug,'roleName',r.name,'status',s.status,'mustChangePassword',s.must_change_password)
    from public.staff_users s left join public.staff_role_assignments a on a.staff_id=s.id left join public.roles r on r.id=a.role_id where s.id=auth.uid()),
  'customer',(select jsonb_build_object('status',c.status) from public.customers c where c.auth_user_id=auth.uid()),
  'ost',(select jsonb_build_object('status',o.status,'ostNumber',o.ost_number) from public.ost_members o where o.id=auth.uid()))
 where auth.uid() is not null;
$$;
create or replace function public.afhomes_self_session()
returns jsonb language sql stable security definer
set search_path=pg_catalog,private,public,pg_temp as $$
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
set search_path=pg_catalog,private,public,pg_temp as $$
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
