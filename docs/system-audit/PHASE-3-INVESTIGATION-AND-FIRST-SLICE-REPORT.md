# Phase 3 Report — Technical Investigation and First Implementation

- Date: 2026-10-14 (UTC). W5–W7 + B4 investigations complete. One new spec file created; no application behavior changed (tests only); no migrations run or written; no production data touched; ZIP preserved.
- Test execution: 708 tests passed across 20 spec files (all commands + counts below); `pnpm check:env` PASS; `tsc --noEmit` (api) clean; new spec prettier-clean.

## 1. Investigations completed (Part A, no behavior change)

- W5 correction flow: traced `PAYMENT_TRANSITIONS` (`lifecycle.ts:223-228` — recorded→verified|rejected|voided, terminal after), verify enforcement (`sales.ts:744-817` — recorded-only first transition, mismatched-decision 409, reason-required), stamp (`verified_by/at`, migration `:275`), cancel (draft-only + map + guards, `sales.ts:995-1078`). Findings: no unlock primitive exists; `voided` is map-permissive but unexposed in sales (no void endpoint); redemption voids unwritten by design. Correction design still needs per-domain void semantics + Q1 — recorded in roadmap, no code change.
- W6 secret hygiene: `pnpm check:env` PASS (589 browser + 211 server files). Equivalence recorded: C1 §2.1–2.4 → env model + VITE split; §2.5–2.6 → N/A; §2.7 custody → gap recorded, not built (procedural, no code target).
- W7 OST↔commission: resolver supports `p_seller_type='ost'` (`flexrules.sql:8,83-116`); `ost.ts:15` disclaims commission logic; sale creation hardcodes `'staff'` (`sales.ts:429-433`) — OST-targeted rules currently unreachable (dead path or future hook; needs product/Q1 decision). Recorded absence stands.
- B4: Master List still unresolvable (25 A2 sheets re-enumerated, no match); C2 mtime anomaly stands. Documentation blocks only.
- Ruled out as slices (evidence recorded): CTL-05 (v2 has no sale-referrer commission — subject absent, stays blocked); DUAL-02 as coded check (v2 single-link genealogy can't disagree with itself — stays blocked with finding); self-approval ban (conditional source + security blast radius + Q1 mapping — not first-slice material); sale-number gaplessness (not documented — would invent); zero-rate deferral (v2 0% is legal + deterministic — no hazard).

## 2. Tests executed (Part B + E)

- Phase 1 batch (121): shared money 14, api commerce 33, contracts 4 files 74 — all pass.
- `phase26-finance + phase2 + sale-payments + sale-cancel` — 183 passed.
- `authorization.regression + role-baseline + vip-payment-schemes + referral-contexts + audit-sanitize + input-normalization` — 135 passed.
- `redemptions + redemption-pos + redemption-catalog + points(handlers) + ost-accreditation + customer-portal + customer-security + phase7-genealogy` — 267 passed.
- NEW `sale-creation-order.spec.ts` — 2 passed. Total: 708 passed, 0 failed (one initial failure was a fixture-count error in my own assertion, fixed; code behaved correctly throughout).
- Not run: migration specs (phase3/4), `sale-number-regression`, `member-lookup-authorization`, commissions handler specs, full `pnpm test`, `test:db:local` (needs Q10). DB behavior never claimed.

## 3. Selected slice S1 and why (Part C)

BR-RATE-01 ordering half (A4 §3.1, A6 §2.1, C1 §5.4): salesperson resolved before number issuance. Why this one: identifiable company source; behavior independently clear; applies to the v2 workflow without touching the payroll/Q1 mismatch (ordering, not rates); offline-testable; no migration; and the repo's own BUG-001 history proves ordering bugs in this exact area are silent and real. Everything else candidate was already implemented (stamp, freeze, verify gate), model-blocked (payroll), authority-blocked (CTL-05), or would invent policy (gaplessness).

## 4. Rules implemented (Part D)

BR-RATE-01 (ordering half): verified conformant, pinned by test — no code change needed (seller resolution at `sales.ts:400` precedes `next_sale_number` at `:420`). DSC/DRI freeze half remains absent from v2 (rule stays PARTIAL — no whole-rule claim).

## 5. Files changed

- Created: `api/_handlers/sale-creation-order.spec.ts` (2 tests; prettier + tsc clean).
- Updated (traceability only): `BR-RATE-freeze.md`, `INDEX.md`, `IMPLEMENTATION-GAP-MATRIX.md`, `IMPLEMENTATION-ROADMAP.md` (W5/W6/W7 findings), `TEST-PLAN.md` (executed lists), `CHANGELOG.md` (2 entries). This report.

## 6. Test results

New spec 2/2 green. No regressions (all batches above green; api typecheck clean).

## 7. Remaining mismatches and blockers

Unchanged from Phase 2 except BR-RATE-01 ordering now TEST_VERIFIED: MISMATCH BR-QLF-02, 4 BLOCKED (RATE-05, CTL-05, CUT-01/02), Q1/Q3/Q2/Q4 open, Lane 4 gated.

## 8. Migration/historical-data risks

None introduced (no schema change; no backfill). Standing risks unchanged: any W1 backfill waits on Q2; OST-rule dead path must not be silently activated.

## 9. Next slice recommended

Lane 1 W1 qualification gate is the highest-value next slice but needs Q3 (gate values) + Q2 (backfill); without those rulings the next *unblocked* work is Lane 2 W5 correction-flow design (per-domain void semantics) or executing the remaining offline specs + Q10-gated DB suite. Do not start Lane 4 without Q1.
