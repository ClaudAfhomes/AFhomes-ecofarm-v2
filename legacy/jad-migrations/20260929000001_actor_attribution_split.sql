-- Phase 5 - Actor attribution split (Member/Staff separation).
--
-- Actor columns (who did it) span two domains, but a single FK can only
-- reference one table - and any FK on an audit trail blocks deletes in the
-- referenced domain. Live audit (Phase 5): AuditLog.actor_id has 37 staffer
-- actors AND 1 member actor, so it cannot point at either domain table.
-- The other four actor columns are staffer-only (verified 0 non-staff).
--
--   AuditLog.actor_id        DROP the FK (uuid + actor_role/actor text carry
--                          the meaning; audit rows must survive member archive
--                          AND staff deletion in both directions).
--   Registration.reviewedBy  → StaffUser ON DELETE SET NULL.
--   Member.archivedBy        → StaffUser ON DELETE SET NULL.
--   SystemConfig.updated_by  → StaffUser ON DELETE SET NULL.
--   cms_contents.updated_by  → StaffUser ON DELETE SET NULL.
-- Repointed values stay valid: staffer uuids exist in StaffUser (Phase 2).
-- MemberRole.assignedBy stays → Member (member-side assigner edge case).
-- Financial/graph FKs (Wallet, LedgerEntry, Commission, Sale, Customer,
-- Voucher, Withdrawal, PayoutAccount) stay → Member with zero staffer-owned
-- rows (Phase 3 Outcome A).
--
-- Validation (run before/after apply):
--   AuditLog non-staffer actors may exist (allowed - no FK after this file).
--   Zero rows may reference a NON-EXISTENT StaffUser in the four repointed
--   columns (all values must already be staffer uuids with StaffUser rows).
-- Idempotent per constraint (dropped then re-added with an explicit name).
-- Down: re-add each FK referencing "Member"(id) with its original action
--   (AuditLog NO ACTION; the other four SET NULL - see 20260916000001 and
--   20260918000001 for the original shapes).

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'AuditLog_actor_id_fkey') then
    alter table "AuditLog" drop constraint "AuditLog_actor_id_fkey";
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'registration_reviewed_by_fkey') then
    alter table "Registration" drop constraint "registration_reviewed_by_fkey";
  end if;
  alter table "Registration" add constraint "registration_reviewed_by_fkey"
    foreign key ("reviewedBy") references "StaffUser"(id) on delete set null;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'Member_archivedBy_fkey') then
    alter table "Member" drop constraint "Member_archivedBy_fkey";
  end if;
  alter table "Member" add constraint "Member_archivedBy_fkey"
    foreign key ("archivedBy") references "StaffUser"(id) on delete set null;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'SystemConfig_updated_by_fkey') then
    alter table "SystemConfig" drop constraint "SystemConfig_updated_by_fkey";
  end if;
  alter table "SystemConfig" add constraint "SystemConfig_updated_by_fkey"
    foreign key ("updated_by") references "StaffUser"(id) on delete set null;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'cms_contents_updated_by_fkey') then
    alter table "cms_contents" drop constraint "cms_contents_updated_by_fkey";
  end if;
  alter table "cms_contents" add constraint "cms_contents_updated_by_fkey"
    foreign key ("updated_by") references "StaffUser"(id) on delete set null;
end $$;
