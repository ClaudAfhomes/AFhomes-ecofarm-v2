-- Messaging module backfill for canonical staff roles (ADR-013, FEAT-072).
-- The `messages` module joins the STAFF_PERMISSIONS matrix for super_admin
-- and admin (single source: packages/contracts/src/schemas/staff-role.ts).
-- Existing deployments already hold non-empty stored `permissions` arrays, so
-- the empty-only backfill pattern (20261005000001) would never converge them:
-- append the module where it is missing instead. Custom rows, member rows,
-- and finance/merchant rows are untouched.
--
-- Validation (run before applying):
--   select slug, permissions, is_system from "Role"
--    where slug in ('super_admin','admin') order by slug;
--     -- after: both arrays contain "messages"; nothing else changed
-- Down: no-op (permissions are additive business data; removing the module
--   would strand the nav/API guards).

update "Role" set
  permissions = permissions || '"messages"'
where slug = 'super_admin'
  and jsonb_typeof(permissions) = 'array'
  and not (permissions @> '"messages"');

update "Role" set
  permissions = permissions || '"messages"'
where slug = 'admin'
  and jsonb_typeof(permissions) = 'array'
  and not (permissions @> '"messages"');
