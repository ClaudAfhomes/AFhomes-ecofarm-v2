-- AF Homes member notifications (in-app, with an email copy when mail is configured).
--
-- One row per thing a member should know about: a booking decision, a staff
-- reply to their message, or an account notice. The member portal lists them
-- and marks them read; the server writes them as a side effect of the staff
-- action that caused them (bookings, messages). Staff alerts are NOT stored
-- here: the staff header badge counts live work (new inquiries, requested
-- bookings, threads awaiting a reply) straight from those tables.
--
-- Security shape:
-- - Unexposed: `revoke all` from anon/authenticated, RLS on with NO policy. The
--   only reader/writer is the service-role handler, which scopes every query to
--   the customer resolved from the session (`api/_lib/customer-access.ts`).
-- - `link` may only be a portal path (`/customer/...`), so a notification can
--   never carry an external URL into the member's browser.
-- - `email_status` records the outcome of the email copy only; the SMTP error
--   text is never stored (providers can echo credentials or addresses).
-- - Rows are never deleted; reading sets `read_at`.
--
-- forward-only, idempotent: create ... if not exists.
--
-- Validation after apply (expected):
--   select has_table_privilege('anon', 'public.customer_notifications', 'SELECT');          -- false
--   select has_table_privilege('authenticated', 'public.customer_notifications', 'SELECT'); -- false
--   select relrowsecurity from pg_class where oid = 'public.customer_notifications'::regclass; -- true
-- Run supabase/security/rls_invariants.sql (zero AF Homes rows required).
--
-- Down (documentation, not a script): retire the callers first (portal bell,
-- bookings/messages notify calls), then drop public.customer_notifications in a
-- later migration.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  kind text not null check (kind in ('booking', 'message', 'announcement', 'account')),
  title text not null check (char_length(title) between 1 and 150),
  body text not null default '' check (char_length(body) <= 1000),
  link text check (
    link is null or (char_length(link) <= 200 and link ~ '^/customer(/[A-Za-z0-9/_-]*)?$')),
  email_status text not null default 'not_requested'
    check (email_status in ('not_requested', 'sent', 'failed', 'not_configured')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_notifications_customer_created_idx
  on public.customer_notifications (customer_id, created_at desc);
create index if not exists customer_notifications_unread_idx
  on public.customer_notifications (customer_id) where read_at is null;

alter table public.customer_notifications enable row level security;
revoke all on public.customer_notifications from public, anon, authenticated;
grant select, insert, update on public.customer_notifications to service_role;
