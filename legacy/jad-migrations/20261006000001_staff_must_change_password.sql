-- Staff temporary-password flag (forced first-login password change).
-- Adds StaffUser.mustChangePassword: set true by POST /admin/staff when the
-- super admin assigns a temporary password; cleared by POST
-- /admin/session/password after the holder changes it. GET /admin/session
-- surfaces it; verifyStaff rejects admin calls while set (the session and
-- password-change paths use verifyUser and stay reachable).
-- Idempotent. RLS unchanged.
--
-- Validation (run before/after applying):
--   select column_name, data_type, column_default from information_schema.columns
--    where table_schema='public' and table_name='StaffUser' and column_name='mustChangePassword';
-- Down: alter table "StaffUser" drop column if exists "mustChangePassword";
--   (only after confirming no staff row has mustChangePassword = true).

alter table "StaffUser" add column if not exists "mustChangePassword" boolean not null default false;
