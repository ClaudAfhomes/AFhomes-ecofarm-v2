-- AF Homes Customer Lookup module: a named permission for the GSD desk.
--
-- The Customer Lookup screen (`/admin/customer-lookup`) was authorized by the
-- `operations.redemption` module - a TILL permission for spending points -
-- because that is what the `employee` role already held. That reuse made the
-- permission list unable to show the screen: the Roles screen lists MODULES,
-- and "Customer Lookup" was not one, so whoever grants access could not see it.
--
-- This migration gives the capability its own module row, so the permission
-- now names what it protects:
-- - `employee` (the GSD desk) keeps the till key and GAINS view of the lookup
--   key, so the desk keeps working.
-- - `admin` gains view, for oversight of the same read-only screen.
-- - `super_admin` needs no row (granted every module by slug).
-- - No other role holds it: sellers, finance, HR and OST never saw the nav
--   entry before and still do not, and the server now refuses the endpoint for
--   them on this key alone.
--
-- Nothing here widens anything else: no existing grant is modified, and the
-- new row carries view only - the lookup has no mutating endpoint to
-- authorize, so create/update/delete stay false by construction.
--
-- forward-only, idempotent: upsert the module row and the two grants.
-- Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from public.modules
--    where key = 'operations.customer_lookup';                           -- 1
--   select r.slug, rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp
--     join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id
--    where m.key = 'operations.customer_lookup'
--    order by r.slug;            -- admin: t/f/f/f, employee: t/f/f/f
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): retire the callers first (navigation gate
-- and the memberships handler), then delete the two grants and the module row
-- in a later migration. Never delete the row while a caller still reads it.

-- ---------------------------------------------------------------------------
-- 1. The module row. Name and group mirror the module catalog in
--    packages/contracts so the console and the database agree.
-- ---------------------------------------------------------------------------
insert into public.modules (key, name, group_name, sort_order)
values ('operations.customer_lookup', 'Customer Lookup', 'Operations', 64)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      is_active = true;

-- ---------------------------------------------------------------------------
-- 2. The grants. View only; create/update/delete stay false.
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, false, false
from public.roles r
cross join public.modules m
where r.slug in ('employee', 'admin')
  and m.key = 'operations.customer_lookup'
on conflict (role_id, module_id) do update
  set can_view = true,
      can_create = false,
      can_update = false,
      can_delete = false;
