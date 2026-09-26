-- Policy stable slugs (public deep links).
--
-- The public footer and the registration consent links were hardcoded to
-- `pol-001` / `pol-003`; any policy deleted and recreated in admin gets a
-- new id (`pol-<timestamp>`), so Terms/Privacy silently 404'd. Slugs give
-- the public site a stable URL key: `/policies/terms`, `/policies/privacy`.
-- New policies get a slug from the admin form (auto-suggested from title).
--
-- Backfill is derived from `type` (falling back to the id) and de-duplicated
-- with a numeric suffix, so existing rows always end up unique.
--
-- Pre-apply validation (run first):
--   select id, type, slug from "Policy" order by id;  -- inspect before/after
--   select slug, count(*) from "Policy" group by slug having count(*) > 1;
--
-- Down: drop index "Policy_slug_key", drop constraint "Policy_slug_format",
-- alter table "Policy" drop column if exists slug.

alter table "Policy" add column if not exists slug text;

with base as (
  select
    id,
    coalesce(
      nullif(trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(type), ''), id), '[^a-zA-Z0-9]+', '-', 'g'))), ''),
      'policy'
    ) as base_slug
  from "Policy"
  where slug is null
),
ranked as (
  select id, base_slug, row_number() over (partition by base_slug order by id) as rn
  from base
)
update "Policy" p
set slug = case when r.rn = 1 then r.base_slug else r.base_slug || '-' || r.rn end
from ranked r
where p.id = r.id and p.slug is null;

update "Policy" set slug = 'policy' where slug is null or slug = '';

alter table "Policy" alter column slug set not null;

create unique index if not exists "Policy_slug_key" on "Policy" (slug);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'Policy_slug_format') then
    alter table "Policy"
      add constraint "Policy_slug_format"
      check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;
end $$;
