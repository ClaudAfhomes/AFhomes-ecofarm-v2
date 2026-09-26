-- Structured address columns on Registration and Member.
--
-- The legacy `address` TEXT column keeps its meaning (street/building/unit
-- line, optional). Hierarchy lives in the new columns: PH applications store
-- PSGC codes plus name snapshots (display without joins, stable if PSGC
-- renames); non-PH applications store region/city text with codes NULL.
-- All NULL so pre-existing rows need no backfill; the request contract
-- requires the hierarchy for new applications.
--
-- Validation (expect the columns present and nullable on both tables):
--   select column_name, is_nullable from information_schema.columns
--    where table_name in ('Registration', 'Member')
--      and column_name like '%province%' or column_name like '%barangay%'
--      or column_name in ('region_name', 'city_code', 'city_name')
--    order by table_name, column_name;
--
-- Down: alter table "Registration"
--   drop column if exists province_code, drop column if exists province_name,
--   drop column if exists city_code, drop column if exists city_name,
--   drop column if exists barangay_code, drop column if exists barangay_name,
--   drop column if exists region_name;
--   (same for "Member").
alter table "Registration" add column if not exists province_code text;
alter table "Registration" add column if not exists province_name text;
alter table "Registration" add column if not exists city_code text;
alter table "Registration" add column if not exists city_name text;
alter table "Registration" add column if not exists barangay_code text;
alter table "Registration" add column if not exists barangay_name text;
alter table "Registration" add column if not exists region_name text;

alter table "Member" add column if not exists province_code text;
alter table "Member" add column if not exists province_name text;
alter table "Member" add column if not exists city_code text;
alter table "Member" add column if not exists city_name text;
alter table "Member" add column if not exists barangay_code text;
alter table "Member" add column if not exists barangay_name text;
alter table "Member" add column if not exists region_name text;
