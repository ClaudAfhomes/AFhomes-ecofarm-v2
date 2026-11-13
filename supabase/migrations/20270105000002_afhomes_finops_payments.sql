-- AF Homes: Financial Operations Phase 2 - payment details, duplicate hold, adjustment ledger.
--
-- No existing rule changes. Recording and verification keep their functions,
-- permissions, receipt requirement, overpayment and stage rules.
--   1. Receipt details on public.payments: Official Receipt number, the ACTUAL
--      payment date (distinct from when it was entered or verified), the payer's
--      name (information only, never an identifier) and the accounting posting
--      period, stamped once at verification (Asia/Manila month).
--   2. The same OR number cannot back two live payments on one contract.
--   3. Cross-contract duplicate HOLD: a payment whose bank reference or OR number
--      already appears on a DIFFERENT contract cannot be verified until Finance
--      records why the allocation is legitimate (e.g. one transfer split across
--      two contracts). Enforced by a trigger, so every verification path obeys it.
--   4. public.payment_adjustments: the append-only ledger for reversals, returned
--      checks and refunds. PROPOSE ONLY. No function approves or posts an
--      adjustment, because the approval authority is not confirmed (12 Nov 2026):
--      a proposal never changes verified collections, balances, commissions or pay.
-- Validation: pnpm test:db:local (section 81); supabase/security/rls_invariants.sql.
-- Pre-flight (must return no rows before applying to a database with data):
--   select coalesce(sale_id, reservation_id) c, private.normalize_payment_key(reference) k, count(*)
--     from public.payments where reference is not null and status in ('recorded','verified')
--    group by 1, 2 having count(*) > 1;   -- informational only: reference uniqueness already exists
-- Down: forward only. Never delete payment or adjustment history.
begin;

-- ---------------------------------------------------------------------------
-- 1. Receipt details
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists or_number text
  check (or_number is null or length(btrim(or_number)) between 1 and 60);
alter table public.payments add column if not exists paid_on date;
alter table public.payments add column if not exists paid_by_name text
  check (paid_by_name is null or length(btrim(paid_by_name)) between 1 and 120);
alter table public.payments add column if not exists posting_period text
  check (posting_period is null or posting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
alter table public.payments add column if not exists duplicate_review_note text
  check (duplicate_review_note is null or length(btrim(duplicate_review_note)) >= 5);
alter table public.payments add column if not exists duplicate_reviewed_by uuid
  references public.staff_users(id) on delete restrict;
alter table public.payments add column if not exists duplicate_reviewed_at timestamptz;
comment on column public.payments.paid_on is
  'Actual payment date on the receipt. Never rewritten; recorded_at and verified_at are separate facts.';
comment on column public.payments.posting_period is
  'Accounting month (Asia/Manila) the payment was verified into. Stamped once at verification.';

-- Existing verified payments get the Manila month they were verified in, so
-- period reports do not undercount history. Runs before the guard trigger exists.
update public.payments
   set posting_period = to_char(verified_at at time zone 'Asia/Manila', 'YYYY-MM')
 where status = 'verified' and verified_at is not null and posting_period is null;

-- Reference / OR comparison key: case and punctuation never make two keys differ.
create or replace function private.normalize_payment_key(p_value text)
returns text language sql immutable set search_path = pg_catalog as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
revoke all on function private.normalize_payment_key(text) from public, anon, authenticated, service_role;

create index if not exists payments_reference_key_idx
  on public.payments (private.normalize_payment_key(reference))
  where reference is not null;
create index if not exists payments_or_key_idx
  on public.payments (private.normalize_payment_key(or_number))
  where or_number is not null;

-- 2. One live payment per OR number per contract.
create unique index if not exists payments_sale_or_unique
  on public.payments (sale_id, private.normalize_payment_key(or_number))
  where or_number is not null and sale_id is not null and status in ('recorded','verified');
create unique index if not exists payments_reservation_or_unique
  on public.payments (reservation_id, private.normalize_payment_key(or_number))
  where or_number is not null and reservation_id is not null and status in ('recorded','verified');

-- ---------------------------------------------------------------------------
-- 3. Cross-contract matches and the verification hold
-- ---------------------------------------------------------------------------
-- Live payments on OTHER contracts sharing this payment's reference or OR key.
create or replace function private.payment_cross_contract_matches(p_payment_id uuid)
returns setof public.payments
language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select o.*
    from public.payments p
    join public.payments o
      on o.id <> p.id
     and o.status in ('recorded','verified')
     and not (coalesce(o.sale_id = p.sale_id, false)
              or coalesce(o.reservation_id = p.reservation_id, false))
     and (
       (private.normalize_payment_key(p.reference) is not null
         and private.normalize_payment_key(o.reference) = private.normalize_payment_key(p.reference))
       or (private.normalize_payment_key(p.or_number) is not null
         and private.normalize_payment_key(o.or_number) = private.normalize_payment_key(p.or_number))
     )
   where p.id = p_payment_id
$$;
revoke all on function private.payment_cross_contract_matches(uuid) from public, anon, authenticated, service_role;

create or replace function private.payment_verification_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
begin
  -- A row INSERTED already verified (historical / externally verified imports,
  -- which are record-only history) is stamped with the month it was verified in.
  -- Imports are deliberately not held: their duplicates are reconciled by the
  -- import workflow's own review, before the row is written.
  if tg_op = 'INSERT' then
    if new.status = 'verified' and new.posting_period is null then
      new.posting_period := to_char(coalesce(new.verified_at, now()) at time zone 'Asia/Manila', 'YYYY-MM');
    end if;
    return new;
  end if;
  if new.status = 'verified' and old.status is distinct from 'verified' then
    -- Hold: the same bank reference / OR on another contract needs a recorded reason.
    if new.duplicate_review_note is null
       and exists (select 1 from private.payment_cross_contract_matches(new.id)) then
      raise exception 'PAYMENT_REFERENCE_REVIEW_REQUIRED' using errcode = '55000';
    end if;
    -- Posting period: the Manila month of verification, stamped exactly once.
    if new.posting_period is null then
      new.posting_period := to_char(now() at time zone 'Asia/Manila', 'YYYY-MM');
    end if;
  end if;
  -- History is never rewritten once money is verified.
  if old.status = 'verified' and (
       new.paid_on, new.or_number, new.paid_by_name, new.posting_period, new.reference, new.amount
     ) is distinct from (
       old.paid_on, old.or_number, old.paid_by_name, old.posting_period, old.reference, old.amount
     ) then
    raise exception 'VERIFIED_PAYMENT_DETAILS_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.payment_verification_guard() from public, anon, authenticated, service_role;
drop trigger if exists payments_verification_guard on public.payments;
create trigger payments_verification_guard
  before insert or update on public.payments
  for each row execute function private.payment_verification_guard();

-- Finance records the receipt details (and, when held, the duplicate review
-- reason) on a payment that is still pending verification.
create or replace function public.set_payment_receipt_details(
  p_payment_id uuid, p_actor_id uuid, p_details jsonb
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_pay public.payments%rowtype;
  v_or text := nullif(btrim(coalesce(p_details->>'orNumber', '')), '');
  v_payer text := nullif(btrim(coalesce(p_details->>'paidByName', '')), '');
  v_note text := nullif(btrim(coalesce(p_details->>'duplicateReviewNote', '')), '');
  v_paid_on date;
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
  end if;
  if length(coalesce(v_or, '')) > 60 or length(coalesce(v_payer, '')) > 120 then
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

  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
  values (p_actor_id, 'PAYMENT_DETAILS_RECORDED', 'payment', v_pay.id::text,
    jsonb_strip_nulls(jsonb_build_object('orNumber', v_or, 'paidOn', v_paid_on,
      'paidByNameRecorded', v_payer is not null, 'duplicateReviewed', v_note is not null)),
    v_note);
  return v_pay.id;
end $$;
revoke all on function public.set_payment_receipt_details(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_payment_receipt_details(uuid, uuid, jsonb) to service_role;

-- What Finance sees when a payment is held: the other contracts' payments.
create or replace function public.payment_reference_matches(p_payment_id uuid, p_actor_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payment_verification', 'view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'paymentId', m.id, 'saleId', m.sale_id, 'reservationId', m.reservation_id,
      'amount', m.amount, 'status', m.status, 'reference', m.reference,
      'orNumber', m.or_number, 'recordedAt', m.recorded_at) order by m.recorded_at)
      from private.payment_cross_contract_matches(p_payment_id) m), '[]'::jsonb);
end $$;
revoke all on function public.payment_reference_matches(uuid, uuid) from public, anon, authenticated;
grant execute on function public.payment_reference_matches(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Adjustment ledger - PROPOSE ONLY
-- ---------------------------------------------------------------------------
create table if not exists public.payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  kind text not null check (kind in ('reversal','returned_check','refund')),
  amount text not null check (amount ~ '^[1-9][0-9]*(\.[0-9]{1,2})?$'),
  reason text not null check (length(btrim(reason)) >= 5),
  evidence_path text check (evidence_path is null or length(evidence_path) between 1 and 300),
  effective_date date not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','withdrawn')),
  requested_by uuid not null references public.staff_users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff_users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  posting_period text check (posting_period is null or posting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  check ((status = 'proposed') = (decided_by is null and decided_at is null)),
  -- Whoever decides is never the person who asked.
  check (decided_by is null or decided_by <> requested_by)
);
comment on table public.payment_adjustments is
  'Linked corrections to a verified payment. The original payment row is never edited or deleted. Until an approval authority is configured only PROPOSED rows can exist, and a proposal changes no balance. Deliberate consequence: a payment with adjustment history cannot be deleted, so a customer purge is refused for it (on delete restrict) until a governed purge path for financial history is approved.';
create unique index if not exists payment_adjustments_one_open
  on public.payment_adjustments (payment_id, kind) where status = 'proposed';
create index if not exists payment_adjustments_payment_idx on public.payment_adjustments (payment_id);
alter table public.payment_adjustments enable row level security;
revoke all on public.payment_adjustments from public, anon, authenticated;

-- No approval authority exists yet: refuse any attempt to approve by any path.
create or replace function private.payment_adjustment_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  if new.status = 'approved' then
    raise exception 'PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
       new.payment_id, new.kind, new.amount, new.reason, new.effective_date, new.requested_by, new.requested_at
     ) is distinct from (
       old.payment_id, old.kind, old.amount, old.reason, old.effective_date, old.requested_by, old.requested_at
     ) then
    raise exception 'PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.payment_adjustment_guard() from public, anon, authenticated, service_role;
drop trigger if exists payment_adjustments_guard on public.payment_adjustments;
create trigger payment_adjustments_guard
  before insert or update or delete on public.payment_adjustments
  for each row execute function private.payment_adjustment_guard();

create or replace function public.propose_payment_adjustment(
  p_payment_id uuid, p_actor_id uuid, p_kind text, p_amount text, p_reason text,
  p_effective_date date, p_evidence_path text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_pay public.payments%rowtype; v_id uuid;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payment_verification', 'update');
  if p_kind not in ('reversal','returned_check','refund') then
    raise exception 'PAYMENT_ADJUSTMENT_KIND_INVALID' using errcode = '22023';
  end if;
  if p_amount is null or p_amount !~ '^[1-9][0-9]*(\.[0-9]{1,2})?$' then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'PAYMENT_ADJUSTMENT_REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_effective_date is null or p_effective_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAYMENT_DATE_INVALID' using errcode = '22023';
  end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Only verified money can be reversed, returned or refunded; a pending payment is simply rejected.
  if v_pay.status <> 'verified' then
    raise exception 'PAYMENT_NOT_VERIFIED' using errcode = '55000';
  end if;
  if p_amount::numeric > v_pay.amount::numeric then
    raise exception 'PAYMENT_ADJUSTMENT_EXCEEDS_PAYMENT' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_adjustments a
              where a.payment_id = v_pay.id and a.kind = p_kind and a.status = 'proposed') then
    raise exception 'PAYMENT_ADJUSTMENT_ALREADY_PROPOSED' using errcode = '23505';
  end if;
  insert into public.payment_adjustments (payment_id, kind, amount, reason, evidence_path, effective_date, requested_by)
  values (v_pay.id, p_kind, p_amount, btrim(p_reason), nullif(btrim(coalesce(p_evidence_path, '')), ''),
          p_effective_date, p_actor_id)
  returning id into v_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
  values (p_actor_id, 'PAYMENT_ADJUSTMENT_PROPOSED', 'payment_adjustment', v_id::text,
    jsonb_build_object('paymentId', v_pay.id, 'kind', p_kind, 'amount', p_amount,
      'effectiveDate', p_effective_date, 'status', 'proposed'), btrim(p_reason));
  return v_id;
end $$;
revoke all on function public.propose_payment_adjustment(uuid, uuid, text, text, text, date, text) from public, anon, authenticated;
grant execute on function public.propose_payment_adjustment(uuid, uuid, text, text, text, date, text) to service_role;

notify pgrst, 'reload schema';
commit;
