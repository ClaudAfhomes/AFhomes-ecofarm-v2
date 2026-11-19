-- AF Homes: governed QP allowance decision on the approved engagement version.
-- No QP decision or compensation amount is seeded. Existing approvals remain undecided.
-- Validation: save a draft with qpBaApproved and qpDecisionReference, approve with another
-- authorized actor, and assert performance exposes both values and a changed evidenceHash.
-- Down: forward only. Existing engagement approval history must be preserved.
begin;
alter table public.ist_engagements add column if not exists qp_ba_approved boolean;
alter table public.ist_engagements add column if not exists qp_decision_reference text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='ist_engagement_qp_evidence') then
    alter table public.ist_engagements add constraint ist_engagement_qp_evidence
      check(qp_ba_approved is null or (qp_decision_reference is not null and length(btrim(qp_decision_reference)) between 10 and 500));
  end if;
end $$;

do $patch$
declare d text; src text; r record;
begin
  select pg_get_functiondef(p.oid),p.prosrc into d,src from pg_proc p
  where p.oid='public.save_ist_engagement_draft(uuid,jsonb,uuid,text)'::regprocedure;
  if position('qpBaApproved' in src)=0 then
    for r in select * from (values
      ($a$'contractEnd','evidenceReference']$a$,$b$'contractEnd','evidenceReference','qpBaApproved','qpDecisionReference']$b$),
      ($a$perform set_config('afhomes.ist_governed_write', 'on', true);$a$,
       $b$if p_fields ? 'qpBaApproved' and jsonb_typeof(p_fields->'qpBaApproved') not in ('boolean','null') then
         raise exception 'IST_ENGAGEMENT_INVALID' using errcode='22023',detail='QP decision must be true, false or undecided';
       end if;
       if p_fields->>'qpBaApproved' is not null and
          (jsonb_typeof(p_fields->'qpDecisionReference') is distinct from 'string'
           or length(btrim(coalesce(p_fields->>'qpDecisionReference',''))) not between 10 and 500) then
         raise exception 'IST_ENGAGEMENT_INVALID' using errcode='22023',detail='QP decision requires its authorization reference';
       end if;
       perform set_config('afhomes.ist_governed_write', 'on', true);$b$),
      ($a$evidence_reference, created_by, idempotency_key$a$,$b$evidence_reference, qp_ba_approved, qp_decision_reference, created_by, idempotency_key$b$),
      ($a$v_end, v_ref, p_actor_id, v_key$a$,$b$v_end, v_ref, (p_fields->>'qpBaApproved')::boolean, nullif(btrim(p_fields->>'qpDecisionReference'),''), p_actor_id, v_key$b$),
      ($a$(p_fields ->> 'rank', v_start, v_end, v_ref)$a$,$b$(p_fields ->> 'rank', v_start, v_end, v_ref, (p_fields->>'qpBaApproved')::boolean, nullif(btrim(p_fields->>'qpDecisionReference'),''))$b$),
      ($a$(v_old.rank, v_old.contract_start, v_old.contract_end, v_old.evidence_reference)$a$,$b$(v_old.rank, v_old.contract_start, v_old.contract_end, v_old.evidence_reference, v_old.qp_ba_approved, v_old.qp_decision_reference)$b$),
      ($a$evidence_reference = v_ref, updated_by$a$,$b$evidence_reference = v_ref, qp_ba_approved=(p_fields->>'qpBaApproved')::boolean, qp_decision_reference=nullif(btrim(p_fields->>'qpDecisionReference'),''), updated_by$b$),
      ($a$'evidenceReference', v_ref$a$,$b$'evidenceReference', v_ref, 'qpBaApproved', (p_fields->>'qpBaApproved')::boolean, 'qpDecisionReference', p_fields->>'qpDecisionReference'$b$),
      ($a$'evidenceReference', v_old.evidence_reference$a$,$b$'evidenceReference', v_old.evidence_reference, 'qpBaApproved', v_old.qp_ba_approved, 'qpDecisionReference', v_old.qp_decision_reference$b$)
    ) x(old,new) loop
      if position(r.old in d)=0 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT'; end if;
      d:=replace(d,r.old,r.new);
    end loop;
    execute d;
  end if;
  select pg_get_functiondef(p.oid),p.prosrc into d,src from pg_proc p
  where p.oid='private.ist_period_performance_rows(text,uuid)'::regprocedure;
  if position('qpBaApproved' in src)=0 then
    for r in select * from (values
      ($a$e.id as engagement_id, e.contract_start$a$,$b$e.id as engagement_id, e.qp_ba_approved, e.qp_decision_reference, e.contract_start$b$),
      ($a$select g.id, g.rank, g.contract_start$a$,$b$select g.id, g.rank, g.qp_ba_approved, g.qp_decision_reference, g.contract_start$b$),
      ($a$coalesce(to_char(g.suspended_from, 'YYYY-MM-DD'), ''))$a$,$b$coalesce(to_char(g.suspended_from, 'YYYY-MM-DD'), '')) || case when g.qp_ba_approved is null then '' else concat_ws('|','QP',g.qp_ba_approved::text,g.qp_decision_reference) end$b$),
      ($a$'engagementId', line.engagement_id)$a$,$b$'engagementId', line.engagement_id, 'qpBaApproved', line.qp_ba_approved, 'qpDecisionReference', line.qp_decision_reference)$b$)
    ) x(old,new) loop
      if position(r.old in d)=0 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT'; end if;
      d:=replace(d,r.old,r.new);
    end loop;
    execute d;
  end if;
  select pg_get_functiondef(p.oid),p.prosrc into d,src from pg_proc p
  where p.oid='public.ist_staff_performance_evidence(text,uuid,uuid)'::regprocedure;
  if position('saleNumber' in src)=0 then
    if position($a$'paymentId', ev.payment_id,$a$ in d)=0 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT'; end if;
    d:=replace(d,$a$'paymentId', ev.payment_id,$a$,
      $b$'saleNumber', (select s.sale_number from public.card_sales s where s.id=ev.sale_id),
      'reservationNumber', (select r.reservation_number from public.reservation_agreements r where r.id=ev.reservation_id),
      'paymentNumber', (select p.payment_number from public.payments p where p.id=ev.payment_id),
      'paymentId', ev.payment_id,$b$);
    execute d;
  end if;
end $patch$;
notify pgrst,'reload schema';
commit;
