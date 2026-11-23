-- AF Homes: owner-confirmed application / RA / Finance workflow (16 Nov 2026).
-- Validation: pnpm test:db:local; supabase/security/rls_invariants.sql.
--   select key from public.modules where key='sales.application_approval'; -- 1
--   select count(*) from public.reservation_agreements r join public.customer_applications a
--     on a.id=r.customer_application_id where r.purchase_terms_id is null
--     and (r.status not in ('draft','cancelled') or a.status not in ('draft','rejected','cancelled')); -- 0
-- Down: forward repair only. Never delete financial evidence or reissue numbers.
begin;

insert into public.modules(key,name,group_name,sort_order)
values('sales.application_approval','Application & RA Approval','Sales & Customers',35)
on conflict(key) do update set name=excluded.name,group_name=excluded.group_name,sort_order=excluded.sort_order;
insert into public.role_permissions(role_id,module_id,can_view,can_create,can_update,can_delete)
select r.id,m.id,true,false,true,false from public.roles r cross join public.modules m
where (r.slug='admin' and m.key='sales.application_approval')
   or (r.slug in ('admin','finance') and m.key='finance.commission_payouts')
on conflict(role_id,module_id) do update set can_view=true,can_update=true;

-- A corrected purchase keeps every old signature, but old signatures cannot
-- approve a later revision. This is purchase evidence, not a client flag.
alter table public.customer_applications add column if not exists workflow_revision integer not null default 1 check(workflow_revision>0);
alter table public.purchase_signed_documents add column if not exists workflow_revision integer not null default 1 check(workflow_revision>0);
drop index if exists public.purchase_signed_documents_live_unique;
create unique index purchase_signed_documents_live_unique on public.purchase_signed_documents(application_id,kind,workflow_revision)
where status in ('pending_review','accepted');

create or replace function private.resolve_originating_seller(p_actor uuid,p_candidate uuid)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_role text;
begin
  select private.staff_role_slug(s.id) into v_role from public.staff_users s where s.id=p_actor and s.status='active';
  if coalesce(v_role,'') not in ('sales_manager','admin','super_admin') then
    raise exception 'SALE_ORIGINATION_FORBIDDEN' using errcode='42501';
  end if;
  if v_role='sales_manager' then
    if p_candidate is not null and p_candidate<>p_actor then raise exception 'SELLER_OF_RECORD_MUST_BE_CREATOR' using errcode='42501'; end if;
    return p_actor;
  end if;
  if p_candidate is null then raise exception 'SELLER_OF_RECORD_REQUIRED' using errcode='22023'; end if;
  if not exists(select 1 from public.staff_users s where s.id=p_candidate and s.status='active') then
    raise exception 'SELLER_INACTIVE' using errcode='42501';
  end if;
  if private.staff_role_slug(p_candidate) is distinct from 'sales_manager' then
    raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501';
  end if;
  return p_candidate;
end $$;
revoke all on function private.resolve_originating_seller(uuid,uuid) from public,anon,authenticated,service_role;

do $patch$
declare d text; old text:='begin';
begin
  select pg_get_functiondef('private.application_seller_of_record(uuid,text,uuid,uuid)'::regprocedure) into d;
  if position('select a.sm_staff_id into p_candidate' in d)>0 then return; end if;
  execute replace(d,old,$new$begin
  if p_status='draft' and p_candidate is null then
    select a.sm_staff_id into p_candidate from public.customer_applications a where a.id=p_application_id;
  end if;$new$);
end $patch$;

-- Only an unfunded draft can carry provisional snapshots without frozen terms.
alter table public.reservation_agreements drop constraint reservation_purchase_origin_check;
alter table public.reservation_agreements add constraint reservation_purchase_origin_check check(
  (origin='sale' and sale_id is not null and purchase_terms_id is null)
  or (origin='application' and customer_application_id is not null and customer_id is not null
      and seller_staff_id is not null and (purchase_terms_id is not null or status in ('draft','cancelled'))
      and minimum_down_payment_snapshot is not null and required_initial_snapshot is not null
      and spot_cash_days_snapshot is not null and validity_months_snapshot is not null
      and commission_rate_snapshot is not null and commission_base_snapshot is not null and expected_commission_snapshot is not null));

do $patch$
declare d text; sig text; old text; replacement text;
begin
  sig:='private.guard_reservation_purchase_identity()';
  select replace(pg_get_functiondef(sig::regprocedure),E'\r\n',E'\n') into d;
  if position('if new.purchase_terms_id is null then' in d)=0 then
  old:='  select pt.* into t from public.customer_application_purchase_terms pt where pt.id=new.purchase_terms_id;';
  replacement:=$new$  if new.purchase_terms_id is null then
    if new.status not in ('draft','cancelled') or new.sale_id is not null
       or not exists(select 1 from public.customer_applications a where a.id=new.customer_application_id
           and a.customer_id=new.customer_id and a.plan_id=new.plan_id and a.sm_staff_id=new.seller_staff_id
           and a.status in ('draft','rejected','cancelled'))
       or exists(select 1 from public.payments p where p.reservation_id=new.id and p.status in ('recorded','verified')) then
      raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
    end if;
    return new;
  end if;
  select pt.* into t from public.customer_application_purchase_terms pt where pt.id=new.purchase_terms_id;$new$;
  if position(old in d)=0 then raise exception 'WORKFLOW_GUARD_DRIFT:reservation'; end if;
  d:=replace(d,old,replacement);
  old:='    if row(new.purchase_terms_id,new.customer_application_id,new.customer_id,new.plan_id,new.seller_staff_id,new.reservation_date)';
  replacement:='    if not (old.status=''draft'' and old.sale_id is null and not exists(select 1 from public.payments p where p.reservation_id=old.id and p.status in (''recorded'',''verified''))) and row(new.purchase_terms_id,new.customer_application_id,new.customer_id,new.plan_id,new.seller_staff_id,new.reservation_date)';
  if position(old in d)=0 then raise exception 'WORKFLOW_GUARD_DRIFT:binding'; end if;
  d:=replace(d,old,replacement);
  old:='    if old.status in (''executed'',''cancelled'') and new.status is distinct from old.status then';
  replacement:=$new$    if old.status in ('executed','cancelled') and new.status is distinct from old.status
       and not (old.status='executed' and new.status='cancelled' and old.sale_id is null
         and not exists(select 1 from public.payments p where p.reservation_id=old.id and p.status in ('recorded','verified'))) then$new$;
  if position(old in d)=0 then raise exception 'WORKFLOW_GUARD_DRIFT:cancel'; end if;
  execute replace(d,old,replacement);
  end if;

  sig:='private.guard_application_purchase_terms()';
  select replace(pg_get_functiondef(sig::regprocedure),E'\r\n',E'\n') into d;
  if position('and not (r.status=''draft'' and old.status=''draft''' in d)>0 then return; end if;
  old:='where r.customer_application_id=old.id and r.status<>''cancelled'')';
  replacement:=$new$where r.customer_application_id=old.id and r.status<>'cancelled'
      and not (r.status='draft' and old.status='draft' and r.sale_id is null
        and not exists(select 1 from public.payments p where p.reservation_id=r.id and p.status in ('recorded','verified'))))$new$;
  if position(old in d)=0 then raise exception 'WORKFLOW_GUARD_DRIFT:application'; end if;
  execute replace(d,old,replacement);
end $patch$;

-- Draft snapshots use today's proposal. Submission replaces them with the exact
-- immutable terms row while retaining the same agreement and official number.
create or replace function private.sync_application_reservation_draft(p_application_id uuid,p_actor_id uuid,p_terms_id uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare a public.customer_applications%rowtype; t public.customer_application_purchase_terms%rowtype;
  r public.reservation_agreements%rowtype; proposal jsonb; v_id uuid; v_today date:=(now() at time zone 'Asia/Manila')::date;
begin
  select * into a from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  select * into r from public.reservation_agreements where customer_application_id=a.id and status<>'cancelled' for update;
  if r.id is not null and r.status<>'draft' then raise exception 'AGREEMENT_NOT_EDITABLE' using errcode='55000'; end if;
  if p_terms_id is null then
    proposal:=private.purchase_terms_for_application(a.id,a.sm_staff_id,'submission')->'terms';
    select (jsonb_populate_record(null::public.customer_application_purchase_terms,
      jsonb_object_agg(k,proposal->v))).* into t from (values
       ('tier','tier'),('payment_scheme','paymentScheme'),('total_price','totalPrice'),
       ('reservation_fee','reservationFee'),('minimum_down_payment','minimumDownPayment'),
       ('required_initial','requiredInitial'),('installment_months','installmentMonths'),
       ('monthly_amount','monthlyAmount'),('spot_cash_days','spotCashDays'),('validity_months','validityMonths'),
       ('discount_percent','discountPercent'),('yearly_points','yearlyPoints'),('annual_points_tranches','annualPointsTranches'),
       ('holder_limit','holderLimit'),('inclusions','inclusions'),('commission_rule_id','commissionRuleId'),
       ('commission_rate','commissionRate'),('commission_base','commissionBase'),('expected_commission','expectedCommission')) m(k,v);
    t.seller_staff_id:=a.sm_staff_id;
  else
    select * into t from public.customer_application_purchase_terms where id=p_terms_id and application_id=a.id;
    if not found then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  end if;
  if r.id is null then
    insert into public.reservation_agreements(id,reservation_number,reservation_date,agreement_date,origin,
      customer_application_id,customer_id,seller_staff_id,purchase_terms_id,plan_id,created_by,
      tier_snapshot,inclusions_snapshot,total_price_snapshot,reservation_fee_snapshot,down_payment_snapshot,
      total_payment_received_snapshot,balance_snapshot,monthly_amortization_snapshot,installment_months_snapshot,
      payment_scheme_snapshot,discount_percent_snapshot,validity_years_snapshot,validity_months_snapshot,
      yearly_points_snapshot,annual_points_tranches_snapshot,holder_limit_snapshot,minimum_down_payment_snapshot,
      required_initial_snapshot,spot_cash_days_snapshot,commission_rule_id,commission_rate_snapshot,
      commission_base_snapshot,expected_commission_snapshot,status)
    values(gen_random_uuid(),null,v_today,v_today,'application',a.id,a.customer_id,t.seller_staff_id,t.id,a.plan_id,p_actor_id,
      t.tier,jsonb_build_object('items',t.inclusions),t.total_price,t.reservation_fee,t.required_initial,'0.00',t.total_price,
      t.monthly_amount,t.installment_months,t.payment_scheme,t.discount_percent,t.validity_months/12,t.validity_months,
      t.yearly_points,t.annual_points_tranches,t.holder_limit,t.minimum_down_payment,t.required_initial,t.spot_cash_days,
      t.commission_rule_id,t.commission_rate,t.commission_base,t.expected_commission,'draft') returning id into v_id;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor_id,'RESERVATION_AGREEMENT_CREATED','reservation_agreement',v_id::text,
      jsonb_build_object('status','draft','applicationId',a.id,'reservationNumber',(select x.reservation_number from public.reservation_agreements x where x.id=v_id)));
  else
    v_id:=r.id;
    update public.reservation_agreements set customer_id=a.customer_id,seller_staff_id=t.seller_staff_id,purchase_terms_id=t.id,
      plan_id=a.plan_id,tier_snapshot=t.tier,inclusions_snapshot=jsonb_build_object('items',t.inclusions),
      total_price_snapshot=t.total_price,reservation_fee_snapshot=t.reservation_fee,down_payment_snapshot=t.required_initial,
      total_payment_received_snapshot='0.00',balance_snapshot=t.total_price,monthly_amortization_snapshot=t.monthly_amount,
      installment_months_snapshot=t.installment_months,payment_scheme_snapshot=t.payment_scheme,
      discount_percent_snapshot=t.discount_percent,validity_years_snapshot=t.validity_months/12,validity_months_snapshot=t.validity_months,
      yearly_points_snapshot=t.yearly_points,annual_points_tranches_snapshot=t.annual_points_tranches,holder_limit_snapshot=t.holder_limit,
      minimum_down_payment_snapshot=t.minimum_down_payment,required_initial_snapshot=t.required_initial,spot_cash_days_snapshot=t.spot_cash_days,
      commission_rule_id=t.commission_rule_id,commission_rate_snapshot=t.commission_rate,commission_base_snapshot=t.commission_base,
      expected_commission_snapshot=t.expected_commission,updated_at=now() where id=v_id;
  end if;
  delete from public.reservation_agreement_holders where agreement_id=v_id;
  insert into public.reservation_agreement_holders(agreement_id,holder_type,name,address,contact_number,email,tin_number)
  select v_id,h.holder_type,concat_ws(' ',h.first_name,h.middle_name,h.last_name,h.suffix),
    concat_ws(', ',h.permanent_address_line_1,h.permanent_address_line_2,h.city_municipality,h.province,h.postal_code),
    h.mobile,h.email,h.tin_number from public.customer_application_holders h where h.application_id=a.id;
  return v_id;
end $$;
revoke all on function private.sync_application_reservation_draft(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Preserve the established validation, holder intake, hierarchy and customer mirror.
do $copy$
declare d text;
begin
  if to_regprocedure('private.save_customer_application_before_workflow(uuid,uuid,jsonb,jsonb,jsonb)') is null then
    select pg_get_functiondef('public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) into d;
    execute replace(d,'FUNCTION public.save_customer_application(','FUNCTION private.save_customer_application_before_workflow(');
  end if;
end $copy$;
revoke all on function private.save_customer_application_before_workflow(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.save_customer_application(p_application_id uuid,p_actor_id uuid,p_header jsonb,p_primary jsonb,p_secondary jsonb default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_id uuid; v_seller uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers',case when p_application_id is null then 'create' else 'update' end);
  v_seller:=private.resolve_originating_seller(p_actor_id,nullif(p_header->>'smStaffId','')::uuid);
  if p_application_id is not null then
    perform 1 from public.customer_applications a where a.id=p_application_id and a.status='draft'
      and (a.created_by=p_actor_id or a.sm_staff_id=p_actor_id or private.staff_role_slug(p_actor_id) in ('admin','super_admin')) for update;
    if not found then raise exception 'APPLICATION_NOT_EDITABLE' using errcode='55000'; end if;
    update public.customer_applications set purchase_terms_id=null,workflow_revision=workflow_revision+1 where id=p_application_id;
  end if;
  v_id:=private.save_customer_application_before_workflow(p_application_id,p_actor_id,
    p_header||jsonb_build_object('smStaffId',v_seller),p_primary,p_secondary);
  perform private.sync_application_reservation_draft(v_id,p_actor_id,null);
  return v_id;
end $$;
revoke all on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- Submission reuses the RA already created by intake. Existing validation still
-- checks the current reviewed ID, holder details and proposal hash.
do $patch$
declare d text; old text; replacement text;
begin
  select replace(pg_get_functiondef('public.submit_purchase_application_once(uuid,uuid,uuid,text,uuid)'::regprocedure),E'\r\n',E'\n') into d;
  if position('private.sync_application_reservation_draft' in d)>0 then return; end if;
  d:=replace(d,'''admin'',''super_admin'',''finance''','''admin'',''super_admin''');
  d:=replace(d,'if v_app.created_by is distinct from p_actor_id',
    'if v_app.created_by is distinct from p_actor_id and v_app.sm_staff_id is distinct from p_actor_id');
  d:=replace(d,'private.resolve_originating_seller(p_actor_id,p_seller_candidate)',
    'private.resolve_originating_seller(p_actor_id,coalesce(p_seller_candidate,v_app.sm_staff_id))');
  old:='  -- Module permission checked above; the seller of record is always an ACTIVE SM.';
  if position(old in d)=0 then raise exception 'WORKFLOW_SUBMIT_DRIFT:identity'; end if;
  d:=replace(d,old,$new$  if not exists(select 1 from (
      select i.reviewed_data,i.reviewed_at,i.verification_status from public.identity_documents i
      where i.subject_type='customer' and i.customer_id=v_app.customer_id and i.storage_path<>''
        and i.sha256<>repeat('0',64) and i.verification_status<>'rejected'
      order by i.created_at desc,i.id desc limit 1) current_id
    where current_id.reviewed_at is not null and current_id.verification_status='confirmed'
      and current_id.reviewed_data->'fields'->>'idType' in ('philippine_id','drivers_license','passport','tax_id','other')) then
    raise exception 'CURRENT_ID_DOCUMENT_REQUIRED' using errcode='55000';
  end if;
  -- Module permission checked above; the seller of record is always an ACTIVE SM.$new$);
  old:=$old$  v_res_id:=private.reserve_application_purchase_internal(
    md5(p_request_id::text||'-reserve')::uuid, p_actor_id, v_app.id, v_terms_id,
    jsonb_build_object('reservationDate',v_today,'agreementDate',v_today,'scheduleNotes','[]'::jsonb), true);$old$;
  replacement:=$new$  v_res_id:=private.sync_application_reservation_draft(v_app.id,p_actor_id,v_terms_id);
  update public.reservation_agreements set status='submitted',submitted_at=coalesce(submitted_at,now()),updated_at=now() where id=v_res_id;
  perform private.append_purchase_document('reservation',v_res_id,
    (select coalesce(max(e.revision),0)+1 from private.purchase_document_evidence e where e.kind='reservation' and e.source_id=v_res_id),p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
  values(p_actor_id,'RESERVATION_AGREEMENT_SUBMITTED','reservation_agreement',v_res_id::text,
    jsonb_build_object('status','draft'),jsonb_build_object('status','submitted','applicationId',v_app.id),p_request_id::text);$new$;
  if position(old in d)=0 then raise exception 'WORKFLOW_SUBMIT_DRIFT'; end if;
  execute replace(d,old,replacement);
end $patch$;

-- Both document kinds use the application's existing update capability. A
-- review never approves the purchase and the coordinated decision stays separate.
do $patch$
declare d text;
begin
  select pg_get_functiondef('public.register_purchase_signed_document_once(uuid,text,uuid,text,text,text,bigint,text)'::regprocedure) into d;
  if position('''sales.customers'',''update''' in d)>0 and position('''sales.card_sales'',''create''' in d)=0 then return; end if;
  if position('''sales.card_sales'',''create''' in d)=0 then raise exception 'WORKFLOW_SIGNATURE_DRIFT'; end if;
  execute replace(d,'''sales.card_sales'',''create''','''sales.customers'',''update''');
end $patch$;

-- Signed-document revision is assigned by the database and remains immutable.
-- Older approved applications may retain an unfunded draft RA. Its signed
-- file can be reviewed before the same coordinated completion operation.
do $patch$
declare d text; old text:='if v_res.status<>''submitted'' then raise exception ''AGREEMENT_NOT_AWAITING_SIGNATURE''';
begin
  select pg_get_functiondef('public.register_purchase_signed_document_once(uuid,text,uuid,text,text,text,bigint,text)'::regprocedure) into d;
  if position('v_res.status=''draft'' and v_res.sale_id is null' in d)>0 then return; end if;
  if position(old in d)=0 then raise exception 'WORKFLOW_SIGNATURE_DRIFT:legacy'; end if;
  execute replace(d,old,$new$if v_res.status<>'submitted' and not (v_res.status='draft' and v_res.sale_id is null
    and exists(select 1 from public.customer_applications a where a.id=v_res.customer_application_id and a.status='approved'
      and a.purchase_terms_id is not null and a.purchase_terms_id=v_res.purchase_terms_id)
    and not exists(select 1 from public.payments p where p.reservation_id=v_res.id and p.status in ('recorded','verified')))
    then raise exception 'AGREEMENT_NOT_AWAITING_SIGNATURE'$new$);
end $patch$;

create or replace function private.purchase_signature_revision_guard() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='INSERT' then
    select a.workflow_revision into new.workflow_revision from public.customer_applications a where a.id=new.application_id;
  elsif new.workflow_revision is distinct from old.workflow_revision then
    raise exception 'SIGNED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.purchase_signature_revision_guard() from public,anon,authenticated,service_role;
drop trigger if exists purchase_signature_revision on public.purchase_signed_documents;
create trigger purchase_signature_revision before insert or update on public.purchase_signed_documents
for each row execute function private.purchase_signature_revision_guard();

create or replace function public.decide_purchase_application_once(p_request_id uuid,p_actor_id uuid,p_application_id uuid,p_decision text)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare a public.customer_applications%rowtype; r public.reservation_agreements%rowtype;
  v_payload jsonb; v_result uuid; v_ra_status text; v_action text; v_revision integer; v_receipt uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  if p_decision in ('approved','rejected') then
    perform private.mutation_actor_role(p_actor_id,'sales.application_approval','update');
    if coalesce(private.staff_role_slug(p_actor_id),'') not in ('admin','super_admin') then
      raise exception 'APPLICATION_APPROVAL_FORBIDDEN' using errcode='42501';
    end if;
  end if;
  if p_request_id is null then raise exception 'MUTATION_REQUEST_REQUIRED' using errcode='22023'; end if;
  if p_decision is null or p_decision not in ('approved','rejected','cancelled','draft') then raise exception 'INVALID_DECISION' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('applicationId',p_application_id,'decision',p_decision);
  v_result:=private.mutation_result(p_actor_id,'application.decide',p_request_id,v_payload);
  if v_result is not null then return v_result; end if;
  select * into a from public.customer_applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002'; end if;
  if not (case a.status when 'draft' then p_decision='cancelled'
    when 'submitted' then p_decision in ('approved','rejected','cancelled','draft')
    when 'approved' then p_decision='cancelled' or (p_decision='approved' and exists(
      select 1 from public.reservation_agreements legacy where legacy.customer_application_id=a.id
        and legacy.status in ('draft','submitted') and legacy.sale_id is null))
    when 'rejected' then p_decision in ('draft','cancelled') else false end) then
    raise exception 'INVALID_APPLICATION_TRANSITION' using errcode='55000';
  end if;
  if p_decision not in ('approved','rejected') and a.created_by is distinct from p_actor_id and a.sm_staff_id is distinct from p_actor_id
     and coalesce(private.staff_role_slug(p_actor_id),'') not in ('admin','super_admin') then
    raise exception 'MUTATION_FORBIDDEN' using errcode='42501';
  end if;
  select * into r from public.reservation_agreements where customer_application_id=a.id and status<>'cancelled' for update;
  if r.id is null then raise exception 'LINKED_RESERVATION_REQUIRED' using errcode='55000'; end if;
  if r.sale_id is not null or exists(select 1 from public.payments p where p.reservation_id=r.id and p.status in ('recorded','verified')) then
    raise exception 'PURCHASE_HAS_PAYMENTS' using errcode='55000';
  end if;
  if p_decision='approved' then
    if a.purchase_terms_id is null or r.purchase_terms_id is distinct from a.purchase_terms_id then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
    if r.status not in ('draft','submitted') then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
    perform private.validate_frozen_seller(r.seller_staff_id);
    if private.staff_role_slug(r.seller_staff_id) is distinct from 'sales_manager' then raise exception 'SELLER_ROLE_NOT_A_SELLER' using errcode='42501'; end if;
    if not exists(select 1 from public.purchase_signed_documents d join storage.objects o on o.bucket_id=d.storage_bucket and o.name=d.storage_path
      where d.application_id=a.id and d.kind='signed_customer_application' and d.status='accepted' and d.workflow_revision=a.workflow_revision) then
      raise exception 'SIGNED_APPLICATION_DOCUMENT_REQUIRED' using errcode='55000'; end if;
    if not exists(select 1 from public.purchase_signed_documents d join storage.objects o on o.bucket_id=d.storage_bucket and o.name=d.storage_path
      where d.application_id=a.id and d.reservation_id=r.id and d.kind='signed_reservation_agreement' and d.status='accepted' and d.workflow_revision=a.workflow_revision) then
      raise exception 'SIGNED_RA_DOCUMENT_REQUIRED' using errcode='55000'; end if;
    if r.status='draft' then
      update public.reservation_agreements set status='submitted',submitted_at=coalesce(submitted_at,now()),updated_at=now() where id=r.id;
      insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
      values(p_actor_id,'RESERVATION_AGREEMENT_SUBMITTED','reservation_agreement',r.id::text,
        jsonb_build_object('status','draft'),jsonb_build_object('status','submitted'),p_request_id::text);
    end if;
    v_ra_status:='executed';
  elsif p_decision='cancelled' then v_ra_status:='cancelled';
  else v_ra_status:='draft'; end if;

  update public.customer_applications set status=p_decision,updated_at=now(),
    approved_at=case when p_decision='approved' then coalesce(approved_at,now()) else approved_at end,
    rejected_at=case when p_decision='rejected' then now() else rejected_at end,
    workflow_revision=workflow_revision+case when p_decision in ('draft','rejected') then 1 else 0 end
  where id=a.id;
  update public.reservation_agreements set status=v_ra_status,updated_at=now(),
    executed_at=case when v_ra_status='executed' then now() else executed_at end where id=r.id;
  select coalesce(max(e.revision),0)+1 into v_revision from private.purchase_document_evidence e where e.kind='reservation' and e.source_id=r.id;
  v_receipt:=private.append_purchase_document('reservation',r.id,v_revision,p_actor_id);
  v_action:=case v_ra_status when 'executed' then 'RESERVATION_AGREEMENT_EXECUTED' when 'cancelled' then 'RESERVATION_AGREEMENT_CANCELLED' else 'RESERVATION_AGREEMENT_REOPENED' end;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
  values(p_actor_id,v_action,'reservation_agreement',r.id::text,jsonb_build_object('status',r.status),
    jsonb_build_object('status',v_ra_status,'applicationId',a.id,'documentEvidenceId',v_receipt),p_request_id::text);
  v_action:=case p_decision when 'approved' then 'CUSTOMER_APPLICATION_APPROVED' when 'rejected' then 'CUSTOMER_APPLICATION_REJECTED'
    when 'cancelled' then 'CUSTOMER_APPLICATION_CANCELLED' else 'CUSTOMER_APPLICATION_REOPENED' end;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
  values(p_actor_id,v_action,'customer_application',a.id::text,jsonb_build_object('status',a.status),
    jsonb_build_object('status',p_decision,'reservationId',r.id,'purchaseTermsId',a.purchase_terms_id),p_request_id::text);
  perform private.complete_purchase_mutation(p_actor_id,'application.decide',p_request_id,v_payload,a.id,
    jsonb_build_object('resultId',a.id,'status',p_decision,'reservationId',r.id,'purchaseTermsId',a.purchase_terms_id));
  return a.id;
end $$;
revoke all on function public.decide_purchase_application_once(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_purchase_application_once(uuid,uuid,uuid,text) to service_role;

-- Retire separate execution. Recovery always moves the parent and RA together.
do $copy$
declare d text;
begin
  if to_regprocedure('private.transition_reservation_before_workflow(uuid,uuid,uuid,text,jsonb)') is null then
    select pg_get_functiondef('public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb)'::regprocedure) into d;
    execute replace(d,'FUNCTION public.transition_purchase_reservation_once(','FUNCTION private.transition_reservation_before_workflow(');
  end if;
end $copy$;
revoke all on function private.transition_reservation_before_workflow(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.transition_purchase_reservation_once(p_request_id uuid,p_actor_id uuid,p_reservation_id uuid,p_action text,p_input jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_app_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id,'sales.customers','update');
  select r.customer_application_id into v_app_id from public.reservation_agreements r where r.id=p_reservation_id and r.origin='application';
  if v_app_id is null and exists(select 1 from public.reservation_agreements where id=p_reservation_id and origin='sale') then
    return private.transition_reservation_before_workflow(p_request_id,p_actor_id,p_reservation_id,p_action,p_input);
  end if;
  if v_app_id is null then raise exception 'AGREEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_action='execute' then raise exception 'APPLICATION_APPROVAL_REQUIRED' using errcode='55000'; end if;
  if p_action in ('cancel','reopen') then
    perform public.decide_purchase_application_once(p_request_id,p_actor_id,v_app_id,case when p_action='cancel' then 'cancelled' else 'draft' end);
    return p_reservation_id;
  end if;
  raise exception 'APPLICATION_SUBMISSION_REQUIRED' using errcode='55000';
end $$;
revoke all on function public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.transition_purchase_reservation_once(uuid,uuid,uuid,text,jsonb) to service_role;

-- The legacy direct-sale API cannot originate a normal purchase. Existing
-- imports and finalized reservations retain their separate historical paths.
create or replace function private.normal_sale_workflow_guard() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if coalesce(new.origin,'normal')='normal' and (new.status<>'payment_verified' or not exists(
    select 1 from public.reservation_agreements r join public.customer_applications a on a.id=r.customer_application_id
    where r.origin='application' and r.status='executed' and a.status='approved' and r.sale_id is null
      and r.customer_id=new.customer_id and r.plan_id=new.plan_id and r.seller_staff_id=new.seller_staff_id
      and r.total_price_snapshot::numeric=new.cash_price_snapshot::numeric
      and (select coalesce(sum(p.amount::numeric),0) from public.payments p where p.reservation_id=r.id and p.status='verified')>=r.total_price_snapshot::numeric)) then
    raise exception 'PURCHASE_WORKFLOW_REQUIRED' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.normal_sale_workflow_guard() from public,anon,authenticated,service_role;
drop trigger if exists normal_sale_workflow on public.card_sales;
create trigger normal_sale_workflow before insert on public.card_sales for each row execute function private.normal_sale_workflow_guard();

create or replace function private.purchase_payment_workflow_guard() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare r public.reservation_agreements%rowtype;
begin
  if new.status not in ('recorded','verified') then return new; end if;
  if tg_op='UPDATE' and old.status='verified' then return new; end if;
  if new.reservation_id is null then
    -- Existing sale ledgers keep their historical payment path; new normal
    -- sales cannot be inserted outside finalization (normal_sale_workflow).
    return new;
  end if;
  select * into r from public.reservation_agreements where id=new.reservation_id for update;
  if r.origin='application' then
    if r.status<>'executed' then raise exception 'RESERVATION_NOT_EXECUTED' using errcode='55000'; end if;
    if not exists(select 1 from public.customer_applications a where a.id=r.customer_application_id and a.status='approved') then
      raise exception 'APPLICATION_NOT_APPROVED' using errcode='55000'; end if;
    if new.payment_purpose='reservation_fee' and new.amount::numeric<>r.reservation_fee_snapshot::numeric then
      raise exception 'RESERVATION_FEE_MUST_MATCH_TERMS' using errcode='55000'; end if;
    if new.payment_purpose<>'reservation_fee' and r.reservation_fee_snapshot::numeric>0
       and not exists(select 1 from public.payments p where p.reservation_id=r.id and p.payment_purpose='reservation_fee'
         and p.status='verified' and p.amount::numeric>=r.reservation_fee_snapshot::numeric) then
      raise exception 'RESERVATION_PAYMENT_REQUIRED' using errcode='55000'; end if;
  end if;
  return new;
end $$;
revoke all on function private.purchase_payment_workflow_guard() from public,anon,authenticated,service_role;
drop trigger if exists purchase_payment_workflow on public.payments;
create trigger purchase_payment_workflow before insert or update of status on public.payments
for each row execute function private.purchase_payment_workflow_guard();

-- A VIP ID belongs to one purchase. Keep the first customer-level projection
-- unchanged for old consumers; future purchases receive their own number.
alter table public.reservation_agreements add column if not exists vip_card_number text
  check(vip_card_number is null or vip_card_number ~ '^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$');
create unique index if not exists reservation_vip_card_number_unique on public.reservation_agreements(vip_card_number) where vip_card_number is not null;
-- Membership ownership is per finalized sale; preserve every prior membership.
alter table public.memberships drop constraint if exists memberships_customer_id_key;
-- Import reconciliation that used to rely on the old unique customer key must
-- refuse ambiguity instead of silently selecting a different purchase.
do $patch$
declare f record; d text; old text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosrc like '%from public.memberships where customer_id=%'
      and p.proname like '%import%' loop
    select pg_get_functiondef(f.oid) into d;
    if position('IMPORT_MEMBERSHIP_HISTORY_CONFLICT' in d)>0 then continue; end if;
    foreach old in array array[
      'select * into m from public.memberships where customer_id=s.customer_id for update;',
      'select * into v_member from public.memberships where customer_id=v_customer.id for update;',
      'select * into member from public.memberships where customer_id=customer;'] loop
      if position(old in d)>0 then
        d:=replace(d,old,replace(old,'select * into ',
          'if (select count(*) from public.memberships where customer_id='||
          case when old like '%customer_id=s.customer_id%' then 's.customer_id'
               when old like '%customer_id=v_customer.id%' then 'v_customer.id' else 'customer' end||
          ')>1 then raise exception ''IMPORT_MEMBERSHIP_HISTORY_CONFLICT'' using errcode=''55000''; end if;'||E'\nselect * into '));
      end if;
    end loop;
    execute d;
  end loop;
end $patch$;

do $patch$
declare d text;
begin
  select pg_get_functiondef('public.purchase_terms_proposal(uuid,uuid,uuid)'::regprocedure) into d;
  if position('v_app.sm_staff_id is distinct from p_actor_id' in d)>0 then return; end if;
  d:=replace(d,'v_app.created_by is distinct from p_actor_id',
    'v_app.created_by is distinct from p_actor_id and v_app.sm_staff_id is distinct from p_actor_id');
  execute replace(d,'''admin'',''super_admin'',''finance''','''admin'',''super_admin''');
end $patch$;

do $patch$
declare d text; old text:='left join public.memberships m on m.customer_id=c.id';
begin
  select pg_get_functiondef('public.customer_directory(jsonb)'::regprocedure) into d;
  if position('member.activated_at desc,member.id desc limit 1' in d)>0 then return; end if;
  if position(old in d)=0 then raise exception 'WORKFLOW_DIRECTORY_DRIFT'; end if;
  execute replace(d,old,$new$left join lateral (select member.* from public.memberships member where member.customer_id=c.id
    order by (member.status='active') desc,member.activated_at desc,member.id desc limit 1) m on true$new$);
end $patch$;

-- An unambiguous prior issuance is preserved. Multiple historical purchases
-- are deliberately not assigned the same lifetime customer identifier.
update public.reservation_agreements r set vip_card_number=c.vip_card_number
from public.customers c where c.id=r.customer_id and c.vip_card_number is not null and r.vip_card_number is null
and exists(select 1 from public.payments p where p.reservation_id=r.id and p.status='verified'
  and p.payment_purpose in ('contractual_down_payment','contractual_installment','contractual_full')
  and to_char(p.verified_at at time zone 'Asia/Manila','YYMMDD')=left(c.vip_card_number,6))
and (select count(distinct p.reservation_id) from public.payments p join public.reservation_agreements rr on rr.id=p.reservation_id
  where rr.customer_id=c.id and p.status='verified' and p.payment_purpose in ('contractual_down_payment','contractual_installment','contractual_full'))=1;

create or replace function private.purchase_vip_guard() returns trigger
language plpgsql set search_path=pg_catalog,private,pg_temp as $$
begin
  if tg_op='UPDATE' and old.vip_card_number is not null and new.vip_card_number is distinct from old.vip_card_number then
    raise exception 'VIP_CARD_NUMBER_IMMUTABLE' using errcode='55000'; end if;
  if new.vip_card_number is not null and not exists(select 1 from private.vip_card_number_issuances i
    where i.vip_card_number=new.vip_card_number and i.customer_id=new.customer_id) then
    raise exception 'VIP_CARD_NUMBER_ALREADY_ISSUED' using errcode='23505'; end if;
  return new;
end $$;
revoke all on function private.purchase_vip_guard() from public,anon,authenticated,service_role;
drop trigger if exists reservation_vip_guard on public.reservation_agreements;
create trigger reservation_vip_guard before insert or update of vip_card_number on public.reservation_agreements
for each row execute function private.purchase_vip_guard();

do $patch$
declare d text; old text; replacement text;
begin
  select replace(pg_get_functiondef('private.issue_vip_on_first_qualifying_payment(uuid,uuid,timestamptz)'::regprocedure),E'\r\n',E'\n') into d;
  if position('update public.reservation_agreements set vip_card_number=v_result' in d)>0 then return; end if;
  old:='  select vip_card_number into v_existing from public.customers where id=v_res.customer_id for update;';
  if position(old in d)=0 then raise exception 'WORKFLOW_VIP_DRIFT:lookup'; end if;
  d:=replace(d,old,'  select vip_card_number into v_existing from public.reservation_agreements where id=v_res.id for update;');
  old:='    update public.customers set vip_card_number=v_result where id=v_res.customer_id;';
  if position(old in d)=0 then raise exception 'WORKFLOW_VIP_DRIFT:write'; end if;
  d:=replace(d,old,'    update public.customers set vip_card_number=v_result where id=v_res.customer_id and vip_card_number is null;');
  old:='  return v_result;';
  replacement:='  update public.reservation_agreements set vip_card_number=v_result where id=v_res.id;'||E'\n'||old;
  execute replace(d,old,replacement);

  select pg_get_functiondef('public.verify_purchase_payment_once(uuid,uuid,text,text,uuid)'::regprocedure) into d;
  old:='select c.vip_card_number into v_vip from public.customers c where c.id=v_res.customer_id;';
  if position(old in d)=0 then raise exception 'WORKFLOW_VIP_DRIFT:verify'; end if;
  execute replace(d,old,'select ra.vip_card_number into v_vip from public.reservation_agreements ra where ra.id=v_res.id;');

  select pg_get_functiondef('public.activate_card_sale(uuid,uuid,integer)'::regprocedure) into d;
  old:='select c.vip_card_number into v_vip from public.customers c where c.id = v_sale.customer_id;';
  if position(old in d)=0 then raise exception 'WORKFLOW_VIP_DRIFT:activate'; end if;
  execute replace(d,old,'select ra.vip_card_number into v_vip from public.reservation_agreements ra where ra.id=v_res.id;');
end $patch$;

do $patch$
declare d text; old text:='''reservationNumber'',reservation.reservation_number,';
begin
  select pg_get_functiondef('public.purchase_financial_summary(uuid)'::regprocedure) into d;
  if position('''commissionEligibleAt''' in d)>0 then return; end if;
  if position(old in d)=0 then raise exception 'WORKFLOW_SUMMARY_DRIFT'; end if;
  execute replace(d,old,old||E'\n'||$new$      'vipCardNumber',(select r.vip_card_number from public.reservation_agreements r where r.id=reservation.id),
      'commissionEligibleAt',(select r.commission_eligible_at from public.reservation_agreements r where r.id=reservation.id),$new$);
end $patch$;

-- Finance may record/reconcile external payouts. Qualification and holds keep
-- their existing permission and every financial-evidence guard stays intact.
do $patch$
declare sig text; d text; old text:='private.mutation_actor_role(p_actor_id, ''network.commissions'', ''update'')';
begin
  foreach sig in array array['public.record_commission_payout_failure(uuid,uuid,text,text)','public.reconcile_commission_payout(uuid,uuid,text,date)'] loop
    select pg_get_functiondef(sig::regprocedure) into d;
    if position(old in d)=0 and position('''finance.commission_payouts''' in d)=0 then raise exception 'WORKFLOW_PAYOUT_DRIFT:%',sig; end if;
    execute replace(d,old,'private.mutation_actor_role(p_actor_id, ''finance.commission_payouts'', ''update'')');
  end loop;
end $patch$;

notify pgrst,'reload schema';
commit;
