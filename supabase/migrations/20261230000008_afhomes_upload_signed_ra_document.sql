-- AF Homes: Function to upload signed RA document with real file metadata.
-- Validation: reservation-purchase-integration.ts, official-forms-transitions.spec.ts
-- Down: forward repair only. Restore from backup if needed.
begin;

create or replace function public.upload_signed_ra_document(
  p_request_id uuid, p_agreement_id uuid,
  p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes bigint, p_sha256 text
) returns void language plpgsql security definer
set search_path=pg_catalog,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype;
  v_doc_id uuid;
  v_customer_id uuid;
begin
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;

  select * into v_res from public.reservation_agreements where id=p_agreement_id;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;
  if v_res.status<>'submitted' then raise exception 'AGREEMENT_NOT_IN_SUBMITTED_STATUS' using errcode='55000'; end if;

  -- Validate file metadata
  if p_storage_path is null or p_storage_path = '' then raise exception 'STORAGE_PATH_REQUIRED' using errcode='22023'; end if;
  if p_original_filename is null or p_original_filename = '' then raise exception 'ORIGINAL_FILENAME_REQUIRED' using errcode='22023'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png') then raise exception 'INVALID_MIME_TYPE' using errcode='22023'; end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then raise exception 'INVALID_FILE_SIZE' using errcode='22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SHA256' using errcode='22023'; end if;

  v_customer_id := v_res.customer_id;
  v_doc_id := gen_random_uuid();

  insert into public.identity_documents (id, subject_type, customer_id, storage_path, original_filename, mime_type, size_bytes, sha256, reviewed_at, reviewed_by)
  values (v_doc_id, 'customer', v_customer_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, p_sha256, now(), (current_setting('request.jwt.claims', true)::json->>'sub')::uuid);

  insert into public.reservation_agreement_signed_documents (id, agreement_id, identity_document_id, signed_by, signed_at)
  values (gen_random_uuid(), p_agreement_id, v_doc_id, (current_setting('request.jwt.claims', true)::json->>'sub')::uuid, now());
end $$;

revoke all on function public.upload_signed_ra_document(uuid,uuid,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.upload_signed_ra_document(uuid,uuid,text,text,text,bigint,text) to service_role;

notify pgrst,'reload schema';
commit;