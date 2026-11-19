# SSD-5 — native customer purge

Owner decision, 6 November 2026: match the existing permanent-deletion dialog, including linked business history. This supersedes protected-history blockers **for this explicit Super Admin customer purge only**. Deactivation, staff deletion, audit retention and issued-number non-reuse remain unchanged. This authorizes implementation and disposable tests, not shared-database deletion, schema changes or deployment.

Plan:

1. Reproduce the missing `DELETE /customers/:id` route (confirmed 404 before authorization).
2. Add native transaction regressions for cascade scope, authorization, shared identities, rollback, file failure/retry and preserved unrelated records.
3. Add `customer-purge.mongo.ts`, called by the existing customer handler with existing runtime storage. Reuse organization/sales transaction guards, fresh delete permission and Super Admin checks. Delete business children, private customer identity/session rows and customer atomically; retain audit evidence and issued-number records/counters.
4. Queue private-object cleanup transactionally in existing `storage_cleanup_jobs`; delete bytes only after commit. Persist a replay marker so a cleanup failure can be retried after the customer row is gone. Never report complete success while file deletion is pending.
5. Keep typed DELETE and existing response contract. Verify the UI sends one DELETE and refreshes dependent business queries after success.
6. Run targeted native/API/UI tests, typecheck, scoped lint and environment isolation. Record local versus deployed results. No live deletion or deployment.

## Implementation and verification

Implemented `DELETE /api/v1/customers/:id` with the existing `{ deleted: true }` response. It requires current `sales.customers/delete` permission and Super Admin status, rechecked under the existing organization/sales transaction guards. The native runtime now supplies its configured private object store to the customer handler. Typed DELETE remains unchanged; successful purge invalidates the Admin query cache because directory, Finance, Sales, Memberships, documents and lookup may all change.

The explicit ownership graph covers applications/holders/terms/documents, reservations/schedules/documents, sales/payments/commissions/qualifications/hierarchy snapshots, memberships/points, retained Services/Redemption rows, linked import rows/sources/claims, onboarding tokens and the private customer identity/session/photo records. Staff and other customers are preserved; staff/shared identities and inconsistent cross-customer links fail closed for review. Append-only audits, VIP issuance records, counters and shared import-job/workbook archives are retained. This is an operational purge, not archive erasure or anonymization.

Database deletion, login revocation, cleanup jobs, replay marker and deletion audit commit together with snapshot reads and majority writes. Physical files are removed after commit. A storage failure returns an explicit 503 stating that customer removal committed but cleanup is pending; retrying DELETE resumes cleanup without a second purge/audit. Pending jobs survive process exit in existing `storage_cleanup_jobs`. No automatic cleanup scheduler was added. Shared file bytes referenced by another customer are retained. Signed links already handed out cannot be recalled, but their file bytes are removed on successful cleanup.

Online purge is bounded to 10,000 collected rows; larger or inconsistent histories require a separately reviewed maintenance operation. Missing storage configuration blocks a file-bearing purge before commit. No indexes or collections are initialized at startup by this change; it uses existing native collections and cleanup/index conventions.

Fresh local proof:

- Original failure reproduced as a handler 404 before authorization or database access.
- Regression tests failed before the route existed; separate cache-invalidation, storage-error classification and cross-customer regressions also failed before their fixes.
- **37 API tests / five files PASS**, including **12 purge cases** and an actual HTTP sign-in → DELETE → private-byte absence → denied old customer session flow. Other API files cover customer CRUD, native runtime, activation and private storage. `.git/ssd5-final-api-tests.log`.
- **25 Admin tests / two files PASS**, including rejection of `DETELE`, acceptance of `DELETE`, a single delete call, directory refresh and Sales/Membership/Lookup cache invalidation. `.git/ssd5-ui-tests.log`.
- **API/Admin typecheck, scoped lint, environment isolation and hosted build PASS**, all exit 0; results in `.git/ssd5-gates.json`. The hosted build uses an isolated synthetic HTTPS origin/public Turnstile test key, not production credentials or configuration.

These tests use only new disposable loopback MongoDB databases, fictional accounts and temporary private files. No real customer/account/database records were changed. No commit, push, deployment or production deletion occurred. Browser acceptance and the actual deployed route remain unverified until a separately authorized release. The earlier 5,272-test full run predates SSD-5; the counts above are this fix's targeted verification.
