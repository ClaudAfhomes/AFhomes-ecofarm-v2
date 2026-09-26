-- Marketing Tools bucket limits (marketing-tools content uploads).
-- The bucket was created manually (public read); the admin dialog uploads
-- documents, images, videos, and promos, but Supabase rejects direct PUTs
-- that violate the bucket's file_size_limit / allowed_mime_types with a bare
-- 400 and no actionable message. This pins the bucket to the API contract
-- (`api/v1/cms/upload/sign.ts` KIND_UPLOAD_RULES: 100 MB VIDEO cap, document
-- + image + video MIME unions) so sign-then-PUT succeeds for every kind the
-- UI advertises.
--
-- Values are widened, never narrowed: public flag and existing objects are
-- untouched on conflict. Idempotent. Apply with `supabase db push` (or the
-- SQL Editor as a role that can write storage.buckets), then verify in
-- Dashboard → Storage → marketing-tools → Configuration.
--
-- NOTE: does not take effect until applied to the target project. Until then,
-- video/document PUTs keep failing at Supabase with 400 - see Dashboard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-tools',
  'marketing-tools',
  true,
  104857600,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();
