# Test Plan — Business Rules

- Created: 2026-10-14 (Phase 2E). No requirement is verified until a test checking the documented business rule has actually been executed successfully.
- Conventions: `EXECUTED <date>` = ran with result recorded. `NOT RUN` = file exists, never executed this phase. `NEW` = to be written. DB-backed specs need Q10 (`pnpm test:db:local`) approval; unit specs run offline.

## A. Existing tests actually executed (all pass — helper/contract level unless noted)

| Spec | Command | Result | Covers |
|---|---|---|---|
| `packages/shared/src/money.spec.ts` | `pnpm --filter ./packages/shared exec vitest run src/money.spec.ts` | 14 passed 2026-10-14 | BR-CODE-01/02/05/06/12 helpers |
| `api/_lib/commerce.spec.ts` | `pnpm --filter ./api exec vitest run _lib/commerce.spec.ts` | 33 passed 2026-10-14 | BR-QLF-03, BR-RATE-01, BR-CODE helpers |
| `packages/contracts` input + purchase-flow + redemption + points specs | `pnpm --filter ./packages/contracts exec vitest run src/schemas/input.spec.ts src/schemas/purchase-flow.spec.ts src/schemas/redemption.spec.ts src/schemas/points.spec.ts` | 74 passed 2026-10-14 | BR-CODE-07/08/12 contract shapes |
| `phase26-finance` + `phase2` + `sale-payments` + `sale-cancel` specs | `pnpm --filter ./api exec vitest run _handlers/phase26-finance.spec.ts _handlers/phase2.spec.ts _handlers/sale-payments.spec.ts _handlers/sale-cancel.spec.ts` | 183 passed 2026-10-14 | Verify/idempotency/snapshot/seller/cancel handler contracts (scripted RPCs; SQL proven by db-integration) |
| authz + schemes + audit + normalize batch | `... authorization.regression.spec.ts role-baseline.spec.ts vip-payment-schemes.spec.ts referral-contexts.spec.ts _lib/audit-sanitize.spec.ts input-normalization.spec.ts` | 135 passed 2026-10-14 | Invariants A–H, baselines, scheme validation, audit sanitization |
| redemption + points + OST + portal batch | `... redemptions.spec.ts redemption-pos.spec.ts redemption-catalog.spec.ts points.spec.ts ost-accreditation.spec.ts customer-portal.spec.ts customer-security.spec.ts phase7-genealogy-migration.spec.ts` | 267 passed 2026-10-14 | Redemption txn, points endpoints, OST workflow, portal authZ, genealogy |
| NEW `sale-creation-order.spec.ts` (BR-RATE-01/06) | `pnpm --filter ./api exec vitest run _handlers/sale-creation-order.spec.ts` | 4 passed 2026-10-14 | Rule conformance: rejected seller / unconfigured scheme / unsellable product → zero number calls + no row; one number per sale |
| NEW `customer-creation-order.spec.ts` (BR-RATE-06) | `pnpm --filter ./api exec vitest run _handlers/customer-creation-order.spec.ts` | 3 passed 2026-10-14 | Rule conformance: duplicate gov-ID/email → 409 + zero number calls + no row; one number per registration |
| `pnpm check:env` | `pnpm check:env` | PASS 2026-10-14 (589 browser + 211 server files) | BR-OPS-02 equivalence evidence |
| `tsc --noEmit` (api) | `pnpm --filter ./api exec tsc --noEmit` | clean 2026-10-14 | New spec typechecks; no regressions |

## B. Existing tests NOT executed (run before relying on them)

Still NOT RUN: full monorepo `pnpm test` (apps/web + apps/admin jsdom suites), `pnpm test:db:local` suite (needs Q10). Moved to executed 2026-10-14: all of the Phase 3 list plus `phase3/phase4-migration` (92 tests), `sale-number-regression`, `member-lookup-authorization`, full `./api` suite (108 files / 2131 tests green on re-run; one load-induced timeout flake on the `customer-import-security` zip-bomb test under parallel load — 20/20 green solo, guard verified, no code change), full `./packages/shared` (41) and `./packages/contracts` (226). Commissions handler behavior is covered via `phase26-finance.spec.ts` (no standalone commissions spec exists).

## C. New tests needed (per rule; categories: normal, boundary, invalid, exception, transition, reversal, effective-date, auth/audit, DB invariants)

- Qualification: auto-qualification.spec (normal 30% VIP qualifies; boundary exactly 25%/10%; invalid unapproved 12% counts nothing; transition date appears+freezes; reversal refund strips + clears; effective-date threshold raise leaves frozen); threshold-gate.spec (BLOCKED on Q3 for expected values — write only after ruling); refund-strip.spec (CANCELLED/UPGRADED/DOWNGRADED all strip; replacement from zero); prospectivity.spec (raise/lower threshold; frozen untouched; live judgement for unqualified).
- Bonus: equivalent-tcp.spec (SSM 20M/1.8M → 135,000; SVD same figures → nil; boundary collection = quota; invalid below quota; boundary rate exactly 40% → actual-TCP path); no-floor.spec (9% rate pays given gates); table-a.spec (grid values; SVD 2% < SSM 3% pinned against "correction"); quota-gate.spec (aggregate monthly; independent of per-sale gates).
- Assumed credit: assumed-credit.spec (40%/20% rates; boundary inherited vs own; invalid in-post leader/seller get nil — RV-36; transition vacancy rolls upward; reversal credit never touches Override); credit-routing.spec (chain-carried attribution; no register).
- Engagement/periods: start-day-flag.spec (non-1st/16th flags, never blocks); period-classification.spec (contract-start drives; blank → EP + warning); first-month-ba.spec (zero production still full BA; Director withhold path); proration.spec (16/31; NORMAL/FOR-CAUSE identical arithmetic); transitional-split.spec (RV-19 three-month shape).
- Reviews: qp-review.spec (PASS retains / FAIL terminates at period end); streak-review.spec (from 3rd month; pair recorded, no double-ask); unreviewed-retains (pending count; silence never terminates).
- Rates: zero-rate-deferral.spec (BUG-001: name-after-number still freezes real rate); anniversary-rate.spec (new sales only; remainders keep old); sale-rate-unlock.spec (single cell; PENDING; re-approve; others unchanged); default-rates.spec (BLOCKED on Q7).
- Controls: approval-lock.spec (unapproved counts nothing; stamp account+time; whole-row lock); correction-flow.spec (unlock → original clerk → re-approve; no workaround); close-month.spec (values-lock; repeat refused; warn on unapproved; abort+override logged); director-console.spec (eleven actions; range-check; inflation warning; abandon logged); referral-right.spec (BLOCKED on authority); six-column-log.spec (schema parity or certified mapping).
- Genealogy/dual: succession-filter.spec (pre-appointment excluded); team-aggregation.spec (whole-tree cover); double-cut.spec (RV-14: neither paid); broken-chain.spec (warn never blocks; correction clears); dual-engagement.spec (distinct numbers; per-team figures; 3 warnings); back-date.spec (8mo → month 9; 14mo → ENDED; overdue review expected).
- Cutover: cutover.spec (BLOCKED on Q2: sub-threshold whenever-entered excluded; credited preserved; 15%-VIP boundary case).
- Cross-model (Lane 4): first-month-runbook.spec (may be procedural checklist, not automated); close-month + ledger immutability incl. DB invariants (frozen months read-only; locks held in-transaction); stage-release.spec (VIP 40%→100%, IGP 40%→40%, remainder on full).

## D. Rules requiring new tests before any conformance claim

All 52 applicable rules: none has an executed rule-conformance test today. Highest priority (Phase 2D items): QLF-02/03/04, QLF-05, CUT-01, PAR-01, AUTH-01, CTL-03, and the points-engine surface (BR-CODE-08, largest unapproved area — needs Q9 scoping first).
