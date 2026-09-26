-- Phase 1 - Staff domain foundation (Member/Staff separation).
--
-- Staff (admin, super_admin, finance, merchant, …) are currently Member rows
-- distinguished only by MemberRole links, so staff UX inherits member-table
-- fragility (role resolution, grants, RLS) and staff operations touch the
-- financial identity graph. This migration adds a separate StaffUser profile
-- domain alongside Member. Strictly ADDITIVE: no existing table, column,
-- policy, or grant is altered; no application behavior changes.
--
--   StaffUser       id uuid PK → auth.users(id), email UNIQUE, name,
--                   status ACTIVE/DISABLED. Owns NO financial/genealogy data
--                   by construction (no FK points from money tables here).
--   StaffAssignment (staffUserId, roleId) PK → StaffUser + Role. Replaces
--                   MemberRole for staff; MemberRole stays member-side.
--   Role.domain     'member' | 'staff' discriminator (backfilled by slug);
--                   the permission catalog itself (slugs, permissions jsonb)
--                   is unchanged.
--
-- Validation (must hold after apply):
--   select count(*) from "StaffUser";            -- 0 rows (Phase 2 backfills)
--   select count(*) from "StaffAssignment";      -- 0 rows (Phase 2 backfills)
--   select slug, domain from "Role" order by slug;
--     -- super_admin/admin/finance/merchant → 'staff', all others → 'member'
-- Idempotent (if not exists / on conflict / pg_policies guards).
-- Down (rollback only): drop table "StaffAssignment"; drop table "StaffUser";
--   alter table "Role" drop column if exists domain;

create table if not exists "StaffUser" (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  "createdAt" timestamp with time zone not null default now()
);

create table if not exists "StaffAssignment" (
  "staffUserId" uuid not null references "StaffUser"(id) on delete cascade,
  "roleId" uuid not null references "Role"(id) on delete cascade,
  "assignedAt" timestamp with time zone not null default now(),
  primary key ("staffUserId", "roleId")
);
create index if not exists "StaffAssignment_roleId_idx" on "StaffAssignment"("roleId");

alter table "Role" add column if not exists domain text not null default 'member'
  check (domain in ('member', 'staff'));
update "Role" set domain = 'staff'
  where slug in ('super_admin', 'admin', 'finance', 'merchant') and domain <> 'staff';

alter table "StaffUser" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'StaffUser' and policyname = 'staffuser_select_own') then
    create policy staffuser_select_own on "StaffUser" for select to authenticated
      using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'StaffUser' and policyname = 'staffuser_service_role_all') then
    create policy staffuser_service_role_all on "StaffUser" for all to service_role
      using (true) with check (true);
  end if;
end $$;

alter table "StaffAssignment" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'StaffAssignment' and policyname = 'staffassignment_select_own') then
    create policy staffassignment_select_own on "StaffAssignment" for select to authenticated
      using (auth.uid() = "staffUserId");
  end if;
  if not exists (select 1 from pg_policies where tablename = 'StaffAssignment' and policyname = 'staffassignment_service_role_all') then
    create policy staffassignment_service_role_all on "StaffAssignment" for all to service_role
      using (true) with check (true);
  end if;
end $$;
