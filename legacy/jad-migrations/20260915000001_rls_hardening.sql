-- Phase 1A - RLS hardening (Database review F-01 / F-02).
--
-- An authenticated member could previously UPDATE their own Member row
-- (status, isQualified, accountStatus) and INSERT/DELETE their own MemberRole
-- links against any readable Role - privilege escalation that bypasses every
-- application role gate. Role.permissions and management fields were also
-- readable by any signed-in user.
--
-- New model:
--   Member     authenticated SELECT own row only (no writes - all writes via
--              service-role API / SECURITY DEFINER functions)
--   MemberRole authenticated SELECT own links only (labels for the member
--              portal; no link mutations)
--   Role       authenticated may read slug + name only (management columns
--              revoked)
-- service_role retains full access on all three (its own policies unchanged).
-- Idempotent. Down: restore the original policy shapes (see note).

-- 1) Member: drop the write-capable policy, add a SELECT-only policy.
do $$ begin
  drop policy if exists member_own_row on "Member";
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Member' and policyname='member_select_own') then
    create policy member_select_own on "Member" for select to authenticated
      using (auth.uid() = id);
  end if;
end $$;

-- 2) MemberRole: drop the write-capable policy, add a SELECT-only policy.
do $$ begin
  drop policy if exists memberrole_own_row on "MemberRole";
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='MemberRole' and policyname='memberrole_select_own') then
    create policy memberrole_select_own on "MemberRole" for select to authenticated
      using (auth.uid() = "memberId");
  end if;
end $$;

-- 3) Role: keep the broad SELECT for labels but revoke the sensitive columns.
revoke select (permissions, key, is_system, description, "createdAt", id) on "Role" from authenticated;

-- Note (rollback / down): to restore the original permissive shape, drop the
-- policies above and recreate:
--   create policy member_own_row on "Member" for all to authenticated
--     using (auth.uid() = id) with check (auth.uid() = id);
--   create policy memberrole_own_row on "MemberRole" for all to authenticated
--     using (auth.uid() = "memberId") with check (auth.uid() = "memberId");
--   grant select (permissions, key, is_system, description, "createdAt", id)
--     on "Role" to authenticated;
-- Never ship the restore outside an approved rollback window.
