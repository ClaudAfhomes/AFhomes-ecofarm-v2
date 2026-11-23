-- AF Homes announcements.
--
-- Staff with `communication.announcements` write a notice for members, staff or
-- both, publish it (optionally pinned, optionally with an expiry) and archive it
-- later. Members read published, unexpired member/everyone notices in the
-- portal; signed-in staff read staff/everyone notices on their dashboard.
--
-- Publishing does not email anyone: a bulk send to every member is out of
-- scope until AF Homes has a mail provider and an opt-out rule.
--
-- Security shape:
-- - Unexposed: `revoke all` from anon/authenticated, RLS on with NO policy. All
--   reads and writes go through service-role handlers; the manage routes
--   authorize `communication.announcements` and audit every change.
-- - Nothing is deleted: an old notice is archived.
--
-- Grants: `admin` gets view + create + update. No role gets delete.
--
-- forward-only, idempotent: create ... if not exists, upserts.
--
-- Validation after apply (expected):
--   select count(*) from public.modules where key = 'communication.announcements';   -- 1
--   select r.slug, rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id
--    where m.key = 'communication.announcements';                                   -- admin t/t/t/f
--   select has_table_privilege('authenticated', 'public.announcements', 'SELECT');   -- false
--   select relrowsecurity from pg_class where oid = 'public.announcements'::regclass; -- true
-- Run supabase/security/rls_invariants.sql (zero AF Homes rows required).
--
-- Down (documentation, not a script): retire the callers first (portal and
-- dashboard feeds, admin page and nav), then in a later migration delete the
-- grant and module row and drop public.announcements.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

insert into public.modules (key, name, group_name, sort_order)
values ('communication.announcements', 'Announcements', 'Communication', 80)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      is_active = true;

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, true, true, false
from public.roles r
cross join public.modules m
where r.slug = 'admin' and m.key = 'communication.announcements'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = true, can_update = true, can_delete = false;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 150),
  body text not null check (char_length(body) between 1 and 5000),
  audience text not null check (audience in ('customers', 'staff', 'everyone')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  pinned boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.staff_users(id) on delete set null,
  updated_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_published_at check (status <> 'published' or published_at is not null),
  constraint announcements_expiry check (
    expires_at is null or published_at is null or expires_at > published_at)
);

create index if not exists announcements_feed_idx
  on public.announcements (status, audience, published_at desc);
create index if not exists announcements_created_by_idx
  on public.announcements (created_by) where created_by is not null;
create index if not exists announcements_updated_by_idx
  on public.announcements (updated_by) where updated_by is not null;

alter table public.announcements enable row level security;
revoke all on public.announcements from public, anon, authenticated;
grant select, insert, update on public.announcements to service_role;
