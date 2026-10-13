# AF Homes independent pre-commit audit ? 2026-10-11

**Updated blocker status: local commit readiness remains BLOCKED by F1 (financial policy). F3 is resolved locally; see [the blocker-resolution report](AFHOMES-BLOCKER-RESOLUTION-2026-10-11.md) for fresh3,394 offline,2,374 PostgreSQL and13/13 harness results. The audit evidence below records the preceding checkpoint. Managed UAT and production readiness: NOT VERIFIED.** This audit preserves the existing recovery implementation; it does not rebuild completed features or authorize release actions.

## 1. Repository checkpoint

Worktree: C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote. Branch: claud/develop. HEAD: fd05b35eb7feca613c0dbfd630b55b656580dcc8. Origin: https://github.com/ClaudAfhomes/AFhomes-ecofarm-v2.git. The environment's claud-develop checkout was not used for mutations. No branch/worktree was created; no reset, clean, commit, push, deployment or shared migration occurred.

## 2. Changed-file inventory and packaging

The exact final changed-path list is appended after verification. Changes span contracts, points APIs, GSD/Finance/Admin screens, customer approvals/history, Experiences restoration, regression tests and recovery documentation. No dependency or lockfile change is part of this work.

Preserve but **exclude packages/db-testing/scripts/probe-tmp.mjs**: an unguarded developer PostgreSQL probe takes an arbitrary connection URL and performs schema/data writes. It was not executed. Do not deploy a dirty local workspace through Vercel CLI: packages/** is included in the function packaging and that untracked probe is not specifically excluded. Deploy only from an explicitly approved clean committed revision. Ignored .tmp-bin and .tmp-*.log remain local evidence, never delivery artifacts. Tracked environment paths are example files only. Changed-path credential-pattern scan found zero private-key, secret-key, credentialed PostgreSQL URL or JWT matches; this bounded scan is not a guarantee that every possible secret format is detectable.

## 3. Complete migration inventory

See AFHOMES-MIGRATION-INVENTORY-2026-10-11.md: all63 ordered prerequisites, including nine new uncommitted files, source-derived relation/function changes, ACLs, history risks, verification SQL and local-versus-managed status. Protected Nov01/Nov02 have no diff. The committed Nov04 points cutover really performs financial history compensation and balance resets despite stale skeleton/no-op comments; never replay it on an existing target. Inspect authorized managed version history before deciding any apply list.

## 4. Financial accounting findings

Earn, Claim Earned Points and Use VIP Points are separate workflows. Annual Bronze25,000/Silver40,000/Gold60,000 caps live in tier_points_config and limit earned capacity; they are not activation grants. SQL annual periods, cap reservations and positive earned-ledger attribution govern capacity. Redemption debits and restoration adjustments do not mint annual earned capacity. Money stays exact decimal/numeric; points stay integers.

**BLOCKER F1 ? earned-point amount depends on refund/claim order.** A real disposable PostgreSQL characterization uses two equivalent10-unit purchases, rate100 points/unit, min quantity1, and a10% service-value refund. If the earning claim is issued first, it retains1,000 requested points while the purchase remains eligible. This reproduction compares requested award entitlement before cap truncation; it does not claim a managed customer actually received either balance. If refund happens first, create_earning_claim uses nine retained units and requests900. The audit asserts both observed values so this discrepancy cannot disappear silently. These are characterization checks, not a pass for order-independent accounting.

The approved policy says reverse earned awards when a refunded purchase no longer qualifies, but does not settle whether an otherwise eligible partial refund must proportionally reduce an existing award, invalidate/reissue it, or retain a frozen award with an equivalent issuance rule after refund. Do not choose a new financial policy or manufacture historical allocations. Owner must choose one consistent rule; implementation needs frozen original rule/quantity/award evidence, exactly-once compensations, annual-cap and debt tests in both orders. Until that is approved and tested, local commit recommendation remains BLOCKED even if automated checks are green.

**FIXED F2 ? quote response overstated promotion-boundary expiry.** The prepare RPC stored the earlier of30 minutes or promotion end, but returned30 minutes unconditionally. A deterministic23:50Manila probe reproduced stored00:00 versus reported00:20; RED exit1,2,359/2,360 checks passed. The minimal fix in the new unapplied Nov18 migration returns the stored quote expiry. GREEN initially2,360/2,360. No historical migration was edited.

Accommodation uses an active applicable Admin conversion rule; no implicit PHP1/point. Other services need active eligible promotion. Tier/points cannot stack unless the applicable promotion explicitly allows it. Server-calculated purchase/rule/price snapshots bind the approved quote; historical display does not recompute from today's catalog.

## 5. Customer authorization review

Customer identity is re-resolved from Supabase Auth and customers.auth_user_id ownership, separate from staff ACLs. Customer-only approval routes require an active owned record. GSD can prepare but cannot approve on another customer's behalf. SQL rechecks customer ownership at decision and completion; losing the approved Auth binding prevents completion. A staff account that independently owns a customer record may act only as that same customer.

Approval identifies purchase, service, points, peso discount and final cash amount. Request window is short-lived; stored exact quote and current configuration are revalidated. Duplicate approval returns the original state without debit. Obsolete staff commit/apply/quote RPC execution remains revoked, including service_role, and corresponding HTTP mutations refuse authorization.

## 6. Reservations, settlement and concurrency

Approval reserves points without debiting the ledger. Member-first row locks serialize reservation decisions; account balance/debt and existing active holds are checked under locks. Available spending excludes held points. Completion requires fully verified net cash, accepts legitimate zero-cash settlement and consumes approval/debits once. Partial verified and recorded-only payments remain blocked. Parallel approval overcommit admits one winner; simultaneous completion retries both return successfully with one ledger debit.

Rejected/changed/expired/cancelled drafts release holds without a permanent deduction. Cleanup is lazy on authorized position/quote/decision/completion/cancellation requests, not a background scheduled job. Expired holds already stop reducing availability. Generic reversals waiting behind a completion lock recheck consumed authorization and require Finance review.

## 7. Refunds, reversal debt and history

Finance permission, explicit service review and reason are required. Full/partial redeemed-point restoration appends compensation; cumulative attribution/rounding cannot exceed the original deduction. Same-reference parallel refund retries return successfully and restore once; changed-value replay and excess cumulative refund refuse. Restored points pay reversal debt first, never automatically become cash. Refund rows deny update/delete/truncate even for service_role; immutable ledger history is retained.

Full or below-frozen-threshold cancellation reverses linked earned awards separately. Prior real-PG sections exercise earned-award reversal debt; source review confirms Finance refund uses that accounting pattern. No claim of managed Finance workflow success is made. Legacy partial refund with missing min_quantity_snapshot is explicitly refused, with unchanged balance and no compensating refund receipt. Do not backfill from current rules; supported adjudication options are in the UAT plan. F1 remains unresolved for eligible partial refunds.

## 8. Experiences regression

Fresh offline marketing tests cover CMS Experiences fallback when services fail or none publish, services alongside original destinations, and detail routes for ALM Japanese Restaurant, Smart Wellness Hotel and Hotspring Ecofarm Resort. Source restoration merges the CMS originals with published service entries and uses existing detail rendering. This is offline DOM/component proof, not managed CMS publication or live media proof.

## 9. UI/UX and route review

Use VIP Points is wired into the protected admin route/nav; Finance refund review into Purchase Payments; customer approvals into Customer Points. Contracts export approval schemas and API dispatch calls shared handlers; no parallel authentication or new UI framework was introduced. Existing @afhomes/ui Skeleton, Button loading, notifyConfirm/SweetAlert, ErrorState, empty states and responsive patterns are reused. Fresh DOM suites cover approvals, Finance review, promotions, GSD checkout, claim/portal, retirement and responsive screens.

Full-suite output includes existing jsdom scroll/navigation limitations and invalid nested paragraph/list/div warnings in application-actions dialogs. They are not evidence of a clean real browser console. No real Auth/browser or physical camera acceptance was run in this audit. Previous browser fixtures are prior evidence only, and cannot satisfy this release's managed UAT requirements.

## 10. Exact fresh validation

Fresh results (exit status is the native command/process status, not PowerShell stderr formatting):

| Command | Exit | Result |
| --- | --- | --- |
| corepack pnpm test --force, first full run | 1 | 3,393 passed / 3,394 total; role-access async wait failed |
| corepack pnpm --dir apps/admin exec vitest run src/features/afhomes/role-access-review.spec.tsx | 0 | 4/4 passed in isolation |
| corepack pnpm test --force, second full run | 1 | 3,393 passed / 3,394 total; CardPlans onboarding async wait failed |
| corepack pnpm test --force --concurrency=1 | 1 | 3,366 passed, 1 failed in six completed workspaces; shared task aborted before result; reservation enum-payload test failed |
| corepack pnpm test --force --concurrency=1 -- --maxWorkers=2 | 1 | 1,123 passed, 1 failed in five completed workspaces; API/web tasks did not complete after fail-fast; same reservation test failed |
| corepack pnpm --dir apps/admin exec vitest run src/features/business/final-blockers.spec.tsx | 1 | 15/16 passed; same reservation test failed in isolation |
| corepack pnpm test:db:local, expiry RED | 1 | 2,359 passed / 2,360; intended boundary-expiry assertion failed; cleanup passed |
| corepack pnpm test:db:local, expiry GREEN | 0 | 2,360/2,360 passed |
| corepack pnpm test:db:local, expanded audit | 0 | 2,366/2,366 passed |
| corepack pnpm test:db:local, final release gate | 0 | **2,369/2,369 passed**, synthetic cleanup passed |
| corepack pnpm test:db:harness | 0 | **13/13 passed**; normal inner suite exit0, injected inner suite nonzero with finally cleanup |
| corepack pnpm exec turbo run typecheck --force; then corepack pnpm typecheck | 0;0 | 7 fresh workspace tasks pass; documented command also passes Supabase scripts |
| corepack pnpm lint --force | 0 | 2 tasks pass; 0 errors, 19 warnings (web8/admin11) |
| corepack pnpm build --force | 0 | 2 fresh application builds pass; large chunk warning remains |
| corepack pnpm check:env | 0 | 522 browser files and192 server files scanned; PASS |
| corepack pnpm check:env -- --built | 0 | source and built-artifact environment isolation PASS |
| git diff --check | 0 | no whitespace errors |

An initial invocation of pnpm typecheck --force exited1 because the root compound script forwarded --force to tsc without --build (TS5093). This was an invocation error, corrected by forcing Turbo directly and then running the documented command; no types or assertions were weakened.

**BLOCKER F3 ? reservation regression remains reproducible.** final-blockers.spec.tsx, test actual IST tier retains the existing canonical enum payload behavior, cannot find Create Reservation Agreement after dismissing a warning. It fails in the complete serial/bounded suites and in isolation (15/16 pass), so resource contention alone does not explain it. The cause has not been established; do not hide it by changing enum/auth rules, deleting assertions, or reporting a full-suite pass. Investigate modal lifecycle/form state before a separately verified minimal fix.

 Initial cold parallel offline run failed the role-access one-second async find. Isolated role file passed4/4. A second parallel run passed roles but failed CardPlans onboarding one-second async find. The final complete run uses forced, sequential workspace execution without removing assertions or changing authorization; those failures remain disclosed rather than relabelled as passes.

The explicit SQL expiry RED failure was expected and preceded the fix. DB harnesses run sequentially, target loopback-only disposable PostgreSQL and restore synthetic rows. Current local proof does not imply a managed migration was applied.

## 11. Managed verification gaps

The current Supabase connector lists only an unrelated inactive project. No AF Homes target was inspected or changed remotely. Managed Auth/GoTrue, invitations/redirects, PostgREST column grants/RLS/function ACLs, private Storage/signed URL expiry, deployment environment isolation and real browser persistence are NOT VERIFIED. Physical HTTPS camera/mobile permissions are NOT VERIFIED. No financial final browser action was automatically confirmed.

## 12. Isolated UAT requirements

See AFHOMES-ISOLATED-UAT-2026-10-11.md: separate synthetic-only Supabase and Vercel test projects, Preview-only configuration, approved ordered migrations, test Admin/GSD/Finance/customer identities, three tiers, configured rates/promotions and human handoff at every final financial confirmation. Prepared only; setup/invitations/migration/deployment need their own explicit authorization.

## 13. Known limitations

F1 is an unresolved business/accounting release blocker. Legacy snapshot-less partial refunds stay blocked. Two parallel runs failed different one-second UI waits; F3 also fails in isolation and remains unresolved. Lazy hold release has no background job. Browser DOM tests cannot verify managed Auth/Storage or camera hardware. Global stored migration versions do not contain source hashes, so shared reconciliation requires direct authorized evidence. The debug probe must be excluded from staging and deployments. Existing dialog markup warnings need browser assessment before UAT console acceptance.

## 14. Local commit decision

**BLOCKED** pending owner resolution and tested implementation of F1. F3 is resolved by the subsequent focus-restoration regression correction and a complete bounded green offline run; see the blocker-resolution report. Passing automated gates cannot approve a financial policy. This is a complete audit outcome, not a claim the system is release-ready. Preserve all existing edits and protected migrations.

## 15. Proposed next actions ? not executed

F3 is now corrected locally; resolve F1 first, add both-order claimed/unclaimed/partially-spent/cap/debt/retry regressions, rerun the required gates, then review an explicit staged path allowlist excluding the debug probe and all local artifacts. Once separately authorized and ready, suggested commit title: fix(points): require customer approval and settle reserved redemptions. Include recovery/UI/contracts/tests, the nine new forward migrations and audit/UAT documentation; do not blindly git add -A. Review staged diff/secret scan and protected migration diff before the actual approved commit.

After separate infrastructure/migration/deployment authorization, create isolated test projects, reconcile and apply only the approved migration sequence with the app inaccessible, verify managed platform controls, deploy Preview from the approved committed revision, and run the human UAT checklist. No production apply/push/promotion follows automatically.


## Exact final changed-path inventory

Total: 52 paths. Exclude the preserved debug probe from delivery.

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
