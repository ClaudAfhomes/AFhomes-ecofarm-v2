-- AF Homes: purchase workflow integrity repair (forward, corrective).
--
-- The 20261230*/2026123000014..22 batch was never applied to a shared database.
-- It contained production-unsafe shortcuts that this migration supersedes:
--   * user-settable GUC bypasses (afhomes.test_mode, afhomes.allow_mutation_test_cleanup)
--     that skipped receipt evidence, authorization and identifier immutability
--     (and, because current_setting(..,true) is NULL when unset, the storage-object
--     check never ran at all in production);
--   * ON DELETE CASCADE / SET NULL on signed documents, commission records,
--     application history, purchase evidence and the official RA ledger;
--   * a government ID accepted as the "signed application", a signed-RA upload
--     that marked itself reviewed, overpayment silently capped at verification,
--     VIP issuance failures swallowed, a dual SM+OST commission table nothing read,
--     Finance/Admin accepted as sellers of record, and an activation rewrite that
--     dropped the legacy-document guard and the points-period logic.
-- Rules implemented (product-owner workflow, 10 Nov 2026):
--   origination by module permission (never OST) with an ACTIVE SM always the
--   seller of record (amended 11 Nov 2026: Admins may originate for an SM);
--   RA created atomically at submission; approval needs an
--   ACCEPTED signed Customer Application in private storage; RA execution needs an
--   ACCEPTED signed RA; Finance records/verifies each payment against a real
--   receipt object; overpayment refused at recording (verified + pending) and at
--   verification; VIP Card ID exactly once at the first verified contractual
--   payment (fail closed); 40% commission eligibility recorded once; activation
--   requires full verified settlement and reuses the VIP Card ID.
--   Sale-origin record/verify_card_payment obey the same receipt, Finance and overpayment rules (section 16).
-- Validation: pnpm test:db:local (sections 4b, 7b, 55-79), pnpm test:db:external-import,
--   supabase/security/rls_invariants.sql (empty = PASS).
-- Pre-flight (section 24 refuses to apply with RECEIPT_DUPLICATES_PRESENT while this
--   returns rows; resolve each by hand, never by script):
--   select receipt_storage_path, count(*) from public.payments
--    where receipt_storage_path is not null and status not in ('rejected','voided')
--    group by 1 having count(*) > 1;
-- Down: forward repair only. Never delete issued identifiers or financial rows.
begin;

-- ---------------------------------------------------------------------------
-- 1. Remove production-reachable test bypasses
-- ---------------------------------------------------------------------------
create or replace function private.mutation_actor_role(p_actor uuid,p_module text,p_action text)
returns text language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_role text;
begin
 if p_action not in ('view','create','update') or not private.has_permission_for_user(p_actor,p_module,p_action) then
   raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
 end if;
 select r.slug into v_role from public.staff_role_assignments a
 join public.roles r on r.id=a.role_id and r.is_active where a.staff_id=p_actor;
 return v_role;
end $$;
revoke all on function private.mutation_actor_role(uuid,text,text) from public,anon,authenticated,service_role;
drop function if exists private.mutation_test_cleanup_allowed();

-- Owner-only, transaction-local, DELETE-only. The table owner can already drop
-- these tables, so this grants nothing an API role could reach.
create or replace function private.purchase_test_cleanup_allowed(p_table regclass)
returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
  select (current_setting('afhomes.allow_purchase_test_cleanup', true) = 'on'
          or current_setting('afhomes.allow_customer_purge', true) = 'on')
    and current_user = pg_get_userbyid(c.relowner)
  from pg_class c where c.oid = p_table;
$$;
revoke all on function private.purchase_test_cleanup_allowed(regclass) from public, anon, authenticated, service_role;

create or replace function private.prevent_purchase_evidence_mutation() returns trigger
language plpgsql set search_path=pg_catalog,private,pg_temp as $$
begin
  if tg_op='DELETE' and private.purchase_test_cleanup_allowed(tg_relid) then return old; end if;
  if tg_table_name='customer_application_purchase_terms' then
    raise exception 'PURCHASE_TERMS_IMMUTABLE' using errcode='55000';
  end if;
  raise exception 'PURCHASE_DOCUMENT_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function private.prevent_purchase_evidence_mutation() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Non-destructive foreign keys on history and evidence
-- ---------------------------------------------------------------------------
alter table public.customer_applications
  drop constraint if exists customer_applications_sale_id_fkey,
  add constraint customer_applications_sale_id_fkey
    foreign key (sale_id) references public.card_sales(id) on delete restrict;
alter table private.purchase_document_evidence
  drop constraint if exists purchase_document_evidence_sale_id_fkey,
  add constraint purchase_document_evidence_sale_id_fkey
    foreign key (sale_id) references public.card_sales(id) on delete restrict;

-- The official RA ledger is permanent: no FK, so deleting or cancelling a
-- reservation can never release, cascade-delete or reuse an issued number.
alter table private.official_ra_issuances
  drop constraint if exists official_ra_issuances_reservation_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Official RA number immutability
-- ---------------------------------------------------------------------------
create or replace function private.protect_official_ra() returns trigger
 language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
 begin
  if tg_op='UPDATE' then
   if new.reservation_number is not distinct from old.reservation_number then return new; end if;
   -- Only the approved one-time legacy conversion may rename, and only a
   -- non-official legacy value to AF-RES whose durable alias is already written.
   -- An official YYYY-NNNN number can never change.
   if old.reservation_number !~ '^[0-9]{4}-[0-9]{4}$'
      and new.reservation_number ~ '^AF-RES-[A-HJ-NP-Z2-9]{5}$'
      and exists(select 1 from private.business_id_aliases a
                  where a.entity_type='reservation_agreement' and a.entity_id=old.id
                    and a.is_active and a.old_identifier=old.reservation_number) then
    return new;
   end if;
   raise exception 'OFFICIAL_RA_NUMBER_IMMUTABLE' using errcode='55000';
  end if;
  new.reservation_number:=private.allocate_official_ra(new.id,clock_timestamp());
  return new;
 end $$;
revoke all on function private.protect_official_ra() from public,anon,authenticated,service_role;

create or replace function private.reject_official_ra_history_change() returns trigger
 language plpgsql set search_path=pg_catalog,pg_temp as $$
 begin
  -- Disposable-database teardown only: owner + transaction-local flag + DELETE.
  if tg_op='DELETE' and current_setting('afhomes.allow_purchase_test_cleanup', true) = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = tg_relid) then
   return old;
  end if;
  raise exception 'OFFICIAL_RA_ISSUANCE_IMMUTABLE' using errcode='55000';
 end $$;
revoke all on function private.reject_official_ra_history_change() from public,anon,authenticated,service_role;

-- High-water marks: an annual number that already exists can never be issued again.
insert into private.official_ra_sequences(issue_year,last_sequence)
select left(r.reservation_number,4)::int, max(right(r.reservation_number,4)::int)
  from public.reservation_agreements r
 where r.reservation_number ~ '^[0-9]{4}-[0-9]{4}$'
 group by 1
on conflict (issue_year) do update
  set last_sequence = greatest(private.official_ra_sequences.last_sequence, excluded.last_sequence);

-- ---------------------------------------------------------------------------
-- 4. Seller of record: an ACTIVE SM is always the seller of record; oversight never re-resolves it
-- ---------------------------------------------------------------------------
-- Restored original (pre-batch) resolver. Finance is never a seller of record.
create or replace function private.purchase_seller_for(p_actor uuid,p_candidate uuid)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_status text; v_role text;
begin
  if p_candidate is null or p_candidate=p_actor then
    select su.status,private.staff_role_slug(su.id) into v_status,v_role
      from public.staff_users su where su.id=p_actor;
    if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
    if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin') then
      raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
    end if;
    return p_actor;
  end if;
  select su.status,private.staff_role_slug(su.id) into v_status,v_role
    from public.staff_users su where su.id=p_candidate;
  if not found then raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501'; end if;
  if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
  if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin') then
    raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
  end if;
  if private.staff_role_slug(p_actor) is distinct from 'super_admin' and not exists(
    select 1 from public.referral_relationships r where r.is_active
      and r.subject_staff_id=p_candidate and r.upline_staff_id=p_actor) and not exists(
    select 1 from public.referral_relationships child
      join public.referral_relationships grandchild on grandchild.upline_staff_id=child.subject_staff_id
     where child.is_active and grandchild.is_active
       and child.upline_staff_id=p_actor and grandchild.subject_staff_id=p_candidate) then
    raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501';
  end if;
  return p_candidate;
end $$;
revoke all on function private.purchase_seller_for(uuid,uuid) from public, anon, authenticated, service_role;

-- New origination (product owner, 11 Nov 2026). WHO may create is the module
-- permission, checked by the caller through private.mutation_actor_role; OST and
-- inactive accounts never originate. The seller of record is always an ACTIVE
-- Sales Manager: an SM creator is the seller; any other creator names the SM.
-- Admin, Super Admin and Finance may name any active SM; other roles only an SM
-- in their downline. Mirrors resolveSeller() in api/_lib/commerce.ts.
create or replace function private.resolve_originating_seller(p_actor uuid,p_candidate uuid)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_status text; v_role text; v_c_status text; v_c_role text;
begin
  select su.status,private.staff_role_slug(su.id) into v_status,v_role from public.staff_users su where su.id=p_actor;
  if v_status is distinct from 'active' or v_role is null or v_role='ost' then
    raise exception 'SALE_ORIGINATION_FORBIDDEN' using errcode='42501';
  end if;
  if v_role='sales_manager' then
    if p_candidate is not null and p_candidate<>p_actor then
      raise exception 'SELLER_OF_RECORD_MUST_BE_CREATOR' using errcode='42501';
    end if;
    return p_actor;
  end if;
  if p_candidate is null or p_candidate=p_actor then
    raise exception 'SELLER_OF_RECORD_REQUIRED' using errcode='22023';
  end if;
  select su.status,private.staff_role_slug(su.id) into v_c_status,v_c_role
    from public.staff_users su where su.id=p_candidate;
  if not found then raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501'; end if;
  if v_c_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
  if v_c_role is distinct from 'sales_manager' then
    raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
  end if;
  if v_role not in ('admin','super_admin','finance') and not exists(
    select 1 from public.referral_relationships r where r.is_active
      and r.subject_staff_id=p_candidate and r.upline_staff_id=p_actor) and not exists(
    select 1 from public.referral_relationships child
      join public.referral_relationships grandchild on grandchild.upline_staff_id=child.subject_staff_id
     where child.is_active and grandchild.is_active
       and child.upline_staff_id=p_actor and grandchild.subject_staff_id=p_candidate) then
    raise exception 'SELLER_NOT_IN_YOUR_DOWNLINE' using errcode='42501';
  end if;
  return p_candidate;
end $$;
revoke all on function private.resolve_originating_seller(uuid,uuid) from public, anon, authenticated, service_role;

-- Oversight (approval, reservation, finalization) validates the FROZEN seller of
-- record itself. It never substitutes or re-resolves the seller against the actor,
-- so a Finance or Admin actor can complete an SM sale without becoming its seller.
create or replace function private.validate_frozen_seller(p_seller uuid)
returns void language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_status text; v_role text;
begin
  select su.status,private.staff_role_slug(su.id) into v_status,v_role from public.staff_users su where su.id=p_seller;
  if not found then raise exception 'SELLER_NOT_FOUND' using errcode='42501'; end if;
  if v_status is distinct from 'active' then raise exception 'SELLER_INACTIVE' using errcode='42501'; end if;
  if v_role is null or v_role not in ('ost','sales_manager','senior_sales_manager','vice_director','admin','super_admin') then
    raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
  end if;
end $$;
revoke all on function private.validate_frozen_seller(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Remove dead or unsafe batch objects (fail closed if any holds data)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.commission_records') is not null
     and exists(select 1 from public.commission_records) then
    raise exception 'COMMISSION_RECORDS_NOT_EMPTY: migrate rows before removal';
  end if;
  if to_regclass('public.reservation_agreement_signed_documents') is not null
     and exists(select 1 from public.reservation_agreement_signed_documents) then
    raise exception 'SIGNED_RA_DOCUMENTS_NOT_EMPTY: migrate rows before removal';
  end if;
end $$;
drop function if exists public.request_commission_payout(uuid,uuid,uuid,text);
drop function if exists private.update_commission_cumulative(uuid,uuid);
drop function if exists private.create_commission_records(uuid,uuid);
drop table if exists public.commission_records;
drop function if exists public.upload_signed_ra_document(uuid,uuid,text,text,text,bigint,text);
drop table if exists public.reservation_agreement_signed_documents;
-- Unwired duplicate of submit_purchase_application_once that accepted a
-- government ID as the signed application.
drop function if exists public.submit_customer_application_once(uuid,uuid,uuid,text,uuid);
-- Activation never issues a VIP Card ID; issuance happens once at verification.
drop function if exists private.issue_vip_on_activation(uuid,uuid,timestamptz);
drop function if exists private.check_commission_40pct_eligibility(text,text);

-- ---------------------------------------------------------------------------
-- 6. Signed purchase documents (signed Customer Application, signed RA)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('afhomes-signed-documents','afhomes-signed-documents',false,10485760,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

create table if not exists public.purchase_signed_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('signed_customer_application','signed_reservation_agreement')),
  application_id uuid not null references public.customer_applications(id) on delete restrict,
  reservation_id uuid references public.reservation_agreements(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  storage_bucket text not null default 'afhomes-signed-documents' check (storage_bucket='afhomes-signed-documents'),
  storage_path text not null unique check (length(storage_path) between 1 and 300),
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review','accepted','rejected')),
  uploaded_by uuid not null references public.staff_users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.staff_users(id) on delete restrict,
  reviewed_at timestamptz,
  review_notes text,
  check ((kind='signed_reservation_agreement') = (reservation_id is not null)),
  check ((status='pending_review') = (reviewed_by is null and reviewed_at is null)),
  check (status<>'rejected' or length(btrim(coalesce(review_notes,''))) >= 5)
);
-- One live (pending or accepted) document per kind per application/reservation.
create unique index if not exists purchase_signed_documents_live_unique
  on public.purchase_signed_documents (kind, coalesce(reservation_id, application_id))
  where status in ('pending_review','accepted');
create index if not exists purchase_signed_documents_application_idx on public.purchase_signed_documents (application_id);
create index if not exists purchase_signed_documents_reservation_idx on public.purchase_signed_documents (reservation_id);
alter table public.purchase_signed_documents enable row level security;
-- Staff-only and unexposed: every read and write goes through authorized server APIs.
revoke all on public.purchase_signed_documents from public, anon, authenticated;

-- Evidence is append-only: the only legal change is one review decision.
create or replace function private.guard_purchase_signed_document() returns trigger
language plpgsql set search_path=pg_catalog,private,pg_temp as $$
begin
  if tg_op='DELETE' then
    if private.purchase_test_cleanup_allowed(tg_relid) then return old; end if;
    raise exception 'SIGNED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;
  if old.status<>'pending_review'
     or row(new.id,new.kind,new.application_id,new.reservation_id,new.customer_id,new.storage_bucket,new.storage_path,
            new.original_filename,new.mime_type,new.size_bytes,new.sha256,new.uploaded_by,new.uploaded_at)
        is distinct from
        row(old.id,old.kind,old.application_id,old.reservation_id,old.customer_id,old.storage_bucket,old.storage_path,
            old.original_filename,old.mime_type,old.size_bytes,old.sha256,old.uploaded_by,old.uploaded_at) then
    raise exception 'SIGNED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.guard_purchase_signed_document() from public, anon, authenticated, service_role;
drop trigger if exists purchase_signed_document_guard on public.purchase_signed_documents;
create trigger purchase_signed_document_guard before update or delete on public.purchase_signed_documents
  for each row execute function private.guard_purchase_signed_document();

-- Register a file the browser already uploaded to the private bucket through an
-- authorized signed upload URL. The object must exist under the entity's own
-- prefix; no flag, filename or client boolean stands in for the file.
create or replace function public.register_purchase_signed_document_once(
  p_actor_id uuid, p_kind text, p_entity_id uuid, p_storage_path text,
  p_original_filename text, p_mime_type text, p_size_bytes bigint, p_sha256 text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_res public.reservation_agreements%rowtype;
  v_existing public.purchase_signed_documents%rowtype; v_id uuid; v_prefix text; v_path text;
begin
  v_path:=btrim(coalesce(p_storage_path,''));
  if p_kind='signed_customer_application' then
    perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
    select * into v_app from public.customer_applications where id=p_entity_id for update;
    if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
    if v_app.status not in ('draft','submitted') then raise exception 'APPLICATION_NOT_EDITABLE' using errcode='55000'; end if;
    v_prefix:='applications/'||v_app.id::text||'/';
  elsif p_kind='signed_reservation_agreement' then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
    select * into v_res from public.reservation_agreements where id=p_entity_id for update;
    if not found or v_res.origin<>'application' then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
    if v_res.status<>'submitted' then raise exception 'AGREEMENT_NOT_AWAITING_SIGNATURE' using errcode='55000'; end if;
    select * into v_app from public.customer_applications where id=v_res.customer_application_id;
    v_prefix:='reservations/'||v_res.id::text||'/';
  else
    raise exception 'SIGNED_DOCUMENT_KIND_INVALID' using errcode='22023';
  end if;
  if v_path='' or left(v_path,length(v_prefix))<>v_prefix or v_path ~ '\.\.' then
    raise exception 'SIGNED_DOCUMENT_PATH_INVALID' using errcode='22023';
  end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png') then raise exception 'INVALID_MIME_TYPE' using errcode='22023'; end if;
  if p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'INVALID_FILE_SIZE' using errcode='22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SHA256' using errcode='22023'; end if;
  if length(btrim(coalesce(p_original_filename,''))) not between 1 and 255 then raise exception 'ORIGINAL_FILENAME_REQUIRED' using errcode='22023'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='afhomes-signed-documents' and o.name=v_path) then
    raise exception 'SIGNED_DOCUMENT_OBJECT_NOT_FOUND' using errcode='55000';
  end if;

  -- Idempotent retry: the same object for the same entity returns the same row.
  select * into v_existing from public.purchase_signed_documents d where d.storage_path=v_path;
  if found then
    if v_existing.kind<>p_kind or v_existing.application_id<>v_app.id
       or v_existing.reservation_id is distinct from v_res.id or v_existing.sha256<>p_sha256 then
      raise exception 'SIGNED_DOCUMENT_PATH_CONFLICT' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  insert into public.purchase_signed_documents(kind,application_id,reservation_id,customer_id,storage_path,
    original_filename,mime_type,size_bytes,sha256,uploaded_by)
  values(p_kind,v_app.id,v_res.id,v_app.customer_id,v_path,btrim(p_original_filename),p_mime_type,p_size_bytes,p_sha256,p_actor_id)
  returning id into v_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
  values(p_actor_id,'SIGNED_DOCUMENT_UPLOADED','purchase_signed_document',v_id::text,
    jsonb_build_object('kind',p_kind,'applicationId',v_app.id,'reservationId',v_res.id,
      'sha256',p_sha256,'sizeBytes',p_size_bytes,'mimeType',p_mime_type,'status','pending_review'));
  return v_id;
end $$;
revoke all on function public.register_purchase_signed_document_once(uuid,text,uuid,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.register_purchase_signed_document_once(uuid,text,uuid,text,text,text,bigint,text) to service_role;

-- An authorized reviewer accepts or rejects. The uploader never reviews their own file.
create or replace function public.review_purchase_signed_document_once(
  p_actor_id uuid, p_document_id uuid, p_decision text, p_notes text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_doc public.purchase_signed_documents%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_decision not in ('accepted','rejected') then raise exception 'INVALID_DECISION' using errcode='22023'; end if;
  select * into v_doc from public.purchase_signed_documents where id=p_document_id for update;
  if not found then raise exception 'SIGNED_DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_doc.status=p_decision and v_doc.reviewed_by=p_actor_id then return v_doc.id; end if;  -- replay
  if v_doc.status<>'pending_review' then raise exception 'SIGNED_DOCUMENT_ALREADY_REVIEWED' using errcode='55000'; end if;
  if v_doc.uploaded_by=p_actor_id then raise exception 'SIGNED_DOCUMENT_SELF_REVIEW' using errcode='42501'; end if;
  if p_decision='rejected' and length(btrim(coalesce(p_notes,'')))<5 then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode='22023';
  end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=v_doc.storage_bucket and o.name=v_doc.storage_path) then
    raise exception 'SIGNED_DOCUMENT_OBJECT_NOT_FOUND' using errcode='55000';
  end if;
  update public.purchase_signed_documents set status=p_decision, reviewed_by=p_actor_id, reviewed_at=now(),
    review_notes=nullif(btrim(coalesce(p_notes,'')),'') where id=v_doc.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,reason)
  values(p_actor_id,case when p_decision='accepted' then 'SIGNED_DOCUMENT_ACCEPTED' else 'SIGNED_DOCUMENT_REJECTED' end,
    'purchase_signed_document',v_doc.id::text,jsonb_build_object('status','pending_review'),
    jsonb_build_object('status',p_decision,'kind',v_doc.kind,'applicationId',v_doc.application_id,
      'reservationId',v_doc.reservation_id),nullif(btrim(coalesce(p_notes,'')),''));
  return v_doc.id;
end $$;
revoke all on function public.review_purchase_signed_document_once(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_purchase_signed_document_once(uuid,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Reservation creation: allowed from submission, frozen seller validated
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb)';
  r record;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  for r in select * from (values
    ($a$if v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;$a$,
     $b$if v_app.status not in ('submitted','approved') then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;$b$),
    ($a$perform private.purchase_seller_for(p_actor_id,v_terms.seller_staff_id);$a$,
     $b$perform private.validate_frozen_seller(v_terms.seller_staff_id);$b$),
    ($a$perform private.create_commission_records(v_id,p_actor_id);$a$, $b$$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'RESERVE_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;
revoke all on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Submission: permitted origination (SM seller of record), terms frozen, linked RA created atomically
-- ---------------------------------------------------------------------------
create or replace function public.submit_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text,
  p_seller_candidate uuid default null
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_seller uuid; v_proposal jsonb;
  v_payload jsonb; v_result uuid; v_version integer; v_terms_id uuid;
  v_res_id uuid; v_res_number text; v_today date:=(now() at time zone 'Asia/Manila')::date;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'expectedProposalHash',p_expected_hash,
    'sellerCandidateId',p_seller_candidate);
  v_result:=private.mutation_result(p_actor_id,'application.submit',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_app.status<>'draft' then raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='55000'; end if;

  -- Module permission checked above; the seller of record is always an ACTIVE SM.
  v_seller:=private.resolve_originating_seller(p_actor_id,p_seller_candidate);
  v_proposal:=private.purchase_terms_for_application(v_app.id,v_seller,'submission');
  if (v_proposal->>'expectedProposalHash') is distinct from p_expected_hash then
    raise exception 'PURCHASE_PROPOSAL_CHANGED' using errcode='55000';
  end if;

  select coalesce(max(version),0)+1 into v_version from public.customer_application_purchase_terms
    where application_id=v_app.id;
  insert into public.customer_application_purchase_terms(
    application_id,customer_id,plan_id,seller_staff_id,version,capture_kind,reason,captured_by,captured_at,
    tier,payment_scheme,total_price,reservation_fee,minimum_down_payment,required_initial,
    installment_months,monthly_amount,spot_cash_days,validity_months,discount_percent,yearly_points,
    annual_points_tranches,holder_limit,inclusions,commission_rule_id,commission_rate,commission_base,expected_commission)
  values(v_app.id,v_app.customer_id,v_app.plan_id,v_seller,v_version,'submission',null,p_actor_id,now(),
    v_proposal->'terms'->>'tier',v_proposal->'terms'->>'paymentScheme',v_proposal->'terms'->>'totalPrice',
    v_proposal->'terms'->>'reservationFee',v_proposal->'terms'->>'minimumDownPayment',
    v_proposal->'terms'->>'requiredInitial',(v_proposal->'terms'->>'installmentMonths')::integer,
    v_proposal->'terms'->>'monthlyAmount',(v_proposal->'terms'->>'spotCashDays')::integer,
    (v_proposal->'terms'->>'validityMonths')::integer,(v_proposal->'terms'->>'discountPercent')::integer,
    (v_proposal->'terms'->>'yearlyPoints')::integer,(v_proposal->'terms'->>'annualPointsTranches')::integer,
    (v_proposal->'terms'->>'holderLimit')::integer,v_proposal->'terms'->'inclusions',
    (v_proposal->'terms'->>'commissionRuleId')::uuid,v_proposal->'terms'->>'commissionRate',
    v_proposal->'terms'->>'commissionBase',v_proposal->'terms'->>'expectedCommission')
  returning id into v_terms_id;

  update public.customer_applications set purchase_terms_id=v_terms_id where id=v_app.id;
  perform public.submit_customer_application(v_app.id,p_actor_id);

  -- The linked official RA is created in the same transaction (draft). A retry
  -- replays through mutation_result above and can never create a second one.
  v_res_id:=public.reserve_application_purchase_once(
    md5(p_request_id::text||'-reserve')::uuid, p_actor_id, v_app.id, v_terms_id,
    jsonb_build_object('reservationDate',v_today,'agreementDate',v_today,'scheduleNotes','[]'::jsonb));
  select reservation_number into v_res_number from public.reservation_agreements where id=v_res_id;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,'CUSTOMER_APPLICATION_SUBMITTED','customer_application',v_app.id::text,
      jsonb_build_object('status','draft'),jsonb_build_object('status','submitted',
        'captureKind','submission','purchaseTermsId',v_terms_id,'termsVersion',v_version,
        'reservationId',v_res_id,'reservationNumber',v_res_number),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'application.submit',p_request_id,v_payload,v_app.id,
    jsonb_build_object('resultId',v_app.id,'status','submitted','purchaseTermsId',v_terms_id,'termsVersion',v_version,
      'reservationId',v_res_id,'reservationNumber',v_res_number));
  return v_app.id;
end $$;
revoke all on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8b. One seller-of-record rule for the proposal, submission and terms review.
-- A draft is a NEW origination (resolve_originating_seller). Any later stage
-- reuses the seller already frozen on the application's terms and never
-- re-resolves it against the acting reviewer; only an old application with no
-- terms at all falls back to the origination rule. This closes the review path
-- that let an OST/VD/SSM actor freeze themselves as seller via purchase_seller_for.
-- ---------------------------------------------------------------------------
create or replace function private.application_seller_of_record(
  p_application_id uuid, p_status text, p_actor uuid, p_candidate uuid
) returns uuid language plpgsql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_seller uuid;
begin
  if p_status is distinct from 'draft' then
    select t.seller_staff_id into v_seller from public.customer_application_purchase_terms t
     where t.application_id=p_application_id order by t.version desc limit 1;
  end if;
  if v_seller is null then return private.resolve_originating_seller(p_actor,p_candidate); end if;
  if p_candidate is not null and p_candidate<>v_seller then
    raise exception 'SELLER_OF_RECORD_FROZEN' using errcode='55000';
  end if;
  perform private.validate_frozen_seller(v_seller);
  return v_seller;
end $$;
revoke all on function private.application_seller_of_record(uuid,text,uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.purchase_terms_proposal(
  p_application_id uuid, p_actor_id uuid, p_seller_candidate uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_app public.customer_applications%rowtype; v_seller uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','view');
  select * into v_app from public.customer_applications where id=p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_app.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  end if;
  v_seller:=private.application_seller_of_record(v_app.id,v_app.status,p_actor_id,p_seller_candidate);
  return private.purchase_terms_for_application(p_application_id,v_seller,
    case when v_app.status='approved' then 'review' else 'submission' end);
end $$;
revoke all on function public.purchase_terms_proposal(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.purchase_terms_proposal(uuid,uuid,uuid) to service_role;

do $patch$
declare d text; sig text:='public.review_application_purchase_terms_once(uuid,uuid,uuid,text,text,uuid)';
  old text:=$a$v_seller:=private.purchase_seller_for(p_actor_id,p_seller_candidate);$a$;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  if position(old in d)=0 then raise exception 'REVIEW_TERMS_PATCH_DRIFT'; end if;
  execute replace(d,old,
    $b$v_seller:=private.application_seller_of_record(v_app.id,v_app.status,p_actor_id,p_seller_candidate);$b$);
end $patch$;
revoke all on function public.review_application_purchase_terms_once(uuid,uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.review_application_purchase_terms_once(uuid,uuid,uuid,text,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Application decision: approval requires an ACCEPTED signed application
-- ---------------------------------------------------------------------------
create or replace function public.decide_purchase_application_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_decision text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_app public.customer_applications%rowtype; v_payload jsonb; v_result uuid;
  v_allowed boolean; v_now timestamptz:=now(); v_notes text;
  v_res public.reservation_agreements%rowtype; v_receipt uuid; v_revision integer;
  v_today date:=(now() at time zone 'Asia/Manila')::date;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  if p_decision is null or p_decision not in ('approved','rejected','cancelled','draft') then
    raise exception 'INVALID_DECISION' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'decision',p_decision);
  v_result:=private.mutation_result(p_actor_id,'application.decide',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_app from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  v_allowed:=case v_app.status
    when 'draft' then p_decision='cancelled'
    when 'submitted' then p_decision in ('approved','rejected','cancelled','draft')
    when 'approved' then p_decision='cancelled'
    when 'rejected' then p_decision in ('draft','cancelled')
    else false end;
  if not v_allowed then raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='55000'; end if;
  if p_decision='approved' and v_app.purchase_terms_id is null then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;

  select * into v_res from public.reservation_agreements
   where customer_application_id=v_app.id and status<>'cancelled' for update;

  if p_decision='approved' then
    -- Genuine evidence: an uploaded, reviewed and ACCEPTED signed Customer
    -- Application stored in the private bucket. A government ID never counts.
    if not exists(select 1 from public.purchase_signed_documents d
                   join storage.objects o on o.bucket_id=d.storage_bucket and o.name=d.storage_path
                  where d.application_id=v_app.id and d.kind='signed_customer_application'
                    and d.status='accepted') then
      raise exception 'SIGNED_APPLICATION_DOCUMENT_REQUIRED' using errcode='55000';
    end if;
    if v_res.id is null then
      -- Applications submitted before RA-at-submission existed.
      perform public.reserve_application_purchase_once(md5(p_request_id::text||'-reserve')::uuid,
        p_actor_id,v_app.id,v_app.purchase_terms_id,
        jsonb_build_object('reservationDate',v_today,'agreementDate',v_today,'scheduleNotes','[]'::jsonb));
      select * into v_res from public.reservation_agreements
       where customer_application_id=v_app.id and status<>'cancelled' for update;
    end if;
  elsif v_res.id is not null then
    -- Rejection, re-opening or cancellation retires the unsigned draft RA. Its
    -- number stays consumed in the permanent ledger and is never reissued.
    if v_res.status<>'draft' then raise exception 'RESERVATION_ALREADY_EXISTS' using errcode='55000'; end if;
    update public.reservation_agreements set status='cancelled',updated_at=v_now where id=v_res.id;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
      values(p_actor_id,'RESERVATION_AGREEMENT_CANCELLED','reservation_agreement',v_res.id::text,
        jsonb_build_object('status','draft'),jsonb_build_object('status','cancelled','reason','application_'||p_decision),
        p_request_id::text);
  end if;

  update public.customer_applications set
    status=p_decision, updated_at=v_now,
    submitted_at=case when p_decision in ('approved','rejected') then coalesce(submitted_at,v_now) else submitted_at end,
    approved_at=case when p_decision='approved' then v_now else approved_at end,
    rejected_at=case when p_decision='rejected' then v_now else rejected_at end
   where id=v_app.id;

  if p_decision='approved' and v_res.status='draft' then
    -- The approved RA moves to "awaiting signed agreement". Execution is a
    -- separate step that needs an ACCEPTED signed RA.
    if (select count(*) from public.reservation_agreement_holders h
         where h.agreement_id=v_res.id and h.holder_type='PRIMARY')<>1 then
      raise exception 'PRIMARY_HOLDER_REQUIRED' using errcode='23514';
    end if;
    update public.reservation_agreements set status='submitted',submitted_at=coalesce(submitted_at,v_now),updated_at=v_now
     where id=v_res.id;
    select coalesce(max(d.revision),0)+1 into v_revision from private.purchase_document_evidence d
     where d.kind='reservation' and d.source_id=v_res.id;
    v_receipt:=private.append_purchase_document('reservation',v_res.id,v_revision,p_actor_id);
    insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
      values(p_actor_id,'RESERVATION_AGREEMENT_SUBMITTED','reservation_agreement',v_res.id::text,
        jsonb_build_object('status','draft'),jsonb_build_object('status','submitted','documentEvidenceId',v_receipt),
        p_request_id::text);
  end if;

  v_notes:=case p_decision when 'draft' then 'CUSTOMER_APPLICATION_REOPENED'
    when 'approved' then 'CUSTOMER_APPLICATION_APPROVED' when 'rejected' then 'CUSTOMER_APPLICATION_REJECTED'
    else 'CUSTOMER_APPLICATION_CANCELLED' end;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,v_notes,'customer_application',v_app.id::text,
      jsonb_build_object('status',v_app.status),
      jsonb_build_object('status',p_decision,'purchaseTermsId',v_app.purchase_terms_id,
        'reservationId',case when p_decision='approved' then v_res.id end),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'application.decide',p_request_id,v_payload,v_app.id,
    jsonb_build_object('resultId',v_app.id,'status',p_decision,'purchaseTermsId',v_app.purchase_terms_id,
      'reservationId',case when p_decision='approved' then v_res.id end));
  return v_app.id;
end $$;
revoke all on function public.decide_purchase_application_once(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.decide_purchase_application_once(uuid,uuid,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. RA transitions: execution requires an ACCEPTED signed RA
-- ---------------------------------------------------------------------------
create or replace function public.transition_purchase_reservation_once(
  p_request_id uuid, p_actor_id uuid, p_reservation_id uuid, p_action text, p_input jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_payload jsonb; v_result uuid; v_now timestamptz:=now(); v_status text; v_revision integer;
  v_receipt uuid; v_action text; v_item jsonb; v_line integer;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.card_sales','create');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_action:=coalesce(p_action,'');
  if v_action not in ('save','submit','execute','reopen','cancel') then
    raise exception 'INVALID_AGREEMENT_ACTION' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('reservationId',p_reservation_id,'action',v_action,
    'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'reservation.transition',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  select * into v_res from public.reservation_agreements where id=p_reservation_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.created_by is distinct from p_actor_id then
    perform private.mutation_actor_role(p_actor_id,'sales.card_sales','update');
  end if;
  if v_res.origin<>'application' then
    raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000';
  end if;
  select * into v_app from public.customer_applications where id=v_res.customer_application_id;
  if not found or v_app.status<>'approved' then
    raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000';
  end if;

  if v_action='save' then
    if v_res.status not in ('draft','submitted') then raise exception 'AGREEMENT_NOT_EDITABLE' using errcode='55000'; end if;
    update public.reservation_agreements set
      revision_number=coalesce(nullif(p_input->>'revisionNumber',''),revision_number),
      monthly_amortization_start=coalesce(nullif(p_input->>'monthlyAmortizationStart','')::date,monthly_amortization_start),
      monthly_amortization_end=coalesce(nullif(p_input->>'monthlyAmortizationEnd','')::date,monthly_amortization_end),
      payment_due_day=coalesce(nullif(p_input->>'paymentDueDay','')::integer,payment_due_day),
      updated_at=v_now
     where id=v_res.id;
    delete from public.reservation_agreement_schedule where agreement_id=v_res.id;
    v_line:=0;
    for v_item in select value from jsonb_array_elements(coalesce(p_input->'scheduleNotes','[]'::jsonb)) loop
      v_line:=v_line+1;
      insert into public.reservation_agreement_schedule(agreement_id,line_number,particular,amount_snapshot,payment_date,remarks)
      values(v_res.id,v_line,v_item->>'particular',private.money((v_item->>'amount')::numeric),
        nullif(v_item->>'paymentDate','')::date,nullif(v_item->>'remarks',''));
    end loop;
  elsif v_action='submit' then
    if v_res.status<>'draft' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    if (select count(*) from public.reservation_agreement_holders h
         where h.agreement_id=v_res.id and h.holder_type='PRIMARY')<>1 then
      raise exception 'PRIMARY_HOLDER_REQUIRED' using errcode='23514';
    end if;
    update public.reservation_agreements set status='submitted',submitted_at=coalesce(submitted_at,v_now),updated_at=v_now
     where id=v_res.id;
  elsif v_action='execute' then
    if v_res.status<>'submitted' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    if not exists(select 1 from public.purchase_signed_documents d
                   join storage.objects o on o.bucket_id=d.storage_bucket and o.name=d.storage_path
                  where d.reservation_id=v_res.id and d.kind='signed_reservation_agreement'
                    and d.status='accepted') then
      raise exception 'SIGNED_RA_DOCUMENT_REQUIRED' using errcode='55000';
    end if;
    update public.reservation_agreements set status='executed',executed_at=v_now,updated_at=v_now
     where id=v_res.id;
  elsif v_action='reopen' then
    if v_res.status<>'submitted' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    update public.reservation_agreements set status='draft',updated_at=v_now where id=v_res.id;
  elsif v_action='cancel' then
    if v_res.status='executed' then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    update public.reservation_agreements set status='cancelled',updated_at=v_now where id=v_res.id;
  end if;

  v_status:=case v_action when 'save' then v_res.status when 'submit' then 'submitted'
    when 'execute' then 'executed' when 'reopen' then 'draft' else 'cancelled' end;
  select coalesce(max(d.revision),0)+1 into v_revision from private.purchase_document_evidence d
   where d.kind='reservation' and d.source_id=v_res.id;
  v_receipt:=private.append_purchase_document('reservation',v_res.id,v_revision,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_actor_id,case v_action when 'submit' then 'RESERVATION_AGREEMENT_SUBMITTED'
      when 'execute' then 'RESERVATION_AGREEMENT_EXECUTED' when 'reopen' then 'RESERVATION_AGREEMENT_REOPENED'
      when 'cancel' then 'RESERVATION_AGREEMENT_CANCELLED' else 'RESERVATION_AGREEMENT_UPDATED' end,
      'reservation_agreement',v_res.id::text,
      jsonb_build_object('status',v_res.status),jsonb_build_object('status',v_status),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'reservation.transition',p_request_id,v_payload,v_res.id,
    jsonb_build_object('resultId',v_res.id,'status',v_status,'documentEvidenceId',v_receipt,'revision',v_revision));
  return v_res.id;
end $$;
revoke all on function public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Commission eligibility marker (40% of the frozen contract total)
-- ---------------------------------------------------------------------------
alter table public.reservation_agreements add column if not exists commission_eligible_at timestamptz;
alter table public.commissions add column if not exists eligible_at timestamptz;
comment on column public.reservation_agreements.commission_eligible_at is
  'Set once, at the verification that brings verified settlement to >= 40% of the frozen total. Never cleared.';
comment on column public.commissions.eligible_at is
  'When the 40% verified-settlement threshold was reached. Eligibility never pays: payout stays a separate authorized action.';

-- ---------------------------------------------------------------------------
-- 12. Reservation payments: Finance records each payment with a real receipt
-- ---------------------------------------------------------------------------
create or replace function private.require_payment_receipt_object(p_path text)
returns text language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v_path text:=btrim(coalesce(p_path,''));
begin
  if v_path='' then raise exception 'RECEIPT_STORAGE_PATH_REQUIRED' using errcode='22023'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='afhomes-payment-receipts' and o.name=v_path) then
    raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode='55000';
  end if;
  return v_path;
end $$;
revoke all on function private.require_payment_receipt_object(text) from public, anon, authenticated, service_role;

create or replace function public.record_reservation_payment_once(
  p_request_id uuid, p_reservation_id uuid, p_input jsonb, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_res public.reservation_agreements%rowtype; v_app public.customer_applications%rowtype;
  v_amount numeric; v_payment_id uuid; v_payload jsonb; v_result uuid; v_now timestamptz:=now();
  v_receipt uuid; v_verified numeric; v_pending numeric; v_price numeric; v_purpose text; v_type text;
  v_path text; v_verified_text text; v_balance text;
begin
  -- Finance records every payment, whatever its purpose.
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('reservationId',p_reservation_id,'input',jsonb_strip_nulls(p_input));
  v_result:=private.mutation_result(p_actor_id,'payment.create',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;

  -- PARENT FIRST: the reservation lock serializes every recording/verification
  -- for this purchase, so concurrent requests cannot jointly overpay.
  select * into v_res from public.reservation_agreements where id=p_reservation_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;
  if v_res.status<>'executed' then raise exception 'RESERVATION_NOT_EXECUTED' using errcode='55000'; end if;
  if v_res.finalized_at is not null then raise exception 'RESERVATION_FINALIZED' using errcode='55000'; end if;
  select * into v_app from public.customer_applications where id=v_res.customer_application_id;
  if not found or v_app.status<>'approved' then raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;

  if coalesce(p_input->>'amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode='22023';
  end if;
  v_amount:=(p_input->>'amount')::numeric;
  if v_amount<=0 then raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode='22023'; end if;

  v_purpose:=p_input->>'paymentPurpose';
  if v_purpose is null then raise exception 'PAYMENT_PURPOSE_REQUIRED' using errcode='22023'; end if;
  -- The ledger's payment_type is derived from the purpose, never chosen separately.
  v_type:=case v_purpose when 'reservation_fee' then 'installment' when 'contractual_down_payment' then 'down_payment'
    when 'contractual_installment' then 'installment' when 'contractual_full' then 'full' end;
  if v_type is null then raise exception 'INVALID_PAYMENT_PURPOSE' using errcode='22023'; end if;
  if p_input ? 'paymentType' and p_input->>'paymentType' is distinct from v_type then
    raise exception 'PAYMENT_TYPE_PURPOSE_MISMATCH' using errcode='22023';
  end if;

  v_path:=private.require_payment_receipt_object(p_input->>'receiptStoragePath');

  v_price:=v_res.total_price_snapshot::numeric;
  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0),
         coalesce(sum(pay.amount::numeric) filter (where pay.status='recorded'),0)
    into v_verified, v_pending
    from public.payments pay where pay.reservation_id=v_res.id;
  if v_verified>=v_price then raise exception 'PURCHASE_FULLY_PAID' using errcode='55000'; end if;
  -- Verified AND still-undecided money both count: a pending payment cannot be
  -- double-booked by a second recording.
  if v_verified+v_pending+v_amount>v_price then
    raise exception 'OVERPAYMENT_NOT_ALLOWED' using errcode='55000';
  end if;
  if v_purpose='reservation_fee' then
    if exists(select 1 from public.payments pay where pay.reservation_id=v_res.id
               and pay.payment_purpose='reservation_fee' and pay.status in ('recorded','verified')) then
      raise exception 'RESERVATION_FEE_ALREADY_RECORDED' using errcode='55000';
    end if;
    if v_amount>v_res.reservation_fee_snapshot::numeric then
      raise exception 'RESERVATION_FEE_EXCEEDS_TERMS' using errcode='55000';
    end if;
  elsif v_purpose='contractual_down_payment' then
    if exists(select 1 from public.payments pay where pay.reservation_id=v_res.id
               and pay.payment_purpose like 'contractual_%' and pay.status in ('recorded','verified')) then
      raise exception 'DOWN_PAYMENT_ALREADY_RECORDED' using errcode='55000';
    end if;
  elsif v_purpose='contractual_full' then
    if v_verified+v_pending+v_amount<>v_price then
      raise exception 'FULL_PAYMENT_MUST_SETTLE_BALANCE' using errcode='55000';
    end if;
  end if;

  insert into public.payments(
    sale_id,reservation_id,origin,customer_id,amount,payment_type,method,reference,notes,
    receipt_storage_path,payment_purpose,status,recorded_by,recorded_at)
  values(null,v_res.id,'reservation',v_res.customer_id,private.money(v_amount),v_type,p_input->>'method',
    nullif(btrim(coalesce(p_input->>'reference','')),''),nullif(coalesce(p_input->>'notes',''),''),
    v_path,v_purpose,'recorded',p_actor_id,v_now)
  returning id into v_payment_id;

  v_receipt:=private.append_purchase_document('payment_recorded',v_payment_id,1,p_actor_id);
  v_verified_text:=private.money(v_verified);
  v_balance:=private.money(greatest(v_price-v_verified,0));
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
    values(p_actor_id,'PAYMENT_RECORDED','payment',v_payment_id::text,
      jsonb_build_object('origin','reservation','reservationId',v_res.id,'amount',private.money(v_amount),
        'status','recorded','method',p_input->>'method','paymentPurpose',v_purpose,
        'verifiedTotal',v_verified_text,'remainingBalance',v_balance,'documentEvidenceId',v_receipt),
      p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'payment.create',p_request_id,v_payload,v_payment_id,
    jsonb_build_object('resultId',v_payment_id,'status','recorded','reservationId',v_res.id,
      'saleId',v_res.sale_id,'documentEvidenceId',v_receipt,
      'verifiedTotal',v_verified_text,'remainingBalance',v_balance));
  return v_payment_id;
end $$;
revoke all on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 13. Verification: never capped, VIP issuance fails closed, 40% eligibility
-- ---------------------------------------------------------------------------
create or replace function public.verify_purchase_payment_once(
  p_request_id uuid, p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare
  v_probe public.payments%rowtype; v_pay public.payments%rowtype;
  v_res public.reservation_agreements%rowtype; v_sale public.card_sales%rowtype;
  v_payload jsonb; v_result uuid; v_replay jsonb; v_return jsonb; v_now timestamptz:=now();
  v_verified_before numeric; v_verified_after numeric; v_price numeric; v_balance_before numeric;
  v_balance_after numeric; v_receipt uuid; v_rejected boolean; v_spot_cash_start timestamptz;
  v_deadline timestamptz; v_vip text; v_vip_issued boolean:=false; v_eligible boolean:=false;
  v_expected_commission text;
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  if p_decision is null or p_decision not in ('verified','rejected') then
    raise exception 'INVALID_DECISION' using errcode='22023';
  end if;
  v_rejected:=p_decision='rejected';
  if v_rejected and length(coalesce(btrim(p_reason),'')) < 5 then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('paymentId',p_payment_id,'decision',p_decision,
    'reason',nullif(btrim(coalesce(p_reason,'')),''));
  v_result:=private.mutation_result(p_actor_id,'payment.verify',p_request_id,v_payload);
  if v_result is not null then
    select r.result_receipt into v_replay from private.mutation_requests r
     where r.actor_id=p_actor_id and r.operation='payment.verify' and r.request_id=p_request_id;
    return v_replay;
  end if;

  select pay.* into v_probe from public.payments pay where pay.id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;

  if v_probe.origin='reservation' or v_probe.reservation_id is not null then
    select * into v_res from public.reservation_agreements where id=v_probe.reservation_id for update;
    if not found then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
    if v_res.origin<>'application' then raise exception 'RESERVATION_ORIGIN_INVALID' using errcode='55000'; end if;
    if v_res.finalized_at is not null then raise exception 'RESERVATION_FINALIZED' using errcode='55000'; end if;
    if v_res.sale_id is not null then
      select * into v_sale from public.card_sales where id=v_res.sale_id for update;
      if not found then raise exception 'SALE_NOT_FOUND' using errcode='P0002'; end if;
    end if;
    v_price:=v_res.total_price_snapshot::numeric;
    v_spot_cash_start:=v_res.spot_cash_started_at;
    v_deadline:=v_res.spot_cash_deadline;
  else
    select * into v_sale from public.card_sales where id=v_probe.sale_id for update;
    if not found then raise exception 'SALE_NOT_FOUND' using errcode='P0002'; end if;
    if v_sale.status in ('cancelled','active') then
      raise exception 'SALE_NOT_ACCEPTING_PAYMENTS:%', v_sale.status using errcode='55000';
    end if;
    v_price:=coalesce(v_sale.cash_price_snapshot,'0')::numeric;
    v_spot_cash_start:=v_sale.spot_cash_started_at;
    v_deadline:=v_sale.spot_cash_deadline;
  end if;

  select * into v_pay from public.payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_pay.status<>'recorded' then
    raise exception 'PAYMENT_NOT_PENDING:%', v_pay.status using errcode='55000';
  end if;
  -- The receipt object must still exist at the moment money is accepted.
  if not v_rejected then perform private.require_payment_receipt_object(v_pay.receipt_storage_path); end if;

  select coalesce(sum(pay.amount::numeric) filter (where pay.status='verified'),0)
    into v_verified_before
    from public.payments pay
   where (v_res.id is not null and pay.reservation_id=v_res.id)
      or (v_res.id is null and pay.sale_id=v_sale.id);
  v_verified_after:=v_verified_before+(case when v_rejected then 0 else v_pay.amount::numeric end);
  -- Never capped or rewritten: an amount that would exceed the frozen total is refused.
  if not v_rejected and v_verified_after>v_price then
    raise exception 'OVERPAYMENT_NOT_ALLOWED' using errcode='55000';
  end if;
  v_balance_before:=greatest(v_price-v_verified_before,0);
  v_balance_after:=v_price-v_verified_after;

  update public.payments set status=p_decision,
      verified_by=case when v_rejected then null else p_actor_id end,
      verified_at=case when v_rejected then null else v_now end,
      rejection_reason=case when v_rejected then btrim(p_reason) else null end
   where id=p_payment_id;

  if not v_rejected and v_verified_before=0 and v_spot_cash_start is null then
    v_spot_cash_start:=v_now;
    v_deadline:=v_now+(coalesce(v_res.spot_cash_days_snapshot,7)*interval '1 day');
    if v_res.id is not null then
      update public.reservation_agreements set spot_cash_started_at=v_spot_cash_start,
        spot_cash_deadline=v_deadline, updated_at=v_now where id=v_res.id;
    else
      update public.card_sales set spot_cash_started_at=v_spot_cash_start,
        spot_cash_deadline=v_deadline, updated_at=v_now where id=v_sale.id;
    end if;
  end if;

  if not v_rejected and v_res.id is not null then
    -- VIP Card ID: exactly once, at the first verified CONTRACTUAL payment, dated
    -- by this verification in Asia/Manila. Any failure aborts the verification.
    if v_pay.payment_purpose in ('contractual_down_payment','contractual_installment','contractual_full') then
      select c.vip_card_number into v_vip from public.customers c where c.id=v_res.customer_id;
      if v_vip is null then
        v_vip:=private.issue_vip_on_first_qualifying_payment(v_res.id,p_payment_id,v_now);
        v_vip_issued:=true;
        insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
          values(p_actor_id,'VIP_CARD_ID_ISSUED','customer',v_res.customer_id::text,
            jsonb_build_object('vipCardNumber',v_vip,'reservationId',v_res.id,'paymentId',p_payment_id,
              'verifiedAt',v_now),p_request_id::text);
      end if;
    end if;
    -- Commission eligibility: once, when verified settlement reaches 40%.
    if v_res.commission_eligible_at is null and v_verified_after*100>=v_price*40 then
      update public.reservation_agreements set commission_eligible_at=v_now where id=v_res.id;
      v_eligible:=true;
      select t.expected_commission into v_expected_commission
        from public.customer_application_purchase_terms t where t.id=v_res.purchase_terms_id;
      insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
        values(p_actor_id,'COMMISSION_ELIGIBLE','reservation_agreement',v_res.id::text,
          jsonb_build_object('beneficiaryStaffId',v_res.seller_staff_id,'expectedCommission',v_expected_commission,
            'verifiedTotal',private.money(v_verified_after),'totalPrice',private.money(v_price),
            'paymentId',p_payment_id),p_request_id::text);
    end if;
  end if;

  if v_rejected then
    insert into public.audit_events(actor_id,action,entity_type,entity_id,reason,after_data,request_id)
      values(p_actor_id,'PAYMENT_REJECTED','payment',p_payment_id::text,btrim(p_reason),
        jsonb_build_object('origin',v_pay.origin,'reservationId',v_res.id,'saleId',v_sale.id,
          'amount',v_pay.amount,'status','rejected','verifiedTotal',private.money(v_verified_after),
          'remainingBalance',private.money(v_balance_after)),
        p_request_id::text);
  else
    if v_res.id is not null then
      v_receipt:=private.append_purchase_document('payment_verified',p_payment_id,1,p_actor_id);
    end if;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id)
      values(p_actor_id,'PAYMENT_VERIFIED','payment',p_payment_id::text,
        jsonb_build_object('origin',v_pay.origin,'reservationId',v_res.id,'saleId',v_sale.id,
          'amount',v_pay.amount,'status','verified','paymentPurpose',v_pay.payment_purpose,
          'verifiedTotal',private.money(v_verified_after),
          'remainingBalance',private.money(v_balance_after),'fullyPaid',v_balance_after=0,
          'documentEvidenceId',v_receipt),
        p_request_id::text);
  end if;

  v_return:=jsonb_build_object('resultId',p_payment_id,'paymentId',p_payment_id,'reservationId',v_res.id,
    'saleId',v_sale.id,'status',p_decision,'verifiedBefore',private.money(v_verified_before),
    'verifiedTotal',private.money(v_verified_after),'balanceBefore',private.money(v_balance_before),
    'remainingBalance',private.money(v_balance_after),'fullyPaid',v_balance_after=0,
    'documentEvidenceId',v_receipt,'vipCardIssued',v_vip_issued,'vipCardNumber',v_vip,
    'commissionEligible',coalesce(v_res.commission_eligible_at is not null or v_eligible,false));
  perform private.complete_purchase_mutation(p_actor_id,'payment.verify',p_request_id,v_payload,p_payment_id,v_return);
  return v_return;
end $$;
revoke all on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) to service_role;

-- VIP issuance requires an executed RA and a verified qualifying payment that
-- belongs to it. Formula and registry/immutability triggers are unchanged.
do $patch$
declare d text; sig text:='private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz)';
  old text:=$a$if v_res.origin <> 'application' then raise exception 'VIP_APPLICATION_ORIGIN_REQUIRED' using errcode='55000'; end if;$a$;
  new text:=$b$if v_res.origin <> 'application' then raise exception 'VIP_APPLICATION_ORIGIN_REQUIRED' using errcode='55000'; end if;
  if v_res.status <> 'executed' then raise exception 'VIP_EXECUTED_AGREEMENT_REQUIRED' using errcode='55000'; end if;
  if v_pay.reservation_id is distinct from v_res.id then raise exception 'VIP_PAYMENT_RESERVATION_MISMATCH' using errcode='55000'; end if;$b$;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  if position(old in d)=0 then raise exception 'VIP_PATCH_DRIFT'; end if;
  execute replace(d,old,new);
end $patch$;
revoke all on function private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. Finalization keeps the frozen seller; eligibility carries to the commission
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='public.finalize_reservation_purchase_once(uuid,uuid,uuid)'; r record;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  for r in select * from (values
    ($a$perform private.purchase_seller_for(p_actor_id,v_terms.seller_staff_id);$a$,
     $b$perform private.validate_frozen_seller(v_terms.seller_staff_id);$b$),
    ($a$update public.commission_records set sale_id=v_sale_id, updated_at=now() where reservation_id=v_res.id;$a$,
     $b$update public.commissions set eligible_at=(select ra.commission_eligible_at from public.reservation_agreements ra where ra.id=v_res.id) where id=v_commission_id;$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'FINALIZE_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;
revoke all on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 15. Activation: committed behaviour restored, plus the purchase-workflow gates
-- ---------------------------------------------------------------------------
create or replace function public.activate_card_sale(
  p_sale_id uuid,
  p_actor_id uuid,
  p_validity_months integer default 12
)
returns table (
  membership_id uuid,
  membership_number text,
  fallback_code text,
  qr_token text,
  points_allocated bigint,
  already_active boolean
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sale public.card_sales%rowtype;
  v_price numeric;
  v_verified numeric;
  v_existing public.memberships%rowtype;
  v_membership_id uuid;
  v_membership_number text;
  v_fallback text;
  v_qr text;
  v_points integer;
  v_account_id uuid;
  v_commission_id uuid;
  v_months integer;
  v_expires timestamptz;
  v_receipt uuid;
  v_res public.reservation_agreements%rowtype;
  v_vip text;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  perform private.mutation_actor_role(p_actor_id,'finance.card_activation','update');
  if coalesce(p_validity_months, 0) <= 0 then
    raise exception 'INVALID_VALIDITY_MONTHS' using errcode = '22023';
  end if;

  select * into v_sale from public.card_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotent: any existing membership for the sale is returned unchanged.
  select * into v_existing from public.memberships where sale_id = v_sale.id;
  if found then
    return query
      select v_existing.id, v_existing.membership_number, null::text, null::text,
             v_existing.yearly_points_allocated::bigint, true;
    return;
  end if;

  if v_sale.status not in ('payment_verified', 'activation_pending') then
    raise exception 'SALE_NOT_ACTIVATABLE:%', v_sale.status using errcode = '55000';
  end if;
  if v_sale.cash_price_snapshot is null then
    raise exception 'SALE_HAS_NO_PRICE_SNAPSHOT' using errcode = '55000';
  end if;

  v_price := (v_sale.cash_price_snapshot)::numeric;
  select coalesce(sum((amount)::numeric), 0) into v_verified
  from public.payments
  where sale_id = v_sale.id and status = 'verified';
  if v_verified < v_price then
    raise exception 'SALE_NOT_FULLY_PAID:verified=% price=%', private.money(v_verified), private.money(v_price)
      using errcode = '55000';
  end if;

  -- Application-origin purchase: the executed, finalized agreement is the final
  -- contractual evidence, and the VIP Card ID issued at the first verified
  -- contractual payment is REUSED. Activation never mints an identifier.
  select r.* into v_res from public.reservation_agreements r
   where r.sale_id = v_sale.id and r.origin = 'application';
  if found then
    if v_res.status <> 'executed' or v_res.finalized_at is null then
      raise exception 'ACTIVATION_AGREEMENT_NOT_FINALIZED' using errcode = '55000';
    end if;
    select c.vip_card_number into v_vip from public.customers c where c.id = v_sale.customer_id;
    if v_vip is null then
      raise exception 'VIP_CARD_ID_REQUIRED' using errcode = '55000';
    end if;
  end if;

  v_months := coalesce(v_sale.validity_months_snapshot, p_validity_months);
  if v_months <= 0 then
    raise exception 'INVALID_VALIDITY_MONTHS' using errcode = '22023';
  end if;
  v_expires := now() + make_interval(months => v_months);

  -- Activation awards ZERO points; points are earned from eligible purchases.
  v_points := 0;
  v_membership_number := private.next_membership_number();
  v_fallback := private.new_fallback_code();
  v_qr := private.new_qr_token();

  insert into public.memberships (
    customer_id, sale_id, membership_number, product_id, fallback_code_hash,
    qr_token_hash, status, points_balance, yearly_points_allocated,
    sale_status_at_activation, activated_by, activated_at, expires_at, renewal_due_at, issued_at
  ) values (
    v_sale.customer_id, v_sale.id, v_membership_number, v_sale.plan_id,
    private.hash_token(v_fallback), private.hash_token(v_qr), 'active', 0, v_points,
    v_sale.status, p_actor_id, now(), v_expires, v_expires, now()
  )
  returning id into v_membership_id;

  update public.memberships
     set points_anniversary = (now() at time zone 'Asia/Manila')::date
   where id = v_membership_id;

  insert into public.points_accounts (membership_id, balance, lifetime_allocated)
  values (v_membership_id, v_points, v_points)
  returning id into v_account_id;
  perform private.ensure_points_period(v_account_id);

  update public.card_sales
  set status = 'active', activated_at = now(), updated_at = now()
  where id = v_sale.id;

  update public.customers set status = 'active', updated_at = now() where id = v_sale.customer_id;

  -- Commission advances to awaiting-qualification; activation never pays it.
  select id into v_commission_id
  from public.commissions
  where sale_id = v_sale.id and status = 'payment_verified'
  for update;
  if found then
    update public.commissions
    set status = 'final_qualification_pending'
    where id = v_commission_id;
  end if;

  -- Activation evidence only for an application-origin purchase; a legacy
  -- sale-origin row has no agreement or frozen terms and never gets an invented one.
  if v_res.id is not null then
    v_receipt := private.append_purchase_document('membership_activated', v_membership_id, 1, p_actor_id);
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id, 'MEMBERSHIP_ACTIVATED', 'membership', v_membership_id::text,
    jsonb_build_object('saleStatus', v_sale.status, 'customerStatus', 'prospect'),
    jsonb_build_object(
      'saleId', v_sale.id,
      'membershipNumber', v_membership_number,
      'productId', v_sale.plan_id,
      'pointsAllocated', v_points,
      'vipCardNumber', v_vip,
      'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'documentEvidenceId', v_receipt
    )
  );

  return query select v_membership_id, v_membership_number, v_fallback, v_qr, v_points::bigint, false;
end $$;
revoke all on function public.activate_card_sale(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.activate_card_sale(uuid,uuid,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Sale-origin payments: real receipt object, Finance re-check, verified + pending overpayment
-- ---------------------------------------------------------------------------
-- public.record_card_payment and public.verify_card_payment (live bodies from
-- 20261230000003; record_card_payment_once in 20261022000001 wraps the former and
-- the sales handler also calls it directly) still carried the afhomes.test_mode
-- receipt bypass. With the GUC unset, `current_setting(..,true) <> 'on'` is NULL,
-- so the storage-object check never ran in production. Neither function re-checked
-- the finance.payment_verification permission the handler gates on, and recording
-- counted verified money only, so two pending recordings could jointly exceed the
-- frozen price. Patched by exact text replacement (fail closed on drift) so
-- spot-cash, sale-status transitions, commission status and audit stay byte-for-byte.
do $patch$
declare d text; sig text; r record;
begin
  sig:='public.record_card_payment(uuid,text,text,text,text,text,text,uuid)';
  select pg_get_functiondef(sig::regprocedure) into d;
  -- CRLF-safe: multi-line needles below are LF; a CRLF body would never match.
  d:=replace(d,E'\r\n',E'\n');
  for r in select * from (values
    ($a$  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
$a$,
     $b$  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  -- SECURITY DEFINER: re-check the handler's gate; the handler is not the boundary.
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
$b$),
    ($a$  -- Require receipt storage path
  if p_receipt_storage_path is null or btrim(p_receipt_storage_path) = '' then
    -- Allow dummy path in test mode
    if current_setting('afhomes.test_mode', true) = 'on' then
      -- In test mode, allow a dummy path
    else
      raise exception 'RECEIPT_STORAGE_PATH_REQUIRED' using errcode = '22023';
    end if;
  end if;
  -- Verify the storage object exists (only if storage schema exists and not in test mode)
  if exists(select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
     and current_setting('afhomes.test_mode', true) <> 'on' then
    select exists(select 1 from storage.objects where name = btrim(p_receipt_storage_path) and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
    if not v_storage_obj_exists then
      raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode = '55000';
    end if;
  end if;
$a$,
     $b$  -- A real receipt object in the private bucket. No bypass of any kind.
  perform private.require_payment_receipt_object(p_receipt_storage_path);
$b$),
    ($a$  -- Overpayment protection: verified_total + new_amount <= cash_price_snapshot
  select coalesce(sum((p.amount)::numeric) filter (where p.status='verified'), 0) into v_verified_total
$a$,
     $b$  -- Overpayment protection: verified + still-pending (recorded) + new <= frozen price,
  -- so a pending payment cannot be double-booked by a second recording. The sale
  -- row lock above serializes concurrent recordings. v_verified_total holds both.
  select coalesce(sum((p.amount)::numeric) filter (where p.status in ('verified','recorded')), 0) into v_verified_total
$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'SALE_PAYMENT_PATCH_DRIFT:record:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  if position('afhomes.test_mode' in d)>0 then raise exception 'SALE_PAYMENT_PATCH_DRIFT:record:test_mode'; end if;
  execute d;

  sig:='public.verify_card_payment(uuid,text,text,uuid)';
  select pg_get_functiondef(sig::regprocedure) into d;
  -- CRLF-safe: multi-line needles below are LF; a CRLF body would never match.
  d:=replace(d,E'\r\n',E'\n');
  for r in select * from (values
    ($a$  if p_actor_id is null then raise exception 'ACTOR_REQUIRED' using errcode = '42501'; end if;
$a$,
     $b$  if p_actor_id is null then raise exception 'ACTOR_REQUIRED' using errcode = '42501'; end if;
  -- SECURITY DEFINER: re-check the handler's gate; the handler is not the boundary.
  perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','update');
$b$),
    ($a$  -- Require proof for verification
  if p_decision = 'verified' then
    if v_payment.receipt_storage_path is null or btrim(v_payment.receipt_storage_path) = '' then
      if current_setting('afhomes.test_mode', true) = 'on' then
        -- In test mode, allow a dummy path
      else
        raise exception 'RECEIPT_STORAGE_PATH_REQUIRED_FOR_VERIFICATION' using errcode = '22023';
      end if;
    end if;
    -- Verify the storage object exists (only if storage schema exists and not in test mode)
    if exists(select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
       and current_setting('afhomes.test_mode', true) <> 'on' then
      select exists(select 1 from storage.objects where name = btrim(v_payment.receipt_storage_path) and bucket_id = 'afhomes-payment-receipts') into v_storage_obj_exists;
      if not v_storage_obj_exists then
        raise exception 'RECEIPT_STORAGE_OBJECT_NOT_FOUND' using errcode = '55000';
      end if;
    end if;
  end if;
$a$,
     $b$  -- Require proof for verification: a stored path AND a real object in the
  -- private bucket at the moment money is accepted. No bypass of any kind.
  if p_decision = 'verified' then
    if v_payment.receipt_storage_path is null or btrim(v_payment.receipt_storage_path) = '' then
      raise exception 'RECEIPT_STORAGE_PATH_REQUIRED_FOR_VERIFICATION' using errcode = '22023';
    end if;
    perform private.require_payment_receipt_object(v_payment.receipt_storage_path);
  end if;
$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'SALE_PAYMENT_PATCH_DRIFT:verify:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  if position('afhomes.test_mode' in d)>0 then raise exception 'SALE_PAYMENT_PATCH_DRIFT:verify:test_mode'; end if;
  execute d;

  -- Tripwire: no installed AF Homes function may still consult the test-mode GUC.
  select string_agg(n.nspname||'.'||p.proname, ', ') into d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','private') and p.prosrc like '%afhomes.test_mode%';
  if d is not null then raise exception 'TEST_MODE_BYPASS_REMAINS:%', d; end if;
end $patch$;
revoke all on function public.record_card_payment(uuid,text,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.record_card_payment(uuid,text,text,text,text,text,text,uuid) to service_role;
revoke all on function public.verify_card_payment(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_card_payment(uuid,text,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 17. Replay-receipt validator knows this migration's receipt keys.
-- submit_purchase_application_once returns `reservationNumber` and
-- verify_purchase_payment_once returns `commissionEligible`; the closed-shape
-- validator (last defined in 2026123000014) refused both with
-- MUTATION_RECEIPT_INVALID, so EVERY submission and reservation verification
-- failed. Each key is typed: reservationNumber is the official RA number
-- (YYYY-NNNN from private.allocate_official_ra) or a converted legacy AF-RES-XXXXX
-- alias; commissionEligible is a boolean.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='private.complete_purchase_mutation(uuid,text,uuid,jsonb,uuid,jsonb)'; r record;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  for r in select * from (values
    ($a$'vipCardIssued','vipCardNumber'])) then$a$,
     $b$'vipCardIssued','vipCardNumber','reservationNumber','commissionEligible'])) then$b$),
    ($a$elsif k='saleNumber' then$a$,
     $b$elsif k='reservationNumber' then
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^([0-9]{4}-[0-9]{4,}|AF-RES-[A-HJ-NP-Z2-9]{5})$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='saleNumber' then$b$),
    ($a$elsif k='vipCardIssued' then$a$, $b$elsif k in ('vipCardIssued','commissionEligible') then$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'RECEIPT_KEYS_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;
revoke all on function private.complete_purchase_mutation(uuid,text,uuid,jsonb,uuid,jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 18. Remove the last session-settable workflow bypass.
-- reserve_application_purchase_once skipped the cross-seller sales.card_sales
-- update check whenever afhomes.auto_workflow='on'. No live function sets that
-- flag any more (the approval-time auto-reservation it served was superseded:
-- the RA is now created at submission), so it is reachable only by a session
-- that sets the GUC itself. Cross-seller reservation always needs the gate.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb)';
  old text:=$a$
     and current_setting('afhomes.auto_workflow', true) is distinct from 'on' then$a$;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  -- CRLF-safe: multi-line needles below are LF; a CRLF body would never match.
  d:=replace(d,E'\r\n',E'\n');
  if position(old in d)=0 then raise exception 'AUTO_WORKFLOW_PATCH_DRIFT'; end if;
  execute replace(d,old,' then');
  select string_agg(n.nspname||'.'||p.proname, ', ') into d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','private') and p.prosrc like '%afhomes.auto_workflow%';
  if d is not null then raise exception 'AUTO_WORKFLOW_BYPASS_REMAINS:%', d; end if;
end $patch$;
revoke all on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 19. The legacy business-ID converter must treat OFFICIAL RA numbers
-- (YYYY-NNNN from private.allocate_official_ra) as modern. It treated every
-- non-AF-RES value as legacy, tried to rewrite official numbers, and
-- protect_official_ra (section 3) aborted it with OFFICIAL_RA_NUMBER_IMMUTABLE
-- on any database holding an official RA. Both the selection and the final
-- "nothing legacy remains" check use the same pattern.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='private.upgrade_legacy_business_ids()'; n integer;
  old text:=$a$'^' || v_prefix || '-[A-HJ-NP-Z2-9]{5}$'$a$;
  new text:=$b$case when v_prefix='AF-RES' then '^(AF-RES-[A-HJ-NP-Z2-9]{5}|[0-9]{4}-[0-9]{4,})$' else '^' || v_prefix || '-[A-HJ-NP-Z2-9]{5}$' end$b$;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  n:=(length(d)-length(replace(d,old,'')))/length(old);
  if n<>2 then raise exception 'LEGACY_ID_PATCH_DRIFT:% occurrences', n; end if;
  execute replace(d,old,new);
end $patch$;
revoke all on function private.upgrade_legacy_business_ids() from public, anon, authenticated;
grant execute on function private.upgrade_legacy_business_ids() to service_role;

-- ---------------------------------------------------------------------------
-- 20. Accepted import payment claims go through the section-12 reservation
-- payment rules. accept_import_payment_claim_once sent a bucket-PREFIXED
-- receipt path (the object name is bucket-relative: import-claims/<claim>/...),
-- which require_payment_receipt_object can never find, and sent a free
-- paymentType instead of the now-required paymentPurpose. Both made every
-- import claim acceptance fail. The claim purpose maps 1:1 to a payment purpose.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='public.accept_import_payment_claim_once(uuid,uuid,uuid,text,text,jsonb)'; r record;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  for r in select * from (values
    ($a$'paymentType',case c.purpose when 'reservation' then 'down_payment' else c.purpose end$a$,
     $b$'paymentPurpose',case c.purpose when 'reservation' then 'reservation_fee' when 'down_payment' then 'contractual_down_payment' when 'installment' then 'contractual_installment' when 'full' then 'contractual_full' end$b$),
    ($a$'receiptStoragePath','afhomes-payment-receipts/'||c.proof_path$a$,
     $b$'receiptStoragePath',c.proof_path$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'IMPORT_CLAIM_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;

-- ---------------------------------------------------------------------------
-- 21. Restore the historical-import finalization dispatcher on the REPAIRED body.
-- 20261223000001 made public.finalize_reservation_purchase_once a dispatcher:
-- external-import receipts -> private.finalize_external_reservation_purchase_once
-- (the same body, but the sale is origin 'legacy_import' with its import job/row
-- ids), everything else -> private.finalize_reservation_before_external.
-- 20261230000005 then replaced the public function wholesale, so the dispatcher
-- was lost and imported purchases finalized as origin 'normal'; the two private
-- copies were also left on the pre-repair body. Both are re-derived here from the
-- CURRENT public body (section 14: frozen-seller validation and the 40%
-- eligibility copy), with the 20261223000001 needles, failing closed on drift.
-- Re-running reuses the base copy if the dispatcher is already installed.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; ext text; needle text; replacement text;
  dispatcher_marker text:='private.finalize_external_reservation_purchase_once';
begin
  select pg_get_functiondef('public.finalize_reservation_purchase_once(uuid,uuid,uuid)'::regprocedure) into d;
  if position(dispatcher_marker in d)>0 then
    select replace(pg_get_functiondef('private.finalize_reservation_before_external(uuid,uuid,uuid)'::regprocedure),
      'FUNCTION private.finalize_reservation_before_external(','FUNCTION public.finalize_reservation_purchase_once(') into d;
  end if;
  -- The base must be the repaired body, or the copies would regress the rules.
  if position('perform private.validate_frozen_seller(v_terms.seller_staff_id);' in d)=0
     or position('update public.commissions set eligible_at=' in d)=0
     or position('FUNCTION public.finalize_reservation_purchase_once(' in d)=0 then
    raise exception 'FINALIZE_DISPATCH_PATCH_DRIFT:base body is not the section-14 body';
  end if;
  execute replace(d,'FUNCTION public.finalize_reservation_purchase_once(',
    'FUNCTION private.finalize_reservation_before_external(');

  ext:=replace(d,'FUNCTION public.finalize_reservation_purchase_once(',
    'FUNCTION private.finalize_external_reservation_purchase_once(');
  needle:='expected_commission_snapshot,status,submitted_at,payment_verified_at,fully_paid_at,';
  if position(needle in ext)=0 then raise exception 'FINALIZE_DISPATCH_PATCH_DRIFT:columns'; end if;
  ext:=replace(ext,needle,
    'expected_commission_snapshot,origin,import_job_id,import_row_id,status,submitted_at,payment_verified_at,fully_paid_at,');
  needle:='v_terms.expected_commission,''payment_verified'',v_now,v_now,v_now,';
  replacement:='v_terms.expected_commission,''legacy_import'',
    (select ir.import_job_id from private.customer_import_purchase_sources src join public.customer_import_rows ir on ir.id=src.original_row_id where src.application_id=v_app.id and src.superseded_by is null),
    (select src.original_row_id from private.customer_import_purchase_sources src where src.application_id=v_app.id and src.superseded_by is null),
    ''payment_verified'',v_now,v_now,v_now,';
  if position(needle in ext)=0 then raise exception 'FINALIZE_DISPATCH_PATCH_DRIFT:values'; end if;
  execute replace(ext,needle,replacement);
end $patch$;
revoke all on function private.finalize_reservation_before_external(uuid,uuid,uuid),
  private.finalize_external_reservation_purchase_once(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.finalize_reservation_purchase_once(p_request_id uuid,p_reservation_id uuid,p_actor_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if exists(select 1 from private.customer_external_import_receipts where reservation_id=p_reservation_id) then
  return private.finalize_external_reservation_purchase_once(p_request_id,p_reservation_id,p_actor_id);
 end if;
 return private.finalize_reservation_before_external(p_request_id,p_reservation_id,p_actor_id);
end $$;
revoke all on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_reservation_purchase_once(uuid,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 22. Signed-document self-review is allowed (product owner, 11 Nov 2026): the
-- uploader may review their own signed document. Only the self-review refusal is
-- removed; the permission check, the pending_review state, the replay rule, the
-- object-existence check and the rejection-reason length are unchanged.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='public.review_purchase_signed_document_once(uuid,uuid,text,text)';
  old text:=$a$  if v_doc.uploaded_by=p_actor_id then raise exception 'SIGNED_DOCUMENT_SELF_REVIEW' using errcode='42501'; end if;
$a$;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  if position(old in d)=0 then raise exception 'SELF_REVIEW_PATCH_DRIFT'; end if;
  d:=replace(d,old,'');
  if position('SIGNED_DOCUMENT_SELF_REVIEW' in d)>0 then raise exception 'SELF_REVIEW_PATCH_DRIFT:remains'; end if;
  execute d;
end $patch$;
revoke all on function public.review_purchase_signed_document_once(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_purchase_signed_document_once(uuid,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 23. VIP Card ID: ONE shared counter (product owner, 11 Nov 2026).
-- issue_vip_on_first_qualifying_payment derived its 5-digit sequence from the
-- official RA number while public.generate_vip_card_number (import issuance) used
-- private.vip_card_number_seq, so the two could issue the same
-- YYMMDD+NNNNN+tier+scheme+months+S on one day and the registry refused the
-- second (VIP_CARD_NUMBER_ALREADY_ISSUED). Issuance now takes the next value of
-- the same sequence, with the generator's range exhaustion. Format, the official
-- RA precondition and the registry/uniqueness checks are unchanged, and no
-- already-issued ID is touched.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz)'; r record;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  for r in select * from (values
    ($a$  v_sequence text; v_classification text;$a$,
     $b$  v_sequence text; v_classification text; v_seq bigint;$b$),
    ($a$  v_sequence := lpad(right(v_res.reservation_number,4),5,'0');  -- 4-digit sequence padded to 5$a$,
     $b$  -- The SAME counter as public.generate_vip_card_number, so an import-issued and a
  -- purchase-issued ID can never collide.
  v_seq := nextval('private.vip_card_number_seq');
  if v_seq>99999 then raise exception 'VIP_CARD_NUMBER_RANGE_EXHAUSTED'; end if;
  v_sequence := lpad(v_seq::text,5,'0');$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'VIP_SEQUENCE_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;
revoke all on function private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 24. A receipt backs exactly one live payment (product owner, 11 Nov 2026).
-- (1) The same storage object may not be cited by two payments that are not
--     rejected/voided: a partial unique index, plus a clear RECEIPT_ALREADY_USED
--     raised before the insert (an advisory lock on the path makes the check
--     race-free across different purchases).
-- (2) The same FILE uploaded twice under two names is refused too, when the
--     platform records a content eTag (storage.objects.metadata->>'eTag'); a
--     missing metadata/eTag skips only this content check. Read through
--     to_jsonb(o) so the function also runs where the column is absent.
-- Import "match existing payment" decisions link a claim to an existing payment
-- and record nothing, so they never cite a receipt twice.
-- Applying fails closed (RECEIPT_DUPLICATES_PRESENT) if live payments already
-- share a path: those rows need a human decision, never an automatic rewrite.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from (
    select p.receipt_storage_path from public.payments p
     where p.receipt_storage_path is not null and p.status not in ('rejected','voided')
     group by 1 having count(*)>1) dup;
  if n>0 then
    raise exception 'RECEIPT_DUPLICATES_PRESENT:% receipt path(s) are cited by more than one live payment', n;
  end if;
end $$;
create unique index if not exists payments_receipt_storage_path_active_unique
  on public.payments (receipt_storage_path)
  where receipt_storage_path is not null and status not in ('rejected','voided');

create or replace function private.require_unused_payment_receipt(p_path text, p_payment_id uuid, p_lock boolean)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_path text:=btrim(coalesce(p_path,'')); v_etag text;
begin
  -- Presence and existence are require_payment_receipt_object's job.
  if v_path='' then return; end if;
  if p_lock then perform pg_advisory_xact_lock(hashtextextended('afhomes-payment-receipt:'||v_path,0)); end if;
  if exists(select 1 from public.payments p
             where p.receipt_storage_path=v_path and p.status not in ('rejected','voided')
               and p.id is distinct from p_payment_id) then
    raise exception 'RECEIPT_ALREADY_USED' using errcode='55000';
  end if;
  select nullif(btrim(to_jsonb(o)->'metadata'->>'eTag'),'') into v_etag
    from storage.objects o where o.bucket_id='afhomes-payment-receipts' and o.name=v_path;
  if v_etag is null then return; end if;
  if p_lock then perform pg_advisory_xact_lock(hashtextextended('afhomes-payment-receipt-etag:'||v_etag,0)); end if;
  if exists(select 1 from public.payments p
              join storage.objects o on o.bucket_id='afhomes-payment-receipts' and o.name=p.receipt_storage_path
             where p.status not in ('rejected','voided') and p.id is distinct from p_payment_id
               and p.receipt_storage_path<>v_path
               and to_jsonb(o)->'metadata'->>'eTag'=v_etag) then
    raise exception 'RECEIPT_ALREADY_USED' using errcode='55000';
  end if;
end $$;
revoke all on function private.require_unused_payment_receipt(text,uuid,boolean) from public, anon, authenticated, service_role;

-- Recording checks (and locks) after the parent lock; verification re-checks
-- against every OTHER live payment without taking a new lock.
do $patch$
declare d text; t record;
begin
  for t in select * from (values
    ('public.record_reservation_payment_once(uuid,uuid,jsonb,uuid)',
     $a$  v_path:=private.require_payment_receipt_object(p_input->>'receiptStoragePath');$a$,
     $b$  v_path:=private.require_payment_receipt_object(p_input->>'receiptStoragePath');
  perform private.require_unused_payment_receipt(v_path,null,true);$b$),
    ('public.record_card_payment(uuid,text,text,text,text,text,text,uuid)',
     $a$  if v_sale.cash_price_snapshot is null then
    raise exception 'SALE_HAS_NO_PRICE_SNAPSHOT' using errcode = '55000';
  end if;
$a$,
     $b$  if v_sale.cash_price_snapshot is null then
    raise exception 'SALE_HAS_NO_PRICE_SNAPSHOT' using errcode = '55000';
  end if;
  perform private.require_unused_payment_receipt(p_receipt_storage_path,null,true);
$b$),
    ('public.verify_purchase_payment_once(uuid,uuid,text,text,uuid)',
     $a$  if not v_rejected then perform private.require_payment_receipt_object(v_pay.receipt_storage_path); end if;$a$,
     $b$  if not v_rejected then
    perform private.require_payment_receipt_object(v_pay.receipt_storage_path);
    perform private.require_unused_payment_receipt(v_pay.receipt_storage_path,v_pay.id,false);
  end if;$b$),
    ('public.verify_card_payment(uuid,text,text,uuid)',
     $a$    perform private.require_payment_receipt_object(v_payment.receipt_storage_path);$a$,
     $b$    perform private.require_payment_receipt_object(v_payment.receipt_storage_path);
    perform private.require_unused_payment_receipt(v_payment.receipt_storage_path,v_payment.id,false);$b$)
  ) x(sig,old,new) loop
    select pg_get_functiondef(t.sig::regprocedure) into d;
    -- CRLF-safe: multi-line needles below are LF; a CRLF body would never match.
    d:=replace(d,E'\r\n',E'\n');
    if position(t.old in d)=0 then raise exception 'RECEIPT_REUSE_PATCH_DRIFT:%', t.sig; end if;
    execute replace(d,t.old,t.new);
  end loop;
end $patch$;
revoke all on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_reservation_payment_once(uuid,uuid,jsonb,uuid) to service_role;
revoke all on function public.record_card_payment(uuid,text,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.record_card_payment(uuid,text,text,text,text,text,text,uuid) to service_role;
revoke all on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_purchase_payment_once(uuid,uuid,text,text,uuid) to service_role;
revoke all on function public.verify_card_payment(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.verify_card_payment(uuid,text,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 25. "SM is the only seller in the import" (product owner, 11 Nov 2026).
-- Historical imports froze purchase_seller_for(actor, referrer) - the OST
-- referrer - as seller of record. The seller is now the referrer's team Sales
-- Manager: the row's named SM (sm_staff_id) or the referrer's active upline SM,
-- which must agree. Unresolvable or disagreeing rows fail as a ROW-level error
-- (each row is its own commit call; the preview flags it as a conflict).
-- A BEFORE INSERT guard on customer_application_purchase_terms then makes it
-- impossible for ANY origination or import path to freeze a non-SM seller on a
-- new purchase; existing rows (and validate_frozen_seller for them) are untouched.
-- ---------------------------------------------------------------------------
create or replace function private.import_team_sales_manager(p_raw jsonb, p_strict boolean)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_ref uuid; v_named uuid; v_sm uuid; v_role text;
begin
  v_ref:=nullif(btrim(coalesce(p_raw->>'referrer_staff_id','')),'')::uuid;
  v_named:=nullif(btrim(coalesce(p_raw->>'sm_staff_id','')),'')::uuid;
  if v_ref is not null then
    v_role:=private.staff_role_slug(v_ref);
    if v_role='sales_manager' then
      v_sm:=v_ref;
    elsif v_role='ost' then
      select r.upline_staff_id into v_sm from public.referral_relationships r
       where r.subject_staff_id=v_ref and r.is_active
       order by r.is_authoritative desc nulls last, r.id limit 1;
    end if;
  end if;
  if v_named is not null then
    if v_sm is not null and v_sm<>v_named then
      if p_strict then raise exception 'IMPORT_SELLER_TEAM_CONFLICT' using errcode='55000'; end if;
      return null;
    end if;
    v_sm:=v_named;
  end if;
  if v_sm is null or private.staff_role_slug(v_sm) is distinct from 'sales_manager'
     or not exists(select 1 from public.staff_users su where su.id=v_sm and su.status='active') then
    if p_strict then raise exception 'IMPORT_SELLER_SM_REQUIRED' using errcode='55000'; end if;
    return null;
  end if;
  return v_sm;
end $$;
revoke all on function private.import_team_sales_manager(jsonb,boolean) from public, anon, authenticated, service_role;

do $patch$
declare d text; r record;
begin
  select pg_get_functiondef('private.reconcile_external_customer_import(uuid,uuid,text)'::regprocedure) into d;
  if position($a$seller:=private.purchase_seller_for(p_actor,(r.raw_data->>'referrer_staff_id')::uuid);$a$ in d)=0 then
    raise exception 'IMPORT_SELLER_PATCH_DRIFT:reconcile';
  end if;
  execute replace(d,$a$seller:=private.purchase_seller_for(p_actor,(r.raw_data->>'referrer_staff_id')::uuid);$a$,
    $b$seller:=private.import_team_sales_manager(r.raw_data,true);$b$);

  select pg_get_functiondef('private.import_continuation_result(uuid,jsonb)'::regprocedure) into d;
  for r in select * from (values
    ($a$('referrer_staff_id','The registered seller differs from the existing reservation seller.',existing_res.seller_staff_id::text is distinct from r.raw_data->>'referrer_staff_id'),$a$,
     $b$('sm_staff_id','The Sales Manager seller of record differs from the existing reservation seller.',existing_res.seller_staff_id is distinct from private.import_team_sales_manager(r.raw_data,false)),$b$),
    -- Single-line needle: the installed body may carry CRLF line ends.
    ($a$ if stage in ('active','inactive') then$a$,
     $b$ if private.import_team_sales_manager(r.raw_data,false) is null then
  return result||jsonb_build_object('stage','review','conflicts',jsonb_build_array(jsonb_build_object('field','sm_staff_id','code','IMPORT_SELLER_SM_REQUIRED',
   'message','No active Sales Manager can be resolved for this referrer (or it differs from the named SM). The Sales Manager is the seller of record.')));
 end if;
 if stage in ('active','inactive') then$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'IMPORT_SELLER_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;

  -- No live function may still resolve a seller through the actor-based resolver.
  select string_agg(n.nspname||'.'||p.proname, ', ') into d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','private') and p.proname<>'purchase_seller_for'
     and p.prosrc like '%purchase_seller_for(%';
  if d is not null then raise exception 'PURCHASE_SELLER_FOR_CALLERS_REMAIN:%', d; end if;
end $patch$;
revoke all on function private.reconcile_external_customer_import(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function private.import_continuation_result(uuid,jsonb) from public, anon, authenticated, service_role;

create or replace function private.require_sm_seller_of_record() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
  if private.staff_role_slug(new.seller_staff_id) is distinct from 'sales_manager'
     or not exists(select 1 from public.staff_users su where su.id=new.seller_staff_id and su.status='active') then
    raise exception 'SELLER_OF_RECORD_MUST_BE_SM' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.require_sm_seller_of_record() from public, anon, authenticated, service_role;
drop trigger if exists purchase_terms_sm_seller_of_record on public.customer_application_purchase_terms;
create trigger purchase_terms_sm_seller_of_record before insert on public.customer_application_purchase_terms
  for each row execute function private.require_sm_seller_of_record();

-- ---------------------------------------------------------------------------
-- 26. Imports never create or reuse a duplicate VIP Card number (product owner,
-- 11 Nov 2026). A supplied number already in the system registry (or on another
-- customer), or supplied by another row of the same file, flags THAT row in the
-- preview with IMPORT_DUPLICATE_VIP_CARD_NUMBER (it is not committed; other rows
-- proceed), and the commit path refuses it with the same code. System-generated
-- numbers already share one counter (section 23).
-- ---------------------------------------------------------------------------
do $patch$
declare d text; r record;
  old_commit text:=$a$ if exists(select 1 from public.customers where vip_card_number=supplied and id<>p_customer) then raise exception 'IMPORT_VIP_NUMBER_CONFLICT';end if;$a$;
  new_commit text:=$b$ if exists(select 1 from private.vip_card_number_issuances i where i.vip_card_number=supplied and i.customer_id<>p_customer) then
  raise exception 'IMPORT_DUPLICATE_VIP_CARD_NUMBER' using errcode='23505';
 end if;
 if exists(select 1 from public.customers where vip_card_number=supplied and id<>p_customer) then raise exception 'IMPORT_VIP_NUMBER_CONFLICT';end if;$b$;
begin
  -- Single-line needles: the installed body carries CRLF line ends (20261223000001).
  select pg_get_functiondef('private.import_continuation_result(uuid,jsonb)'::regprocedure) into d;
  for r in select * from (values
    ($a$ if nullif(r.raw_data->>'existing_vip_control_number','') is not null and exists(select 1 from public.customers c where c.vip_card_number=r.raw_data->>'existing_vip_control_number' and c.id is distinct from customer) then$a$,
     $b$ if nullif(r.raw_data->>'existing_vip_control_number','') is not null and (
    exists(select 1 from private.vip_card_number_issuances i where i.vip_card_number=r.raw_data->>'existing_vip_control_number' and i.customer_id is distinct from customer)
    or exists(select 1 from public.customers c where c.vip_card_number=r.raw_data->>'existing_vip_control_number' and c.id is distinct from customer)) then$b$),
    ($a$jsonb_build_object('field','purchase_reference','message','This VIP card ID belongs to another customer.')$a$,
     $b$jsonb_build_object('field','existing_vip_control_number','code','IMPORT_DUPLICATE_VIP_CARD_NUMBER','message','VIP Card number already exists in the system')$b$),
    -- Inserted before the section-25 seller check (LF text written by this migration).
    ($a$ if private.import_team_sales_manager(r.raw_data,false) is null then$a$,
     $b$ if nullif(r.raw_data->>'existing_vip_control_number','') is not null and exists(select 1 from public.customer_import_rows o
   where o.import_job_id=r.import_job_id and o.id<>r.id and nullif(o.raw_data->>'existing_vip_control_number','')=r.raw_data->>'existing_vip_control_number') then
  return result||jsonb_build_object('stage','review','conflicts',jsonb_build_array(jsonb_build_object('field','existing_vip_control_number',
   'code','IMPORT_DUPLICATE_VIP_CARD_NUMBER','message','VIP Card number appears more than once in this file')));
 end if;
 if private.import_team_sales_manager(r.raw_data,false) is null then$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'IMPORT_VIP_DUPLICATE_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
  select pg_get_functiondef('private.import_customer_vip_number(uuid,uuid,uuid)'::regprocedure) into d;
  if position(old_commit in d)=0 then raise exception 'IMPORT_VIP_DUPLICATE_PATCH_DRIFT:commit'; end if;
  execute replace(d,old_commit,new_commit);
end $patch$;
revoke all on function private.import_continuation_result(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.import_customer_vip_number(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 27. Import seller of record, hardened and extended to the legacy member path
-- (product owner, 11 Nov 2026: the seller of record is always an active SM, and
-- imports resolve it automatically).
-- * import_team_sales_manager: a malformed staff id is a row-level error, never a
--   22P02 abort; an OST referrer's upline counts only if it IS an SM; a named SM
--   must be on the referrer's own chain (upline or downline), else
--   IMPORT_SELLER_TEAM_CONFLICT.
-- * Legacy bulk member import (import_legacy_member, reached from
--   commit_customer_import_legacy_row): a NEW sale's seller is the named SM, else
--   the seller-code sponsor's team SM (a sponsor who is an active SM is the
--   seller); none -> IMPORT_SELLER_SM_REQUIRED for that row only. Rows that create
--   no sale need no seller; already-imported sales are never touched.
-- * public.preview_import_sellers lets the review step flag the row before commit.
-- ---------------------------------------------------------------------------
create or replace function private.try_uuid(p_value text) returns uuid
language sql immutable set search_path=pg_catalog,pg_temp as $$
  select case when btrim(coalesce(p_value,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then btrim(p_value)::uuid end
$$;
revoke all on function private.try_uuid(text) from public, anon, authenticated, service_role;

create or replace function private.staff_lineage(p_staff uuid) returns uuid[]
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
  select coalesce(array(
    with recursive lineage(id, depth) as (
      select rr.upline_staff_id, 1 from public.referral_relationships rr
       where rr.subject_staff_id=p_staff and rr.is_active
      union all
      select rr.upline_staff_id, l.depth+1 from public.referral_relationships rr
        join lineage l on rr.subject_staff_id=l.id
       where rr.is_active and l.depth<6)
    select l.id from lineage l order by l.depth), '{}'::uuid[])
$$;
revoke all on function private.staff_lineage(uuid) from public, anon, authenticated, service_role;

create or replace function private.import_team_sales_manager(p_raw jsonb, p_strict boolean)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare
  v_ref_text text:=nullif(btrim(coalesce(p_raw->>'referrer_staff_id','')),'');
  v_named_text text:=nullif(btrim(coalesce(p_raw->>'sm_staff_id','')),'');
  v_ref uuid:=private.try_uuid(v_ref_text); v_named uuid:=private.try_uuid(v_named_text);
  v_sm uuid; v_upline uuid; v_role text;
begin
  if (v_ref_text is not null and v_ref is null) or (v_named_text is not null and v_named is null) then
    if p_strict then raise exception 'IMPORT_SELLER_SM_REQUIRED' using errcode='55000'; end if;
    return null;
  end if;
  if v_ref is not null then
    v_role:=private.staff_role_slug(v_ref);
    if v_role='sales_manager' then
      v_sm:=v_ref;
    elsif v_role='ost' then
      select r.upline_staff_id into v_upline from public.referral_relationships r
       where r.subject_staff_id=v_ref and r.is_active
       order by r.is_authoritative desc nulls last, r.id limit 1;
      if private.staff_role_slug(v_upline)='sales_manager' then v_sm:=v_upline; end if;
    end if;
  end if;
  if v_named is not null then
    if (v_sm is not null and v_sm<>v_named)
       or (v_sm is null and v_ref is not null
           and not (v_ref=any(private.staff_lineage(v_named)) or v_named=any(private.staff_lineage(v_ref)))) then
      if p_strict then raise exception 'IMPORT_SELLER_TEAM_CONFLICT' using errcode='55000'; end if;
      return null;
    end if;
    v_sm:=v_named;
  end if;
  if v_sm is null or private.staff_role_slug(v_sm) is distinct from 'sales_manager'
     or not exists(select 1 from public.staff_users su where su.id=v_sm and su.status='active') then
    if p_strict then raise exception 'IMPORT_SELLER_SM_REQUIRED' using errcode='55000'; end if;
    return null;
  end if;
  return v_sm;
end $$;
revoke all on function private.import_team_sales_manager(jsonb,boolean) from public, anon, authenticated, service_role;

do $patch$
declare d text; n integer;
  old_member text:=$a$nullif(p_customer->>'sellerStaffId','')::uuid,$a$;
  new_member text:=$b$private.import_team_sales_manager(jsonb_build_object('referrer_staff_id',p_customer->>'sellerStaffId','sm_staff_id',p_customer->>'smStaffId'),true),$b$;
  old_row text:=$a$'sellerStaffId', v_seller,$a$;
  new_row text:=$b$'sellerStaffId', v_seller, 'smStaffId', nullif(v_row.raw_data->>'sm_staff_id',''),$b$;
begin
  select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  n:=(length(d)-length(replace(d,old_member,'')))/length(old_member);
  if n<>1 then raise exception 'LEGACY_SELLER_PATCH_DRIFT:member:% occurrences', n; end if;
  execute replace(d,old_member,new_member);

  select pg_get_functiondef('private.commit_customer_import_legacy_row(uuid,uuid)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  n:=(length(d)-length(replace(d,old_row,'')))/length(old_row);
  if n<>1 then raise exception 'LEGACY_SELLER_PATCH_DRIFT:row:% occurrences', n; end if;
  execute replace(d,old_row,new_row);
end $patch$;
revoke all on function public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean) to service_role;
revoke all on function private.commit_customer_import_legacy_row(uuid,uuid) from public, anon, authenticated, service_role;

-- Review-step check for legacy/flat rows (their validation runs in the API, not
-- in prepare_customer_import_batch). A row that will create a sale and has no
-- resolvable SM is marked error/CONFLICT with IMPORT_SELLER_SM_REQUIRED; the
-- result also carries the resolved seller for every row.
create or replace function public.preview_import_sellers(p_row_ids uuid[], p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_row uuid; r public.customer_import_rows%rowtype; v_code text; v_sponsor uuid; v_sm uuid;
  v_needs boolean; v_err text; v_out jsonb:='[]'::jsonb;
begin
  if cardinality(p_row_ids)>100 then raise exception 'IMPORT_BATCH_LIMIT'; end if;
  foreach v_row in array p_row_ids loop
    perform private.import_source_actor(v_row,p_actor_id,'view');
    select * into strict r from public.customer_import_rows where id=v_row;
    v_needs:=coalesce((r.normalized_data->>'requireMember')::boolean,false)
      or (r.normalized_data ? 'payment' and r.normalized_data->'payment'<>'null'::jsonb);
    v_sponsor:=null; v_err:=null;
    v_code:=upper(btrim(coalesce(r.raw_data->>'seller_code','')));
    if v_code<>'' then
      select rc.sponsor_staff_id into v_sponsor from public.referral_codes rc
        join public.staff_users su on su.id=rc.sponsor_staff_id and su.status='active'
       where rc.code_hash=private.hash_token(v_code) and rc.is_active
         and rc.expires_at>now() and rc.use_count<rc.max_uses;
    end if;
    v_sm:=private.import_team_sales_manager(
      jsonb_build_object('referrer_staff_id',v_sponsor,'sm_staff_id',r.raw_data->>'sm_staff_id'),false);
    if v_needs and v_sm is null and r.committed_at is null then
      v_err:='IMPORT_SELLER_SM_REQUIRED';
      update public.customer_import_rows set validation_status='error', action='CONFLICT',
        validation_errors=validation_errors||jsonb_build_array(jsonb_build_object('field','seller_code',
          'code','IMPORT_SELLER_SM_REQUIRED',
          'message','No active Sales Manager can be resolved for this row (or the named Sales Manager is not in the seller''s team). The Sales Manager is the seller of record.'))
       where id=v_row and not (validation_errors @> '[{"code":"IMPORT_SELLER_SM_REQUIRED"}]'::jsonb);
    end if;
    v_out:=v_out||jsonb_build_array(jsonb_build_object('rowId',v_row,'sellerStaffId',v_sm,'error',v_err));
  end loop;
  return v_out;
end $$;
revoke all on function public.preview_import_sellers(uuid[],uuid) from public, anon, authenticated;
grant execute on function public.preview_import_sellers(uuid[],uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 28. Import preview corrections (security review, 12 Nov 2026).
-- * The section-25 seller check ran before the "already imported" branch, so a
--   row committed earlier (e.g. with a legacy OST seller) flipped to review; it
--   now runs only while the source has no import receipt.
-- * The section-26 same-file VIP check counts only LIVE rows (not committed, not
--   skipped) of OTHER customers; one customer's rows may repeat their own number
--   (commit treats supplied = existing as idempotent).
-- ---------------------------------------------------------------------------
do $patch$
declare d text; r record;
begin
  select pg_get_functiondef('private.import_continuation_result(uuid,jsonb)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  for r in select * from (values
    ($a$ if private.import_team_sales_manager(r.raw_data,false) is null then$a$,
     $b$ if not (result->>'sourceId' is not null and exists(select 1 from private.customer_external_import_receipts x
                where x.source_id=(result->>'sourceId')::uuid))
    and private.import_team_sales_manager(r.raw_data,false) is null then$b$),
    ($a$   where o.import_job_id=r.import_job_id and o.id<>r.id and nullif(o.raw_data->>'existing_vip_control_number','')=r.raw_data->>'existing_vip_control_number') then$a$,
     $b$   where o.import_job_id=r.import_job_id and o.id<>r.id and nullif(o.raw_data->>'existing_vip_control_number','')=r.raw_data->>'existing_vip_control_number'
     and o.committed_at is null and o.action<>'SKIP'
     and lower(coalesce(nullif(o.raw_data->>'email',''),o.raw_data->>'customer_key',''))
         is distinct from lower(coalesce(nullif(r.raw_data->>'email',''),r.raw_data->>'customer_key',''))) then$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'IMPORT_PREVIEW_PATCH_DRIFT:%', left(r.old,60); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;
revoke all on function private.import_continuation_result(uuid,jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 29. A frozen seller that is no longer an ACTIVE Sales Manager is re-resolved
-- (security review, 12 Nov 2026). Section 25's guard refuses to freeze a non-SM,
-- so an application whose latest terms name a legacy OST/SSM/VD/admin seller (or
-- a deactivated SM) could be neither reviewed nor re-frozen. The NEW terms row now
-- takes the originating seller (an active SM); old rows are untouched, and a
-- frozen ACTIVE SM stays frozen (SELLER_OF_RECORD_FROZEN) exactly as before.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='private.application_seller_of_record(uuid,text,uuid,uuid)';
  old text:=$a$  if v_seller is null then return private.resolve_originating_seller(p_actor,p_candidate); end if;$a$;
  new text:=$b$  if v_seller is not null and (private.staff_role_slug(v_seller) is distinct from 'sales_manager'
     or not exists(select 1 from public.staff_users su where su.id=v_seller and su.status='active')) then
    v_seller:=null;
  end if;
  if v_seller is null then return private.resolve_originating_seller(p_actor,p_candidate); end if;$b$;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  if position(old in d)=0 then raise exception 'FROZEN_SELLER_PATCH_DRIFT'; end if;
  execute replace(d,old,new);
end $patch$;
revoke all on function private.application_seller_of_record(uuid,text,uuid,uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 30. An Admin may submit (originate) another person's draft for an SM
-- (security review, 12 Nov 2026). Submission created the RA through the public
-- reserve RPC with the submitter as actor, and that RPC demands
-- sales.card_sales UPDATE for a draft someone else created - which the Admin
-- baseline does not hold - so the submission failed with MUTATION_FORBIDDEN. The
-- reserve body now lives in a PRIVATE function with an explicit
-- p_from_submission parameter; only submit_purchase_application_once passes true.
-- The public RPC is a thin wrapper that always passes false, so a direct
-- reservation keeps the cross-seller gate. Nothing is session-settable.
-- ---------------------------------------------------------------------------
do $patch$
declare d text;
  old_sig text:=$a$FUNCTION public.reserve_application_purchase_once(p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_terms_id uuid, p_input jsonb)$a$;
  new_sig text:=$b$FUNCTION private.reserve_application_purchase_internal(p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_terms_id uuid, p_input jsonb, p_from_submission boolean)$b$;
  old_gate text:=$a$  if v_app.created_by is distinct from p_actor_id then$a$;
  new_gate text:=$b$  if v_app.created_by is distinct from p_actor_id and not p_from_submission then$b$;
  old_call text:=$a$  v_res_id:=public.reserve_application_purchase_once(
    md5(p_request_id::text||'-reserve')::uuid, p_actor_id, v_app.id, v_terms_id,
    jsonb_build_object('reservationDate',v_today,'agreementDate',v_today,'scheduleNotes','[]'::jsonb));$a$;
  new_call text:=$b$  v_res_id:=private.reserve_application_purchase_internal(
    md5(p_request_id::text||'-reserve')::uuid, p_actor_id, v_app.id, v_terms_id,
    jsonb_build_object('reservationDate',v_today,'agreementDate',v_today,'scheduleNotes','[]'::jsonb), true);$b$;
begin
  select pg_get_functiondef('public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  if position(old_sig in d)=0 or position(old_gate in d)=0 then raise exception 'RESERVE_INTERNAL_PATCH_DRIFT:reserve'; end if;
  execute replace(replace(d,old_sig,new_sig),old_gate,new_gate);

  select pg_get_functiondef('public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  if position(old_call in d)=0 then raise exception 'RESERVE_INTERNAL_PATCH_DRIFT:submit'; end if;
  execute replace(d,old_call,new_call);
end $patch$;
revoke all on function private.reserve_application_purchase_internal(uuid,uuid,uuid,uuid,jsonb,boolean) from public, anon, authenticated, service_role;

create or replace function public.reserve_application_purchase_once(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_terms_id uuid, p_input jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
begin
  -- Direct reservation: the cross-seller sales.card_sales update gate always applies.
  return private.reserve_application_purchase_internal(p_request_id,p_actor_id,p_application_id,p_terms_id,p_input,false);
end $$;
revoke all on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 31. The signed-documents bucket is private and bounded even if it pre-existed
-- (section 6 inserted it with ON CONFLICT DO NOTHING, which would have kept a
-- pre-existing public or unlimited bucket as it was).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('afhomes-signed-documents','afhomes-signed-documents',false,10485760,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 32. Only the creator, or an oversight role originating for an SM, may submit
-- (or even price) a DRAFT (security review of section 30, 12 Nov 2026).
-- Section 30 skips the reserve cross-seller gate for the submission path, and
-- submission itself had no creator check, so SM-B could submit SM-A's draft and
-- become its seller of record. Admin, Super Admin and Finance may still
-- originate for any active SM (product owner, 11 Nov 2026). Later stages keep
-- today's read access to the proposal.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; t record;
begin
  for t in select * from (values
    ('public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid)',
     $a$  v_seller:=private.resolve_originating_seller(p_actor_id,p_seller_candidate);$a$,
     $b$  if v_app.created_by is distinct from p_actor_id
     and coalesce(private.staff_role_slug(p_actor_id),'') not in ('admin','super_admin','finance') then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;
  v_seller:=private.resolve_originating_seller(p_actor_id,p_seller_candidate);$b$),
    ('public.purchase_terms_proposal(uuid,uuid,uuid)',
     $a$  v_seller:=private.application_seller_of_record(v_app.id,v_app.status,p_actor_id,p_seller_candidate);$a$,
     $b$  if v_app.status='draft' and v_app.created_by is distinct from p_actor_id
     and coalesce(private.staff_role_slug(p_actor_id),'') not in ('admin','super_admin','finance') then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;
  v_seller:=private.application_seller_of_record(v_app.id,v_app.status,p_actor_id,p_seller_candidate);$b$)
  ) x(sig,old,new) loop
    select pg_get_functiondef(t.sig::regprocedure) into d;
    d:=replace(d,E'\r\n',E'\n');
    if position(t.old in d)=0 then raise exception 'DRAFT_CREATOR_PATCH_DRIFT:%', t.sig; end if;
    execute replace(d,t.old,t.new);
  end loop;
end $patch$;
revoke all on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid) to service_role;
revoke all on function public.purchase_terms_proposal(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.purchase_terms_proposal(uuid,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 33. Re-resolving a non-SM frozen seller stays within that seller's team
-- (security review of section 29, 12 Nov 2026). Admin, Super Admin and Finance
-- may name any active SM; any other actor only lands on a seller on the old
-- frozen seller's own chain (upline or downline). A rival SM gets
-- SELLER_OF_RECORD_FROZEN instead of taking the application over.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; sig text:='private.application_seller_of_record(uuid,text,uuid,uuid)'; r record;
begin
  select pg_get_functiondef(sig::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  for r in select * from (values
    ($a$declare v_seller uuid;$a$, $b$declare v_seller uuid; v_new uuid;$b$),
    ($a$    v_seller:=null;
  end if;$a$,
     $b$    v_new:=private.resolve_originating_seller(p_actor,p_candidate);
    if coalesce(private.staff_role_slug(p_actor),'') not in ('admin','super_admin','finance')
       and not (v_new=any(private.staff_lineage(v_seller)) or v_seller=any(private.staff_lineage(v_new))) then
      raise exception 'SELLER_OF_RECORD_FROZEN' using errcode='55000';
    end if;
    return v_new;
  end if;$b$)
  ) x(old,new) loop
    if position(r.old in d)=0 then raise exception 'FROZEN_SELLER_TEAM_PATCH_DRIFT:%', left(r.old,40); end if;
    d:=replace(d,r.old,r.new);
  end loop;
  execute d;
end $patch$;
revoke all on function private.application_seller_of_record(uuid,text,uuid,uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 34. preview_import_sellers is READ-ONLY (security review of section 27).
-- It authorizes with view access, so it no longer writes the row: the API adds
-- the returned error to the row it is validating. Commit still refuses the row
-- (IMPORT_SELLER_SM_REQUIRED, section 27) whatever the preview said. Only CREATE
-- rows are judged (commit turns only those into a sale), and a null id list
-- returns an empty result.
-- ---------------------------------------------------------------------------
create or replace function public.preview_import_sellers(p_row_ids uuid[], p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_row uuid; r public.customer_import_rows%rowtype; v_code text; v_sponsor uuid; v_sm uuid;
  v_needs boolean; v_out jsonb:='[]'::jsonb;
begin
  if p_row_ids is null then return v_out; end if;
  if cardinality(p_row_ids)>100 then raise exception 'IMPORT_BATCH_LIMIT'; end if;
  foreach v_row in array p_row_ids loop
    perform private.import_source_actor(v_row,p_actor_id,'view');
    select * into strict r from public.customer_import_rows where id=v_row;
    v_needs:=r.action='CREATE' and r.committed_at is null
      and (coalesce((r.normalized_data->>'requireMember')::boolean,false)
           or (r.normalized_data ? 'payment' and r.normalized_data->'payment'<>'null'::jsonb));
    v_sponsor:=null;
    v_code:=upper(btrim(coalesce(r.raw_data->>'seller_code','')));
    if v_code<>'' then
      select rc.sponsor_staff_id into v_sponsor from public.referral_codes rc
        join public.staff_users su on su.id=rc.sponsor_staff_id and su.status='active'
       where rc.code_hash=private.hash_token(v_code) and rc.is_active
         and rc.expires_at>now() and rc.use_count<rc.max_uses;
    end if;
    v_sm:=private.import_team_sales_manager(
      jsonb_build_object('referrer_staff_id',v_sponsor,'sm_staff_id',r.raw_data->>'sm_staff_id'),false);
    v_out:=v_out||jsonb_build_array(jsonb_build_object('rowId',v_row,'sellerStaffId',v_sm,
      'error',case when v_needs and v_sm is null then 'IMPORT_SELLER_SM_REQUIRED' end,
      'message',case when v_needs and v_sm is null then
        'No active Sales Manager can be resolved for this row (or the named Sales Manager is not in the seller''s team). The Sales Manager is the seller of record.' end));
  end loop;
  return v_out;
end $$;
revoke all on function public.preview_import_sellers(uuid[],uuid) from public, anon, authenticated;
grant execute on function public.preview_import_sellers(uuid[],uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 35. Same-file VIP duplicates: two rows that carry NEITHER an email NOR a
-- customer key are different customers (an empty key never matches), so they are
-- flagged like any other pair (security review of section 28).
-- ---------------------------------------------------------------------------
do $patch$
declare d text;
  old text:=$a$     and lower(coalesce(nullif(o.raw_data->>'email',''),o.raw_data->>'customer_key',''))
         is distinct from lower(coalesce(nullif(r.raw_data->>'email',''),r.raw_data->>'customer_key',''))) then$a$;
  new text:=$b$     and not (nullif(lower(coalesce(nullif(o.raw_data->>'email',''),o.raw_data->>'customer_key','')),'') is not null
              and lower(coalesce(nullif(o.raw_data->>'email',''),o.raw_data->>'customer_key',''))
                  = lower(coalesce(nullif(r.raw_data->>'email',''),r.raw_data->>'customer_key','')))) then$b$;
begin
  select pg_get_functiondef('private.import_continuation_result(uuid,jsonb)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  if position(old in d)=0 then raise exception 'VIP_SAME_FILE_PATCH_DRIFT'; end if;
  execute replace(d,old,new);
end $patch$;
revoke all on function private.import_continuation_result(uuid,jsonb) from public, anon, authenticated, service_role;

notify pgrst,'reload schema';
commit;
