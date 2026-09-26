-- Policy PDF document (FR-ADM-004 policies CRUD).
-- Adds `document_url` to "Policy": each policy carries a required PDF uploaded
-- to the public `marketing-tools` bucket via `POST /api/v1/cms/upload/sign`
-- (DOCUMENT kind, PDF allowed) + direct PUT; the public URL is persisted here.
-- Public/member pages link to the URL; plain-text `content` remains an
-- optional summary. Nullable (existing pol-001..003 rows have no PDF yet) - 
-- the PDF is required at the API layer (`policyCreateSchema` /
-- `policyUpdateSchema`), never baked in as NOT NULL without a backfill.
-- RLS is untouched: `policy_public_read` (anon+authenticated SELECT) and
-- `policy_service_role_all` already cover new columns.
--
-- Validation (run before applying):
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='Policy';
-- Down: alter table "Policy" drop column if exists "document_url";

alter table "Policy" add column if not exists "document_url" text;
