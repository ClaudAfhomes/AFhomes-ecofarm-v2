-- AF Homes Phase 12 - identity document OCR and verification state.
--
-- The credential posture is UNCHANGED: identity objects stay in private
-- buckets, only hashes/metadata live in Postgres, and delivery uses
-- short-lived signed URLs from an authorized server API. This migration adds
-- two state columns so the OCR pipeline and the human review can be told
-- apart. No document is rewritten, no secret is migrated, and no duplicate
-- constraint is created: government-ID reuse policy is unresolved, so a
-- duplicate may be flagged but never auto-rejected.
--
-- Validation before apply (every query must return zero rows):
--   select count(*) from public.identity_documents
--    where ocr_status not in ('not_requested','completed','failed','unavailable');
--   select count(*) from public.identity_documents
--    where verification_status not in ('pending_review','confirmed','rejected');
--   select count(*) from information_schema.role_table_grants
--    where table_schema='public' and table_name='identity_documents'
--      and grantee in ('anon','authenticated','PUBLIC')
--      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--
-- Validation after apply (expected):
--   select count(*) from public.identity_documents
--    where ocr_status <> 'not_requested';        -- 0
--   select count(*) from public.identity_documents
--    where verification_status <> 'pending_review';  -- 0
--
-- Down (forward-only; this note is documentation, not a script): drop the
-- three columns and restore the previous identity_documents_read policy.
-- Document rows and storage objects are unaffected.

-- ---------------------------------------------------------------------------
-- Preflight: the identity_documents table this phase builds on must exist.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='identity_documents') then
    raise exception 'PHASE12_PREREQ_MISSING:identity_documents';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Uploader attribution. The Phase 1 table records who REVIEWED a document but
-- not who UPLOADED it; ownership-scoped reads need the latter. Nullable with
-- set-null semantics so staff lifecycle never blocks on document history.
-- ---------------------------------------------------------------------------
alter table public.identity_documents
  add column if not exists uploaded_by uuid references public.staff_users(id) on delete set null;

comment on column public.identity_documents.uploaded_by is
  'Phase 12: staff actor that uploaded the scan. Powers ownership-scoped reads; null for pre-Phase-12 rows.';

-- ---------------------------------------------------------------------------
-- OCR pipeline state vs human verification state. Separate by design: OCR
-- success must never read as human confirmation.
-- ---------------------------------------------------------------------------
alter table public.identity_documents
  add column if not exists ocr_status text not null default 'not_requested'
    check (ocr_status in ('not_requested', 'completed', 'failed', 'unavailable')),
  add column if not exists ocr_provider text,
  add column if not exists verification_status text not null default 'pending_review'
    check (verification_status in ('pending_review', 'confirmed', 'rejected'));

comment on column public.identity_documents.ocr_status is
  'Phase 12: OCR pipeline state. completed means suggestions exist, never that identity is verified.';
comment on column public.identity_documents.verification_status is
  'Phase 12: human review decision. Only an explicit confirm moves this off pending_review.';

-- ---------------------------------------------------------------------------
-- Reader policy: permission holders keep full access; an uploader can always
-- read their own uploads. Additive OR only - nothing is widened to Finance,
-- nothing is granted to anon, and browser roles stay SELECT-only.
-- ---------------------------------------------------------------------------
drop policy if exists identity_documents_read on public.identity_documents;
create policy identity_documents_read on public.identity_documents
  for select to authenticated
  using (
    uploaded_by = (select auth.uid())
    or private.has_permission('sales.id_documents')
    or private.has_permission('network.ost_registrations')
  );
