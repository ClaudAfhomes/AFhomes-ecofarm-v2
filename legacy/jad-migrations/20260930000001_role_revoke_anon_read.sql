-- Phase 6 - Revoke direct Role reads for anon/authenticated.
--
-- No application code reads Role tables with the anon key anymore:
-- verifyStaff resolves via service_role, the admin shell uses
-- GET /admin/session, and member clients resolve admin-ness from their own
-- StaffUser row. REVOKE ALL (not just SELECT): table-level revoke leaves
-- explicit column grants behind, which would keep slug/name readable. The
-- RLS policy role_read_authenticated stays (harmless without grants,
-- belt-and-braces if grants ever return).
-- Idempotent (REVOKE re-runs are safe).
-- Down (rollback only): grant select (slug, name) on "Role" to authenticated.

revoke all on "Role" from anon, authenticated;
