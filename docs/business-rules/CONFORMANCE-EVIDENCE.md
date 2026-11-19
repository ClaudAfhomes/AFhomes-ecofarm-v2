# Rule-Level Conformance Evidence (Phase 7)

- Created: 2026-10-14. One row per matrix rule (55). "Proves" means the cited test asserts the documented requirement — not adjacent behavior.
- Executed evidence ledger: api 2131, web 245, admin 799 (+1 load flake, solo-green), shared 41, contracts 226, db-integration 2464, targeted batches, 2 new specs (7 tests). Load flakes (3 total) solo-verified; no assertion adjusted.
- Counts validated from matrix rows: MATCH 1, MISMATCH 1, PARTIAL 15, NOT_IMPLEMENTED 32, BLOCKED_BY_MISSING_SOURCE 4, OUT_OF_SCOPE 2 = 55. (INDEX implementation statuses read NOT_IMPLEMENTED 34 because CUT-01/02 are NOT_ASSESSED there but BLOCKED here — same rules, two lenses, no discrepancy.)

## TEST_VERIFIED at rule level (1)

| Rule | Requirement | Evidence | Proves? | Next action |
|---|---|---|---|---|
| BR-RATE-06 | Invalid inputs consume no number; duplicates prevented | `sales.ts:400-454`, `customers.ts:218-271`, DB uniques; `sale-creation-order` + `customer-creation-order` specs 7/7 green 2026-10-14 | YES — asserts 403/409 + zero number calls + no row | None (AF-series issuance audited Step 3, conformant by construction) |

## MISMATCH (1)

| Rule | Requirement | Evidence | Proves? | Next action |
|---|---|---|---|---|
| BR-QLF-02 | VIP 25% / IGP 10% counting lines | Codegate is 100%-verified activation (`phase2_rpc.sql:431`); `phase2.spec` green asserts current behavior, not the documented lines | Tests prove code behavior, NOT the rule | Q3 ruling, then W1 |

## PARTIAL with executed adjacent tests (11)

Rule | Adjacent evidence (green) | What it proves | Missing for conformance | Next action
---|---|---|---
BR-GEN-04 | `phase7-genealogy` + `referral-contexts` (267-batch) | Genealogy CRUD/scoping works | Date-filtered inheritance + credit | Q1/Q3, then succession-filter.spec
BR-GEN-05 | same batch | Downline relations resolve | Whole-tree aggregation | Q1, then team-aggregation.spec
BR-QLF-01 | `sale-payments` + phase26 tests 4/5/5b/6 (183-batch) | Verify-gate + idempotency + reason-required | Auto-date + threshold lines | Q3, then auto-qualification.spec
BR-QLF-03 | `commerce.spec` 33 (snapshot helper) | Snapshots freeze | Threshold-date prospectivity | Q3, then prospectivity.spec
BR-QLF-04 | `sale-payments` + `sale-cancel` (183-batch) | Exclusion + terminality | Strip/restart + receipt-moving | Q1 + card-refund decision (none exists)
BR-AUTH-01 | `authorization.regression` (135-batch) | Gated decisions, audit written | Console/range/warn/log-values | Q1 scope
BR-AUTH-02 | commissions via phase26 (183-batch) | Precedence resolution | PENDING + deviation flags | Q1 scope
BR-RATE-01 | `commerce.spec` 33 + `sale-creation-order` 4/7 | Freeze helper + ordering | DSC/DRI rates in v2 | Q1 (no DSC/DRI target)
BR-RATE-03 | commissions via phase26 | Windows enforced | Anniversary trigger | Q1 scope
BR-CTL-01 | `sale-payments` 2 (actor names) | Stamp + names resolve | Whole-row lock semantics | Q1 scope decision
BR-CTL-03 | `phase2` idempotency tests (183-batch) | Idempotent activation | Ledger/month-close | Q1 scope
BR-CTL-06 | `audit-sanitize` (135-batch) | Sanitized append-only audit | Six-column parity | Q1 scope
BR-ACM-04 | `phase7-genealogy` (267-batch) | Upline relations | Chain snapshot + roll-up | Q1, then credit-routing.spec
BR-OPS-02 | `check:env` PASS (589+211 files) | Split enforced | Custody record (procedural) | Record procedurally
BR-OPS-05 | `role-baseline` (135-batch) | Role gating | Agreed no-self-approval chain | Trace chain or record gap

## PARTIAL, no executed adjacent test (0) — all 15 PARTIALs listed above.

## NOT_IMPLEMENTED (32): no implementation exists; every ID listed explicitly

| IDs | Adjacent infrastructure | Missing | Next action |
|---|---|---|---|
| BR-GEN-01, BR-GEN-02, BR-GEN-03, BR-GEN-06, BR-GEN-07 | None (no vacancy/Override/pro-ration) | Vacancy roll-up, Override accrual, day-pro-ration | Lane 4 X3 on Q1 |
| BR-ENG-01, BR-ENG-02, BR-ENG-03, BR-ENG-04, BR-ENG-05 | None (no dates/periods) | Start flags, QP/EP, first-month BA, cadences, transitional split | Lane 4 X1 on Q1 |
| BR-REV-01, BR-REV-02, BR-REV-03 | None (no board/lifecycle) | Entire review machinery | Lane 4 X3 on Q1 |
| BR-PB-01, BR-PB-02, BR-PB-03, BR-PB-04 | None (no PB/quotas/Table A) | Entire bonus engine | Lane 4 X1/X2 on Q1 |
| BR-ACM-01, BR-ACM-02, BR-ACM-03 | None (no credit) | Credit computation + posting | Lane 4 X3 on Q1 |
| BR-PAR-01, BR-PAR-02 | None (no dual-system split) | Accreditation-side entitlement | Lane 4 on Q1 (W7 inspection done) |
| BR-DUAL-01, BR-DUAL-02, BR-DUAL-03 | None (no dual rows/chain check/back-dates) | Dual identity + integrity + date handling | Lane 4 X3 on Q1 |
| BR-RATE-02, BR-RATE-04 | None (no zero-deferral/unlock in v2) | Unlock flow (zero-deferral inapplicable: 0% legal + deterministic) | X2 on Q1 for unlock |
| BR-CTL-02, BR-CTL-04 | None (no unlock flow/console) | Correction primitive + Director console | X4 on Q1 |
| BR-OPS-01, BR-OPS-04 | None (no contract-start/close discipline) | Go-live prerequisites + first-month runbook | X4 on Q1 |
| BR-QLF-05 | None (no stage gates) | Stage-release engine | X2 on Q1 |

## BLOCKED_BY_MISSING_SOURCE (4)

| Rule | Missing fact | Next action |
|---|---|---|
| BR-RATE-05 | VIP DSC figure (exhaustively searched B8, B2-ParamInfo, Control Panel, A4/A6) | Q7 |
| BR-CTL-05 | Authority (guide/manual only, no ruling) + no v2 subject (no sale-referrer commission) | Ruling or drop with record |
| BR-CUT-01 | Q2 cutover scope (does it bind v2 data?) | Presidential ruling |
| BR-CUT-02 | Q2 scope + Q4 instruments (absent C3–C7) | Presidential ruling |

## OUT_OF_SCOPE (2)

BR-QLF-06 (workbook-internal rename, no shared artifact), BR-OPS-03 (workbook install; v2 deploys via `vercel.json`) — both evidenced, no action.

## Issuance-path audit (Step 3) — all conformant, no defect

Sequential pre-issue RPCs: `next_sale_number` (validated seller + scheme first — fixed P5, tested), `next_customer_number` (referrer + Zod + duplicate pre-checks first — fixed P6, tested). `next_ost_number` called post-validation (`ost.ts:477`, no change). `next_redemption_number` has no handler call site (allocated inside atomic RPC). AF-APP/AF-RES/AF-ACC/AF-REN claimed inline in creating RPCs; AF-PAY/AF-COM/AF-RED/... via insert-time column DEFAULTs; MBS/QR/fallback inside `activate_card_sale`; AF-CC via customer-code flow. Allocation is random (`af_candidate` + advisory lock + existence check + UNIQUE backstop), so unconsumed candidates leave no sequential gap by construction.
