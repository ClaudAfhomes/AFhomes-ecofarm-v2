-- AF Homes: verifiable evidence for payments completed OUTSIDE AF Homes (owner decision
-- 2026-11-19, OPEN_QUESTIONS Q15(e)). Covers live payroll disbursements and commission payouts.
--
-- Before: the only "proof" was a typed text (payroll_disbursement_proofs.evidence_reference,
-- commissions.paid_evidence_reference). It stays - as a DESCRIPTION - but a typed description
-- alone is never treated as verified proof any more.
--   1. public.external_payment_evidence: append-only, one row per piece of evidence:
--        evidence_type  uploaded_document               a file in the existing private bucket
--                                                       afhomes-payment-receipts, under
--                                                       external/<subject_type>/<subject_id>/, whose
--                                                       object must exist (private.require_payment_receipt_object)
--                       external_transaction_reference  a structured bank / e-wallet transaction id
--                       official_receipt                an existing Official Receipt number
--        source         who issued it (bank, e-wallet, OR booklet), 2-120 characters
--        recorded_by / recorded_at, and an audit event per row. Rows are immutable.
--   2. Evidence status (private.external_payment_evidence_status): SUPPORTED when at least one
--      row exists; otherwise EVIDENCE_EXCEPTION. The factual payment record is never removed or
--      hidden for missing evidence - the exception is flagged and routed:
--        payroll disbursement -> closing a live batch is refused with
--          PAYROLL_EVIDENCE_EXCEPTION_UNRESOLVED until each such payment has evidence or the
--          EXISTING authorized reconciliation review (reconcile_payroll_disbursement,
--          finance.payroll_close) is recorded for it.
--        commission payout    -> the EXISTING bank reconciliation (reconcile_commission_payout,
--          finance.commission_payouts, already a month-end blocker while unreconciled) is
--          refused with PAYOUT_EVIDENCE_EXCEPTION_UNRESOLVED until evidence is attached or the
--          exception review below is recorded.
--   3. public.commission_payout_evidence_reviews + review_commission_payout_evidence_exception:
--      the authorized, noted, immutable acknowledgement that a commission paid outside AF Homes
--      has no attachable evidence (the payroll side already has payroll_disbursement_reviews).
-- Nothing here verifies a transaction automatically, creates a document, or changes an amount.
-- Permissions (no new module keys): payroll disbursement evidence finance.payroll update;
--   commission payout evidence and reviews finance.commission_payouts update.
-- Validation: pnpm test:db:local (section 84 / 83 evidence checks); rls_invariants.sql empty;
--   select has_table_privilege('authenticated','public.external_payment_evidence','SELECT'); -- f
-- Down: forward only. Never delete evidence, reviews or audit history.
begin;

create table if not exists public.external_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('payroll_disbursement','commission_payout')),
  subject_id uuid not null,
  evidence_type text not null check (evidence_type in
    ('uploaded_document','external_transaction_reference','official_receipt')),
  source text not null check (length(btrim(source)) between 2 and 120),
  storage_path text check (storage_path is null or (length(storage_path) between 1 and 300
    and storage_path !~ '\.\.')),
  transaction_reference text check (transaction_reference is null
    or (length(btrim(transaction_reference)) between 3 and 100
        and private.normalize_payment_key(transaction_reference) is not null)),
  or_number text check (or_number is null or (length(btrim(or_number)) between 1 and 60
    and private.normalize_payment_key(or_number) is not null)),
  description text check (description is null or length(btrim(description)) between 1 and 500),
  recorded_by uuid not null references public.staff_users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint external_payment_evidence_shape check (
    (evidence_type = 'uploaded_document'
       and storage_path is not null and transaction_reference is null and or_number is null)
    or (evidence_type = 'external_transaction_reference'
       and transaction_reference is not null and storage_path is null and or_number is null)
    or (evidence_type = 'official_receipt'
       and or_number is not null and storage_path is null and transaction_reference is null))
);
comment on table public.external_payment_evidence is
  'Verifiable evidence for a payment made outside AF Homes (payroll disbursement / commission payout). Append-only. A typed description alone is never evidence.';
create index if not exists external_payment_evidence_subject_idx
  on public.external_payment_evidence (subject_type, subject_id);
-- The same piece of evidence is recorded once per payment (a retry replays it).
create unique index if not exists external_payment_evidence_once
  on public.external_payment_evidence (subject_type, subject_id, evidence_type,
    coalesce(storage_path, private.normalize_payment_key(transaction_reference), private.normalize_payment_key(or_number)));
alter table public.external_payment_evidence enable row level security;
revoke all on public.external_payment_evidence from public, anon, authenticated, service_role;
grant select on public.external_payment_evidence to service_role;
drop trigger if exists external_payment_evidence_immutable on public.external_payment_evidence;
create trigger external_payment_evidence_immutable before update or delete on public.external_payment_evidence
  for each row execute function private.financial_history_guard();
drop trigger if exists external_payment_evidence_truncate on public.external_payment_evidence;
create trigger external_payment_evidence_truncate before truncate on public.external_payment_evidence
  for each statement execute function private.financial_history_guard();

create table if not exists public.commission_payout_evidence_reviews (
  payout_id uuid primary key references public.commission_payouts(id) on delete restrict,
  note text not null check (length(btrim(note)) between 10 and 2000),
  reviewed_by uuid not null references public.staff_users(id) on delete restrict,
  reviewed_at timestamptz not null default now()
);
comment on table public.commission_payout_evidence_reviews is
  'Authorized acknowledgement that a commission paid outside AF Homes has no attachable evidence. The payment stays recorded; the exception is explained, never hidden.';
alter table public.commission_payout_evidence_reviews enable row level security;
revoke all on public.commission_payout_evidence_reviews from public, anon, authenticated, service_role;
grant select on public.commission_payout_evidence_reviews to service_role;
drop trigger if exists commission_payout_evidence_review_immutable on public.commission_payout_evidence_reviews;
create trigger commission_payout_evidence_review_immutable before update or delete on public.commission_payout_evidence_reviews
  for each row execute function private.financial_history_guard();
drop trigger if exists commission_payout_evidence_review_truncate on public.commission_payout_evidence_reviews;
create trigger commission_payout_evidence_review_truncate before truncate on public.commission_payout_evidence_reviews
  for each statement execute function private.financial_history_guard();

create or replace function private.external_payment_evidence_status(p_subject_type text, p_subject_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select case when exists (select 1 from public.external_payment_evidence e
                            where e.subject_type = p_subject_type and e.subject_id = p_subject_id)
              then 'SUPPORTED' else 'EVIDENCE_EXCEPTION' end
$$;
revoke all on function private.external_payment_evidence_status(text, uuid) from public, anon, authenticated, service_role;

-- Record one piece of evidence. p_evidence: { evidenceType, source, storagePath?,
-- transactionReference?, orNumber?, description? }.
create or replace function public.record_external_payment_evidence(
  p_subject_type text, p_subject_id uuid, p_evidence jsonb, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_type text := p_evidence->>'evidenceType';
  v_source text := nullif(btrim(coalesce(p_evidence->>'source', '')), '');
  v_path text := nullif(btrim(coalesce(p_evidence->>'storagePath', '')), '');
  v_txn text := nullif(btrim(coalesce(p_evidence->>'transactionReference', '')), '');
  v_or text := nullif(btrim(coalesce(p_evidence->>'orNumber', '')), '');
  v_desc text := nullif(btrim(coalesce(p_evidence->>'description', '')), '');
  v_id uuid;
begin
  if p_subject_type = 'payroll_disbursement' then
    perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
    -- Live external payments only; the row lock serializes concurrent replays.
    perform 1 from public.payroll_disbursements d
      join public.payroll_lines l on l.id = d.line_id
      join public.payroll_batches b on b.id = l.batch_id
     where d.id = p_subject_id and b.mode = 'live'
       for update of d;
    if not found then
      raise exception 'EXTERNAL_PAYMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_subject_type = 'commission_payout' then
    perform private.mutation_actor_role(p_actor_id, 'finance.commission_payouts', 'update');
    perform 1 from public.commission_payouts o
     where o.id = p_subject_id and o.status in ('paid','reconciled')
       for update;
    if not found then
      raise exception 'EXTERNAL_PAYMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'object'
     or v_type is null or v_type not in ('uploaded_document','external_transaction_reference','official_receipt')
     or v_source is null or length(v_source) not between 2 and 120
     or length(coalesce(v_desc, '')) > 500 then
    raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  -- Exactly the field the type needs; nothing typed stands in for a document.
  if v_type = 'uploaded_document' then
    if v_path is null or v_txn is not null or v_or is not null
       or position(('external/' || p_subject_type || '/' || lower(p_subject_id::text) || '/') in v_path) <> 1
       or v_path ~ '\.\.' then
      raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    perform private.require_payment_receipt_object(v_path);
  elsif v_type = 'external_transaction_reference' then
    if v_txn is null or v_path is not null or v_or is not null
       or length(v_txn) not between 3 and 100 or private.normalize_payment_key(v_txn) is null then
      raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
    end if;
  else
    if v_or is null or v_path is not null or v_txn is not null
       or length(v_or) > 60 or private.normalize_payment_key(v_or) is null then
      raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
    end if;
  end if;

  -- Replay: the same evidence for the same payment returns the existing row.
  select e.id into v_id from public.external_payment_evidence e
   where e.subject_type = p_subject_type and e.subject_id = p_subject_id and e.evidence_type = v_type
     and coalesce(e.storage_path, private.normalize_payment_key(e.transaction_reference), private.normalize_payment_key(e.or_number))
       = coalesce(v_path, private.normalize_payment_key(v_txn), private.normalize_payment_key(v_or));
  if found then return v_id; end if;

  insert into public.external_payment_evidence
    (subject_type, subject_id, evidence_type, source, storage_path, transaction_reference, or_number, description, recorded_by)
  values (p_subject_type, p_subject_id, v_type, v_source, v_path, v_txn, v_or, v_desc, p_actor_id)
  returning id into v_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'EXTERNAL_PAYMENT_EVIDENCE_RECORDED', p_subject_type, p_subject_id::text,
    jsonb_strip_nulls(jsonb_build_object('evidenceId', v_id, 'evidenceType', v_type, 'source', v_source,
      'documentAttached', v_path is not null, 'transactionReference', v_txn, 'orNumber', v_or)));
  return v_id;
end $$;
revoke all on function public.record_external_payment_evidence(text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_external_payment_evidence(text, uuid, jsonb, uuid) to service_role;

create or replace function public.review_commission_payout_evidence_exception(
  p_payout_id uuid, p_note text, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_note text := btrim(coalesce(p_note, '')); v_prior public.commission_payout_evidence_reviews%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.commission_payouts', 'update');
  if length(v_note) not between 10 and 2000 then
    raise exception 'EVIDENCE_EXCEPTION_NOTE_REQUIRED' using errcode = '22023';
  end if;
  perform 1 from public.commission_payouts o where o.id = p_payout_id and o.status in ('paid','reconciled') for update;
  if not found then raise exception 'EXTERNAL_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_prior from public.commission_payout_evidence_reviews r where r.payout_id = p_payout_id;
  if found then
    if (v_prior.note, v_prior.reviewed_by) is distinct from (v_note, p_actor_id) then
      raise exception 'EVIDENCE_EXCEPTION_ALREADY_REVIEWED' using errcode = '55000';
    end if;
    return p_payout_id;
  end if;
  if private.external_payment_evidence_status('commission_payout', p_payout_id) = 'SUPPORTED' then
    raise exception 'EVIDENCE_EXCEPTION_NOT_NEEDED' using errcode = '55000';
  end if;
  insert into public.commission_payout_evidence_reviews (payout_id, note, reviewed_by)
  values (p_payout_id, v_note, p_actor_id);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
  values (p_actor_id, 'EXTERNAL_PAYMENT_EVIDENCE_EXCEPTION_REVIEWED', 'commission_payout', p_payout_id::text,
    jsonb_build_object('evidenceStatus', 'EVIDENCE_EXCEPTION'), v_note);
  return p_payout_id;
end $$;
revoke all on function public.review_commission_payout_evidence_exception(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.review_commission_payout_evidence_exception(uuid, text, uuid) to service_role;

-- Commission payout reconciliation needs evidence or an explained exception.
do $patch$
declare d text; v_old text := $a$  perform set_config('afhomes.payout_date_correction', case when v_corrected then 'on' else 'off' end, true);$a$;
begin
  select pg_get_functiondef('public.reconcile_commission_payout(uuid,uuid,text,date,text)'::regprocedure) into d;
  d := replace(d, E'\r\n', E'\n');
  if position('PAYOUT_EVIDENCE_EXCEPTION_UNRESOLVED' in d) = 0 then
    if position(v_old in d) = 0 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT'; end if;
    d := replace(d, v_old,
      $b$  -- 20270105000023: a typed description is not proof; evidence or an explained exception is.
  if private.external_payment_evidence_status('commission_payout', v.id) <> 'SUPPORTED'
     and not exists (select 1 from public.commission_payout_evidence_reviews r where r.payout_id = v.id) then
    raise exception 'PAYOUT_EVIDENCE_EXCEPTION_UNRESOLVED' using errcode = '55000';
  end if;
$b$ || v_old);
    execute d;
  end if;
end $patch$;

-- Live payroll close: every external payment has evidence or an authorized review.
create or replace function private.payroll_reconciliation_close_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
  if new.mode='live' and new.status='closed' and old.status<>'closed' then
    if exists(
      select 1 from public.payroll_lines l join public.payroll_disbursements d on d.line_id=l.id
      where l.batch_id=new.id and exists(select 1 from public.audit_events a
        where a.entity_id=d.id::text and a.action='PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED')
        and not exists(select 1 from public.payroll_disbursement_reviews r where r.disbursement_id=d.id)
    ) then raise exception 'PAYROLL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;
    if exists(
      select 1 from public.payroll_lines l join public.payroll_disbursements d on d.line_id=l.id
      where l.batch_id=new.id
        and private.external_payment_evidence_status('payroll_disbursement', d.id) <> 'SUPPORTED'
        and not exists(select 1 from public.payroll_disbursement_reviews r where r.disbursement_id=d.id)
    ) then raise exception 'PAYROLL_EVIDENCE_EXCEPTION_UNRESOLVED' using errcode='55000'; end if;
  end if;
  return new;
end $$;
revoke all on function private.payroll_reconciliation_close_guard() from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
