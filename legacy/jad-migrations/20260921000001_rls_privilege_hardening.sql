-- Phase 3B - privilege-level hardening (belt-and-braces beyond RLS).
--
-- Policies already forbid authenticated writes on Member/MemberRole; these
-- revokes remove the underlying table privileges too, so even a future policy
-- mistake cannot grant write access (RLS only filters rows for roles that
-- hold the privilege). service_role keeps full access.
-- Idempotent. Down (rollback only - not recommended): grant insert, update,
-- delete on the affected tables to authenticated.

revoke insert, update, delete, truncate on "Member" from authenticated, anon;
revoke insert, update, delete, truncate on "MemberRole" from authenticated, anon;
revoke insert, update, delete, truncate on "Role" from authenticated, anon;

-- Member/MemberRole select stays available (own-row label reads); Role read is
-- already column-restricted from Phase 1A.
