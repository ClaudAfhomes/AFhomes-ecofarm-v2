# VIP Points: Local Implementation and QA Evidence

Checkpoint: claud/develop, b8d624188910e407d374d5d85ebb0315ad10290c.
Worktree: AFhomes-ecofarm-v2-claud-promote.
This report records fresh local execution. It does not certify managed Supabase or production readiness.

## Actual running interfaces

- Public Experiences: http://127.0.0.1:5173/experiences
- Customer points: http://127.0.0.1:5173/customer/points
- Admin configuration: http://127.0.0.1:5174/admin/points/rules
- GSD service sales: http://127.0.0.1:5174/admin/points
- GSD spending: http://127.0.0.1:5174/admin/points/use
- GSD earning-claim issuance: http://127.0.0.1:5174/admin/redemption
- Finance Operational Services payments: http://127.0.0.1:5174/admin/points/payments
- API: http://localhost:3000/api/v1

The real Vite SPAs and the real API router were launched. Process-only environment overrides point Auth at disabled loopback and prevent root environment files from supplying production service credentials. No mock backend, injected session, or authentication bypass was used for browser proof. These URLs are available while the local server sessions remain running.

Browser observations:
- Admin configuration, GSD service sales, Finance payment queue and earning claims redirect to staff login without an authenticated session.
- Customer points redirects to customer login.
- Experiences renders the original Hotel, ALM Restaurant and Ecofarm Resort destinations. Dynamic services resolve from loading to a retryable error because the safe local API has no managed database.
- Actual staff and customer login screenshots were captured in the conversation.
- The inspected Experiences browser console returned no error or warning entries. The catalog failure was visible in the UI; no successful service-data response was claimed.

## Module matrix

| Module | Feature | Fresh evidence | Status / dependency |
| --- | --- | --- | --- |
| Admin | Service catalog and spending promotions | ServiceCatalogEditor and PointsPromotions component suites; real SQL sections 65-70 | Local tests PASS; authenticated configuration and reload persistence BLOCKED |
| GSD | Service sales, points choice and earning claims | BusinessPointsPage, UseVipPointsPage and redemption suites; SQL operational purchase/payment/claim cases | Local tests PASS; real sale creation and claim QR presentation BLOCKED |
| Finance | Operational Services payment verification and refunds | PurchasePaymentsPage and PointRefundReview suites; SQL sections 67 and 72 | Local tests PASS; authenticated verification/refund browser flow BLOCKED |
| Customer | Claim, spending authorization and points balances | customer-claim, customer-portal and PointRedemptionApprovals suites; SQL ownership, settlement and balance checks | Local tests PASS; authenticated claim/approval browser flow BLOCKED |
| Integration | Earning, reservations, settlement, refund and ledger integrity | Disposable real PostgreSQL: 2,398 checks, all passed | SQL lifecycle scenarios PASS; full Auth/PostgREST/browser E2E NOT VERIFIED |

The Supabase plugin was inspected read-only. It exposed no AF Homes test project. No unrelated project was queried or changed. Local PostgreSQL reproduces database objects but does not supply GoTrue, PostgREST or Storage. This is the shared dependency blocking authenticated UAT for every operational module.

## Defect fixed locally

Customer spending approval omitted gross amount and VIP discount, despite the API supplying them. It also omitted purchased quantities, frozen VIP discount percentages and configured peso value per point.

The existing frozen approval snapshot already contains these inputs. The smallest complete fix extends the shared response contract, maps those values in the customer-owned approval handler, and displays them in the existing customer approval component. No migration or financial calculation change is required.

The screen now presents service lines, quantities, recorded VIP percentages, gross amount, VIP discount amount, configured conversion, requested points, points discount, cash payable and expiry. Missing historical VIP percentages display as not recorded, rather than assuming a rate. Configured conversion rates retain all four supported decimal places through the existing rate validator and direct display; a regression reproduced the crash caused by treating rates as two-decimal money. Existing Skeleton, Button loading behavior, SweetAlert confirmation and retryable error components remain in use.

Changed files:
- packages/contracts/src/schemas/point-approvals.ts
- api/_handlers/_point-approvals.ts
- api/_handlers/points.spec.ts
- apps/web/src/features/customer/PointRedemptionApprovals.tsx
- apps/web/src/features/customer/PointRedemptionApprovals.spec.tsx

## Exact verification

- RED: customer approval component failed because Gross amount was absent.
- RED: real API-handler regression failed because pesoValuePerPoint was absent.
- GREEN: API points suite, 83/83.
- GREEN: Admin service/POS/spending/promotion/refund suites, 30/30.
- GREEN: Admin operational payments and redemption suites, 16/16.
- GREEN: Customer claim/portal/approval suites, 80/80.
- Unique focused tests: 209 passed across these groups.
- Repository typecheck: 7/7 Turbo tasks passed, plus Supabase script typecheck. The final conversion-precision changes also passed a fresh repository typecheck.
- Changed customer UI ESLint: exit 0.
- Disposable loopback PostgreSQL: 64 migrations applied; 2,398/2,398 checks; exit 0; cleanup passed.
- PostgreSQL section 72: 79 checks passed, including customer ownership, duplicate approval, concurrent reservations, partial payments, completion races, zero-cash settlement, expiry, cancellation, compensating refunds and earned-point reversal.
- F1 tests retain the frozen per-unit calculation and capped 900-point award after partial refund; claimed reversals and replay checks passed.
- git diff --check passed.

No build, complete monorepo unit rerun, new harness injection run, mobile operational UI, camera hardware scan, live authenticated persistence or managed Supabase E2E was claimed. Component/API tests use the repository's existing test mocks; they are not browser transaction evidence.

## Next five steps

1. Identify an approved isolated AF Homes managed test project with Auth, PostgREST and Storage; do not use production for financial UAT.
2. Review and separately authorize the test-project migration/fixture setup, then connect the real local SPAs and API to it.
3. Complete Admin configuration and reload checks using synthetic service, discount, earning and promotion records.
4. Complete the synthetic GSD sale, Finance verification, customer claim and customer-authorized spending flow through actual interfaces.
5. Complete Finance partial/full refund, replay, concurrent checkout and ledger reconciliation; capture final balances, screenshots and persisted records before any commit or release decision.

No commit, push, deployment, shared migration, backup/reset, real customer transaction or production write was performed. The untracked probe-tmp.mjs was preserved and not executed. All implementation changes remain local for review.

## QA continuation: actual gaps and shortest path to authenticated E2E

This section supersedes the earlier module status for the history defects. The earlier 209-test and 2,398-check results remain prior-session evidence; neither full suite was repeated in this continuation. All previous approval-display changes are preserved.

### Screen-by-screen result

| Screen | Local result | Live browser / remaining gap | Exact local URL |
| --- | --- | --- | --- |
| Admin Operational Services and points rules | Existing editors remain implemented; Admin-role service creation and pricing RPC passed in the focused SQL chain | BLOCKED: authenticated HTTP configuration and reload persistence require the test stack. Tier/earning/redemption rule configuration in the SQL chain uses isolated fixture inserts, not a live Admin HTTP request | http://127.0.0.1:5174/admin/points/rules |
| GSD service sale | Real create_purchase RPC applied the catalog price and a frozen 10% tier discount; unverified completion was refused | BLOCKED: actual authenticated sales UI/API | http://127.0.0.1:5174/admin/points |
| GSD earning-claim QR | Real claim RPC issued a single-use token only after verified settlement and completion; issuing it credited nothing | BLOCKED: authenticated QR presentation, physical camera/device scan and persisted UI reload | http://127.0.0.1:5174/admin/redemption |
| Finance Operational Services verification | Real record/verify/complete RPC chain passed, including partial-payment refusal | BLOCKED: authenticated Finance API/UI | http://127.0.0.1:5174/admin/points/payments |
| Finance points refunds | WORKING in isolated SQL: attributable restoration, idempotent replay and original-deduction ceiling | PARTIAL: this UI restores points; it does not disburse cash or alter receipts. It hides refund review on completed purchases with zero points discount. No Finance cash-only/partial-cash refund path was established | http://127.0.0.1:5174/admin/points/payments |
| Customer earned-points claim and balance | FIXED locally: earned entries no longer invalidate the response contract; customer-bound claim credits the starting-zero wallet | BLOCKED: genuine customer Auth, actual HTTP claim and cross-session balance refresh | http://127.0.0.1:5173/customer/points |
| Customer exact-quote approval and reservation | Existing corrected display preserved. Four-decimal rate, reservation, verified settlement, replay and changed-price binding passed locally | BLOCKED: genuine authenticated customer approval. Staff approval remains insufficient | http://127.0.0.1:5173/customer/points |
| GSD points quote preparation | Existing preparation flow and real quote RPC remain implemented | BLOCKED: authenticated preparation UI/API | http://127.0.0.1:5174/admin/points/use |
| Customer points activity and spending history | FIXED locally: customer-owned earning, quote, refund and purchase-reversal references are displayed; another customer's reference is withheld | PARTIAL: activity is limited to the latest 100 entries, with no complete-history pagination. Live reload/persistence remains BLOCKED | http://127.0.0.1:5173/customer/points and http://127.0.0.1:5173/customer/redemptions |
| GSD sales records | Existing route retained; no new defect demonstrated in this continuation | NOT VERIFIED through an authenticated browser | http://127.0.0.1:5174/admin/points/records |

### Confirmed running HTTP/API boundary

The existing API was probed at http://127.0.0.1:3000/api/v1. Health returned 500 INTERNAL, Health dependency is not configured. These actual GET requests each returned 500 INTERNAL, Server configuration is incomplete:

- /earning/services
- /earning/purchases
- /earning/finance/purchases
- /earning/claims
- /customer/points/position
- /earning/approvals
- /customer/points/ledger

This is an exact configuration blocker, not a successful authenticated API chain. No financial POST was sent to a shared system. The running server retains its safe disabled-loopback Auth configuration and no production service credential. The actual Admin configuration and customer history routes redirect to their respective login screens.

The required dependency is an owner-approved isolated AF Homes Supabase test target, correctly configured client/server environments, synthetic staff/customer Auth accounts, customer ownership links, operational permissions, and the required points schema. Auth and PostgREST are essential to the claim/approval chain. Storage is additionally required for photo or receipt-object tests; it is not needed merely to generate a claim QR token. No shared pending migration was applied.

### Focused real SQL chain: fresh evidence

Run from this worktree:

    corepack pnpm exec tsx packages/db-testing/scripts/test-vip-chain.mjs

Final result: 30 lifecycle checks plus one cleanup check, all PASS, exit 0. Uses the existing disposable loopback PostgreSQL library and existing committed migrations. No managed Auth, PostgREST, Storage, HTTP session or browser login is emulated by this script.

1. An isolated pre-existing active membership fixture starts with zero points; card registration, card payments and activation are not exercised.
2. Admin-role save_service_catalog creates the services at 1,000.00. Synthetic configuration supplies a 10% GOLD service discount, 1,000 points per unit, and a 0.5001 accommodation conversion.
3. GSD creates two units: gross 2,000.00, tier discount 200.00, net cash 1,800.00.
4. Unverified completion is refused. Finance verifies payment, the purchase completes, and the earning token is issued without crediting the wallet.
5. The customer-bound claim RPC credits 2,000 points; replay is refused. This uses the linked fixture customer identity, not a real authenticated portal session.
6. GSD quotes two accommodation units: gross 2,000.00, tier discount 0.00, 1,000 requested points at 0.5001, points discount 500.10, cash payable 1,499.90, and a valid short-lived expiration.
7. A staff Auth identity is refused as customer authorization. The linked customer identity approves; wallet stays 2,000 and spendable becomes 1,000.
8. A verified partial payment cannot finalize spending. Once all 1,499.90 cash is verified, completion and its retry debit exactly once: wallet 1,000.
9. Finance's half-service refund restores 500 points. Replaying it changes nothing. Refunding the remaining eligible service value restores the other 500: wallet 2,000.
10. Ledger sum, account balance and membership cached balance reconcile. Real ledger rows pass the customer response contract. Changing quoted service pricing invalidates the old approval and deducts nothing.
11. Synthetic Auth/customer fixture writes are rolled back; the disposable database is stopped even if cleanup checks throw.

This proves the database lifecycle and response-contract compatibility, not the complete authenticated application/API chain. Previously verified F1 policy and reversal-debt behavior were not changed.

### Demonstrated defects fixed in this continuation

- BROKEN: lifecycle.ts accepted only the retired five ledger types. A real earned entry made the client reject the entire history response. RED reproduced four valid types failing; the shared enum now also accepts earned, annual_reset, promotional_bonus and cutover_baseline, matching the existing database CHECK. Unknown types remain rejected.
- BROKEN: history resolved only old catalog redemption references. The read model now resolves customer-owned earning claim numbers, points quote numbers and purchase reversal numbers, and carries the compensating refund reference. Both customer activity and spending-history screens display the reference. The reference column also appears when the history contains only earnings/refunds. RED reproduced absent references before implementation; ownership-denial and client-contract tests pass.

No financial policy, ledger write, pricing calculation, historical balance or migration was changed.

Continuation source files:
- api/_handlers/customer-portal.ts
- api/_handlers/customer-portal.spec.ts
- apps/web/src/features/customer/CustomerPointsPage.tsx
- apps/web/src/features/customer/CustomerRedemptionsPage.tsx
- apps/web/src/features/customer/customer-portal.spec.tsx
- packages/contracts/src/schemas/customer.ts
- packages/contracts/src/schemas/lifecycle.ts
- packages/contracts/src/schemas/customer-points-ledger.spec.ts (new)
- packages/db-testing/scripts/test-vip-chain.mjs (new focused SQL test)

Fresh focused regressions:
- API points handlers: 83 passed; repository fake database, real handler/contracts/resolvers.
- Customer points handlers: 14 passed; 65 unrelated customer/card tests skipped.
- Customer points-position/activity/spending-history screen cases: 12 passed; 49 unrelated screen cases skipped.
- Customer claim and spending approval screens: 21 passed.
- Customer ledger type contract: 5 passed, including unknown-type rejection.
- Total: 135 focused tests passed. No complete application suite was run.
- Real SQL: 31 checks including cleanup, exit 0.
- Repository typecheck: 7/7 tasks plus Supabase script check passed. Final customer handler refinement also passed API typecheck.
- Changed customer screen ESLint and git diff --check passed.

### Nonsensitive screenshots

These capture actual running entry screens and their Auth blocker, not synthetic authenticated business screens:

- .tmp-bin/vip-customer-entry.jpg
- .tmp-bin/vip-staff-entry.jpg

The screenshot artifacts are local and ignored. The two browser entry tabs are retained for continuation. No credentials or customer financial data were entered.

### Five remaining tasks, ranked by functional impact

1. Supply/connect an approved isolated AF Homes Auth + PostgREST test environment. This removes the blocker across every operational module; keep production excluded.
2. Verify that target has the required schema, ownership links, role grants and synthetic accounts. Any shared migration or seed requires separate authorization; do not apply the production backlog.
3. Run the exact ten-stage chain through real authenticated Admin, GSD, Finance and Customer interfaces/API, including personal QR claim, personal spending approval, reload persistence and separate sessions.
4. Complete and verify the missing Finance cash-only/partial-cash refund workflow under the already approved policy, including attributable earned-point reversal. Keep cash restitution distinct from point restoration; do not invent payouts or financial rules.
5. Verify device QR scanning and expose complete historical navigation beyond the latest 100 customer ledger entries, then repeat only the affected failure/replay/persistence cases.

No production writes/migrations, point reset, backup action, export, commit, push, deployment or paid service. The existing untracked probe was preserved and never executed.

## Integration recovery — verified local continuation (2026-10-11)

This section supersedes the earlier remaining-task list and test counts above. Existing changes, the corrected customer approval display, deterministic earning-refund behavior and historical migrations were preserved.

### HTTP 500 root cause

The running API was intentionally started with safe process overrides: loopback port 9 for Supabase and a blank service-role configuration. The service-client environment validator refuses this configuration before any Auth, schema or database request. Health and financial endpoints consequently return configuration HTTP 500. This is a verified configuration blocker, not evidence of a defective pricing/claim SQL function. Restoring production credentials was not attempted.

### Current module matrix

| Screen / workflow | Local implementation and API evidence | Actual authenticated browser |
|---|---|---|
| Admin service, price, tier discount and earning rule | WORKING in real-router HTTP/disposable SQL chain | BLOCKED: isolated managed Auth/PostgREST target |
| Admin conversion rule / spending promotion | PARTIAL: rate configuration and quote eligibility tested; managed configuration persistence unverified | BLOCKED |
| GSD Operational Services purchase and earning claim code | WORKING: creation, verified-payment gate, customer claim and replay tests | BLOCKED; device QR scanning unverified |
| Finance payment verification | WORKING in isolated HTTP/SQL chain | BLOCKED |
| Finance external cash/points refunds | WORKING locally: requests, separate approval, partial/completed external repayments, rejection/cancellation, ceilings and compensation | BLOCKED; private managed receipt upload/download unverified |
| Customer personally claims earned points | WORKING via customer-owned HTTP principal; wrong actor denied | BLOCKED |
| Customer approves exact points quote | WORKING: own customer approval, bound quote, reserve and completion-stage debit | BLOCKED |
| Customer activity and spending history | WORKING focused UI/API: chronological cursor pages, timestamp ties, insertion between pages, owned references | BLOCKED for managed reload/persistence |
| Customer refund history | IMPLEMENTED: separately displays cash repaid/outstanding, restored points and earning adjustments | BLOCKED for authenticated browser proof |

No registration, card payment or membership activation browser investigation was restarted.

### Isolated integration proof

Owner-authorized new migration: `supabase/migrations/20261121000001_afhomes_external_service_refunds.sql`. Applied only after proving the harness-owned disposable directory, exact loopback database identity and zero customers. Historical migrations were not edited. Synthetic fixtures only; statement/lock/request timeouts and savepoints protect expected SQL failures. The cluster was removed after concurrency testing.

`packages/db-testing/scripts/test-vip-chain.mjs` passed **78 lifecycle/integration checks plus one cleanup check**, exit 0. Evidence: `.tmp-vip-external-refunds.log`.

The chain exercised Admin configuration → GSD sale → Finance verification → customer earning claim → credited balance → accommodation quote → customer approval → reservation → settlement → refunds → ledger reconciliation. Actual HTTP uses the production router and contracts with real disposable PostgreSQL RPC execution. **Auth and PostgREST are test doubles**, not managed Supabase; this is not an authenticated browser E2E result.

Covered four-decimal conversion, exact quote binding, permissions/ownership, zero-cash settlement, partial/full cash-only, points-only and mixed refunds, approval without cash repayment, partial repayment, duplicate approval/refund/repayment, excessive cash refusal, deterministic earning adjustments, missing legacy snapshot atomic refusal, immutable repayment history, reversal debt and compensation, cached/authoritative balance agreement, concurrent identical and competing repayments, and zero RLS-invariant violations.

The workflow records externally completed payments; it does not initiate payouts. Optional receipts reuse the existing private payment bucket, server-generated actor/refund-bound object paths, signature/size validation and short-lived download grants. Forged receipt signatures and invalid download-route writes have focused regressions. Managed Storage execution and successful receipt round-trip remain unverified. Upload followed by a rejected financial RPC can leave an unreferenced private object; no automatic deletion was introduced.

### Focused verification

- API points/refund handlers: **88 passed**.
- Customer points handler selection: **19 passed, 62 unrelated cases skipped**.
- Customer points screen selection: **14 passed, 48 unrelated cases skipped**.
- Customer spending approval screen: **5 passed**.
- Finance refund / purchase payment screens: **17 passed**.
- Refund and ledger contracts: **9 passed**.
- Total: **152 focused tests passed**. No 3,394-test application rerun.
- API, Admin, Web and Contracts typechecks: PASS.
- Affected Admin/Web source ESLint: PASS. API ESLint unavailable in that workspace; no dependency installed.
- `git diff --check`: PASS (only existing CRLF conversion notices).

The first final-test invocation used incorrect workspace-relative paths and a Windows pipe-containing filter; those invocations did not run tests. Corrected invocations produced the counts above.

### Exact local URLs and screenshots

- Admin rules: http://127.0.0.1:5174/admin/points/rules
- GSD services/sales: http://127.0.0.1:5174/admin/points
- GSD earning/redemption entry: http://127.0.0.1:5174/admin/redemption
- Finance operational payments/refunds: http://127.0.0.1:5174/admin/points/payments
- GSD spending: http://127.0.0.1:5174/admin/points/use
- Customer balance/activity/approval/refunds: http://127.0.0.1:5173/customer/points
- Customer spending history: http://127.0.0.1:5173/customer/redemptions

Fresh browser checks of customer points and Finance payments reached their respective login screens; staff console error/warning log was empty. No credentials were entered or financial UI result fabricated. Screenshots: `.tmp-bin/vip-recovery-customer.jpg`, `.tmp-bin/vip-recovery-staff.jpg` (nonsensitive, ignored local artifacts).

### Source changes in this continuation

- API: `_handlers/_service-refunds.ts` (new), `points.ts`, `points.spec.ts`, `customer-portal.ts`, `customer-portal.spec.ts`, `_lib/testing/supabase-fake.ts`.
- Admin business: `ServiceRefundPanel.tsx` and `.spec.tsx` (new), `PurchasePaymentsPage.tsx`, `points-services.ts`.
- Customer portal: `CustomerRefundHistory.tsx` (new), `CustomerPointsPage.tsx`, `CustomerRedemptionsPage.tsx`, `queries.ts`, `services.ts`, `customer-portal.spec.tsx`.
- Contracts: `index.ts`, `schemas/customer.ts`, `schemas/service-refunds.ts` and `.spec.ts` (new).
- Integration: `packages/db-testing/scripts/test-vip-chain.mjs`, `scripts/lib/vip-http-harness.mjs` (new); new migration named above; this report.

### Five remaining tasks ranked by functional impact

1. Provide an approved isolated managed Supabase Auth/PostgREST/Storage target; current running safe configuration cannot authenticate.
2. Separately authorize and verify required schema on that isolated target, role permissions and synthetic customer/staff ownership. No shared migration is currently authorized.
3. Execute the ten-stage chain in separate real authenticated Admin/GSD/Finance/customer browser sessions, verifying reload persistence and customer approval.
4. Verify private receipt upload/download, failed-upload/retry behavior and repayment history; review legacy refunds with missing attribution/cash evidence explicitly rather than backfilling assumptions.
5. Verify device QR scanning, responsive operational screens and longer activity-page navigation under real concurrent sessions.

No shared/production writes, migration, export, reset, backup change, Git commit/push, deployment or paid service. The existing untracked `probe-tmp.mjs` was preserved and never executed.


## Final commit/push audit (2026-10-11)

See docs/AFHOMES-VIP-POINTS-COMMIT-READINESS.md for the latest verified candidate, receipt reconciliation fixes, 197 focused test passes, 83 disposable SQL/HTTP checks plus cleanup, safe staging allowlist and Vercel/schema blockers. This supersedes earlier receipt-orphan and remaining-task summaries. No files were staged or committed.
