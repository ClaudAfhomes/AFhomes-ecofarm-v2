# Phase 2 Report — Verify Rules and Prepare Implementation Backlog

- Date: 2026-10-14 (UTC). Documentation/analysis only — no application, schema, migration, calculation, permission, or data changed. ZIP never repackaged; sources preserved.
- Test execution this phase: none beyond Phase 1's 121 helper-level passes (reused as cited; not re-run). No rule-conformance test executed — none claimed.

## 1. Documentation corrections made (CHANGELOG entries written)

1. Count miscount: INDEX claimed 48 documented / 60 total — actual 54 / 66 (per-file headers sum to 66, zero duplicate IDs). Corrected breakdown: NOT_IMPLEMENTED 34, PARTIAL 15, MISMATCH 1, NOT_ASSESSED 2, OUT_OF_SCOPE 2. Lesson: arithmetic over 14 files needs a recount check — added implicitly to verification below.
2. BR-CUT-02 OUT_OF_SCOPE → SOURCE_DOCUMENTED / NOT_ASSESSED: prior label lacked source evidence of non-applicability; v2-data applicability is Q2.
3. BR-OPS-03 OUT_OF_SCOPE basis strengthened with explicit evidence (IDX Pack B scope; C1 §4 workbook files; v2 `vercel.json` chain).
4. Typo fixes: BR-PB-01 source-location line; ROADMAP lane sentence.
5. INDEX CUT-01 row still carried a stale `UNASSESSED→NOT_IMPLEMENTED` status string — corrected to NOT_ASSESSED.

## 2. Rules checked against actual sources (Phase 2A 10-point check)

1. IDs: 66 headers, all unique, all in INDEX — PASS.
2. Source locations: B2 procedure lines re-verified by grep (:660, :534, :683, :386/398, :508, :870, :934, :1065, :1234, :1377, :1443); B2 1504 lines / B4 909 lines confirmed; C2/C1/A4/A6/A7/B8 citations match full texts streamed in Phase 1/2 sessions — PASS.
3. Numbers/formulas/dates: Table A, thresholds, gates, credits, 16/31, worked examples all carry refs; VIP DSC default honestly NOT DOCUMENTED (Q7) — PASS with noted gap.
4. Code refs: 28/28 cited handler/lib/spec/script paths verified to exist; key line numbers grep-confirmed (commerce.ts, money.ts, lifecycle.ts, phase2/phase4/commission/points migrations, commissions.ts:362-370, sales.ts:400/447/819-820, redemptions.ts:122-126, points.ts:194/231/927, customers.ts:78). Remaining handler line refs marked probe-reported — PASS with marking.
5. ID/domain changes vs traceability audit: traceability used finding numbers (F1–F15); Phase 1 introduced BR-IDs per the mandated template — intentional, mapped in Phase 1 report §5/matrix provenance. No silent reclassification found.
6. Source-vs-extraction conflicts: none found; two weak-authority spots already flagged (CTL-05 guide-only; CF-04 single-source) — PASS.
7. Status use: no TEST_VERIFIED at rule level (helper-level passes explicitly scoped); PARTIALs all state which part; MISMATCH single and justified; NOT_ASSESSED used for CUT-01/02 — PASS.
8. OUT_OF_SCOPE: QLF-06 (no shared artifact — solid); OPS-03 (now evidenced) — PASS after corrections 2–3.
9. Assumptions as fact: sweep found none; interpretations labeled (workbook-VIP ≈ v2-VIP; full-payment as strict successor; downline resemblance) — PASS.
10. Counts reconcile: 54 + 12 = 66 headers = 66 INDEX rows — PASS after correction 1.

## 3. Gap matrix and roadmap created

- `IMPLEMENTATION-GAP-MATRIX.md`: 54 rows (52 applicable + 2 OUT_OF_SCOPE marked `—`). MATCH 0, PARTIAL 15, MISMATCH 1, NOT_IMPLEMENTED 34, BLOCKED_BY_MISSING_SOURCE 4, OUT_OF_SCOPE 2. No generic "model mismatch" rows — payroll absence enumerated per capability.
- `IMPLEMENTATION-ROADMAP.md`: 4 independent lanes — Lane 1 decide-then-build (W1–W4), Lane 2 inspect-first (W5–W7), Lane 3 blocked (B1–B4), Lane 4 cross-model (X1–X4, Q1-gated). Per-item: rules, user/backend behavior, data, roles, calculations, audit, reuse, migrations, tests, acceptance, genuine gaps. No architecture decided; data-model notes are investigation prompts.
- `TEST-PLAN.md`: executed (121 helper-level) vs not-executed (≈25 specs + check:env + db suite) vs new (≈35 specs named per rule with normal/boundary/invalid/exception/transition/reversal/effective-date/auth-audit/DB categories).

## 4. Phase 2D — highest-impact items (source vs implementation)

1. Thresholds differ VIP/IGP: source C2 R13 + B8 B13/E13 + RV-20/self-test (15%≠30% VIP; 8%≠15% IGP). Impl: single 100% gate (`phase2_rpc.sql:431`). MISMATCH. Change: Q3 ruling first; then W1. Proceed now: document yes, build no.
2. Freeze + refund/cancel/upgrade/downgrade: source R14/R15 + RV-21/22 + verified `QualFormula` body. Impl: snapshots + verified-only (partial). Change: strip/restart semantics + frozen-date columns. Proceed: yes after Q1/Q3.
3. Qualification vs payout stages: source two-gates + B8 E10/F10/E11/F11. Impl: none (manual qualify→paid). Change: stage engine (Lane 4). Proceed: needs Q1.
4. Cutover scope: source C1 §3 + IDX (27 Sept; 15%-VIP boundary case). Impl: unassessed. Change: unknown until Q2/Q4. Proceed: no.
5. Commission/allowance/accreditation: source R24 + A4 §1. Impl: single model; OST↔commission untraced. Change: W7 inspection first. Proceed: inspect yes, build no.
6. Director editing/audit/reapproval: source R16/R17 + RV-23 + B2:1065/:1234. Impl: gated `earned` + `audit_events` (partial). Change: console/log-values/PENDING. Proceed: yes after Q1 scope.
7. Settlement/Close Month: source A4 §5.1 + A6 Part 6 + B2:683. Impl: idempotent activation + immutable snapshots (partial). Change: close routine + ledger discipline. Proceed: yes after Q1.
8. Points rules: source NONE in package. Impl: full engine observed (caps/spendable grep-verified). Change: unknown until Q9 scoping. Proceed: Q9 first; formulas exist in code but are unapproved.

## 5. Missing sources genuinely blocking specific rules

RATE-05 VIP DSC figure (Q7); CTL-05 authority (no ruling); CUT-01/02 Q2 ruling + Q4 instruments; Master List identity + C2 authority (documentation completeness); Q10 test-execution approval (all conformance claims). Nothing else is blocked — 48+ rules have actionable documented portions.

## 6. Work proceeding without further business-policy approval

Lane 2 inspections (W5–W7); TEST-PLAN B-list execution where offline (unit specs; check:env); B4 parallel resolution work; Lane 1 build prep short of behavior change (test scaffolding for unambiguous expectations, e.g. worked-example fixtures marked UNAPPROVED-expected until rulings land). Standing instruction preserved: clear documented rules need no per-rule re-approval once Q1 lands — mismatches fix toward the document.

## 7. Architectural assumptions that must NOT be made yet

No dual identity model (accreditation-number-keyed payroll vs person-keyed v2); no points↔allowance coexistence semantics; no payroll query architecture under Supabase free limits; no backfill/migration approach before Q2; no stage-release or close-ledger mechanism; no parameter-console schema. All recorded as investigation prompts in the roadmap, not designs.

## Files

Changed: `INDEX.md` (counts, CUT rows), `BR-CUT-cutover.md` (CUT-02), `BR-OPS-golive.md` (OPS-03 basis), `CHANGELOG.md` (3 entries). Created: `IMPLEMENTATION-GAP-MATRIX.md`, `IMPLEMENTATION-ROADMAP.md`, `TEST-PLAN.md`, this report. Application code, schemas, migrations, permissions, data: untouched.
