-- AF Homes network-member address codes.
--
-- The member form picks the province and city from the PSGC reference and
-- autofills the ZIP from the chosen locality. Until now only the display
-- names and the ZIP text were stored, so a saved address could name a pair
-- the authority never published and nothing could re-check it. These two
-- nullable code columns align the saved record with the reference: the
-- create handler re-resolves the pair server-side and stores the authority's
-- own names, codes and postal code (a hand-crafted body that pairs a Laguna
-- province with a Batangas municipality is refused, like the application
-- flow). Updates never touch the address: head and address changes belong to
-- their own desks, so the update contract omits both columns.
--
-- forward-only, idempotent: add column if not exists. Existing rows read NULL
-- (unverified legacy text) until re-recorded. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='network_member_profiles';  -- 23
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='network_member_profiles'
--      and column_name in ('province_code','city_municipality_code');  -- 2 rows
-- Run supabase/security/rls_invariants.sql (zero rows required).
--
-- Down (documentation, not a script): drop the two columns (saved addresses
-- lose their verification links and read as legacy text again). Never delete
-- member profile rows.

alter table public.network_member_profiles
  add column if not exists province_code text
  check (province_code is null or province_code ~ '^\d{10}$');

alter table public.network_member_profiles
  add column if not exists city_municipality_code text
  check (city_municipality_code is null or city_municipality_code ~ '^\d{10}$');

comment on column public.network_member_profiles.province_code is
  'PSGC province code chosen from the reference list. Verified server-side at onboarding.';
comment on column public.network_member_profiles.city_municipality_code is
  'PSGC city/municipality code chosen from the reference list. Verified server-side at onboarding.';
