# Implementation Roadmap

- Created: 2026-10-14 (Phase 2C). Planning only — no behavior changed, no architecture decided.
- Rule: never block unambiguous work on account of unrelated blocked work. Groups below are independent lanes; within a lane, dependencies (from the gap matrix) order the work.
- Data-model notes are investigation prompts, not designs. Migration implications flagged per item; no migration written in this phase.

## Lane 1 — Ready to implement after Q1/Q3 decisions (principle match exists; needs ruling, then build)

These have working v2 machinery underneath. Each item states the decision needed, then the build. No build starts before its decision.

- DONE Phase 5: S2 no-number-on-invalid (BR-RATE-06) — needed no ruling (pure issuance-ordering + DB-unique duplicates, no payroll semantics). sales.ts reorder + 3rd conformance test; 226 affected-suite tests + tsc green; sales.ts prettier warning verified pre-existing (HEAD also warns — left untouched).

### W1 — Qualification gate (BR-QLF-01/02/03/04; MISMATCH on 02)
- Rules: BR-QLF-01, 02, 03, 04. Decision needed: Q3 (are v2 cards the workbook VIP product? which gate?).
- User-facing: sales show qualification state + frozen date; refunds visibly strip it.
- Backend: per-sale qualification evaluation on approve/verify events; frozen-date column; strip-on-refund transition; prospective-only threshold edits.
- Data: new qualification columns on sales (investigate: extend `card_sales` vs new table — decision point, not design); threshold config source.
- Roles: clerk posts, supervisor-equivalent approves, Director-equivalent edits thresholds (v2 permission mapping to be confirmed).
- Calculations: per-sale cumulative ≥ threshold × TCP; MIN qualifying receipt date; strip predicate (refund OR status ∉ {blank, ACTIVE}).
- Audit: date-set/strip events with actor + old→new; threshold edits logged.
- Reuse/modify: `verify_card_payment`, `sale_financial_summary`, `summarizePayments`, snapshot discipline.
- Migration implications: backfill qualification for historical sales under Q2 cutover ruling — blocked until Q2.
- Tests: auto-qualification.spec, threshold-gate.spec, refund-strip.spec, prospectivity.spec (see TEST-PLAN).
- Acceptance: workbook examples reproduce (VIP 15% pending / 30% qualified; refund strips + date clears; threshold raise leaves frozen dates).
- Source gap genuinely preventing completion: Q3 (gate values/applicability) + Q2 (historical backfill).

### W2 — Rate governance (BR-AUTH-01/02, BR-RATE-01/03; PARTIALs)
- Rules: BR-AUTH-01/02, BR-RATE-01/03. Decision needed: Q1 (does v2 need a parameter console + PENDING-reapproval, or do current permission gates suffice?).
- User-facing: rate/threshold figures visible with shipped defaults; deviations listed on one screen; PENDING re-approval queue.
- Backend: parameter store with range checks + inflation-direction warning; per-person deviation flow returning records to PENDING; anniversary trigger (or explicit no-anniversary decision).
- Data: parameter + deviation + decision records (investigate: new tables vs config — decision point).
- Roles: Director-equivalent sets; supervisor-equivalent re-approves.
- Calculations: none (governance) except anniversary date arithmetic if adopted.
- Audit: every change + abandon-at-warning, old→new, actor.
- Reuse: `commission_rules` effective windows; `authorizeAfHomes`; `audit_events`.
- Migration implications: none for console; deviation history starts empty.
- Tests: parameter-console.spec, deviation-pending.spec, anniversary-rate.spec.
- Acceptance: RV-23 behaviors observable (refuse unauthorized, warn on inflation, log abandon).
- Gap: Q1 scope decision; Q7 VIP DSC default for any DSC work (currently no DSC in v2 — likely deferred).

### W3 — Approval + close discipline (BR-CTL-01/03/06, BR-OPS-02/05; PARTIALs)
- Rules: BR-CTL-01/03/06, BR-OPS-02/05. Decision needed: Q1 (adopt workbook approval/close semantics or certify v2 verify/idempotency/audit as sufficient?).
- User-facing: approval stamps with account+time; locked-row indicators; period-close action with unapproved-receipt warning; audit trail view.
- Backend: approval transition with stamp; row-lock enforcement; close routine refusing repeats; six-column-compatible log export (or certified mapping to `audit_events`).
- Data: stamp/lock/close-state columns (investigate against existing status enums in `lifecycle.ts` — reuse first).
- Roles: existing v2 roles; no-self-approval chain where applicable.
- Calculations: none beyond state predicates.
- Audit: approve/unlock/close/override events with actor + old→new.
- Reuse: payment verify flow, idempotent activation, `audit_events`, `check:env`.
- Migration implications: none (forward-only states).
- Tests: approval-lock.spec, close-month.spec, six-column-log.spec, approval-chain.spec; run `audit-sanitize.spec.ts`, `role-baseline.spec.ts`, `pnpm check:env`.
- Acceptance: unapproved counts nothing; locked rows need privileged unlock; closed periods immutable; every privileged action logged.
- Gap: Q1 scope decision only.

### W4 — Genealogy completion (BR-GEN-04/05, BR-ACM-04; PARTIALs)
- Rules: BR-GEN-04/05, BR-ACM-04. Decision needed: Q1/Q3 (vacancy roll-up + assumed credit in v2? whole-tree aggregation vs single-level?).
- User-facing: successor views excluding pre-appointment production; chain-disagreement warnings.
- Backend: appointment-date filters; chain-agreement check (warn, never block); vacancy roll-up if adopted.
- Data: appointment dates on assignments (investigate: new columns on staff/assignment tables).
- Roles: automatic computation; Director confirms deliberate cross-team arrangements.
- Calculations: date-window filters; roll-up aggregation if adopted.
- Audit: appointment/departure events; confirmed-deliberate chain flags.
- Reuse: `correct_referral_upline`, `referral_relationships`, downline checks in `resolveSeller`.
- Migration implications: appointment-date backfill policy (Q2-adjacent).
- Tests: succession-filter.spec, team-aggregation.spec, credit-routing.spec, broken-chain.spec; run `phase7-genealogy-migration.spec.ts`, `referral-contexts.spec.ts`.
- Acceptance: RV-13/14/17 behaviors (successor excludes old; upline unchanged; double-cut pays nobody).
- Gap: Q1/Q3 scope decisions.

## Lane 2 — Ready after further technical inspection (behavior clear; investigate code paths first)

- W5 — Correction flow (BR-CTL-02): behavior clear (unlock → original clerk corrects → re-approve), but v2 has no unlock primitive and void semantics differ per domain (payments vs redemptions). Inspect: status enums + void paths per handler before designing. Tests: correction-flow.spec. Acceptance: no silent workarounds; every correction logged with actor chain.
  - Finding 2026-10-14 (traced, no behavior change): `PAYMENT_TRANSITIONS` allows `recorded → verified|rejected|voided`, terminal after (`lifecycle.ts:223-228`); handler enforces recorded-only first transition + mismatched-decision 409 + reason-required (`sales.ts:744-817`); verify stamps `verified_by/at` (migration `:275`); sale cancel is draft-only + map-checked + guarded (`sales.ts:995-1078`); no void endpoint in sales handler (map-permissive, unexposed); redemption voids unwritten by design. Correction design still needs per-domain void semantics + Q1 — no code change justified yet.
- W6 — Secret hygiene parity (BR-OPS-02): run `pnpm check:env`, inspect env handling vs C1 §2 tasks, record equivalence or gap. Tests: check:env + secret-hygiene.spec. Acceptance: every C1 §2 task has a v2 equivalent or a recorded gap.
  - Finding 2026-10-14: `pnpm check:env` PASS (589 browser + 211 server files). Equivalence: C1 §2.1–2.4 → v2 env secrets, never committed (`.env.example` placeholders by design), VITE_/server split enforced; §2.5–2.6 Sheets editor list → N/A (no Sheets deployment); §2.7 custody record → no v2 equivalent located (recorded gap, not built — custody is procedural, no code target).
- W7 — OST↔commission entitlement (BR-PAR-01 adjacent): trace v2 `ost-accreditation` → commission paths in code before any entitlement claim. Tests: accreditation-entitlement.spec. Acceptance: written entitlement mapping or recorded absence.
  - Finding 2026-10-14 (traced, no behavior change): resolver supports `p_seller_type = 'ost'` with account→role precedence (`flexible_commission_rules.sql:8,83-116`); `ost.ts:15` disclaims all commission logic in the OST workflow; sale creation hardcodes `p_seller_type: 'staff'` (`sales.ts:429-433`) — OST-targeted rules are currently unreachable from sales (dead path or future hook; needs product/Q1 decision, not a fix). Recorded absence stands.

## Lane 3 — Blocked by missing source (work continues elsewhere; these wait)

- B1 — BR-RATE-05 VIP DSC default (Q7). Genuinely blocked: figure absent. Unblocked portion (DRI/DSC-IGP) has no v2 target — park until Q1.
- B2 — BR-CTL-05 referral-right review (authority: guide/manual only, no ruling). Genuinely blocked on authority, not mechanics. Park until ruling located or stakeholder decides.
- B3 — BR-CUT-01/02 cutover application to v2 data (Q2 + Q4 instruments). Genuinely blocked: backfill/protection semantics depend on ruling + absent contracts. All migration-touching acceptance in W1–W4 waits on this; forward-only new behavior does not.
- B4 — Master List identity (Q5/CF-05) + C2 version authority (Q6/CF-03): documentation-completeness blocks, not build blocks. Resolve in parallel; do not hold lanes 1–2.

## Lane 4 — Cross-model integration (needs Q1 before any design)

If Q1 keeps the workbook payroll operative, each capability below is a build project with its dependency order; if Q1 retires it, this lane closes with a recorded ruling. Do not design prematurely — data-model implications listed as investigation prompts only.

- X1 — Allowance core (BR-ENG-01…05, BR-GEN-06, BR-PB-03/04): engagement dates → QP/EP classification → day-pro-ration → Table A lookups → quota gates. Investigation prompts: personnel-schema extension; period engine vs calendar months; quota aggregation queries at scale (SUPABASE-FREE constraints). Dependencies: none within lane (foundation). Tests: start-day-flag, period-classification, first-month-ba, proration, transitional-split, table-a, quota-gate specs.
- X2 — Qualification + payout engine (BR-QLF-01/05 prerequisites, BR-PB-02, BR-RATE-01/02): per-sale cumulative tracking → auto-dates → freeze → stage releases → DSC/DRI computation. Investigation prompts: collections throughput; freeze-timing (BUG-001 lesson: freeze pass must defer zero rates); release scheduling. Dependencies: X1 (figures feed allowances). Tests: auto-qualification, stage-release, equivalent-tcp (SSM 135,000 / SVD nil), zero-rate-deferral specs.
- X3 — People lifecycle (BR-REV-01…03, BR-DUAL-01…03, BR-GEN-01/03/07, BR-ACM-01…04): review boards → dual rows → vacancy/succession → assumed credit. Investigation prompts: accreditation-row identity (number-keyed, not person-keyed); chain-check queries; credit computation over receipt chains. Dependencies: X1 (periods), X2 (qualification feeds credit base). Tests: qp-review, streak-review, dual-engagement, back-date, assumed-credit, credit-routing specs.
- X4 — Settlement + console (BR-CTL-02/04, BR-OPS-01/04, BR-AUTH full): reviews → audit sheet → payroll → withhold → Close Month → ledger → backups; eleven-action console; go-live runbook. Investigation prompts: ledger immutability mechanism; backup discipline; month-start change semantics. Dependencies: X1–X3. Tests: close-month, director-console, correction-flow, first-month-runbook specs.
- Acceptance per X-item: the corresponding RV cases reproduce from the C2 §5 set; closed months immutable; every privileged action logged old→new.
- Risks for investigation (not decisions): payroll-scale queries vs Supabase free limits; dual identity model (accreditation-number-keyed) vs v2 person-keyed staff/users; coexistence of points economy with BA/PA/PB (double-compensation semantics need Q1); migration/backfill under Q2.

## Lane order

B4 + Q-set in parallel with everything. Lane 1 decisions → Lane 1 builds + Lane 2 inspections. Lane 3 unblocks feed their lanes. Lane 4 starts only on Q1. No lane blocks another lane's unambiguous work.
