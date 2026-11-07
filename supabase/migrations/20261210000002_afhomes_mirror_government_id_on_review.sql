-- ============================================================================
-- Mirror reviewed government ID onto the customer record
--
-- PROBLEM
--   `review_identity_document` stores the reviewed id type/number on the
--   identity document and flags duplicates, but never writes them back to
--   `customers`. The customer detail page reads `government_id_type` /
--   `government_id_number` (masked), so an ID that was uploaded and reviewed
--   during an application still shows "Not Recorded".
--
-- FIX
--   On a confirmed review of a customer document, coalesce-copy the reviewed
--   id type and the supplied id number onto the customer row. Coalesce-only:
--   never overwrite a value already on the customer, and skip when the number
--   is already held by another customer (duplicate flag) to avoid a unique
--   violation.
--
-- IDEMPOTENCE
--   Coalesce-only; safe to re-run.
-- ============================================================================

create or replace function public.review_identity_document(
  p_document_id uuid,p_actor_id uuid,p_decision text,p_fields jsonb,p_notes text default null,p_id_number text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_doc public.identity_documents%rowtype; v_role text; v_owned boolean:=false;
  v_fields jsonb; v_notes text:=nullif(btrim(p_notes),''); v_now timestamptz:=now();
  v_duplicate boolean:=false; v_current uuid; v_changed boolean; v_before text;
begin
  select * into v_doc from public.identity_documents where id=p_document_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  v_role:=private.mutation_actor_role(p_actor_id,
    case v_doc.subject_type when 'customer' then 'sales.id_documents' else 'network.ost_registrations' end,'view');
  if v_doc.subject_type='customer' then
    select exists(select 1 from public.customers where id=v_doc.customer_id and created_by=p_actor_id) into v_owned;
  else
    select exists(select 1 from public.ost_applications where id=v_doc.ost_application_id and sponsor_staff_id=p_actor_id) into v_owned;
  end if;
  if v_role in ('vice_director','senior_sales_manager','sales_manager','ost') and not v_owned
    and v_doc.uploaded_by is distinct from p_actor_id then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('confirmed','rejected') or jsonb_typeof(p_fields) is distinct from 'object'
    then raise exception 'INVALID_DOCUMENT_REVIEW' using errcode='22023'; end if;
  select jsonb_object_agg(key,case when value='null'::jsonb then 'null'::jsonb else to_jsonb(left(btrim(value#>>'{}'),200)) end)
    into v_fields from jsonb_each(p_fields)
    where key ~ '^[A-Za-z][A-Za-z0-9_ ]{0,39}$' and jsonb_typeof(value) in ('string','null');
  if v_fields is null then raise exception 'INVALID_DOCUMENT_REVIEW' using errcode='22023'; end if;
  v_fields:=coalesce(v_doc.reviewed_data->'fields','{}'::jsonb)||v_fields;
  if p_decision='confirmed' and p_id_number is not null then
    select exists(select 1 from public.customers c where c.government_id_number=p_id_number) into v_duplicate;
  end if;
  v_changed:=v_doc.verification_status is distinct from p_decision
    or coalesce(v_doc.reviewed_data->'fields','{}'::jsonb) is distinct from v_fields
    or nullif(btrim(v_doc.reviewed_data->>'notes'),'') is distinct from v_notes;
  if v_changed then
    v_before:=v_doc.verification_status;
    update public.identity_documents set verification_status=p_decision,
      reviewed_data=jsonb_build_object('fields',v_fields,'confirmedAt',v_now,'confirmedBy',p_actor_id,'notes',v_notes),
      reviewed_by=p_actor_id,reviewed_at=v_now where id=p_document_id returning * into v_doc;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
      values(p_actor_id,case p_decision when 'confirmed' then 'IDENTITY_DOCUMENT_CONFIRMED' else 'IDENTITY_DOCUMENT_REJECTED' end,
        'identity_document',p_document_id::text,jsonb_build_object('verificationStatus',v_before),
        jsonb_build_object('documentId',p_document_id,'decision',p_decision,'possibleDuplicate',case when p_decision='confirmed' then v_duplicate else null end));
  end if;
  -- Mirror the reviewed ID onto the customer record (coalesce-only).
  if v_doc.subject_type='customer' and p_decision='confirmed' and not v_duplicate then
    update public.customers c
       set government_id_type = coalesce(c.government_id_type, nullif(v_fields->>'idType','')),
           government_id_number = coalesce(c.government_id_number, nullif(p_id_number,''))
     where c.id = v_doc.customer_id;
  end if;
  select d.id into v_current from public.identity_documents d
    where d.subject_type=v_doc.subject_type
      and ((v_doc.subject_type='customer' and d.customer_id=v_doc.customer_id)
        or (v_doc.subject_type='ost_application' and d.ost_application_id=v_doc.ost_application_id))
      and d.storage_path<>'' and d.sha256 ~ '^[0-9a-f]{64}$' and d.sha256<>repeat('0',64)
      and d.verification_status<>'rejected'
      and (v_role not in ('vice_director','senior_sales_manager','sales_manager','ost') or v_owned or d.uploaded_by=p_actor_id)
    order by d.created_at desc,d.id desc limit 1;
  return jsonb_build_object('document',to_jsonb(v_doc),'isCurrent',coalesce(v_current=p_document_id,false),
    'possibleDuplicate',case when p_decision='confirmed' then v_duplicate else null end);
end $$;

revoke all on function public.review_identity_document(uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.review_identity_document(uuid,uuid,text,jsonb,text,text) to service_role;