-- Contact inquiries (public Contact page form submissions).
--
-- The public Contact page posts `POST /api/v1/contact`; submissions land
-- here and are triaged in the admin Inquiries queue (`GET/PATCH
-- /api/v1/admin/inquiries`, staff `cms` module). No confirmation email is
-- sent - the queue is the delivery mechanism.
--
-- Writes go through the service-role API handlers only: RLS grants nothing
-- to anon/authenticated (SELECT-only identity invariant). `ipHash` is a
-- SHA-256 of the submitter IP used for the 15-minute anti-spam throttle - 
-- never the raw IP.
--
-- Pre-apply validation (run first):
--   select * from "ContactInquiry" limit 1;  -- expect "relation does not exist"
--
-- Down: drop table "ContactInquiry" (submissions are operational data;
-- export anything worth keeping first).

create table if not exists "ContactInquiry" (
  id text primary key,
  name text not null,
  email text not null,
  message text not null,
  status text not null default 'NEW'
    check (status in ('NEW', 'READ', 'ARCHIVED')),
  "ipHash" text,
  "createdAt" timestamptz not null default now(),
  "handledAt" timestamptz,
  "handledBy" text
);

create index if not exists "ContactInquiry_created_idx"
  on "ContactInquiry" ("createdAt" desc);

create index if not exists "ContactInquiry_status_idx"
  on "ContactInquiry" (status);

alter table "ContactInquiry" enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ContactInquiry' and policyname = 'contact_inquiry_service_role_all') then
    create policy contact_inquiry_service_role_all on "ContactInquiry"
      for all to service_role using (true) with check (true);
  end if;
end $$;
