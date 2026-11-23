-- AF Homes: Financial Operations Phase 10 - immutable verified financial evidence and
-- serialized payroll / month-end decisions.
-- No reversal, refund, rate, eligibility, or compensation policy is approved here.
--
--   1. HISTORY: service_role loses DELETE / TRUNCATE on payments, card_sales, commissions and
--      audit_events, and UPDATE on audit_events (no API path uses them). TRUNCATE of those
--      tables and UPDATE of audit_events are always refused (FINANCIAL_HISTORY_PROTECTED).
--      Deleting a VERIFIED payment is refused too, unless the table OWNER runs it with
--      afhomes.allow_customer_purge (public.purge_customer, SECURITY DEFINER) or
--      afhomes.allow_purchase_test_cleanup on - the same two switches the existing purchase
--      evidence guards honour. Row DELETE on card_sales, commissions and audit_events stays as
--      it was (owner / SECURITY DEFINER only, service_role has no privilege): the DB suite and
--      purge_customer delete synthetic rows there as owner.
--   2. VERIFIED PAYMENTS keep every field (VERIFIED_PAYMENT_DETAILS_IMMUTABLE). A payment may
--      BECOME verified only by changing status, verified_by, verified_at, posting_period and
--      rejection_reason (cleared); nothing else in that statement. The one later exception is
--      the reservation -> sale link (sale_id NULL -> a sale, nothing else) written by the
--      existing finalizers; at commit the payment's reservation must have been finalized into
--      that same sale (same customer) in the same transaction, else the transaction fails; the
--      link is then audited as VERIFIED_PAYMENT_SALE_LINKED. No finalizer is wrapped or patched.
--      A reservation's sale_id, finalized_at and finalized_by never change once set
--      (RESERVATION_FINALIZED, existing code), for every origin.
--   3. SALES keep their snapshots, customer, plan, seller and price (SALE_FINANCIAL_DETAILS_IMMUTABLE;
--      sale_number is left to the legacy business-ID upgrade rules);
--      COMMISSIONS keep beneficiary, amounts, rate and links (COMMISSION_FINANCIAL_DETAILS_IMMUTABLE).
--      Status, hold, payout, eligibility and activation columns are untouched by these guards.
--      The migration asserts that every frozen column exists.
--   4. SERIALIZATION: every statement writing payments, payment_adjustments, card_sales,
--      commissions or reservation_agreements takes the shared advisory lock
--      'afhomes:financial_evidence'. submit / approve / close payroll batch and
--      record_payroll_disbursement (LIVE batches only; simulations take no new lock) and
--      close_accounting_period take it EXCLUSIVE directly AFTER their actor check, waiting at
--      most 10s (FINANCIAL_EVIDENCE_BUSY, retry) so a stuck holder never stalls payment
--      verification behind a queued decision. Four bodies are patched in place (section 5; fails
--      closed with FINANCIAL_GUARD_PATCH_DRIFT); record_payroll_disbursement is re-created.
--   5. DISBURSEMENT is never refused because evidence changed: it records money that already
--      moved. When the paid member's evidence no longer matches the line's stored evidenceHash
--      it also writes the audit event PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED (stored and current
--      hash). Submit / approve (0009) remain the refusal points. No recovery path exists or is
--      approved (OPEN_QUESTIONS Q15).
-- Lock order: actor check -> 'afhomes:financial_evidence' (exclusive in the five functions
--   above, shared in writers) -> 'ist_governed:engagement' -> 'ist_governed:performance_rule' ->
--   row locks. A writer that already holds row locks when its first financial statement runs
--   can meet a decision function in a deadlock; PostgreSQL aborts one side, nothing is corrupted.
-- Error codes (55000): FINANCIAL_HISTORY_PROTECTED, VERIFIED_PAYMENT_DETAILS_IMMUTABLE and
--   RESERVATION_FINALIZED (both existing codes), SALE_FINANCIAL_DETAILS_IMMUTABLE,
--   COMMISSION_FINANCIAL_DETAILS_IMMUTABLE. 55P03: FINANCIAL_EVIDENCE_BUSY. Audit action only:
--   PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED. Migration-time only: FINANCIAL_GUARD_PATCH_DRIFT.
-- Validation: pnpm test:db:local (sections 82, 89), pnpm test:db:harness,
--   supabase/security/rls_invariants.sql must return no rows.
--   select has_table_privilege('service_role','public.payments','DELETE');      -- false
--   select has_table_privilege('service_role','public.audit_events','UPDATE');  -- false
--   select count(*) from pg_proc p where p.oid in (
--     'public.submit_payroll_batch(uuid,uuid)'::regprocedure, 'public.approve_payroll_batch(uuid,uuid)'::regprocedure,
--     'public.record_payroll_disbursement(uuid,text,text,text,date,uuid)'::regprocedure,
--     'public.close_payroll_batch(uuid,uuid)'::regprocedure, 'public.close_accounting_period(text,uuid)'::regprocedure)
--     and position('perform private.financial_decision_lock(' in p.prosrc) > 0;   -- 5
--   select count(*) from pg_trigger where tgname in ('payments_z_verified_financial_guard',
--     'payments_verified_sale_link_check', 'payments_z_verified_delete_guard',
--     'reservation_z_finalization_guard') and not tgisinternal;                  -- 4
--   select count(*) from pg_trigger where tgname = 'a_financial_evidence_write_lock';  -- 5
-- Down: forward only. Never unlock, rewrite, delete or truncate financial history. To relax a
--   guard, ship a new migration that drops the specific trigger; the body changes are undone by
--   re-creating the five functions from migrations 0003 / 0006 / 0008 / 0009.
begin;

create or replace function private.financial_evidence_write_lock() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('afhomes:financial_evidence',0));
  return null;
end $$;
revoke all on function private.financial_evidence_write_lock() from public, anon, authenticated, service_role;

-- TRUNCATE of financial history, and UPDATE of audit_events: always refused.
create or replace function private.financial_history_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  raise exception 'FINANCIAL_HISTORY_PROTECTED' using errcode='55000';
end $$;
revoke all on function private.financial_history_guard() from public, anon, authenticated, service_role;

-- A verified payment is never deleted. This guard deliberately runs as its caller: a
-- SECURITY DEFINER trigger would make the owner check meaningless for a service-role caller
-- that forges a cleanup setting.
create or replace function private.verified_payment_delete_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if old.status<>'verified' then return old; end if;
  if (current_setting('afhomes.allow_purchase_test_cleanup',true)='on'
      or current_setting('afhomes.allow_customer_purge',true)='on')
     and current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid=tg_relid) then
    return old;
  end if;
  raise exception 'FINANCIAL_HISTORY_PROTECTED' using errcode='55000';
end $$;
revoke all on function private.verified_payment_delete_guard() from public, anon, authenticated, service_role;

do $$ declare t text; begin
  -- (public.commission_records was dropped by 20261231000001; commissions is the only ledger.)
  foreach t in array array['payments','payment_adjustments','card_sales','commissions','reservation_agreements'] loop
    execute format('drop trigger if exists a_financial_evidence_write_lock on public.%I',t);
    execute format('create trigger a_financial_evidence_write_lock before insert or update or delete on public.%I for each statement execute function private.financial_evidence_write_lock()',t);
  end loop;
  foreach t in array array['payments','card_sales','commissions','audit_events'] loop
    execute format('revoke delete,truncate on public.%I from service_role',t);
    execute format('drop trigger if exists a_financial_history_truncate_guard on public.%I',t);
    execute format('create trigger a_financial_history_truncate_guard before truncate on public.%I for each statement execute function private.financial_history_guard()',t);
  end loop;
end $$;
-- Named to fire AFTER payments_closed_period_guard, so a closed month keeps answering
-- CLOSED_PERIOD_IMMUTABLE (the same holds for payments_z_verified_financial_guard below).
drop trigger if exists payments_z_verified_delete_guard on public.payments;
create trigger payments_z_verified_delete_guard before delete on public.payments
for each row execute function private.verified_payment_delete_guard();
revoke update on public.audit_events from service_role;
drop trigger if exists a_financial_history_update_guard on public.audit_events;
create trigger a_financial_history_update_guard before update on public.audit_events
for each row execute function private.financial_history_guard();

-- A verified payment keeps every field. Two changes are allowed:
--   a. BECOMING verified: only status, verified_by, verified_at (both required), posting_period
--      (stamped by the existing verification trigger) and rejection_reason (cleared to NULL, as
--      verify_card_payment / the reservation payment verifier write it) may change in that
--      statement. Amount, contract, customer, dates and references are what was reviewed.
--   b. the reservation -> sale link (sale_id NULL -> a sale, nothing else touched) that the
--      existing finalizers write. No finalizer body is wrapped or patched (earlier migrations
--      re-read those bodies) and no setting is trusted: the link is validated by STATE at
--      commit - the payment's reservation must have been finalized into that same sale in this
--      same transaction (finalized_at = now(); the finalizers stamp v_now := now()).
create or replace function private.verified_payment_financial_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v_changed text;
begin
  if new is not distinct from old then return new; end if;
  if old.status<>'verified' then
    if new.status<>'verified' then return new; end if;
    select string_agg(n.k, ',' order by n.k) into v_changed
      from jsonb_each(to_jsonb(new)) n(k,v)
     where n.v is distinct from (to_jsonb(old)->n.k)
       and n.k not in ('status','verified_by','verified_at','posting_period','rejection_reason');
    if v_changed is not null or new.verified_by is null or new.verified_at is null
       or new.rejection_reason is not null then
      raise exception 'VERIFIED_PAYMENT_DETAILS_IMMUTABLE' using errcode='55000',
        detail='columns changed while verifying: '||coalesce(v_changed,'(verification fields incomplete)');
    end if;
    return new;
  end if;
  if old.reservation_id is not null and old.sale_id is null and new.sale_id is not null
     and (to_jsonb(new)-'sale_id')=(to_jsonb(old)-'sale_id') then
    return new;  -- validated at commit by payments_verified_sale_link_check
  end if;
  raise exception 'VERIFIED_PAYMENT_DETAILS_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function private.verified_payment_financial_guard() from public, anon, authenticated, service_role;
drop trigger if exists payments_z_verified_financial_guard on public.payments;
create trigger payments_z_verified_financial_guard before update on public.payments
for each row execute function private.verified_payment_financial_guard();

create or replace function private.verified_payment_sale_link_check() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_actor uuid;
begin
  -- Nothing to protect when the row is gone or was re-read with another link.
  if not exists (select 1 from public.payments p where p.id=new.id and p.sale_id=new.sale_id) then
    return null;
  end if;
  select r.finalized_by into v_actor
    from public.reservation_agreements r
    join public.card_sales s on s.id=r.sale_id
   where r.id=new.reservation_id and r.sale_id=new.sale_id
     and r.finalized_at=now()   -- finalized by THIS transaction, not an old finalization
     and s.customer_id=r.customer_id and s.customer_id=new.customer_id;
  if not found then
    raise exception 'VERIFIED_PAYMENT_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
  values(v_actor,'VERIFIED_PAYMENT_SALE_LINKED','payment',new.id::text,
    jsonb_build_object('reservationId',new.reservation_id,'saleId',null),
    jsonb_build_object('reservationId',new.reservation_id,'saleId',new.sale_id,'amount',new.amount,
                       'verifiedAt',new.verified_at,'postingPeriod',new.posting_period));
  return null;
end $$;
revoke all on function private.verified_payment_sale_link_check() from public, anon, authenticated, service_role;
drop trigger if exists payments_verified_sale_link_check on public.payments;
create constraint trigger payments_verified_sale_link_check after update of sale_id on public.payments
deferrable initially deferred for each row
when (new.status='verified' and old.sale_id is null and new.sale_id is not null)
execute function private.verified_payment_sale_link_check();

-- A reservation is finalized once: its sale, and who finalized it and when, never change
-- afterwards, whatever its origin. (The finalizers write all three in one statement, guarded
-- by their own RESERVATION_FINALIZED replay check.)
create or replace function private.reservation_finalization_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if (old.sale_id is not null and new.sale_id is distinct from old.sale_id)
     or (old.finalized_at is not null and new.finalized_at is distinct from old.finalized_at)
     or (old.finalized_by is not null and new.finalized_by is distinct from old.finalized_by) then
    raise exception 'RESERVATION_FINALIZED' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.reservation_finalization_guard() from public, anon, authenticated, service_role;
drop trigger if exists reservation_z_finalization_guard on public.reservation_agreements;
create trigger reservation_z_finalization_guard before update on public.reservation_agreements
for each row execute function private.reservation_finalization_guard();

-- sale_number is NOT frozen here: the legacy business-ID upgrade (20261027000001) re-issues it
-- under its own alias-preserving rules, and it is an identifier, not a financial fact.
create or replace function private.sale_financial_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare old_facts jsonb; new_facts jsonb;
begin
  select jsonb_object_agg(k,v) into old_facts from jsonb_each(to_jsonb(old)) e(k,v)
   where k like '%\_snapshot' escape '\' or k=any(array['id','customer_id','plan_id','seller_type',
     'seller_staff_id','seller_ost_id','cash_price','payment_scheme','commission_rule_id','referral_relationship_id','created_by','created_at','origin']);
  select jsonb_object_agg(k,v) into new_facts from jsonb_each(to_jsonb(new)) e(k,v)
   where k like '%\_snapshot' escape '\' or k=any(array['id','customer_id','plan_id','seller_type',
     'seller_staff_id','seller_ost_id','cash_price','payment_scheme','commission_rule_id','referral_relationship_id','created_by','created_at','origin']);
  if new_facts is distinct from old_facts then
    raise exception 'SALE_FINANCIAL_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.sale_financial_guard() from public, anon, authenticated, service_role;
drop trigger if exists a_sale_financial_guard on public.card_sales;
create trigger a_sale_financial_guard before update on public.card_sales
for each row execute function private.sale_financial_guard();

create or replace function private.commission_financial_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare old_facts jsonb; new_facts jsonb;
begin
  select jsonb_object_agg(k,v) into old_facts from jsonb_each(to_jsonb(old)) e(k,v)
   where k=any(array['id','sale_id','ost_id','beneficiary_type','beneficiary_staff_id','beneficiary_ost_id',
     'amount','rate_snapshot','basis_amount_snapshot','commission_rule_id','commission_type','created_at']);
  select jsonb_object_agg(k,v) into new_facts from jsonb_each(to_jsonb(new)) e(k,v)
   where k=any(array['id','sale_id','ost_id','beneficiary_type','beneficiary_staff_id','beneficiary_ost_id',
     'amount','rate_snapshot','basis_amount_snapshot','commission_rule_id','commission_type','created_at']);
  if new_facts is distinct from old_facts then
    raise exception 'COMMISSION_FINANCIAL_DETAILS_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.commission_financial_guard() from public, anon, authenticated, service_role;
-- Named to fire AFTER commissions_finops_guard, whose refusals (DRI_NOT_AUTHORIZED, ...) keep
-- their own codes.
drop trigger if exists commissions_z_financial_guard on public.commissions;
create trigger commissions_z_financial_guard before update on public.commissions
for each row execute function private.commission_financial_guard();

-- Every column the guards above freeze must exist: a renamed column would otherwise drop out
-- of the guard silently (the guards compare by name).
do $cols$
declare r record; c text;
begin
  for r in select * from (values
    ('card_sales', array['id','customer_id','plan_id','seller_type','seller_staff_id','seller_ost_id','cash_price',
       'payment_scheme','commission_rule_id','referral_relationship_id','created_by','created_at','origin',
       'cash_price_snapshot','minimum_down_payment_snapshot','yearly_points_snapshot',
       'commission_rate_snapshot','expected_commission_snapshot']),
    ('commissions', array['id','sale_id','ost_id','beneficiary_type','beneficiary_staff_id',
       'beneficiary_ost_id','amount','rate_snapshot','basis_amount_snapshot',
       'commission_rule_id','commission_type','created_at']),
    ('payments', array['status','verified_by','verified_at','posting_period','rejection_reason','sale_id',
       'reservation_id','customer_id','amount']),
    ('reservation_agreements', array['sale_id','finalized_at','finalized_by','customer_id'])
  ) as t(tbl, cols) loop
    foreach c in array r.cols loop
      if not exists (select 1 from information_schema.columns k
                      where k.table_schema='public' and k.table_name=r.tbl and k.column_name=c) then
        raise exception 'FINANCIAL_GUARD_PATCH_DRIFT: %', format('missing column public.%s.%s', r.tbl, c);
      end if;
    end loop;
  end loop;
end $cols$;

-- 5. Serialized decisions. The exclusive lock is taken AFTER the actor check (an unauthorized
-- caller never queues behind, or in front of, payment writers) and only when p_take is true
-- (LIVE batches and month close; a simulation takes no new lock). lock_timeout is 10s for this
-- one wait and is restored afterwards. While the exclusive request waits it still queues
-- behind current shared holders AND blocks new shared requests (payment writes); the timeout
-- only BOUNDS that stall to 10s, after which the DECISION fails (FINANCIAL_EVIDENCE_BUSY,
-- retryable) and payment writes resume. It does not prevent the queueing.
create or replace function private.financial_decision_lock(p_take boolean) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_prev text := current_setting('lock_timeout');
begin
  if p_take is not true then return; end if;
  perform set_config('lock_timeout','10s',true);
  begin
    perform pg_advisory_xact_lock(hashtextextended('afhomes:financial_evidence',0));
  exception when lock_not_available then
    perform set_config('lock_timeout',v_prev,true);
    raise exception 'FINANCIAL_EVIDENCE_BUSY' using errcode='55P03';
  end;
  perform set_config('lock_timeout',v_prev,true);
end $$;
revoke all on function private.financial_decision_lock(boolean) from public, anon, authenticated, service_role;

-- Re-created from 0008. Changes: the decision lock (taken for a live batch only; a simulation
-- line is refused below anyway), and the evidence NOTE.
-- A disbursement records money that already moved outside AF Homes, so it is never refused
-- because evidence changed: refusing cannot undo a transfer and would strand the batch
-- (close_payroll_batch needs every line disbursed). Instead, when the paid member's current
-- evidence no longer matches the line's stored inputs.evidenceHash, a second audit event
-- PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED records both hashes. payroll_disbursements and
-- payroll_lines have no column for such a flag and none is added; the audit event is the flag.
-- No recovery or correction path exists or is approved (OPEN_QUESTIONS Q15 j).
create or replace function public.record_payroll_disbursement(
  p_line_id uuid, p_amount text, p_method text, p_bank_reference text, p_paid_on date, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_line public.payroll_lines%rowtype; v_batch public.payroll_batches%rowtype; v_id uuid;
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
  v_current jsonb;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  perform private.financial_decision_lock(exists (
    select 1 from public.payroll_lines l join public.payroll_batches b on b.id = l.batch_id
     where l.id = p_line_id and b.mode = 'live'));
  if p_amount is null or p_amount !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' or p_amount::numeric <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if v_method is null or length(v_method) > 40 then
    raise exception 'PAYROLL_METHOD_REQUIRED' using errcode = '22023';
  end if;
  if private.normalize_payment_key(v_ref) is null or length(v_ref) > 100 then
    raise exception 'PAYOUT_REFERENCE_REQUIRED' using errcode = '22023';
  end if;
  -- Lock order: batch (share) then line.
  select l.* into v_line from public.payroll_lines l where l.id = p_line_id;
  if not found then raise exception 'PAYROLL_LINE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_batch from public.payroll_batches b where b.id = v_line.batch_id for share;
  select * into v_line from public.payroll_lines l where l.id = p_line_id for update;
  if v_batch.mode = 'simulation' then raise exception 'PAYROLL_SIMULATION_ONLY' using errcode = '55000'; end if;
  -- Re-checked at call time, like approval.
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  -- Replay (decided before the lifecycle checks): same line and same normalized reference.
  select d.id into v_id from public.payroll_disbursements d
   where d.line_id = v_line.id
     and private.normalize_payment_key(d.bank_reference) = private.normalize_payment_key(v_ref);
  if v_id is not null then return v_id; end if;
  if v_batch.status <> 'approved' then raise exception 'PAYROLL_BATCH_NOT_APPROVED' using errcode = '55000'; end if;
  if v_line.status <> 'computed' or v_line.net::numeric <= 0 then
    raise exception 'PAYROLL_LINE_NOT_PAYABLE' using errcode = '55000';
  end if;
  if p_amount::numeric <> v_line.net::numeric then
    raise exception 'PAYROLL_AMOUNT_MISMATCH' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_disbursements d where d.line_id = v_line.id) then
    raise exception 'PAYROLL_LINE_ALREADY_DISBURSED' using errcode = '23505';
  end if;
  if exists (select 1 from public.payroll_disbursements d
              where private.normalize_payment_key(d.bank_reference) = private.normalize_payment_key(v_ref)) then
    raise exception 'DUPLICATE_PAYOUT_REFERENCE' using errcode = '23505';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  insert into public.payroll_disbursements (line_id, amount, method, bank_reference, paid_on, recorded_by)
  values (v_line.id, v_line.net, v_method, v_ref, p_paid_on, p_actor_id)
  returning id into v_id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'PAYROLL_DISBURSEMENT_RECORDED', 'payroll_disbursement', v_id::text,
    jsonb_build_object('lineId', v_line.id, 'batchId', v_batch.id, 'period', v_batch.period,
      'amount', v_line.net, 'method', v_method, 'paidOn', p_paid_on,
      'governingBasis', private.q1_governing_basis()));
  -- Evidence note for THIS line's staff member only (never a refusal; see above).
  v_current := private.ist_period_performance_rows(v_batch.period, v_line.staff_id) -> 0;
  if v_current is null or v_current ->> 'status' is distinct from 'CALCULABLE'
     or v_current ->> 'evidenceHash' is distinct from v_line.inputs ->> 'evidenceHash' then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor_id, 'PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED', 'payroll_disbursement', v_id::text,
      jsonb_build_object('evidenceHash', v_line.inputs ->> 'evidenceHash'),
      jsonb_build_object('evidenceHash', v_current ->> 'evidenceHash',
        'performanceStatus', coalesce(v_current ->> 'status', 'NOT_ON_ROSTER'),
        'lineId', v_line.id, 'batchId', v_batch.id, 'period', v_batch.period, 'staffId', v_line.staff_id,
        'amount', v_line.net));
  end if;
  return v_id;
end $$;
revoke all on function public.record_payroll_disbursement(uuid, text, text, text, date, uuid) from public, anon, authenticated;
grant execute on function public.record_payroll_disbursement(uuid, text, text, text, date, uuid) to service_role;

-- The other four keep their CURRENT bodies (submit / approve from 0009, close_payroll_batch
-- from 0006, close_accounting_period from 0003): one statement is spliced in directly after
-- the actor check. Comments are stripped before every test, so a comment can neither satisfy
-- nor hide the lock call. Idempotent; fails closed (FINANCIAL_GUARD_PATCH_DRIFT) unless the
-- actor check occurs exactly once and the lock call ends up exactly once, directly after it.
do $patch$
declare sig text; arg text; d text; src text; patched text; bare text;
  c_actor constant text := 'perform\s+private\.mutation_actor_role\([^;]*;';
  c_lock constant text := 'perform\s+private\.financial_decision_lock\(';
  n_of constant text := 'select count(*) from regexp_matches($1,$2,''g'')';
  n int;
begin
  foreach sig in array array['public.submit_payroll_batch(uuid,uuid)','public.approve_payroll_batch(uuid,uuid)',
    'public.close_payroll_batch(uuid,uuid)','public.close_accounting_period(text,uuid)'] loop
    arg := case when sig like 'public.close_accounting_period%' then 'true'
           else 'exists (select 1 from public.payroll_batches b where b.id = p_batch_id and b.mode = ''live'')' end;
    select pg_get_functiondef(sig::regprocedure),p.prosrc into d,src from pg_proc p where p.oid=sig::regprocedure;
    bare := regexp_replace(src,'--[^\n]*','','g');
    execute n_of into n using bare, c_lock;
    if n = 0 then
      execute n_of into n using src, c_actor;
      if n <> 1 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT: %', sig||': actor check count '||n; end if;
      execute n_of into n using bare, c_actor;
      if n <> 1 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT: %', sig||': actor check commented'; end if;
      patched := regexp_replace(src,'('||c_actor||')',E'\\1\n  perform private.financial_decision_lock('||arg||');');
      if position(src in d)=0 then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT: %', sig||': definition'; end if;
      execute replace(d,src,patched);
    end if;
    -- Post-condition on what is now stored, comments stripped.
    select regexp_replace(p.prosrc,'--[^\n]*','','g') into bare from pg_proc p where p.oid=sig::regprocedure;
    execute n_of into n using bare, c_lock;
    if n <> 1 or bare !~ (c_actor||'\s*'||c_lock) then
      raise exception 'FINANCIAL_GUARD_PATCH_DRIFT: %', sig||': placement';
    end if;
  end loop;
  -- record_payroll_disbursement is re-created above; hold it to the same post-condition.
  select regexp_replace(p.prosrc,'--[^\n]*','','g') into bare from pg_proc p
   where p.oid='public.record_payroll_disbursement(uuid,text,text,text,date,uuid)'::regprocedure;
  execute n_of into n using bare, c_lock;
  if n <> 1 or bare !~ (c_actor||'\s*'||c_lock) then
    raise exception 'FINANCIAL_GUARD_PATCH_DRIFT: %', 'record_payroll_disbursement: placement';
  end if;
end $patch$;

notify pgrst,'reload schema';
commit;
