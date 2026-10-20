# Customer import continuation: local implementation

Scope: implemented and verified locally in the isolated `AFhomes-customer-import-check` worktree. The user subsequently explicitly approved committing and pushing to `claud/develop` Preview. Shared migration application and live customer recovery remain outside that approval.

Update 2026-10-19: feature commit `8082c81` was pushed to `claud/develop` and its Preview reached READY. The user then separately approved the single migration `20261208000016`; it committed at `2026-10-19T11:57:19.923Z`. See `docs/supabase/MIGRATION-APPLICATIONS.md` for verification. No live customer recovery or test import was performed. Authenticated browser and native Excel acceptance remain pending; unauthenticated Preview endpoint probes redirected to Vercel Authentication and do not prove API behavior.

## Verified cause

The old company-workbook path intentionally created a prospect identity and retained application/package/payment statements in the protected import row. Import success did not mean that a normal customer application, reservation or payment existed. This explains the missing canonical company details and the absence of continuation actions. A stated reservation fee or company status is not a verified ledger payment.

## Implemented behavior

- The new versioned workbook separates Customers, Supplementary Holders, Sales Team and Payments. It includes readable choices, registered staff name/AA selections, date helpers, filters and automatic totals. Server calculations ignore spreadsheet caches. Existing company workbooks remain supported.
- RA No. identifies the customer. A separate purchase reference identifies a purchase across imports and retries. Existing identifiers and historical RA aliases are preserved.
- Registered OST identities and each actual lineage are checked separately. Different immediate uplines are accepted under the same VD root; different roots or conflicting workbook placements are rejected. Staff are never created by this path.
- Import creates or reuses a source intake, fills absent customer details and reports conflicts without overwriting current facts. Applications and Customer details expose the next normal action. A real acknowledgement date and the normal evidence/approval gates are required.
- An exact existing reservation reference reuses its originating application. Its customer and frozen purchase terms must agree; an incompatible reference is held for review rather than creating replacement history.
- Old imports can be reviewed from their retained source evidence. A reviewed purchase reference reconciles duplicate provisional intakes to one application, retaining the previous evidence. Separate legitimate purchases remain separate.
- Payment rows remain claims. Finance can upload/review a private receipt, explicitly accept an unverified payment, match an existing payment, hold or reject. Normal payment verification remains separate. Claim pages are bounded and paginated.
- Source hashes, target revisions, database locks, source uniqueness and actor checks protect stale reviews and concurrent retries. Private tables have RLS enabled and no direct browser/service table grants; public RPCs are service-only and check the passed server-derived actor.

## Gold reservation result

Synthetic database and workbook checks use Gold with a contract total of PHP 312,000.00 and an included PHP 10,000.00 reservation fee. Recording the claim leaves the verified balance unchanged. Separate verification produces PHP 10,000.00 verified and PHP 302,000.00 remaining, without creating a membership. Collection continues through the existing Finance workflow.

## Database change

Local migration: `supabase/migrations/20261208000016_afhomes_customer_import_continuation.sql`. It adds three private source/claim tables and reviewed RPCs, preserving the previous import dispatcher for legacy paths. `CURRENT-SCHEMA.sql` is regenerated from repository migrations; it is not executable migration SQL.

The earlier read-only history preflight found the shared maximum version at `20261208000015`; this must be checked again before any separately approved apply. Historical duplicate/history-missing versions must not be replayed or repaired as part of this release.

## Verification and remaining acceptance

Local checks cover actual PostgreSQL persistence, complete detail mapping, claim-only intake, different-upline genealogy, cross-job and concurrent retries, two purchases in one workbook, legacy recovery, stale-edit protection, receipt matching, existing-reservation reuse and ACL/RLS boundaries. Focused API and UI tests, typechecks, lint and an admin build are part of the local verification record.

Latest results: 191 API/parser/security/route tests passed; the broader affected UI/Finance run passed 112 tests, followed by the final changed-screen run of 52 tests and the five continuation/payment-panel tests. API, contracts and admin typechecks passed. The admin build passed. Scoped lint had no errors and retained one existing fast-refresh warning. `git diff --check` passed. The current continuation PostgreSQL script passed all sections, the legacy company-workbook suite passed 26 checks with zero RLS violations, and the purchase Gate 3 suite passed 1,316 checks.

The historical purchase test was corrected to distinguish private helpers from intentionally service-only public wrappers. Its two intentionally updated legacy wrappers are checked for signature compatibility, explicit service-only ACLs, and real sale-only verification/activation behavior inside a rolled-back transaction; their old function bodies are not incorrectly required to remain identical.

Release acceptance is still pending: actual Excel Desktop and Excel Online save/reopen/import tests, and an authenticated browser flow with real private receipt storage and reload persistence. Artifact rendering and component tests do not prove these environments. Native searchable dropdowns and date pickers vary by Excel version; the workbook also supplies Reference Lists filtering/Find and day/month/year entry.

No live customer has been repaired, and no deployed behavior is claimed. The approved push triggers the configured Preview build; it does not apply SQL. The required migration `20261208000016` is now live-applied under the subsequent explicit approval recorded above. Any scoped customer recovery still requires separate approval. The remaining Excel and authenticated browser acceptance checks are still pending.
