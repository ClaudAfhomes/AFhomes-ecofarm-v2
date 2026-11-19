-- AF Homes: Financial Operations Phase 9 - IST engagements, performance rules, and the
-- traceable KPI / collection evidence behind live IST payroll.
--
-- WHY: live payroll had no authoritative source for an IST member's contract start, credited
-- sales production (KPI) or eligible verified collections. This migration builds the
-- governed foundation and INVENTS NO POLICY: no engagement and no performance rule is seeded,
-- so every figure below is BLOCKED (zero money) until both are approved through the RPCs.
-- NOT decided anywhere, therefore never assumed: the Closed Deal threshold, the attribution
-- basis, the count-date basis, assumed credit, and refund / adjustment treatment (Q13).
--
--   1. ist_engagements: one IST contract per staff member (rank SM | SSM | SVD - the same ids
--      as ist_compensation_policies; SVD = the vice_director role). contract_start,
--      contract_end, suspended_from, evidence_reference. draft -> pending_approval -> approved
--      (pending_approval -> draft on return). Approved windows never overlap per staff. An
--      approved row is immutable except setting contract_end and suspended_from, ONCE each.
--   2. ist_performance_rules: effective-dated, versioned, same lifecycle. A NULL rule column
--      means "that rule is not approved": attribution_basis, closed_deal_threshold_pct,
--      count_date_basis, adjustment_treatment are all required for approval; assumed_credit_rate NULL means
--      no assumed credit. Approved windows never overlap; the open window closes once.
--   Both tables: every write needs the transaction-local flag afhomes.ist_governed_write (set
--   only by the RPCs); private.ist_governed_guard re-checks lifecycle, evidence, placeholders,
--   separation of duties (prior_actor_ids: nobody who EVER drafted, edited or submitted a
--   record approves it) and the Q1 gate even with the flag on. DELETE / TRUNCATE refused.
--   RBAC (no new module keys): finance.payroll_policy create/update drafts and submits;
--   finance.payroll_policy_approval update approves, returns and ends. Reads: finance.payroll view.
--   3. private.ist_period_performance_evidence(period, staff): one row per VERIFIED payment
--      touching the period (posting_period or paid_on month = period). Only payments.status =
--      'verified' is ever read; recorded / rejected / voided money never appears.
--   4. public.ist_period_performance(period, actor) and
--      public.ist_staff_performance_evidence(period, staff, actor): per-staff figures + drill-down.
--
-- WHICH RULE COLUMN DRIVES WHICH NUMBER (all of it BLOCKED until a rule is approved):
--   count_date_basis          the period a payment counts in: 'verified_posting_period' ->
--                             payments.posting_period, dated by verified_at (Asia/Manila);
--                             'paid_on' -> the month and date of payments.paid_on. A payment is
--                             ELIGIBLE in exactly one period, so no month counts it twice.
--   attribution_basis         'seller_only': a payment belongs to the seller of record of its
--                             contract (card_sales.seller_staff_id, else
--                             reservation_agreements.seller_staff_id) - exactly one staff member.
--                             'team_genealogy': referral_relationships carries no validity
--                             window, so a historical team cannot be reconstructed: every row is
--                             UNDETERMINED / GENEALOGY_NOT_EFFECTIVE_DATED. No roll-up is built.
--   closed_deal_threshold_pct kpi (closed-deal TCP) = sum of contract price snapshots of the
--                             staff member's own contracts whose CLOSING payment is ELIGIBLE in
--                             the period. The closing payment is the one verified payment at
--                             which cumulative verified money on the contract, taken in
--                             verification order (verified_at, id), first reaches pct% of the
--                             contract price snapshot.
--   adjustment_treatment      'report_only' (the only value): approved and proposed
--                             payment_adjustments are reported beside the figures, never netted.
--   assumed_credit_rate       NULL or 0 -> assumed credit 0.00. A rate above 0 has no approved
--                             base to apply to, so it BLOCKS (ASSUMED_CREDIT_BASE_NOT_DEFINED).
--   collection = verifiedCash + assumedCredit; verifiedCash = sum of ELIGIBLE payment amounts.
--   contractStart / contractEnd / suspendedFrom come only from an APPROVED engagement.
-- CREDITED ONCE - what holds and what does not. Nothing is stored: the closing payment is
--   recomputed from the rule in force for the queried month. Under ONE rule shape a contract
--   has at most one closing payment and a later payment (of any date) never moves it. Two
--   things keep that true across time, neither of them a policy decision:
--   (a) RULE SUCCESSION: a rule is never approved when its closed_deal_threshold_pct,
--       count_date_basis, attribution_basis or adjustment_treatment differs from ANY other
--       approved rule (a different threshold or count date would credit a contract twice,
--       lose it, or count one receipt in two months). Refused with
--       PERFORMANCE_RULE_TRANSITION_RULE_NOT_APPROVED while governing key
--       PERFORMANCE_RULE_TRANSITION_RULE is pending (seeded pending here, never approved here),
--       and with PERFORMANCE_RULE_SUCCESSION_NOT_IMPLEMENTED even once it is approved: the
--       transition logic is built only against an approved rule. RPC and guard both refuse.
--   (b) FINALIZED PAYROLL: no approval, end date or suspension date may reach into a month
--       covered by an approved or closed LIVE payroll batch (..._IN_USE_BY_FINALIZED_PAYROLL):
--       a window may not START on or before the last finalized day, an end date may not fall
--       before it, a suspension may not fall on or before it.
--   NOT guaranteed (OPEN_QUESTIONS Q15): a verified payment can still be voided or re-linked,
--   which moves a contract's closing payment. evidenceHash changes whenever the evidence or the
--   staff-level inputs behind a figure change, so a consumer that stored it can detect that.
-- CONTRACT: a reservation and the sale it was finalized into are ONE contract (key = the sale
--   id, else the reservation id). Price = card_sales.cash_price_snapshot when a sale exists,
--   else reservation_agreements.total_price_snapshot; the live cash_price is never read. When a
--   sale and its reservation disagree on seller or price snapshot the contract is not guessed.
-- Eligibility: ELIGIBLE | INELIGIBLE | UNDETERMINED. Any UNDETERMINED row blocks its staff
--   member. Reason codes: RULE_NOT_APPROVED, RULE_CHANGES_WITHIN_PERIOD, RULE_INCOMPLETE,
--   GENEALOGY_NOT_EFFECTIVE_DATED, ASSUMED_CREDIT_BASE_NOT_DEFINED, NO_STAFF_SELLER,
--   IMPORTED_SALE_TREATMENT_NOT_APPROVED, COUNT_DATE_MISSING, OUTSIDE_COUNT_PERIOD,
--   CONTRACT_SNAPSHOT_MISMATCH, CONTRACT_PRICE_SNAPSHOT_MISSING,
--   MISSING_ENGAGEMENT, OUTSIDE_ENGAGEMENT_WINDOW, ENGAGEMENT_SUSPENDED. Staff-level blockers
--   add ENGAGEMENT_RANK_MISMATCH and ENGAGEMENT_CHANGES_WITHIN_PERIOD (more than one approved
--   engagement touches the month). NO_STAFF_SELLER rows belong to nobody on the roster: they
--   are reported per period as unattributed { count, total }, never dropped silently. Payments
--   with a staff seller outside the active IST roster are reported as offRoster { count, total }.
--   OUTSIDE_ENGAGEMENT_WINDOW is UNDETERMINED and blocks every figure for that staff member.
-- Lock order: pg_advisory_xact_lock('ist_governed:' || kind) -> the row FOR UPDATE. The lock
--   is taken BEFORE the idempotency replay lookup. The guard and the overlap triggers take the
--   same advisory lock. The engagement / rule RPCs only READ payroll batches. Live payroll
--   submit / approve: advisory 'ist_governed:engagement' -> advisory
--   'ist_governed:performance_rule' -> payroll_batches row FOR UPDATE, then each line is
--   recomputed and a missing or changed evidenceHash, or a member no longer CALCULABLE, is
--   refused. Nothing takes a batch row lock and then an ist_governed lock, and nothing takes
--   the two ist_governed locks in the other order. Payments are read, never locked (Q15).
-- Error codes, with PREFIX = IST_ENGAGEMENT or IST_PERFORMANCE_RULE: PREFIX_NOT_FOUND (P0002),
--   _INVALID (22023), _NOT_EDITABLE (55000), _NOT_PENDING (55000), _NOT_APPROVED (55000),
--   _SELF_APPROVAL (42501), _EVIDENCE_REQUIRED (22023), _APPROVAL_NOTE_REQUIRED (22023),
--   _RETURN_REASON_REQUIRED (22023), _END_NOTE_REQUIRED (22023), _END_DATE_INVALID (22023),
--   _DIRECT_WRITE_REFUSED (42501), _TRANSITION_INVALID (55000), _IMMUTABLE (55000),
--   _OVERLAP (23P01), _IDEMPOTENCY_CONFLICT (23505), _IN_USE_BY_FINALIZED_PAYROLL (55000).
--   Rules only: IST_PERFORMANCE_RULE_INCOMPLETE (55000), PERFORMANCE_RULE_TRANSITION_RULE_NOT_APPROVED (55000),
--   PERFORMANCE_RULE_SUCCESSION_NOT_IMPLEMENTED (0A000).
--   Live submit/approve: PAYROLL_EVIDENCE_CHANGED (55000).
--   service_role holds no INSERT / UPDATE / DELETE / TRUNCATE on either table; the guard also
--   requires the approver to hold finance.payroll_policy_approval update (MUTATION_FORBIDDEN).
--   Reused: MUTATION_FORBIDDEN, IST_PAYROLL_NOT_AUTHORIZED, PERIOD_INVALID.
-- Validation: pnpm test:db:local (section 89); supabase/security/rls_invariants.sql.
--   select count(*) from public.ist_engagements;        -- 0
--   select count(*) from public.ist_performance_rules;  -- 0
--   select status from public.governing_policy_decisions
--    where key = 'PERFORMANCE_RULE_TRANSITION_RULE';    -- pending
--   select count(*) from public.modules where key like 'finance.payroll%';  -- unchanged
-- Down: forward only. Never delete engagements, rules or audit events. To disable: revoke
--   execute on the public functions below.
begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.ist_engagements (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users(id) on delete restrict,
  rank text not null check (rank in ('SM','SSM','SVD')),
  contract_start date not null,
  contract_end date,
  suspended_from date,
  evidence_reference text not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved')),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff_users(id) on delete restrict,
  submitted_at timestamptz,
  returned_by uuid references public.staff_users(id) on delete restrict,
  returned_at timestamptz,
  return_reason text,
  approved_by uuid references public.staff_users(id) on delete restrict,
  approved_at timestamptz,
  approval_evidence_reference text,
  approval_note text,
  ended_by uuid references public.staff_users(id) on delete restrict,
  ended_at timestamptz,
  end_note text,
  prior_actor_ids uuid[] not null default '{}'::uuid[],
  idempotency_key text,
  idempotency_fingerprint text,
  constraint ist_engagements_window_check check (
    (contract_end is null or contract_end >= contract_start)
    and (suspended_from is null or (suspended_from >= contract_start
                                    and (contract_end is null or suspended_from <= contract_end)))
    and (suspended_from is null or status = 'approved')),
  constraint ist_engagements_evidence_reference_check check (length(btrim(evidence_reference)) between 10 and 500),
  constraint ist_engagements_approved_check check ((status = 'approved') = (approved_by is not null and approved_at is not null)),
  constraint ist_engagements_submitted_check check (
    status not in ('pending_approval','approved') or (submitted_by is not null and submitted_at is not null)),
  constraint ist_engagements_approval_evidence_check check (
    status <> 'approved' or (length(btrim(coalesce(approval_evidence_reference, ''))) between 10 and 500
                             and length(btrim(coalesce(approval_note, ''))) between 5 and 2000)),
  constraint ist_engagements_separation_check check (
    status <> 'approved' or (approved_by <> created_by and approved_by is distinct from submitted_by
                             and approved_by is distinct from updated_by and not (approved_by = any (prior_actor_ids)))),
  constraint ist_engagements_return_check check (
    (returned_by is null) = (returned_at is null)
    and (returned_by is null or length(btrim(coalesce(return_reason, ''))) between 5 and 2000)),
  constraint ist_engagements_end_check check (
    (ended_by is null) = (ended_at is null)
    and (ended_by is null or (status = 'approved' and length(btrim(coalesce(end_note, ''))) between 5 and 2000))),
  constraint ist_engagements_idempotency_check check (
    (idempotency_key is null or length(idempotency_key) between 1 and 100)
    and (idempotency_fingerprint is null or idempotency_key is not null))
);
comment on table public.ist_engagements is
  'IST contract per staff member: the only source of contract start / end / suspension for payroll and performance. Lifecycle draft -> pending_approval -> approved, written only by the engagement RPCs. Approved rows are immutable except setting contract_end and suspended_from once each.';
comment on column public.ist_engagements.rank is
  'IST position: SM = sales_manager, SSM = senior_sales_manager, SVD = vice_director role slug (the role is not renamed).';
comment on column public.ist_engagements.suspended_from is
  'First day of a suspension. No approved rule says how a suspension affects credit, so evidence dated on or after it is UNDETERMINED (ENGAGEMENT_SUSPENDED).';
comment on column public.ist_engagements.prior_actor_ids is
  'Everyone who EVER drafted, edited or submitted this record. Maintained only by the guard trigger; none of them may approve it.';
create unique index if not exists ist_engagements_idempotency
  on public.ist_engagements (created_by, idempotency_key) where idempotency_key is not null;
create index if not exists ist_engagements_staff_idx on public.ist_engagements (staff_id);
alter table public.ist_engagements enable row level security;
revoke all on public.ist_engagements from public, anon, authenticated;
revoke insert, update, truncate, delete on public.ist_engagements from service_role;

create table if not exists public.ist_performance_rules (
  id uuid primary key default gen_random_uuid(),
  rule_version integer not null check (rule_version > 0),
  effective_from date not null,
  effective_until date,
  attribution_basis text check (attribution_basis in ('seller_only','team_genealogy')),
  closed_deal_threshold_pct text,
  count_date_basis text check (count_date_basis in ('verified_posting_period','paid_on')),
  assumed_credit_rate text,
  adjustment_treatment text check (adjustment_treatment in ('report_only')),
  source_reference text not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved')),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff_users(id) on delete restrict,
  submitted_at timestamptz,
  returned_by uuid references public.staff_users(id) on delete restrict,
  returned_at timestamptz,
  return_reason text,
  approved_by uuid references public.staff_users(id) on delete restrict,
  approved_at timestamptz,
  approval_evidence_reference text,
  approval_note text,
  ended_by uuid references public.staff_users(id) on delete restrict,
  ended_at timestamptz,
  end_note text,
  prior_actor_ids uuid[] not null default '{}'::uuid[],
  idempotency_key text,
  idempotency_fingerprint text,
  constraint ist_performance_rules_window_check check (effective_until is null or effective_until >= effective_from),
  -- A percentage above 0 and at most 100, exact decimal text.
  constraint ist_performance_rules_threshold_check check (
    closed_deal_threshold_pct is null
    or case when closed_deal_threshold_pct ~ '^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$'
            then closed_deal_threshold_pct::numeric > 0 and closed_deal_threshold_pct::numeric <= 100 else false end),
  constraint ist_performance_rules_assumed_credit_check check (
    assumed_credit_rate is null or assumed_credit_rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'),
  constraint ist_performance_rules_source_reference_check check (length(btrim(source_reference)) between 10 and 500),
  constraint ist_performance_rules_approved_check check ((status = 'approved') = (approved_by is not null and approved_at is not null)),
  constraint ist_performance_rules_submitted_check check (
    status not in ('pending_approval','approved') or (submitted_by is not null and submitted_at is not null)),
  constraint ist_performance_rules_approval_evidence_check check (
    status <> 'approved' or (length(btrim(coalesce(approval_evidence_reference, ''))) between 10 and 500
                             and length(btrim(coalesce(approval_note, ''))) between 5 and 2000)),
  constraint ist_performance_rules_separation_check check (
    status <> 'approved' or (approved_by <> created_by and approved_by is distinct from submitted_by
                             and approved_by is distinct from updated_by and not (approved_by = any (prior_actor_ids)))),
  constraint ist_performance_rules_return_check check (
    (returned_by is null) = (returned_at is null)
    and (returned_by is null or length(btrim(coalesce(return_reason, ''))) between 5 and 2000)),
  constraint ist_performance_rules_end_check check (
    (ended_by is null) = (ended_at is null)
    and (ended_by is null or (status = 'approved' and effective_until is not null
                              and length(btrim(coalesce(end_note, ''))) between 5 and 2000))),
  constraint ist_performance_rules_idempotency_check check (
    (idempotency_key is null or length(idempotency_key) between 1 and 100)
    and (idempotency_fingerprint is null or idempotency_key is not null))
);
comment on table public.ist_performance_rules is
  'Effective-dated, versioned rules that turn verified payments into IST KPI and collection. A NULL rule column means that rule is NOT approved and blocks every figure. No row is seeded: nothing here is approved policy until a row is approved through the RPCs.';
comment on column public.ist_performance_rules.assumed_credit_rate is
  'NULL = no assumed credit approved (the default). A rate above 0 blocks until a base for it is approved.';
comment on column public.ist_performance_rules.adjustment_treatment is
  'report_only: payment adjustments are reported beside the figures, never netted (Q13 is pending).';
create unique index if not exists ist_performance_rules_version on public.ist_performance_rules (rule_version);
create unique index if not exists ist_performance_rules_idempotency
  on public.ist_performance_rules (created_by, idempotency_key) where idempotency_key is not null;
alter table public.ist_performance_rules enable row level security;
revoke all on public.ist_performance_rules from public, anon, authenticated;
revoke insert, update, truncate, delete on public.ist_performance_rules from service_role;

-- ---------------------------------------------------------------------------
-- 1b. Governing key for rule succession (seeded PENDING; nothing here approves it)
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  perform set_config('afhomes.governing_policy_write', 'on', true);
  insert into public.governing_policy_decisions (key, status, note)
  values ('PERFORMANCE_RULE_TRANSITION_RULE', 'pending',
          'Awaiting an approved rule for replacing an IST performance rule with one that has a different Closed Deal threshold, count-date basis, attribution basis or adjustment treatment (how contracts already credited, and receipts already counted, carry over). Until approved, such a rule cannot be approved.')
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data, reason)
    select null, 'GOVERNING_POLICY_KEY_SEEDED', 'governing_policy_decision', g.key, to_jsonb(g),
           'Seeded pending by migration 20270105000009; nothing approves it.'
      from public.governing_policy_decisions g where g.key = 'PERFORMANCE_RULE_TRANSITION_RULE';
  end if;
  perform set_config('afhomes.governing_policy_write', 'off', true);
end $$;

create or replace function private.performance_rule_transition_rule_approved() returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.governing_policy_decisions g
                  where g.key = 'PERFORMANCE_RULE_TRANSITION_RULE' and g.status = 'approved')
$$;
revoke all on function private.performance_rule_transition_rule_approved() from public, anon, authenticated, service_role;

-- Last day of the latest month covered by an approved or closed LIVE payroll batch, or NULL.
-- Global on purpose: a finalized month is finalized for the whole IST roster.
create or replace function private.ist_last_finalized_live_payroll_day() returns date
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select max((to_date(b.period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
    from public.payroll_batches b
   where b.mode = 'live' and b.status in ('approved','closed')
$$;
revoke all on function private.ist_last_finalized_live_payroll_day() from public, anon, authenticated, service_role;

-- Refuses a rule whose shape differs from any OTHER approved rule (see header, "RULE
-- SUCCESSION"). The threshold is compared as a number ('25' = '25.00'); NULL is a value.
create or replace function private.ist_performance_rule_succession_check(
  p_rule_id uuid, p_attribution text, p_threshold text, p_count_basis text, p_adjustment text
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  if exists (
    select 1 from public.ist_performance_rules x
     where x.status = 'approved' and x.id <> p_rule_id
       and (x.attribution_basis, x.closed_deal_threshold_pct::numeric, x.count_date_basis, x.adjustment_treatment)
           is distinct from (p_attribution, p_threshold::numeric, p_count_basis, p_adjustment)
  ) then
    if private.performance_rule_transition_rule_approved() then
      raise exception 'PERFORMANCE_RULE_SUCCESSION_NOT_IMPLEMENTED' using errcode = '0A000';
    end if;
    raise exception 'PERFORMANCE_RULE_TRANSITION_RULE_NOT_APPROVED' using errcode = '55000';
  end if;
end $$;
revoke all on function private.ist_performance_rule_succession_check(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Guards (shared by both tables; the flag is a GUC, so nothing below trusts it)
-- ---------------------------------------------------------------------------
-- tg_argv: [0] error-code prefix, [1] columns an APPROVED row may set once (comma list),
-- [2] extra identity columns that never change (comma list), [3] the window-start column.
create or replace function private.ist_governed_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_code constant text := tg_argv[0];
  v_once constant text[] := string_to_array(tg_argv[1], ',');
  v_ident constant text[] := array['id','created_by','created_at','idempotency_key','idempotency_fingerprint']
                             || string_to_array(tg_argv[2], ',');
  v_life constant text[] := array['status','submitted_by','submitted_at','returned_by','returned_at',
    'return_reason','approved_by','approved_at','approval_evidence_reference','approval_note',
    'updated_by','updated_at','prior_actor_ids'];
  v_end constant text[] := array['ended_by','ended_at','end_note','updated_at'];
  v_start_col constant text := tg_argv[3];
  jn jsonb; jo jsonb; c text; v_last date;
begin
  if tg_op = 'DELETE' then
    raise exception '%', v_code || '_IMMUTABLE' using errcode = '55000';
  end if;
  -- Durable separation-of-duties record: derived here, a caller-supplied value is ignored.
  if tg_op = 'INSERT' then
    new.prior_actor_ids := array[new.created_by];
  else
    new.prior_actor_ids := array(
      select distinct x from unnest(old.prior_actor_ids || array[old.created_by, old.submitted_by,
        old.updated_by, new.submitted_by, new.updated_by]) x where x is not null order by x);
  end if;
  jn := to_jsonb(new);
  if tg_op = 'UPDATE' then
    jo := to_jsonb(old);
    foreach c in array v_ident loop
      if (jn -> c) is distinct from (jo -> c) then
        raise exception '%', v_code || '_IMMUTABLE' using errcode = '55000';
      end if;
    end loop;
    -- An approved row is history: only its once-settable columns may be set, once.
    if old.status = 'approved' then
      if (jn - v_end - v_once) is distinct from (jo - v_end - v_once) then
        raise exception '%', v_code || '_IMMUTABLE' using errcode = '55000';
      end if;
      foreach c in array v_once loop
        if (jo -> c) <> 'null'::jsonb and (jn -> c) is distinct from (jo -> c) then
          raise exception '%', v_code || '_IMMUTABLE' using errcode = '55000';
        end if;
      end loop;
      -- Who ended it, when and why is recorded once. A later once-settable date (the second of
      -- end / suspension) may still be set, but never rewrites that record.
      if old.ended_by is not null
         and (new.ended_by is distinct from old.ended_by or new.ended_at is distinct from old.ended_at
              or new.end_note is distinct from old.end_note) then
        raise exception '%', v_code || '_IMMUTABLE' using errcode = '55000';
      end if;
    end if;
  end if;
  if current_setting('afhomes.ist_governed_write', true) is distinct from 'on' then
    raise exception '%', v_code || '_DIRECT_WRITE_REFUSED' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- A row is always born a draft: creating one never approves it.
    if new.status <> 'draft' or new.approved_by is not null or new.approved_at is not null
       or new.submitted_by is not null or new.submitted_at is not null
       or new.returned_by is not null or new.ended_by is not null or new.ended_at is not null then
      raise exception '%', v_code || '_TRANSITION_INVALID' using errcode = '55000';
    end if;
    return new;
  end if;

  if old.status = 'approved' then
    if new.ended_by is null or new.ended_at is null
       or length(btrim(coalesce(new.end_note, ''))) not between 5 and 2000 then
      raise exception '%', v_code || '_END_NOTE_REQUIRED' using errcode = '22023';
    end if;
    -- A finalized payroll month is never rewritten: an end date may not fall before the
    -- last finalized day, a suspension may not fall on or before it.
    v_last := private.ist_last_finalized_live_payroll_day();
    if v_last is not null then
      foreach c in array v_once loop
        if (jo -> c) = 'null'::jsonb and (jn -> c) <> 'null'::jsonb
           and ((jn ->> c)::date < v_last or (c = 'suspended_from' and (jn ->> c)::date = v_last)) then
          raise exception '%', v_code || '_IN_USE_BY_FINALIZED_PAYROLL' using errcode = '55000';
        end if;
      end loop;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if not ((old.status, new.status) in (('draft','draft'), ('draft','pending_approval'),
          ('pending_approval','draft'), ('pending_approval','approved'))) then
    raise exception '%', v_code || '_TRANSITION_INVALID' using errcode = '55000';
  end if;
  -- Content changes only on a draft that stays a draft; submit/return/approve change none.
  if not (old.status = 'draft' and new.status = 'draft') and (jn - v_life) is distinct from (jo - v_life) then
    raise exception '%', v_code || '_NOT_EDITABLE' using errcode = '55000';
  end if;
  if new.status = 'approved' then
    perform private.mutation_actor_role(new.approved_by, 'finance.payroll_policy_approval', 'update');
    if not private.ist_payroll_live_authorized() then
      raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
    end if;
    if length(btrim(coalesce(new.approval_evidence_reference, ''))) not between 10 and 500
       or private.is_placeholder_text(new.approval_evidence_reference) then
      raise exception '%', v_code || '_EVIDENCE_REQUIRED' using errcode = '22023';
    end if;
    if length(btrim(coalesce(new.approval_note, ''))) not between 5 and 2000
       or private.is_placeholder_text(new.approval_note) then
      raise exception '%', v_code || '_APPROVAL_NOTE_REQUIRED' using errcode = '22023';
    end if;
    if new.approved_by is null or new.approved_by = any (new.prior_actor_ids) then
      raise exception '%', v_code || '_SELF_APPROVAL' using errcode = '42501';
    end if;
    if tg_table_name = 'ist_engagements' and jn ->> 'staff_id' = new.approved_by::text then
      raise exception 'IST_ENGAGEMENT_SELF_APPROVAL' using errcode = '42501';
    end if;
    -- Same lock as the RPCs and the overlap triggers, so a direct write cannot race them.
    perform pg_advisory_xact_lock(hashtext('ist_governed:'
      || case tg_table_name when 'ist_engagements' then 'engagement' else 'performance_rule' end));
    -- A window that starts in a finalized payroll month would generate figures for history.
    v_last := private.ist_last_finalized_live_payroll_day();
    if v_last is not null and (jn ->> v_start_col)::date <= v_last then
      raise exception '%', v_code || '_IN_USE_BY_FINALIZED_PAYROLL' using errcode = '55000';
    end if;
    if tg_table_name = 'ist_performance_rules' then
      if jn ->> 'attribution_basis' is null or jn ->> 'closed_deal_threshold_pct' is null
         or jn ->> 'count_date_basis' is null or jn ->> 'adjustment_treatment' is null then
        raise exception 'IST_PERFORMANCE_RULE_INCOMPLETE' using errcode = '55000';
      end if;
      perform private.ist_performance_rule_succession_check(new.id, jn ->> 'attribution_basis',
        jn ->> 'closed_deal_threshold_pct', jn ->> 'count_date_basis', jn ->> 'adjustment_treatment');
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.ist_governed_guard() from public, anon, authenticated, service_role;

create or replace function private.ist_governed_truncate_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception '%', tg_argv[0] || '_IMMUTABLE' using errcode = '55000';
end $$;
revoke all on function private.ist_governed_truncate_guard() from public, anon, authenticated, service_role;

-- One approved engagement per staff member per day; one approved rule per day.
create or replace function private.ist_engagement_no_overlap() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status <> 'approved' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('ist_governed:engagement'));
  if exists (
    select 1 from public.ist_engagements e
     where e.id <> new.id and e.staff_id = new.staff_id and e.status = 'approved'
       and e.contract_start <= coalesce(new.contract_end, 'infinity'::date)
       and coalesce(e.contract_end, 'infinity'::date) >= new.contract_start
  ) then
    raise exception 'IST_ENGAGEMENT_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function private.ist_engagement_no_overlap() from public, anon, authenticated, service_role;

create or replace function private.ist_performance_rule_no_overlap() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status <> 'approved' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('ist_governed:performance_rule'));
  if exists (
    select 1 from public.ist_performance_rules r
     where r.id <> new.id and r.status = 'approved'
       and r.effective_from <= coalesce(new.effective_until, 'infinity'::date)
       and coalesce(r.effective_until, 'infinity'::date) >= new.effective_from
  ) then
    raise exception 'IST_PERFORMANCE_RULE_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function private.ist_performance_rule_no_overlap() from public, anon, authenticated, service_role;

drop trigger if exists ist_engagements_guard on public.ist_engagements;
create trigger ist_engagements_guard before insert or update or delete on public.ist_engagements
  for each row execute function private.ist_governed_guard('IST_ENGAGEMENT', 'contract_end,suspended_from', 'staff_id', 'contract_start');
drop trigger if exists ist_engagements_no_overlap on public.ist_engagements;
create trigger ist_engagements_no_overlap before insert or update on public.ist_engagements
  for each row execute function private.ist_engagement_no_overlap();
drop trigger if exists ist_engagements_no_truncate on public.ist_engagements;
create trigger ist_engagements_no_truncate before truncate on public.ist_engagements
  for each statement execute function private.ist_governed_truncate_guard('IST_ENGAGEMENT');

drop trigger if exists ist_performance_rules_guard on public.ist_performance_rules;
create trigger ist_performance_rules_guard before insert or update or delete on public.ist_performance_rules
  for each row execute function private.ist_governed_guard('IST_PERFORMANCE_RULE', 'effective_until', 'rule_version', 'effective_from');
drop trigger if exists ist_performance_rules_no_overlap on public.ist_performance_rules;
create trigger ist_performance_rules_no_overlap before insert or update on public.ist_performance_rules
  for each row execute function private.ist_performance_rule_no_overlap();
drop trigger if exists ist_performance_rules_no_truncate on public.ist_performance_rules;
create trigger ist_performance_rules_no_truncate before truncate on public.ist_performance_rules
  for each statement execute function private.ist_governed_truncate_guard('IST_PERFORMANCE_RULE');

-- ---------------------------------------------------------------------------
-- 3. Lifecycle RPCs
-- ---------------------------------------------------------------------------
-- Shared submit / return / approve for both tables. p_kind is mapped to a fixed table name
-- here (never taken from a caller). Lock order: advisory lock per kind -> row FOR UPDATE.
create or replace function private.ist_governed_transition(
  p_kind text, p_action text, p_id uuid, p_actor_id uuid, p_text text default null, p_reference text default null
) returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_table text; v_code text; v_entity text; v jsonb; v_last date;
  v_text text := btrim(coalesce(p_text, '')); v_ref text := btrim(coalesce(p_reference, ''));
  v_strip constant text[] := array['prior_actor_ids','idempotency_key','idempotency_fingerprint'];
begin
  if p_kind = 'engagement' then
    v_table := 'ist_engagements'; v_code := 'IST_ENGAGEMENT'; v_entity := 'ist_engagement';
  elsif p_kind = 'performance_rule' then
    v_table := 'ist_performance_rules'; v_code := 'IST_PERFORMANCE_RULE'; v_entity := 'ist_performance_rule';
  else
    raise exception 'IST_GOVERNED_KIND_INVALID' using errcode = '22023';
  end if;
  if p_action not in ('submit','return','approve') then
    raise exception 'IST_GOVERNED_ACTION_INVALID' using errcode = '22023';
  end if;
  perform private.mutation_actor_role(p_actor_id,
    case when p_action = 'submit' then 'finance.payroll_policy' else 'finance.payroll_policy_approval' end, 'update');
  if p_action = 'return' and length(v_text) not between 5 and 2000 then
    raise exception '%', v_code || '_RETURN_REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    if length(v_ref) not between 10 and 500 or private.is_placeholder_text(v_ref) then
      raise exception '%', v_code || '_EVIDENCE_REQUIRED' using errcode = '22023';
    end if;
    if length(v_text) not between 5 and 2000 or private.is_placeholder_text(v_text) then
      raise exception '%', v_code || '_APPROVAL_NOTE_REQUIRED' using errcode = '22023';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('ist_governed:' || p_kind));
  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table) into v using p_id;
  if v is null then raise exception '%', v_code || '_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_action = 'submit' then
    if v ->> 'status' = 'pending_approval' and v ->> 'submitted_by' = p_actor_id::text then
      return 'pending_approval';  -- replay
    end if;
    if v ->> 'status' <> 'draft' then
      raise exception '%', v_code || '_NOT_EDITABLE' using errcode = '55000';
    end if;
    perform set_config('afhomes.ist_governed_write', 'on', true);
    execute format('update public.%I t set status = ''pending_approval'', submitted_by = $2, submitted_at = now() where t.id = $1', v_table)
      using p_id, p_actor_id;
    perform set_config('afhomes.ist_governed_write', 'off', true);
    insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor_id, v_code || '_SUBMITTED', v_entity, p_id::text, jsonb_build_object('status', 'draft'),
      (v - v_strip) || jsonb_build_object('status', 'pending_approval'));
    return 'pending_approval';
  end if;

  if p_action = 'return' then
    if v ->> 'status' = 'draft' and v ->> 'returned_by' = p_actor_id::text and v ->> 'return_reason' = v_text then
      return 'draft';  -- replay
    end if;
    if v ->> 'status' <> 'pending_approval' then
      raise exception '%', v_code || '_NOT_PENDING' using errcode = '55000';
    end if;
    perform set_config('afhomes.ist_governed_write', 'on', true);
    execute format('update public.%I t set status = ''draft'', submitted_by = null, submitted_at = null, '
                   || 'returned_by = $2, returned_at = now(), return_reason = $3 where t.id = $1', v_table)
      using p_id, p_actor_id, v_text;
    perform set_config('afhomes.ist_governed_write', 'off', true);
    insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
    values (p_actor_id, v_code || '_RETURNED', v_entity, p_id::text,
      jsonb_build_object('status', 'pending_approval', 'submittedBy', v -> 'submitted_by'),
      jsonb_build_object('status', 'draft'), v_text);
    return 'draft';
  end if;

  -- approve
  if v ->> 'status' = 'approved' and v ->> 'approved_by' = p_actor_id::text then return 'approved'; end if;  -- replay
  if v ->> 'status' <> 'pending_approval' then
    raise exception '%', v_code || '_NOT_PENDING' using errcode = '55000';
  end if;
  -- Re-checked at call time: nothing feeding payable payroll is approved without the governing model.
  if not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if (v -> 'prior_actor_ids') ? p_actor_id::text
     or (p_kind = 'engagement' and v ->> 'staff_id' = p_actor_id::text)
     or p_actor_id::text in (v ->> 'created_by', coalesce(v ->> 'submitted_by', ''), coalesce(v ->> 'updated_by', '')) then
    raise exception '%', v_code || '_SELF_APPROVAL' using errcode = '42501';
  end if;
  -- A window that starts in a finalized payroll month would generate figures for history.
  v_last := private.ist_last_finalized_live_payroll_day();
  if v_last is not null
     and (v ->> case when p_kind = 'engagement' then 'contract_start' else 'effective_from' end)::date <= v_last then
    raise exception '%', v_code || '_IN_USE_BY_FINALIZED_PAYROLL' using errcode = '55000';
  end if;
  -- Rule succession (the guard repeats both checks).
  if p_kind = 'performance_rule' then
    if v ->> 'attribution_basis' is null or v ->> 'closed_deal_threshold_pct' is null
       or v ->> 'count_date_basis' is null or v ->> 'adjustment_treatment' is null then
      raise exception 'IST_PERFORMANCE_RULE_INCOMPLETE' using errcode = '55000';
    end if;
    perform private.ist_performance_rule_succession_check(p_id, v ->> 'attribution_basis',
      v ->> 'closed_deal_threshold_pct', v ->> 'count_date_basis', v ->> 'adjustment_treatment');
  end if;
  perform set_config('afhomes.ist_governed_write', 'on', true);
  execute format('update public.%I t set status = ''approved'', approved_by = $2, approved_at = now(), '
                 || 'approval_evidence_reference = $3, approval_note = $4 where t.id = $1', v_table)
    using p_id, p_actor_id, v_ref, v_text;
  perform set_config('afhomes.ist_governed_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, v_code || '_APPROVED', v_entity, p_id::text,
    jsonb_build_object('status', 'pending_approval', 'createdBy', v -> 'created_by', 'submittedBy', v -> 'submitted_by'),
    (v - v_strip) || jsonb_build_object('status', 'approved', 'evidenceReference', v_ref,
      'priorActorIds', v -> 'prior_actor_ids', 'governingBasis', private.q1_governing_basis()), v_text);
  return 'approved';
end $$;
revoke all on function private.ist_governed_transition(text, text, uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- Create (p_engagement_id null; finance.payroll_policy create) or edit a DRAFT (update).
-- p_fields: staffId, rank, contractStart, contractEnd (optional), evidenceReference.
-- An edit replaces every field. Create is idempotent per (actor, key) for the same payload.
create or replace function public.save_ist_engagement_draft(
  p_engagement_id uuid, p_fields jsonb, p_actor_id uuid, p_idempotency_key text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_allowed constant text[] := array['staffId','rank','contractStart','contractEnd','evidenceReference'];
  v_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_old public.ist_engagements%rowtype;
  v_id uuid; k text; v_fp text; v_old_fp text; v_start date; v_end date; v_staff uuid; v_ref text;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy',
    case when p_engagement_id is null then 'create' else 'update' end);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'fields must be an object';
  end if;
  if v_key is not null and length(v_key) > 100 then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'idempotency key too long';
  end if;
  -- Lock first: two concurrent creates with one key must serialize BEFORE the replay lookup,
  -- or the loser would fail on the unique index instead of replaying.
  perform pg_advisory_xact_lock(hashtext('ist_governed:engagement'));
  -- Replay is decided before validation; the same key with another payload is refused.
  if p_engagement_id is null and v_key is not null then
    v_fp := encode(sha256(convert_to(jsonb_strip_nulls(p_fields)::text, 'UTF8')), 'hex');
    select e.id, e.idempotency_fingerprint into v_id, v_old_fp from public.ist_engagements e
     where e.created_by = p_actor_id and e.idempotency_key = v_key;
    if v_id is not null then
      if v_old_fp is distinct from v_fp then
        raise exception 'IST_ENGAGEMENT_IDEMPOTENCY_CONFLICT' using errcode = '23505';
      end if;
      return v_id;
    end if;
  end if;

  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any (v_allowed)) then
      raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = format('unknown field %s', k);
    end if;
  end loop;
  if jsonb_typeof(p_fields -> 'staffId') is distinct from 'string' or (p_fields ->> 'staffId') !~ v_uuid then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'staffId must be a uuid';
  end if;
  v_staff := (p_fields ->> 'staffId')::uuid;
  if not exists (select 1 from public.staff_users su where su.id = v_staff) then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'unknown staff member';
  end if;
  if (p_fields ->> 'rank') is null or (p_fields ->> 'rank') not in ('SM','SSM','SVD') then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'rank must be SM, SSM or SVD';
  end if;
  if jsonb_typeof(p_fields -> 'contractStart') is distinct from 'string' or (p_fields ->> 'contractStart') !~ v_date
     or (coalesce(jsonb_typeof(p_fields -> 'contractEnd'), 'null') <> 'null'
         and (jsonb_typeof(p_fields -> 'contractEnd') <> 'string' or (p_fields ->> 'contractEnd') !~ v_date)) then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'dates must be YYYY-MM-DD';
  end if;
  begin
    v_start := (p_fields ->> 'contractStart')::date;
    v_end := (p_fields ->> 'contractEnd')::date;
  exception when others then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'dates must be real calendar dates';
  end;
  if v_end is not null and v_end < v_start then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'contractEnd is before contractStart';
  end if;
  v_ref := btrim(coalesce(p_fields ->> 'evidenceReference', ''));
  if jsonb_typeof(p_fields -> 'evidenceReference') is distinct from 'string'
     or length(v_ref) not between 10 and 500 or private.is_placeholder_text(v_ref) then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023',
      detail = 'evidenceReference must be 10 to 500 characters and not a placeholder';
  end if;

  perform set_config('afhomes.ist_governed_write', 'on', true);
  if p_engagement_id is null then
    insert into public.ist_engagements
      (staff_id, rank, contract_start, contract_end, evidence_reference, created_by, idempotency_key, idempotency_fingerprint)
    values (v_staff, p_fields ->> 'rank', v_start, v_end, v_ref, p_actor_id, v_key, v_fp)
    returning id into v_id;
    perform set_config('afhomes.ist_governed_write', 'off', true);
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (p_actor_id, 'IST_ENGAGEMENT_DRAFT_CREATED', 'ist_engagement', v_id::text,
      jsonb_build_object('status', 'draft', 'staffId', v_staff, 'rank', p_fields ->> 'rank',
        'contractStart', v_start, 'contractEnd', v_end, 'evidenceReference', v_ref));
    return v_id;
  end if;

  select e.* into v_old from public.ist_engagements e where e.id = p_engagement_id for update;
  if not found then raise exception 'IST_ENGAGEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old.status <> 'draft' then
    raise exception 'IST_ENGAGEMENT_NOT_EDITABLE' using errcode = '55000';
  end if;
  if v_staff <> v_old.staff_id then
    raise exception 'IST_ENGAGEMENT_INVALID' using errcode = '22023', detail = 'staffId cannot change; create a new draft';
  end if;
  if (p_fields ->> 'rank', v_start, v_end, v_ref)
     is not distinct from (v_old.rank, v_old.contract_start, v_old.contract_end, v_old.evidence_reference) then
    perform set_config('afhomes.ist_governed_write', 'off', true);
    return v_old.id;  -- nothing changed: no write, no event
  end if;
  update public.ist_engagements e
     set rank = p_fields ->> 'rank', contract_start = v_start, contract_end = v_end,
         evidence_reference = v_ref, updated_by = p_actor_id
   where e.id = v_old.id;
  perform set_config('afhomes.ist_governed_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'IST_ENGAGEMENT_DRAFT_UPDATED', 'ist_engagement', v_old.id::text,
    jsonb_build_object('rank', v_old.rank, 'contractStart', v_old.contract_start, 'contractEnd', v_old.contract_end,
      'evidenceReference', v_old.evidence_reference),
    jsonb_build_object('rank', p_fields ->> 'rank', 'contractStart', v_start, 'contractEnd', v_end,
      'evidenceReference', v_ref));
  return v_old.id;
end $$;
revoke all on function public.save_ist_engagement_draft(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_ist_engagement_draft(uuid, jsonb, uuid, text) to service_role;

create or replace function public.submit_ist_engagement(p_engagement_id uuid, p_actor_id uuid)
returns text language sql security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select private.ist_governed_transition('engagement', 'submit', p_engagement_id, p_actor_id)
$$;
create or replace function public.return_ist_engagement(p_engagement_id uuid, p_reason text, p_actor_id uuid)
returns text language sql security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select private.ist_governed_transition('engagement', 'return', p_engagement_id, p_actor_id, p_reason)
$$;
create or replace function public.approve_ist_engagement(
  p_engagement_id uuid, p_evidence_reference text, p_note text, p_actor_id uuid
) returns text language sql security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select private.ist_governed_transition('engagement', 'approve', p_engagement_id, p_actor_id, p_note, p_evidence_reference)
$$;
revoke all on function public.submit_ist_engagement(uuid, uuid) from public, anon, authenticated;
revoke all on function public.return_ist_engagement(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.approve_ist_engagement(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_ist_engagement(uuid, uuid) to service_role;
grant execute on function public.return_ist_engagement(uuid, text, uuid) to service_role;
grant execute on function public.approve_ist_engagement(uuid, text, text, uuid) to service_role;

-- Set an approved engagement's end date and/or suspension date. Each is set ONCE; pass NULL
-- for the one that is not being set.
create or replace function public.end_ist_engagement(
  p_engagement_id uuid, p_contract_end date, p_suspended_from date, p_note text, p_actor_id uuid
) returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.ist_engagements%rowtype; v_note text := btrim(coalesce(p_note, '')); v_end date; v_susp date; v_last date;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy_approval', 'update');
  if length(v_note) not between 5 and 2000 then
    raise exception 'IST_ENGAGEMENT_END_NOTE_REQUIRED' using errcode = '22023';
  end if;
  if p_contract_end is null and p_suspended_from is null then
    raise exception 'IST_ENGAGEMENT_END_DATE_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ist_governed:engagement'));
  select e.* into v from public.ist_engagements e where e.id = p_engagement_id for update;
  if not found then raise exception 'IST_ENGAGEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.ended_by = p_actor_id and coalesce(p_contract_end, v.contract_end) is not distinct from v.contract_end
     and coalesce(p_suspended_from, v.suspended_from) is not distinct from v.suspended_from then
    return 'ended';  -- replay
  end if;
  if v.status <> 'approved' then
    raise exception 'IST_ENGAGEMENT_NOT_APPROVED' using errcode = '55000';
  end if;
  if v.ended_by is not null and v.ended_by <> p_actor_id then
    raise exception 'IST_ENGAGEMENT_IMMUTABLE' using errcode = '55000';
  end if;
  if (p_contract_end is not null and v.contract_end is not null and p_contract_end <> v.contract_end)
     or (p_suspended_from is not null and v.suspended_from is not null and p_suspended_from <> v.suspended_from) then
    raise exception 'IST_ENGAGEMENT_IMMUTABLE' using errcode = '55000';
  end if;
  v_end := coalesce(v.contract_end, p_contract_end);
  v_susp := coalesce(v.suspended_from, p_suspended_from);
  if v_end < v.contract_start or v_susp < v.contract_start or v_susp > v_end then
    raise exception 'IST_ENGAGEMENT_END_DATE_INVALID' using errcode = '22023';
  end if;
  -- A finalized payroll month is never rewritten (the guard repeats this): an end date may
  -- not fall before the last finalized day, a suspension may not fall on or before it.
  v_last := private.ist_last_finalized_live_payroll_day();
  if v_last is not null
     and ((v.contract_end is null and p_contract_end is not null and p_contract_end < v_last)
          or (v.suspended_from is null and p_suspended_from is not null and p_suspended_from <= v_last)) then
    raise exception 'IST_ENGAGEMENT_IN_USE_BY_FINALIZED_PAYROLL' using errcode = '55000';
  end if;
  perform set_config('afhomes.ist_governed_write', 'on', true);
  update public.ist_engagements e
     set contract_end = v_end, suspended_from = v_susp,
         -- Recorded once (the guard enforces it). When the second date is set later, its note
         -- lives in the audit event below.
         ended_by = coalesce(v.ended_by, p_actor_id), ended_at = coalesce(v.ended_at, now()),
         end_note = coalesce(v.end_note, v_note)
   where e.id = v.id;
  perform set_config('afhomes.ist_governed_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'IST_ENGAGEMENT_ENDED', 'ist_engagement', v.id::text,
    jsonb_build_object('contractEnd', v.contract_end, 'suspendedFrom', v.suspended_from),
    jsonb_build_object('contractEnd', v_end, 'suspendedFrom', v_susp, 'staffId', v.staff_id, 'rank', v.rank), v_note);
  return 'ended';
end $$;
revoke all on function public.end_ist_engagement(uuid, date, date, text, uuid) from public, anon, authenticated;
grant execute on function public.end_ist_engagement(uuid, date, date, text, uuid) to service_role;

-- Create (p_rule_id null) or edit a DRAFT rule. p_fields: effectiveFrom, effectiveUntil,
-- attributionBasis, closedDealThresholdPct, countDateBasis, assumedCreditRate,
-- adjustmentTreatment (each optional: null / absent = that rule is not approved), sourceReference.
create or replace function public.save_ist_performance_rule_draft(
  p_rule_id uuid, p_fields jsonb, p_actor_id uuid, p_idempotency_key text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  v_allowed constant text[] := array['effectiveFrom','effectiveUntil','attributionBasis','closedDealThresholdPct',
    'countDateBasis','assumedCreditRate','adjustmentTreatment','sourceReference'];
  v_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_old public.ist_performance_rules%rowtype;
  v_id uuid; k text; v_fp text; v_old_fp text; v_from date; v_until date; v_ref text;
  v_attr text; v_pct text; v_basis text; v_rate text; v_adj text; v_version integer;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy',
    case when p_rule_id is null then 'create' else 'update' end);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'fields must be an object';
  end if;
  if v_key is not null and length(v_key) > 100 then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'idempotency key too long';
  end if;
  -- Lock first, then the replay lookup (see save_ist_engagement_draft).
  perform pg_advisory_xact_lock(hashtext('ist_governed:performance_rule'));
  if p_rule_id is null and v_key is not null then
    v_fp := encode(sha256(convert_to(jsonb_strip_nulls(p_fields)::text, 'UTF8')), 'hex');
    select r.id, r.idempotency_fingerprint into v_id, v_old_fp from public.ist_performance_rules r
     where r.created_by = p_actor_id and r.idempotency_key = v_key;
    if v_id is not null then
      if v_old_fp is distinct from v_fp then
        raise exception 'IST_PERFORMANCE_RULE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
      end if;
      return v_id;
    end if;
  end if;

  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any (v_allowed)) then
      raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = format('unknown field %s', k);
    end if;
  end loop;
  foreach k in array array['attributionBasis','closedDealThresholdPct','countDateBasis','assumedCreditRate','adjustmentTreatment'] loop
    if coalesce(jsonb_typeof(p_fields -> k), 'null') not in ('null','string') then
      raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = format('%s must be text or null', k);
    end if;
  end loop;
  v_attr := p_fields ->> 'attributionBasis';
  v_pct := p_fields ->> 'closedDealThresholdPct';
  v_basis := p_fields ->> 'countDateBasis';
  v_rate := p_fields ->> 'assumedCreditRate';
  v_adj := p_fields ->> 'adjustmentTreatment';
  if v_attr is not null and v_attr not in ('seller_only','team_genealogy') then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'attributionBasis must be seller_only or team_genealogy';
  end if;
  if v_basis is not null and v_basis not in ('verified_posting_period','paid_on') then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'countDateBasis must be verified_posting_period or paid_on';
  end if;
  if v_adj is not null and v_adj <> 'report_only' then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'adjustmentTreatment must be report_only';
  end if;
  if v_pct is not null then
    if v_pct !~ '^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$' then
      raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'closedDealThresholdPct must be a percentage above 0 and at most 100';
    end if;
    if v_pct::numeric <= 0 or v_pct::numeric > 100 then
      raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'closedDealThresholdPct must be a percentage above 0 and at most 100';
    end if;
  end if;
  if v_rate is not null and v_rate !~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$' then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'assumedCreditRate must be a rate between 0 and 1';
  end if;
  if jsonb_typeof(p_fields -> 'effectiveFrom') is distinct from 'string' or (p_fields ->> 'effectiveFrom') !~ v_date
     or (coalesce(jsonb_typeof(p_fields -> 'effectiveUntil'), 'null') <> 'null'
         and (jsonb_typeof(p_fields -> 'effectiveUntil') <> 'string' or (p_fields ->> 'effectiveUntil') !~ v_date)) then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'dates must be YYYY-MM-DD';
  end if;
  begin
    v_from := (p_fields ->> 'effectiveFrom')::date;
    v_until := (p_fields ->> 'effectiveUntil')::date;
  exception when others then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'dates must be real calendar dates';
  end;
  if v_until is not null and v_until < v_from then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023', detail = 'effectiveUntil is before effectiveFrom';
  end if;
  v_ref := btrim(coalesce(p_fields ->> 'sourceReference', ''));
  if jsonb_typeof(p_fields -> 'sourceReference') is distinct from 'string'
     or length(v_ref) not between 10 and 500 or private.is_placeholder_text(v_ref) then
    raise exception 'IST_PERFORMANCE_RULE_INVALID' using errcode = '22023',
      detail = 'sourceReference must be 10 to 500 characters and not a placeholder';
  end if;

  perform set_config('afhomes.ist_governed_write', 'on', true);
  if p_rule_id is null then
    select coalesce(max(r.rule_version), 0) + 1 into v_version from public.ist_performance_rules r;
    insert into public.ist_performance_rules
      (rule_version, effective_from, effective_until, attribution_basis, closed_deal_threshold_pct, count_date_basis,
       assumed_credit_rate, adjustment_treatment, source_reference, created_by, idempotency_key, idempotency_fingerprint)
    values (v_version, v_from, v_until, v_attr, v_pct, v_basis, v_rate, v_adj, v_ref, p_actor_id, v_key, v_fp)
    returning id into v_id;
    perform set_config('afhomes.ist_governed_write', 'off', true);
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (p_actor_id, 'IST_PERFORMANCE_RULE_DRAFT_CREATED', 'ist_performance_rule', v_id::text,
      jsonb_build_object('status', 'draft', 'ruleVersion', v_version, 'effectiveFrom', v_from, 'effectiveUntil', v_until,
        'attributionBasis', v_attr, 'closedDealThresholdPct', v_pct, 'countDateBasis', v_basis,
        'assumedCreditRate', v_rate, 'adjustmentTreatment', v_adj, 'sourceReference', v_ref));
    return v_id;
  end if;

  select r.* into v_old from public.ist_performance_rules r where r.id = p_rule_id for update;
  if not found then raise exception 'IST_PERFORMANCE_RULE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old.status <> 'draft' then
    raise exception 'IST_PERFORMANCE_RULE_NOT_EDITABLE' using errcode = '55000';
  end if;
  if (v_from, v_until, v_attr, v_pct, v_basis, v_rate, v_adj, v_ref)
     is not distinct from (v_old.effective_from, v_old.effective_until, v_old.attribution_basis,
       v_old.closed_deal_threshold_pct, v_old.count_date_basis, v_old.assumed_credit_rate,
       v_old.adjustment_treatment, v_old.source_reference) then
    perform set_config('afhomes.ist_governed_write', 'off', true);
    return v_old.id;  -- nothing changed: no write, no event
  end if;
  update public.ist_performance_rules r
     set effective_from = v_from, effective_until = v_until, attribution_basis = v_attr,
         closed_deal_threshold_pct = v_pct, count_date_basis = v_basis, assumed_credit_rate = v_rate,
         adjustment_treatment = v_adj, source_reference = v_ref, updated_by = p_actor_id
   where r.id = v_old.id;
  perform set_config('afhomes.ist_governed_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'IST_PERFORMANCE_RULE_DRAFT_UPDATED', 'ist_performance_rule', v_old.id::text,
    jsonb_build_object('effectiveFrom', v_old.effective_from, 'effectiveUntil', v_old.effective_until,
      'attributionBasis', v_old.attribution_basis, 'closedDealThresholdPct', v_old.closed_deal_threshold_pct,
      'countDateBasis', v_old.count_date_basis, 'assumedCreditRate', v_old.assumed_credit_rate,
      'adjustmentTreatment', v_old.adjustment_treatment, 'sourceReference', v_old.source_reference),
    jsonb_build_object('effectiveFrom', v_from, 'effectiveUntil', v_until, 'attributionBasis', v_attr,
      'closedDealThresholdPct', v_pct, 'countDateBasis', v_basis, 'assumedCreditRate', v_rate,
      'adjustmentTreatment', v_adj, 'sourceReference', v_ref));
  return v_old.id;
end $$;
revoke all on function public.save_ist_performance_rule_draft(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_ist_performance_rule_draft(uuid, jsonb, uuid, text) to service_role;

create or replace function public.submit_ist_performance_rule(p_rule_id uuid, p_actor_id uuid)
returns text language sql security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select private.ist_governed_transition('performance_rule', 'submit', p_rule_id, p_actor_id)
$$;
create or replace function public.return_ist_performance_rule(p_rule_id uuid, p_reason text, p_actor_id uuid)
returns text language sql security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select private.ist_governed_transition('performance_rule', 'return', p_rule_id, p_actor_id, p_reason)
$$;
-- Approval never supersedes anything: an overlapping approved window is refused
-- (IST_PERFORMANCE_RULE_OVERLAP); end the old rule first.
create or replace function public.approve_ist_performance_rule(
  p_rule_id uuid, p_evidence_reference text, p_note text, p_actor_id uuid
) returns text language sql security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select private.ist_governed_transition('performance_rule', 'approve', p_rule_id, p_actor_id, p_note, p_evidence_reference)
$$;
revoke all on function public.submit_ist_performance_rule(uuid, uuid) from public, anon, authenticated;
revoke all on function public.return_ist_performance_rule(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.approve_ist_performance_rule(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_ist_performance_rule(uuid, uuid) to service_role;
grant execute on function public.return_ist_performance_rule(uuid, text, uuid) to service_role;
grant execute on function public.approve_ist_performance_rule(uuid, text, text, uuid) to service_role;

-- Close an approved rule's OPEN window once.
create or replace function public.end_ist_performance_rule(
  p_rule_id uuid, p_effective_until date, p_note text, p_actor_id uuid
) returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.ist_performance_rules%rowtype; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_policy_approval', 'update');
  if length(v_note) not between 5 and 2000 then
    raise exception 'IST_PERFORMANCE_RULE_END_NOTE_REQUIRED' using errcode = '22023';
  end if;
  if p_effective_until is null then
    raise exception 'IST_PERFORMANCE_RULE_END_DATE_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ist_governed:performance_rule'));
  select r.* into v from public.ist_performance_rules r where r.id = p_rule_id for update;
  if not found then raise exception 'IST_PERFORMANCE_RULE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.ended_by = p_actor_id and v.effective_until = p_effective_until then return 'ended'; end if;  -- replay
  if v.status <> 'approved' then
    raise exception 'IST_PERFORMANCE_RULE_NOT_APPROVED' using errcode = '55000';
  end if;
  if v.effective_until is not null then
    raise exception 'IST_PERFORMANCE_RULE_IMMUTABLE' using errcode = '55000';
  end if;
  if p_effective_until < v.effective_from then
    raise exception 'IST_PERFORMANCE_RULE_END_DATE_INVALID' using errcode = '22023';
  end if;
  -- A window is never cut inside a finalized payroll month (the guard repeats this).
  if p_effective_until < private.ist_last_finalized_live_payroll_day() then
    raise exception 'IST_PERFORMANCE_RULE_IN_USE_BY_FINALIZED_PAYROLL' using errcode = '55000';
  end if;
  perform set_config('afhomes.ist_governed_write', 'on', true);
  update public.ist_performance_rules r
     set effective_until = p_effective_until, ended_by = p_actor_id, ended_at = now(), end_note = v_note
   where r.id = v.id;
  perform set_config('afhomes.ist_governed_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor_id, 'IST_PERFORMANCE_RULE_ENDED', 'ist_performance_rule', v.id::text,
    jsonb_build_object('effectiveUntil', null),
    jsonb_build_object('effectiveUntil', p_effective_until, 'ruleVersion', v.rule_version), v_note);
  return 'ended';
end $$;
revoke all on function public.end_ist_performance_rule(uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function public.end_ist_performance_rule(uuid, date, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Evidence and figures (read only)
-- ---------------------------------------------------------------------------
-- The one approved rule in force for the WHOLE month, or no row.
create or replace function private.ist_performance_rule_for(p_period text)
returns setof public.ist_performance_rules
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select r.* from public.ist_performance_rules r
   where r.status = 'approved'
     and r.effective_from <= to_date(p_period || '-01', 'YYYY-MM-DD')
     and (r.effective_until is null
          or r.effective_until >= (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
$$;
revoke all on function private.ist_performance_rule_for(text) from public, anon, authenticated, service_role;

-- Why no figure can be derived for the month, or NULL when the rule is usable.
create or replace function private.ist_performance_rule_blocker(p_period text) returns text
language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select case
    when r.id is null then
      case when exists (
             select 1 from public.ist_performance_rules x
              where x.status = 'approved'
                and x.effective_from <= (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
                and coalesce(x.effective_until, 'infinity'::date) >= to_date(p_period || '-01', 'YYYY-MM-DD'))
           then 'RULE_CHANGES_WITHIN_PERIOD' else 'RULE_NOT_APPROVED' end
    when r.attribution_basis is null or r.closed_deal_threshold_pct is null
         or r.count_date_basis is null or r.adjustment_treatment is null then 'RULE_INCOMPLETE'
    when r.attribution_basis = 'team_genealogy' then 'GENEALOGY_NOT_EFFECTIVE_DATED'
    when coalesce(r.assumed_credit_rate, '0')::numeric > 0 then 'ASSUMED_CREDIT_BASE_NOT_DEFINED'
  end
  from (select 1) o left join private.ist_performance_rule_for(p_period) r on true
$$;
revoke all on function private.ist_performance_rule_blocker(text) from public, anon, authenticated, service_role;

-- One row per VERIFIED payment touching the period. staff_id is the seller of record.
-- Scans verified payments only; cumulative figures use every verified payment of the contract.
create or replace function private.ist_period_performance_evidence(p_period text, p_staff_id uuid default null)
returns table (
  staff_id uuid, period text, sale_id uuid, reservation_id uuid, payment_id uuid, amount text,
  posting_period text, paid_on date, verified_at timestamptz, payment_purpose text, seller_staff_id uuid,
  contract_price_snapshot text, cumulative_verified_at_period_end text,
  evidence_class text, eligibility text, reason_code text,
  count_period text, count_date date, is_closing_payment boolean, closed_deal_threshold_amount text,
  approved_adjustments_total text, proposed_adjustments_total text, assumed_credit text,
  rule_id uuid, engagement_id uuid
) language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  with rs as (
    select r.id as rule_id, r.count_date_basis, r.closed_deal_threshold_pct,
           private.ist_performance_rule_blocker(p_period) as rule_reason
      from (select 1) o left join private.ist_performance_rule_for(p_period) r on true
  ), pay as (
    select p.id as payment_id, p.sale_id as pay_sale_id, p.reservation_id as pay_reservation_id,
           p.amount as pay_amount, p.posting_period as pay_posting_period, p.paid_on as pay_paid_on,
           p.verified_at as pay_verified_at, p.payment_purpose as pay_purpose,
           -- One contract: the sale when there is one (a reservation finalized into a sale keeps
           -- the sale's key, so its reservation-stage money accumulates with the sale's).
           s.id as contract_sale_id,
           coalesce(s.id, p.reservation_id) as contract_key,
           coalesce(s.seller_staff_id, sr.seller_staff_id, ra.seller_staff_id) as seller_id,
           -- Frozen snapshots only; the live card_sales.cash_price is never read.
           case when s.id is not null then s.cash_price_snapshot else ra.total_price_snapshot end as contract_price,
           s.origin as sale_origin, ra.origin as reservation_origin,
           -- The sale and the reservation it came from must agree on seller and price.
           (s.id is not null and sr.id is not null
            and ((sr.seller_staff_id is not null and sr.seller_staff_id is distinct from s.seller_staff_id)
                 or (s.cash_price_snapshot is not null
                     and sr.total_price_snapshot::numeric <> s.cash_price_snapshot::numeric))) as snapshot_mismatch,
           -- With no approved basis the accounting month (posting_period) is shown; nothing is eligible then.
           case when rs.count_date_basis = 'paid_on' then to_char(p.paid_on, 'YYYY-MM') else p.posting_period end as c_period,
           case when rs.count_date_basis = 'paid_on' then p.paid_on
                else (p.verified_at at time zone 'Asia/Manila')::date end as c_date
      from public.payments p
      left join public.reservation_agreements ra on ra.id = p.reservation_id
      left join public.card_sales s on s.id = coalesce(p.sale_id, ra.sale_id)
      left join public.reservation_agreements sr on sr.sale_id = s.id  -- unique per sale
     cross join rs
     where p.status = 'verified'
  ), w as (
    select pay.*,
           sum(pay.pay_amount::numeric) over (partition by pay.contract_key
                                              order by pay.pay_verified_at, pay.payment_id) as cum_verified,
           sum(pay.pay_amount::numeric) filter (where pay.c_period <= p_period)
             over (partition by pay.contract_key) as cum_period_end
      from pay
  ), x as (
    select w.*, rs.rule_id, rs.rule_reason,
           -- No threshold (so no closing payment) when the contract price is missing or disputed.
           case when rs.rule_reason is null and w.contract_price is not null and not w.snapshot_mismatch
                then w.contract_price::numeric * rs.closed_deal_threshold_pct::numeric / 100 end as threshold_amount,
           e.id as engagement_id, e.suspended_from as e_suspended_from,
           exists (select 1 from public.ist_engagements a
                    where a.staff_id = w.seller_id and a.status = 'approved') as has_engagement,
           coalesce((select sum(pa.amount::numeric) from public.payment_adjustments pa
                      where pa.payment_id = w.payment_id and pa.status = 'approved'), 0) as adj_approved,
           coalesce((select sum(pa.amount::numeric) from public.payment_adjustments pa
                      where pa.payment_id = w.payment_id and pa.status = 'proposed'), 0) as adj_proposed
      from w cross join rs
      left join lateral (
        select g.id, g.suspended_from from public.ist_engagements g
         where g.staff_id = w.seller_id and g.status = 'approved'
           and g.contract_start <= w.c_date and (g.contract_end is null or g.contract_end >= w.c_date)
         limit 1) e on true
     where (w.pay_posting_period = p_period or to_char(w.pay_paid_on, 'YYYY-MM') = p_period)
       and (p_staff_id is null or w.seller_id = p_staff_id)
  ), y as (
    select x.*,
           case
             when x.rule_reason is not null then x.rule_reason
             when x.seller_id is null then 'NO_STAFF_SELLER'
             -- An imported sale, or (no sale yet) a reservation that is not application-origin.
             when x.sale_origin = 'legacy_import'
                  or (x.contract_sale_id is null and x.reservation_origin is distinct from 'application')
               then 'IMPORTED_SALE_TREATMENT_NOT_APPROVED'
             when x.c_period is null or x.c_date is null then 'COUNT_DATE_MISSING'
             when x.c_period <> p_period then 'OUTSIDE_COUNT_PERIOD'
             when x.snapshot_mismatch then 'CONTRACT_SNAPSHOT_MISMATCH'
             when x.contract_price is null then 'CONTRACT_PRICE_SNAPSHOT_MISSING'
             when not x.has_engagement then 'MISSING_ENGAGEMENT'
             when x.engagement_id is null then 'OUTSIDE_ENGAGEMENT_WINDOW'
             when x.e_suspended_from is not null and x.e_suspended_from <= x.c_date then 'ENGAGEMENT_SUSPENDED'
           end as reason
      from x
  )
  select y.seller_id, p_period, y.contract_sale_id, y.pay_reservation_id, y.payment_id, y.pay_amount,
         y.pay_posting_period, y.pay_paid_on, y.pay_verified_at, y.pay_purpose, y.seller_id,
         y.contract_price, private.money(coalesce(y.cum_period_end, 0)),
         'VERIFIED_CASH'::text,
         case when y.reason is null then 'ELIGIBLE'
              when y.reason in ('NO_STAFF_SELLER','OUTSIDE_COUNT_PERIOD') then 'INELIGIBLE'
              else 'UNDETERMINED' end,
         y.reason,
         y.c_period, y.c_date,
         coalesce(y.threshold_amount is not null and y.cum_verified >= y.threshold_amount
                  and y.cum_verified - y.pay_amount::numeric < y.threshold_amount, false),
         private.money(y.threshold_amount),
         private.money(y.adj_approved), private.money(y.adj_proposed),
         '0.00'::text,  -- assumed credit: no approved base exists, so it is never above zero
         y.rule_id, y.engagement_id
    from y
$$;
revoke all on function private.ist_period_performance_evidence(text, uuid) from public, anon, authenticated, service_role;

-- Per-staff figures for the roster (active staff whose active role is SM / SSM / SVD).
create or replace function private.ist_period_performance_rows(p_period text, p_staff_id uuid default null)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  with rs as (
    select r.id as rule_id, r.rule_version, private.ist_performance_rule_blocker(p_period) as rule_reason
      from (select 1) o left join private.ist_performance_rule_for(p_period) r on true
  ), b as (
    select to_date(p_period || '-01', 'YYYY-MM-DD') as m_start,
           (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date as m_end
  ), roster as (
    select distinct on (su.id) su.id as r_staff_id,
           case ro.slug when 'sales_manager' then 'SM' when 'senior_sales_manager' then 'SSM' else 'SVD' end as r_rank
      from public.staff_users su
      join public.staff_role_assignments sra on sra.staff_id = su.id
      join public.roles ro on ro.id = sra.role_id and ro.is_active
     where su.status = 'active' and ro.slug in ('sales_manager','senior_sales_manager','vice_director')
       and (p_staff_id is null or su.id = p_staff_id)
     order by su.id, case ro.slug when 'vice_director' then 3 when 'senior_sales_manager' then 2 else 1 end desc
  ), agg as (
    select ev.staff_id as a_staff_id, count(*)::int as n,
           coalesce(sum(ev.amount::numeric) filter (where ev.eligibility = 'ELIGIBLE'), 0) as cash,
           coalesce(sum(ev.contract_price_snapshot::numeric)
                      filter (where ev.eligibility = 'ELIGIBLE' and ev.is_closing_payment), 0) as kpi,
           coalesce(sum(ev.approved_adjustments_total::numeric), 0) as adj_approved,
           coalesce(sum(ev.proposed_adjustments_total::numeric), 0) as adj_proposed,
           array_agg(distinct ev.reason_code) filter (where ev.eligibility = 'UNDETERMINED') as reasons,
           -- No timestamps in the hash: it must not depend on the session time zone.
           string_agg(concat_ws('|', ev.payment_id, ev.amount, coalesce(ev.count_period, ''),
                        coalesce(to_char(ev.count_date, 'YYYY-MM-DD'), ''), ev.eligibility,
                        coalesce(ev.reason_code, ''), ev.is_closing_payment, coalesce(ev.contract_price_snapshot, ''),
                        -- Approved adjustments only: a proposal is not money and must not
                        -- invalidate an approved line.
                        ev.approved_adjustments_total,
                        coalesce(ev.rule_id::text, ''), coalesce(ev.engagement_id::text, '')),
                      E'\n' order by ev.payment_id) as canon
      from private.ist_period_performance_evidence(p_period, p_staff_id) ev
     where ev.staff_id is not null
     group by ev.staff_id
  ), l0 as (
    select roster.r_staff_id, roster.r_rank, rs.rule_id, rs.rule_version,
           e.id as engagement_id, e.contract_start, e.contract_end, e.suspended_from,
           coalesce(agg.n, 0) as n, coalesce(agg.cash, 0) as cash, coalesce(agg.kpi, 0) as kpi,
           coalesce(agg.adj_approved, 0) as adj_approved, coalesce(agg.adj_proposed, 0) as adj_proposed,
           coalesce(agg.canon, '') as canon, coalesce(ec.canon, '') as e_canon,
           -- More than one approved engagement in the month (e.g. SM until the 15th, SSM from
           -- the 16th): no approved rule says how the month splits, so it is blocked.
           array(select distinct z from unnest(array[rs.rule_reason,
                    case when e.id is null then 'MISSING_ENGAGEMENT' end,
                    case when e.rank <> roster.r_rank then 'ENGAGEMENT_RANK_MISMATCH' end,
                    case when ec.n > 1 then 'ENGAGEMENT_CHANGES_WITHIN_PERIOD' end]
                  || coalesce(agg.reasons, '{}'::text[])) z where z is not null order by z) as blockers
      from roster cross join rs cross join b
      left join lateral (
        select g.id, g.rank, g.contract_start, g.contract_end, g.suspended_from from public.ist_engagements g
         where g.staff_id = roster.r_staff_id and g.status = 'approved'
           and g.contract_start <= b.m_end and (g.contract_end is null or g.contract_end >= b.m_start)
         order by g.contract_start desc limit 1) e on true
      left join lateral (
        select count(*)::int as n,
               string_agg(concat_ws('|', g.id, g.rank, to_char(g.contract_start, 'YYYY-MM-DD'),
                            coalesce(to_char(g.contract_end, 'YYYY-MM-DD'), ''),
                            coalesce(to_char(g.suspended_from, 'YYYY-MM-DD'), '')),
                          ';' order by g.contract_start, g.id) as canon
          from public.ist_engagements g
         where g.staff_id = roster.r_staff_id and g.status = 'approved'
           and g.contract_start <= b.m_end and (g.contract_end is null or g.contract_end >= b.m_start)) ec on true
      left join agg on agg.a_staff_id = roster.r_staff_id
  ), line as (
    -- The hash covers the staff-level inputs too (member, rank, every engagement touching the
    -- month, rule, blockers), so it differs between members and changes when any of them does.
    select l0.*,
           encode(sha256(convert_to(
             'v2' || E'\n' || concat_ws('|', p_period, l0.r_staff_id, l0.r_rank, l0.e_canon,
                                        coalesce(l0.rule_id::text, ''), coalesce(l0.rule_version::text, ''),
                                        array_to_string(l0.blockers, ','))
                  || E'\n' || l0.canon, 'UTF8')), 'hex') as evidence_hash
      from l0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId', line.r_staff_id, 'rank', line.r_rank,
           'contractStart', line.contract_start, 'contractEnd', line.contract_end, 'suspendedFrom', line.suspended_from,
           -- A blocked line carries no money: every figure is zero until its blockers are cleared.
           'kpi', private.money(case when cardinality(line.blockers) = 0 then line.kpi else 0 end),
           'collection', private.money(case when cardinality(line.blockers) = 0 then line.cash else 0 end),
           'verifiedCash', private.money(case when cardinality(line.blockers) = 0 then line.cash else 0 end),
           'assumedCredit', '0.00',
           'approvedAdjustmentsTotal', private.money(line.adj_approved),
           'proposedAdjustmentsTotal', private.money(line.adj_proposed),
           'status', case when cardinality(line.blockers) = 0 then 'CALCULABLE' else 'BLOCKED' end,
           'blockers', to_jsonb(line.blockers),
           'evidenceHash', line.evidence_hash, 'evidenceCount', line.n,
           'ruleId', line.rule_id, 'ruleVersion', line.rule_version, 'engagementId', line.engagement_id)
         order by line.r_rank, line.r_staff_id), '[]'::jsonb)
    from line
$$;
revoke all on function private.ist_period_performance_rows(text, uuid) from public, anon, authenticated, service_role;

-- { period, ruleId, ruleVersion, ruleBlocker, unattributed: { count, total }, staff: [ { staffId,
--   rank, contractStart, contractEnd, suspendedFrom, kpi, collection, verifiedCash, assumedCredit,
--   approvedAdjustmentsTotal, proposedAdjustmentsTotal, status, blockers[], evidenceHash,
--   evidenceCount, ruleId, ruleVersion, engagementId } ] }
-- unattributed: verified payments counting in this period whose contract has no staff seller of
-- record (NO_STAFF_SELLER). They are in nobody's figures; the count and total are shown so the
-- gap between the roster and the period's verified money is never silent.
create or replace function public.ist_period_performance(p_period text, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_rows jsonb;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'view');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  v_rows := private.ist_period_performance_rows(p_period);  -- computed once
  return jsonb_build_object('period', p_period,
    'ruleId', (select r.id from private.ist_performance_rule_for(p_period) r),
    'ruleVersion', (select r.rule_version from private.ist_performance_rule_for(p_period) r),
    'ruleBlocker', private.ist_performance_rule_blocker(p_period),
    'unattributed', (
      select jsonb_build_object('count', count(*)::int,
                                'total', private.money(coalesce(sum(ev.amount::numeric), 0)))
        from private.ist_period_performance_evidence(p_period) ev
       where ev.staff_id is null and ev.count_period = p_period),
    'offRoster', (
      with roster as materialized (
        select r ->> 'staffId' as staff_id from jsonb_array_elements(v_rows) r)
      select jsonb_build_object('count', count(*)::int,
                                'total', private.money(coalesce(sum(ev.amount::numeric), 0)))
        from private.ist_period_performance_evidence(p_period) ev
       where ev.staff_id is not null and ev.count_period = p_period
         and not exists (select 1 from roster ro where ro.staff_id = ev.staff_id::text)),
    'staff', v_rows);
end $$;
revoke all on function public.ist_period_performance(text, uuid) from public, anon, authenticated;
grant execute on function public.ist_period_performance(text, uuid) to service_role;

-- Drill-down: { period, staffId, summary (the staff entry above, null when not on the roster),
--   items: [ one object per evidence row ] }.
create or replace function public.ist_staff_performance_evidence(p_period text, p_staff_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'view');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'PERIOD_INVALID' using errcode = '22023';
  end if;
  if p_staff_id is null then
    raise exception 'STAFF_REQUIRED' using errcode = '22023';
  end if;
  return jsonb_build_object('period', p_period, 'staffId', p_staff_id,
    'summary', private.ist_period_performance_rows(p_period, p_staff_id) -> 0,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'staffId', ev.staff_id, 'period', ev.period, 'saleId', ev.sale_id, 'reservationId', ev.reservation_id,
               'paymentId', ev.payment_id, 'amount', ev.amount, 'postingPeriod', ev.posting_period,
               'paidOn', ev.paid_on, 'verifiedAt', ev.verified_at, 'paymentPurpose', ev.payment_purpose,
               'sellerStaffId', ev.seller_staff_id, 'contractPriceSnapshot', ev.contract_price_snapshot,
               'cumulativeVerifiedAtPeriodEnd', ev.cumulative_verified_at_period_end,
               'evidenceClass', ev.evidence_class, 'eligibility', ev.eligibility, 'reasonCode', ev.reason_code,
               'countPeriod', ev.count_period, 'countDate', ev.count_date,
               'isClosingPayment', ev.is_closing_payment, 'closedDealThresholdAmount', ev.closed_deal_threshold_amount,
               'approvedAdjustmentsTotal', ev.approved_adjustments_total,
               'proposedAdjustmentsTotal', ev.proposed_adjustments_total, 'assumedCredit', ev.assumed_credit,
               'ruleId', ev.rule_id, 'engagementId', ev.engagement_id)
             order by ev.count_date, ev.payment_id)
        from private.ist_period_performance_evidence(p_period, p_staff_id) ev), '[]'::jsonb));
end $$;
revoke all on function public.ist_staff_performance_evidence(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ist_staff_performance_evidence(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Live payroll re-checks its performance evidence at submit AND at approve
-- ---------------------------------------------------------------------------
-- A live line remains payable only while its authoritative evidence still matches: the line
-- carries inputs.evidenceHash, its staff member is on the roster and CALCULABLE for the batch
-- period now, and the recomputed evidenceHash equals the stored one. Anything else refuses
-- with p_code (PAYROLL_EVIDENCE_CHANGED at submit / approve). The caller holds both
-- ist_governed advisory locks.
create or replace function private.payroll_batch_evidence_check(
  p_batch_id uuid, p_period text, p_code text default 'PAYROLL_EVIDENCE_CHANGED'
) returns void language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v_line record; v_current jsonb;
begin
  for v_line in select l.staff_id, l.inputs from public.payroll_lines l where l.batch_id = p_batch_id loop
    v_current := private.ist_period_performance_rows(p_period, v_line.staff_id) -> 0;
    if v_current is null or v_current ->> 'status' is distinct from 'CALCULABLE'
       or nullif(v_line.inputs ->> 'evidenceHash', '') is null
       or v_current ->> 'evidenceHash' is distinct from v_line.inputs ->> 'evidenceHash' then
      raise exception '%', p_code using errcode = '55000';
    end if;
  end loop;
end $$;
revoke all on function private.payroll_batch_evidence_check(uuid, text, text) from public, anon, authenticated, service_role;

-- Re-created from 0006 (submit) and 0008 (approve). Only changes, LIVE batches only: the two
-- advisory locks and the evidence re-check. Simulations take no new lock and no new check.
create or replace function public.submit_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll', 'update');
  -- Live only: the engagement / rule locks, BEFORE the batch row (mode never changes after
  -- creation, so it is read unlocked). Order: engagement -> performance_rule -> batch row.
  if exists (select 1 from public.payroll_batches b where b.id = p_batch_id and b.mode = 'live') then
    perform pg_advisory_xact_lock(hashtext('ist_governed:engagement'));
    perform pg_advisory_xact_lock(hashtext('ist_governed:performance_rule'));
  end if;
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'submitted' and v.submitted_by = p_actor_id then return v.status; end if;
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '55000'; end if;
  if v.line_count = 0 then raise exception 'PAYROLL_BATCH_EMPTY' using errcode = '55000'; end if;
  if v.mode = 'live' then
    if v.blocked_line_count > 0
       or exists (select 1 from public.payroll_lines l where l.batch_id = v.id and l.status = 'blocked')
       or not private.payroll_batch_policies_ok(v.id) then
      raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
    end if;
    perform private.payroll_batch_evidence_check(v.id, v.period);
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b
     set status = 'submitted', submitted_by = p_actor_id, submitted_at = now(), return_reason = null
   where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_SUBMITTED' else 'PAYROLL_BATCH_SUBMITTED' end,
    'payroll_batch', v.id::text, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'submitted', 'period', v.period, 'mode', v.mode, 'lineCount', v.line_count)
      || case when v.mode = 'simulation'
              then jsonb_build_object('simulation', true, 'simulationTotalNet', v.simulation_total_net)
              else jsonb_build_object('totalNet', v.total_net) end);
  return 'submitted';
end $$;
revoke all on function public.submit_payroll_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_payroll_batch(uuid, uuid) to service_role;

create or replace function public.approve_payroll_batch(p_batch_id uuid, p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare v public.payroll_batches%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'finance.payroll_approval', 'update');
  -- Live only: the engagement / rule locks, BEFORE the batch row (mode never changes after
  -- creation, so it is read unlocked). Order: engagement -> performance_rule -> batch row.
  if exists (select 1 from public.payroll_batches b where b.id = p_batch_id and b.mode = 'live') then
    perform pg_advisory_xact_lock(hashtext('ist_governed:engagement'));
    perform pg_advisory_xact_lock(hashtext('ist_governed:performance_rule'));
  end if;
  select * into v from public.payroll_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status in ('approved','closed') and v.decided_by = p_actor_id then return 'approved'; end if;
  if v.mode = 'live' and not private.ist_payroll_live_authorized() then
    raise exception 'IST_PAYROLL_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'PAYROLL_BATCH_NOT_SUBMITTED' using errcode = '55000'; end if;
  if v.submitted_by = p_actor_id then raise exception 'PAYROLL_SELF_APPROVAL' using errcode = '42501'; end if;
  if v.mode = 'live' then
    if not private.payroll_batch_policies_ok(v.id) then
      raise exception 'PAYROLL_CONFIGURATION_REQUIRED' using errcode = '55000';
    end if;
    perform private.payroll_batch_evidence_check(v.id, v.period);
  end if;
  perform set_config('afhomes.payroll_write', 'on', true);
  update public.payroll_batches b set status = 'approved', decided_by = p_actor_id, decided_at = now() where b.id = v.id;
  perform set_config('afhomes.payroll_write', 'off', true);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id,
    case when v.mode = 'simulation' then 'PAYROLL_SIMULATION_APPROVED' else 'PAYROLL_BATCH_APPROVED' end,
    'payroll_batch', v.id::text, jsonb_build_object('status', 'submitted', 'submittedBy', v.submitted_by),
    jsonb_build_object('status', 'approved', 'period', v.period, 'mode', v.mode)
      || case when v.mode = 'simulation'
              then jsonb_build_object('simulation', true, 'simulationTotalNet', v.simulation_total_net)
              else jsonb_build_object('totalNet', v.total_net, 'governingBasis', private.q1_governing_basis()) end);
  return 'approved';
end $$;
revoke all on function public.approve_payroll_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_payroll_batch(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
