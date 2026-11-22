-- AF Homes: HR may VIEW roles (owner-approved 2026-11-22).
--
-- HR holds `organization.staff` (view/create/update) but not
-- `organization.roles`, and `GET /admin/afhomes/roles` is gated on
-- `organization.roles` view. So HR's Staff screen could not list the roles it
-- assigns: the New Staff role picker was empty and sales-hierarchy accounts
-- were not filtered out of HR's directory. The owner approved giving HR view
-- access to Roles.
--
-- Scope, deliberately narrow:
-- - `hr` gains VIEW on `organization.roles`. Nothing else.
-- - Create/update/delete on roles are NOT granted. If the row already exists
--   (an admin configured it through the dynamic Roles screen), only `can_view`
--   is ensured; any other flag an admin set is left exactly as it was.
-- - Assigning a role is still bounded server-side by `permissionsAreSubset()`
--   (a user cannot assign a permission they do not hold) - unchanged.
-- - Browser roles stay SELECT-only; no grant, policy or function changes.
-- - What view on this key READS (accepted with the owner's "HR may view
--   Roles"): API `GET /admin/afhomes/roles` and the role detail route, and the
--   Phase 1 RLS SELECT policies gated on it - `roles_read`, `modules_read`,
--   `role_permissions_read` and `staff_restrictions_read`. So HR can read the
--   full role/permission matrix and every staff member's deny-only
--   restrictions (no PII; the same data the roles API already returns). Every
--   write gated on this key requires create/update/delete, which HR lacks.
-- - `super_admin` needs no row (granted every module by slug).
--
-- forward-only, idempotent: one upsert. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp
--     join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id
--    where r.slug = 'hr' and m.key = 'organization.roles';    -- t/f/f/f (fresh)
-- Run supabase/security/rls_invariants.sql (zero AF Homes rows required).
--
-- Down (documentation, not a script): in a later migration, set can_view =
-- false for (hr, organization.roles), or delete the row if no other flag is
-- set. The Staff page tolerates the missing grant (it skips the roles read).

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, false, false
from public.roles r
cross join public.modules m
where r.slug = 'hr'
  and m.key = 'organization.roles'
on conflict (role_id, module_id) do update
  set can_view = true;
