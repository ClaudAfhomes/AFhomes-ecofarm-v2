-- AF Homes network-member profile link columns reconcile.
--
-- The live `network_member_profiles` table predates the link columns: member
-- creation fails with PGRST204 ("Could not find the 'ost_referrer_staff_id'
-- column of 'network_member_profiles' in the schema cache"). The defining
-- migration `20261205000001_afhomes_network_members.sql` already declares
-- both columns, but the runner skips recorded versions, so editing that file
-- can never deliver the amendment to a database that already recorded it
-- (Phase 5 lesson). This forward-only file delivers the missing links.
--
-- forward-only, idempotent: add column if not exists. Both links are
-- nullable; existing rows read NULL until a head/referrer is recorded.
-- Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='network_member_profiles';  -- 21
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='network_member_profiles'
--      and column_name in ('referrer_staff_id','ost_referrer_staff_id');  -- 2 rows
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): drop the two columns below (destroys
-- the head and OST-referrer links). Never delete member profile rows.

alter table public.network_member_profiles
  add column if not exists referrer_staff_id uuid references public.staff_users (id) on delete set null;

alter table public.network_member_profiles
  add column if not exists ost_referrer_staff_id uuid references public.staff_users (id) on delete set null;

comment on column public.network_member_profiles.referrer_staff_id is
  'Immediate-upline link (the genealogy edge lives in referral_relationships). Head changes go through the upline desk.';
comment on column public.network_member_profiles.ost_referrer_staff_id is
  'Informational OST referrer, recorded at Sales Manager onboarding only. Never a genealogy edge.';
