# Localhost health check - 2026-10-22

Checkout: `C:/Users/SSD-CLAUD/AFhomes-ecofarm-v2`, branch `claud/clean-develop`, commit `61236109d702fbb7683919da7520014a700285a3`. Read-only running-app checks plus offline tests and disposable PostgreSQL. No shared business records, accounts, settings or payments were changed. No migration, push or deployment was performed during this check.

## Verdict

NOT ALL VERIFIED / TEST SUITES FAIL. Local servers and the observed screens respond, but 40 automated application tests and four database checks fail. Test failures require triage; missing test controls do not alone prove the corresponding live action is broken. This report does not certify every function or role.

## Running services and HTTP

- Ports 3000 (API), 5173 (public SPA), 5174 (admin SPA) are listening.
- API health returns HTTP 200 with `ok: true`, `db: ok`.
- Public homepage and admin login return HTTP 200. Public CMS and public verification config return HTTP 200; search is available with its daily limit enabled.
- 31 HTTP checks passed: five public/liveness checks and 26 unauthenticated denial probes against actual handler routes. The latter return 401; this proves denial behavior, not authenticated CRUD.
- Initial probe paths for four families needed their actual documented subroute/query parameters; those corrected checks passed. No connection-refused proxy response occurred in these checks.
- Sanitized local evidence: `.tmp-bin/localhost-qa-http.json`; probe `.tmp-bin/localhost-health-probes.mjs`.

## Browser observations

After the user signed in as an administrator, 21 admin pages reached their expected loaded heading/content without an observed load error:

Dashboard; Members; Public Verification Settings; Customers; Customer Applications; IST Reservations; Card Plans; Finance Queue; Activation Queue; Commissions; Earned Points Claims (Redemption); Sales Network/Genealogy; Staff; Roles & Permissions; Elite Service Delivery; Departments; Reports; CMS Pages; Memberships; Audit Log; Operational Services Sales Records.

The settings form displays enabled search, enabled daily allowance, 30 retention days, saved notice and Save settings. No save was submitted. Several lists are empty; these are empty-state checks, not proof of transaction/detail workflows.

Public search loads its enabled form. Entering a known AA number and selecting Search opens the approved privacy notice with 30-day retention; Continue is disabled pending acknowledgment. No contact submission or CAPTCHA completion was performed.

An earlier OST session visiting port 5174 `/admin` redirected to port 5174 `/ost`, which showed Page not found. This is a reproducible routing issue observed before the user changed to an administrator session. The admin SPA canonicalizes paths using `staffPortalPath`; the OST portal belongs to the public SPA. No routing change was made in this audit.

Browser control disconnected repeatedly and some navigation batches timed out. OST applications, referral-code administration, commission settings and the customer login were not marked passed because their final state was not captured. Browser console/network inspection and full authenticated write/reload persistence are not verified. Screenshots alone are not workflow proof.

## Automated results

| Scope | Passed | Failed | Notes |
| --- | ---: | ---: | --- |
| API | 2618 | 2 | 135 files; both failures in payment queue search |
| Admin SPA | 924 | 38 | 97 files; eight files contain failures |
| Public/customer/OST SPA | 259 | 0 | 20 files, separately completed after root runner stopped |
| Contracts | 319 | 0 | 22 files |
| Shared helpers | 41 | 0 | Four files |
| UI primitives | 230 | 0 | 32 files |
| Public env configuration | 6 | 0 | Root runner reused its existing cache |
| Disposable PostgreSQL integration | 2703 | 4 | 2707 checks, all 132 repository migrations |

Commands: `corepack pnpm test`; separate `corepack pnpm --filter @afhomes/admin exec vitest run --maxWorkers=2` and equivalent web command because the root runner stopped on API failure; `node packages/db-testing/scripts/test-db-local.mjs`; `corepack pnpm typecheck`; `node scripts/check-env-isolation.mjs`.

Full typecheck completed with exit 0. Env isolation passed (667 browser, 279 server source files). A redirected PowerShell invocation of typecheck reported a native-command status despite successful task output; the unredirected repeat completed with exit 0. Admin Vitest also reported a worker-termination timeout after its complete result; none of its 38 failures are treated as passing.

## Failures to triage

1. API: `_handlers/phase2.spec.ts`, payment queue search by full customer name and product name returns no rows instead of one. Sale-number search passes. Isolated three-case rerun reproduces exactly two failures; `.tmp-bin/localhost-qa-api-search.txt`. Check DB prefilter/embedded search and fake behavior before claiming the live root cause.
2. Admin `PurchasePaymentsPage.spec.tsx`: 11 failures, receipt/payment controls not found.
3. Admin `application-actions.spec.tsx`: 16 failures, application fields/actions/export/workflow controls not found.
4. Admin `final-blockers.spec.tsx`: three failures, expected Submit controls missing in phone-validation scenarios.
5. Admin `responsive.spec.tsx`: three failures, staff/roles/payment table expectations.
6. Admin `GeographicAddressFields.spec.tsx`: two failures, legacy/unverified address warnings.
7. Admin `finance-lifecycle.spec.tsx`: one failure, expected sale row missing.
8. Admin `OfficialFormsPages.spec.tsx`: one failure, reopening imported application heading missing.
9. Admin `module-coverage.spec.ts`: one failure, obsolete `/admin/documents` mapping expectation returns undefined. The current App source explicitly retires the standalone document-review screen; do not invent an active route to satisfy the test.
10. PostgreSQL section 15: external-import function search_path assertion; section 48: historical import referral attribution; section 58: two purchase-review-reason assertions. These are the same four failure descriptions recorded in the previous baseline; no new baseline run was needed for this audit, and no unrelated SQL was changed.

An isolated admin rerun reproduced the purchase amount-due, module mapping and address warning failures: three failed, 33 skipped. These are not solely artifacts of the broad parallel run.

## Evidence and limits

Ignored evidence files: `.tmp-bin/localhost-qa-admin-tests.txt`, `.tmp-bin/localhost-qa-web-tests.txt`, `.tmp-bin/localhost-qa-db.txt`, `.tmp-bin/localhost-qa-isolated.txt`, `.tmp-bin/localhost-qa-api-search.txt`, `.tmp-bin/localhost-qa-typecheck.txt`, `.tmp-bin/localhost-qa-http.json`. Do not commit raw logs; rendered test DOM is noisy and may include synthetic fixture details.

No real account creation, payment verification, activation, import, document upload, deletion, membership credential rotation, settings toggle or full public disclosure was executed. Localhost uses shared Supabase data; exhaustive write testing requires disposable data/environment and separately scoped approval for any shared mutation. The shared database was not reset or seeded.
