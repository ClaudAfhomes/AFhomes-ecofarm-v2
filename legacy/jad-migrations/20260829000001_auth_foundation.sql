-- Supabase Auth foundation - Phase 1 fresh start
-- Supabase Postgres 15+ - no Prisma. Roles: admin / user via Member + Role + MemberRole
-- Q3: Do NOT drop existing CRM tables (Customer, Sale, Property, Commission, Wallet, LedgerEntry,
--     PayoutAccount, Withdrawal, Voucher, ContentItem, Policy, Notification, PublicContent,
--     IdempotencyKey) - leave untouched until CRM database phase.
-- This migration is idempotent and creates ONLY auth tables if missing.

-- 0) Extensions
create extension if not exists "pgcrypto";

-- 1) Core auth tables (minimal for Phase 1)
-- Member: id = auth.users.id (uuid) for RLS auth.uid() = id
create table if not exists "Member" (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  status text not null default 'APPROVED_ACTIVE',
  "isQualified" boolean not null default false,
  "createdAt" timestamp with time zone not null default now()
);

create table if not exists "Role" (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  "createdAt" timestamp with time zone not null default now()
);

create table if not exists "MemberRole" (
  "memberId" uuid not null references "Member"(id) on delete cascade,
  "roleId" uuid not null references "Role"(id) on delete cascade,
  "assignedAt" timestamp with time zone not null default now(),
  "assignedBy" uuid,
  primary key ("memberId", "roleId")
);
create index if not exists "MemberRole_roleId_idx" on "MemberRole"("roleId");

-- Seed roles (idempotent) - fresh-start roles: admin / user
insert into "Role"(slug, name, description) values
  ('admin', 'Admin', 'Admin dashboard access - Phase 1'),
  ('user', 'User', 'User/member dashboard access - Phase 1')
on conflict (slug) do nothing;

-- 2) RLS - Phase 1 minimum (DATABASE-DESIGN.md §4.7)
-- Member: authenticated users can only read their own row; service_role bypasses for seed
alter table "Member" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Member' and policyname='member_own_row') then
    create policy member_own_row on "Member" for all to authenticated
      using (auth.uid() = id) with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where tablename='Member' and policyname='member_service_role_all') then
    create policy member_service_role_all on "Member" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "MemberRole" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='MemberRole' and policyname='memberrole_own_row') then
    create policy memberrole_own_row on "MemberRole" for all to authenticated
      using (auth.uid() = "memberId") with check (auth.uid() = "memberId");
  end if;
  if not exists (select 1 from pg_policies where tablename='MemberRole' and policyname='memberrole_service_role_all') then
    create policy memberrole_service_role_all on "MemberRole" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Role" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Role' and policyname='role_read_authenticated') then
    create policy role_read_authenticated on "Role" for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='Role' and policyname='role_service_role_all') then
    create policy role_service_role_all on "Role" for all to service_role using (true) with check (true);
  end if;
end $$;

-- 3) Realtime not needed for auth foundation - skip (handled in later phases)

-- 4) Storage bucket marketing-tools already exists from prior phase - keep as-is, no change here
