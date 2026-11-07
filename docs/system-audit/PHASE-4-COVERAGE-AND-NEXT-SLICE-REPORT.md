# Phase 4 Report — Remaining Coverage and Next Slice

- Date: 2026-10-14 (UTC). No application behavior changed; no migrations run/written; no production data touched; ZIP preserved. Pre-existing user deletions under `docs/security/` left untouched (working tree otherwise as found).
- Test execution: full `./api` suite 108 files / 2131 tests green; `./packages/shared` 41 green; `./packages/contracts` 226 green; targeted 92 green. Cumulative executed this session: 800 (Phase 3) + 92 + 2131 + 41 + 226 + 2 (S1 spec, counted in Phase 3's 800? No — S1 ran in Phase 3 after the 800 count; count it once here: total session executions ≈ 708 + 92 + 2131 + 41 + 226 = 3198 passes, 0 product failures).

## 1. Tests executed, pass/fail, skipped

- `phase3-migration + phase4-migration + sale-number-regression + member-lookup-authorization` — 92 passed. Migration specs are pure unit (SQL-text tripwires, no DB) — safe as run.
- Full `./api` suite — 2131/2131 green on re-run. First run showed 1 failure: `customer-import-security` zip-bomb test **timed out** (5s limit, 5.8s under 108-file parallel load). Investigated, not adjusted: solo re-run 20/20 green in 4.06s; the guard works — the spec's own 9MB CRC+deflate setup is slow under load. Environmental flake, not a product bug; no assertion touched.
- Full `./packages/shared` (41) and `./packages/contracts` (226) — green.
- "Commission handler specs": verified no standalone file exists — covered by `phase26-finance.spec.ts` (run green). Record corrected in TEST-PLAN.
- Skipped: apps/web + apps/admin jsdom suites (full monorepo `pnpm test` not run this phase); `test:db:local` (needs Q10). No DB behavior claimed.

## 2. Correction-flow findings (source vs code)

- Card payments: `recorded → verified|rejected` only, verified terminal, reason-required for reject (`sales.ts:744-817`; `lifecycle.ts:223-228`); `voided` map-permissive but unexposed (no void endpoint); verified stamps `verified_by/at` (migration `:275`).
- Sale cancel: draft-only + transition-map + payment/membership/commission guards (`sales.ts:995-1078`).
- Commissions: qualify→`cancelled` with mandatory reason (`commissions.ts:397-399`); header explicitly states no clawback rule exists and none invented (`:16`).
- Operational purchases: full reverse/refund/point-refund machinery (reason-required, already-reversed guards, reversal-debt blocks spend-not-earn — `points.ts` routes).
- Redemptions: void columns unwritten by design.
- Documented: BR-QLF-04 strip-on-refund (R15) has **no card-payment target** in v2 (no refunds) — applying it would invent card refunds; operational reversals are CODE_ONLY (no source). Conclusion: correction is per-domain by evidence; no generic void endpoint (would invent cross-domain semantics); BR-CTL-02 correction design still needs per-domain semantics + Q1. Recorded in BR-CTL/BR-QLF files, not implemented.

## 3. Slice selected: none — with evidence

Re-evaluated all NOT_IMPLEMENTED/PARTIAL/MISMATCH rows against §4 criteria. Every candidate is either already conformant (stamp, freeze, verify gate, ordering — now test-pinned), model-blocked (all payroll X-lane, Q1), gate-blocked (W1: Q3+Q2), authority-blocked (CTL-05, CUT-01/02), or would invent policy (gaplessness, zero-deferral where 0% is legal, console UX, self-approval ban with security blast radius). Per §5, no implementation fabricated. Standing instruction holds: the moment Q1/Q3 land, W1–W4 proceed without further per-rule approval.

## 4. Files changed

Docs only: `TEST-PLAN.md` (executed lists + flake note), `BR-CTL-controls.md` (CTL-02 finding), `BR-QLF-qualification.md` (QLF-04 inapplicability), `CHANGELOG.md` (1 entry). This report. Phase 3's `sale-creation-order.spec.ts` untouched and still green.

## 5. Tests from this phase and results

92 + 2131 + 41 + 226 green (plus solo 20/20 confirming the flake). No new specs needed — coverage already existed wherever behavior exists.

## 6. Remaining mismatches and blockers

Unchanged: MISMATCH BR-QLF-02; BLOCKED RATE-05/CTL-05/CUT-01/02; Q1/Q2/Q3/Q4/Q7/Q10 open. Missing facts gating slices: Q3 gate values + Q2 backfill (W1); Q1 scope (W2/W3/W4/X-lane); Q7 figure (RATE-05); ruling for CTL-05; Q10 for DB proof. Each fact's necessity documented in OPEN_QUESTIONS/ROADMAP.

## 7. Next slice

W1 qualification gate on Q3+Q2 rulings (highest impact); absent those, W5 correction-flow design (needs Q1 void-semantics authority) or remaining app-suite + Q10 DB execution. Lane 4 stays closed without Q1.
