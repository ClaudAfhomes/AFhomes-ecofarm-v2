-- Member notifications + forwardable content library (Phase B2).
-- Idempotent. Notification.member_id NULL = broadcast to all members.
-- ContentItem mirrors the ForwardableContent contract shape; `share` is
-- JSONB because share targets are server-provided per-item links.
-- SSOT: notificationSchema / forwardableContentSchema in @jad/contracts.

create table if not exists "Notification" (
  id text primary key,
  member_id uuid references "Member"(id) on delete cascade,
  title text not null,
  body text,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
create index if not exists "Notification_member_idx" on "Notification"(member_id, created_at desc);

create table if not exists "ContentItem" (
  id text primary key,
  title text not null,
  description text,
  kind text not null,
  download_url text,
  share jsonb,
  published boolean not null default true,
  created_at timestamp with time zone not null default now()
);

alter table "Notification" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Notification' and policyname='notification_member_read') then
    create policy notification_member_read on "Notification" for select to authenticated
      using (member_id is null or member_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='Notification' and policyname='notification_service_role_all') then
    create policy notification_service_role_all on "Notification" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "ContentItem" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ContentItem' and policyname='contentitem_published_read') then
    create policy contentitem_published_read on "ContentItem" for select to anon, authenticated
      using (published = true);
  end if;
  if not exists (select 1 from pg_policies where tablename='ContentItem' and policyname='contentitem_service_role_all') then
    create policy contentitem_service_role_all on "ContentItem" for all to service_role using (true) with check (true);
  end if;
end $$;

-- Realtime for the member notification feed (postgres_changes on insert).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'Notification'
  ) then
    alter publication supabase_realtime add table public."Notification";
  end if;
end $$;
