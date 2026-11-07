-- Local-only forward change. Live application requires a fresh history/catalog gate.
-- Imported claims never write accounting. Both import and recovery share one transaction.
create table private.customer_import_purchase_sources (
 id uuid primary key default gen_random_uuid(),
 issuer_scope text not null default 'afhomes' check (issuer_scope='afhomes'),
 purchase_reference text not null check(length(purchase_reference) between 1 and 200),
 normalized_reference text not null,
 customer_id uuid not null references public.customers(id) on delete restrict,
 application_id uuid unique references public.customer_applications(id) on delete restrict,
 application_input_hash text,
 created_customer_snapshot jsonb,
 superseded_by uuid references private.customer_import_purchase_sources(id) on delete restrict,
 original_row_id uuid not null references public.customer_import_rows(id) on delete restrict,
 intent_hash text not null,
 created_by uuid not null references public.staff_users(id) on delete restrict,
 created_at timestamptz not null default now(),
 unique(issuer_scope,normalized_reference)
);
create table private.customer_import_source_rows (
 row_id uuid primary key references public.customer_import_rows(id) on delete restrict,
 source_id uuid not null references private.customer_import_purchase_sources(id) on delete restrict,
 source_hash text not null,
 linked_by uuid not null references public.staff_users(id) on delete restrict,
 linked_at timestamptz not null default now()
);
create index customer_import_source_rows_source_idx on private.customer_import_source_rows(source_id);
create table private.customer_import_payment_claims (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references private.customer_import_purchase_sources(id) on delete restrict,
 claim_reference text not null check(length(claim_reference) between 1 and 200),
 normalized_reference text not null,
 purpose text not null check(purpose in ('reservation','down_payment','installment','full')),
 amount text not null check(amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' and amount::numeric>0),
 payment_date date not null,
 method text not null check(method in ('cash','bank_transfer','gcash','maya','card','cheque')),
 bank_reference text not null default '',
 notes text not null default '',
 fingerprint text not null,
 status text not null default 'claim' check(status in ('claim','held','rejected','recorded','matched')),
 payment_id uuid references public.payments(id) on delete restrict,
 reviewed_by uuid references public.staff_users(id) on delete restrict,
 review_reason text,
 proof_id uuid unique,
 proof_path text unique,
 proof_mime text check(proof_mime in ('image/jpeg','image/png','application/pdf')),
 proof_sha256 text check(proof_sha256 ~ '^[a-f0-9]{64}$'),
 proof_uploaded_by uuid references public.staff_users(id) on delete restrict,
 proof_uploaded_at timestamptz,
 updated_at timestamptz not null default now(),
 check ((status in ('recorded','matched'))=(payment_id is not null)),
 unique(source_id,normalized_reference)
);
create index customer_import_claim_fingerprint_idx on private.customer_import_payment_claims(fingerprint);
alter table private.customer_import_purchase_sources enable row level security;
alter table private.customer_import_source_rows enable row level security;
alter table private.customer_import_payment_claims enable row level security;
revoke all on private.customer_import_purchase_sources,private.customer_import_source_rows,private.customer_import_payment_claims from public,anon,authenticated,service_role;

create function private.import_normal_key(p_text text) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select lower(regexp_replace(btrim(coalesce(p_text,'')),'\s+',' ','g'))
$$;
create function private.import_hash(p_value jsonb) returns text
language sql immutable set search_path=pg_catalog,extensions,pg_temp as $$
 select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;
create function private.import_source_actor(p_row uuid,p_actor uuid,p_action text) returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_owner uuid;
begin
 perform private.mutation_actor_role(p_actor,'governance.customer_import',p_action);
 perform private.mutation_actor_role(p_actor,'sales.customers','view');
 select j.created_by into v_owner from public.customer_import_rows r join public.customer_import_jobs j on j.id=r.import_job_id where r.id=p_row;
 if not found then raise exception 'IMPORT_ROW_NOT_FOUND'; end if;
 if v_owner<>p_actor and not (private.has_permission_for_user(p_actor,'sales.customers','update') or private.has_permission_for_user(p_actor,'finance.payment_verification','update')) then
   raise exception 'IMPORT_SOURCE_FORBIDDEN' using errcode='42501';
 end if;
end $$;

create function private.import_customer_for(p_row uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype; v_id uuid; v_email uuid; v_refs uuid[]; v_reference text;
begin
 select * into strict r from public.customer_import_rows where id=p_row;
 v_reference:=nullif(btrim(r.raw_data->>'ra_number'),'');
 select array_agg(c.id) into v_refs from public.customers c where v_reference is not null and (c.customer_number=v_reference or c.ra_number=v_reference);
 if cardinality(v_refs)>1 then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 v_id:=v_refs[1];
 select id into v_email from public.customers where lower(email)=lower(r.raw_data->>'email');
 if v_id is not null and (v_email is distinct from v_id or r.customer_id is not null and r.customer_id<>v_id) then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 if r.customer_id is not null and v_email is distinct from r.customer_id then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 if v_reference is not null and v_id is null and v_email is not null and r.customer_id is null then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED'; end if;
 if v_reference like 'AF-CUS-%' and v_id is null and r.customer_id is null then raise exception 'IMPORT_UNKNOWN_CUSTOMER_ID'; end if;
 return coalesce(r.customer_id,v_id,v_email);
end $$;

create function private.import_target_version(p_row uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_customer uuid; v_source uuid; v_reference text; v_raw jsonb;
begin
 v_customer:=private.import_customer_for(p_row);
 select raw_data into strict v_raw from public.customer_import_rows where id=p_row;
 v_reference:=private.import_normal_key(coalesce(nullif(v_raw->>'purchase_reference',''),'legacy-import-'||p_row::text));
 select source_id into v_source from private.customer_import_source_rows where row_id=p_row;
 if v_source is null then select id into v_source from private.customer_import_purchase_sources where issuer_scope='afhomes' and normalized_reference=v_reference;end if;
 return private.import_hash(jsonb_build_object(
 'customer',(select to_jsonb(c) from public.customers c where id=v_customer),
 'source',(select to_jsonb(s) from private.customer_import_purchase_sources s where id=v_source),
 'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.customer_applications a where customer_id=v_customer),'[]'),
 'holders',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.customer_application_holders h join public.customer_applications a on a.id=h.application_id where a.customer_id=v_customer),'[]'),
 'terms',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_application_purchase_terms t where customer_id=v_customer),'[]'),
 'reservations',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.reservation_agreements a where customer_id=v_customer),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where customer_id=v_customer),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from private.customer_import_payment_claims c where source_id=v_source),'[]'),
 'team',coalesce((select jsonb_agg(to_jsonb(s) order by s.staff_id,s.role_slug) from public.match_company_import_staff(array[v_raw->>'vd_name',v_raw->>'ssm_name',v_raw->>'sm_name',v_raw->>'referrer_name',v_raw->>'recommender_name']) s),'[]')
 ));
end $$;

create function private.import_source_hash(p_row uuid,p_proposed_facts jsonb default null) returns text
language sql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
 select private.import_hash(jsonb_build_object('raw',raw_data,'normalized',normalized_data-'continuationPreview','recoveryFacts',p_proposed_facts)) from public.customer_import_rows where id=p_row
$$;

create function private.import_reservation_application(p_row uuid,p_customer uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare reference text;a public.reservation_agreements%rowtype;fields jsonb;
begin
 select raw_data into fields from public.customer_import_rows where id=p_row;
 reference:=nullif(btrim(fields->>'existing_reservation_reference'),'');
 if reference is null then return null;end if;
 select * into a from public.reservation_agreements where reservation_number=reference;
 if not found or a.customer_id is distinct from p_customer or a.customer_application_id is null then raise exception 'IMPORT_RESERVATION_REFERENCE_REVIEW_REQUIRED';end if;
 if (nullif(fields->>'stated_total','') is not null and (fields->>'stated_total')::numeric<>a.total_price_snapshot::numeric)
  or (nullif(fields->>'stated_rf','') is not null and (fields->>'stated_rf')::numeric<>a.reservation_fee_snapshot::numeric)
  or (nullif(fields->>'vip_tier','') is not null and upper(fields->>'vip_tier')<>a.tier_snapshot)
  or (nullif(fields->>'stated_payment_scheme_code','') is not null and fields->>'stated_payment_scheme_code'<>a.payment_scheme_snapshot) then raise exception 'IMPORT_HISTORICAL_TERMS_REVIEW_REQUIRED';end if;
 return a.customer_application_id;
end $$;
revoke all on function private.import_reservation_application(uuid,uuid) from public,anon,authenticated,service_role;

create function private.import_check_team(p_raw jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare k text; m record; v_ref uuid[]; v_vip uuid[]; v_parents uuid[]:='{}'; expected text; ancestor uuid; ancestor_role text; previous_rank integer; current_rank integer;
begin
 foreach k in array array['vd_name','ssm_name','sm_name','referrer_name','recommender_name'] loop
  if nullif(p_raw->>k,'') is null then continue; end if;
  expected:=case k when 'vd_name' then 'vice_director' when 'ssm_name' then 'senior_sales_manager' when 'sm_name' then 'sales_manager' else 'ost' end;
  select * into m from public.match_company_import_staff(array[p_raw->>k]) candidate where candidate.staff_id::text=p_raw->>replace(k,'_name','_staff_id') and candidate.role_slug=expected;
  if not found or (m.match_count<>1 and p_raw->>'workbook_format'<>'company_v2') then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED'; end if;
  if cardinality(m.ancestor_ids)<>(select count(distinct a) from unnest(m.ancestor_ids) a) or m.staff_id=any(m.ancestor_ids) then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED'; end if;
  previous_rank:=case m.role_slug when 'vice_director' then 0 when 'senior_sales_manager' then 1 when 'sales_manager' then 2 when 'ost' then 3 end;
  foreach ancestor in array m.ancestor_ids loop
   select case when count(*)=1 then min(r.slug) end into ancestor_role from public.staff_users u join public.staff_role_assignments sa on sa.staff_id=u.id join public.roles r on r.id=sa.role_id and r.is_active where u.id=ancestor and u.status='active';
   current_rank:=case ancestor_role when 'vice_director' then 0 when 'senior_sales_manager' then 1 when 'sales_manager' then 2 when 'ost' then 3 end;
   if current_rank is null or current_rank>=previous_rank then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED';end if;
   previous_rank:=current_rank;
  end loop;
  if previous_rank<>0 then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED';end if;
  if k in ('vd_name','ssm_name','sm_name') then
   if exists(select 1 from unnest(v_parents) a where not a=any(m.ancestor_ids)) then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED'; end if;
   v_parents:=array_append(v_parents,m.staff_id);
  elsif k='referrer_name' then
   if exists(select 1 from unnest(v_parents) a where not a=any(m.ancestor_ids)) then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED'; end if;
   v_ref:=m.ancestor_ids;
  else v_vip:=m.ancestor_ids;
  end if;
 end loop;
 if v_ref is not null and v_vip is not null and (cardinality(v_ref)=0 or cardinality(v_vip)=0 or v_ref[cardinality(v_ref)] is distinct from v_vip[cardinality(v_vip)]) then raise exception 'IMPORT_GENEALOGY_CONFLICT'; end if;
end $$;

create function private.import_continuation_result(p_row uuid,p_proposed_facts jsonb default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype; s private.customer_import_purchase_sources%rowtype; a public.reservation_agreements%rowtype;
 v_customer uuid; v_missing jsonb:='[]'; v_stage text:='application'; v_path text; v_label text:='Complete imported application';v_proposal jsonb;
begin
 select * into strict r from public.customer_import_rows where id=p_row;
 select src.* into s from private.customer_import_source_rows l join private.customer_import_purchase_sources src on src.id=l.source_id where l.row_id=p_row;
 v_customer:=coalesce(s.customer_id,private.import_customer_for(p_row));
 if s.application_id is null then s.application_id:=private.import_reservation_application(p_row,v_customer);end if;
 if s.application_id is null then
  v_missing:=jsonb_build_array('Complete and review the application, including actual acknowledgment date, consent and required holder fields.');
  v_path:='/admin/customers/applications/new?customerId='||coalesce(v_customer::text,'')||'&importRowId='||p_row::text;
 else
  select * into a from public.reservation_agreements where customer_application_id=s.application_id order by created_at desc limit 1;
  if a.id is not null then
   if a.status='cancelled' then v_stage:='review';v_path:='/admin/sales/reservations/'||a.id::text;v_label:='Review cancelled reservation';v_missing:=jsonb_build_array('This reservation was cancelled; review its preserved history before any new action.');
   elsif a.sale_id is not null and exists(select 1 from public.card_sales where id=a.sale_id and status='active') then v_stage:='complete';v_path:='/admin/customers/'||v_customer::text;v_label:='View active customer';
   elsif a.sale_id is not null and exists(select 1 from public.card_sales where id=a.sale_id and status='cancelled') then v_stage:='review';v_path:='/admin/customers/'||v_customer::text;v_label:='Review cancelled purchase';
   elsif a.sale_id is not null then v_stage:='activation';v_path:='/admin/finance/activation';v_label:='Continue activation';
   elsif a.status='executed' then v_stage:='finance';v_path:='/admin/finance/payments';v_label:='Review payments and continue collection';
   else v_stage:='reservation';v_path:='/admin/sales/reservations/'||a.id::text;v_label:='Complete reservation';end if;
  else v_path:='/admin/customers/applications/'||s.application_id::text;v_label:='Continue application';
   if exists(select 1 from public.customer_applications where id=s.application_id and status in ('cancelled','rejected')) then v_stage:='review';v_label:='Review existing application';v_missing:=jsonb_build_array('The existing application is cancelled or rejected; review it before continuing.');end if;
  end if;
 end if;
 v_proposal:=case when s.id is not null and s.application_id is not null then jsonb_build_object('fills','[]'::jsonb,'conflicts','[]'::jsonb) else private.import_customer_proposal(p_row,p_proposed_facts) end;
 if jsonb_array_length(v_proposal->'conflicts')>0 then v_stage:='review';v_path:='/admin/customers/'||v_customer::text;v_label:='Review conflicting customer details';end if;
 return jsonb_build_object('rowId',p_row,'sourceId',s.id,'customerId',v_customer,'applicationId',s.application_id,'reservationId',a.id,'saleId',a.sale_id,'stage',v_stage,
 'missingRequirements',v_missing,'conflicts',v_proposal->'conflicts','proposedFields',coalesce((select jsonb_agg(case when item->>'field' like '%tin%' then jsonb_build_object('field',item->>'field','value','Private value supplied') else item end) from jsonb_array_elements(v_proposal->'fills') item),'[]'::jsonb),'nextAction',jsonb_build_object('label',v_label,'path',v_path),
 'expectedSourceHash',private.import_source_hash(p_row,p_proposed_facts),'expectedTargetVersion',private.import_target_version(p_row),
 'claimCount',case when s.id is null then jsonb_array_length(coalesce(p_proposed_facts->'paymentClaims',r.normalized_data->'paymentClaims','[]')) else (select count(*) from private.customer_import_payment_claims where source_id=s.id) end,
 'expectedTeamVersion',private.import_hash(coalesce((select jsonb_agg(to_jsonb(team) order by team.staff_id,team.role_slug) from public.match_company_import_staff(array[r.raw_data->>'vd_name',r.raw_data->>'ssm_name',r.raw_data->>'sm_name',r.raw_data->>'referrer_name',r.raw_data->>'recommender_name']) team),'[]'::jsonb)),
 'customerName',(select trim(concat_ws(' ',first_name,middle_name,last_name,suffix)) from public.customers where id=v_customer),
 'purchaseReference',coalesce(s.purchase_reference,r.raw_data->>'purchase_reference'),
 'purchaseStatement',jsonb_build_object('tier',coalesce(p_proposed_facts->'company'->>'statedVipPackage',r.normalized_data->'customerFacts'->'company'->>'statedVipPackage',r.normalized_data->'company'->>'statedVipPackage'),'total',coalesce(p_proposed_facts->'company'->>'statedTotalAmount',r.normalized_data->'customerFacts'->'company'->>'statedTotalAmount',r.normalized_data->'company'->>'statedTotalAmount'),'reservationFee',coalesce(p_proposed_facts->'company'->>'statedRf',r.normalized_data->'customerFacts'->'company'->>'statedRf',r.normalized_data->'company'->>'statedRf')));
end $$;

create function public.preview_customer_import_continuation(p_row_id uuid,p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin perform private.import_source_actor(p_row_id,p_actor_id,'view');return private.import_continuation_result(p_row_id);end $$;

create function private.commit_customer_import_source(p_row_id uuid,p_actor_id uuid,p_expected_source_hash text,p_expected_target_version text,p_draft jsonb default null,p_proposed_facts jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype; s private.customer_import_purchase_sources%rowtype; c public.customers%rowtype;
 v_source uuid; v_customer uuid; v_reference text; v_intent text; v_fields jsonb; v_company jsonb; v_person jsonb; v_claim jsonb;v_created boolean:=false;v_existing_application uuid;
 v_out jsonb; v_key text; v_column text; v_value jsonb; v_existing jsonb; v_claim_id uuid; v_fingerprint text;
begin
 perform private.import_source_actor(p_row_id,p_actor_id,'update');
 if p_draft is not null then perform private.mutation_actor_role(p_actor_id,'sales.customers','create');end if;
 select * into strict r from public.customer_import_rows where id=p_row_id for update;
 if r.raw_data->>'workbook_format' not in ('company_v1','company_v2') or r.validation_status='error' then raise exception 'IMPORT_ROW_INVALID'; end if;
 if not exists(select 1 from public.customer_import_jobs where id=r.import_job_id and status in ('ready','validated','committing','completed','completed_with_errors')) then raise exception 'IMPORT_JOB_NOT_COMMITTABLE'; end if;
 if private.import_source_hash(p_row_id,p_proposed_facts) is distinct from p_expected_source_hash then raise exception 'IMPORT_SOURCE_CHANGED';end if;
 v_reference:=nullif(btrim(r.raw_data->>'purchase_reference'),'');
 if p_draft is not null and v_reference is null then
  v_reference:=nullif(btrim(p_draft->'header'->>'importPurchaseReference'),'');
  if v_reference is null then raise exception 'IMPORT_PURCHASE_REFERENCE_REQUIRED';end if;
 end if;
 if p_draft is not null then p_draft:=jsonb_set(p_draft,'{header}',(p_draft->'header')-'importPurchaseReference');end if;
 if v_reference is null then v_reference:='legacy-import-'||p_row_id::text;end if;
 perform pg_advisory_xact_lock(hashtextextended('import-source:afhomes:'||private.import_normal_key(v_reference),0));
 perform pg_advisory_xact_lock(hashtextextended('company-email:'||lower(r.raw_data->>'email'),0));
 v_customer:=private.import_customer_for(p_row_id);
 if v_customer is not null then
  select * into c from public.customers where id=v_customer for update;
  perform 1 from public.customer_applications where customer_id=v_customer order by id for update;
  perform 1 from public.reservation_agreements where customer_id=v_customer order by id for update;
 end if;
 select * into s from private.customer_import_purchase_sources where issuer_scope='afhomes' and normalized_reference=private.import_normal_key(v_reference) for update;
 v_existing_application:=private.import_reservation_application(p_row_id,v_customer);
 if s.application_id is not null and v_existing_application is not null and s.application_id<>v_existing_application then raise exception 'IMPORT_SOURCE_IDENTITY_CONFLICT';end if;
 v_person:=coalesce(p_proposed_facts->'person',r.normalized_data->'customerFacts'->'person',r.normalized_data->'person');v_company:=coalesce(p_proposed_facts->'company',r.normalized_data->'customerFacts'->'company',r.normalized_data->'company','{}');
 v_intent:=private.import_hash(jsonb_build_object('person',v_person,'company',v_company,'claims',coalesce(p_proposed_facts->'paymentClaims',r.normalized_data->'paymentClaims','[]'),'customerReference',r.raw_data->>'ra_number','existingReservation',nullif(r.raw_data->>'existing_reservation_reference','')));
 if s.id is not null and (s.customer_id is distinct from v_customer or s.intent_hash<>v_intent) then raise exception 'IMPORT_SOURCE_IDENTITY_CONFLICT';end if;
 -- Canonical successful retries return the source receipt; they cannot reapply edits.
 if (p_draft is null or s.application_id is not null and s.application_input_hash=private.import_hash(p_draft)) and exists(select 1 from private.customer_import_source_rows where row_id=p_row_id and source_id=s.id and source_hash=p_expected_source_hash) then return private.import_continuation_result(p_row_id,p_proposed_facts);end if;
 if private.import_target_version(p_row_id) is distinct from p_expected_target_version then
  -- A sibling intake may have created this exact untouched customer after the same batch preview.
  if p_draft is not null or r.normalized_data->'continuationPreview'->>'expectedTargetVersion' is distinct from p_expected_target_version
   or r.normalized_data->'continuationPreview'->'customerId' is distinct from 'null'::jsonb
   or r.normalized_data->'continuationPreview'->>'expectedTeamVersion' is distinct from private.import_hash(coalesce((select jsonb_agg(to_jsonb(team) order by team.staff_id,team.role_slug) from public.match_company_import_staff(array[r.raw_data->>'vd_name',r.raw_data->>'ssm_name',r.raw_data->>'sm_name',r.raw_data->>'referrer_name',r.raw_data->>'recommender_name']) team),'[]'::jsonb))
   or not exists(select 1 from private.customer_import_purchase_sources sibling join public.customer_import_rows original on original.id=sibling.original_row_id where sibling.customer_id=v_customer and original.import_job_id=r.import_job_id and sibling.created_customer_snapshot=to_jsonb(c))
   or exists(select 1 from public.customer_applications where customer_id=v_customer)
   or exists(select 1 from public.reservation_agreements where customer_id=v_customer)
   or exists(select 1 from public.payments where customer_id=v_customer)
   or exists(select 1 from public.memberships where customer_id=v_customer)
   or exists(select 1 from private.customer_import_purchase_sources sibling join public.customer_import_rows original on original.id=sibling.original_row_id where sibling.customer_id=v_customer and original.import_job_id<>r.import_job_id)
   then raise exception 'IMPORT_TARGET_CHANGED';end if;
 end if;
 perform private.import_check_team(r.raw_data);
 if r.normalized_data->>'customerStatus'<>'prospect' or r.normalized_data->>'requireMember'<>'false' or coalesce(r.normalized_data->'payment','null')<>'null'::jsonb then raise exception 'IMPORT_ROW_INVALID';end if;
 if v_customer is null then
  v_created:=true;
  perform private.mutation_actor_role(p_actor_id,'sales.customers','create');
  v_out:=public.import_legacy_member(r.import_job_id,p_actor_id,v_person||jsonb_build_object('company',v_company,'customerStatus','prospect'),null,'[]',null,false);
  v_customer:=(v_out->>'customerId')::uuid;
  select * into c from public.customers where id=v_customer for update;
 else
  v_fields:=private.import_customer_proposal(p_row_id,p_proposed_facts);
  if jsonb_array_length(v_fields->'conflicts')>0 then raise exception 'IMPORT_CUSTOMER_FIELD_CONFLICT';end if;
  for v_claim in select value from jsonb_array_elements(v_fields->'fills') loop
   v_column:=v_claim->>'field';
   execute format('update public.customers set %I=(select %I from jsonb_populate_record(null::public.customers,$1)) where id=$2',v_column,v_column)
    using jsonb_build_object(v_column,v_claim->'value'),v_customer;
  end loop;
 end if;
 if nullif(r.raw_data->>'referrer_staff_id','') is not null then
  if c.referred_by_staff_id is not null and c.referred_by_staff_id::text<>r.raw_data->>'referrer_staff_id' then raise exception 'IMPORT_REFERRAL_CONFLICT';end if;
  update public.customers set referred_by_staff_id=(r.raw_data->>'referrer_staff_id')::uuid where id=v_customer and referred_by_staff_id is null;
 end if;
 if s.id is null then
  insert into private.customer_import_purchase_sources(purchase_reference,normalized_reference,customer_id,original_row_id,intent_hash,created_by,created_customer_snapshot,application_id)
  values(v_reference,private.import_normal_key(v_reference),v_customer,p_row_id,v_intent,p_actor_id,case when v_created then (select to_jsonb(snapshot) from public.customers snapshot where id=v_customer) end,v_existing_application) returning * into s;
 end if;
 -- Replace only an untouched provisional intake link; its source/evidence remain retained.
 if p_draft is not null and nullif(r.raw_data->>'purchase_reference','') is null then
  select source_id into v_source from private.customer_import_source_rows where row_id=p_row_id;
  if v_source is not null and v_source<>s.id then
   if not exists(select 1 from private.customer_import_purchase_sources old where old.id=v_source and old.customer_id=v_customer and old.application_id is null and old.purchase_reference='legacy-import-'||p_row_id::text)
    or exists(select 1 from private.customer_import_payment_claims where source_id=v_source and (payment_id is not null or proof_id is not null)) then raise exception 'IMPORT_SOURCE_IDENTITY_CONFLICT';end if;
   update private.customer_import_purchase_sources set superseded_by=s.id where id=v_source;
   update private.customer_import_source_rows set source_id=s.id,source_hash=p_expected_source_hash,linked_by=p_actor_id,linked_at=now() where row_id=p_row_id;
   insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'CUSTOMER_IMPORT_SOURCE_RECONCILED','customer_import_row',p_row_id::text,jsonb_build_object('previousSourceId',v_source,'sourceId',s.id));
  end if;
 end if;
 insert into private.customer_import_source_rows(row_id,source_id,source_hash,linked_by) values(p_row_id,s.id,p_expected_source_hash,p_actor_id)
 on conflict(row_id) do nothing;
 if not exists(select 1 from private.customer_import_source_rows where row_id=p_row_id and source_id=s.id) then raise exception 'IMPORT_SOURCE_IDENTITY_CONFLICT';end if;
 for v_claim in select value from jsonb_array_elements(coalesce(p_proposed_facts->'paymentClaims',r.normalized_data->'paymentClaims','[]')) loop
  if v_claim->>'amount' !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' or (v_claim->>'amount')::numeric<=0 or (v_claim->>'date')::date>current_date then raise exception 'IMPORT_CLAIM_INVALID';end if;
  v_fingerprint:=private.import_hash(jsonb_build_array(v_customer,private.import_normal_key(v_claim->>'reference'),v_claim->>'method',v_claim->>'date',private.money((v_claim->>'amount')::numeric),'PHP'));
  insert into private.customer_import_payment_claims(source_id,claim_reference,normalized_reference,purpose,amount,payment_date,method,bank_reference,notes,fingerprint)
  values(s.id,v_claim->>'paymentKey',private.import_normal_key(v_claim->>'paymentKey'),v_claim->>'purpose',private.money((v_claim->>'amount')::numeric),(v_claim->>'date')::date,v_claim->>'method',coalesce(v_claim->>'reference',''),coalesce(v_claim->>'notes',''),v_fingerprint)
  on conflict(source_id,normalized_reference) do nothing;
 end loop;
 if p_draft is not null then
  perform private.mutation_actor_role(p_actor_id,'sales.customers','create');
  for v_key,v_column in select * from (values('vd_staff_id','svdStaffId'),('ssm_staff_id','ssmStaffId'),('sm_staff_id','smStaffId'),('referrer_staff_id','referrerStaffId')) as mapping(raw_key,header_key) loop
   if nullif(r.raw_data->>v_key,'') is not null and r.raw_data->>v_key is distinct from p_draft->'header'->>v_column then raise exception 'IMPORT_STAFF_REVIEW_REQUIRED';end if;
  end loop;
  if (p_draft->'header'->>'customerId')::uuid<>v_customer then raise exception 'IMPORT_IDENTITY_REVIEW_REQUIRED';end if;
  if s.application_id is not null and s.application_input_hash is distinct from private.import_hash(p_draft) then raise exception 'IMPORT_APPLICATION_ALREADY_LINKED';end if;
  if s.application_id is null then
   v_source:=public.save_customer_application(null,p_actor_id,p_draft->'header',p_draft->'primary',nullif(p_draft->'secondary','null'::jsonb));
   v_out:=private.purchase_terms_for_application(v_source,null,'submission');
   if (nullif(v_company->>'statedTotalAmount','') is not null and (v_company->>'statedTotalAmount')::numeric<>(v_out->'terms'->>'totalPrice')::numeric)
    or (nullif(v_company->>'statedRf','') is not null and (v_company->>'statedRf')::numeric<>(v_out->'terms'->>'reservationFee')::numeric)
    or (nullif(v_company->>'statedVipPackage','') is not null and upper(v_company->>'statedVipPackage')<>v_out->'terms'->>'tier')
    or (nullif(r.raw_data->>'stated_payment_scheme_code','') is not null and r.raw_data->>'stated_payment_scheme_code'<>v_out->'terms'->>'paymentScheme') then raise exception 'IMPORT_HISTORICAL_TERMS_REVIEW_REQUIRED';end if;
   update private.customer_import_purchase_sources set application_id=v_source,application_input_hash=private.import_hash(p_draft) where id=s.id;
  end if;
 end if;
 update public.customer_import_rows set customer_id=v_customer,committed_at=coalesce(committed_at,now()) where id=p_row_id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'CUSTOMER_IMPORT_CONTINUED','customer_import_row',p_row_id::text,jsonb_build_object('sourceId',s.id,'customerId',v_customer,'claimsCreated',jsonb_array_length(coalesce(p_proposed_facts->'paymentClaims',r.normalized_data->'paymentClaims','[]'))));
 return private.import_continuation_result(p_row_id,p_proposed_facts);
end $$;

-- Canonical proposal is private because fill values can include write-only facts.
create function private.import_customer_proposal(p_row uuid,p_proposed_facts jsonb default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype;c public.customers%rowtype;v_id uuid;facts jsonb;mapping jsonb;pair record;
 value jsonb;previous jsonb;fills jsonb:='[]';conflicts jsonb:='[]';address jsonb;merged jsonb;changed boolean:=false;
begin
 select * into strict r from public.customer_import_rows where id=p_row;
 v_id:=private.import_customer_for(p_row);
 if v_id is null then return jsonb_build_object('fills',fills,'conflicts',conflicts);end if;
 select * into c from public.customers where id=v_id;
 -- The manifest enumerates columns; no source key becomes an SQL identifier.
 mapping:='{"raNumber":"ra_number","companyStatus":"company_status","citizenship":"citizenship","civilStatus":"civil_status","tinNumber":"tin_number","occupationBusinessName":"occupation_business_name","officeBusinessAddress":"office_business_address","employedPosition":"employed_position","supplementaryFullName":"supplementary_full_name","supplementaryAddress":"supplementary_address","supplementaryBirthday":"supplementary_birthday","supplementaryGender":"supplementary_gender","supplementaryCitizenship":"supplementary_citizenship","supplementaryCivilStatus":"supplementary_civil_status","supplementaryTinNumber":"supplementary_tin_number","supplementaryMobile":"supplementary_mobile","supplementaryEmail":"supplementary_email","supplementaryLandline":"supplementary_landline","supplementaryOccupationBusinessName":"supplementary_occupation_business_name","supplementaryOfficeAddress":"supplementary_office_address","supplementaryPosition":"supplementary_position","svdName":"svd_name","ssmName":"ssm_name","smName":"sm_name","referrerName":"referrer_name","vipRecommenderName":"vip_recommender_name","relatedContactNo":"related_contact_no","relatedEmail":"related_email","statedVipPackage":"stated_vip_package","statedPaymentTerms":"stated_payment_terms","statedRegularPrice":"stated_regular_price","statedDiscount":"stated_discount","statedTotalAmount":"stated_total_amount","statedRf":"stated_rf","statedPaymentType":"stated_payment_type","statedRefNo":"stated_ref_no","statedPaymentDate":"stated_payment_date"}';
 facts:=coalesce(p_proposed_facts->'company',r.normalized_data->'customerFacts'->'company',r.normalized_data->'company','{}');
 for pair in select e.key,e.value#>>'{}' as column_name from jsonb_each(mapping) e loop
  value:=facts->pair.key;previous:=to_jsonb(c)->pair.column_name;
  if value is null or value in ('null'::jsonb,'""'::jsonb) then continue;end if;
  if pair.key='raNumber' and value#>>'{}'=c.customer_number then continue;end if;
  if previous is null or previous in ('null'::jsonb,'""'::jsonb) then fills:=fills||jsonb_build_array(jsonb_build_object('field',pair.column_name,'value',value));
  elsif previous<>value then
   -- Later purchases keep their own statements; preserve the original customer snapshot.
   if (pair.column_name like 'stated_%' or pair.column_name='company_status') and exists(select 1 from private.customer_import_purchase_sources source where source.customer_id=c.id and source.normalized_reference<>private.import_normal_key(coalesce(nullif(r.raw_data->>'purchase_reference',''),'legacy-import-'||p_row::text))) then continue;end if;
   if pair.key in ('statedRegularPrice','statedDiscount','statedTotalAmount','statedRf') and (previous#>>'{}') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (value#>>'{}') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (previous#>>'{}')::numeric=(value#>>'{}')::numeric then continue;end if;
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('field',pair.column_name,'message','Imported value conflicts with the current customer record. No current value will be replaced.'));
  end if;
 end loop;
 facts:=coalesce(p_proposed_facts->'person',r.normalized_data->'customerFacts'->'person',r.normalized_data->'person','{}');
 mapping:='{"firstName":"first_name","middleName":"middle_name","lastName":"last_name","suffix":"suffix","birthDate":"birth_date","gender":"gender","email":"email","phone":"phone","landline":"landline"}';
 for pair in select e.key,e.value#>>'{}' as column_name from jsonb_each(mapping) e loop
  value:=facts->pair.key;previous:=to_jsonb(c)->pair.column_name;
  if value is null or value in ('null'::jsonb,'""'::jsonb) then continue;end if;
  if previous is null or previous in ('null'::jsonb,'""'::jsonb) then fills:=fills||jsonb_build_array(jsonb_build_object('field',pair.column_name,'value',value));
  elsif private.import_normal_key(previous#>>'{}')<>private.import_normal_key(value#>>'{}') then
   if pair.key='phone' and regexp_replace(regexp_replace(previous#>>'{}','\D','','g'),'^63','0')=regexp_replace(regexp_replace(value#>>'{}','\D','','g'),'^63','0') then continue;end if;
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('field',pair.column_name,'message','Imported identity conflicts with the current customer record. Review required.'));
  end if;
 end loop;
 address:=coalesce(facts->'address','{}');merged:=coalesce(c.address,'{}');
 for pair in select e.key,e.value from jsonb_each(address) e loop
  if pair.key not in ('line1','line2','province','city','barangay','postalCode','provinceCode','cityMunicipalityCode','barangayCode','countryCode') or pair.value in ('null'::jsonb,'""'::jsonb) then continue;end if;
  previous:=merged->pair.key;
  if previous is null or previous in ('null'::jsonb,'""'::jsonb) then merged:=merged||jsonb_build_object(pair.key,pair.value);changed:=true;
  elsif previous<>pair.value then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('field','address.'||pair.key,'message','Imported address conflicts with the current customer record. Review required.'));end if;
 end loop;
 if changed then fills:=fills||jsonb_build_array(jsonb_build_object('field','address','value',merged));end if;
 return jsonb_build_object('fills',fills,'conflicts',conflicts);
end $$;

create function public.prepare_customer_import_batch(p_row_ids uuid[],p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_row uuid;v_preview jsonb;v_result jsonb:='[]';v_error text;
begin
 if cardinality(p_row_ids)>100 then raise exception 'IMPORT_BATCH_LIMIT';end if;
 foreach v_row in array p_row_ids loop
  perform private.import_source_actor(v_row,p_actor_id,'create');
  perform 1 from public.customer_import_rows where id=v_row and committed_at is null for update;
  if not found then raise exception 'IMPORT_ROW_NOT_EDITABLE';end if;
  begin
   v_preview:=private.import_continuation_result(v_row);
   update public.customer_import_rows set normalized_data=jsonb_set(normalized_data,'{continuationPreview}',v_preview) where id=v_row;
   v_result:=v_result||jsonb_build_array(v_preview);
  exception when raise_exception then
   v_error:=case when SQLERRM in ('IMPORT_IDENTITY_REVIEW_REQUIRED','IMPORT_UNKNOWN_CUSTOMER_ID') then SQLERRM else 'IMPORT_PREVIEW_REVIEW_REQUIRED' end;
   update public.customer_import_rows set validation_status='error',action='CONFLICT',validation_errors=validation_errors||jsonb_build_array(jsonb_build_object('field','customer_id','message',v_error)) where id=v_row;
   v_result:=v_result||jsonb_build_array(jsonb_build_object('rowId',v_row,'error',v_error));
  end;
 end loop;
 return v_result;
end $$;
revoke all on function public.prepare_customer_import_batch(uuid[],uuid) from public,anon,authenticated;
grant execute on function public.prepare_customer_import_batch(uuid[],uuid) to service_role;
revoke all on function private.import_customer_proposal(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.continue_customer_import_once(p_row_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_source_hash text,p_expected_target_version text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED';end if;
 return private.commit_customer_import_source(p_row_id,p_actor_id,p_expected_source_hash,p_expected_target_version);
end $$;

-- Preserve the actual predecessor for unrelated legacy import formats.
do $$declare definition text;begin
 select pg_get_functiondef('public.commit_customer_import_row(uuid,uuid)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION public.commit_customer_import_row(', 'FUNCTION private.commit_customer_import_before_continuation(');
end $$;
create or replace function public.commit_customer_import_row(p_row_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r public.customer_import_rows%rowtype; v_result jsonb;
begin
 select * into strict r from public.customer_import_rows where id=p_row_id;
 if r.raw_data->>'workbook_format' in ('company_v1','company_v2') and r.normalized_data ? 'continuationPreview' then
  v_result:=private.commit_customer_import_source(p_row_id,p_actor_id,r.normalized_data->'continuationPreview'->>'expectedSourceHash',r.normalized_data->'continuationPreview'->>'expectedTargetVersion');
  return jsonb_build_object('customerId',v_result->'customerId','membershipId',null,'saleId',v_result->'saleId','action',case when r.customer_id is null then 'CREATE' else 'UPDATE' end,'importContinuation',v_result);
 end if;
 return private.commit_customer_import_before_continuation(p_row_id,p_actor_id);
end $$;

revoke all on function public.preview_customer_import_continuation(uuid,uuid),public.continue_customer_import_once(uuid,uuid,uuid,text,text),public.commit_customer_import_row(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preview_customer_import_continuation(uuid,uuid),public.continue_customer_import_once(uuid,uuid,uuid,text,text),public.commit_customer_import_row(uuid,uuid) to service_role;
revoke all on function private.import_normal_key(text),private.import_hash(jsonb),private.import_source_actor(uuid,uuid,text),private.import_customer_for(uuid),private.import_target_version(uuid),private.import_source_hash(uuid,jsonb),private.import_check_team(jsonb),private.import_continuation_result(uuid,jsonb),private.commit_customer_import_source(uuid,uuid,text,text,jsonb,jsonb),private.commit_customer_import_before_continuation(uuid,uuid) from public,anon,authenticated,service_role;

-- Legacy recovery supplies freshly normalized server-side facts without rewriting source evidence.
create function public.preview_customer_import_continuation(p_row_id uuid,p_actor_id uuid,p_proposed_facts jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin perform private.import_source_actor(p_row_id,p_actor_id,'view');return private.import_continuation_result(p_row_id,p_proposed_facts);end $$;
create function public.continue_customer_import_once(p_row_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_source_hash text,p_expected_target_version text,p_proposed_facts jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED';end if;
 return private.commit_customer_import_source(p_row_id,p_actor_id,p_expected_source_hash,p_expected_target_version,null,p_proposed_facts);
end $$;
revoke all on function public.preview_customer_import_continuation(uuid,uuid,jsonb),public.continue_customer_import_once(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.preview_customer_import_continuation(uuid,uuid,jsonb),public.continue_customer_import_once(uuid,uuid,uuid,text,text,jsonb) to service_role;

create function public.complete_import_application_once(p_row_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_source_hash text,p_expected_target_version text,p_header jsonb,p_primary jsonb,p_secondary jsonb,p_proposed_facts jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED';end if;
 return private.commit_customer_import_source(p_row_id,p_actor_id,p_expected_source_hash,p_expected_target_version,
  jsonb_build_object('header',p_header,'primary',p_primary,'secondary',p_secondary),p_proposed_facts);
end $$;

create function public.customer_import_continuations(p_actor_id uuid,p_customer_id uuid default null,p_limit integer default 25,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare r record;result jsonb:='[]';
begin
 perform private.mutation_actor_role(p_actor_id,'governance.customer_import','view');
 perform private.mutation_actor_role(p_actor_id,'sales.customers','view');
 if p_limit not between 1 and 100 or p_offset<0 then raise exception 'IMPORT_BATCH_LIMIT';end if;
 for r in select visible.id from (
 select distinct on (coalesce(link.source_id,ir.id)) ir.id,ir.committed_at
 from public.customer_import_rows ir join public.customer_import_jobs j on j.id=ir.import_job_id
 left join private.customer_import_source_rows link on link.row_id=ir.id
 where ir.committed_at is not null and ir.raw_data->>'workbook_format' in ('company_v1','company_v2')
 and (p_customer_id is null or ir.customer_id=p_customer_id)
 and (j.created_by=p_actor_id or private.has_permission_for_user(p_actor_id,'sales.customers','update') or private.has_permission_for_user(p_actor_id,'finance.payment_verification','update'))
 order by coalesce(link.source_id,ir.id),ir.committed_at desc,ir.id
 ) visible order by visible.committed_at desc,visible.id limit p_limit offset p_offset loop
  result:=result||jsonb_build_array(private.import_continuation_result(r.id));
 end loop;
 return result;
end $$;

create function public.customer_import_source_intake(p_source_id uuid,p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_row uuid;v_raw jsonb;v_normalized jsonb;
begin
 select original_row_id into strict v_row from private.customer_import_purchase_sources where id=p_source_id;
 perform private.import_source_actor(v_row,p_actor_id,'view');
 select raw_data,normalized_data into v_raw,v_normalized from public.customer_import_rows where id=v_row;
 -- Service-only projection. API applies the application-prefill schema and removes TIN.
 return jsonb_build_object('rowId',v_row,'fields',v_raw-'tin'-'secondary_tin'-'tin_number'-'supplementary_tin_number','continuation',private.import_continuation_result(v_row));
end $$;

create function private.import_finance_actor(p_claim uuid,p_actor uuid,p_action text) returns void
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 perform private.mutation_actor_role(p_actor,'finance.payment_verification',p_action);
 perform private.mutation_actor_role(p_actor,'sales.customers','view');
 if not exists(select 1 from private.customer_import_payment_claims where id=p_claim) then raise exception 'IMPORT_CLAIM_NOT_FOUND';end if;
end $$;

create function public.customer_import_payment_claims(p_actor_id uuid,p_source_id uuid default null,p_reservation_id uuid default null,p_limit integer default 100,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare c record;result jsonb:='[]';v_target text;v_status text;
begin
 perform private.mutation_actor_role(p_actor_id,'finance.payment_verification','view');
 perform private.mutation_actor_role(p_actor_id,'sales.customers','view');
 if p_limit not between 1 and 100 or p_offset<0 then raise exception 'IMPORT_BATCH_LIMIT';end if;
 if num_nonnulls(p_source_id,p_reservation_id)<>1 then raise exception 'IMPORT_CLAIM_SCOPE_REQUIRED';end if;
 for c in select claim.*,s.customer_id,s.original_row_id from private.customer_import_payment_claims claim
 join private.customer_import_purchase_sources s on s.id=claim.source_id
 where (s.id=p_source_id or p_reservation_id is not null and exists(select 1 from public.reservation_agreements a where a.customer_application_id=s.application_id and a.id=p_reservation_id)) order by claim.id limit p_limit offset p_offset loop
  v_target:=private.import_target_version(c.original_row_id);
  v_status:=case when c.payment_id is not null and exists(select 1 from public.payments p where p.id=c.payment_id and p.status='verified') then 'verified' else c.status end;
  result:=result||jsonb_build_array(jsonb_build_object('id',c.id,'sourceId',c.source_id,'paymentKey',c.claim_reference,'purpose',c.purpose,'amount',c.amount,'date',c.payment_date,'method',c.method,'reference',c.bank_reference,'status',v_status,'paymentId',c.payment_id,
   'expectedClaimVersion',private.import_hash(to_jsonb(c)-'customer_id'-'original_row_id'),'expectedTargetVersion',v_target,
   'duplicateCandidates',coalesce((select jsonb_agg(jsonb_build_object('paymentId',p.id,'reference',coalesce(p.reference,''),'amount',p.amount)) from public.payments p
    where p.customer_id=c.customer_id and p.status not in ('voided','rejected') and p.amount::numeric=c.amount::numeric and p.method=c.method and
    (nullif(c.bank_reference,'') is not null and private.import_normal_key(p.reference)=private.import_normal_key(c.bank_reference) or exists(select 1 from private.customer_import_payment_claims linked where linked.payment_id=p.id and linked.fingerprint=c.fingerprint))),'[]'::jsonb),
   'proofDocumentId',c.proof_id,'proofUploaded',c.proof_uploaded_at is not null,'notes',c.notes));
 end loop;
 return result;
end $$;

create function public.prepare_import_claim_proof(p_claim_id uuid,p_actor_id uuid,p_mime text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare c private.customer_import_payment_claims%rowtype;v_proof uuid:=gen_random_uuid();v_path text;
begin
 perform private.import_finance_actor(p_claim_id,p_actor_id,'update');
 if p_mime not in ('image/jpeg','image/png','application/pdf') then raise exception 'IMPORT_PROOF_MIME_INVALID';end if;
 select * into strict c from private.customer_import_payment_claims where id=p_claim_id for update;
 if c.payment_id is not null then raise exception 'IMPORT_CLAIM_ALREADY_RECORDED';end if;
 v_path:='import-claims/'||p_claim_id::text||'/'||v_proof::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end;
 update private.customer_import_payment_claims set proof_id=v_proof,proof_path=v_path,proof_mime=p_mime,proof_sha256=null,proof_uploaded_at=null,proof_uploaded_by=p_actor_id,updated_at=now() where id=p_claim_id;
 return jsonb_build_object('proofDocumentId',v_proof,'bucket','afhomes-payment-receipts','path',v_path);
end $$;
create function public.import_claim_proof(p_claim_id uuid,p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare c private.customer_import_payment_claims%rowtype;
begin
 perform private.import_finance_actor(p_claim_id,p_actor_id,'view');select * into strict c from private.customer_import_payment_claims where id=p_claim_id;
 if c.proof_id is null then raise exception 'IMPORT_PROOF_REQUIRED';end if;
 return jsonb_build_object('proofDocumentId',c.proof_id,'bucket','afhomes-payment-receipts','path',c.proof_path,'mime',c.proof_mime,'uploaded',c.proof_uploaded_at is not null);
end $$;
create function public.complete_import_claim_proof(p_claim_id uuid,p_actor_id uuid,p_proof_id uuid,p_sha256 text) returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 perform private.import_finance_actor(p_claim_id,p_actor_id,'update');
 if p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'IMPORT_PROOF_INVALID';end if;
 update private.customer_import_payment_claims set proof_sha256=p_sha256,proof_uploaded_at=now(),updated_at=now() where id=p_claim_id and proof_id=p_proof_id and payment_id is null and proof_uploaded_by=p_actor_id;
 if not found then raise exception 'IMPORT_PROOF_CHANGED';end if;
end $$;

create function public.accept_import_payment_claim_once(p_claim_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_claim_version text,p_expected_target_version text,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare c private.customer_import_payment_claims%rowtype;s private.customer_import_purchase_sources%rowtype;a public.reservation_agreements%rowtype;p public.payments%rowtype;
 v_row uuid;v_payment uuid;v_kind text:=p_decision->>'kind';v_before text;v_after text;v_candidates integer;
begin
 perform private.import_finance_actor(p_claim_id,p_actor_id,'update');
 if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED';end if;
 select src.original_row_id into strict v_row from private.customer_import_payment_claims claim join private.customer_import_purchase_sources src on src.id=claim.source_id where claim.id=p_claim_id;
 perform 1 from public.customer_import_rows where id=v_row for update;
 select src.* into strict s from private.customer_import_payment_claims claim join private.customer_import_purchase_sources src on src.id=claim.source_id where claim.id=p_claim_id;
 perform pg_advisory_xact_lock(hashtextextended('import-source:afhomes:'||s.normalized_reference,0));
 perform 1 from public.customers where id=s.customer_id for update;
 perform 1 from public.customer_applications where customer_id=s.customer_id order by id for update;
 perform 1 from public.reservation_agreements where customer_id=s.customer_id order by id for update;
 select * into strict c from private.customer_import_payment_claims where id=p_claim_id for update;
 if c.payment_id is not null then
  if v_kind='match' and (p_decision->>'paymentId')::uuid=c.payment_id or v_kind='record' and c.proof_id::text=p_decision->>'proofDocumentId' then return jsonb_build_object('paymentId',c.payment_id,'status',c.status);end if;
  raise exception 'IMPORT_CLAIM_ALREADY_RECORDED';
 end if;
 if private.import_hash(to_jsonb(c)) is distinct from p_expected_claim_version or private.import_target_version(v_row) is distinct from p_expected_target_version then raise exception 'IMPORT_TARGET_CHANGED';end if;
 if v_kind in ('hold','reject') then
  if length(btrim(coalesce(p_decision->>'reason','')))<5 then raise exception 'REASON_REQUIRED';end if;
  update private.customer_import_payment_claims set status=case v_kind when 'hold' then 'held' else 'rejected' end,reviewed_by=p_actor_id,review_reason=p_decision->>'reason',updated_at=now() where id=p_claim_id;
  return jsonb_build_object('paymentId',null,'status',case v_kind when 'hold' then 'held' else 'rejected' end);
 end if;
 if c.status='rejected' then raise exception 'IMPORT_CLAIM_REJECTED';end if;
 select * into a from public.reservation_agreements where customer_application_id=s.application_id and status='executed' and (v_kind='match' or finalized_at is null) order by created_at desc limit 1;
 if a.id is null then raise exception 'RESERVATION_NOT_EXECUTED';end if;
 perform pg_advisory_xact_lock(hashtextextended('import-payment:'||c.fingerprint,0));
 if v_kind='match' then
  select * into p from public.payments where id=(p_decision->>'paymentId')::uuid for update;
  if not found or p.customer_id<>s.customer_id or p.reservation_id is distinct from a.id or p.status in ('voided','rejected') or p.amount::numeric<>c.amount::numeric or p.method<>c.method then raise exception 'IMPORT_PAYMENT_MATCH_CONFLICT';end if;
  if length(btrim(coalesce(p_decision->>'reason','')))<5 then raise exception 'REASON_REQUIRED';end if;
  v_payment:=p.id;
 elsif v_kind='record' then
  if c.proof_id is null or c.proof_id::text is distinct from p_decision->>'proofDocumentId' or c.proof_uploaded_at is null or c.proof_sha256 is null then raise exception 'IMPORT_PROOF_REQUIRED';end if;
  select count(*) into v_candidates from public.payments pay where pay.customer_id=s.customer_id and pay.status not in ('voided','rejected') and pay.amount::numeric=c.amount::numeric and pay.method=c.method and
   (nullif(c.bank_reference,'') is not null and private.import_normal_key(pay.reference)=private.import_normal_key(c.bank_reference) or exists(select 1 from private.customer_import_payment_claims linked where linked.payment_id=pay.id and linked.fingerprint=c.fingerprint));
  if v_candidates>0 and length(btrim(coalesce(p_decision->>'distinctPaymentReason','')))<5 then raise exception 'IMPORT_PAYMENT_RECONCILIATION_REQUIRED';end if;
  select private.money(coalesce(sum(amount::numeric) filter(where status='verified'),0)) into v_before from public.payments where reservation_id=a.id;
  v_payment:=public.record_reservation_payment_once(p_request_id,a.id,jsonb_build_object('amount',c.amount,'paymentType',case c.purpose when 'reservation' then 'down_payment' else c.purpose end,'method',c.method,'reference',nullif(c.bank_reference,''),'notes',concat('Imported original payment date: ',c.payment_date::text,'. ',c.notes),'receiptStoragePath','afhomes-payment-receipts/'||c.proof_path),p_actor_id);
  select private.money(coalesce(sum(amount::numeric) filter(where status='verified'),0)) into v_after from public.payments where reservation_id=a.id;
  if v_after<>v_before then raise exception 'IMPORT_RECORDING_CHANGED_VERIFIED_TOTAL';end if;
 else raise exception 'INVALID_DECISION';end if;
 update private.customer_import_payment_claims set payment_id=v_payment,status=case v_kind when 'record' then 'recorded' else 'matched' end,reviewed_by=p_actor_id,review_reason=coalesce(p_decision->>'reason',p_decision->>'distinctPaymentReason','Finance explicitly accepted reviewed receipt'),updated_at=now() where id=p_claim_id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,request_id) values(p_actor_id,'IMPORTED_PAYMENT_CLAIM_RECONCILED','import_payment_claim',p_claim_id::text,jsonb_build_object('paymentId',v_payment,'decision',v_kind),p_request_id::text);
 return jsonb_build_object('paymentId',v_payment,'status',case v_kind when 'record' then 'recorded' else 'matched' end);
end $$;
revoke all on function private.import_finance_actor(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_import_application_once(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb),public.customer_import_continuations(uuid,uuid,integer,integer),public.customer_import_source_intake(uuid,uuid),public.customer_import_payment_claims(uuid,uuid,uuid,integer,integer),public.prepare_import_claim_proof(uuid,uuid,text),public.import_claim_proof(uuid,uuid),public.complete_import_claim_proof(uuid,uuid,uuid,text),public.accept_import_payment_claim_once(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_import_application_once(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb),public.customer_import_continuations(uuid,uuid,integer,integer),public.customer_import_source_intake(uuid,uuid),public.customer_import_payment_claims(uuid,uuid,uuid,integer,integer),public.prepare_import_claim_proof(uuid,uuid,text),public.import_claim_proof(uuid,uuid),public.complete_import_claim_proof(uuid,uuid,uuid,text),public.accept_import_payment_claim_once(uuid,uuid,uuid,text,text,jsonb) to service_role;
