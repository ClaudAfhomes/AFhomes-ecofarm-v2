# Business Rules Index — AF Homes Ecofarm v2

- Status: MIXED (per-rule statuses below; no rule is APPROVED — see `OPEN_QUESTIONS.md` Q1)
- Created: 2026-10-14 (Phase 1 extraction; documentation only, no behavior changed)
- Sources: `Business Rules.zip` (18 of 30 indexed files present; C3–C7 and D1–D7 absent)
- How to use: find the rule → read the domain file → check `CONFLICTS.md` / `OPEN_QUESTIONS.md` → follow `AGENT-GUIDE.md`
- Key: Doc = Documentation status, Impl = Implementation status. `CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED` means the code cited shares the principle only, not the workbook's numbers.

## Source key

- `C2` = `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` (rulings 20–21 Aug 2026; in-ZIP mtime 2026-10-11)
- `C1` = `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx`
- `A4` = `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`
- `A6` = `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- `A7` = `A7-QA_Glossary-Ambiguous_Terms-2026-09-10.docx`
- `B8` = `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx` (BUILD 2026-09-10a)
- `B2` = `B2-AFhomes_Generator_v10_2_0_VBA_Module-RevE.txt` (1504 lines)
- `B4` = `B4-AFhomes_Sheets_Control_Module_AppsScript-v2_1.txt` (909 lines)
- `A2` = `A2-AFhomes_VIP_IGP_Integrated_Generator-v10_2_0-BUILD_2026-09-10a.xlsx` (25 sheets)
- `IDX` = `MASTER_FILE_INDEX-BUILD_2026-09-10a.docx`

## Genealogy, vacancy, succession, proration (`BR-GEN-allowances.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-GEN-01 | C2 §3 R1: vacant post nil, downline rolls up | CONCEPTUAL: `api/_lib/commerce.ts:437` seller resolution (no vacancy concept) | NOT RUN | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | No vacancy/roll-up in v2 |
| BR-GEN-02 | C2 §3 R2: override exact to receipt date, ends at End Date | No Override in v2 (grep VERIFIED absent) | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | AFhomes has no Override at all (A7 §3) |
| BR-GEN-03 | C2 §3 R3: vacant seat earns no override in vacancy period | Same as GEN-02 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | — |
| BR-GEN-04 | C2 §3 R4 (+21 Aug amend): successor inherits genealogy only; pre-appointment transactions excluded | CONCEPTUAL: `correct_referral_upline` (Phase 2 RPC, AGENTS.md) | `phase7-genealogy-migration.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20/21 | R23 softening is BR-ACM |
| BR-GEN-05 | C2 §3 R5: leader covers whole genealogy | CONCEPTUAL: downline checks in `commerce.ts:437` | NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20 | v2 single-level only |
| BR-GEN-06 | C2 §3 R6: BA/PA day-pro-rated on appointment + departure; Override/PB not pro-rated | No BA/PA/PB in v2 (grep VERIFIED absent) | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | Departure Type record-only |
| BR-GEN-07 | C2 §3 R7: successor window never limits upline | No upline windows in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | — |

## Engagement dates and periods (`BR-ENG-periods.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-ENG-01 | C2 §3 R8: starts 1st/16th, others flagged not blocked | No engagement dates in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | A4 §3.3, A6 §2.3, B8 §1 col AW |
| BR-ENG-02 | C2 §3 R9: contract-start (not accreditation) drives QP/EP | No QP/EP in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | Blank start = underpayment (C1 §1) |
| BR-ENG-03 | C2 §3 R10a: first-month BA compliance-based, no production test | No BA in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | Contract clause unchanged |
| BR-ENG-04 | C2 §3 R10: monthly/semi-monthly BA by days (16th of 31 = 16/31); PA/PB/Override calendar-month only | No BA/PA/PB in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | — |
| BR-ENG-05 | C2 §3 R11: transitional month splits QP + correction stretch, one assessment each | No transitional months in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | RV-19 documents behavior |

## Qualification (`BR-QLF-qualification.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-QLF-01 | C2 §3 R12: automatic qualification on counted APPROVED collections | CONCEPTUAL: `verify_card_payment` recorded→verified (`20260927000003_afhomes_phase2_rpc.sql:224-352`) | `sale-payments.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20 | No typed qualified date (B8 §1) |
| BR-QLF-02 | C2 §3 R13: VIP 25%, IGP 10% (B8 §2 B13/E13) | MISMATCH: full-verified activation (`phase2_rpc.sql:418,431`) | `phase2.spec.ts` NOT RUN | SOURCE_DOCUMENTED | MISMATCH | 2026-08-20 | Needs Q3 ruling |
| BR-QLF-03 | C2 §3 R14: date frozen; threshold changes prospective | `commerce.ts:193-201` snapshots; rule windows (`20261018000002…:11-12,111-112`); 4%→0 history-untouched (`:130`) | `commerce.spec.ts` 33 passed 2026-10-14 (helper only) | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20 | Principle match only |
| BR-QLF-04 | C2 §3 R15: refund strips qualification; replacement from zero | CONCEPTUAL: only `verified` counts (`commerce.ts:50-114`) | `sale-payments.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20 | UPGRADED/DOWNGRADED/CANCELLED (VIP register) |
| BR-QLF-05 | C2 §3 + A4 §2: closed-deal gate ≠ stage-1 gate (VIP 40%→100%, IGP 40%→40%; B8 §2 E10/F10/E11/F11) | No stage gates in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | Core anti-confusion rule |
| BR-QLF-06 | C2 §4 R22 + A7 §2: Qualified TCP renamed Closed Deal TCP (presentational) | N/A (workbook-internal rename) | — | SOURCE_DOCUMENTED | OUT_OF_SCOPE | 2026-08-21 | No formula referenced old name |

## Governance (`BR-AUTH-governance.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-AUTH-01 | C2 §3 R16: pay figures Director-only, range-checked, warned, logged old→new (abandon logged) | CONCEPTUAL: gated manual `earned` (`lifecycle.ts:240-244`, `commissions.ts:362-370`) | `authorization.regression.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20 | No parameter console in v2 |
| BR-AUTH-02 | C2 §3 R17: per-person rates auto from standard; deviation = Director act, logged, row to PENDING | CONCEPTUAL: rule precedence account→role→0 (`flexible_commission_rules.sql:3,82`) | commissions specs NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-20 | BK column names deviations |

## Reviews (`BR-REV-reviews.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-REV-01 | C2 §3 R18: QP review board, PASS retains / FAIL terminates at period end | No reviews board in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | B2:870, B4 `reviewQualifyingPeriod` |
| BR-REV-02 | C2 §3 R19: two consecutive months below target from 3rd natural month; pair recorded | No streak review in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | B2:934, B4 `reviewPerformanceStreak` |
| BR-REV-03 | C2 §3 R20: unreviewed = retained; pending count on open | No engagement lifecycle in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | B4 `notifyPendingReviews` |

## Bonus (`BR-PB-bonus.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-PB-01 | C2 §4 R21: no Equivalent-TCP floor (B19 = 0%) | No Equivalent TCP in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | Contract-text safety reasoning |
| BR-PB-02 | C2 §4 R21 + B8 §5: Equiv TCP = collection/40% capped at Team TCP, quota-gated (SSM 135,000 / SVD nil worked example) | No Equiv TCP in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | Formula VERIFIED as documented |
| BR-PB-03 | B8 §2 Table A: SM/SSM/SVD thresholds, allowances, PB rates (SVD 2% < SSM 3% deliberate) | No Table A in v2 (grep VERIFIED absent) | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-09-10a | — |
| BR-PB-04 | C2 §3–4: 40% monthly collection quota gates PA+PB, aggregate, independent of per-sale gates | No quota gate in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-20 | B8 §2 B12 |

## Assumed credit (`BR-ACM-assumed.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-ACM-01 | C2 §4A R23: rates 40% VIP / 20% IGP (B8 §2 B20/E20) | No assumed credit in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | Director-adjustable |
| BR-ACM-02 | C2 §4A: reaches BA/PA/PB + 40% quota + below-target review (Payroll AG/AH reconcile) | No KPI-plus-credit in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | B8 §1 cols AG/AH |
| BR-ACM-03 | C2 §4A: never Override; seller keeps DSC/DRI; no re-test of threshold | N/A | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | RV-36: pairing correct |
| BR-ACM-04 | C2 §4A: automatic via current upline chain; no assignment register | CONCEPTUAL: upline-carried receipts only | NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-08-21 | Vacant post rolls upward |

## Parallel systems (`BR-PAR-parallel.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-PAR-01 | C2 §4A R24: DSC/DRI/Override follow accreditation (incl. OST), independent of engagement | No dual-system split in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | A4 §1 |
| BR-PAR-02 | C2 §4A: collector credit + seller commission on one receipt both correct | No assumed credit in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | Payroll must not flag pairing |

## Dual roles (`BR-DUAL-roles.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-DUAL-01 | C2 §4A R25: dual engagement = 2 accreditation rows + link (BM), 3 warnings; transfers mutate | No dual rows in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | B8 §1 cols BL/BM |
| BR-DUAL-02 | C2 §4A R26: BROKEN CHAIN warns, never blocks | No chain check in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | RV-39 |
| BR-DUAL-03 | C2 §4A R26: back-dated dates accepted; 12mo+ reads CONTRACT ENDED; overdue QP review expected | No back-date handling in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-08-21 | RV-40; new-agreement rule |

## Rates (`BR-RATE-freeze.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-RATE-01 | A4 §3.1, A6 §2.1: DSC/DRI frozen at number issue (Register AQ/AR, IGP AR/AS) | `snapshotSaleTerms` (`commerce.ts:193-201`, used `sales.ts:447`) | `commerce.spec.ts` 33 passed 2026-10-14 (helper only) + NEW `sale-creation-order.spec.ts` 2 passed 2026-10-14 (ordering half TEST_VERIFIED) | SOURCE_DOCUMENTED | PARTIAL | 2026-09-10a | Different rates frozen |
| BR-RATE-02 | B8 §6 + B2 `FreezeSaleRates` (:534): zero rate never frozen (BUG-001 fix) | No zero-deferral case evidenced in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-09-10a | Formula body VERIFIED |
| BR-RATE-03 | A6 §5.2: anniversary reviews; new sales only carry new rates | CONCEPTUAL: rule effective windows (`flexible_commission_rules.sql:111-112`) | NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-09-10a | Unreleased remainders keep old rate |
| BR-RATE-04 | A6 §5.3: early-performer single-cell unlock (`DirectorUnlockSaleRate` B2:1377) | No sale-rate unlock in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-09-10a | Row to PENDING + re-approve |
| BR-RATE-05 | B8 §2: defaults DRI 5%/4% (B10/B11), DSC IGP 8% (E12); VIP DSC default NOT LISTED | No DSC/DRI in v2 | — | PARTIAL | NOT_IMPLEMENTED | 2026-09-10a | Gap → OPEN_QUESTIONS Q7; exhaustively searched Phase 5 (B8, B2 ParamInfo 30 cases, Control Panel, A4/A6) — still missing |
| BR-RATE-06 | A2 Control Panel A23/A25: invalid inputs generate NO number; duplicates prevented at freeze | v2 validates seller + scheme (sales), duplicates (customers) before numbering; OST verified-conformant; duplicates via DB uniques | NEW `sale-creation-order.spec.ts` + `customer-creation-order.spec.ts`, 4 + 3 passed 2026-10-14 | SOURCE_DOCUMENTED | TEST_VERIFIED | v10.1 (20 Jul 2026) → BUILD 2026-09-10a | Implemented Phases 5–6 (sales reorder, customer pre-check) |

## Controls (`BR-CTL-controls.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-CTL-01 | A6 Part 3: approval stamps account+time, locks whole row | CONCEPTUAL: verify gate (`phase2_rpc.sql:224-352`) | `sale-payments.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-09-10a | B2:386/398 |
| BR-CTL-02 | A6 Part 3: correction = Director unlock → clerk corrects → re-approve | No unlock flow in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-09-10a | B2:508 |
| BR-CTL-03 | A4 §6 + A6 Part 6: Close Month writes values, refuses repeats, warns on unapproved (abort + override logged) | CONCEPTUAL: idempotent activation (existing membership returned) | `phase2.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-09-10a | B2:683; closed month never moves |
| BR-CTL-04 | A4 §6: eleven Director actions, Alt+F8 / Controls menu | No Director console in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-09-10a | B2/B4 listings VERIFIED |
| BR-CTL-05 | A6 App. A: REFERRAL RIGHT—REVIEW (>1yr referrer accreditation → Director decision, not blocked) | No referral-age check in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | 2026-09-10a | No C2 ruling; guide+manual only |
| BR-CTL-06 | B8 §4: audit log 6 columns; Excel/Sheets reconciled row-for-row | `audit_events` append-only (AGENTS.md Phase 1) | NOT RUN | SOURCE_DOCUMENTED | PARTIAL | 2026-09-10a | Different log schema |

## Cutover (`BR-CUT-cutover.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-CUT-01 | C1 §3 + IDX Pack C: no grandfathering — sub-threshold sales never count, whenever entered | No threshold to grandfather in v2 | — | SOURCE_DOCUMENTED | NOT_ASSESSED | Decided 2026-09-27 | Needs Q2 ruling for v2 data |
| BR-CUT-02 | C1 §3: credited Closed Deals protected by contract; present as change in terms | NOT ASSESSED (Q2/Q4) | — | SOURCE_DOCUMENTED | NOT_ASSESSED | Decided 2026-09-27 | Contract-side protection; instruments absent |

## Go-live (`BR-OPS-golive.md`)

| Rule ID | Source Reference | Code Reference | Test Reference | Doc | Impl | Effective | Notes |
|---|---|---|---|---|---|---|---|
| BR-OPS-01 | C1 §1 + C2 §6: contract-start for every person; blank = silent underpayment | No contract-start field in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | Pre-first-payroll | Workbook-specific |
| BR-OPS-02 | C1 §2 + C2 §6: placeholder passwords changed; VBA locked; 3 distinct secrets | v2 secrets via env (`.env.example` key names only) | `check:env` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | Pre-first-payroll | Different secret model |
| BR-OPS-03 | C1 §4: Rev E + Apps Script v2.1 only; Alt+F8 check; 11-item Controls menu; delete older copies | N/A (workbook install) | — | SOURCE_DOCUMENTED | OUT_OF_SCOPE | BUILD 2026-09-10a | B7/B8 + IDX version rule |
| BR-OPS-04 | C1 §6: dated backups, mid-month hand-checks, pre-5th approvals, month-start personnel changes | No Close Month in v2 | — | SOURCE_DOCUMENTED | NOT_IMPLEMENTED | First live month | Closed month never moves |
| BR-OPS-05 | C1 §5: guides issued, walkthroughs, no self-approval | v2 role permissions differ | `role-baseline.spec.ts` NOT RUN | SOURCE_DOCUMENTED | PARTIAL | Pre-live | Approve-whom agreed locally |

## Code-observed, unapproved (`BR-CODE-observed.md`)

Banner: UNAPPROVED — observed behavior only; never a basis for implementation.

| Rule ID | Code Reference | Test Reference | Notes |
|---|---|---|---|
| BR-CODE-01 | `packages/shared/src/money.ts:33-149` (exact-decimal + BigInt) | `money.spec.ts` 14 passed 2026-10-14 — TEST_VERIFIED (helper behavior) | No workbook counterpart |
| BR-CODE-02 | `commerce.ts:50-114` verified-only totals; `sale_financial_summary` (`phase2_rpc.sql:78-132`) | `commerce.spec.ts` 33 passed 2026-10-14 — TEST_VERIFIED (helper behavior) | Principle resembles approval-gating; numbers differ |
| BR-CODE-03 | Full-verified activation (`phase2_rpc.sql:365-503`, gate `:418,431`); `sales.ts:819-820` | `phase2.spec.ts` NOT RUN | See BR-QLF-02 MISMATCH |
| BR-CODE-04 | Commission price×rate (`commerce.ts:33`); precedence + windows (`flexible_commission_rules.sql:3,82,111-112`); manual `earned` (`lifecycle.ts:239-244`; `commissions.ts:362-370` mandatory notes) | NOT RUN | Single-level vs DSC/DRI+PB |
| BR-CODE-05 | Seller resolution (`commerce.ts:416-464`; used `sales.ts:400`) | `commerce.spec.ts` passed 2026-10-14 — TEST_VERIFIED (helper behavior) | Downline concept resembles R5/R7; not formula-verified |
| BR-CODE-06 | Spot-cash 7-day window (`commerce.ts:123-140`; `constants.ts:10`) | `commerce.spec.ts` passed 2026-10-14 — TEST_VERIFIED (helper behavior) | No workbook counterpart |
| BR-CODE-07 | VIP schemes frozen, no chaining (`commerce.ts:289-383`; `lifecycle.ts:181-190`) | `vip-payment-schemes.spec.ts`, `purchase-flow.spec.ts` (contracts, 74 passed 2026-10-14 for 4 files incl. these) | Names overlap workbook VIP; mechanics differ |
| BR-CODE-08 | Points caps/debt/spendable (`points_rebuild.sql:88-98,155-169`); peso conversion + tier discounts (probe) | `points.spec.ts` (contracts+handlers) NOT RUN except contracts file in 74-passed batch | Entire engine unapproved |
| BR-CODE-09 | Redemption txn (`phase4_redemption.sql:208,334,359,374`; lock order membership→customer→item→account) | `redemptions.spec.ts`, `redemption-pos/catalog.spec.ts` NOT RUN | Server-priced; client sends no figures |
| BR-CODE-10 | QR/fallback rotation (`claim/reissue` RPCs, Phase 3 migration); gov-ID write-only grants | `phase3-migration.spec.ts`, `customer-security.spec.ts` NOT RUN | No workbook counterpart |
| BR-CODE-11 | Ownership-only customer access (`api/_lib/customer-access.ts`); staff permission model (`afhomes-access.ts`) | `authorization.regression.spec.ts`, `customer-portal.spec.ts` NOT RUN | Governance-adjacent; unapproved as business rule |
| BR-CODE-12 | Sellability guard (`commerce.ts:173-184`); input normalization (`input.ts`, `input.spec.ts` in 74-passed batch) | `commerce.spec.ts` + `input.spec.ts` passed 2026-10-14 — TEST_VERIFIED (helper behavior) | Validation, not policy |

## Counts (corrected 2026-10-14, Phase 2A; extended Phase 5 — originally miscounted as 48)

- Documented rules: 55 (BR-GEN 7, ENG 5, QLF 6, AUTH 2, REV 3, PB 4, ACM 4, PAR 2, DUAL 3, RATE 6, CTL 6, CUT 2, OPS 5 — of which 1 PARTIAL source, 2 OUT_OF_SCOPE)
- Code-observed: 12 (3 with TEST_VERIFIED helper behavior, 9 IMPLEMENTED_UNVERIFIED or NOT RUN)
- Implementation: TEST_VERIFIED 1 (BR-RATE-06), NOT_IMPLEMENTED 34, PARTIAL 15, MISMATCH 1, NOT_ASSESSED 2 (BR-CUT-01/02), OUT_OF_SCOPE 2 — no other TEST_VERIFIED at rule-conformance level
- Missing sources blocking: 12 files (C3–C7, D1–D7); Master List identity unresolved

## Last reviewed

2026-10-14 — Phase 1 extraction. No approvals recorded. Next: stakeholder review per `OPEN_QUESTIONS.md`.
