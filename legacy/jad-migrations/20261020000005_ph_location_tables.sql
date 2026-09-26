-- Philippine administrative reference (PSGC-derived, seeded separately).
--
-- Registration addresses for PH are structured selections, never free text:
-- province -> city/municipality -> barangay. Independent/component cities
-- sit directly under their region, so `ph_cities.province_code` is nullable;
-- the provinces endpoint lists them as top-level entries alongside provinces.
-- Codes are the official PSGC codes (province 5-digit, city/municipality
-- 6-digit, barangay 9-digit). Data arrives via `supabase/seed-ph-locations.ts`
-- (official PSGC publication); these tables start empty and the registration
-- UI degrades to an explicit unavailable state until seeded - never to free
-- text that could bypass hierarchy checks.
--
-- Validation (expect 0 rows before seeding, FKs valid after):
--   select count(*) from ph_provinces;
--   select count(*) from ph_cities where province_code is not null
--     and province_code not in (select code from ph_provinces);
--   select count(*) from ph_barangays where city_code not in (select code from ph_cities);
--
-- Down: drop table if exists ph_barangays; drop table if exists ph_cities;
--   drop table if exists ph_provinces;
create table if not exists ph_provinces (
  code text primary key,
  name text not null,
  region_code text not null,
  region_name text not null
);

create table if not exists ph_cities (
  code text primary key,
  province_code text null references ph_provinces(code),
  name text not null,
  is_city boolean not null default true
);
create index if not exists ph_cities_province_idx on ph_cities(province_code);

create table if not exists ph_barangays (
  code text primary key,
  city_code text not null references ph_cities(code),
  name text not null
);
create index if not exists ph_barangays_city_idx on ph_barangays(city_code);

-- Public read (reference data, like countries); writes are service_role-only.
alter table ph_provinces enable row level security;
alter table ph_cities enable row level security;
alter table ph_barangays enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ph_provinces' and policyname = 'ph_provinces_read_all') then
    create policy ph_provinces_read_all on ph_provinces for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ph_provinces' and policyname = 'ph_provinces_service_all') then
    create policy ph_provinces_service_all on ph_provinces for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ph_cities' and policyname = 'ph_cities_read_all') then
    create policy ph_cities_read_all on ph_cities for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ph_cities' and policyname = 'ph_cities_service_all') then
    create policy ph_cities_service_all on ph_cities for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ph_barangays' and policyname = 'ph_barangays_read_all') then
    create policy ph_barangays_read_all on ph_barangays for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ph_barangays' and policyname = 'ph_barangays_service_all') then
    create policy ph_barangays_service_all on ph_barangays for all to service_role using (true) with check (true);
  end if;
end $$;
