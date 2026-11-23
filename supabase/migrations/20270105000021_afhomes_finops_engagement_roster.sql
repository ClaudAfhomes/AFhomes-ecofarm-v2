-- AF Homes: Q15(d) - the IST payroll roster comes from APPROVED ENGAGEMENTS, not RBAC roles.
--
-- Owner decision (2026-11-19, recorded in docs/business-rules/OPEN_QUESTIONS.md Q15(d)):
-- payroll eligibility and rank are the staff member's approved IST engagement(s) during the
-- selected month. The application role and today's account status no longer decide who is on
-- a month's roster or at which rank, so a past month is reproducible after a promotion, a role
-- change or a deactivation.
--
-- What changes (private.ist_period_performance_rows only):
--   roster = every staff member with at least one APPROVED engagement whose window touches the
--            month; rank = the rank of the latest such engagement (windows never overlap, so it
--            is unique). Exactly one line per staff member per month: no double counting.
--   ENGAGEMENT_RANK_MISMATCH and the staff-level MISSING_ENGAGEMENT can no longer arise and are
--            no longer emitted. A seller with verified money but no approved engagement for the
--            month is not guessed onto the roster: the money stays visible in offRoster, and
--            per payment as MISSING_ENGAGEMENT / OUTSIDE_ENGAGEMENT_WINDOW.
--   Unchanged: more than one approved engagement in the month (e.g. a mid-month rank change)
--            still blocks ONLY that member's line with ENGAGEMENT_CHANGES_WITHIN_PERIOD - no
--            policy-transition rule is approved. Compensation policy stays effective-dated per
--            rank (payroll_policy_segments). Approved / closed batches are never recomputed.
--   The evidence hash keeps its v2 format, so a line whose engagement rank equals the rank the
--            role used to give keeps the same hash (a submitted batch is not invalidated).
-- Validation: pnpm test:db:local (section 89, "Q15(d) engagement roster" checks);
--   select position('staff_role_assignments' in prosrc) = 0 from pg_proc
--    where oid = 'private.ist_period_performance_rows(text,uuid)'::regprocedure;   -- t
-- Down: forward only. Re-create the function from 20270105000012's patched body to revert.
begin;

create or replace function private.ist_period_performance_rows(p_period text, p_staff_id uuid default null)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  with rs as (
    select r.id as rule_id, r.rule_version, private.ist_performance_rule_blocker(p_period) as rule_reason
      from (select 1) o left join private.ist_performance_rule_for(p_period) r on true
  ), b as (
    select to_date(p_period || '-01', 'YYYY-MM-DD') as m_start,
           (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date as m_end
  ), roster as (
    -- Q15(d): approved engagements touching the month decide membership and rank. No RBAC role,
    -- no current account status: history must not move when either changes later.
    select distinct on (g.staff_id) g.staff_id as r_staff_id, g.rank as r_rank
      from public.ist_engagements g cross join b
     where g.status = 'approved'
       and g.contract_start <= b.m_end and (g.contract_end is null or g.contract_end >= b.m_start)
       and (p_staff_id is null or g.staff_id = p_staff_id)
     order by g.staff_id, g.contract_start desc
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
           e.id as engagement_id, e.qp_ba_approved, e.qp_decision_reference, e.contract_start, e.contract_end, e.suspended_from,
           coalesce(agg.n, 0) as n, coalesce(agg.cash, 0) as cash, coalesce(agg.kpi, 0) as kpi,
           coalesce(agg.adj_approved, 0) as adj_approved, coalesce(agg.adj_proposed, 0) as adj_proposed,
           coalesce(agg.canon, '') as canon, coalesce(ec.canon, '') as e_canon,
           -- More than one approved engagement in the month (e.g. SM until the 15th, SSM from
           -- the 16th): no approved rule says how the month splits, so only this line is blocked.
           array(select distinct z from unnest(array[rs.rule_reason,
                    case when ec.n > 1 then 'ENGAGEMENT_CHANGES_WITHIN_PERIOD' end]
                  || coalesce(agg.reasons, '{}'::text[])) z where z is not null order by z) as blockers
      from roster cross join rs cross join b
      left join lateral (
        select g.id, g.rank, g.qp_ba_approved, g.qp_decision_reference, g.contract_start, g.contract_end, g.suspended_from
          from public.ist_engagements g
         where g.staff_id = roster.r_staff_id and g.status = 'approved'
           and g.contract_start <= b.m_end and (g.contract_end is null or g.contract_end >= b.m_start)
         order by g.contract_start desc limit 1) e on true
      left join lateral (
        select count(*)::int as n,
               string_agg(concat_ws('|', g.id, g.rank, to_char(g.contract_start, 'YYYY-MM-DD'),
                            coalesce(to_char(g.contract_end, 'YYYY-MM-DD'), ''),
                            coalesce(to_char(g.suspended_from, 'YYYY-MM-DD'), '')) || case when g.qp_ba_approved is null then '' else concat_ws('|','QP',g.qp_ba_approved::text,g.qp_decision_reference) end,
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
           'ruleId', line.rule_id, 'ruleVersion', line.rule_version, 'engagementId', line.engagement_id,
           'qpBaApproved', line.qp_ba_approved, 'qpDecisionReference', line.qp_decision_reference)
         order by line.r_rank, line.r_staff_id), '[]'::jsonb)
    from line
$$;
revoke all on function private.ist_period_performance_rows(text, uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
