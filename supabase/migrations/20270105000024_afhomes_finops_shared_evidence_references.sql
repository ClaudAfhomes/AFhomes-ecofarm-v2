-- AF Homes: one OR number / transaction reference may support several external payments,
-- capped by the transfer amount (owner decision 2026-11-19, OPEN_QUESTIONS Q15(e)).
--
-- Before: a typed reference cleared the evidence exception on any number of payments, with
-- nothing tying it to money (security review finding, 20270105000023).
-- Now, for evidence_type external_transaction_reference and official_receipt:
--   1. transfer_amount (exact-decimal text, > 0) is REQUIRED: the amount shown on the bank
--      statement / OR. Uploaded documents carry none (their path is unique per payment).
--   2. Every row sharing a reference (same normalized reference, whether typed as a transaction
--      reference or an OR, so switching the type cannot open a second cap) must state the SAME
--      transfer amount (EVIDENCE_REFERENCE_AMOUNT_MISMATCH), a replay included.
--   3. The payments linked to one reference may not exceed its transfer amount in total
--      (EVIDENCE_REFERENCE_OVERALLOCATED). This also applies to a single payment. Bulk bank
--      transfers (one reference, many payees) remain possible within the cap.
--   4. An OR number belongs to one payee: the same OR for a different payee is refused
--      (EVIDENCE_OR_OTHER_PAYEE). Payee = commission beneficiary (staff or OST) or the payroll
--      line's staff member. A payment whose payee cannot be resolved cannot use an OR.
--   Both payment amounts are immutable after insert (payroll_disbursement_guard,
--   commission_payout_guard), so a cap checked here stays true.
--   A per-reference advisory lock serializes concurrent allocations of the same reference.
-- Rows recorded before this migration keep transfer_amount null and are not reinterpreted;
-- they count toward no cap (history is never rewritten).
-- Nothing here verifies a transaction automatically or changes a payment amount.
-- Validation: pnpm test:db:local (section 83 shared-reference checks); rls_invariants.sql empty.
-- Down: forward only. Never delete evidence or audit history.
begin;

alter table public.external_payment_evidence
  add column if not exists transfer_amount text
    check (transfer_amount is null or (transfer_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
           and transfer_amount::numeric > 0));
comment on column public.external_payment_evidence.transfer_amount is
  'Amount on the bank statement / OR. Every payment sharing the reference must fit within it.';

-- Payee identity of an external payment (null when the payment does not exist).
create or replace function private.external_payment_payee(p_subject_type text, p_subject_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select case p_subject_type
    when 'commission_payout' then (
      select coalesce('staff:' || c.beneficiary_staff_id::text, 'ost:' || c.beneficiary_ost_id::text)
        from public.commission_payouts o join public.commissions c on c.id = o.commission_id
       where o.id = p_subject_id)
    when 'payroll_disbursement' then (
      select 'staff:' || l.staff_id::text
        from public.payroll_disbursements d join public.payroll_lines l on l.id = d.line_id
       where d.id = p_subject_id)
  end
$$;
revoke all on function private.external_payment_payee(text, uuid) from public, anon, authenticated, service_role;

create or replace function private.external_payment_amount(p_subject_type text, p_subject_id uuid)
returns numeric language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select case p_subject_type
    when 'commission_payout' then (select o.amount::numeric from public.commission_payouts o where o.id = p_subject_id)
    when 'payroll_disbursement' then (select d.amount::numeric from public.payroll_disbursements d where d.id = p_subject_id)
  end
$$;
revoke all on function private.external_payment_amount(text, uuid) from public, anon, authenticated, service_role;

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
  v_transfer text := nullif(btrim(coalesce(p_evidence->>'transferAmount', '')), '');
  v_key text;
  v_payee text;
  v_allocated numeric;
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
    if v_path is null or v_txn is not null or v_or is not null or v_transfer is not null
       or position(('external/' || p_subject_type || '/' || lower(p_subject_id::text) || '/') in v_path) <> 1
       or v_path ~ '\.\.' then
      raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    perform private.require_payment_receipt_object(v_path);
  else
    if v_type = 'external_transaction_reference' then
      if v_txn is null or v_path is not null or v_or is not null
         or length(v_txn) not between 3 and 100 or private.normalize_payment_key(v_txn) is null then
        raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
      end if;
    elsif v_or is null or v_path is not null or v_txn is not null
       or length(v_or) > 60 or private.normalize_payment_key(v_or) is null then
      raise exception 'EXTERNAL_PAYMENT_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    if v_transfer is null or v_transfer !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' or v_transfer::numeric <= 0 then
      raise exception 'EVIDENCE_TRANSFER_AMOUNT_REQUIRED' using errcode = '22023';
    end if;
  end if;
  v_key := coalesce(v_path, private.normalize_payment_key(v_txn), private.normalize_payment_key(v_or));

  -- Serialize every allocation of this reference (any payment) before reading its usage.
  if v_type <> 'uploaded_document' then
    perform pg_advisory_xact_lock(hashtextextended('afhomes.evidence:ref:' || v_key, 0));
    if exists (select 1 from public.external_payment_evidence e
                where e.evidence_type <> 'uploaded_document' and e.transfer_amount is not null
                  and coalesce(private.normalize_payment_key(e.transaction_reference), private.normalize_payment_key(e.or_number)) = v_key
                  and e.transfer_amount::numeric <> v_transfer::numeric) then
      raise exception 'EVIDENCE_REFERENCE_AMOUNT_MISMATCH' using errcode = '55000';
    end if;
  end if;

  -- Replay: the same evidence for the same payment returns the existing row.
  select e.id into v_id from public.external_payment_evidence e
   where e.subject_type = p_subject_type and e.subject_id = p_subject_id and e.evidence_type = v_type
     and coalesce(e.storage_path, private.normalize_payment_key(e.transaction_reference), private.normalize_payment_key(e.or_number))
       = v_key;
  if found then return v_id; end if;

  if v_type <> 'uploaded_document' then
    if v_type = 'official_receipt' then
      v_payee := private.external_payment_payee(p_subject_type, p_subject_id);
      if v_payee is null or exists (select 1 from public.external_payment_evidence e
                  where e.evidence_type = 'official_receipt'
                    and private.normalize_payment_key(e.or_number) = v_key
                    and private.external_payment_payee(e.subject_type, e.subject_id) is distinct from v_payee) then
        raise exception 'EVIDENCE_OR_OTHER_PAYEE' using errcode = '55000';
      end if;
    end if;
    -- Payments already supported by this reference (each counted once), plus this one.
    select coalesce(sum(private.external_payment_amount(s.subject_type, s.subject_id)), 0)
      into v_allocated
      from (select distinct e.subject_type, e.subject_id from public.external_payment_evidence e
             where e.evidence_type <> 'uploaded_document' and e.transfer_amount is not null
               and coalesce(private.normalize_payment_key(e.transaction_reference), private.normalize_payment_key(e.or_number)) = v_key) s;
    if v_allocated + private.external_payment_amount(p_subject_type, p_subject_id) > v_transfer::numeric then
      raise exception 'EVIDENCE_REFERENCE_OVERALLOCATED' using errcode = '55000';
    end if;
  end if;

  insert into public.external_payment_evidence
    (subject_type, subject_id, evidence_type, source, storage_path, transaction_reference, or_number,
     description, transfer_amount, recorded_by)
  values (p_subject_type, p_subject_id, v_type, v_source, v_path, v_txn, v_or, v_desc,
          case when v_transfer is null then null else private.money(v_transfer::numeric) end, p_actor_id)
  returning id into v_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'EXTERNAL_PAYMENT_EVIDENCE_RECORDED', p_subject_type, p_subject_id::text,
    jsonb_strip_nulls(jsonb_build_object('evidenceId', v_id, 'evidenceType', v_type, 'source', v_source,
      'documentAttached', v_path is not null, 'transactionReference', v_txn, 'orNumber', v_or,
      'transferAmount', v_transfer)));
  return v_id;
end $$;
revoke all on function public.record_external_payment_evidence(text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_external_payment_evidence(text, uuid, jsonb, uuid) to service_role;

commit;
