# Implementation Gap Matrix

- Created: 2026-10-14 (Phase 2B). Documentation/analysis only — no behavior changed.
- One row per documented rule (54). Gap classes: `MATCH` (none — no rule fully implemented), `PARTIAL`, `MISMATCH`, `NOT_IMPLEMENTED`, `NOT_VERIFIED` (code cited but behavior not confirmed against the rule), `BLOCKED_BY_MISSING_SOURCE`. OUT_OF_SCOPE rows marked `—` with rationale pointer.
- "Current behavior" is observed code, never policy. Phase keys: `M` = mismatch resolution, `D1` = decide-then-build (principle match exists), `X` = cross-model build (payroll capability absent), `B` = blocked by missing source, `—` = out of scope.

| Rule ID | Required behavior | Source reference | Current behavior | Code reference | Gap | Dependencies | Phase | Verification test |
|---|---|---|---|---|---|---|---|---|
| BR-GEN-01 | Vacant post nil; downline rolls to next active above | C2 §3 R1 | No vacancy/roll-up; seller must be active | `commerce.ts:437-470` | NOT_IMPLEMENTED | GEN-04, ACM-01 | X | NEW: vacancy-rollup.spec |
| BR-GEN-02 | Override exact to receipt date; ends at End Date | C2 §3 R2 + example | No Override mechanics | — (grep absent) | NOT_IMPLEMENTED | GEN-03, PB-03 | X | NEW: override-accrual.spec |
| BR-GEN-03 | Post-exit receipts credit nobody at top-of-tree vacancy | C2 §3 R3; RV-12b | No vacancy concept | — | NOT_IMPLEMENTED | GEN-01/02 | X | NEW (with GEN-01) |
| BR-GEN-04 | Successor inherits genealogy only; pre-appointment excluded (R23 softening) | C2 §3 R4 + 21 Aug amend; RV-13/14/17 | Genealogy maintained; date-filtered inheritance + credit absent | `correct_referral_upline` (Phase 2 RPC); commission windows `flexrules:111-112` | PARTIAL | ACM-01, GEN-07 | D1 | EXISTING NOT RUN: `phase7-genealogy-migration.spec.ts` + NEW: succession-filter.spec |
| BR-GEN-05 | Leader covers whole genealogy | C2 §3 R5; RV-15 | Single-level commission only; downline check exists | `commerce.ts:437-470`; `sales.ts:400` | PARTIAL | GEN-01, PB-02 | D1 | EXISTING NOT RUN: `referral-contexts.spec.ts` + NEW: team-aggregation.spec |
| BR-GEN-06 | BA/PA day-pro-rated incl. appointments; type record-only | C2 §3 R6; RV-16 | No allowances/pro-ration | — (grep absent) | NOT_IMPLEMENTED | ENG-04 | X | NEW: proration.spec |
| BR-GEN-07 | Successor window never limits upline | C2 §3 R7; RV-17 | No appointment windows | — | NOT_IMPLEMENTED | GEN-04 | X | NEW (with GEN-04) |
| BR-ENG-01 | Starts 1st/16th; others flagged not blocked | C2 §3 R8; B8 col AW | No engagement dates | — | NOT_IMPLEMENTED | ENG-05, OPS-01 | X | NEW: start-day-flag.spec |
| BR-ENG-02 | Contract-start (never accreditation) drives QP/EP; blank = EP/underpayment | C2 §3 R9; RV-18; C1 §1 | No QP/EP fields | — | NOT_IMPLEMENTED | ENG-03, REV-01, OPS-01 | X | NEW: period-classification.spec |
| BR-ENG-03 | First-month BA unconditional; withholding = Director judgement | C2 §3 R10a; RV-32 | No BA | — | NOT_IMPLEMENTED | PB-03, ENG-02 | X | NEW: first-month-ba.spec |
| BR-ENG-04 | BA by days (16/31); PA/PB/Override calendar-month only | C2 §3 R10 | No cadences | — | NOT_IMPLEMENTED | GEN-06, ENG-05 | X | NEW (with GEN-06) |
| BR-ENG-05 | Transitional split QP + correction stretch, one assessment each | C2 §3 R11; RV-19 | No transitional months | — | NOT_IMPLEMENTED | ENG-01/02, REV-02 | X | NEW: transitional-split.spec |
| BR-QLF-01 | Auto-qualification on approved collections; no typed date | C2 §3 R12; RV-20; B2:660 | Verify-gate exists; no auto date/threshold lines | `phase2_rpc.sql:224-352`; `commerce.ts:50-114` | PARTIAL | QLF-02, CTL-01 | D1 | EXISTING NOT RUN: `sale-payments.spec.ts` + NEW: auto-qualification.spec |
| BR-QLF-02 | VIP 25% / IGP 10% counting lines | C2 §3 R13; B8 §2; RV-20 | 100%-verified activation gate | `phase2_rpc.sql:418,431`; `sales.ts:819-820` | MISMATCH | QLF-01/05, CUT-01 | M | NEW: threshold-gate.spec (blocked on Q3 for expected values) |
| BR-QLF-03 | Date frozen; changes prospective only | C2 §3 R14; RV-21 | Snapshots frozen; rule windows; prospective zeroing | `commerce.ts:193-201`; `flexrules:11-12,26-37,111-112,130` | PARTIAL | AUTH-01, PB-01 | D1 | EXECUTED 2026-10-14: `commerce.spec.ts` 33 passed (helper only) + NEW: prospectivity.spec |
| BR-QLF-04 | Refund strips qualification; replacement from zero | C2 §3 R15; RV-22 | Verified-only totals; no strip/restart | `commerce.ts:50-114`; `phase2_rpc.sql:78-132` | PARTIAL | QLF-01, CTL-03 | D1 | EXISTING NOT RUN: `sale-payments.spec.ts`, `sale-cancel.spec.ts` + NEW: refund-strip.spec |
| BR-QLF-05 | Closed-deal gate ≠ stage-1 gate (VIP 40%→100%, IGP 40%→40%) | C2 §3; B8 §2; A4 §2 | No stage gates; manual qualify→paid | `lifecycle.ts:239-244` | NOT_IMPLEMENTED | QLF-02, PB-02 | X | NEW: stage-release.spec |
| BR-QLF-06 | Rename Qualified→Closed Deal TCP (presentational) | C2 §4 R22; RV-26 | No shared artifact | — | — (OUT_OF_SCOPE; no v2 artifact) | — | — | — |
| BR-AUTH-01 | Pay figures Director-only; range-check; warn; old→new log | C2 §3 R16; RV-23; B2:1065 | Gated + audited manual `earned`; no console/log-values | `lifecycle.ts:240-244`; `commissions.ts:362-370` | PARTIAL | PB-03, QLF-03, CTL-04 | D1 | EXISTING NOT RUN: `authorization.regression.spec.ts` + NEW: parameter-console.spec |
| BR-AUTH-02 | Rates from standard; deviation logged + PENDING | C2 §3 R17; B2:1234 | Account→role→0 precedence; no PENDING/flags | `flexrules:3,82,111-112` | PARTIAL | RATE-03, CTL-04 | D1 | EXISTING NOT RUN: commissions specs + NEW: deviation-pending.spec |
| BR-REV-01 | QP review board; PASS retains / FAIL terminates at period end | C2 §3 R18; RV-24; B2:870 | No board/lifecycle | — | NOT_IMPLEMENTED | ENG-02, REV-03 | X | NEW: qp-review.spec |
| BR-REV-02 | Below-target pair from 3rd month; pair recorded | C2 §3 R19; RV-24; B2:934 | No streak review | — | NOT_IMPLEMENTED | ENG-05, ACM-02, REV-03 | X | NEW: streak-review.spec |
| BR-REV-03 | Unreviewed = retained; pending count on open | C2 §3 R20; RV-24 | No engagement lifecycle | B4 `notifyPendingReviews` (workbook-side) | NOT_IMPLEMENTED | REV-01/02 | X | NEW (with REV-01) |
| BR-PB-01 | No Equivalent-TCP floor (B19 = 0%) | C2 §4 R21; RV-25 | No Equivalent TCP | — | NOT_IMPLEMENTED | PB-02/04 | X | NEW: no-floor.spec |
| BR-PB-02 | Equiv TCP = collection/40% capped at Team TCP, quota-gated | C2 §4 R21; B8 §§3/5 | No Equiv TCP/quotas | — | NOT_IMPLEMENTED | PB-01/03/04 | X | NEW: equivalent-tcp.spec (worked example: SSM 135,000 / SVD nil) |
| BR-PB-03 | Table A grid (SM/SSM/SVD; SVD 2% < SSM 3% deliberate) | B8 §2 | No Table A/allowances | — (grep absent) | NOT_IMPLEMENTED | AUTH-01, ENG-03, PB-02/04 | X | NEW: table-a.spec |
| BR-PB-04 | 40% monthly quota gates PA+PB, aggregate | C2 §3–4; B8 §2 B12 | No quota gate | — | NOT_IMPLEMENTED | PB-02, QLF-05 | X | NEW: quota-gate.spec |
| BR-ACM-01 | Credit 40% VIP / 20% IGP, Director-adjustable | C2 §4A R23; B8 §2; RV-34 | No credit | — | NOT_IMPLEMENTED | ACM-02/04 | X | NEW: assumed-credit.spec |
| BR-ACM-02 | Credit reaches BA/PA/PB + quota + review (AG/AH) | C2 §4A; A4 §7; B8 §1 | No KPI-plus-credit | — | NOT_IMPLEMENTED | ACM-01, PB-04, REV-02 | X | NEW (with ACM-01) |
| BR-ACM-03 | Never Override; seller keeps DSC/DRI; no re-test | C2 §4A; RV-36 | Neither side exists | — | NOT_IMPLEMENTED | PAR-01/02 | X | NEW (with ACM-01) |
| BR-ACM-04 | Automatic via current chain; no register; vacancy rolls up | C2 §4A; A4 §7; B8 §1 AR/AS | Relations exist; no chain snapshot/roll-up | `correct_referral_upline` | PARTIAL | GEN-01, DUAL-02 | D1 | EXISTING NOT RUN: `phase7-genealogy-migration.spec.ts` + NEW: credit-routing.spec |
| BR-PAR-01 | Commission follows accreditation incl. OST, not engagement | C2 §4A R24; A4 §1 | Single commission model; OST↔commission untraced | `ost-accreditation` family (probe) | NOT_IMPLEMENTED | PAR-02, ACM-03 | X | NEW: accreditation-entitlement.spec |
| BR-PAR-02 | Credit + commission on one receipt both correct | C2 §4A; A4 §1 | Neither posting exists | — | NOT_IMPLEMENTED | ACM-03, PAR-01 | X | NEW (with ACM-01) |
| BR-DUAL-01 | Dual rows + link + 3 warnings; transfers mutate | C2 §4A R25; RV-38 | No dual rows/links | — | NOT_IMPLEMENTED | DUAL-02 | X | NEW: dual-engagement.spec |
| BR-DUAL-02 | BROKEN CHAIN warns, never blocks; moves change all columns | C2 §4A R26; RV-39 | No chain check | — | NOT_IMPLEMENTED | DUAL-01, ACM-04 | X | NEW: broken-chain.spec |
| BR-DUAL-03 | Back-dates accepted; 12mo+ ENDED; overdue review expected | C2 §4A R26; RV-40 | No back-date handling | — | NOT_IMPLEMENTED | ENG-02, REV-01 | X | NEW: back-date.spec |
| BR-RATE-01 | DSC/DRI frozen at issue (AQ/AR, IGP AR/AS) | A4 §3.1; A6 §2.1; B2:534 | Snapshots frozen (different rates) | `commerce.ts:193-201`; `sales.ts:447` | PARTIAL | RATE-02/04 | D1 | EXECUTED 2026-10-14: `commerce.spec.ts` 33 passed (helper) + NEW `sale-creation-order.spec.ts` 2 passed (ordering half TEST_VERIFIED) |
| BR-RATE-02 | Zero rate never freezes (BUG-001) | B8 §6; B2:534 guard | No zero-deferral located | — | NOT_IMPLEMENTED | RATE-01 | X | NEW: zero-rate-deferral.spec |
| BR-RATE-03 | Anniversary reviews; new sales only carry new rates | A6 §5.2; B8 §1 AQ/AP | Effective windows; no anniversary trigger | `flexrules:111-112` | PARTIAL | AUTH-02, RATE-01 | D1 | EXISTING NOT RUN: commissions specs + NEW: anniversary-rate.spec |
| BR-RATE-04 | Early-performer single-cell unlock + re-approve | A6 §5.3; B2:1377 | Snapshots immutable; no unlock | — | NOT_IMPLEMENTED | RATE-01, CTL-02 | X | NEW: sale-rate-unlock.spec |
| BR-RATE-05 | Defaults DRI 5%/4%, DSC IGP 8%; VIP DSC NOT LISTED | B8 §2 B10/B11/E12 | No DSC/DRI | — | BLOCKED_BY_MISSING_SOURCE (VIP DSC figure; exhaustively searched Phase 5) | AUTH-01, RATE-01 | B | NEW after Q7: default-rates.spec |
| BR-RATE-06 | Invalid inputs generate NO number; duplicates prevented at freeze | A2 Control A23/A25 | Seller + scheme (sales), duplicate pre-check (customers) validated before numbering; OST verified-conformant; duplicates via DB uniques | `sales.ts:400-454`; `customers.ts:218-270`; `ost.ts:410-477` | MATCH | RATE-01 | DONE (Phases 5–6) | EXECUTED 2026-10-14: NEW `sale-creation-order.spec.ts` + `customer-creation-order.spec.ts`, 4 + 3 passed |
| BR-CTL-01 | Approval stamps + locks whole row; unapproved counts nothing | A6 Part 3; A4 §4; B2:386/398 | Verify-gate; no stamp/lock | `phase2_rpc.sql:224-352` | PARTIAL | QLF-01, CTL-02 | D1 | EXISTING NOT RUN: `sale-payments.spec.ts` + NEW: approval-lock.spec |
| BR-CTL-02 | Correction = unlock → clerk corrects → re-approve | A6 Part 3; B2:508 | No unlock flow | — | NOT_IMPLEMENTED | CTL-01, AUTH-01 | X | NEW: correction-flow.spec |
| BR-CTL-03 | Close Month values-lock; refuses repeats; warn on unapproved | A4 §5.1; A6 Part 6; B2:683 | Idempotent activation; immutable snapshots; no ledger | Phase 2 RPC (AGENTS.md) | PARTIAL | REV-01/02/03, AUTH-01, CTL-01 | D1 | EXISTING NOT RUN: `phase2.spec.ts` + NEW: close-month.spec |
| BR-CTL-04 | Eleven Director actions, password each, all logged | A4 §6; B8 §4 | No Director console | B2/B4 listings | NOT_IMPLEMENTED | AUTH-01, CTL-03 | X | NEW: director-console.spec |
| BR-CTL-05 | Referral-right review (>1yr accreditation → decide, not blocked) | A6 App. A (no C2 ruling) | No referral-age check | — | BLOCKED_BY_MISSING_SOURCE (authority: guide/manual only) | — | B | NEW after authority found: referral-right.spec |
| BR-CTL-06 | Six-column audit log, cross-platform parity | B8 §4 | Append-only `audit_events`, different schema | AGENTS.md Phase 1 | PARTIAL | AUTH-01 | D1 | EXISTING NOT RUN: `audit-sanitize.spec.ts` + NEW: six-column-log.spec |
| BR-CUT-01 | No grandfathering; sub-threshold never counts whenever entered | C1 §3; IDX | No threshold to grandfather; v2 applicability unknown | — | BLOCKED_BY_MISSING_SOURCE (Q2 ruling) | QLF-02 | B | NEW after Q2: cutover.spec |
| BR-CUT-02 | Credited Closed Deals contract-protected; nothing else carried | C1 §3 | NOT ASSESSED (instruments absent) | — | BLOCKED_BY_MISSING_SOURCE (Q2/Q4) | CUT-01 | B | NEW after Q2/Q4 |
| BR-OPS-01 | Contract-start for all before first payroll | C1 §1; C2 §6 | No contract-start/EP fields | — | NOT_IMPLEMENTED | ENG-02, DUAL-03 | X | NEW (with ENG-02) |
| BR-OPS-02 | Placeholder secrets changed; VBA locked; editor list reviewed | C1 §2; C2 §6; B8 §8 | Env secrets + `check:env` model | `.env.example`; `scripts/check-env-isolation.mjs` | PARTIAL | OPS-03 | D1 | EXISTING NOT RUN: `pnpm check:env` + NEW: secret-hygiene.spec |
| BR-OPS-03 | Rev E/v2.1 install; Alt+F8 + 11-item menu; stamp; delete old | C1 §4; IDX; C2 §6 | N/A (workbook install; v2 deploys via `vercel.json`) | — | — (OUT_OF_SCOPE; IDX Pack B scope, no shared artifact) | CTL-04 | — | — |
| BR-OPS-04 | First-month run: backups, hand-checks, pre-5th approvals, month-start changes | C1 §6 | No close/backup discipline | — | NOT_IMPLEMENTED | CTL-03 | X | NEW: first-month-runbook.spec (procedure, may be manual) |
| BR-OPS-05 | Briefing + walkthroughs + agreed no-self-approval chain | C1 §5; A6 Part 1 | Role gating exists; chain untraced | `role-baseline.spec.ts` path VERIFIED | PARTIAL | CTL-01 | D1 | EXISTING NOT RUN: `role-baseline.spec.ts` + NEW: approval-chain.spec |

## Summary counts

- MATCH 1 (BR-RATE-06, new Phase 5) · PARTIAL 15 · MISMATCH 1 · NOT_IMPLEMENTED 34 · BLOCKED_BY_MISSING_SOURCE 4 (RATE-05, CTL-05, CUT-01/02) · OUT_OF_SCOPE 2 (QLF-06, OPS-03, excluded from applicable set)
- Applicable set: 53 rules. Only BR-RATE-06 certifies conformance.
