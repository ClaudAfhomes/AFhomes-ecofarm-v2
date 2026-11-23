-- AF Homes member service bookings.
--
-- A signed-in, active member asks to use a published, available service on a
-- date (a room night, a dinner, a resort day). Staff with `operations.bookings`
-- confirm or decline it, then mark it completed or cancelled; the member may
-- cancel their own request before the date. Every decision notifies the member.
--
-- A booking is NOT money and NOT points. It stores no price and moves nothing:
-- payment, earning and redemption stay in their existing flows. There is no
-- capacity or room-inventory rule in AF Homes' approved business rules, so staff
-- confirm each request by hand; nothing here auto-confirms.
--
-- Security shape:
-- - Unexposed: `revoke all` from anon/authenticated, RLS on with NO policy. The
--   member portal handler scopes every query to the session's customer; the
--   staff handler authorizes `operations.bookings` per request and audits.
-- - `(customer_id, client_request_id)` is unique, so a retried request returns
--   the member's own booking and can never reveal another member's.
-- - `service_name_snapshot` keeps the name the member booked, so a later catalog
--   rename cannot rewrite history. The service row is referenced, never deleted.
-- - `cancelled_by` is set exactly when the status is `cancelled`.
--
-- Grants: `admin` gets view + update (decide). No role gets create (members
-- create) or delete (nothing is deleted).
--
-- forward-only, idempotent: create ... if not exists, upserts.
--
-- Validation after apply (expected):
--   select count(*) from public.modules where key = 'operations.bookings';           -- 1
--   select r.slug, rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id where m.key = 'operations.bookings'; -- admin t/f/t/f
--   select has_table_privilege('authenticated', 'public.service_bookings', 'SELECT');   -- false
--   select relrowsecurity from pg_class where oid = 'public.service_bookings'::regclass; -- true
-- Run supabase/security/rls_invariants.sql (zero AF Homes rows required).
--
-- Down (documentation, not a script): retire the callers first (portal booking
-- page, staff bookings page and nav), then in a later migration delete the grant
-- and module row and drop public.service_bookings. Export the rows first.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

insert into public.modules (key, name, group_name, sort_order)
values ('operations.bookings', 'Service Bookings', 'Operations', 65)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      is_active = true;

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, true, false
from public.roles r
cross join public.modules m
where r.slug = 'admin' and m.key = 'operations.bookings'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = false, can_update = true, can_delete = false;

create table if not exists public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  -- `greatest(6, length(...))` so lpad pads and never truncates.
  reference text generated always as
    ('BKG-' || lpad(seq::text, greatest(6, length(seq::text)), '0')) stored,
  client_request_id uuid not null,
  customer_id uuid not null references public.customers(id),
  service_id uuid not null references public.service_catalog(id),
  service_name_snapshot text not null check (char_length(service_name_snapshot) between 1 and 200),
  start_date date not null,
  end_date date,
  guests integer not null check (guests between 1 and 100),
  customer_notes text not null default '' check (char_length(customer_notes) <= 1000),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'declined', 'cancelled', 'completed')),
  response_note text not null default '' check (char_length(response_note) <= 1000),
  decided_by uuid references public.staff_users(id) on delete set null,
  decided_at timestamptz,
  cancelled_by text check (cancelled_by in ('customer', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_bookings_request_unique unique (customer_id, client_request_id),
  constraint service_bookings_reference_unique unique (reference),
  constraint service_bookings_dates check (end_date is null or end_date >= start_date),
  constraint service_bookings_cancelled_by check ((status = 'cancelled') = (cancelled_by is not null))
);

create index if not exists service_bookings_status_start_idx
  on public.service_bookings (status, start_date);
create index if not exists service_bookings_customer_created_idx
  on public.service_bookings (customer_id, created_at desc);
create index if not exists service_bookings_service_idx
  on public.service_bookings (service_id);
create index if not exists service_bookings_decided_by_idx
  on public.service_bookings (decided_by) where decided_by is not null;

alter table public.service_bookings enable row level security;
revoke all on public.service_bookings from public, anon, authenticated;
grant select, insert, update on public.service_bookings to service_role;
