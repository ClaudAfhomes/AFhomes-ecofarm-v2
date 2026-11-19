-- AF Homes: Financial Operations Phase 8 - Q1 recorded (owner-reported), compensation policy
-- lifecycle, payroll amount review limits, effective-dated policy segments.
--
-- OWNER DECISION RECORDED BY THIS MIGRATION (reported by the owner on 2026-11-13): the company
-- President approved Q1 Option C - BOTH compensation models (IST payroll BA/PA/PB AND the
-- existing VIP card/points model), independent of each other, no duplicate entitlements.
-- NO approval document, signature, approval date or effective date exists, so none is
-- recorded: source='owner_reported', decision_option='C_BOTH_MODELS',
-- evidence_status='awaiting_evidence', effective_date NULL, decided_by NULL (no staff
-- decider). decided_at is the time THIS MIGRATION RECORDED the report - a RECORDING time,
-- never an approval date. Historical BA/PA/PB amounts, rates and targets remain UNAPPROVED
-- reference values: NO compensation policy is seeded, so every live payroll line stays
-- blocked ("Configuration Required") until a policy is approved through the RPCs below.
-- Q13 is not touched. The card/points model is not touched.
--
--   1. governing_policy_decisions: + source, decision_option, evidence_status,
--      effective_date. An 'approved' row needs decided_at, and either a staff decider or
--      source='owner_reported'. The guard now also covers INSERT, so a new decision key can
--      only be seeded by a migration. New key COMPENSATION_POLICY_TRANSITION_RULE (pending;
--      nothing here approves it). No RPC writes this table.
--   2. ist_compensation_policies lifecycle: draft -> pending_approval -> approved
--      (pending_approval -> draft on return). 'active' / 'superseded' / 'expired' are DERIVED
--      (private.ist_compensation_policy_lifecycle), never stored, so a past month never loses
--      the policy that paid it. 'retired' is legacy and no path sets it. Approved rows are
--      immutable except closing an open window ONCE (end_ist_compensation_policy), which is
--      refused if it would cut a month that an approved/closed live payroll batch paid with it.
--      Every write needs the transaction-local flag afhomes.compensation_policy_write (set only
--      by the RPCs); the guard trigger re-checks lifecycle, evidence, separation of duties and
--      the Q1 gate even when the flag is on. DELETE and TRUNCATE are refused.
--      RBAC: finance.payroll_policy (existing module, no role row) create/update drafts and
--      submits; NEW finance.payroll_policy_approval (no role row) approves, returns and ends.
--      Super Admin holds both by slug; Finance can be granted either via dynamic RBAC.
--      The approver is never anyone who EVER drafted, edited or submitted the policy
--      (prior_actor_ids, maintained by the guard, survives a return). An approval needs an
--      evidence reference of 10+ characters and a note; placeholders (n/a, none, tbd, test,
--      abc, '---', ...) are refused. A create replay with the same idempotency key and another
--      payload is refused. collection_gate is > 0 and <= 1 (CHECK).
--   3. Amount review limits (6.9): nullable per-policy ba/pa/pb/net_review_limit. The line
--      guard (not the caller) flags a live computed line whose figure EXCEEDS a configured
--      limit: review_required + review_flags. Figures are never truncated. No limit -> no flag.
--      It also flags BA_ABOVE_POLICY_AMOUNT / PA_ABOVE_POLICY_AMOUNT when ba / pa exceeds the
--      cited policy's monthly_ba / monthly_pa (proration only reduces). PB has no bound.
--      A batch with an unreviewed flagged line cannot be submitted (or approved):
--      PAYROLL_LINE_REVIEW_REQUIRED. Finance records the note with review_payroll_line.
--   4. Effective-dated policy per date (6.8): private.ist_compensation_policy_segments(rank,
--      period) / public.payroll_policy_segments(period, actor). A month covered by ONE approved
--      policy behaves exactly as before. A month whose policy changes (or starts/ends) inside
--      it ALWAYS refuses computed live lines: POLICY_TRANSITION_RULE_NOT_APPROVED while governing
--      key COMPENSATION_POLICY_TRANSITION_RULE is pending, POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED
--      (0A000) once it is approved - segment payouts are NOT implemented, so the month is never
--      paid whole at the first-of-month policy. payroll_batch_policies_ok re-checks it at
--      submit/approve.
--   5. Audit: approve_payroll_batch / record_payroll_disbursement (re-created) and policy
--      approval carry governingBasis {source, evidenceStatus, decisionOption} of Q1; the
--      transition-rule key seed writes GOVERNING_POLICY_KEY_SEEDED.
-- Lock order: compensation policy RPCs take pg_advisory_xact_lock('ist_compensation_policy:'
--   || rank) -> policy row FOR UPDATE -> read payroll (no lock). Payroll submit/approve: batch
--   FOR UPDATE -> cited policy rows FOR SHARE (payroll_batch_policies_ok). Line review: batch
--   FOR UPDATE -> line FOR UPDATE. No path locks a batch after a policy row.
-- New codes: COMPENSATION_POLICY_NOT_FOUND (P0002), COMPENSATION_POLICY_INVALID (22023),
--   COMPENSATION_POLICY_NOT_EDITABLE (55000), COMPENSATION_POLICY_NOT_PENDING (55000),
--   COMPENSATION_POLICY_NOT_APPROVED (55000), COMPENSATION_POLICY_SELF_APPROVAL (42501),
--   COMPENSATION_POLICY_EVIDENCE_REQUIRED (22023), COMPENSATION_POLICY_APPROVAL_NOTE_REQUIRED (22023),
--   COMPENSATION_POLICY_RETURN_REASON_REQUIRED (22023), COMPENSATION_POLICY_END_NOTE_REQUIRED (22023),
--   COMPENSATION_POLICY_END_DATE_INVALID (22023), COMPENSATION_POLICY_IN_USE_BY_FINALIZED_PAYROLL (55000),
--   COMPENSATION_POLICY_DIRECT_WRITE_REFUSED (42501), COMPENSATION_POLICY_TRANSITION_INVALID (55000),
--   COMPENSATION_POLICY_IDEMPOTENCY_CONFLICT (23505), POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED (0A000),
--   POLICY_TRANSITION_RULE_NOT_APPROVED (55000), PAYROLL_LINE_REVIEW_REQUIRED (55000),
--   PAYROLL_LINE_REVIEW_NOT_REQUIRED (55000), PAYROLL_LINE_ALREADY_REVIEWED (55000),
--   PAYROLL_REVIEW_NOTE_REQUIRED (22023).
--   Reused: MUTATION_FORBIDDEN, COMPENSATION_POLICY_IMMUTABLE, COMPENSATION_POLICY_OVERLAP,
--   IST_PAYROLL_NOT_AUTHORIZED, PERIOD_INVALID, PAYROLL_LINE_NOT_FOUND, PAYROLL_BATCH_NOT_EDITABLE,
--   PAYROLL_LINE_IMMUTABLE, PAYROLL_CONFIGURATION_REQUIRED, GOVERNING_POLICY_LOCKED.
-- Precondition: any pre-existing APPROVED policy row must already carry submitter, evidence
--   and a distinct approver, or the v8 CHECKs fail loudly (the table is empty by design; if it
--   is not, stop and ask the owner - never backfill an approval).
-- Validation: pnpm test:db:local (sections 80, 84, 85, 86, 88); supabase/security/rls_invariants.sql.
--   select key, status, source, decision_option, evidence_status, effective_date, decided_by
--     from public.governing_policy_decisions order by key;
--     -- Q1 approved/owner_reported/C_BOTH_MODELS/awaiting_evidence/NULL/NULL; Q13 pending;
--     -- COMPENSATION_POLICY_TRANSITION_RULE pending
--   select private.ist_payroll_live_authorized();                                -- true
--   select count(*) from public.ist_compensation_policies where status = 'approved'; -- 0
--   select count(*) from public.role_permissions rp join public.modules m on m.id = rp.module_id
--    where m.key in ('finance.payroll_policy','finance.payroll_policy_approval');  -- 0
-- Down: forward only. Never delete policies, decisions or audit events. To disable: revoke
--   execute on the new public functions; to withdraw Q1, an explicitly authorized NEW migration
--   sets the row back to 'pending' through the guard flag (live payroll then refuses again).
begin;

-- ---------------------------------------------------------------------------
-- 1. Governing decisions: owner-reported approvals, insert guard, Q1, transition key
-- ---------------------------------------------------------------------------
alter table public.governing_policy_decisions add column if not exists source text;
alter table public.governing_policy_decisions add column if not exists decision_option text;
alter table public.governing_policy_decisions add column if not exists evidence_status text;
alter table public.governing_policy_decisions add column if not exists effective_date date;
comment on column public.governing_policy_decisions.source is
  'How the decision reached the system: owner_reported (no document on file) or approval_document.';
comment on column public.governing_policy_decisions.evidence_status is
  'awaiting_evidence (shown as "Awaiting Evidence") or evidence_on_file.';
comment on column public.governing_policy_decisions.effective_date is
  'Effective date stated by the approval. NULL when none was given; never invented.';
comment on column public.governing_policy_decisions.decided_at is
  'For an owner_reported decision this is the time the report was RECORDED, not an approval date.';

-- Replace the unnamed 0005 CHECK (matched by definition, never by guessed name).
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.governing_policy_decisions'::regclass and con.contype = 'c'
       and con.conname not like 'governing_policy_decisions_v8_%'
       and pg_get_constraintdef(con.oid) like '%decided_by IS NOT NULL%'
  loop
    execute format('alter table public.governing_policy_decisions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.governing_policy_decisions drop constraint if exists governing_policy_decisions_v8_decided_check;
alter table public.governing_policy_decisions add constraint governing_policy_decisions_v8_decided_check
  check ((status = 'approved') = (decided_at is not null));
alter table public.governing_policy_decisions drop constraint if exists governing_policy_decisions_v8_decider_check;
alter table public.governing_policy_decisions add constraint governing_policy_decisions_v8_decider_check
  check (status = 'approved' or decided_by is null);
-- An approval names a staff decider, unless it is recorded as owner-reported.
-- (IS NOT DISTINCT FROM: a plain "source = ..." is NULL for a NULL source and a CHECK passes on NULL.)
alter table public.governing_policy_decisions drop constraint if exists governing_policy_decisions_v8_basis_check;
alter table public.governing_policy_decisions add constraint governing_policy_decisions_v8_basis_check
  check (status <> 'approved' or decided_by is not null or source is not distinct from 'owner_reported');
alter table public.governing_policy_decisions drop constraint if exists governing_policy_decisions_v8_source_check;
alter table public.governing_policy_decisions add constraint governing_policy_decisions_v8_source_check
  check (source is null or source in ('owner_reported','approval_document'));
alter table public.governing_policy_decisions drop constraint if exists governing_policy_decisions_v8_evidence_check;
alter table public.governing_policy_decisions add constraint governing_policy_decisions_v8_evidence_check
  check ((evidence_status is null or evidence_status in ('awaiting_evidence','evidence_on_file'))
         and (source is distinct from 'owner_reported' or evidence_status is not null));
alter table public.governing_policy_decisions drop constraint if exists governing_policy_decisions_v8_option_check;
alter table public.governing_policy_decisions add constraint governing_policy_decisions_v8_option_check
  check (decision_option is null or length(btrim(decision_option)) between 1 and 80);

do $$
begin
  if exists (
    select 1 from pg_constraint con
     where con.conrelid = 'public.governing_policy_decisions'::regclass and con.contype = 'c'
       and con.conname not like 'governing_policy_decisions_v8_%'
       and pg_get_constraintdef(con.oid) like '%decided_by%'
  ) then
    raise exception 'GOVERNING_POLICY_V8_CONSTRAINT_MIGRATION_INCOMPLETE';
  end if;
end $$;

-- 0005 guarded only UPDATE/DELETE: a direct INSERT could have pre-seeded an approved key.
drop trigger if exists governing_policy_decisions_guard on public.governing_policy_decisions;
create trigger governing_policy_decisions_guard
  before insert or update or delete on public.governing_policy_decisions
  for each row execute function private.governing_policy_guard();
revoke truncate, delete on public.governing_policy_decisions from service_role;

do $$
declare v_before jsonb; v_after jsonb; v_n integer;
begin
  perform set_config('afhomes.governing_policy_write', 'on', true);
  insert into public.governing_policy_decisions (key, status, note)
  values ('COMPENSATION_POLICY_TRANSITION_RULE', 'pending',
          'Awaiting an approved rule for paying an IST month in which the compensation policy changes (starts, ends or is replaced) mid-month. Until approved, such lines are blocked.')
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
    select null, 'GOVERNING_POLICY_KEY_SEEDED', 'governing_policy_decision', g.key, to_jsonb(g),
           'Seeded pending by migration 20270105000008; nothing approves it.'
      from public.governing_policy_decisions g where g.key = 'COMPENSATION_POLICY_TRANSITION_RULE';
  end if;

  select to_jsonb(g) into v_before from public.governing_policy_decisions g
   where g.key = 'Q1_GOVERNING_COMPENSATION_MODEL';
  update public.governing_policy_decisions g
     set status = 'approved', decided_by = null, decided_at = now(), reference = null,
         source = 'owner_reported', decision_option = 'C_BOTH_MODELS',
         evidence_status = 'awaiting_evidence', effective_date = null,
         note = 'Owner-reported on 2026-11-13: the President approved Q1 Option C - both compensation models '
             || '(IST payroll BA/PA/PB and the VIP card/points model), independent, no duplicate entitlements. '
             || 'No approval document, signature, approval date or effective date has been provided; evidence is awaited. '
             || 'decided_at is the time migration 20270105000008 RECORDED this report, not an approval date. '
             || 'Historical BA/PA/PB amounts, rates and targets remain unapproved reference values.'
   where g.key = 'Q1_GOVERNING_COMPENSATION_MODEL' and g.status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 1 then
    select to_jsonb(g) into v_after from public.governing_policy_decisions g
     where g.key = 'Q1_GOVERNING_COMPENSATION_MODEL';
    insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
    values (null, 'GOVERNING_POLICY_DECISION_RECORDED', 'governing_policy_decision',
      'Q1_GOVERNING_COMPENSATION_MODEL', v_before, v_after,
      'Recorded by migration 20270105000008 from an owner report; no approval document on file.');
  end if;
  perform set_config('afhomes.governing_policy_write', 'off', true);
end $$;

create or replace function private.compensation_policy_transition_rule_approved() returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.governing_policy_decisions g
                  where g.key = 'COMPENSATION_POLICY_TRANSITION_RULE' and g.status = 'approved')
$$;
revoke all on function private.compensation_policy_transition_rule_approved() from public, anon, authenticated, service_role;

-- The recorded basis of Q1, copied into every live payroll approval / disbursement audit event.
create or replace function private.q1_governing_basis() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select coalesce((select jsonb_build_object('source', g.source, 'evidenceStatus', g.evidence_status,
                                             'decisionOption', g.decision_option)
                     from public.governing_policy_decisions g
                    where g.key = 'Q1_GOVERNING_COMPENSATION_MODEL'),
                  jsonb_build_object('source', null, 'evidenceStatus', null, 'decisionOption', null))
$$;
revoke all on function private.q1_governing_basis() from public, anon, authenticated, service_role;

-- True for text that is no evidence at all: n/a, na, none, tbd, test, abc (alone or repeated),
-- punctuation only ('---'), or one repeated character. Case and punctuation are ignored.
create or replace function private.is_placeholder_text(p_text text) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select regexp_replace(lower(btrim(coalesce(p_text, ''))), '[^a-z0-9]', '', 'g') ~ '^((na|none|tbd|test|abc)+|(.)\3*)?$'
$$;
revoke all on function private.is_placeholder_text(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. RBAC: policy approval module (no role row; super_admin holds it by slug)
-- ---------------------------------------------------------------------------
insert into public.modules (key, name, group_name, sort_order) values
  ('finance.payroll_policy_approval', 'Compensation Policy Approval', 'Finance', 50)
on conflict (key) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. Compensation policy: lifecycle columns, constraints, guard
-- ---------------------------------------------------------------------------
alter table public.ist_compensation_policies add column if not exists policy_version integer;
alter table public.ist_compensation_policies add column if not exists submitted_by uuid
  references public.staff_users(id) on delete restrict;
alter table public.ist_compensation_policies add column if not exists submitted_at timestamptz;
alter table public.ist_compensation_policies add column if not exists returned_by uuid
  references public.staff_users(id) on delete restrict;
alter table public.ist_compensation_policies add column if not exists returned_at timestamptz;
alter table public.ist_compensation_policies add column if not exists return_reason text;
alter table public.ist_compensation_policies add column if not exists approval_evidence_reference text;
alter table public.ist_compensation_policies add column if not exists approval_note text;
alter table public.ist_compensation_policies add column if not exists updated_by uuid
  references public.staff_users(id) on delete restrict;
alter table public.ist_compensation_policies add column if not exists updated_at timestamptz not null default now();
alter table public.ist_compensation_policies add column if not exists ended_by uuid
  references public.staff_users(id) on delete restrict;
alter table public.ist_compensation_policies add column if not exists ended_at timestamptz;
alter table public.ist_compensation_policies add column if not exists end_note text;
alter table public.ist_compensation_policies add column if not exists idempotency_key text;
alter table public.ist_compensation_policies add column if not exists idempotency_fingerprint text;
alter table public.ist_compensation_policies add column if not exists prior_actor_ids uuid[] not null default '{}'::uuid[];
alter table public.ist_compensation_policies add column if not exists qp_ep_rule_reference text;
alter table public.ist_compensation_policies add column if not exists kpi_collection_policy_reference text;
alter table public.ist_compensation_policies add column if not exists limit_exception_rule text;
alter table public.ist_compensation_policies add column if not exists ba_review_limit text;
alter table public.ist_compensation_policies add column if not exists pa_review_limit text;
alter table public.ist_compensation_policies add column if not exists pb_review_limit text;
alter table public.ist_compensation_policies add column if not exists net_review_limit text;

comment on column public.ist_compensation_policies.rank is
  'IST position: SM = sales_manager, SSM = senior_sales_manager, SVD = vice_director role slug (the role is not renamed).';
comment on column public.ist_compensation_policies.policy_version is
  'Per-rank version number, assigned at creation, never reused.';
comment on column public.ist_compensation_policies.prior_actor_ids is
  'Everyone who EVER drafted, edited or submitted this policy. Maintained only by the guard trigger (a caller value is ignored), never shrinks; none of them may approve it, even after a return cleared submitted_by.';
comment on column public.ist_compensation_policies.idempotency_fingerprint is
  'sha256 of the create request that used idempotency_key. A replay with another payload is refused.';
comment on column public.ist_compensation_policies.net_review_limit is
  'Optional per-line review threshold (exact decimal). A live line above it is flagged review_required, never truncated. NULL = no limit configured.';

-- Version backfill for any pre-existing row (before the new guard exists; the 0001 trigger
-- does not protect this column).
update public.ist_compensation_policies p set policy_version = x.rn
  from (select q.id, row_number() over (partition by q.rank order by q.effective_from, q.created_at, q.id) as rn
          from public.ist_compensation_policies q) x
 where x.id = p.id and p.policy_version is null;
alter table public.ist_compensation_policies alter column policy_version set not null;
-- Same for the durable actor list (afterwards only the guard maintains it).
update public.ist_compensation_policies p
   set prior_actor_ids = array(select distinct x from unnest(array[p.created_by, p.submitted_by, p.updated_by]) x
                                where x is not null order by x)
 where p.prior_actor_ids = '{}'::uuid[];
create unique index if not exists ist_compensation_policies_rank_version
  on public.ist_compensation_policies (rank, policy_version);
create unique index if not exists ist_compensation_policies_idempotency
  on public.ist_compensation_policies (created_by, idempotency_key) where idempotency_key is not null;

-- Replace the 0001 lifecycle CHECKs (matched by definition) with v8 equivalents.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.ist_compensation_policies'::regclass and con.contype = 'c'
       and con.conname not like 'ist_compensation_policies_v8_%'
       and (con.conname = 'ist_compensation_policies_status_check'
            or pg_get_constraintdef(con.oid) like '%''retired''%'
            or pg_get_constraintdef(con.oid) like '%approved_by IS NULL%')
  loop
    execute format('alter table public.ist_compensation_policies drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_status_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_status_check
  check (status in ('draft','pending_approval','approved','retired'));
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_approved_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_approved_check
  check ((status in ('approved','retired')) = (approved_by is not null and approved_at is not null));
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_submitted_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_submitted_check
  check (status not in ('pending_approval','approved') or (submitted_by is not null and submitted_at is not null));
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_evidence_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_evidence_check
  check (status <> 'approved' or (length(btrim(coalesce(approval_evidence_reference, ''))) between 10 and 500
                                  and length(btrim(coalesce(approval_note, ''))) between 5 and 2000));
-- Separation of duties: the approver never drafted, edited or submitted the policy - ever.
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_separation_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_separation_check
  check (status <> 'approved' or (approved_by <> created_by and approved_by is distinct from submitted_by
                                  and approved_by is distinct from updated_by
                                  and not (approved_by = any (prior_actor_ids))));
-- 0001's regex accepts 0.0 / 0.00 / 0.0000: a collection gate is above 0 and at most 1.
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_gate_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_gate_check
  check (case when collection_gate ~ '^[0-9]+(\.[0-9]+)?$'
              then collection_gate::numeric > 0 and collection_gate::numeric <= 1 else false end);
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_return_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_return_check
  check ((returned_by is null) = (returned_at is null)
         and (returned_by is null or length(btrim(coalesce(return_reason, ''))) between 5 and 2000));
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_end_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_end_check
  check ((ended_by is null) = (ended_at is null)
         and (ended_by is null or (status in ('approved','retired') and effective_until is not null
                                   and length(btrim(coalesce(end_note, ''))) between 5 and 2000)));
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_limits_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_limits_check
  check ((ba_review_limit is null or ba_review_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$')
     and (pa_review_limit is null or pa_review_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$')
     and (pb_review_limit is null or pb_review_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$')
     and (net_review_limit is null or net_review_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'));
alter table public.ist_compensation_policies drop constraint if exists ist_compensation_policies_v8_text_check;
alter table public.ist_compensation_policies add constraint ist_compensation_policies_v8_text_check
  check (policy_version > 0
     and (qp_ep_rule_reference is null or length(btrim(qp_ep_rule_reference)) between 1 and 500)
     and (kpi_collection_policy_reference is null or length(btrim(kpi_collection_policy_reference)) between 1 and 500)
     and (limit_exception_rule is null or length(btrim(limit_exception_rule)) between 1 and 500)
     and (idempotency_key is null or length(idempotency_key) between 1 and 100)
     and (idempotency_fingerprint is null or idempotency_key is not null)
     and length(basis_note) <= 2000);

do $$
begin
  if exists (
    select 1 from pg_constraint con
     where con.conrelid = 'public.ist_compensation_policies'::regclass and con.contype = 'c'
       and con.conname not like 'ist_compensation_policies_v8_%'
       and (pg_get_constraintdef(con.oid) like '%''retired''%'
            or pg_get_constraintdef(con.oid) like '%approved_by IS NULL%')
  ) then
    raise exception 'COMPENSATION_POLICY_V8_CONSTRAINT_MIGRATION_INCOMPLETE';
  end if;
end $$;

comment on table public.ist_compensation_policies is
  'Effective-dated BA/PA/PB configuration per IST rank. Lifecycle draft -> pending_approval -> approved, written only by the policy RPCs. Only APPROVED rows may produce payable payroll. Approved rows are never edited; their open window may be closed once. active/superseded/expired are derived (private.ist_compensation_policy_lifecycle).';

-- One guard for every write (replaces the 0001 body; trigger now also covers INSERT).
create or replace function private.protect_ist_compensation_policy() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_life constant text[] := array['status','submitted_by','submitted_at','returned_by','returned_at',
    'return_reason','approved_by','approved_at','approval_evidence_reference','approval_note',
    'updated_by','updated_at','prior_actor_ids'];
  v_end constant text[] := array['effective_until','ended_by','ended_at','end_note','updated_at'];
  v_last_paid date;
begin
  if tg_op = 'DELETE' then
    raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  -- Durable separation-of-duties record: derived here, a caller-supplied value is ignored.
  if tg_op = 'INSERT' then
    new.prior_actor_ids := array[new.created_by];
  elsif tg_op = 'UPDATE' then
    new.prior_actor_ids := array(
      select distinct x from unnest(old.prior_actor_ids || array[old.created_by, old.submitted_by,
        old.updated_by, new.submitted_by, new.updated_by]) x where x is not null order by x);
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.rank, new.created_by, new.created_at, new.policy_version, new.idempotency_key, new.idempotency_fingerprint)
       is distinct from (old.id, old.rank, old.created_by, old.created_at, old.policy_version, old.idempotency_key, old.idempotency_fingerprint) then
      raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
    end if;
    -- Approved (and legacy retired) rows are history: the only change is closing an OPEN
    -- window once. Checked before the flag, so not even an RPC can do anything else.
    if old.status in ('approved','retired') and (
         old.effective_until is not null or new.status is distinct from old.status
         or (to_jsonb(new) - v_end) is distinct from (to_jsonb(old) - v_end)) then
      raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
    end if;
  end if;
  if current_setting('afhomes.compensation_policy_write', true) is distinct from 'on' then
    raise exception 'COMPENSATION_POLICY_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;

  -- The flag is a GUC any direct connection can set, so nothing below trusts it.
  if tg_op = 'INSERT' then
    -- Creating or editing a policy never approves it: a row is always born a draft.
    if new.status <> 'draft' or new.approved_by is not null or new.approved_at is not null
       or new.submitted_by is not null or new.submitted_at is not null
       or new.returned_by is not null or new.ended_by is not null or new.ended_at is not null then
      raise exception 'COMPENSATION_POLICY_TRANSITION_INVALID' using errcode = '55000';
    end if;
    return new;
  end if;

  if old.status in ('approved','retired') then
    -- Closing the window: never before it opens, never cutting a finalized payroll month.
    if new.effective_until is null or new.effective_until < new.effective_from then
      raise exception 'COMPENSATION_POLICY_END_DATE_INVALID' using errcode = '22023';
    end if;
    select max((to_date(b.period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
      into v_last_paid
      from public.payroll_lines l join public.payroll_batches b on b.id = l.batch_id
     where l.policy_id = new.id and b.mode = 'live' and b.status in ('approved','closed');
    if v_last_paid is not null and new.effective_until < v_last_paid then
      raise exception 'COMPENSATION_POLICY_IN_USE_BY_FINALIZED_PAYROLL' using errcode = '55000';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if not ((old.status, new.status) in (('draft','draft'), ('draft','pending_approval'),
          ('pending_approval','draft'), ('pending_approval','approved'))) then
    raise exception 'COMPENSATION_POLICY_TRANSITION_INVALID' using errcode = '55000';
  end if;
  -- Figures change only on a draft that stays a draft; submit/return/approve change none.
  if not (old.status = 'draft' and new.status = 'draft')
     and (to_jsonb(new) - v_life) is distinct from (to_jsonb(old) - v_life) then
    raise exception 'COMPENSATION_POLICY_NOT_EDITABLE' using errcode = '55000';
  end if;
  if new.status = 'approved' then
    if not private.ist_payroll_live_authorized() then
      raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    if length(btrim(coalesce(new.approval_evidence_reference, ''))) not between 10 and 500
       or private.is_placeholder_text(new.approval_evidence_reference) then
      raise exception 'COMPENSATION_POLICY_EVIDENCE_REQUIRED' using errcode = '22023';
    end if;
    if length(btrim(coalesce(new.approval_note, ''))) not between 5 and 2000
       or private.is_placeholder_text(new.approval_note) then
      raise exception 'COMPENSATION_POLICY_APPROVAL_NOTE_REQUIRED' using errcode = '22023';
    end if;
    if new.approved_by is null or new.approved_by = new.created_by
       or new.approved_by = new.submitted_by or new.approved_by = new.updated_by
       or new.approved_by = any (new.prior_actor_ids) then
      raise exception 'COMPENSATION_POLICY_SELF_APPROVAL' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.protect_ist_compensation_policy() from public, anon, authenticated, service_role;
drop trigger if exists ist_compensation_policies_protect on public.ist_compensation_policies;
create trigger ist_compensation_policies_protect
  before insert or update or delete on public.ist_compensation_policies
  for each row execute function private.protect_ist_compensation_policy();

create or replace function private.ist_compensation_policy_truncate_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
end $$;
revoke all on function private.ist_compensation_policy_truncate_guard() from public, anon, authenticated, service_role;
drop trigger if exists ist_compensation_policies_no_truncate on public.ist_compensation_policies;
create trigger ist_compensation_policies_no_truncate before truncate on public.ist_compensation_policies
  for each statement execute function private.ist_compensation_policy_truncate_guard();
revoke truncate, delete on public.ist_compensation_policies from service_role;

-- ---------------------------------------------------------------------------
-- 4. Derived state, figures snapshot, month segments
-- ---------------------------------------------------------------------------
-- draft | pending_approval | approved (not yet in effect) | active (in effect on p_on)
-- | superseded (ended, a later approved policy exists) | expired (ended, none) | retired (legacy)
create or replace function private.ist_compensation_policy_lifecycle(p_id uuid, p_on date)
returns text language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select case
    when p.status in ('draft','pending_approval','retired') then p.status
    when p.effective_from > p_on then 'approved'
    when p.effective_until is null or p.effective_until >= p_on then 'active'
    when exists (select 1 from public.ist_compensation_policies n
                  where n.rank = p.rank and n.status = 'approved' and n.effective_from > p.effective_until)
      then 'superseded'
    else 'expired' end
  from public.ist_compensation_policies p where p.id = p_id
$$;
revoke all on function private.ist_compensation_policy_lifecycle(uuid, date) from public, anon, authenticated, service_role;

create or replace function private.ist_compensation_policy_figures(p public.ist_compensation_policies)
returns jsonb language sql immutable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'rank', p.rank, 'policyVersion', p.policy_version,
    'monthlyBa', p.monthly_ba, 'baTarget', p.ba_target, 'monthlyPa', p.monthly_pa, 'paTarget', p.pa_target,
    'pbTarget', p.pb_target, 'pbRate', p.pb_rate, 'collectionGate', p.collection_gate,
    'effectiveFrom', p.effective_from, 'effectiveUntil', p.effective_until, 'basisNote', p.basis_note,
    'qpEpRuleReference', p.qp_ep_rule_reference, 'kpiCollectionPolicyReference', p.kpi_collection_policy_reference,
    'limitExceptionRule', p.limit_exception_rule, 'baReviewLimit', p.ba_review_limit,
    'paReviewLimit', p.pa_review_limit, 'pbReviewLimit', p.pb_review_limit, 'netReviewLimit', p.net_review_limit)
$$;
revoke all on function private.ist_compensation_policy_figures(public.ist_compensation_policies) from public, anon, authenticated, service_role;

-- The approved policy for each stretch of a month (gaps carry policyId null).
create or replace function private.ist_compensation_policy_segments(p_rank text, p_period text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_start date; v_end date; v_cursor date; v_from date; v_to date;
  v_segments jsonb := '[]'::jsonb; v_with_policy integer := 0; r record;
begin
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  v_cursor := v_start;
  for r in
    select p.id, p.policy_version, p.effective_from, p.effective_until
      from public.ist_compensation_policies p
     where p.rank = p_rank and p.status = 'approved'
       and p.effective_from <= v_end and coalesce(p.effective_until, 'infinity'::date) >= v_start
     order by p.effective_from, p.id
  loop
    v_from := greatest(r.effective_from, v_start);
    v_to := least(coalesce(r.effective_until, v_end), v_end);
    if v_from > v_cursor then
      v_segments := v_segments || jsonb_build_array(jsonb_build_object('from', v_cursor, 'to', v_from - 1,
        'days', v_from - v_cursor, 'policyId', null, 'policyVersion', null));
    end if;
    v_segments := v_segments || jsonb_build_array(jsonb_build_object('from', v_from, 'to', v_to,
      'days', v_to - v_from + 1, 'policyId', r.id, 'policyVersion', r.policy_version));
    v_with_policy := v_with_policy + 1;
    v_cursor := v_to + 1;
  end loop;
  if v_cursor <= v_end then
    v_segments := v_segments || jsonb_build_array(jsonb_build_object('from', v_cursor, 'to', v_end,
      'days', v_end - v_cursor + 1, 'policyId', null, 'policyVersion', null));
  end if;
  return jsonb_build_object('rank', p_rank, 'period', p_period, 'monthStart', v_start, 'monthEnd', v_end,
    'singlePolicy', jsonb_array_length(v_segments) = 1 and v_with_policy = 1,
    'transition', jsonb_array_length(v_segments) > 1 and v_with_policy > 0,
    'segments', v_segments);
end $$;
revoke all on function private.ist_compensation_policy_segments(text, text) from public, anon, authenticated, service_role;

create or replace function private.ist_compensation_policy_month_has_transition(p_rank text, p_period text)
returns boolean language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select (private.ist_compensation_policy_segments(p_rank, p_period) ->> 'transition')::boolean
$$;
revoke all on function private.ist_compensation_policy_month_has_transition(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Payroll lines: review limits, transition rule; batch guard; policy re-check
-- ---------------------------------------------------------------------------
alter table public.payroll_lines add column if not exists review_required boolean not null default false;
alter table public.payroll_lines add column if not exists review_flags text[] not null default '{}'::text[];
alter table public.payroll_lines add column if not exists review_note text;
alter table public.payroll_lines add column if not exists reviewed_by uuid references public.staff_users(id) on delete restrict;
alter table public.payroll_lines add column if not exists reviewed_at timestamptz;
comment on column public.payroll_lines.review_flags is
  'Set by the line guard from the cited policy: BA/PA/PB/NET_ABOVE_REVIEW_LIMIT (optional review limits) and BA/PA_ABOVE_POLICY_AMOUNT (figure above the policy''s monthly BA / PA; proration only reduces). Figures are never truncated or rejected. PB has no policy bound.';
alter table public.payroll_lines drop constraint if exists payroll_lines_v8_review_check;
alter table public.payroll_lines add constraint payroll_lines_v8_review_check
  check (review_required = (cardinality(review_flags) > 0)
     and review_flags <@ array['BA_ABOVE_REVIEW_LIMIT','PA_ABOVE_REVIEW_LIMIT','PB_ABOVE_REVIEW_LIMIT','NET_ABOVE_REVIEW_LIMIT',
                               'BA_ABOVE_POLICY_AMOUNT','PA_ABOVE_POLICY_AMOUNT']::text[]
     and (reviewed_by is null) = (reviewed_at is null)
     and (reviewed_at is null) = (review_note is null)
     and (reviewed_at is null or (review_required and length(btrim(review_note)) between 5 and 2000)));

-- Re-created from 0005. Changes: review fields derived here (never from the caller); a live
-- computed line in a month whose policy changes is always refused (segment payouts are not
-- implemented); the one permitted UPDATE is Finance's review note (review_payroll_line).
create or replace function private.payroll_line_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_period text; v_status text; v_mode text;
  v_policy public.ist_compensation_policies%rowtype;
  v_flags text[] := array[]::text[];
  v_re constant text := '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$';
  v_review constant text[] := array['review_note','reviewed_by','reviewed_at'];
begin
  select b.period, b.status, b.mode into v_period, v_status, v_mode from public.payroll_batches b
   where b.id = case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
  -- Lines are editable only while their batch is a draft.
  if v_status is distinct from 'draft' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if current_setting('afhomes.payroll_write', true) is distinct from 'on'
       or not old.review_required or old.reviewed_at is not null
       or (to_jsonb(new) - v_review) is distinct from (to_jsonb(old) - v_review)
       or new.reviewed_by is null or new.reviewed_at is null
       or length(btrim(coalesce(new.review_note, ''))) < 5 then
      raise exception 'PAYROLL_LINE_IMMUTABLE' using errcode = '55000';
    end if;
    return new;
  end if;
  if current_setting('afhomes.payroll_write', true) is distinct from 'on' then
    raise exception 'PAYROLL_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  new.review_required := false;
  new.review_flags := array[]::text[];
  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;

  if new.status = 'blocked' then
    if new.ba is not null or new.pa is not null or new.pb is not null or new.adjustments is not null
       or new.withheld is not null or new.net is not null
       or length(btrim(coalesce(new.blocked_reason, ''))) < 3 then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
  elsif new.status = 'computed' then
    if new.ba is null or new.pa is null or new.pb is null or new.adjustments is null
       or new.withheld is null or new.net is null
       or new.ba !~ v_re or new.pa !~ v_re or new.pb !~ v_re or new.adjustments !~ v_re
       or new.withheld !~ v_re or new.net !~ v_re then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
    if v_mode = 'simulation' then
      if not (new.inputs ? 'policySnapshot') then
        raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
      end if;
    else
      if not private.ist_payroll_live_authorized() then
        raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
      end if;
      -- A month whose policy changes inside it has no way to be paid yet: without the rule it
      -- is not approved; with the rule, segment payouts still do not exist, and paying the
      -- whole month at the first-of-month policy would be wrong.
      if private.ist_compensation_policy_month_has_transition(new.rank, v_period) then
        if private.compensation_policy_transition_rule_approved() then
          raise exception 'POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED' using errcode = '0A000';
        end if;
        raise exception 'POLICY_TRANSITION_RULE_NOT_APPROVED' using errcode = '55000';
      end if;
      select p.* into v_policy
        from private.ist_compensation_policy_for(new.rank, to_date(v_period || '-01', 'YYYY-MM-DD')) p;
      if v_policy.id is null or new.policy_id is distinct from v_policy.id then
        raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
      end if;
    end if;
    if new.net::numeric <> greatest(0::numeric,
         new.ba::numeric + new.pa::numeric + new.pb::numeric - new.withheld::numeric - new.adjustments::numeric) then
      raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
    end if;
    if v_mode = 'live' then
      -- A live figure above its policy's monthly amount is flagged for review, never changed.
      if new.ba::numeric > v_policy.monthly_ba::numeric then
        v_flags := v_flags || 'BA_ABOVE_POLICY_AMOUNT'::text;
      end if;
      if new.pa::numeric > v_policy.monthly_pa::numeric then
        v_flags := v_flags || 'PA_ABOVE_POLICY_AMOUNT'::text;
      end if;
      if v_policy.ba_review_limit is not null and new.ba::numeric > v_policy.ba_review_limit::numeric then
        v_flags := v_flags || 'BA_ABOVE_REVIEW_LIMIT'::text;
      end if;
      if v_policy.pa_review_limit is not null and new.pa::numeric > v_policy.pa_review_limit::numeric then
        v_flags := v_flags || 'PA_ABOVE_REVIEW_LIMIT'::text;
      end if;
      if v_policy.pb_review_limit is not null and new.pb::numeric > v_policy.pb_review_limit::numeric then
        v_flags := v_flags || 'PB_ABOVE_REVIEW_LIMIT'::text;
      end if;
      if v_policy.net_review_limit is not null and new.net::numeric > v_policy.net_review_limit::numeric then
        v_flags := v_flags || 'NET_ABOVE_REVIEW_LIMIT'::text;
      end if;
      new.review_flags := v_flags;
      new.review_required := cardinality(v_flags) > 0;
    end if;
  else
    raise exception 'PAYROLL_LINE_INVALID' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.payroll_line_guard() from public, anon, authenticated, service_role;

-- Re-created from 0006. Change: a live batch never reaches submitted/approved while a
-- flagged line is unreviewed (also refuses a flag-set direct write).
create or replace function private.payroll_batch_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'closed' then
      raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
    end if;
    if old.status = 'approved' and (
         new.status is distinct from 'closed'
         or (to_jsonb(new) - array['status','closed_by','closed_at','updated_at'])
            is distinct from (to_jsonb(old) - array['status','closed_by','closed_at','updated_at'])) then
      raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
    end if;
  end if;
  if current_setting('afhomes.payroll_write', true) is distinct from 'on' then
    raise exception 'PAYROLL_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'PAYROLL_BATCH_TRANSITION_INVALID' using errcode = '55000';
    end if;
    if new.mode = 'live' and not private.ist_payroll_live_authorized() then
      raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.id, new.period, new.created_by, new.created_at, new.mode) is distinct from
     (old.id, old.period, old.created_by, old.created_at, old.mode) then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if new.simulation_basis is distinct from old.simulation_basis
     and (new.mode <> 'simulation' or old.status not in ('draft','returned')) then
    raise exception 'PAYROLL_BATCH_LOCKED' using errcode = '55000';
  end if;
  if new.mode = 'live' and new.status in ('submitted','approved','closed')
     and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if new.mode = 'live' and new.status in ('submitted','approved') and new.status is distinct from old.status
     and exists (select 1 from public.payroll_lines l
                  where l.batch_id = new.id and l.review_required and l.reviewed_at is null) then
    raise exception 'PAYROLL_LINE_REVIEW_REQUIRED' using errcode = '55000';
  end if;
  if not ((old.status, new.status) in (('draft','draft'), ('draft','submitted'),
          ('submitted','approved'), ('submitted','returned'), ('returned','draft'),
          ('approved','closed'))) then
    raise exception 'PAYROLL_BATCH_TRANSITION_INVALID' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.payroll_batch_guard() from public, anon, authenticated, service_role;

-- Re-created from 0005 (now volatile plpgsql so it can share-lock the cited policies: a
-- concurrent end-date change waits for, or is seen by, the submit/approve that calls this).
-- True when every computed line still cites the approved policy for its rank on the 1st and
-- the month has no policy transition (with or without the transition rule approved).
create or replace function private.payroll_batch_policies_ok(p_batch_id uuid) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare v_period text;
begin
  select b.period into v_period from public.payroll_batches b where b.id = p_batch_id;
  perform 1 from public.ist_compensation_policies p
   where p.id in (select l.policy_id from public.payroll_lines l
                   where l.batch_id = p_batch_id and l.policy_id is not null)
   order by p.id
   for share;
  return not exists (
    select 1 from public.payroll_lines l
     where l.batch_id = p_batch_id and l.status = 'computed'
       and ((select p.id from private.ist_compensation_policy_for(l.rank, to_date(v_period || '-01', 'YYYY-MM-DD')) p)
              is distinct from l.policy_id
            or private.ist_compensation_policy_month_has_transition(l.rank, v_period)));
end $$;
revoke all on function private.payroll_batch_policies_ok(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RPCs (service_role only; actor re-validated against dynamic permissions)
-- ---------------------------------------------------------------------------
-- Create (p_policy_id null; finance.payroll_policy create) or edit a DRAFT (update).
-- p_fields keys: rank, monthlyBa, baTarget, monthlyPa, paTarget, pbTarget, pbRate,
-- collectionGate, effectiveFrom, effectiveUntil, basisNote, qpEpRuleReference,
-- kpiCollectionPolicyReference, limitExceptionRule, baReviewLimit, paReviewLimit,
-- pbReviewLimit, netReviewLimit. An edit replaces every field (full document).
-- Create is idempotent per (actor, p_idempotency_key) for the SAME payload (another payload:
-- COMPENSATION_POLICY_IDEMPOTENCY_CONFLICT); an unchanged edit writes nothing.
create or replace function public.save_ist_compensation_policy_draft(
  p_policy_id uuid, p_fields jsonb, p_actor_id uuid, p_idempotency_key text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_allowed constant text[] := array['rank','monthlyBa','baTarget','monthlyPa','paTarget','pbTarget',
    'pbRate','collectionGate','effectiveFrom','effectiveUntil','basisNote','qpEpRuleReference',
    'kpiCollectionPolicyReference','limitExceptionRule','baReviewLimit','paReviewLimit',
    'pbReviewLimit','netReviewLimit'];
  -- At most 15 integer digits: a longer digit string is refused here, never left to overflow.
  v_money constant text := '^(0|[1-9][0-9]{0,14})(\.[0-9]{1,2})?$';
  v_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_old public.ist_compensation_policies%rowtype;
  v_new public.ist_compensation_policies%rowtype;
  v_id uuid; k text; v_text text; v_from date; v_until date; v_fp text; v_old_fp text;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy',
    case when p_policy_id is null then 'create' else 'update' end);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'fields must be an object';
  end if;
  if v_key is not null and length(v_key) > 100 then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'idempotency key too long';
  end if;
  -- Replay is decided before any validation or lifecycle check. The same key with another
  -- payload is a different request, never a replay.
  if p_policy_id is null and v_key is not null then
    v_fp := encode(sha256(convert_to(jsonb_strip_nulls(p_fields)::text, 'UTF8')), 'hex');
    select p.id, p.idempotency_fingerprint into v_id, v_old_fp from public.ist_compensation_policies p
     where p.created_by = p_actor_id and p.idempotency_key = v_key;
    if v_id is not null then
      if v_old_fp is distinct from v_fp then
        raise exception 'COMPENSATION_POLICY_IDEMPOTENCY_CONFLICT' using errcode = '23505';
      end if;
      return v_id;
    end if;
  end if;

  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any (v_allowed)) then
      raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = format('unknown field %s', k);
    end if;
  end loop;
  foreach k in array array['monthlyBa','baTarget','monthlyPa','paTarget','pbTarget'] loop
    if jsonb_typeof(p_fields -> k) is distinct from 'string' or (p_fields ->> k) !~ v_money then
      raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = format('%s must be an exact decimal amount', k);
    end if;
  end loop;
  foreach k in array array['baReviewLimit','paReviewLimit','pbReviewLimit','netReviewLimit'] loop
    if coalesce(jsonb_typeof(p_fields -> k), 'null') <> 'null'
       and (jsonb_typeof(p_fields -> k) <> 'string' or (p_fields ->> k) !~ v_money) then
      raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = format('%s must be an exact decimal amount or null', k);
    end if;
  end loop;
  if jsonb_typeof(p_fields -> 'pbRate') is distinct from 'string'
     or (p_fields ->> 'pbRate') !~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$' then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'pbRate must be a rate between 0 and 1';
  end if;
  if jsonb_typeof(p_fields -> 'collectionGate') is distinct from 'string'
     or (p_fields ->> 'collectionGate') !~ '^(0\.[0-9]{1,4}|1(\.0{1,4})?)$' then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'collectionGate must be a rate above 0 and at most 1';
  end if;
  -- (separate statement: the cast runs only on a string the regex accepted) 0.0 / 0.00 / 0.0000 are not above 0.
  if (p_fields ->> 'collectionGate')::numeric <= 0 then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'collectionGate must be a rate above 0 and at most 1';
  end if;
  if jsonb_typeof(p_fields -> 'basisNote') is distinct from 'string'
     or length(btrim(p_fields ->> 'basisNote')) not between 5 and 2000 then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'basisNote must be 5 to 2000 characters';
  end if;
  foreach k in array array['qpEpRuleReference','kpiCollectionPolicyReference','limitExceptionRule'] loop
    if coalesce(jsonb_typeof(p_fields -> k), 'null') <> 'null'
       and (jsonb_typeof(p_fields -> k) <> 'string' or length(btrim(p_fields ->> k)) not between 1 and 500) then
      raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = format('%s must be 1 to 500 characters or null', k);
    end if;
  end loop;
  if jsonb_typeof(p_fields -> 'effectiveFrom') is distinct from 'string'
     or (p_fields ->> 'effectiveFrom') !~ v_date
     or (coalesce(jsonb_typeof(p_fields -> 'effectiveUntil'), 'null') <> 'null'
         and (jsonb_typeof(p_fields -> 'effectiveUntil') <> 'string' or (p_fields ->> 'effectiveUntil') !~ v_date)) then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'dates must be YYYY-MM-DD';
  end if;
  begin
    v_from := (p_fields ->> 'effectiveFrom')::date;
    v_until := (p_fields ->> 'effectiveUntil')::date;
  exception when others then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'dates must be real calendar dates';
  end;
  if v_until is not null and v_until < v_from then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'effectiveUntil is before effectiveFrom';
  end if;
  if (p_fields ->> 'rank') is null or (p_fields ->> 'rank') not in ('SM','SSM','SVD') then
    raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'rank must be SM, SSM or SVD';
  end if;

  if p_policy_id is null then
    perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || (p_fields ->> 'rank')));
    v_new.rank := p_fields ->> 'rank';
    select coalesce(max(p.policy_version), 0) + 1 into v_new.policy_version
      from public.ist_compensation_policies p where p.rank = v_new.rank;
  else
    select p.* into v_old from public.ist_compensation_policies p where p.id = p_policy_id;
    if not found then raise exception 'COMPENSATION_POLICY_NOT_FOUND' using errcode = 'P0002'; end if;
    perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || v_old.rank));
    select p.* into v_old from public.ist_compensation_policies p where p.id = p_policy_id for update;
    if v_old.status <> 'draft' then
      raise exception 'COMPENSATION_POLICY_NOT_EDITABLE' using errcode = '55000';
    end if;
    if (p_fields ->> 'rank') <> v_old.rank then
      raise exception 'COMPENSATION_POLICY_INVALID' using errcode = '22023', detail = 'rank cannot change; create a new draft';
    end if;
    v_new := v_old;
  end if;
  v_new.monthly_ba := private.money((p_fields ->> 'monthlyBa')::numeric);
  v_new.ba_target := private.money((p_fields ->> 'baTarget')::numeric);
  v_new.monthly_pa := private.money((p_fields ->> 'monthlyPa')::numeric);
  v_new.pa_target := private.money((p_fields ->> 'paTarget')::numeric);
  v_new.pb_target := private.money((p_fields ->> 'pbTarget')::numeric);
  v_new.pb_rate := p_fields ->> 'pbRate';
  v_new.collection_gate := p_fields ->> 'collectionGate';
  v_new.effective_from := v_from;
  v_new.effective_until := v_until;
  v_new.basis_note := btrim(p_fields ->> 'basisNote');
  v_new.qp_ep_rule_reference := nullif(btrim(coalesce(p_fields ->> 'qpEpRuleReference', '')), '');
  v_new.kpi_collection_policy_reference := nullif(btrim(coalesce(p_fields ->> 'kpiCollectionPolicyReference', '')), '');
  v_new.limit_exception_rule := nullif(btrim(coalesce(p_fields ->> 'limitExceptionRule', '')), '');
  v_new.ba_review_limit := private.money((p_fields ->> 'baReviewLimit')::numeric);
  v_new.pa_review_limit := private.money((p_fields ->> 'paReviewLimit')::numeric);
  v_new.pb_review_limit := private.money((p_fields ->> 'pbReviewLimit')::numeric);
  v_new.net_review_limit := private.money((p_fields ->> 'netReviewLimit')::numeric);

  perform set_config('afhomes.compensation_policy_write', 'on', true);
  if p_policy_id is null then
    insert into public.ist_compensation_policies
      (rank, policy_version, monthly_ba, ba_target, monthly_pa, pa_target, pb_target, pb_rate,
       collection_gate, effective_from, effective_until, basis_note, qp_ep_rule_reference,
       kpi_collection_policy_reference, limit_exception_rule, ba_review_limit, pa_review_limit,
       pb_review_limit, net_review_limit, created_by, idempotency_key, idempotency_fingerprint)
    values (v_new.rank, v_new.policy_version, v_new.monthly_ba, v_new.ba_target, v_new.monthly_pa,
       v_new.pa_target, v_new.pb_target, v_new.pb_rate, v_new.collection_gate, v_new.effective_from,
       v_new.effective_until, v_new.basis_note, v_new.qp_ep_rule_reference,
       v_new.kpi_collection_policy_reference, v_new.limit_exception_rule, v_new.ba_review_limit,
       v_new.pa_review_limit, v_new.pb_review_limit, v_new.net_review_limit, p_actor_id, v_key, v_fp)
    returning * into v_new;
    perform set_config('afhomes.compensation_policy_write', 'off', true);
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (p_actor_id, 'COMPENSATION_POLICY_DRAFT_CREATED', 'ist_compensation_policy', v_new.id::text,
      private.ist_compensation_policy_figures(v_new) || jsonb_build_object('status', 'draft'));
    return v_new.id;
  end if;

  if private.ist_compensation_policy_figures(v_new) = private.ist_compensation_policy_figures(v_old) then
    perform set_config('afhomes.compensation_policy_write', 'off', true);
    return v_old.id;  -- nothing changed: no write, no event
  end if;
  update public.ist_compensation_policies p set
    monthly_ba = v_new.monthly_ba, ba_target = v_new.ba_target, monthly_pa = v_new.monthly_pa,
    pa_target = v_new.pa_target, pb_target = v_new.pb_target, pb_rate = v_new.pb_rate,
    collection_gate = v_new.collection_gate, effective_from = v_new.effective_from,
    effective_until = v_new.effective_until, basis_note = v_new.basis_note,
    qp_ep_rule_reference = v_new.qp_ep_rule_reference,
    kpi_collection_policy_reference = v_new.kpi_collection_policy_reference,
    limit_exception_rule = v_new.limit_exception_rule, ba_review_limit = v_new.ba_review_limit,
    pa_review_limit = v_new.pa_review_limit, pb_review_limit = v_new.pb_review_limit,
    net_review_limit = v_new.net_review_limit, updated_by = p_actor_id
   where p.id = v_old.id;
  perform set_config('afhomes.compensation_policy_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'COMPENSATION_POLICY_DRAFT_UPDATED', 'ist_compensation_policy', v_old.id::text,
    private.ist_compensation_policy_figures(v_old), private.ist_compensation_policy_figures(v_new));
  return v_old.id;
end $$;
revoke all on function public.save_ist_compensation_policy_draft(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_ist_compensation_policy_draft(uuid, jsonb, uuid, text) to service_role;

create or replace function public.submit_ist_compensation_policy(p_policy_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.ist_compensation_policies%rowtype; v_rank text;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy', 'update');
  select p.rank into v_rank from public.ist_compensation_policies p where p.id = p_policy_id;
  if not found then raise exception 'COMPENSATION_POLICY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || v_rank));
  select p.* into v from public.ist_compensation_policies p where p.id = p_policy_id for update;
  if v.status = 'pending_approval' and v.submitted_by = p_actor_id then return v.status; end if;  -- replay
  if v.status <> 'draft' then raise exception 'COMPENSATION_POLICY_NOT_EDITABLE' using errcode = '55000'; end if;
  perform set_config('afhomes.compensation_policy_write', 'on', true);
  update public.ist_compensation_policies p
     set status = 'pending_approval', submitted_by = p_actor_id, submitted_at = now()
   where p.id = v.id;
  perform set_config('afhomes.compensation_policy_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'COMPENSATION_POLICY_SUBMITTED', 'ist_compensation_policy', v.id::text,
    jsonb_build_object('status', 'draft'),
    private.ist_compensation_policy_figures(v) || jsonb_build_object('status', 'pending_approval'));
  return 'pending_approval';
end $$;
revoke all on function public.submit_ist_compensation_policy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_ist_compensation_policy(uuid, uuid) to service_role;

create or replace function public.return_ist_compensation_policy(p_policy_id uuid, p_reason text, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.ist_compensation_policies%rowtype; v_rank text; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy_approval', 'update');
  if length(v_reason) not between 5 and 2000 then
    raise exception 'COMPENSATION_POLICY_RETURN_REASON_REQUIRED' using errcode = '22023';
  end if;
  select p.rank into v_rank from public.ist_compensation_policies p where p.id = p_policy_id;
  if not found then raise exception 'COMPENSATION_POLICY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || v_rank));
  select p.* into v from public.ist_compensation_policies p where p.id = p_policy_id for update;
  if v.status = 'draft' and v.returned_by = p_actor_id and v.return_reason = v_reason then
    return v.status;  -- replay
  end if;
  if v.status <> 'pending_approval' then
    raise exception 'COMPENSATION_POLICY_NOT_PENDING' using errcode = '55000';
  end if;
  perform set_config('afhomes.compensation_policy_write', 'on', true);
  update public.ist_compensation_policies p
     set status = 'draft', submitted_by = null, submitted_at = null,
         returned_by = p_actor_id, returned_at = now(), return_reason = v_reason
   where p.id = v.id;
  perform set_config('afhomes.compensation_policy_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'COMPENSATION_POLICY_RETURNED', 'ist_compensation_policy', v.id::text,
    jsonb_build_object('status', 'pending_approval', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'draft', 'rank', v.rank, 'policyVersion', v.policy_version), v_reason);
  return 'draft';
end $$;
revoke all on function public.return_ist_compensation_policy(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.return_ist_compensation_policy(uuid, text, uuid) to service_role;

-- Approval never supersedes anything: an overlapping approved window is refused
-- (COMPENSATION_POLICY_OVERLAP); end the old policy first with end_ist_compensation_policy.
create or replace function public.approve_ist_compensation_policy(
  p_policy_id uuid, p_evidence_reference text, p_note text, p_actor_id uuid
) returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v public.ist_compensation_policies%rowtype; v_rank text;
  v_ref text := btrim(coalesce(p_evidence_reference, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy_approval', 'update');
  if length(v_ref) not between 10 and 500 or private.is_placeholder_text(v_ref) then
    raise exception 'COMPENSATION_POLICY_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if length(v_note) not between 5 and 2000 or private.is_placeholder_text(v_note) then
    raise exception 'COMPENSATION_POLICY_APPROVAL_NOTE_REQUIRED' using errcode = '22023';
  end if;
  select p.rank into v_rank from public.ist_compensation_policies p where p.id = p_policy_id;
  if not found then raise exception 'COMPENSATION_POLICY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || v_rank));
  select p.* into v from public.ist_compensation_policies p where p.id = p_policy_id for update;
  if v.status = 'approved' and v.approved_by = p_actor_id then return v.status; end if;  -- replay
  if v.status <> 'pending_approval' then
    raise exception 'COMPENSATION_POLICY_NOT_PENDING' using errcode = '55000';
  end if;
  -- Re-checked at call time: a payable policy needs the governing model approved.
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  -- Anyone who ever drafted, edited or submitted it (prior_actor_ids survives a return).
  if p_actor_id in (v.created_by, v.submitted_by) or p_actor_id = v.updated_by
     or p_actor_id = any (v.prior_actor_ids) then
    raise exception 'COMPENSATION_POLICY_SELF_APPROVAL' using errcode = '42501';
  end if;
  perform set_config('afhomes.compensation_policy_write', 'on', true);
  update public.ist_compensation_policies p
     set status = 'approved', approved_by = p_actor_id, approved_at = now(),
         approval_evidence_reference = v_ref, approval_note = v_note
   where p.id = v.id;
  perform set_config('afhomes.compensation_policy_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'COMPENSATION_POLICY_APPROVED', 'ist_compensation_policy', v.id::text,
    jsonb_build_object('status', 'pending_approval', 'createdBy', v.created_by, 'submittedBy', v.submitted_by),
    private.ist_compensation_policy_figures(v)
      || jsonb_build_object('status', 'approved', 'evidenceReference', v_ref,
                            'priorActorIds', to_jsonb(v.prior_actor_ids),
                            'governingBasis', private.q1_governing_basis()), v_note);
  return 'approved';
end $$;
revoke all on function public.approve_ist_compensation_policy(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.approve_ist_compensation_policy(uuid, text, text, uuid) to service_role;

-- Close an approved policy's OPEN window once (retire / make room for the next policy).
create or replace function public.end_ist_compensation_policy(
  p_policy_id uuid, p_effective_until date, p_note text, p_actor_id uuid
) returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.ist_compensation_policies%rowtype; v_rank text; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy_approval', 'update');
  if length(v_note) not between 5 and 2000 then
    raise exception 'COMPENSATION_POLICY_END_NOTE_REQUIRED' using errcode = '22023';
  end if;
  if p_effective_until is null then
    raise exception 'COMPENSATION_POLICY_END_DATE_INVALID' using errcode = '22023';
  end if;
  select p.rank into v_rank from public.ist_compensation_policies p where p.id = p_policy_id;
  if not found then raise exception 'COMPENSATION_POLICY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('ist_compensation_policy:' || v_rank));
  select p.* into v from public.ist_compensation_policies p where p.id = p_policy_id for update;
  if v.ended_by = p_actor_id and v.effective_until = p_effective_until then return 'ended'; end if;  -- replay
  if v.status <> 'approved' then
    raise exception 'COMPENSATION_POLICY_NOT_APPROVED' using errcode = '55000';
  end if;
  if v.effective_until is not null then
    raise exception 'COMPENSATION_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  if p_effective_until < v.effective_from then
    raise exception 'COMPENSATION_POLICY_END_DATE_INVALID' using errcode = '22023';
  end if;
  -- (the guard repeats this check; COMPENSATION_POLICY_IN_USE_BY_FINALIZED_PAYROLL)
  perform set_config('afhomes.compensation_policy_write', 'on', true);
  update public.ist_compensation_policies p
     set effective_until = p_effective_until, ended_by = p_actor_id, ended_at = now(), end_note = v_note
   where p.id = v.id;
  perform set_config('afhomes.compensation_policy_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'COMPENSATION_POLICY_ENDED', 'ist_compensation_policy', v.id::text,
    jsonb_build_object('effectiveUntil', null),
    jsonb_build_object('effectiveUntil', p_effective_until, 'rank', v.rank, 'policyVersion', v.policy_version), v_note);
  return 'ended';
end $$;
revoke all on function public.end_ist_compensation_policy(uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function public.end_ist_compensation_policy(uuid, date, text, uuid) to service_role;

-- Finance records why a flagged line's figure is acceptable. The figure itself never changes.
create or replace function public.review_payroll_line(p_line_id uuid, p_note text, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_line public.payroll_lines%rowtype; v_batch public.payroll_batches%rowtype; v_batch_id uuid;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  if length(v_note) not between 5 and 2000 then
    raise exception 'PAYROLL_REVIEW_NOTE_REQUIRED' using errcode = '22023';
  end if;
  select l.batch_id into v_batch_id from public.payroll_lines l where l.id = p_line_id;
  if not found then raise exception 'PAYROLL_LINE_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Lock order: batch (serializes with submit) then line.
  select b.* into v_batch from public.payroll_batches b where b.id = v_batch_id for update;
  select l.* into v_line from public.payroll_lines l where l.id = p_line_id for update;
  if not found then raise exception 'PAYROLL_LINE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_line.reviewed_by = p_actor_id and v_line.review_note = v_note then return 'reviewed'; end if;  -- replay
  if not v_line.review_required then
    raise exception 'PAYROLL_LINE_REVIEW_NOT_REQUIRED' using errcode = '55000';
  end if;
  if v_line.reviewed_at is not null then
    raise exception 'PAYROLL_LINE_ALREADY_REVIEWED' using errcode = '55000';
  end if;
  if v_batch.status <> 'draft' then
    raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '55000';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_lines l set review_note = v_note, reviewed_by = p_actor_id, reviewed_at = now()
   where l.id = v_line.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
  values (p_actor_id, 'PAYROLL_LINE_REVIEWED', 'payroll_line', v_line.id::text,
    jsonb_build_object('batchId', v_batch.id, 'period', v_batch.period, 'staffId', v_line.staff_id,
      'flags', to_jsonb(v_line.review_flags), 'ba', v_line.ba, 'pa', v_line.pa, 'pb', v_line.pb,
      'net', v_line.net), v_note);
  return 'reviewed';
end $$;
revoke all on function public.review_payroll_line(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.review_payroll_line(uuid, text, uuid) to service_role;

-- Re-created from 0006. Only change: a LIVE approval's audit event carries the recorded basis
-- of Q1 (governingBasis: source, evidenceStatus, decisionOption) as it stood at approval.
create or replace function public.approve_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_approval', 'update');
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Replay: the same approver's decision stands even after the batch was closed.
  if v.status in ('approved','closed') and v.decided_by = p_actor_id then return 'approved'; end if;
  -- The governing gate is re-checked at call time for live payroll, not trusted from submission.
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'PAYROLL_BATCH_NOT_SUBMITTED' using errcode = '55000'; end if;
  if v.submitted_by = p_actor_id then raise exception 'PAYROLL_SELF_APPROVAL' using errcode = '42501'; end if;
  if v.mode = 'live' and not private.payroll_batch_policies_ok(v.id) then
    raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'approved', decided_by = p_actor_id, decided_at = now()
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_APPROVED' else 'PAYROLL_BATCH_APPROVED' end,
    'payroll_batch', v.id::text,
    jsonb_build_object('status', 'submitted', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'approved', 'period', v.period, 'mode', v.mode)
      || case when v.mode = 'simulation'
              then jsonb_build_object('simulation', true, 'simulationTotalNet', v.simulation_total_net)
              else jsonb_build_object('totalNet', v.total_net,
                                      'governingBasis', private.q1_governing_basis()) end);
  return 'approved';
end $$;
revoke all on function public.approve_payroll_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_payroll_batch(uuid, uuid) to service_role;

-- Re-created from 0005. Only change: the audit event carries governingBasis.
create or replace function public.record_payroll_disbursement(
  p_line_id uuid, p_amount text, p_method text, p_bank_reference text, p_paid_on date, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_line public.payroll_lines%rowtype; v_batch public.payroll_batches%rowtype; v_id uuid;
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
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
  return v_id;
end $$;
revoke all on function public.record_payroll_disbursement(uuid, text, text, text, date, uuid) from public, anon, authenticated;
grant execute on function public.record_payroll_disbursement(uuid, text, text, text, date, uuid) to service_role;

-- Policy segments for every rank in a month (read; finance.payroll view).
create or replace function public.payroll_policy_segments(p_period text, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'view');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  return jsonb_build_object('period', p_period,
    'transitionRuleApproved', private.compensation_policy_transition_rule_approved(),
    'ranks', jsonb_build_array(private.ist_compensation_policy_segments('SM', p_period),
                               private.ist_compensation_policy_segments('SSM', p_period),
                               private.ist_compensation_policy_segments('SVD', p_period)));
end $$;
revoke all on function public.payroll_policy_segments(text, uuid) from public, anon, authenticated;
grant execute on function public.payroll_policy_segments(text, uuid) to service_role;

-- Derived lifecycle of every policy on the Asia/Manila date (read).
create or replace function public.ist_compensation_policy_states(p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (private.has_permission_for_user(p_actor_id, 'finance.payroll_policy', 'view')
          or private.has_permission_for_user(p_actor_id, 'finance.payroll_policy_approval', 'view')
          or private.has_permission_for_user(p_actor_id, 'finance.payroll', 'view')) then
    raise exception 'MUTATION_FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'policyId', p.id, 'rank', p.rank, 'policyVersion', p.policy_version, 'status', p.status,
             'lifecycle', private.ist_compensation_policy_lifecycle(p.id, v_today),
             'lastFinalizedPeriod', (select max(b.period) from public.payroll_lines l
                                      join public.payroll_batches b on b.id = l.batch_id
                                     where l.policy_id = p.id and b.mode = 'live'
                                       and b.status in ('approved','closed')))
           order by p.rank, p.policy_version)
      from public.ist_compensation_policies p), '[]'::jsonb);
end $$;
revoke all on function public.ist_compensation_policy_states(uuid) from public, anon, authenticated;
grant execute on function public.ist_compensation_policy_states(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
