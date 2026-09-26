-- Government ID storage (Phase B8+): private bucket for applicant ID
-- documents (PII - never the public marketing-tools bucket).
--
-- Access model: reads go EXCLUSIVELY through short-lived signed URLs minted
-- server-side (GET /admin/registrations/:id/government-id). Writes use the
-- service role (bypasses RLS). A private bucket already denies anon and
-- authenticated direct reads, so no storage.objects policy is required here.
--
-- Optional hardening (storage RLS deny policies are defense-in-depth, not
-- load-bearing): run in the SQL Editor only when stricter posture is wanted.
-- storage.objects is owned by supabase_storage_admin, NOT the `postgres`
-- role the SQL Editor runs as, so these must run under that owner:
--
--   set role supabase_storage_admin;
--   alter table storage.objects enable row level security;
--   create policy government_ids_service_role_all on storage.objects
--     for all to service_role using (bucket_id = 'government-ids')
--     with check (bucket_id = 'government-ids');
--   create policy government_ids_no_anon_read on storage.objects
--     for select to anon using (false);
--   create policy government_ids_no_public_read on storage.objects
--     for select to authenticated using (false);
--   reset role;
--
-- Idempotent.

insert into storage.buckets (id, name, public)
values ('government-ids', 'government-ids', false)
on conflict (id) do nothing;
