# AF Homes pre-commit blocker resolution - 2026-10-11

Status: reservation blocker corrected locally; partial-refund policy implementation **BLOCKED pending explicit owner approval**. No commit, push, deployment, shared migration or real customer financial action.

## 1. Workspace and evidence map

Worktree C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote; claud/develop; HEAD fd05b35eb7feca613c0dbfd630b55b656580dcc8. Existing recovery edits preserved. Tracked historical migrations have no diff; 63 migration files, nine already-uncommitted additions. No migration is added or changed by this blocker-resolution task.

Before modification: prior audit records 15/16 reservation file, 2,369/2,369 PostgreSQL, 13/13 harness and the 1,000/900 requested-award discrepancy. Current exact reservation test alone passes; its full isolated file reproduces the failure. Source map: final-blockers.spec.tsx -> OfficialFormsPages.tsx -> existing normalized input/validated reservation contract -> mocked rejected save -> notifyWarning -> SweetAlert close/focus lifecycle. SQL map: Nov18 complete_purchase -> Nov19 create_earning_claim/refund_purchase_redeemed_points -> Nov10 claim_earning_points -> points ledger/account/period capacity. The original audit, ordered migration inventory, UAT plan and recovery document were reviewed; historical audit results remain historical, not substituted for fresh checks.

## 2. Reservation root cause

A real SweetAlert warning is dismissed after the mocked QA save failure. SweetAlert removes the dialog, then restores the previous submit-button focus after RESTORE_FOCUS_TIMEOUT=100ms. The test waited only for dialog absence and began typing into the imported-tier field before that focus callback completed. Diagnostic evidence: tier only S, warning reopened, body swal2-shown, and the form aria-hidden=true. Focus moved back to the submit button during typing; the space in silver member triggered another mocked save and warning. This is a test synchronization race, not a business/validation failure.

Minimal change: after dismissal assert that Create Reservation Agreement has regained focus before clearing/typing. All canonical enum/payload checks remain intact. No artificial sleep, skipped assertion, hidden-element query, UI behavior change, modal mock or authorization change. Temporary diagnostic logging was removed. No production caller/export/config change needed; all production Orly components remain unchanged.

RED: full isolated final-blockers.spec.tsx, exit1,15/16 pass. Exact single test alone, exit0,1/1, demonstrated order/timing sensitivity. GREEN: corrected full isolated file, exit0,16/16. Focus assertion itself verifies accessible restoration; subsequent original test still verifies two requests and absence of a fabricated vipTier payload.

## 3. Refund inconsistency: exact trace

- Completion verifies settlement and commits redemption once. It does not freeze a full original earning-rule snapshot at that stage. A comment in create_earning_claim says eligibility is fixed at completion, but the rule is actually selected later when that RPC is called.
- Current earning rule is per-unit: points_amount * integer quantity, subject to min_quantity, eligible tier/date and max_award. Rule selection is descending points_amount/effective_start. Ten units at100 points/unit, minimum1, no rule cap request1,000.
- create_earning_claim selects today's mutable rule and tier. It sums prior refund service_value and computes floor(original_quantity * (1 - refunded_value/(gross-tier_discount))). With10 units and1,000/10,000 refunded value it derives9 units and requests900.
- Existing claim records requested/awarded/capped points, service/rule/tier/period and min_quantity_snapshot. It does not freeze original points_amount, max_award, complete tier/date predicate or an explicit refund allocation for every line. purchase_lines preserves original quantities/prices/discount snapshots; refunds contain monetary service_value, not returned quantities/line allocation.
- refund_purchase_redeemed_points uses the frozen minimum only. While retained inferred quantity stays above the minimum, it neither changes an available claim's1,000 request nor compensates an already-claimed excess. Full/below-minimum refund instead reverses the whole award. Null legacy minimum blocks partial review.
- Therefore equivalent final service value produces different pre-cap award entitlement depending on claim issuance order. The current PostgreSQL characterization asserts actual1,000 and900; these passes do not establish consistency.
- Claimed full reversals append a negative event linked to the original award/period, absorb available balance and create debt for a shortfall. Later eligible credits/restorations repay debt. Annual capacity includes eligible earned/promotional/reversal amounts in their original period; redemption and non-cap refund adjustments do not create earned awards.
- Claim, creation, rotation, refund and full reversal acquire the membership lock before their load-bearing claim/account state. The member lock serializes otherwise different claim/period/account lock sequences. Existing ownership/CAS and unique earned-per-claim prevent replay. New full-refund/claim concurrency coverage is added without changing semantics.
- Redeemed-point split refunds use cumulative floor(original_redemption_points*cumulative_refund/base)-already_restored, with amount/reference/actor conflict checks and a member lock. Full restoration cannot exceed the deduction; duplicate references do not generate another event. This is separate from the unsettled earned-award recalculation policy.

## 4. Proposed deterministic calculation - NOT IMPLEMENTED

Use the original authoritative earning policy and **actual eligible retained line units**, not a cash-refund percentage applied to points. At completion freeze the selected rule and eligibility inputs for each applicable original line: service ID, quantity/unit, per-unit points, minimum, maximum, tier, effective window and rule version. A monetary refund does not by itself prove service units were returned: Finance must record explicit line allocations and consumed-service review; absent reliable facts, stop for manual adjudication.

For the existing per-unit rule: retainedUnits = originalUnits - cumulative approved returnedUnits; if original eligibility predicate/minimum fails, entitlement0; otherwise entitlement = min(pointsPerUnit * retainedUnits, maxAward when configured). Exact integer/decimal helpers, original tier/rule and service basis apply. Do not select a replacement promotion from today's rules. The current engine has no distinct fixed-award mode; a genuinely fixed/tier award must use its authorized original calculation, not an invented new mode.

Example:10 original units at100 ->1,000; one genuinely returned unit ->900 in either order. With maxAward900, original and9 retained units both yield900; multiplying a capped900 award by90% would incorrectly yield810. Cash goodwill/price refunds without returned eligible units must not silently reduce units. Determine their owner-approved effect separately.

Unused claim: append its original revision/history, recalculate remaining reservation under the same annual-cap locks, rotate tokens so old QR/fallback cannot work, then expose the corrected current claim using existing authorized credential reissue/delivery. Keep one current claim per purchase; never loosen the unique earned-per-claim guard to issue duplicate credits. Preserve original values in an append-only revision, not only a mutable current row.

Claimed award: keep the original credit, determine supported eligible excess against the original **actually credited** award and its annual-cap attribution, then append a bounded delta compensation with origin_award_id/origin_period_id. Reversal debt absorbs the uncovered delta. Sum all prior compensations against that original credit so partial/split/full/retry paths can never reverse it twice or beyond its amount. For a supported monotone per-unit rule, proposed cumulative excess = max(0, originalCredited - min(originalCredited, recalculatedEntitlement)); new delta = cumulativeExcess - priorSupportedCompensations. Original annual-cap truncation bounds the original credit; do not manufacture a counterfactual uncapped award. This formula still requires owner approval and trustworthy unit/rule evidence. A later full reversal must subtract prior excess compensations. Do not restore cap in another period, change historical money, or convert points to cash. Cap-truncated allocation must be derived from original evidence/approved attribution, never inferred from a cash ratio.

## 5. Exact proposed forward-only implementation scope

After owner approval only, candidate new migration: 20261120000001_afhomes_refund_earning_consistency.sql (reserved plan name, **file not created**).

- Add a server-controlled earning_snapshot to purchases and explicit line_allocations to purchase_point_refunds for new transactions; do not populate historical records from current mutable rules. Add an append-only earning_claim_revisions relation only as needed to preserve old claim versions while keeping one current claim and existing single-credit constraint.
- Add private.recalculate_refunded_earning_entitlement(purchase_id) using the immutable snapshot/validated allocations and private.compensate_refunded_earning_excess(...) with original-award bounded delta/idempotency.
- Replace public.complete_purchase to freeze earning eligibility for new purchases, public.create_earning_claim to consume that same snapshot, public.refund_purchase_redeemed_points to validate allocations and revise/compensate within its existing transaction, and private.reverse_refunded_earning_award/public.reverse_purchase_points to deduct only the uncompensated remainder. Existing claim/reissue RPCs must revalidate the current revision/token under the membership lock.
- Reuse existing server Auth/Finance/customer ownership checks, exact money/point helpers, account/debt ledger and annual capacity. Explicit SECURITY DEFINER search_path and browser SELECT-only policy remain. Revoke PUBLIC/anon/authenticated access to private functions and new mutation/revision tables; service_role insert/select only where needed, never history UPDATE/DELETE/TRUNCATE.
- Reuse contracts/services/Finance review UI; add validated returned-line units to the refund request and display the reconciled earning consequence. No second financial workflow/auth/provider. Token plaintext must not enter audit or the report. Current refund API accepts service value only and is insufficient for arbitrary returned-unit allocation.
- Update shared contracts, API handlers, fake RPC fixtures, DB tests and customer claim/history screens only where the approved patch requires. Do not edit any existing/applied migration.

Required RED/GREEN matrix: both refund/claim orders, unclaimed/claimed/partially spent awards, fixed/capped/tier predicates actually supported by the original policy, no returned unit/goodwill refund, min-threshold boundary, partial-unit rules, legacy missing snapshots, expired/rotated tokens, concurrent claim/refund/creation, same/different refund retries, multiple split refunds with cumulative integer rounding, full refund after partial compensation, original-year cap/debt, and exact ledger reconciliation.

## 6. Existing balances and history impact

No partial-refund financial behavior or balance is changed by this task. New local SQL tests use disposable synthetic records only. Historical claims retain original values; unreliable legacy snapshots remain blocked. Once policy is approved, only supported excess may be compensated; no bulk inferred backfill, deletion, universal percentage adjustment or automatic cash restoration. Preserve all previous approval/reservation/settlement/earned-claim and card-sale workflows.

## 7. Fresh verification

All final native process exits below are0 unless marked otherwise.

| Command/evidence | Exit | Exact result |
| --- | --- | --- |
| Exact reservation test alone | 0 | 1/1 passed,15 unselected; timing-sensitive reproduction clue |
| Full isolated reservation RED | 1 | 15/16 passed; original assertion failed |
| Full isolated reservation GREEN | 0 | **16/16 passed** with focus assertion and all original payload assertions |
| corepack pnpm test --force | 1 | Cold parallel API dev-server routing timeout; API2,026/2,027,4 other completed tasks passed; apps aborted, no full-suite pass claimed |
| corepack pnpm test --force --concurrency=1 -- --maxWorkers=2 | 0 | **3,394/3,394 passed**,7/7 workspaces,0 cached tasks; config6/contracts217/UI181/shared27/web243/admin693/API2,027 |
| corepack pnpm test:db:local | 0 | **2,374/2,374 passed**, complete63 migrations plus shim, synthetic cleanup restored |
| corepack pnpm test:db:harness | 0 | **13/13 passed**; normal inner suite0, injected failure inner suite nonzero, finally cleanup verified |
| corepack pnpm exec turbo run typecheck --force | 0 | 7/7 fresh workspace typechecks |
| corepack pnpm typecheck | 0 | Documented full command, including Supabase scripts |
| corepack pnpm lint --force | 0 | 2 tasks,0 errors,19 existing warnings,0 new |
| corepack pnpm build --force | 0 | 2 fresh application builds; large chunk warning retained |
| corepack pnpm check:env | 0 | 522 browser and192 server sources; PASS |
| corepack pnpm check:env -- --built | 0 | Source/built environment isolation PASS |
| git diff --check | 0 | No whitespace errors |

Five new SQL assertions exercise simultaneous customer claim and full Finance refund: refund success, allowed claim outcome, restored net balance, reversed final claim, at most one earned credit. Existing unit/PG regressions cover expiry, ownership, single-use, caps, debt, duplicate refunds and history paging. The1,000/900 partial-refund characterization remains an explicit failing business expectation in the report; current SQL assertions preserve the observed inconsistent values. No unapproved consistency implementation was introduced to make them green.

Default cold parallel scheduling still exhibits timeout risk. The complete bounded run passes all assertions; no global timeout override or reduced test coverage was introduced. Managed UI/hardware proof is not inferred from either run.

 A cold parallel full-suite attempt failed a5-second dev-server routing timeout; do not label it a pass. The complete bounded-worker run is independent and retains all assertions. PostgreSQL runners remain sequential.

## 8. Warning classification

Fresh lint:0 errors,19 warnings; **19 existing,0 newly introduced**. Each warning's entire source file was compared to git show HEAD:path (normalized line endings) and matches. All use react-refresh/only-export-components. No broad cleanup was performed.

| File | Location | Rule | Classification |
| --- | --- | --- | --- |
| apps/web/src/features/customer/CustomerLoginForm.tsx | 165:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/features/customer/portal-ui.tsx | 11:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/features/customer/portal-ui.tsx | 57:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/features/customer/portal-ui.tsx | 64:10 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/lib/customer-session.tsx | 35:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/marketing/components/ui/CmsHeroMedia.tsx | 20:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/marketing/components/ui/Form.tsx | 93:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/web/src/test/utils.tsx | 50:1 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesDashboardPage.tsx | 58:14 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesDashboardPage.tsx | 61:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesQueueCards.tsx | 29:14 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesQueueCards.tsx | 39:14 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesRoleFormDialog.tsx | 32:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesRoleFormDialog.tsx | 179:10 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/afhomes/AfHomesTrendChart.tsx | 35:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/business/ClaimQr.tsx | 32:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/features/business/OfficialFormsPages.tsx | 528:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/lib/session.tsx | 57:17 | react-refresh/only-export-components | Existing; source unchanged from HEAD |
| apps/admin/src/test/utils.tsx | 51:1 | react-refresh/only-export-components | Existing; source unchanged from HEAD |

## 9. Preserved features and managed gaps

Fresh offline suites cover original Experiences/detail routes, service catalog, customer points and approvals, GSD checkout, Finance/refund review and VIP-card workflows. Disposable PostgreSQL proves ledger, ownership, concurrency, caps, expiry and single-use contracts under the shim. Managed Auth/PostgREST/Storage, real browser persistence and hardware camera remain NOT VERIFIED; use the prepared isolated human UAT plan and no automated final financial browser action.

## 10. Owner decisions and readiness

**Local commit readiness: BLOCKED by F1 (unapproved financial policy). F3 is closed locally: reservation16/16 and full bounded offline3,394/3,394 pass.** Explicitly approve or reject the proposed consistency policy before any financial implementation. Decisions must include authoritative returned-line allocation (including goodwill/price-only and partial-unit refunds), original policy snapshot timing, treatment of cap-truncated awards and legacy manual review. This proposal is not approval. Owner policy gate is intentional; independently safe regression work is completed first.

## 11. Final uncommitted inventory

Final inventory below includes the existing recovery edits, four-line reservation test synchronization fix, five additional synthetic SQL checks and this report. Preserve/exclude packages/db-testing/scripts/probe-tmp.mjs and ignored .tmp-bin/log/environment artifacts from any future commit/deployment. No commit/push/deploy/shared apply is recommended while F1 remains unresolved.


Total changed paths: 54.

- api/_handlers/_service-catalog.ts
- api/_handlers/points.spec.ts
- api/_handlers/points.ts
- apps/admin/src/app/App.tsx
- apps/admin/src/app/navigation.ts
- apps/admin/src/features/business/BusinessPointsPage.tsx
- apps/admin/src/features/business/PointsRulesPage.tsx
- apps/admin/src/features/business/PurchasePaymentsPage.tsx
- apps/admin/src/features/business/SalesRecordsPage.spec.tsx
- apps/admin/src/features/business/SalesRecordsPage.tsx
- apps/admin/src/features/business/ServiceCatalogEditor.spec.tsx
- apps/admin/src/features/business/ServiceCatalogEditor.tsx
- apps/admin/src/features/business/final-blockers.spec.tsx
- apps/admin/src/features/business/loading-states.spec.tsx
- apps/admin/src/features/business/points-services.ts
- apps/admin/src/features/business/points.module.css
- apps/admin/src/features/redemption/RedemptionWorkflowPage.tsx
- apps/admin/src/features/redemption/retirement.spec.tsx
- apps/admin/src/responsive.spec.tsx
- apps/web/src/features/customer/CustomerPointsPage.tsx
- apps/web/src/features/customer/customer-claim.spec.tsx
- apps/web/src/features/customer/customer-portal.spec.tsx
- apps/web/src/features/customer/services.ts
- apps/web/src/marketing/marketing.spec.tsx
- apps/web/src/marketing/pages/ExperienceDetail.tsx
- apps/web/src/marketing/pages/Experiences.tsx
- docs/superpowers/plans/2026-10-09-points-system-implementation.md
- packages/contracts/src/index.ts
- packages/contracts/src/schemas/points.ts
- supabase/db-integration.ts
- api/_handlers/_point-approvals.ts
- api/_handlers/_point-refunds.ts
- apps/admin/src/features/business/PointRefundReview.spec.tsx
- apps/admin/src/features/business/PointRefundReview.tsx
- apps/admin/src/features/business/PointsPromotions.spec.tsx
- apps/admin/src/features/business/UseVipPointsPage.spec.tsx
- apps/admin/src/features/business/UseVipPointsPage.tsx
- apps/web/src/features/customer/PointRedemptionApprovals.spec.tsx
- apps/web/src/features/customer/PointRedemptionApprovals.tsx
- docs/AFHOMES-BLOCKER-RESOLUTION-2026-10-11.md
- docs/AFHOMES-ISOLATED-UAT-2026-10-11.md
- docs/AFHOMES-MIGRATION-INVENTORY-2026-10-11.md
- docs/AFHOMES-PRECOMMIT-AUDIT-2026-10-11.md
- packages/contracts/src/schemas/point-approvals.ts
- packages/db-testing/scripts/probe-tmp.mjs
- supabase/migrations/20261113000001_afhomes_service_staycation_eligibility.sql
- supabase/migrations/20261114000001_afhomes_restore_points_spending.sql
- supabase/migrations/20261115000001_afhomes_commit_keeps_tier_discount.sql
- supabase/migrations/20261115000002_afhomes_fix_customer_points_position.sql
- supabase/migrations/20261116000001_afhomes_promotion_stacking.sql
- supabase/migrations/20261116000002_afhomes_sale_tier_choice.sql
- supabase/migrations/20261117000001_afhomes_customer_redemption_approval.sql
- supabase/migrations/20261118000001_afhomes_reserved_point_settlement.sql
- supabase/migrations/20261119000001_afhomes_point_refund_compensation.sql
