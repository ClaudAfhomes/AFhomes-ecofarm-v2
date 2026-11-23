-- AF Homes sales-network Members.
--
-- Hierarchy sellers (Vice Director, Senior Sales Manager, Sales Manager) are
-- onboarded with a full personal record through the Members screen. A Member
-- IS a staff account (login provisioned at creation); the extra form fields
-- live on the linked `network_member_profiles` row, one per staff account.
-- OST is onboarded through the OST registration flow, never here.
--
-- Sensitivity follows the customer record: TIN and the government ID number
-- are write-only (masked on every read, never in audits). The table is
-- staff-only and unexposed: `revoke all` from `anon`/`authenticated` with
-- RLS enabled and no browser policies, so a direct PostgREST call has no
-- privilege even if a policy were wrong. All access goes through the
-- service-role Members API.
--
-- The `network.members` module mirrors the `network.genealogy` audience
-- (admin manages; the hierarchy reads its own network). Grants use the same
-- (role_id, module_id) upsert as the permission baseline.
--
-- forward-only, idempotent: create table if not exists; module and grant
-- inserts are conflict-safe. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='network_member_profiles';  -- 21
--   select key, name, group_name, sort_order from public.modules
--    where key='network.members';  -- 1 row, Members/Network/56
--   select r.slug, rp.can_view, rp.can_create, rp.can_update
--     from public.role_permissions rp
--     join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id
--    where m.key='network.members' order by r.slug;
--      -- admin t/t/t; ost, sales_manager, senior_sales_manager,
--      -- vice_director t/f/f; no other rows
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): the table is inert once no caller
-- writes it; the module row and grants are superseded by later migrations.
-- Never delete member profile rows.

-- ---------------------------------------------------------------------------
-- 1. Linked profile record. Position is NOT stored here: the staff role
--    assignment is the authority, so a profile can never disagree with it.
-- ---------------------------------------------------------------------------
create table if not exists public.network_member_profiles (
  staff_id uuid primary key references public.staff_users (id) on delete cascade,
  date_of_birth date not null,
  sex text not null check (sex in ('Male', 'Female')),
  civil_status text not null check (civil_status in ('Single', 'Married', 'Widowed', 'Separated')),
  street_no text not null,
  city_municipality text not null,
  province text not null,
  zip_code text not null,
  tel_no text,
  mobile_no text not null,
  fb_messenger text,
  tin text,
  employer_name text not null,
  employer_address text not null,
  job_position text not null,
  government_id_type text not null,
  government_id_number text not null,
  referrer_staff_id uuid references public.staff_users (id) on delete set null,
  ost_referrer_staff_id uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.network_member_profiles is
  'Linked personal record for a sales-network Member (one row per hierarchy staff account). TIN and the government ID number are write-only.';
comment on column public.network_member_profiles.tin is
  'Write-only. Masked on every read, never in audits.';
comment on column public.network_member_profiles.government_id_number is
  'Write-only. Masked on every read, never in audits.';
comment on column public.network_member_profiles.referrer_staff_id is
  'Immediate-upline link (the genealogy edge lives in referral_relationships). Head changes go through the upline desk.';
comment on column public.network_member_profiles.ost_referrer_staff_id is
  'Informational OST referrer, recorded at Sales Manager onboarding only. Never a genealogy edge.';

alter table public.network_member_profiles enable row level security;

-- Staff-only and unexposed: no browser privilege, no browser policy.
revoke all on public.network_member_profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Module row plus grants. Same audience as network.genealogy; admin also
--    creates/updates (member onboarding provisions the staff account).
-- ---------------------------------------------------------------------------
insert into public.modules (key, name, group_name, sort_order)
values ('network.members', 'Members', 'Network', 56)
on conflict (key) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

insert into public.role_permissions
  (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, v.can_view, v.can_create, v.can_update, v.can_delete
from (values
  ('admin',                true,  true,  true,  false),
  ('vice_director',        true,  false, false, false),
  ('senior_sales_manager', true,  false, false, false),
  ('sales_manager',        true,  false, false, false),
  ('ost',                  true,  false, false, false)
) as v(role_slug, can_view, can_create, can_update, can_delete)
join public.roles r on r.slug = v.role_slug
join public.modules m on m.key = 'network.members'
on conflict (role_id, module_id) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;
