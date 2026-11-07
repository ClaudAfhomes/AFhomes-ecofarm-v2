-- F-01: align direct document and Storage reads with the existing API scope.
-- Validation: node packages/db-testing/scripts/test-security-remediation.mjs --full
-- Run supabase/security/rls_invariants.sql: every query must return zero rows.
-- select has_column_privilege('authenticated','public.identity_documents','extracted_data','SELECT'); -- false
-- Down: forward-only; restore access only through a reviewed scoped migration.
-- No business rows, bucket configuration or historical records are changed.

create or replace function private.can_read_identity_document(p_document_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
 select exists (
   select 1 from public.identity_documents d
   where d.id=p_document_id
     and private.has_permission(case d.subject_type
       when 'customer' then 'sales.id_documents'
       when 'ost_application' then 'network.ost_registrations' end, 'view')
     and (
       private.staff_role_slug(auth.uid()) not in ('vice_director','senior_sales_manager','sales_manager','ost')
       or d.uploaded_by=auth.uid()
       or (d.subject_type='customer' and exists (
         select 1 from public.customers c where c.id=d.customer_id and c.created_by=auth.uid()))
       or (d.subject_type='ost_application' and exists (
         select 1 from public.ost_applications a where a.id=d.ost_application_id and a.sponsor_staff_id=auth.uid()))
     )
 );
$$;
revoke all on function private.can_read_identity_document(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_identity_document(uuid) to authenticated;

create or replace function private.can_read_identity_object(p_bucket text,p_name text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
 select exists(select 1 from public.identity_documents d
   where d.storage_path=p_bucket||'/'||p_name
     and ((p_bucket='afhomes-customer-ids' and d.subject_type='customer')
       or (p_bucket='afhomes-ost-ids' and d.subject_type='ost_application'))
     and private.can_read_identity_document(d.id));
$$;
revoke all on function private.can_read_identity_object(text,text) from public,anon,authenticated,service_role;
grant execute on function private.can_read_identity_object(text,text) to authenticated;

revoke all on public.identity_documents from public,anon,authenticated;
-- REVOKE table privileges alone does not remove pre-existing column grants.
revoke select (id,subject_type,ost_application_id,customer_id,storage_path,original_filename,
 mime_type,size_bytes,sha256,extracted_data,reviewed_data,reviewed_by,reviewed_at,created_at,
 uploaded_by,ocr_status,ocr_provider,verification_status) on public.identity_documents from public,anon,authenticated;
grant select (id,subject_type,ost_application_id,customer_id,storage_path,original_filename,
 mime_type,size_bytes,reviewed_by,reviewed_at,created_at,uploaded_by,ocr_status,ocr_provider,
 verification_status) on public.identity_documents to authenticated;

drop policy if exists identity_documents_read on public.identity_documents;
create policy identity_documents_read on public.identity_documents for select to authenticated
using (private.can_read_identity_document(id));
drop policy if exists afhomes_customer_ids_read on storage.objects;
create policy afhomes_customer_ids_read on storage.objects for select to authenticated
using (bucket_id='afhomes-customer-ids' and private.can_read_identity_object(bucket_id,name));
drop policy if exists afhomes_ost_ids_read on storage.objects;
create policy afhomes_ost_ids_read on storage.objects for select to authenticated
using (bucket_id='afhomes-ost-ids' and private.can_read_identity_object(bucket_id,name));
