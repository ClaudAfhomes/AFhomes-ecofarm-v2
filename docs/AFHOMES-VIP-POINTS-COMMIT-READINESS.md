# AF Homes VIP Points — final commit and push readiness

Verified 2026-10-11, Asia/Singapore. Worktree: C:/Users/SSD-CLAUD/Documents/AFhomes-ecofarm-v2-claud-promote. Branch: claud/develop.

Recommendation: the reviewed local changes can be committed after owner approval. Do not push or deploy under current Preview configuration. Local checks do not prove all functions work on the shared managed stack.

## Readiness classifications

| Gate | Status | Actual evidence / limitation |
|---|---|---|
| A. READY TO COMMIT LOCALLY | PASS | Latest typecheck, affected-workspace lint, configured local build, focused regressions and whitespace checks pass. Explicit staging manifest excludes probes/artifacts. Owner commit authorization is still required. |
| B. READY TO PUSH TO GITHUB | BLOCKED | Pushing claud/develop triggers Vercel Preview; Preview targets the production Supabase project with a configured server service-role credential. No push/deployment authorization. |
| C. READY FOR VERCEL PREVIEW BUILD | NOT VERIFIED | The configured build command passes locally on Node 24.19.0 with safe disabled Supabase values. Actual cloud Function packaging/build has not been executed for this candidate; connecting it to the current Preview backend is blocked. |
| D. READY FOR REAL AUTHENTICATED BROWSER E2E | BLOCKED | No isolated managed Auth/PostgREST/Storage target has been approved/configured. The current shared database lacks 24 local migration versions. |
| E. READY FOR PRODUCTION | BLOCKED | Isolation, schema compatibility and genuine browser acceptance remain unresolved. No production migration/deployment is authorized. |

## Git state and preservation

- Fresh git fetch origin succeeded. origin/claud/develop is fd05b35eb7feca613c0dbfd630b55b656580dcc8.
- HEAD is b8d624188910e407d374d5d85ebb0315ad10290c. rev-list origin/claud/develop...HEAD = 0 behind, 1 ahead. No divergence or conflict to resolve.
- Last five commits: b8d6241 recovery; fd05b35 Operational Services rebuild; 8ffdb35 tier discounts/payments; 0ecbd5c transaction-based points; a42ce6b PSGC/directory repair.
- Existing recovery commit, corrected customer spending approval display, points/refund history, GSD/Finance workflows, external repayment implementation and Orly components remain intact.
- No tracked historical migration changed. Applied November 1 migration SHA-256 remains f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58.
- git diff --check passes. Git reports LF/CRLF conversion notices, not whitespace defects. Index remains empty; nothing was staged, committed or pushed.
- Ordinary git diff --stat covers tracked modifications only. The explicit inventory below also includes untracked application/tests/docs/migration files.

## Latest verification

- Repository pnpm typecheck: seven workspace tasks plus Supabase script tsc PASS. Changed API/Web tasks reran after final edits.
- Admin/Web workspace lint: exit 0; 0 errors, 11 Admin and 8 Web existing Fast Refresh warnings. API/Contracts have no lint script/installed API ESLint; their typechecks/contracts/handler tests passed.
- Configured Vercel build locally: typecheck:deploy → prepare-vercel-env → turbo run build → assemble-vercel-output, exit 0. Both SPAs built, 11 public routes prerendered, root/admin index artifacts present. Existing chunk-size warnings remain. The build used loopback port 9 and disabled service credentials; no production API or DB contact.
- API points/refund + router/route coverage: 115 passed (96 points/refund, 19 routing).
- Customer points handler selection: 19 passed, 62 unrelated cases skipped.
- Customer points screen selection: 14 passed, 48 unrelated cases skipped.
- Customer refund history, personal earning claim and spending approval: 23 passed.
- Finance refund/purchase-payment screens: 17 passed. jsdom scrollTo notices are a test-environment limitation.
- Ledger/refund contracts: 9 passed.
- Total: 197 focused tests passed. No 3,394-test application rerun or onboarding investigation restart.
- Disposable SQL + real-router HTTP chain: 83 checks plus successful cluster cleanup, exit 0. Auth/PostgREST doubles are explicitly test-only; managed Storage/browser E2E is not claimed. Missing/wrong-actor receipts are rejected atomically; private path receipt acceptance/replay and cash/points/debt/concurrency reconciliation pass.
- check:env: PASS (528 browser / 195 server source files). This prevents browser secret exposure; it does not isolate Preview from production.
- New November 21 migration applied only to proven disposable loopback PostgreSQL with zero customers before synthetic fixtures. Bounded timeouts/savepoints used. Removed disposable cluster confirmed. No shared migration execution.

Evidence logs are ignored local .tmp-readiness-*.log files, not release payload.

## Demonstrated defects corrected during this audit

1. Receipt upload preceded purchase/refund binding checks and could create unrelated objects. Binding/status/reference checks now precede upload.
2. Definitively rejected repayments left untracked receipt uploads. Each attempt now has a unique object path and durable SERVICE_REFUND_RECEIPT_PREPARED audit; a definite SQL rejection removes only that attempt's object and records removal when successful.
3. Ambiguous RPC failures could not safely distinguish committed receipts from orphans. The receipt remains private with its durable prepared audit; no deletion occurs on an uncertain outcome. Matching committed retries reuse the receipt, and a concurrent losing attempt can clean its unique object without deleting the winner's receipt.
4. Newly committed disposable DB/HTTP test infrastructure could enter CLI deployment uploads through packages/**. .vercelignore now excludes packages/db-testing/, consistent with the existing filtered production install.

Receipt regression RED: 3 failures and 1 pass before repair. GREEN: all eight reconciliation cases pass, alongside forged MIME/download-route denials. New customer refund-history tests prove separate outstanding cash and retryable errors. One test initially assumed a hyphen where the established UI uses a middle dot; its heading matcher was corrected without changing business assertions.

No demonstrated local defect remains failing in the verified paths. Managed receipt delivery and manual reconciliation of ambiguous/failed cleanup attempts remain unverified operational acceptance items. The prepared audit preserves actor, reference and private object path; no background deletion or backup cleanup was introduced.

## Vercel compatibility and production-write risk

Read-only inspection of project afhomes-ecofarm-v2 (prj_apBNxtW4R8E7JohbFg6K8aUGin4j):

- Connected repository: ClaudAfhomes/AFhomes-ecofarm-v2.
- Production branch: main. Preview branch tracking: All unassigned git branches. Ignored Build Step: Automatic. No deploy hooks. Therefore a new claud/develop push is expected to create Preview automatically.
- Recent Git-origin READY Preview deployments exist for develop and orly/develop. No candidate deployment was triggered by this audit.
- Preview and Production SUPABASE_URL both resolve to ikaevepedpqygdlipsei.supabase.co. Preview has SUPABASE_SERVICE_ROLE_KEY configured as sensitive. Only URL values and environment metadata were inspected; no service key was read, printed, exported or exercised.
- The server serviceClient()/storageClient() use configured service credentials with no Preview-specific write sandbox. Production financial-write capability is configured, subject to credential validity; it was not tested by performing a write.
- Current dashboard build override omits typecheck:deploy, but repository vercel.json supplies it and takes precedence. Install excludes @afhomes/db-testing; static output vercel-static; Node 24.x; one API router with package includes; customer/staff routes preserved. See https://vercel.com/docs/project-configuration/vercel-json for override precedence.
- Deployment protection is currently disabled in project metadata. No setting/env/protection change was made.
- Team-scoped connector project inspection returned 403; unscoped project reads and read-only browser settings inspection succeeded. Cached Vercel CLI was unavailable; no CLI installation, env pull or deployment occurred.

Owner-authorized prerequisite options before a push: disable automatic deployment for this branch and verify that change, or provision/connect an approved isolated Preview backend and explicitly authorize the resulting automatic Preview deployment. Do not use production Supabase as synthetic test infrastructure. No paid resource is assumed.

## Schema dependencies and endpoints affected

Read-only Supabase migration registry for ikaevepedpqygdlipsei ends at 20261101000001. The current candidate has 24 later migrations listed below, including the new November 21 file. No remote customer/ledger data was read. Migration history proves the versions are absent; ad hoc manually created object existence was not separately probed, so endpoint failures below are expected from the recorded schema, not a fabricated remote HTTP run.

| Endpoint family | Missing recorded dependencies / expected effect |
|---|---|
| /earning/services, tier-discounts, rules, redemption-rules, purchases, claims | November 4 points rebuild plus price/publication/tier/service policy migrations: missing catalog/rule/purchase/claim tables, columns or RPC contracts cause schema/RPC errors. |
| /earning/purchases/:id/payments and payment verify | November 6 Operational Services payment verification, November 7 idempotency and later settlement dependencies. |
| /earning/claim (customer), claim QR/code workflows | November 4, 9 and 10 claiming ownership/authorization/lifecycle functions. |
| /customer/points/position; /earning/purchases/:id/quote; /earning/approvals and customer decision; /earning/purchases/:id/complete | November 14–18 rate/promotion/approval/reservation/settlement dependencies. |
| /earning/purchases/:id/point-refunds | November 19 compensation and November 20 deterministic earning correction. |
| /earning/purchases/:id/refunds and decision/repayments/receipts; /customer/refunds | November 21 service_refunds/service_refund_repayments/manage_service_refund/service_refund_history; November 19/20 compensation dependencies and existing private payment bucket. |
| /customer/points/ledger enrichment | Existing ledger remains, but new reference lookups depend on earning_claims/redemption_quotes/purchase_point_refunds; missing schema prevents the complete read model. |

The application cannot be accepted as fully operational against that recorded deployed schema. Never apply just November 21 to a November 1 database; predecessor dependencies must be reviewed in order. Even applying the complete backlog to shared Supabase would require separate explicit approval and a deployment/migration runbook; none is authorized here.

Pending versions:

- 20261102000001_afhomes_customer_directory_workflow_filter.sql
- 20261103000001_afhomes_application_psgc_address.sql
- 20261104000001_afhomes_points_rebuild.sql
- 20261105000001_afhomes_service_tier_discounts.sql
- 20261106000001_afhomes_operational_service_payments.sql
- 20261107000001_afhomes_operational_sale_idempotency.sql
- 20261108000001_afhomes_retire_points_spending.sql
- 20261109000001_afhomes_claim_rpc_authorization.sql
- 20261110000001_afhomes_claim_lifecycle_repair.sql
- 20261111000000_afhomes_service_publication.sql
- 20261111000001_afhomes_server_service_prices.sql
- 20261112000001_afhomes_service_policy_status.sql
- 20261112000002_afhomes_service_photo_management.sql
- 20261113000001_afhomes_service_staycation_eligibility.sql
- 20261114000001_afhomes_restore_points_spending.sql
- 20261115000001_afhomes_commit_keeps_tier_discount.sql
- 20261115000002_afhomes_fix_customer_points_position.sql
- 20261116000001_afhomes_promotion_stacking.sql
- 20261116000002_afhomes_sale_tier_choice.sql
- 20261117000001_afhomes_customer_redemption_approval.sql
- 20261118000001_afhomes_reserved_point_settlement.sql
- 20261119000001_afhomes_point_refund_compensation.sql
- 20261120000001_afhomes_refund_earning_consistency.sql
- 20261121000001_afhomes_external_service_refunds.sql

## Exact staging plan — prepared, not executed

After explicit commit approval, stage only these 33 paths. This includes all reviewed modified/new source, tests, migration and reports; publish b8d6241 and the proposed new commit together when pushing is separately approved. Do not squash/drop the recovery commit.

- [modified] .vercelignore
- [modified] api/_handlers/_point-approvals.ts
- [new] api/_handlers/_service-refunds.ts
- [modified] api/_handlers/customer-portal.spec.ts
- [modified] api/_handlers/customer-portal.ts
- [modified] api/_handlers/points.spec.ts
- [modified] api/_handlers/points.ts
- [modified] api/_lib/testing/supabase-fake.ts
- [modified] apps/admin/src/features/business/PurchasePaymentsPage.tsx
- [new] apps/admin/src/features/business/ServiceRefundPanel.spec.tsx
- [new] apps/admin/src/features/business/ServiceRefundPanel.tsx
- [modified] apps/admin/src/features/business/points-services.ts
- [modified] apps/web/src/features/customer/CustomerPointsPage.tsx
- [modified] apps/web/src/features/customer/CustomerRedemptionsPage.tsx
- [new] apps/web/src/features/customer/CustomerRefundHistory.spec.tsx
- [new] apps/web/src/features/customer/CustomerRefundHistory.tsx
- [modified] apps/web/src/features/customer/PointRedemptionApprovals.spec.tsx
- [modified] apps/web/src/features/customer/PointRedemptionApprovals.tsx
- [modified] apps/web/src/features/customer/customer-portal.spec.tsx
- [modified] apps/web/src/features/customer/queries.ts
- [modified] apps/web/src/features/customer/services.ts
- [new] docs/AFHOMES-VIP-POINTS-COMMIT-READINESS.md
- [new] docs/AFHOMES-VIP-POINTS-LOCAL-QA.md
- [modified] packages/contracts/src/index.ts
- [new] packages/contracts/src/schemas/customer-points-ledger.spec.ts
- [modified] packages/contracts/src/schemas/customer.ts
- [modified] packages/contracts/src/schemas/lifecycle.ts
- [modified] packages/contracts/src/schemas/point-approvals.ts
- [new] packages/contracts/src/schemas/service-refunds.spec.ts
- [new] packages/contracts/src/schemas/service-refunds.ts
- [new] packages/db-testing/scripts/lib/vip-http-harness.mjs
- [new] packages/db-testing/scripts/test-vip-chain.mjs
- [new] supabase/migrations/20261121000001_afhomes_external_service_refunds.sql

Excluded and preserved: packages/db-testing/scripts/probe-tmp.mjs, .tmp-bin/**, .tmp-readiness-*.log, .env*, generated dist/vercel-static/.turbo, local PostgreSQL files, screenshots, backup material and exports. No backup was deleted.

Proposed commit message: feat(points): complete VIP refunds and customer history

Before the authorized commit, use explicit-path git add -- for the allowlist above; inspect git diff --cached --name-only, --stat and --check and repeat the manifest secret check. Never git add . or git add -A. No push command is authorized or executed.

Potential credential-literal scan of the manifest found no private-key, Supabase secret/live-key or JWT literals. This targeted check does not replace an external secret-scanning service.

## Exactly what must be corrected/resolved before pushing

1. Unsafe Preview isolation: both environments point at production; remove production-write access from Preview through an owner-approved configuration change and verify it, or disable this branch's automatic deployment before publishing code.
2. Recorded schema incompatibility: prepare/review the required migration order for an approved isolated backend; execute there only after separate authorization. Production/shared backlog remains untouched.
3. Real managed acceptance: verify customer-owned claim/approval, reservations, verified/zero-cash settlement, refunds, private receipts and reload persistence in separate authenticated sessions. Resolve any defects demonstrated there before declaring functional Preview readiness.
4. Owner authorization: obtain explicit commit approval, then separate push/automatic-deployment approval for the exact candidate and verified configuration.

No additional local source defect is currently demonstrated by the completed focused checks. A cloud build and managed browser/Storage execution remain unverified, and ambiguous receipt attempts require audit-based reconciliation.
