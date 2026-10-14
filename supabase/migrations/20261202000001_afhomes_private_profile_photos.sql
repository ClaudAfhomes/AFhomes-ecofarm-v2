-- Private, one-object-per-Auth-account profile photos. No application table needed:
-- Storage owns object paths and file metadata; authorized APIs derive the owner path.
-- Validate: public=false, file_size_limit=500000, allowed_mime_types={image/jpeg};
-- run supabase/security/rls_invariants.sql. No browser Storage write policy is added.
-- Down: disable photo APIs/UI; retain private objects. Do not make the bucket public.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('afhomes-profile-photos','afhomes-profile-photos',false,500000,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
commit;
