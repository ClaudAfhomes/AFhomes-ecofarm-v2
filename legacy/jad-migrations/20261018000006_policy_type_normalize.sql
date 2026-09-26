-- Normalize legacy policy `type`/`slug` values. The public canonical paths
-- are `/policies/terms|privacy|guidelines`; a legacy row typed `policies`
-- (from an admin free-text input before the Type-select) therefore 404s on
-- those paths. Backfill such rows from the title so they become reachable.
-- Idempotent - already-canonical rows are untouched.
--
-- Pre-apply validation (run first):
--   select id, slug, type, title from "Policy" order by id;
--
-- Down: no revert (canonical values are the desired state).

update "Policy"
set
  type = case
    when lower(title) like '%term%' then 'terms'
    when lower(title) like '%privacy%' then 'privacy'
    when lower(title) like '%guideline%' then 'guidelines'
    else type
  end,
  slug = case
    when lower(title) like '%term%' then 'terms'
    when lower(title) like '%privacy%' then 'privacy'
    when lower(title) like '%guideline%' then 'guidelines'
    else slug
  end
where lower(type) = 'policies' or lower(slug) = 'policies';
