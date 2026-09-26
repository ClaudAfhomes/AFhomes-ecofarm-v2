-- Admin↔member messaging, one thread per member (ADR-013, FEAT-072).
--
--   Conversation  "memberId" uuid PK → Member(id). One row per member with a
--                 thread: lastMessageAt + per-side read watermarks and unread
--                 counters for badges. No delete path except member purge.
--   Message       id text PK (server `msg-…`), "memberId" uuid → Member(id)
--                 (denormalized for own-row RLS + realtime filter),
--                 "senderType" MEMBER|STAFF, "senderId" uuid (Member.id or
--                 StaffUser.id - deliberately no FK across the two identity
--                 domains), "senderName" display snapshot, body text 1..4000
--                 (plain text v1; the UI never renders it as HTML).
-- All writes go through the service-role API (authenticated are SELECT-only,
-- like Notification/NotificationRead). A plain AFTER INSERT trigger maintains
-- the conversation row atomically with the insert, keeping the API to one
-- statement. `is_staff_user()` is the first staff RLS read helper (SELECT
-- only, no write path): it gates staff postgres_changes realtime; staff API
-- reads keep using verifyStaffModule + service role.
--
-- Validation (must hold after apply):
--   select count(*) from "Conversation";  -- 0 rows (threads start on first message)
--   select count(*) from "Message";       -- 0 rows
--   select proname from pg_proc where proname in ('is_staff_user', 'message_after_insert');
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('Conversation', 'Message') and grantee in ('anon','authenticated','PUBLIC');
--     -- authenticated: SELECT only (no INSERT/UPDATE/DELETE/TRUNCATE rows)
--   select count(*) from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'Message';
--     -- 1 row (live thread updates)
-- Down (rollback only):
--   alter publication supabase_realtime drop table if exists public."Message";
--   drop trigger if exists message_after_insert_trigger on "Message";
--   drop function if exists public.message_after_insert();
--   drop function if exists public.is_staff_user();
--   drop table if exists "Message"; drop table if exists "Conversation";

create table if not exists "Conversation" (
  "memberId" uuid primary key references "Member"(id) on delete cascade,
  "lastMessageAt" timestamp with time zone,
  "memberLastReadAt" timestamp with time zone,
  "staffLastReadAt" timestamp with time zone,
  "memberUnread" integer not null default 0 check ("memberUnread" >= 0),
  "staffUnread" integer not null default 0 check ("staffUnread" >= 0),
  "createdAt" timestamp with time zone not null default now(),
  "updatedAt" timestamp with time zone not null default now()
);
create index if not exists "Conversation_lastMessageAt_idx" on "Conversation"("lastMessageAt" desc nulls last);

create table if not exists "Message" (
  id text primary key,
  "memberId" uuid not null references "Member"(id) on delete cascade,
  "senderType" text not null check ("senderType" in ('MEMBER', 'STAFF')),
  "senderId" uuid not null,
  "senderName" text not null,
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 4000),
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "Message_member_thread_idx" on "Message"("memberId", "createdAt" desc, id desc);

-- Staff standing helper for SELECT-only RLS (ACTIVE staff with a role
-- assignment; password-change-required staff are excluded like verifyStaff).
-- SECURITY DEFINER so it reads StaffUser/StaffAssignment through their RLS;
-- EXECUTE is granted to authenticated only (documented exception in
-- supabase/security/rls_invariants.sql §5 triage).
create or replace function public.is_staff_user() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "StaffUser" su
    where su.id = auth.uid()
      and su.status = 'ACTIVE'
      and su."mustChangePassword" = false
      and exists (select 1 from "StaffAssignment" sa where sa."staffUserId" = su.id)
  );
$$;
revoke execute on function public.is_staff_user() from public, anon;
grant execute on function public.is_staff_user() to authenticated, service_role;

-- Maintains the conversation row in the same transaction as the message
-- insert. Trigger invocation needs no EXECUTE grant; revoke it anyway so the
-- function never shows up as directly callable (rls_invariants §5).
create or replace function public.message_after_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into "Conversation" ("memberId", "createdAt", "updatedAt")
    values (new."memberId", now(), now())
    on conflict ("memberId") do nothing;
  update "Conversation" set
    "lastMessageAt" = new."createdAt",
    "updatedAt" = now(),
    "memberUnread" = "memberUnread" + case when new."senderType" = 'STAFF' then 1 else 0 end,
    "staffUnread" = "staffUnread" + case when new."senderType" = 'MEMBER' then 1 else 0 end
    where "memberId" = new."memberId";
  return new;
end;
$$;
revoke execute on function public.message_after_insert() from public, anon, authenticated;
grant execute on function public.message_after_insert() to service_role;

drop trigger if exists message_after_insert_trigger on "Message";
create trigger message_after_insert_trigger
  after insert on "Message"
  for each row execute function public.message_after_insert();

alter table "Conversation" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'Conversation' and policyname = 'conversation_member_select_own') then
    create policy conversation_member_select_own on "Conversation" for select to authenticated
      using (auth.uid() = "memberId");
  end if;
  if not exists (select 1 from pg_policies where tablename = 'Conversation' and policyname = 'conversation_staff_select') then
    create policy conversation_staff_select on "Conversation" for select to authenticated
      using (public.is_staff_user());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'Conversation' and policyname = 'conversation_service_role_all') then
    create policy conversation_service_role_all on "Conversation" for all to service_role
      using (true) with check (true);
  end if;
end $$;

alter table "Message" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'Message' and policyname = 'message_member_select_own') then
    create policy message_member_select_own on "Message" for select to authenticated
      using (auth.uid() = "memberId");
  end if;
  if not exists (select 1 from pg_policies where tablename = 'Message' and policyname = 'message_staff_select') then
    create policy message_staff_select on "Message" for select to authenticated
      using (public.is_staff_user());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'Message' and policyname = 'message_service_role_all') then
    create policy message_service_role_all on "Message" for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- Belt-and-braces: RLS filters rows only for roles that hold table
-- privileges, so remove the underlying write privileges too (mirrors
-- 20260921000001_rls_privilege_hardening.sql).
revoke insert, update, delete, truncate on "Conversation" from authenticated, anon;
revoke insert, update, delete, truncate on "Message" from authenticated, anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'Message'
  ) then
    alter publication supabase_realtime add table public."Message";
  end if;
end $$;
