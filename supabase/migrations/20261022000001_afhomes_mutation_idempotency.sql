-- Durable request-level creation retries and atomic identity review. Forward-only.
-- Validation: run supabase/security/rls_invariants.sql (zero violations).
-- SELECT count(*) FROM private.mutation_requests WHERE result_identifier IS NULL; -- 0
-- SELECT actor_id,operation,request_id,count(*) FROM private.mutation_requests
-- GROUP BY 1,2,3 HAVING count(*) > 1; -- zero rows
-- Down: retire the new API/RPC callers in a later migration before removing these
-- functions/table. Never delete business records or rewrite the prior allocator.
create table if not exists private.mutation_requests (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.staff_users(id) on delete restrict,
  operation text not null check (operation in ('payment.create','application.create','reservation.create')),
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result_identifier uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_id,operation,request_id)
);
alter table private.mutation_requests enable row level security;
revoke all on private.mutation_requests from public,anon,authenticated,service_role;

-- Resolve the same active role/module/deny-only model for a SERVER-derived actor.
-- No caller-supplied role, hash, request UUID or Auth metadata authorizes a write.
create or replace function private.mutation_actor_role(p_actor uuid,p_module text,p_action text)
returns text language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_role text;
begin
  select r.slug into v_role
  from public.staff_users s
  join public.staff_role_assignments a on a.staff_id=s.id
  join public.roles r on r.id=a.role_id and r.is_active
  join public.modules m on m.key=p_module and m.is_active
  left join public.role_permissions rp on rp.role_id=r.id and rp.module_id=m.id
  left join public.staff_permission_restrictions deny on deny.staff_id=s.id and deny.module_id=m.id
  where s.id=p_actor and s.status='active' and not coalesce(deny.deny_view,false)
    and case p_action
      when 'view' then (r.slug='super_admin' or coalesce(rp.can_view,false))
      when 'create' then (r.slug='super_admin' or coalesce(rp.can_create,false)) and not coalesce(deny.deny_create,false)
      when 'update' then (r.slug='super_admin' or coalesce(rp.can_update,false)) and not coalesce(deny.deny_update,false)
      else false end;
  if v_role is null then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
  return v_role;
end $$;

-- JSONB text has deterministic object-key ordering. Only the SHA-256 fingerprint
-- is retained, never the payload/PII. Advisory-hash collisions merely serialize
-- unrelated requests; the exact composite unique key remains authoritative.
-- No placeholder row is committed: the result row is inserted AFTER a successful
-- business write and audit, inside the same RPC transaction.
create or replace function private.normalized_mutation_json(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,private,pg_temp as $$
begin
  if jsonb_typeof(p_value)='object' then
    return coalesce((select jsonb_object_agg(key,private.normalized_mutation_json(value))
      from jsonb_each(p_value) where value<>'null'::jsonb
        and (jsonb_typeof(value)<>'string' or btrim(value#>>'{}')<>'')), '{}'::jsonb);
  elsif jsonb_typeof(p_value)='array' then
    return coalesce((select jsonb_agg(private.normalized_mutation_json(value) order by ordinality)
      from jsonb_array_elements(p_value) with ordinality), '[]'::jsonb);
  elsif jsonb_typeof(p_value)='string' then return to_jsonb(btrim(p_value#>>'{}'));
  end if;
  return p_value;
end $$;
create or replace function private.mutation_result(p_actor uuid,p_operation text,p_request uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_prior private.mutation_requests%rowtype; v_hash text;
begin
  if p_request is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_hash:=encode(digest(private.normalized_mutation_json(p_payload)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_operation||':'||p_request::text,0));
  select * into v_prior from private.mutation_requests
    where actor_id=p_actor and operation=p_operation and request_id=p_request;
  if found then
    if v_prior.payload_hash<>v_hash then raise exception 'MUTATION_PAYLOAD_CONFLICT' using errcode='P0001'; end if;
    return v_prior.result_identifier;
  end if;
  return null;
end $$;

create or replace function private.complete_mutation(p_actor uuid,p_operation text,p_request uuid,p_payload jsonb,p_result uuid)
returns void language sql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
  insert into private.mutation_requests(actor_id,operation,request_id,payload_hash,result_identifier)
  values(p_actor,p_operation,p_request,encode(digest(private.normalized_mutation_json(p_payload)::text,'sha256'),'hex'),p_result);
$$;

create or replace function public.record_card_payment_once(
  p_request_id uuid,p_sale_id uuid,p_amount text,p_payment_type text,p_method text,
  p_reference text,p_notes text,p_receipt_storage_path text,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_payload jsonb; v_result uuid; v_reference text:=nullif(btrim(p_reference),'');
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  v_payload:=jsonb_build_object('saleId',p_sale_id,'amount',private.money(p_amount::numeric),
    'paymentType',p_payment_type,'method',btrim(p_method),'reference',v_reference,
    'notes',nullif(btrim(p_notes),''),'receiptStoragePath',nullif(btrim(p_receipt_storage_path),''));
  v_result:=private.mutation_result(p_actor_id,'payment.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  -- Existing RPC contains the business write AND PAYMENT_RECORDED audit.
  v_result:=public.record_card_payment(p_sale_id,private.money(p_amount::numeric),p_payment_type,
    btrim(p_method),v_reference,nullif(btrim(p_notes),''),nullif(btrim(p_receipt_storage_path),''),p_actor_id);
  perform private.complete_mutation(p_actor_id,'payment.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

create or replace function public.create_customer_application_once(
  p_request_id uuid,p_actor_id uuid,p_header jsonb,p_primary jsonb,p_secondary jsonb default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_payload jsonb; v_result uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','create');
  v_payload:=jsonb_build_object('header',jsonb_strip_nulls(p_header),'primary',jsonb_strip_nulls(p_primary),'secondary',jsonb_strip_nulls(p_secondary));
  v_result:=private.mutation_result(p_actor_id,'application.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  v_result:=public.save_customer_application(null,p_actor_id,p_header,p_primary,p_secondary);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'CUSTOMER_APPLICATION_CREATED','customer_application',v_result::text,'{"status":"draft"}');
  perform private.complete_mutation(p_actor_id,'application.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

create or replace function public.create_reservation_agreement_once(
  p_request_id uuid,p_actor_id uuid,p_input jsonb,p_primary jsonb,p_secondary jsonb default null,p_schedule jsonb default '[]'
) returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_payload jsonb; v_result uuid; v_sale public.card_sales%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  select * into v_sale from public.card_sales where id=(p_input->>'saleId')::uuid;
  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  if v_sale.seller_staff_id is distinct from p_actor_id and v_sale.seller_ost_id is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  end if;
  v_payload:=jsonb_build_object('input',jsonb_strip_nulls(p_input),'primary',jsonb_strip_nulls(p_primary),
    'secondary',jsonb_strip_nulls(p_secondary),'schedule',p_schedule);
  v_result:=private.mutation_result(p_actor_id,'reservation.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  v_result:=public.save_reservation_agreement(null,p_actor_id,p_input,p_primary,p_secondary,p_schedule);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'RESERVATION_AGREEMENT_CREATED','reservation_agreement',v_result::text,'{"status":"draft"}');
  perform private.complete_mutation(p_actor_id,'reservation.create',p_request_id,v_payload,v_result);
  return v_result;
end $$;

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
  -- Same sanitizer as the handler: values trim, keys limited, no metadata input.
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
  -- Flag only; never enforce a new government-ID uniqueness/business rule.
  -- Canonical current rule: newest persisted non-rejected ID, scoped to subject,
  -- never reviewed_at. Sellers may see owned subjects or their own uploads only.
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

-- New private helpers have no PUBLIC/browser/service direct execution; only
-- the four server-only RPCs invoke them as owner. No private schema usage added.
revoke all on function private.mutation_actor_role(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function private.mutation_result(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.complete_mutation(uuid,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function private.normalized_mutation_json(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.record_card_payment_once(uuid,uuid,text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.create_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.create_reservation_agreement_once(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.review_identity_document(uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.record_card_payment_once(uuid,uuid,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.create_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.create_reservation_agreement_once(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.review_identity_document(uuid,uuid,text,jsonb,text,text) to service_role;
