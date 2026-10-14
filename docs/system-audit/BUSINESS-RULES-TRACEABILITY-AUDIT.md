# Business Rules Source Audit and Code Traceability — AF Homes Ecofarm v2

- Date: 2026-10-14 (UTC)
- Scope: read-only comparison of `Business Rules.zip` against the v2 codebase. No project source files modified; no installs, migrations, deploys, or DB access.
- Inputs: ZIP at `C:\Users\SSD-ORLANDO\Documents\AF Homes Document\Business Rules.zip` (streamed for reading; scratch copies lived in the approved temp dir, never in the repo); current repo working tree; prior system-architecture audit (used as a guide, re-verified at cited points).
- Not inspected: cell-level audit of all workbook formulas (two VBA functions evidenced at body level), B5/B6 deployment matrices, JAD-side file internals (inventoried only), any test execution.
- Conventions: VERIFIED (directly read) / INFERRED (probe-reported, not re-run) / UNKNOWN (no evidence). DOCUMENTED FACT vs EXISTING CODE BEHAVIOR vs INTERPRETATION vs RECOMMENDATION are kept separate.
- Standing warning: code behavior is existing behavior, **not** approved policy. Nothing here designates any rule authoritative.

Corrections to the prior architecture audit, found by direct inspection: (1) `docs/AFHOMES_V2_ID_GENERATOR_BUSINESS_RULES.md` does **not** exist — VERIFIED by `docs/**/*.md` glob (9 files: system-audit, supabase ×7, security ×1). No business-rule-like document exists in the repo. (2) The lifecycle SSOT path is `packages/contracts/src/schemas/lifecycle.ts`.

## 1. Package Inventory and Version Assessment

ZIP VERIFIED readable via `unzip -l`. 19 entries = 1 folder + 18 files, all under `Business Rules/`.

| # | Filename | Bytes | Zip mtime | Pack | Format |
|---|---|---|---|---|---|
| A1 | `A1-JA_D_IGP_Numbering_Sales_Report_Generator-v4_2_0-BUILD_2026-09-10a.xlsx` | 736,694 | 2026-10-01 | A | workbook (JAD) |
| A2 | `A2-AFhomes_VIP_IGP_Integrated_Generator-v10_2_0-BUILD_2026-09-10a.xlsx` | 978,768 | 2026-10-01 | A | workbook (AFhomes) |
| A3 | `A3-JA_D_IGP_Numbering_Sales_Report_Generator-User_Guide-2026-09-10a (1).docx` | 16,958 | 2026-10-01 | A | user guide (JAD) |
| A4 | `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` | 17,043 | 2026-10-01 | A | user guide (AFhomes) |
| A5 | `A5-JAD_Operations_Manual-2026-09-10a.docx` | 16,884 | 2026-10-01 | A | ops manual (JAD) |
| A6 | `A6-AFhomes_Operations_Manual-2026-09-10a.docx` | 16,910 | 2026-10-01 | A | ops manual (AFhomes) |
| A7 | `A7-QA_Glossary-Ambiguous_Terms-2026-09-10.docx` | 13,814 | 2026-10-01 | A | glossary (both) |
| B1 | `B1-JAD_Generator_v4_2_0_VBA_Module-RevE.txt` | 76,695 | 2026-10-01 | B | VBA (JAD) |
| B2 | `B2-AFhomes_Generator_v10_2_0_VBA_Module-RevE.txt` | 68,648 | 2026-10-01 | B | VBA (AFhomes) |
| B3 | `B3-JAD_Sheets_Control_Module_AppsScript-v2_13.txt` | 41,126 | 2026-10-01 | B | Apps Script (JAD) |
| B4 | `B4-AFhomes_Sheets_Control_Module_AppsScript-v2_1.txt` | 44,070 | 2026-10-01 | B | Apps Script (AFhomes) |
| B5 | `B5-JAD_Google_Sheets_Deployment_Plan-2026-09-10a.docx` | 11,264 | 2026-10-01 | B | install plan (JAD) |
| B6 | `B6-AFhomes_Google_Sheets_Deployment_Plan-2026-09-10a.docx` | 11,309 | 2026-10-01 | B | install plan (AFhomes) |
| B7 | `B7-JAD_v4_2_0-Build_Note_and_Module_Hooks.docx` | 28,392 | 2026-10-01 | B | build note (JAD) |
| B8 | `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx` | 18,295 | 2026-10-01 | B | build note (AFhomes) |
| C1 | `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx` | 13,002 | 2026-10-01 | C | checklist (both) |
| C2 | `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` | 24,218 | **2026-10-11** | C | ruling addendum (both) |
| IDX | `MASTER_FILE_INDEX-BUILD_2026-09-10a.docx` | 12,080 | 2026-10-01 | — | index |

Version assessment, VERIFIED: the index claims **30 files** (24 Word incl. index + 2 workbooks + 4 code); the ZIP holds 18. The 12 absent files are exactly Pack C C3–C7 (5 service contracts) and Pack D D1–D7 (7 QA archive files) — 18+12=30, so the ZIP is Packs A+B, C1–C2, plus the index. No duplicates. Build stamp `BUILD 2026-09-10a` VERIFIED present in both workbooks' `xl/sharedStrings.xml`. Anomaly: C2's zip mtime is 2026-10-11, ten days after every other entry — C2 was added or replaced later. The three superseded builds named in the index (21 Aug first issue, 31 Aug pair, 2026-08-21b/c) are correctly absent. Rev B / Rev C memoranda and the superseded Build Specification (D7) are referenced as authority but **not in the package** — their original text is UNKNOWN.

## 2. Verified Master List and Reading Order

- **C2** VERIFIED: ruling addendum (R1–R26 + RV acceptance cases). **C1** VERIFIED: go-live checklist §§1–7. **A flow** VERIFIED: A4 user guide (§§1–10) + A6 operations manual (Parts 1–6 + appendices) alongside the A2 workbook + B2/B4 modules.
- **"Master List" — UNKNOWN.** No file or workbook sheet carries that name. A2 sheets enumerated from `xl/workbook.xml`: START HERE, Control Panel, Backup Log, Dashboard, Generator, IGP Generator, IGP Register, Payment Plan, Collections, Register, Accreditation, Engagement Reviews, ID Lookup, Team Roster, Reference, Monthly Stats, TCP/Combined/Finance/Commission Reports, Closed Deal TCP Audit, Payroll Summary, Commission Ledger, VIP/IGP Intake (A1 similar minus IGP sheets). Rejected candidates: MASTER_FILE_INDEX (a distribution index, explicitly "not part of any pack," not a rule list); the Reference sheet / Table A grid (a parameter table, never called Master List); the Accreditation/AATS personnel sheets (registers, not rule lists). Do not proceed as if the order's first step were satisfied — ask the stakeholder what "Master List" denotes.

## 3. Workbook and User Guide Structure

A4 and A6 agree with each other and with C2/B8 on every AFhomes point checked. Operating model DOCUMENTED FACT: clerks enter (sales → Registers, receipts → Collections, people → Accreditation) → supervisors approve (stamps account + server time, locks whole row) → Director runs monthly settlement (reviews → audit sheet → payroll → Close Month writes values to Commission Ledger, irreversible). Two parallel pay systems: COMMISSION (DSC/DRI, follows accreditation, outlives engagement) vs ALLOWANCES (BA/PA/PB, follows service contract). B2 exposes 57 procedures VERIFIED by name (`FreezeSaleRates`, `FreezeQualifiedDates`, `HandleApproval`, `LockRow`, `CloseMonth`, `DirectorSetParameter/SetPersonRate/UnlockRow/UnlockSaleRate/OverrideClosedDealDate`, review-board + audit-log subs); B4 exposes 33 functions incl. all eleven Director actions and 6-column logging (Timestamp, User, Sheet, Cell(s), Old, New). Closed-deal engine VERIFIED at source level in B2 `QualFormula`: date = earliest receipt where sale-number+product match, approved flag=1, cumulative ≥ threshold×TCP, no negative receipt, sale status blank/ACTIVE, sale#/TCP present — exactly R12–R15 as documented. Rate-freeze BUG-001 fix VERIFIED in B2 `FreezeSaleRates` body (zero rate stays live, with explanatory comment).

## 4. Business Rules Inventory (proposed IDs — tracking labels only, not approvals)

| ID | Rule (faithful summary) | Source |
|---|---|---|
| BR-GEN-01…07 | R1–R7: vacant post earns nil, downline rolls up; override exact to receipt date; successor inherits genealogy only; whole-tree cover (R5); BA/PA day-pro-rated incl. appointments, Override/PB not pro-rated; successor window never limits upline | C2 §3 VERIFIED |
| BR-ENG-01…04 | R8–R11: starts 1st/16th (others flagged, not blocked); contract-start (not accreditation) drives QP/EP; BA compliance-based, no production test (R10a); 16th-of-31-day-month = 16/31; transitional month splits QP + correction stretch, one assessment per stretch | C2 §3, A4 §3.3/§8, A6 §2.3 VERIFIED |
| BR-QLF-01…04 | R12–R15: automatic qualification on approved collections (VIP 25%, IGP 10%); date freezes, threshold changes prospective only; any refund/cancel/upgrade/downgrade strips qualification, replacement qualifies from zero; closed-deal gate ≠ stage-1 payout gate (VIP 40%→100%, IGP 40%→40%) | C2 §3, B8 §2, A4 §3.4 VERIFIED |
| BR-AUTH-01/02 | R16–R17: all pay-governing figures + per-person rates Director-only, range-checked, inflation-direction warned, logged old→new, abandon-at-warning logged; deviation returns row to PENDING | C2 §3, A6 §5.1 VERIFIED |
| BR-REV-01…03 | R18–R20: QP review board (PASS retains, FAIL terminates at period end); below-target review from 3rd natural month, pair recorded; unreviewed = retained, pending count on open | C2 §3+§5 RV-24, A6 §5.4 VERIFIED |
| BR-PB-01/02 | R21 + Table A: no Equivalent-TCP floor (B19=0%); Equiv TCP = collection/40% capped at Team TCP, gated by quota = 40% of own PB threshold; SM 200k/1M/2M–15k/15k–1%, SSM 600k/2M/4M–25k/25k–3%, SVD 1.8M/5M/10M–50k/50k–2% (SVD<SSM deliberate); 40% monthly collection quota gates PA+PB, aggregate, independent of per-sale gates | C2 §4, B8 §2, A4 §7 VERIFIED |
| BR-ACM-01 | R23: assumed credit 40% VIP / 20% IGP toward BA/PA/PB + 40% quota + below-target review; never Override; seller keeps DSC/DRI; automatic via current upline chain; Director-adjustable rates | C2 §4A, A4 §7, A6 §5.5, B8 §1/§5 VERIFIED |
| BR-PAR-01 | R24: commission system parallel to engagement (follows accreditation incl. OST); BA/PA/PB engagement-side; neither conditions the other | C2 §4A, A4 §1 VERIFIED |
| BR-DUAL-01/02 | R25–R26: dual engagement = 2 accreditation rows, link column, 3 warnings; transfers mutate the row; back-dated dates accepted (12mo+ reads CONTRACT ENDED); BROKEN CHAIN warns, never blocks | C2 §4A, A4 §8, A6 §5.6 VERIFIED |
| BR-RATE-01…03 | DSC/DRI frozen at number issue, zero not frozen; anniversary reviews; early-performer single-cell unlock; new sales only carry new rates | A4 §3.1, A6 §5.2/5.3, B2 `FreezeSaleRates` VERIFIED |
| BR-CTL-01/02 | Approval locks whole row (correction = Director unlock → clerk corrects → re-approve); Close Month writes values, refuses repeats, warns on unapproved; 11 named Director actions; REFERRAL RIGHT—REVIEW (>1yr referrer accreditation → Director decision, not blocked) | A6 Parts 3/5/6, A4 §6, B2/B4 listings VERIFIED |
| BR-CUT-01 | No-grandfathering cutover 27 Sept 2026: sub-threshold sales never count whenever entered; credited Closed Deals protected by contract; AFhomes VIP register check (15%-down sales counted before, not now) | C1 §3, index Pack C VERIFIED |
| BR-OPS-01 | Go-live prerequisites: contract-start for every person (blank = silent underpayment), placeholder passwords changed, Rev E/v2.1 only, dated backups, month-start personnel changes | C1 §§1–4/6, C2 §6 VERIFIED |

OPEN within sources: B8 §2 lists DSC IGP 8% + DRI 5%/4% but **no VIP DSC default** — UNKNOWN whether omitted or elsewhere (Control Panel unread at cell level). Glossary "CLOSE OVERRIDE" exists only in A7/A4 — no C2 ruling cites it. Rev B/C original texts absent, so the two §2 supersessions rest on C2's word alone.

## 5. Rule-to-Code Traceability Matrix

Repo-wide grep for `DSC|DRI|Equivalent TCP|assumed credit|Qualifying Period|Close Month|Table A|ClosedDealDate` returns **zero true code matches** (only `DRINKS`/`DRIFT` substrings) — VERIFIED. The v2 application implements a different commercial model (membership cards + points + single-level commission) than the workbook payroll (BA/PA/PB + DSC/DRI). Mapping is principle-level, never formula-level:

| Rule ID | Company source | v2 implementation (file:line) | DB enforcement | Tests | Class |
|---|---|---|---|---|---|
| BR-QLF-01 (25%/10% auto-qualify) | C2 §3; B8 §2 B13/E13 | None — activation requires 100% verified: `supabase/migrations/20260927000003_afhomes_phase2_rpc.sql:418,431` (`SALE_NOT_FULLY_PAID`) | `activate_card_sale` re-sums in-txn | `phase2.spec`, `phase26-finance.spec` (probe) | **MISMATCH** — same subject, materially different gate; needs stakeholder ruling on whether v2 cards = workbook VIP product |
| BR-QLF-02 (freeze, prospective) | C2 R14; B8 | Frozen snapshots `api/_lib/commerce.ts:193-201`; rule effective windows `20261018000002_afhomes_flexible_commission_rules.sql:11-12,111-112`; 4%→0 history-untouched `:130` | no-overlap trigger `:26-37`; snapshots never recomputed | `commerce.spec`, commissions specs (probe) | **PARTIAL** — prospectivity matches; per-sale qualification dates don't exist in v2 |
| BR-QLF-03 (refund strips) | C2 R15 | `recorded→verified\|rejected\|voided`; only verified counts `api/_lib/commerce.ts:50-114`, `phase2_rpc.sql:78-132` (probe) | status CHECKs (probe) | `sale-payments.spec` (probe) | **PARTIAL** — rejection/void exclusion matches; no frozen-qualification stripping in v2 |
| BR-RATE-01 (rate frozen at issue) | A4 §3.1; B2 `FreezeSaleRates` | `snapshotSaleTerms` freezes rate + expected commission `api/_lib/commerce.ts:193-201`, `sales.ts:496` (probe) | snapshot columns on `card_sales` | `commerce.spec:27-56` (probe) | **PARTIAL** — same freeze principle, different rates; no zero-rate-deferral case evidenced in v2 |
| BR-AUTH-01 (Director-only figures) | C2 R16–R17 | Permission-gated manual `earned` with mandatory notes `packages/contracts/src/schemas/lifecycle.ts:240-244`, `commissions.ts:362,426` (probe) | RLS + `authorizeAfHomes` | `authorization.regression.spec` (probe) | **PARTIAL** — gated-change principle matches; no parameter console / old→new log / PENDING-reapproval in v2 |
| Approval gates counting | A6 Part 3 | `verify_card_payment` recorded→verified gate `phase2_rpc.sql:224-352` (probe) | in-txn recompute | `sale-payments.spec` (probe) | **PARTIAL** — two-step count-before-money in both; approver model differs |
| BR-GEN / BR-ACM / BR-DUAL | C2 R1–R7/R23/R25 | `referral_relationships`, `correct_referral_upline`, adjacent-only hierarchy (probe); no vacancy roll-up, assumed credit, dual rows, or chain check evidenced | UNKNOWN beyond probe | genealogy specs (probe) | **SOURCE_ONLY** (genealogy skeleton PARTIAL at most) |
| BR-PB / BR-ENG / BR-REV / BR-CTL / BR-PAR | C2 R8–R11/R18–R22/R24; Table A; Close Month | No BA/PA/PB, DSC/DRI/Override release, Equivalent TCP, QP/EP, reviews board, Close Month, or ledger (grep VERIFIED absent) | — | — | **SOURCE_ONLY** |
| Points engine, 7-day spot-cash, VIP schemes, redemption txn, QR rotation, seller downline, tier discounts, 40%-quota-like gates | — (no workbook counterpart found) | `api/_lib/commerce.ts`, `identifier.ts`, `20261104000001_afhomes_points_rebuild.sql:88-98` (caps 25/40/60k VERIFIED), `phase4_redemption.sql` (probe), `lifecycle.ts:51-53,239-244` VERIFIED | lock orders, CHECKs, idempotency (probe) | money/commerce/points/redemption specs (probe) | **CODE_ONLY** — needs business validation before write-up as rules |
| BR-CUT-01 (no grandfathering) | C1 §3 | No per-sale qualification threshold exists to grandfather; closest analog is prospective 4% zeroing (probe) | — | — | **UNVERIFIED** — needs ruling on whether the cutover binds v2 data |

No CONFLICT within the present sources on AFhomes figures (B8 Table A = C2 RV-25 arithmetic: 3% × 4.5M = 135,000 ✔). C2's self-correction (thresholds stricter-than-contract, resolved 21 Aug via contract addendum) is resolved inside C2 itself — but the addendum instrument and v4.3/v2.4 contracts are **absent** (C3–C7), so the resolution is DOCUMENTED FACT, not independently evidenced.

## 6. Critical Computation Findings

A. Documented: closed-deal date = first approved-receipt date taking cumulative to 25%/10% (formula VERIFIED in B2 `QualFormula`); Equivalent TCP = collection/40% capped at Team TCP, quota-gated (worked example VERIFIED in C2 §4 + B8 §5: SSM pays 135,000, SVD nil on identical figures); assumed credit 40%/20% reaching BA/PA/PB/quota/review (A4 §7, columns AG/AH); Table A grid (B8 §2); VIP 40%→100% / IGP 40%→40% release (B8 §2); day-pro-ration incl. 16/31 (C2 R10); no floor B19=0% (C2 R21).
B. Code behavior: 100%-verified activation (`phase2_rpc.sql:431` VERIFIED); single-rate commission price×rate with account→role→0 precedence + effective windows (`flexible_commission_rules.sql:3,82,111-112` VERIFIED); points caps 25k/40k/60k + `spendable=greatest(0,balance-reversal_debt)` (`points_rebuild.sql:95-98,163` VERIFIED); manual `earned` only (`lifecycle.ts:240-244` VERIFIED); money exact-decimal + BigInt (probe).
C. Test-verified: none executed in this audit; all test citations INFERRED from probe until `pnpm test` / `test:db:local` run under approval.
D. Reasonable interpretations (flagged as such): workbook VIP product ≈ v2 VIP card plans (shared "AFhomes VIP" name, threshold/collection concepts) — plausible but UNCONFIRMED; v2 full-payment activation as strict successor of the 25% line — plausible, unconfirmed.
E. Unresolved: every number in §4 requires stakeholder sign-off; the MISMATCH rows cannot be settled from documents alone.

## 7. Source Conflicts and Missing References

1. "Master List" unresolvable (§2) — blocks the prescribed reading order at step 1; cannot certify complete coverage. Owner: package author / Finance Director.
2. C2 mtime 2026-10-11 vs pack 2026-10-01 — signed version, later edit, or re-export? The 27-Sept cutover lives in C1/index, not C2. Owner: document owner.
3. Rev B / Rev C / pre-21-Aug C2 draft / contract addendum / v4.3 + v2.4 contracts / Pack D all absent — supersession claims and contract-gap closure are single-source. Owners: president (contracts), QA archive holder (Pack D).
4. VIP DSC default missing from B8 §2 — formula gap; cannot trace VIP commission cost. Owner: Finance Director.
5. Workbook payroll model vs v2 application model (§5) — the structural conflict: v2 does not implement the documented payroll. A `docs/business-rules/` built from the ZIP alone would describe a system the app doesn't run, and vice versa. Owner: company president — is the workbook payroll still operative alongside v2, superseded by it, or out of scope?

## 8. Code-Only Behaviors Requiring Business Validation

Points accrual/spend/caps/debt/peso conversion; 7-day spot-cash window; VIP payment schemes (move_a/b1/b2/installment splits) and no-chaining; staff redemption transaction; QR/fallback issuance + rotation; 100%-verified activation + 12-month validity; seller eligibility + downline restriction; flexible commission precedence + 0%-legal default; service tier discounts + stacking flag; customer self-service redemption/refund paths (probe-reported). EXISTING CODE BEHAVIOR with no located company rule — none may be written up as approved without a source or new stakeholder ruling.

## 9. Documented Rules Missing from the Application

The entire allowance payroll (BA/PA/PB, Table A, 40% quota, Equivalent TCP), DSC/DRI/Override computation and release, assumed collection credit, QP/EP machinery with transitional split and day-pro-ration, both engagement reviews, dual-engagement rows, BROKEN-CHAIN/back-date handling, per-sale qualification thresholds and stage gates, Close Month/ledger/backup discipline, the 11-action Director console with old→new logging, referral-right review, and the no-grandfathering cutover — all SOURCE_ONLY per §5. If any govern live pay or live data, the application is incomplete against them; if superseded, that ruling must be recorded with authority.

## 10. Test Coverage and Verification Gaps

Workbook side: 30 RV cases × 4 implementations claimed passed (C1) + 44 pre-handover checks (Pack D, absent) + B8 self-tests (5 checks incl. worked figures VERIFIED as documented, not re-executed). App side: suites probe-reported (249 specs, 72 DB sections) but **not run** — all test citations INFERRED. Managed-stack behavior never executed pre-launch per prior audit. Gaps: no test links any workbook rule to any app behavior; no approved expected-results set for MISMATCH rows; cell-level workbook formulas beyond `QualFormula`/`FreezeSaleRates` not verified; B5/B6/JAD files not examined.

## 11. Stakeholder Questions and Required Approvals

President-only: (a) Is the workbook payroll still operative, and if so where — alongside v2, or replaced by it? (b) Does the 27-Sept no-grandfathering cutover bind v2 data? (c) Resolve the §5 MISMATCH rows with effective dates. (d) Execute/produce the absent C3–C7 contracts or confirm the addendum cure. Finance Director: Table A values + VIP DSC default + B19 posture + assumed-credit rates + anniversary/early-performer practice; "Master List" identity; C2 version authority. QA/archive holder: Pack D evidence for the 30-case claim. Engineering (informational): B5/B6 matrices if Sheets deployment matters; live-project re-verification before any migration.

## 12. Recommended Markdown Documentation Structure (RECOMMENDATION, not decision)

Single definition per rule, nothing duplicated:

```text
docs/business-rules/INDEX.md            ID → file → code → test → status map
docs/business-rules/_TEMPLATE.md        ID, version, effective_from/to, source ref
                                        (file+sheet/cell or page/section), statement,
                                        formula, inputs/outputs/exceptions, roles,
                                        code pointers, test pointers, open questions
docs/business-rules/BR-GEN-*.md  BR-ENG-*.md  BR-QLF-*.md  BR-AUTH-*.md
docs/business-rules/BR-REV-*.md  BR-PB-*.md   BR-ACM-*.md  BR-RATE-*.md
docs/business-rules/BR-CTL-*.md  BR-CUT-*.md  BR-OPS-*.md  BR-CODE-*.md (code-only, UNAPPROVED)
docs/business-rules/CONFLICTS.md        §7 items, unresolved, with owners
docs/business-rules/OPEN_QUESTIONS.md   §11 items, each with required approver
docs/business-rules/CHANGELOG.md        every rule change: old→new, authority, date
```

Traceability: rule ID in SQL comment + TS docblock + spec name (`br-qlf-01-*`); AGENTS.md points to INDEX; logic changes cite rule IDs; CODEOWNERS + coverage-style check (needs implementation approval, not designed here).

## 13. Readiness Assessment for Controlled Implementation

Not ready. The package is internally coherent and version-stamped (BUILD 2026-09-10a VERIFIED in both workbooks), but the reading order's first step is unresolvable (§2), 12 of 30 files are absent (§1), the top ruling file has a version anomaly (§7.2), no test was executed, and the documented payroll model and the application's commercial model do not meet (§5). Writing `docs/business-rules/` now would enshrine one side's numbers over an unsettled model question. Ready only for: stakeholder review of §§7/11, "Master List" identification, and a presidential ruling on §7.5. After that: scaffold, extract with UNVERIFIED marks, sign rule-by-rule with effective dates, backfill regression specs, re-verify the live project, then change one domain at a time.

## Final Safety Review

- No project source files modified (this file is the only new artifact, created on request); no installs, migrations, DB or deployment changes. External reads only.
- ZIP exists and is readable; 19 entries inventoried; MASTER_FILE_INDEX fully inspected before any other identification; C2/C1/A4/A6/A7 read in full; B2/B4 procedure-level verified with two function bodies evidenced; workbook sheets enumerated + build stamps verified; B5/B6/JAD internals and remaining cell-level formulas explicitly not inspected.
- Every material calculation carries its evidence (sheet/column/cell, function body, or migration file:line); classifications assigned per the mandated scale; conflicts left unresolved with named owners.
- No rule invented: rates, thresholds, dates, and exceptions appear only with source locations; interpretations labeled; nothing declared approved.

Prioritized approvals before anything is designated authoritative: (1) presidential ruling on whether the workbook payroll or v2's model governs (blocks everything); (2) "Master List" identity + C2 version authority; (3) §5 MISMATCH resolutions with effective dates; (4) missing C3–C7/D1–D7 or written confirmation they're not needed; (5) sign-off of each §4 rule with effective dates; (6) approval to run `pnpm test` + `test:db:local` so test evidence becomes VERIFIED.
