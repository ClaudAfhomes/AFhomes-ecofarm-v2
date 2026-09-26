-- Role permission backfill for canonical staff roles (RBAC role-select fix).
-- Seed/provision scripts upsert Role rows with only {slug,name,description,domain},
-- leaving `permissions` at its '[]' default; GET /admin/roles then filters those
-- rows out (roleRecordSchema requires >=1 permission), emptying every admin role
-- select - notably the Create Staff dialog, which reports 'Select a valid role.'
-- even though a role appears chosen.
-- This converges the four canonical staff roles to the STAFF_PERMISSIONS matrix
-- seed (single source: packages/contracts/src/schemas/staff-role.ts, incl. the
-- `policies` module) and marks them is_system, but ONLY where the stored value
-- is missing or an empty array - custom rows, member rows, and any
-- intentionally-set permissions are untouched. Idempotent. RLS unchanged.
--
-- Validation (run before applying):
--   select slug, permissions, is_system from "Role"
--    where slug in ('super_admin','admin','finance','merchant') order by slug;
-- Down: no-op (permissions are additive business data; restoring [] would re-hide the roles).

update "Role" set
  permissions = '["dashboard","registrations","members","sales","payouts","withdrawals","vouchers","properties","marketing_tools","policies","config","programs","audit","staff","cms"]',
  is_system = true
where slug = 'super_admin'
  and (permissions is null or jsonb_typeof(permissions) <> 'array' or jsonb_array_length(permissions) = 0);

update "Role" set
  permissions = '["dashboard","registrations","members","sales","payouts","withdrawals","vouchers","properties","marketing_tools","policies","cms"]',
  is_system = true
where slug = 'admin'
  and (permissions is null or jsonb_typeof(permissions) <> 'array' or jsonb_array_length(permissions) = 0);

update "Role" set
  permissions = '["dashboard","sales","payouts","withdrawals"]',
  is_system = true
where slug = 'finance'
  and (permissions is null or jsonb_typeof(permissions) <> 'array' or jsonb_array_length(permissions) = 0);

update "Role" set
  permissions = '["vouchers"]',
  is_system = true
where slug = 'merchant'
  and (permissions is null or jsonb_typeof(permissions) <> 'array' or jsonb_array_length(permissions) = 0);
