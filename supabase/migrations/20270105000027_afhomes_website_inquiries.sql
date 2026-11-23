-- AF Homes website inquiries inbox.
--
-- Until now the public contact/reservation form kept each submission only in the
-- visitor's own browser and opened their email app, so AF Homes staff never saw
-- a submission the visitor did not finish sending. This table is the server-side
-- inbox: the public API inserts one row per submission (service role), staff
-- read and work it in the admin console under the new `sales.inquiries` module.
--
-- A website "reservation" is a REQUEST to be contacted about a visit. Nothing
-- here holds a room, takes money, creates a customer or a booking.
--
-- Security shape:
-- - Staff-only and unexposed: `revoke all` from anon/authenticated and RLS on
--   with NO policy, so a direct PostgREST call can read or write nothing even if a
--   grant were later added by mistake. Every read and write goes through the
--   service-role handler `api/_handlers/inquiries.ts`, which authorizes
--   `sales.inquiries` per request and audits every staff change.
-- - `client_request_id` (the form's UUID) is unique, so a retried submission
--   returns the same row instead of creating a duplicate.
-- - Nothing is deleted: junk is marked `spam`.
--
-- Grants: `admin` gets view + update. Super Admin holds every module by slug.
-- No role gets create/delete: rows come only from the public form.
--
-- forward-only, idempotent: create ... if not exists, upserts, drop/create policy-free.
--
-- Validation after apply (expected):
--   select count(*) from public.modules where key = 'sales.inquiries';              -- 1
--   select r.slug, rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id where m.key = 'sales.inquiries'; -- admin t/f/t/f
--   select has_table_privilege('anon', 'public.website_inquiries', 'SELECT');          -- false
--   select has_table_privilege('authenticated', 'public.website_inquiries', 'SELECT'); -- false
--   select relrowsecurity from pg_class where oid = 'public.website_inquiries'::regclass; -- true
-- Run supabase/security/rls_invariants.sql (zero AF Homes rows required).
--
-- Down (documentation, not a script): retire the callers first (website form,
-- inquiries handler, admin inbox and nav), then in a later migration delete the
-- grant and module row and drop public.website_inquiries. Export the rows first:
-- they are customer contact records.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

insert into public.modules (key, name, group_name, sort_order)
values ('sales.inquiries', 'Website Inquiries', 'Sales & Customers', 36)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      is_active = true;

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, true, false
from public.roles r
cross join public.modules m
where r.slug = 'admin' and m.key = 'sales.inquiries'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = false, can_update = true, can_delete = false;

create table if not exists public.website_inquiries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  -- `greatest(6, length(...))` so lpad pads and never truncates (lpad cuts a
  -- longer value down to the target length).
  reference text generated always as
    ('INQ-' || lpad(seq::text, greatest(6, length(seq::text)), '0')) stored,
  client_request_id uuid not null,
  kind text not null default 'inquiry' check (kind in ('inquiry', 'reservation')),
  inquiry_type text not null check (inquiry_type in (
    'VIP Privilege', 'Smart Wellness Hotel', 'ALM Japanese Restaurant',
    'Hotspring & Ecofarm Resort', 'General Inquiry')),
  name text not null check (char_length(name) between 2 and 150),
  email text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  contact_number text not null check (char_length(contact_number) between 7 and 30),
  message text not null check (char_length(message) between 10 and 5000),
  visit_date date,
  end_date date,
  guests integer check (guests between 1 and 100),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'confirmed', 'closed', 'spam')),
  staff_notes text not null default '' check (char_length(staff_notes) <= 5000),
  assigned_to uuid references public.staff_users(id) on delete set null,
  handled_by uuid references public.staff_users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_inquiries_client_request_unique unique (client_request_id),
  constraint website_inquiries_reference_unique unique (reference),
  constraint website_inquiries_dates check (end_date is null or (visit_date is not null and end_date >= visit_date)),
  constraint website_inquiries_reservation_details check (
    kind <> 'reservation' or (visit_date is not null and guests is not null))
);

create index if not exists website_inquiries_status_created_idx
  on public.website_inquiries (status, created_at desc);
create index if not exists website_inquiries_created_idx
  on public.website_inquiries (created_at desc);
create index if not exists website_inquiries_assigned_idx
  on public.website_inquiries (assigned_to) where assigned_to is not null;
create index if not exists website_inquiries_handled_by_idx
  on public.website_inquiries (handled_by) where handled_by is not null;

alter table public.website_inquiries enable row level security;
revoke all on public.website_inquiries from public, anon, authenticated;
grant select, insert, update on public.website_inquiries to service_role;
