-- Per-country phone metadata on the countries reference table.
--
-- Registration phone numbers are validated per country (dial code + national
-- significant-number lengths + optional shape pattern); countries without
-- metadata fall back to generic E.164 rules (7-15 digits). `GET
-- /config/public` serves the sanitized subset. Values follow national
-- numbering plans (PH: NTC 09XXXXXXXXX / +639XXXXXXXXX); rows added later
-- get metadata via a follow-up update, never a schema change.
--
-- Validation (expect one row per code below, pattern non-null only for PH):
--   select code, dial_code, phone_national_min, phone_national_max,
--          phone_pattern is not null as has_pattern
--     from countries
--    where code in ('PH','US','GB','SG');
--
-- Down: alter table countries
--   drop column if exists dial_code,
--   drop column if exists phone_national_min,
--   drop column if exists phone_national_max,
--   drop column if exists phone_pattern;
alter table countries add column if not exists dial_code text;
alter table countries add column if not exists phone_national_min integer;
alter table countries add column if not exists phone_national_max integer;
alter table countries add column if not exists phone_pattern text;

-- Idempotent curated seed (re-runnable UPDATEs; unknown countries keep NULLs
-- and use the generic E.164 fallback).
update countries set dial_code = '63', phone_national_min = 10, phone_national_max = 10, phone_pattern = '^9[0-9]{9}$' where code = 'PH';
update countries set dial_code = '1', phone_national_min = 10, phone_national_max = 10, phone_pattern = null where code in ('US', 'CA');
update countries set dial_code = '44', phone_national_min = 9, phone_national_max = 10, phone_pattern = null where code = 'GB';
update countries set dial_code = '61', phone_national_min = 9, phone_national_max = 9, phone_pattern = null where code = 'AU';
update countries set dial_code = '65', phone_national_min = 8, phone_national_max = 8, phone_pattern = null where code = 'SG';
update countries set dial_code = '852', phone_national_min = 8, phone_national_max = 8, phone_pattern = null where code = 'HK';
update countries set dial_code = '81', phone_national_min = 9, phone_national_max = 10, phone_pattern = null where code = 'JP';
update countries set dial_code = '82', phone_national_min = 9, phone_national_max = 10, phone_pattern = null where code = 'KR';
update countries set dial_code = '971', phone_national_min = 8, phone_national_max = 9, phone_pattern = null where code = 'AE';
update countries set dial_code = '966', phone_national_min = 9, phone_national_max = 9, phone_pattern = null where code = 'SA';
update countries set dial_code = '974', phone_national_min = 8, phone_national_max = 8, phone_pattern = null where code = 'QA';
update countries set dial_code = '965', phone_national_min = 8, phone_national_max = 8, phone_pattern = null where code = 'KW';
update countries set dial_code = '973', phone_national_min = 8, phone_national_max = 8, phone_pattern = null where code = 'BH';
update countries set dial_code = '968', phone_national_min = 8, phone_national_max = 8, phone_pattern = null where code = 'OM';
update countries set dial_code = '60', phone_national_min = 9, phone_national_max = 10, phone_pattern = null where code = 'MY';
update countries set dial_code = '62', phone_national_min = 9, phone_national_max = 12, phone_pattern = null where code = 'ID';
update countries set dial_code = '66', phone_national_min = 9, phone_national_max = 9, phone_pattern = null where code = 'TH';
update countries set dial_code = '84', phone_national_min = 9, phone_national_max = 10, phone_pattern = null where code = 'VN';
update countries set dial_code = '91', phone_national_min = 10, phone_national_max = 10, phone_pattern = null where code = 'IN';
update countries set dial_code = '86', phone_national_min = 11, phone_national_max = 11, phone_pattern = null where code = 'CN';
update countries set dial_code = '64', phone_national_min = 8, phone_national_max = 9, phone_pattern = null where code = 'NZ';
update countries set dial_code = '49', phone_national_min = 10, phone_national_max = 11, phone_pattern = null where code = 'DE';
update countries set dial_code = '33', phone_national_min = 9, phone_national_max = 9, phone_pattern = null where code = 'FR';
update countries set dial_code = '39', phone_national_min = 9, phone_national_max = 11, phone_pattern = null where code = 'IT';
update countries set dial_code = '34', phone_national_min = 9, phone_national_max = 9, phone_pattern = null where code = 'ES';
