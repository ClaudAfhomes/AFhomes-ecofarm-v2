-- Per-member notification read state (production notification feed).
--
-- Notification.read_at is row-level: for broadcast rows (member_id IS NULL) it
-- is shared across all members, so one member marking a broadcast read would
-- mark it read for everyone. NotificationRead records each member's own read
-- receipts: broadcast receipts here, member-scoped receipts here too (row
-- read_at stays as the legacy/seed fallback the API merges over).
--   NotificationRead (notificationId, memberId) PK → Notification(id),
--                   Member(id). readAt = when the member read the item.
-- Idempotent (if not exists / on conflict / pg_policies guards).
--
-- Validation (must hold after apply):
--   select count(*) from "NotificationRead";
--     -- pre-existing unread member rows backfilled from Notification.read_at
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'NotificationRead' and grantee in ('anon','authenticated','PUBLIC');
--     -- authenticated: SELECT only (no INSERT/UPDATE/DELETE/TRUNCATE rows)
-- Down: drop table "NotificationRead";

create table if not exists "NotificationRead" (
  "notificationId" text not null references "Notification"(id) on delete cascade,
  "memberId" uuid not null references "Member"(id) on delete cascade,
  "readAt" timestamp with time zone not null default now(),
  primary key ("notificationId", "memberId")
);
create index if not exists "NotificationRead_member_idx" on "NotificationRead"("memberId", "readAt" desc);

-- Backfill: pre-migration member-scoped rows with a server read_at converge
-- into receipts (broadcast rows have no per-member state to backfill).
insert into "NotificationRead" ("notificationId", "memberId", "readAt")
select id, member_id, read_at from "Notification"
 where member_id is not null and read_at is not null
on conflict ("notificationId", "memberId") do nothing;

alter table "NotificationRead" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'NotificationRead' and policyname = 'notificationread_select_own') then
    create policy notificationread_select_own on "NotificationRead" for select to authenticated
      using (auth.uid() = "memberId");
  end if;
  if not exists (select 1 from pg_policies where tablename = 'NotificationRead' and policyname = 'notificationread_service_role_all') then
    create policy notificationread_service_role_all on "NotificationRead" for all to service_role
      using (true) with check (true);
  end if;
end $$;
