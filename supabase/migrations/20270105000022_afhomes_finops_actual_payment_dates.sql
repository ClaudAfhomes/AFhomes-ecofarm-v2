-- AF Homes: actual payment dates (owner decision 2026-11-19, OPEN_QUESTIONS Q15(b)).
--
-- Historical paid-on dates stay allowed. Each payment keeps four separate facts: the actual
-- external payment date (paid_on), the system recording time (recorded_at), the recording
-- employee (recorded_by) and the accounting posting period. This migration closes the gaps:
--   1. public.set_payment_receipt_details: changing a payment date that is already recorded
--      (on a payment still pending verification) now needs paidOnCorrectionReason (>= 5
--      characters). The audit event keeps the previous date and the reason. A verified
--      payment's date was, and stays, immutable (payment_verification_guard).
--   2. public.reconcile_commission_payout: reconciliation used to overwrite the recorded
--      payment date silently. A different date now needs a correction reason (new 5-argument
--      overload); the 4-argument form keeps working only when the date is unchanged. The
--      payout guard refuses any date change made outside that function.
--   3. payroll_disbursements.posting_period and commission_payouts.posting_period: stamped
--      once at insert with the EXISTING accounting rule used for verified customer payments
--      (20270105000003): the Asia/Manila month of recording, moved to the next open month
--      when that month is closed. A closed period is never reopened or rewritten. Rows
--      recorded before this migration keep NULL (both tables are append-only history); the
--      API derives their month from recorded_at the same way and labels it derived.
--   4. Live IST performance (count_date_basis = 'paid_on', when one is ever approved): a
--      payment whose paid_on month already has an APPROVED / CLOSED live payroll batch, and
--      that was verified after that batch was approved, never changes the finalized month.
--      It is INELIGIBLE in that month and UNDETERMINED (PAID_ON_IN_FINALIZED_PAYROLL) in the
--      month it was posted to, which blocks only that seller's line for authorized
--      reconciliation. No policy decides how such money is credited; none is invented.
-- Future payment dates stay refused everywhere (Asia/Manila calendar date).
-- Validation: pnpm test:db:local (section 89 Q15(b) checks and section 83/84 date checks);
--   select count(*) from information_schema.columns where table_schema='public'
--     and column_name='posting_period' and table_name in ('payroll_disbursements','commission_payouts'); -- 2
-- Down: forward only. Never clear recorded dates, periods or audit history.
begin;

-- ---------------------------------------------------------------------------
-- 1. Customer payment date corrections need a reason
-- ---------------------------------------------------------------------------
create or replace function public.set_payment_receipt_details(
  p_payment_id uuid, p_actor_id uuid, p_details jsonb
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_pay public.payments%rowtype;
  v_or text := nullif(btrim(coalesce(p_details->>'orNumber', '')), '');
  v_payer text := nullif(btrim(coalesce(p_details->>'paidByName', '')), '');
  v_note text := nullif(btrim(coalesce(p_details->>'duplicateReviewNote', '')), '');
  v_correction text := nullif(btrim(coalesce(p_details->>'paidOnCorrectionReason', '')), '');
  v_paid_on date;
  v_corrected_from date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payment_verification', 'update');
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'PAYMENT_DETAILS_INVALID' using errcode = '22023';
  end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_pay.status <> 'recorded' then
    raise exception 'PAYMENT_NOT_PENDING' using errcode = '55000';
  end if;

  if p_details ? 'paidOn' and nullif(p_details->>'paidOn', '') is not null then
    if (p_details->>'paidOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
    end if;
    begin
      v_paid_on := (p_details->>'paidOn')::date;
    exception when others then
      raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
    end;
    -- A receipt cannot be dated in the future.
    if v_paid_on > v_today then raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023'; end if;
    -- A recorded payment date is a fact: replacing it is a correction and needs a reason.
    if v_pay.paid_on is not null and v_paid_on <> v_pay.paid_on then
      if v_correction is null or length(v_correction) < 5 then
        raise exception 'PAYMENT_DATE_CORRECTION_REASON_REQUIRED' using errcode = '22023';
      end if;
      v_corrected_from := v_pay.paid_on;
    end if;
  end if;
  if length(coalesce(v_or, '')) > 60 or length(coalesce(v_payer, '')) > 120
     or length(coalesce(v_correction, '')) > 500 then
    raise exception 'PAYMENT_DETAILS_INVALID' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) < 5 then
    raise exception 'DUPLICATE_REVIEW_NOTE_REQUIRED' using errcode = '22023';
  end if;
  -- A review reason answers a match that exists NOW; it cannot be written in
  -- advance to pre-clear a duplicate that has not appeared yet.
  if v_note is not null
     and not exists (select 1 from private.payment_cross_contract_matches(v_pay.id)) then
    raise exception 'DUPLICATE_REVIEW_NOT_NEEDED' using errcode = '55000';
  end if;
  -- Same OR number twice on one contract is refused with a clear code, not a raw index error.
  if v_or is not null and exists (
       select 1 from public.payments o
        where o.id <> v_pay.id and o.status in ('recorded','verified')
          and (coalesce(o.sale_id = v_pay.sale_id, false)
               or coalesce(o.reservation_id = v_pay.reservation_id, false))
          and private.normalize_payment_key(o.or_number) = private.normalize_payment_key(v_or)
     ) then
    raise exception 'DUPLICATE_OR_NUMBER' using errcode = '23505';
  end if;

  update public.payments set
    or_number = coalesce(v_or, or_number),
    paid_on = coalesce(v_paid_on, paid_on),
    paid_by_name = coalesce(v_payer, paid_by_name),
    duplicate_review_note = coalesce(v_note, duplicate_review_note),
    duplicate_reviewed_by = case when v_note is not null then p_actor_id else duplicate_reviewed_by end,
    duplicate_reviewed_at = case when v_note is not null then now() else duplicate_reviewed_at end
  where id = v_pay.id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id,
    case when v_corrected_from is not null then 'PAYMENT_DATE_CORRECTED' else 'PAYMENT_DETAILS_RECORDED' end,
    'payment', v_pay.id::text,
    case when v_corrected_from is not null then jsonb_build_object('paidOn', v_corrected_from) end,
    jsonb_strip_nulls(jsonb_build_object('orNumber', v_or, 'paidOn', v_paid_on,
      'paidByNameRecorded', v_payer is not null, 'duplicateReviewed', v_note is not null,
      'paidOnCorrectionReason', case when v_corrected_from is not null then v_correction end)),
    coalesce(v_note, case when v_corrected_from is not null then v_correction end));
  return v_pay.id;
end $$;
revoke all on function public.set_payment_receipt_details(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_payment_receipt_details(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Commission payout reconciliation never changes the payment date silently
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_commission_payout(
  p_payout_id uuid, p_actor_id uuid, p_bank_reference text, p_paid_on date, p_date_correction_reason text
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v public.commission_payouts%rowtype;
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_reason text := nullif(btrim(coalesce(p_date_correction_reason, '')), '');
  v_corrected boolean;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.commission_payouts', 'update');
  select * into v from public.commission_payouts where id = p_payout_id for update;
  if not found then raise exception 'COMMISSION_PAYOUT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'reconciled' then return v.id; end if;  -- replay
  if v.status <> 'paid' then raise exception 'COMMISSION_PAYOUT_NOT_PAID' using errcode = '55000'; end if;
  -- A recorded reference is never rewritten; a supplied one must match it.
  if v.bank_reference is not null then
    if v_ref is not null and private.normalize_payment_key(v_ref) is distinct from
       private.normalize_payment_key(v.bank_reference) then
      raise exception 'PAYOUT_REFERENCE_MISMATCH' using errcode = '22023';
    end if;
    v_ref := v.bank_reference;
  end if;
  if v_ref is null or length(v_ref) < 3 or private.normalize_payment_key(v_ref) is null then
    raise exception 'PAYOUT_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  -- The recorded payment date is a fact. A different confirmed date is a correction.
  v_corrected := v.paid_on is not null and p_paid_on <> v.paid_on;
  if v_corrected and (v_reason is null or length(v_reason) not between 5 and 500) then
    raise exception 'PAYMENT_DATE_CORRECTION_REASON_REQUIRED' using errcode = '22023';
  end if;
  if exists (select 1 from public.commission_payouts o
              where o.id <> v.id and o.status in ('paid','reconciled')
                and private.normalize_payment_key(o.bank_reference) = private.normalize_payment_key(v_ref)) then
    raise exception 'DUPLICATE_PAYOUT_REFERENCE' using errcode = '23505';
  end if;
  perform set_config('afhomes.payout_date_correction', case when v_corrected then 'on' else 'off' end, true);
  update public.commission_payouts
     set status = 'reconciled', bank_reference = v_ref, paid_on = p_paid_on,
         reconciled_by = p_actor_id, reconciled_at = now()
   where id = v.id;
  perform set_config('afhomes.payout_date_correction', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'COMMISSION_PAYOUT_RECONCILED', 'commission_payout', v.id::text,
    jsonb_build_object('status', 'paid', 'paidOn', v.paid_on),
    jsonb_strip_nulls(jsonb_build_object('status', 'reconciled', 'bankReference', v_ref, 'paidOn', p_paid_on,
      'paidOnCorrected', v_corrected)),
    case when v_corrected then v_reason end);
  return v.id;
end $$;
revoke all on function public.reconcile_commission_payout(uuid, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.reconcile_commission_payout(uuid, uuid, text, date, text) to service_role;

-- The original signature stays callable; it cannot correct a date (no reason to give).
create or replace function public.reconcile_commission_payout(
  p_payout_id uuid, p_actor_id uuid, p_bank_reference text, p_paid_on date
) returns uuid language sql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
  select public.reconcile_commission_payout(p_payout_id, p_actor_id, p_bank_reference, p_paid_on, null::text)
$$;
revoke all on function public.reconcile_commission_payout(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.reconcile_commission_payout(uuid, uuid, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Posting period on external payouts (existing accounting rule, never reopened)
-- ---------------------------------------------------------------------------
alter table public.payroll_disbursements add column if not exists posting_period text
  check (posting_period is null or posting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
alter table public.commission_payouts add column if not exists posting_period text
  check (posting_period is null or posting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
comment on column public.payroll_disbursements.posting_period is
  'Accounting month (Asia/Manila) the external payout was recorded into; the next open month when that month is closed. Stamped once at insert. NULL = recorded before 20270105000022 (derive from recorded_at).';
comment on column public.commission_payouts.posting_period is
  'Accounting month (Asia/Manila) the external payout was recorded into; the next open month when that month is closed. Stamped once at insert. NULL = recorded before 20270105000022 (derive from recorded_at).';

-- The open accounting month for a recording made now: same loop as payment_open_period_guard.
create or replace function private.open_posting_period(p_period text) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_period text := p_period; v_status text; v_tries integer := 0;
begin
  loop
    insert into public.accounting_periods (period) values (v_period) on conflict (period) do nothing;
    select p.status into v_status from public.accounting_periods p where p.period = v_period for share;
    exit when v_status is distinct from 'closed';
    v_period := to_char(to_date(v_period || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
    v_tries := v_tries + 1;
    if v_tries > 600 then raise exception 'CLOSED_PERIOD_IMMUTABLE' using errcode = '55000'; end if;
  end loop;
  return v_period;
end $$;
revoke all on function private.open_posting_period(text) from public, anon, authenticated, service_role;

create or replace function private.external_payout_posting_period() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
begin
  -- Always the system's own month: a caller cannot choose (or backdate) the posting period.
  new.posting_period := private.open_posting_period(to_char(now() at time zone 'Asia/Manila', 'YYYY-MM'));
  return new;
end $$;
revoke all on function private.external_payout_posting_period() from public, anon, authenticated, service_role;
drop trigger if exists payroll_disbursements_posting_period on public.payroll_disbursements;
create trigger payroll_disbursements_posting_period before insert on public.payroll_disbursements
  for each row execute function private.external_payout_posting_period();
drop trigger if exists commission_payouts_posting_period on public.commission_payouts;
create trigger commission_payouts_posting_period before insert on public.commission_payouts
  for each row execute function private.external_payout_posting_period();

-- The payout guard: the payment date moves only through a reasoned reconciliation, and the
-- posting period never moves at all.
create or replace function private.commission_payout_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COMMISSION_PAYOUT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  -- A failed or reconciled row never changes. A paid row stays byte-identical while
  -- paid; its only legal change is paid -> reconciled, which may set the confirmed
  -- date (with a recorded correction reason when it differs), the reconciliation
  -- actor/time, and a bank reference only where none existed.
  if old.status in ('failed','reconciled') or new.status not in ('paid','reconciled')
     or new.status = 'paid' and new is distinct from old
     or (new.id, new.commission_id, new.amount, new.method, new.failure_reason, new.recorded_by, new.recorded_at,
         new.posting_period)
        is distinct from
        (old.id, old.commission_id, old.amount, old.method, old.failure_reason, old.recorded_by, old.recorded_at,
         old.posting_period)
     or (old.bank_reference is not null and new.bank_reference is distinct from old.bank_reference)
     or (old.paid_on is not null and new.paid_on is distinct from old.paid_on
         and coalesce(current_setting('afhomes.payout_date_correction', true), 'off') <> 'on') then
    raise exception 'COMMISSION_PAYOUT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.commission_payout_guard() from public, anon, authenticated, service_role;
-- The API only reads payouts; every write goes through the SECURITY DEFINER functions,
-- so the date-correction switch above is reachable only through the audited reconcile.
revoke insert, update, delete, truncate on public.commission_payouts from service_role;

-- ---------------------------------------------------------------------------
-- 4. A late payment never changes a finalized payroll month (paid_on basis only)
-- ---------------------------------------------------------------------------
do $patch$
declare d text;
begin
  select pg_get_functiondef('private.ist_period_performance_evidence(text,uuid)'::regprocedure) into d;
  d := replace(d, E'\r\n', E'\n');
  if position('PAID_ON_IN_FINALIZED_PAYROLL' in d) = 0 then
    if position($a$s.origin as sale_origin, ra.origin as reservation_origin,$a$ in d) = 0
       or position($a$when x.c_period <> p_period then 'OUTSIDE_COUNT_PERIOD'$a$ in d) = 0
       or position($a$when y.reason in ('NO_STAFF_SELLER','OUTSIDE_COUNT_PERIOD') then 'INELIGIBLE'$a$ in d) = 0 then
      raise exception 'FINANCIAL_GUARD_PATCH_DRIFT';
    end if;
    d := replace(d, $a$s.origin as sale_origin, ra.origin as reservation_origin,$a$,
      $b$s.origin as sale_origin, ra.origin as reservation_origin,
           -- Verified after the live payroll of its paid_on month was approved (20270105000022).
           (rs.count_date_basis = 'paid_on' and exists (
              select 1 from public.payroll_batches fb
               where fb.mode = 'live' and fb.status in ('approved','closed')
                 and fb.period = to_char(p.paid_on, 'YYYY-MM') and fb.decided_at < p.verified_at)) as late_for_finalized,$b$);
    d := replace(d, $a$when x.c_period <> p_period then 'OUTSIDE_COUNT_PERIOD'$a$,
      $b$when x.late_for_finalized then 'PAID_ON_IN_FINALIZED_PAYROLL'
             when x.c_period <> p_period then 'OUTSIDE_COUNT_PERIOD'$b$);
    -- In the finalized month it never counts (the month is not rewritten); in the month it was
    -- posted to it is UNDETERMINED and blocks only that seller's line until reconciled.
    d := replace(d, $a$when y.reason in ('NO_STAFF_SELLER','OUTSIDE_COUNT_PERIOD') then 'INELIGIBLE'$a$,
      $b$when y.reason in ('NO_STAFF_SELLER','OUTSIDE_COUNT_PERIOD') then 'INELIGIBLE'
              when y.reason = 'PAID_ON_IN_FINALIZED_PAYROLL' and y.c_period = p_period then 'INELIGIBLE'$b$);
    execute d;
  end if;
end $patch$;
revoke all on function private.ist_period_performance_evidence(text, uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
