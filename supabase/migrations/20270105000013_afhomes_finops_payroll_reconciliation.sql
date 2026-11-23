-- AF Homes: immutable external-payment proof and accountable evidence reconciliation.
-- Approval and entitlement values remain frozen. Review acknowledges evidence differences.
-- No recovery, deduction or adjustment accounting policy is approved.
-- Validation: record a synthetic external payment after changing evidence, assert its record
-- survives, closing refuses until an authorized review, and review/proof rows are immutable.
-- Down: forward only. Preserve payment, proof, review and audit history.
begin;
create table if not exists public.payroll_disbursement_proofs (
  disbursement_id uuid primary key references public.payroll_disbursements(id) on delete restrict,
  evidence_reference text not null check(length(btrim(evidence_reference)) between 10 and 500),
  recorded_by uuid not null references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create table if not exists public.payroll_disbursement_reviews (
  disbursement_id uuid primary key references public.payroll_disbursements(id) on delete restrict,
  evidence_reference text not null check(length(btrim(evidence_reference)) between 10 and 500),
  note text not null check(length(btrim(note)) between 5 and 2000),
  reviewed_by uuid not null references public.staff_users(id) on delete restrict,
  reviewed_at timestamptz not null default now()
);
alter table public.payroll_disbursement_proofs enable row level security;
alter table public.payroll_disbursement_reviews enable row level security;
revoke all on public.payroll_disbursement_proofs,public.payroll_disbursement_reviews
from public,anon,authenticated,service_role;
grant select on public.payroll_disbursement_proofs,public.payroll_disbursement_reviews to service_role;
drop trigger if exists payroll_proof_immutable on public.payroll_disbursement_proofs;
create trigger payroll_proof_immutable before update or delete on public.payroll_disbursement_proofs
for each row execute function private.financial_history_guard();
drop trigger if exists payroll_review_immutable on public.payroll_disbursement_reviews;
create trigger payroll_review_immutable before update or delete on public.payroll_disbursement_reviews
for each row execute function private.financial_history_guard();
drop trigger if exists payroll_proof_truncate on public.payroll_disbursement_proofs;
create trigger payroll_proof_truncate before truncate on public.payroll_disbursement_proofs
for each statement execute function private.financial_history_guard();
drop trigger if exists payroll_review_truncate on public.payroll_disbursement_reviews;
create trigger payroll_review_truncate before truncate on public.payroll_disbursement_reviews
for each statement execute function private.financial_history_guard();

create or replace function public.record_payroll_disbursement(
 p_line_id uuid,p_amount text,p_method text,p_bank_reference text,p_paid_on date,p_actor_id uuid,p_proof_reference text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_id uuid; v_prior text; v_ref text:=btrim(coalesce(p_proof_reference,''));
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payroll','update');
  if length(v_ref) not between 10 and 500 then
    raise exception 'PAYROLL_PROOF_REQUIRED' using errcode='22023';
  end if;
  v_id:=public.record_payroll_disbursement(p_line_id,p_amount,p_method,p_bank_reference,p_paid_on,p_actor_id);
  select p.evidence_reference into v_prior from public.payroll_disbursement_proofs p where p.disbursement_id=v_id;
  if found then
    if v_prior<>v_ref then raise exception 'PAYROLL_PROOF_CONFLICT' using errcode='55000'; end if;
    return v_id;
  end if;
  insert into public.payroll_disbursement_proofs(disbursement_id,evidence_reference,recorded_by)
  values(v_id,v_ref,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
  values(p_actor_id,'PAYROLL_DISBURSEMENT_PROOF_RECORDED','payroll_disbursement',v_id::text,
    jsonb_build_object('evidenceReference',v_ref));
  return v_id;
end $$;
revoke all on function public.record_payroll_disbursement(uuid,text,text,text,date,uuid,text) from public,anon,authenticated;
grant execute on function public.record_payroll_disbursement(uuid,text,text,text,date,uuid,text) to service_role;

create or replace function public.reconcile_payroll_disbursement(
 p_disbursement_id uuid,p_note text,p_evidence_reference text,p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_batch uuid; v_status text; v_prior public.payroll_disbursement_reviews%rowtype;
 v_note text:=btrim(coalesce(p_note,'')); v_ref text:=btrim(coalesce(p_evidence_reference,''));
begin
  perform private.mutation_actor_role(p_actor_id,'finance.payroll_close','update');
  if length(v_note) not between 5 and 2000 then raise exception 'PAYROLL_REVIEW_NOTE_REQUIRED' using errcode='22023'; end if;
  if length(v_ref) not between 10 and 500 then raise exception 'PAYROLL_PROOF_REQUIRED' using errcode='22023'; end if;
  perform private.financial_decision_lock(true);
  select l.batch_id into v_batch from public.payroll_disbursements d
    join public.payroll_lines l on l.id=d.line_id where d.id=p_disbursement_id;
  if not found then raise exception 'PAYROLL_LINE_NOT_FOUND' using errcode='P0002'; end if;
  select b.status into v_status from public.payroll_batches b where b.id=v_batch for update;
  select * into v_prior from public.payroll_disbursement_reviews r where r.disbursement_id=p_disbursement_id;
  if found then
    if (v_prior.note,v_prior.evidence_reference,v_prior.reviewed_by) is distinct from (v_note,v_ref,p_actor_id) then
      raise exception 'PAYROLL_RECONCILIATION_ALREADY_RECORDED' using errcode='55000';
    end if;
    return p_disbursement_id;
  end if;
  if v_status<>'approved' then raise exception 'PAYROLL_BATCH_NOT_APPROVED' using errcode='55000'; end if;
  insert into public.payroll_disbursement_reviews(disbursement_id,note,evidence_reference,reviewed_by)
  values(p_disbursement_id,v_note,v_ref,p_actor_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data,reason)
  values(p_actor_id,'PAYROLL_DISBURSEMENT_RECONCILED','payroll_disbursement',p_disbursement_id::text,
    jsonb_build_object('batchId',v_batch,'evidenceReference',v_ref),v_note);
  return p_disbursement_id;
end $$;
revoke all on function public.reconcile_payroll_disbursement(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_payroll_disbursement(uuid,text,text,uuid) to service_role;

create or replace function private.payroll_reconciliation_close_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
  if new.mode='live' and new.status='closed' and old.status<>'closed' and exists(
    select 1 from public.payroll_lines l join public.payroll_disbursements d on d.line_id=l.id
    where l.batch_id=new.id and exists(select 1 from public.audit_events a
      where a.entity_id=d.id::text and a.action='PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED')
      and not exists(select 1 from public.payroll_disbursement_reviews r where r.disbursement_id=d.id)
  ) then raise exception 'PAYROLL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;
  return new;
end $$;
revoke all on function private.payroll_reconciliation_close_guard() from public,anon,authenticated,service_role;
drop trigger if exists payroll_reconciliation_close_guard on public.payroll_batches;
create trigger payroll_reconciliation_close_guard before update on public.payroll_batches
for each row execute function private.payroll_reconciliation_close_guard();
notify pgrst,'reload schema';
commit;
