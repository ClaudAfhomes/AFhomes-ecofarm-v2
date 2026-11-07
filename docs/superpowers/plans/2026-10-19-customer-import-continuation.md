# Customer Import Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for direct implementation, or superpowers:subagent-driven-development only if the user explicitly selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an easier Desktop/Online Excel template and import customers into complete, resumable normal application workflows.

**Architecture:** Extend the existing import job/row system and canonical customer/application/reservation/payment graph. A transactional commit creates or reuses customer details and canonical source intake, linking a normal draft only when its real mandatory fields exist; later progression uses existing authorized terms, reservation, Finance and activation transitions. Preserve original import evidence and make recovery of existing imported customers explicit and idempotent.

**Tech Stack:** TypeScript, Zod, React, existing AF Homes UI and REST helpers, Supabase/PostgreSQL functions, existing XLSX ZIP/XML utilities, pnpm/Vitest and disposable PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-19-customer-import-continuation-design.md` (approved).

**Release scope update:** The user subsequently explicitly requested commit and push to `claud/develop` Preview. This authorizes the scoped Git release only; shared migration application and live customer recovery remain separately gated.

**Revision:** R1, 2026-10-19. User approved direct local implementation. The exhaustive [field mapping](../specs/2026-10-19-customer-import-field-map.md) and safeguards below are part of this plan. Live migration, recovery, push and deployment require separate scoped approval.

## Global Constraints

- RA NO identifies the customer, not a reservation agreement. Preserve all existing identifiers and historical aliases.
- No live data repair, migration application, commit, push, or deployment is authorized by this plan.
- Existing credentials are not authorization for shared-database writes. Disposable PostgreSQL is test-only.
- No replacement IST/OST accounts, genealogy writes, parallel lifecycle, automatic payment recording/verification, or membership activation from spreadsheet claims. Finance must explicitly accept each reconciled claim before recording it.
- Exact-decimal server calculations are authoritative; frozen historical terms never change because today's price differs.
- New template: macro-free `.xlsx`, Excel Desktop and Excel Online, human-readable labels and safe fallback controls.
- Preserve current company workbook compatibility and existing protected business history.
- Existing import permission does not grant approval, reservation execution, payment verification or activation permission.
- Existing components/helpers first; no new runtime dependency without a demonstrated missing capability.
- Work in the existing clean isolated checkout; preserve the user's original workspace.

## Review Focus

1. A user sorts one sheet: customer-key joins must still associate every holder, team and payment correctly (Task 1).
2. A request retries after its commit response was lost: recover the same linked records without duplicate money or memberships (Task 3).
3. A clerk changes a customer after original import: recovery preserves the edit and reports the conflict (Tasks 2 and 4).
4. Native Excel dropdown search/calendar is unavailable: a usable documented fallback works without macros (Task 5).
5. A historical contract differs from today's plan: review the discrepancy; never silently reprice or recalculate frozen payments (Tasks 1 and 3).

## R1 enforceable contracts

These contracts replace any less-specific wording in the tasks below.

### Payment claims have four separate steps

`imported claim -> Finance reconciliation -> recorded/unverified payment -> verified payment`.
Import and continuation create no ledger payment. Finance reconciliation reads the claim,
existing payments, actual date, method, receipt/reference, amount and private proof. A
Finance-authorized operator explicitly accepts one reconciled claim for recording, or
links it to an existing matching payment, or holds/rejects it with a reason. Missing
proof, unresolved duplicate candidates or unclear identity leave it as a claim.
Recording requires an executed eligible reservation and calls the existing recorder
inside a transaction owned by the new claim-acceptance wrapper. Verification is a
separate existing authorized action. Neither claims nor recorded/unverified payments
increase verified paid totals, reduce the verified remaining balance, qualify commissions,
finalize a sale or activate membership. Recording may change only the recorded total,
recording evidence/audit and its reconciliation task. Test all other statuses/totals
before and after recording, including commissions, points and membership.

### Canonical purchase and payment source identity

- Add a required human-readable `Purchase reference` to v2 Customers. Its issuer is an
  authorized server-derived organization scope, never an arbitrary workbook tenant ID.
  An existing authoritative application/reservation reference can resolve that source;
  otherwise the reviewed historical/new purchase reference establishes a source record.
  The canonical source identity is `(issuer_scope, normalized_purchase_reference)`.
- Enforce a database UNIQUE constraint on that source identity and a single linked
  application per source. Customer ID is NOT an application uniqueness key. The same
  customer with two distinct purchase references may have two legitimate purchases.
  A reused source reference with a different customer or material payload is a conflict.
- Each v2 Customers row represents a customer purchase, with a unique workbook Customer
  key. Different keys may resolve to the same customer if purchase references differ.
  Related sheets join this key; they never depend on row position. Payments belong to
  the corresponding canonical purchase source as well as the resolved customer.
- For committed v1 rows, keep the original import-row UUID as durable provenance. The
  recovery preview requires explicit linking to an existing purchase source or assigning
  a reviewed purchase reference before financial progression. Re-uploaded v1 rows are
  not new purchase authority merely because they received a new job/row/request UUID.
- Require `Payment claim reference` for each payment row. UNIQUE `(purchase_source_id,
  normalized_claim_reference)` enforces one canonical claim across request/job IDs.
  Its accepted `payment_id` is set once under the claim lock; another request returns
  the same receipt or a conflict. Rejection/reversal uses normal forward-only history.
- New provenance tables are justified here: one private source table (including
  application link, original source hash and ownership), a private claim table, and an
  import-row-to-source link if needed for multiple uploads of one source. Names:
  `private.customer_import_purchase_sources`, `private.customer_import_payment_claims`,
  `private.customer_import_source_rows`. Unique source row ownership prevents one row
  being attached to conflicting purchases. Existing import rows remain original evidence.
- Compute a server-only reconciliation fingerprint over normalized reference, method,
  payment date, exact amount, currency and customer, then search existing claim/payment
  candidates across imports. Acquire a transaction lock for that fingerprint before an
  acceptance decision. This is a candidate detector, NOT a global payment uniqueness
  constraint: banks can reuse references and two real payments can share amount/date.
  Distinct claim references do not bypass reconciliation. Possible duplicates require
  explicit match-to-existing or documented distinct-payment evidence before recording.

### Stale-target protection and one transaction implementation

Recovery preview returns both `expectedSourceHash` and `expectedTargetVersion`. The
target token is server-derived from a versioned canonical JSON snapshot of the exact
mutable customer/holder fields, source linkage, application and reservation states,
frozen terms ID/version, relevant genealogy and claim/payment linkage. Sort set members
by primary key; include current values even when a table has no reliable updated_at.
Do not log snapshots, TINs or raw private values. Tokens are comparison values, not
authorization or bearer credentials.

Under the same row/parent locks used for mutation, recompute and compare both tokens.
A concurrent edit or new existing purchase/payment returns `IMPORT_TARGET_CHANGED`
with no writes and requires a new preview. Both `commit_customer_import_row` and
`continue_customer_import_once` call ONE private canonical helper that locks/revalidates
the source, checks identity and creates/reuses its draft application. They cannot have
separate uniqueness/mapping implementations. An authenticated identical successful retry
may return its durable canonical receipt without reapplying edits; changed payloads or
source-to-customer bindings conflict. This exception must not let a new stale recovery
operation write against a target changed by someone else.

### Actor and export authorization

`p_actor_id` comes only from `authorizeAfHomes`'s verified current request principal,
never request JSON, query parameters, workbook content, the source job creator, or a
stored historical actor. Reject unexpected actor fields in request schemas. SQL rechecks
the actor's active account, effective permission and ownership/team scope for each
operation. Public wrappers are service_role-only: revoke EXECUTE from PUBLIC, anon and
authenticated explicitly in the same transaction; private helpers also revoke service_role.
Use schema-qualified objects, a secure explicit search_path with pg_temp last, and inspect
both schema USAGE and function ACLs. Test direct browser-role calls with another actor's UUID.

The service credential remains the trusted API-to-DB boundary. SQL receiving a shared
service-role connection cannot independently authenticate which end user the API passed;
do not claim protection against a compromised service credential or invent an auth.uid()
check that would incorrectly treat the service JWT as an end-user JWT. Audit the verified
operator, source and decision. Never grant a new user-callable actor-parameter RPC.

Blank-template access, scoped team options, customer detail reads, populated customer
exports, and private payment evidence each use their existing distinct permission gates.
Import-view alone does not authorize populated PII exports or arbitrary customer/claim
reads. The current export handler checks the import module alone, so strengthen it to
require BOTH `governance.customer_import` view and `sales.customers` view plus current
customer row scope. No new permission slug is invented. Omit raw TIN/IDs, proof URLs and
unscoped team contacts. Permission revocation after preview must prevent confirmation.

### Workbook and pricing boundaries

The field map is exhaustive: every visible data column is persisted, computed or explicitly
review-only. Unsupported/unmapped populated columns block confirmation; they cannot be
silently dropped by acknowledging a generic warning. An explicit required column missing
or renamed blocks parsing. Protected metadata carries template version and mapping version;
users do not enter version fields on customer rows. Metadata is still untrusted and must
match sheet/header shape server-side.

Reject actual formulas outside allowlisted calculated cells, external workbook references,
external links/connections, embedded executable parts, DDE and unsafe formulas. Export all
untrusted strings as literal string cells, including text starting with =, +, -, @, tabs
or control characters. Preserve literal text where legitimate; it must not become an
executable formula after Excel round trip. Recompute protected formula outputs server-side.

Gold example inputs: Move A, cash contract price 312000.00, approved monetary discount
0.00, contract total 312000.00, included reservation fee 10000.00. The fee is PART of
the total. `312000.00 - 10000.00 = 302000.00`; four subsequent Move A installments are
75500.00 each under the current scheme. Claim and unverified recording leave verified
balance at 312000.00 when no earlier payment is verified; verifying the 10000.00 payment
then produces 302000.00. An existing frozen contract overrides this example and today's
plan; do not infer price/discount or double-charge the fee. No change to frozen terms is
authorized by import. Unsupported historical pricing stays blocked for explicit normal
terms review; if that existing workflow cannot represent it, report the limitation for
separate approval rather than changing its pricing rules inside this feature.

## Task 0: Migration ordering and dependency preflight (read-only before SQL work)

**Files:** Read migration directory, `MIGRATION-APPLICATIONS.md`, `MIGRATION-VERSION-RECONCILIATION.md`, relevant fetched branch trees and live migration/catalog history. Update only sanitized design evidence until SQL implementation is approved.

- [ ] Compare local files and `claud/develop`, `orly/develop`, `develop` SHAs/versions against applied history. Record duplicate-version groups and history-only/local-only versions, not only max(version).
- [ ] Recheck actual live definitions/dependencies needed by the new helper, since an installed/superseded function need not have a matching history entry. Do not replay missing-history files or repair/rename applied migrations.
- [ ] Select an unused numeric version greater than every effective local/branch/live version. Generate a new local file with CLI after checking `supabase migration new --help`; if CLI emits today's older timestamp, rename only that NEW unapplied, uncommitted file to the selected convention version before SQL is authored/tested. Recheck uniqueness and ordering at creation and before a separately authorized apply.
- [ ] Add a local check asserting `candidate > effectiveMax`, no candidate file/history collision and no unexpected target dependency drift. A shared-target mismatch blocks apply; it does not authorize baseline repairs.

Read-only snapshot on 2026-10-19: HEAD/claud SHA `de6577c`, develop `f9847d0`, orly/develop `c3c56ce`. HEAD, claud and develop max `20261208000015`; orly max `20261208000011`; live max `20261208000015`. Local 110 files/108 unique versions; live 99 versions. Local duplicate versions `20261130000001` and `20261206000003` are historical, not new files to rename. Local-without-history: `20261030000001`, `20261031000001`, `20261127000001`, `20261131000001`, `20261131000002`, `20261131000003`, `20261204000001`, `20261205000001`, `20261206000001`, `20261206000002`, `20261206000006`. History-without-local: `20261012075439`, `20261203000002`. Candidate `20261208000016` is currently unused, NOT reserved or approved to apply. The discrepancies prohibit a blind `db push`/full replay; inspect compatibility first. Ordering and function ACL requirements are supported by [Supabase migration guidance](https://supabase.com/docs/guides/deployment/database-migrations) and [PostgreSQL CREATE FUNCTION guidance](https://www.postgresql.org/docs/current/sql-createfunction.html).

Existing live `record_reservation_payment_once` and `commit_customer_import_row` deny anon/authenticated execution and allow service_role. The recorder checks Finance permission, records status `recorded`, and calculates authoritative balance using verified payments only. These are verified existing behaviors, not newly completed feature tests.

## File ownership and boundaries

| Files | Responsibility |
| --- | --- |
| `packages/contracts/src/schemas/customer-workbook.ts`, `customer-import.ts`, `sales.ts`, `packages/contracts/src/index.ts` | Versioned workbook DTOs, import continuation/recovery response contracts and customer next-action DTO. |
| `api/_lib/customer-workbook.ts`, `customer-workbook-staff.ts`, new `customer-workbook-v2.ts` | Existing validation reuse, new keyed-sheet parser, safe human-label conversion. |
| New `api/_lib/customer-import-continuation.ts` | Pure mapping/review calculation and safe next-action projection; no remote writes. |
| `api/_handlers/customer-imports.ts`, `customers.ts`, `official-forms.ts` | Authorized preview/confirmation/recovery and scoped read projections. |
| New forward migration generated with Supabase CLI; `docs/supabase/CURRENT-SCHEMA.sql` | Atomic field persistence, provenance, row locking, retry receipts, private helpers and grants. |
| Customer Details/Actions, ImportExport page, application/reservation/Finance pages and their service contracts | Complete details, import destination, permission-consistent continuation and recorded-payment review. |
| `api/_lib/customer-workbook-export.ts`, new v2 template asset and builder | Human-readable blank template and populated export. |
| Focused API/UI tests; new disposable DB script | Boundary, persistence, transaction, authorization and workflow proof. |

No broad handler/UI refactor. Split only the new parser and pure continuation mapper from already-large handlers.

## Task 1: Versioned keyed workbook parsing and financial claims

**Files:** Create `api/_lib/customer-workbook-v2.ts` and `.spec.ts`; modify `packages/contracts/src/schemas/customer-workbook.ts`, `customer-import.ts`, `packages/contracts/src/index.ts`, `api/_lib/customer-workbook.ts`, `customer-workbook.spec.ts`, and `customer-workbook-staff.spec.ts`.

**Interfaces:**
- Export `workbookPaymentClaimSchema`, `workbookCustomerV2Schema`, `WorkbookPaymentClaim` and `WorkbookCustomerV2` from contracts. Customer shape: `customerKey`, `purchaseReference`, `customerId: string | null`, `fields: Record<string,string>`, `payments: WorkbookPaymentClaim[]`; payment shape: `paymentKey` (stable Payment claim reference), `customerKey`, `purpose`, `amount`, `date`, `method`, `reference`, all strings with bounded lengths and validated canonical values. Apply every column/disposition in the field map.
- `parseCustomerWorkbookV2(bytes: Uint8Array): { rows: WorkbookCustomerV2[]; unknownHeaders: string[] } | null` recognizes only the explicit v2 marker, joins by key, and emits `workbook_format='company_v2'` in fields.
- Existing v1 return shape and format marker stay unchanged. Attach v2 payment claims to normalized import data, never to person fields or actual verified payments.

- [ ] Add failing tests `joins_sorted_sheets_by_customer_key`, `rejects_orphan_payment_and_duplicate_keys`, `ignores_formula_only_customers`, `recomputes_balance_without_cached_formulas`, `rejects_conflicting_contract_math`, and `supports_registered_osts_same_tree_different_uplines`. Assert synthetic Gold total `312000.00`, reservation claim `10000.00`, claimed balance `302000.00`; recorded claims do not become verified money.
- [ ] Run `corepack pnpm --filter api test _lib/customer-workbook-v2.spec.ts --maxWorkers=1 --testTimeout=15000`; confirm the new behavior fails before implementation.
- [ ] Implement bounded workbook reading using existing XLSX limits/ZIP/XML helpers, readable enums, real Excel date normalization, exact decimal helpers and trusted server recalculation. Allow formulas only in explicitly calculated v2 cells and reject unsafe/external expressions even there; never evaluate arbitrary uploaded formulas. Ignore their cached results. Reject external links, executable parts, unknown populated columns, overflow, negative money, future impossible payment dates and missing required customer keys. Validate protected metadata instead of accepting version from an editable customer field.
- [ ] Reuse registered-identity and genealogy validation. Ensure the earlier generic person-name validator does not reject legitimate canonical staff references before the staff resolver; add a full-pipeline UUID/AA regression, not only a resolver test.
- [ ] Run new tests plus `_lib/customer-workbook.spec.ts` and `_lib/customer-workbook-staff.spec.ts`; require all pass. Keep historical-price mismatch as a review issue, not a fabricated discount.

## Task 2: Complete field mapping, customer identity and recovery preview

**Files:** Create `api/_lib/customer-import-continuation.ts` and `.spec.ts`; modify import/customer contracts, `api/_handlers/customer-imports.ts`, `.spec.ts`, `api/_handlers/customer-detail.spec.ts`, and `customer-company-fields.spec.ts`.

**Interfaces:**
- `buildImportedCustomerFacts(fields: Record<string,string>): Record<string,unknown>` returns existing canonical person/company/holder fields, using existing naming and privacy contracts. Implement the exhaustive field-map document as a versioned manifest with one tested disposition per column; never silently use forced internal Pending as company-stated status.
- `customerImportContinuationSchema`: `customerId`, `applicationId`, `reservationId`, `saleId` (nullable UUIDs), `stage` (`application`, `reservation`, `finance`, `activation`, `review`), `missingRequirements: string[]`, `conflicts: {field:string;message:string}[]`, and `nextAction: {label:string;path:string} | null`.
- `buildImportRecoveryPreview(source: Record<string,string>, current: Record<string,unknown>): { fill: Record<string,unknown>; conflicts: {field:string;message:string}[] }` fills missing facts only. False/zero remain real values; blank fields do not erase current facts.
- Recovery preview: `GET /customer-imports/rows/:rowId/continuation`, authorized through existing import view plus customer ownership/permission scope; returns continuation, proposed field changes and both server-generated `expectedSourceHash` and `expectedTargetVersion`. No business writes.

- [ ] Add failing tests `persists_all_customer_company_facts`, `ra_matches_customer_not_reservation`, `id_email_conflict_blocks_merge`, `preserves_nonblank_later_edits`, and `masks_tin_in_preview`. Iterate the manifest to cover every supported primary/supplementary/address/team/contract/payment field. Add `import_view_without_customer_view_cannot_export_pii` and row-scope denial cases. Assert no confidential raw field or document URL reaches a broad preview.
- [ ] Run `corepack pnpm --filter api test _lib/customer-import-continuation.spec.ts _handlers/customer-imports.spec.ts _handlers/customer-detail.spec.ts --maxWorkers=1 --testTimeout=15000`; observe the missing mapping/route failures.
- [ ] Build the shared mapper and identity lookup. Match RA/customer identity against current customer ID or a preserved authoritative alias; do not match by name or compare it to reservation numbers. Strong-ID disagreements require review. Check existing alias storage before adding any schema: if none, preserve legacy RA as the existing company field and make it a scoped lookup with collision detection rather than inventing a second ID generator.
- [ ] Implement the authorized read-only recovery preview and source/target revision contract. Apply the field map's authoritative-ID/alias rules; arbitrary workbook RA text cannot merge records. Display source facts separately from verified operational state. Do not silently fill missing consent, signatures or proof.
- [ ] Rerun focused tests, including customer-company field readbacks, and require pass.

## Task 3: Atomic customer/application continuation and normal Finance handoff

**Files:** After Task 0, generate one new forward-only migration using the CLI and assign the verified later unused version only to that NEW unapplied file; modify `api/_handlers/customer-imports.ts` and tests, `api/_handlers/official-forms.ts` and transition tests, relevant contracts and `docs/supabase/CURRENT-SCHEMA.sql`; create `packages/db-testing/scripts/test-customer-import-continuation.mjs`.

**Interfaces:**
- `public.continue_customer_import_once(p_row_id uuid, p_actor_id uuid, p_request_id uuid, p_expected_source_hash text, p_expected_target_version text) returns jsonb`: service-only continuation/recovery wrapper; returns a canonical successful receipt even under a different request ID, but rejects changed material payload, stale target or conflicting ownership before new writes.
- `private.commit_customer_import_source(p_row_id uuid,p_actor_id uuid,p_expected_source_hash text,p_expected_target_version text) returns jsonb`: ONE private transaction implementation called by commit and continuation wrappers. Enforces private source/claim/link uniqueness, full mapping, identity and lock order. Private helper has no direct service_role EXECUTE grant.
- Existing `commit_customer_import_row` continues dispatching legacy/v1 appropriately. New v2 confirmation atomically persists complete available facts and canonical source intake; it creates/reuses a normal draft only after real plan, acknowledgment date and required holder fields satisfy current schema. Do not weaken NOT NULL constraints or insert fake values. New v1 confirmations get complete mapping; historical rows use explicit recovery. Both paths call the shared canonical helper.
- `POST /customer-imports/rows/:rowId/continuation`: `{requestId, expectedSourceHash, expectedTargetVersion}` plus existing CSRF/authorization conventions. Both initial commit and recovery use matching preview tokens. Request bodies never supply actor, verification status, arbitrary lifecycle status, SQL or destination URLs.
- `public.accept_import_payment_claim_once(p_claim_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_claim_version text,p_expected_target_version text,p_decision jsonb) returns jsonb`: service-only Finance acceptance wrapper. Decision is a strict record/match/hold/reject union. Recording requires reviewed private proof and no unresolved duplicate candidate. Existing recorder and claim payment linkage commit atomically under parent-first locks.
- `POST /customer-imports/payment-claims/:claimId/reconcile`: Finance update plus source/customer scope, server-derived actor, `{requestId,expectedClaimVersion,expectedTargetVersion,decision}`. Cannot verify payment or accept a destination reservation chosen arbitrarily by a client. Reconciliation candidate reads use the authorized source/Finance projection and scoped private evidence access.
- Define `ImportClaimDecision` as `{kind:'record';proofDocumentId:string;distinctPaymentReason?:string} | {kind:'match';paymentId:string;reason:string} | {kind:'hold'|'reject';reason:string}` with strict schemas, bounded nonempty reasons and UUID validation. The server checks proof ownership/type/review state and resolves its private storage path; a client-provided URL/path is not proof. A possible duplicate requires documented distinct-payment evidence or match, not an automatic override.
- Job preview/confirmation includes per-row `{rowId,expectedSourceHash,expectedTargetVersion}` tokens bound to protected preview state. Canonical helper validates the same tokens whether called by initial job confirmation or recovery. Add optional `importContinuation` to row results using the shared response contract; do not hide lifecycle outcomes inside untyped UI state.
- Existing `submit_purchase_application_once`, `review_application_purchase_terms_once`, `decide_purchase_application_once`, `reserve_application_purchase_once`, `transition_purchase_reservation_once`, `record_reservation_payment_once`, `verify_purchase_payment_once`, and finalization remain the authoritative transition functions.

- [ ] Add disposable-Postgres failing checks for full readback, one application per canonical purchase source, same source/two request IDs, same payment across jobs, two purchases for one customer, committed-response retry, source/target token denial after customer edits, identity/genealogy changes, rollback and ACL denial. Include permission revocation and browser-role direct calls spoofing another actor UUID.
- [ ] Run `node packages/db-testing/scripts/test-customer-import-continuation.mjs`; its only connection must come from `startDisposablePostgres`. Confirm expected missing-function/behavior failures; never substitute a shared DATABASE_URL.
- [ ] Add the migration's three private provenance structures, UNIQUE constraints, row/advisory locks, private ACLs and existing request receipt patterns from R1. Both wrappers use the one private implementation. API actor is the verified current principal; SQL rechecks active account, permissions/scope and compares source/target tokens under the locks protecting writes.
- [ ] Create/reuse the normal draft application and holders by purchase-source identity only when real mandatory fields exist; otherwise save source intake with applicationId null and exact missing requirements. Store claims separately. After normal application/reservation requirements, Finance must explicitly reconcile and accept each claim before existing recording can occur. Missing proof/unclear identity stays a claim; a matching existing payment is linked, not recorded again. Assert verified balance, commissions, memberships, points and financial transition statuses remain unchanged by import/claim/recording. Completed reservations route to Finance; uncompleted reservations stay with IST.
- [ ] Enforce full normal term/approval/execution gates. Keep historical-price conflicts blocked until an authorized terms review; do not inject a new terms snapshot from unreviewed Excel. Never stamp verified, executed, signed, activated or consented solely from a workbook value.
- [ ] Run new DB proof and `node packages/db-testing/scripts/test-company-workbook.mjs`. Update old assertions only where corrected full-detail/draft behavior is intentional; retain all no-unverified-activation/history/permission safeguards.
- [ ] Run `node scripts/update-schema-index.mjs` to regenerate the context-only `docs/supabase/CURRENT-SCHEMA.sql` from migrations. Run ACL/RLS invariants against disposable PostgreSQL and verify no browser role can execute private helpers.

## Task 4: Customer Details, destination preview and continuation UI

**Files:** Modify `CustomerDetailPage.tsx`, `CustomerRecordActions.tsx`, `CustomerImportExportPage.tsx`, `official-forms-applications.tsx`, `official-forms-reservations.tsx`, `BusinessFinanceQueuePage.tsx`, `services.ts`, `services-reservations.ts`, `queryKeys.ts` and their existing focused specs under `apps/admin/src/features/business/`; modify customer read contracts/handler as needed.

**Interfaces:**
- `getCustomerImportContinuation(rowId: string)` and `continueCustomerImport(rowId: string, body: {requestId:string;expectedSourceHash:string;expectedTargetVersion:string})`, typed REST methods using Task 2/3 schemas. `reconcileImportedPaymentClaim(claimId:string, body:{requestId:string;expectedClaimVersion:string;expectedTargetVersion:string;decision:ImportClaimDecision})` uses Task 3's strict decision union.
- Customer detail/row result includes optional `importContinuation` and current server-derived `nextAction`; links are built server-side from allowlisted existing routes and checked by current UI permissions.
- Add scoped source-intake rows to the existing Applications screen, paginated and permission-gated, with stage `application` and null applicationId until real mandatory fields are completed. `GET /customer-imports/purchase-sources/:sourceId/intake` returns only authorized application-prefill facts and missing requirements; do not select an arbitrary latest import by customer when multiple purchases exist. Continue opens the normal new-application form with customerId and importSourceId. Submitting completion calls the same source helper, not a separate unlinked application creation. A normal new application intentionally unrelated to any import still follows the existing path.

- [ ] Add failing UI tests `shows_imported_full_details_and_next_action`, `routes_completed_reservation_to_finance`, `shows_claimed_recorded_verified_balances_separately`, `recovery_conflict_preserves_current_edit`, `reuses_existing_application_after_reload`, and `hides_unauthorized_transition_actions`.
- [ ] Run `corepack pnpm --filter @afhomes/admin test src/features/business/CustomerDetailPage.spec.tsx src/features/business/CustomerRecordActions.spec.tsx src/features/business/CustomerImportExportPage.spec.tsx --maxWorkers=1`; confirm missing continuation failures.
- [ ] Render complete imported facts from canonical records. Explain claimed/recorded/verified amounts and show the exact missing requirement or conflict. Present explicit recovery preview and confirm; invalidate customer/application/reservation/Finance scopes on successful continuation, never optimistically fabricate a new stage.
- [ ] Connect existing application forms with imported draft/holder/team facts and safe IDs. Reuse current searchable selectors, date controls and dialogs. Preserve query-param/customer-switch race protection. Add visible payment-claim review, using existing authorized recording/verification dialogs after execution.
- [ ] Rerun focused UI tests plus `customer-import-prefill.spec.tsx`, `reservation-finance-queue.spec.tsx`, `reservation-detail-panel.spec.tsx`, and `finance-lifecycle.spec.tsx`; require pass. Finance tests prove that viewing a claim does not record it, acceptance is explicit per claim, missing proof prevents recording, matches link the existing payment and verification remains separate. Check keyboard access, narrow viewport and denial routes locally.

## Task 5: Easier human-readable template and exports

**Files:** Modify `api/_lib/customer-workbook-export.ts`, `api/_handlers/customer-imports.ts`, export/template tests and template download UI; create `packages/contracts/assets/customer-workflow-template.xlsx` and a reproducible builder beside existing workbook tools; retain `customer-company-template.xlsx` for legacy compatibility.

**Interfaces:**
- `customerWorkflowTemplate(): Uint8Array` returns the blank v2 workbook; `customerWorkflowWorkbook(rows: WorkbookCustomerV2[]): Uint8Array` emits a populated compatible export.
- Use the six approved sheets: Start Here, Customers, Supplementary Holders, Sales Team, Payments, Reference Lists. Explicit version marker: `company_v2`. Customer key is an input key for joins, not an official ID.
- Download of registered team/reference options requires existing import view permission plus existing directory scope. Populated exports separately require BOTH existing `governance.customer_import` view and `sales.customers` view plus row scope; import-view alone is insufficient. Never bundle real customer data, hidden PII or broad directory contacts into the blank asset. All untrusted export text is serialized literally, never as formula cells.

- [ ] Add failing round-trip tests for empty template -> zero customers, synthetic Gold reservation-only example -> one customer/payment claim, sorted sheets, leading-zero contacts, optional Gold holder, foreign nationality, leap-day/Excel dates, repeated payments, formula-cache tampering and old-template compatibility. Test every mapped column's readback; unknown required/populated headers, external links and injected formulas block confirmation. Literal =/+/−/@ prefixed text cannot execute on export/reopen.
- [ ] Run `corepack pnpm --filter api test _lib/customer-workbook-v2.spec.ts _lib/customer-workbook.spec.ts _handlers/customer-imports.spec.ts --maxWorkers=1 --testTimeout=15000`; verify missing v2 template failures.
- [ ] Build the macro-free template with readable labels, input/calculated color key, freeze panes, column widths, required-field messages, protected bounded formulas, dependent dropdowns and searchable/filterable reference tables. Use existing XLSX utilities for runtime downloads; use the installed spreadsheet skill for artifact authoring and visual validation. No new dependency without need.
- [ ] Calculate contract total, payment sum and claimed balance using ordinary bounded formulas keyed by customer, while the importer independently recalculates using source inputs. Keep source prices/historical references explicit. Do not double-count the reservation fee.
- [ ] Supply real date cells and a portable Day/Month/Year selector with validated computed date where native calendar controls are absent. Test native dropdown search/calendar in Desktop and Online and document the observed fallback instead of promising unsupported controls.
- [ ] Save/reopen/populate the same synthetic workbook in both Excel platforms, re-import and export it, inspect values/formulas and visually render the entry/payment sheets. Require both Desktop and Online acceptance. If either is unavailable, report the missing proof as a release blocker for the dual-platform template; local implementation may continue, but do not claim acceptance or waive this gate automatically.

## Task 6: Whole workflow proof and release handoff

**Files:** Existing/new focused tests above; sanitize acceptance notes in the implementation handoff. No production customer details, credentials or unsanitized runtime logs in Markdown.

- [ ] Run the API/parser suites and UI suites listed above serially per runner to avoid known worker-start contention. Require no failures or unhandled errors.
- [ ] Run `corepack pnpm --filter api typecheck`, `corepack pnpm --filter @afhomes/contracts typecheck`, `corepack pnpm --filter @afhomes/admin typecheck`, scoped ESLint, `corepack pnpm --filter @afhomes/admin build`, and `git diff --check`; require successful exit codes.
- [ ] Run disposable-DB continuation, legacy workbook, purchase reservation and Finance tests. Record actual persistence, concurrent retry results, ACL/RLS checks and unchanged protected-history totals. Do not count mocked handler tests as SQL proof.
- [ ] On a local UI using an explicitly disposable backend, demonstrate import -> complete details -> draft continuation -> approved reservation -> unverified payment review -> verified balance -> additional collection. Reload at each transition. Show fully-paid finalization follows existing gates and creates one membership/points allocation only.
- [ ] Run recovery preview/confirm twice on a synthetic old v1 import; show missing fields restored, existing newer edits protected, and no duplicate application/payment. Verify unrelated customer/staff/genealogy/history records remain unchanged.
- [ ] Run concurrent confirmations of one source using two different request IDs, and repeat a claim in a different workbook/job; assert one source application and no duplicate ledger row. Create two distinct purchase sources for one customer; assert two legitimate applications remain separate. Edit a customer after preview; require target-version conflict and zero overwrites.
- [ ] Test imported payment without proof -> claim only; Finance accepts a proven claim -> one recorded payment with unchanged verified balance/downstream states; separate verification -> correct verified balance. Match an existing payment -> link only. Reload between every step and compare customer, application, ledger, membership, points, commission and genealogy state after denied/failed actions.
- [ ] Require full mapping coverage, literal-text injection round trips, unknown-field/formula rejection, stale/forged actor denial, migration ordering/collision checks, populated export row scope and both Excel platforms' save/reopen/import acceptance. Missing Desktop or Online proof blocks dual-platform release.
- [ ] Report local completed checks, unavailable Desktop/Online proof, remaining risks, exact migration and recovery scope for review. Ask separately for live migration, scoped recovery and Preview release approval; never silently reuse an older release approval.

## Execution handoff

Recommended: direct implementation in this session, using `superpowers:executing-plans`,
because Task 0 and the six implementation tasks share versioned contracts, transaction receipts and workflow state.
Use no subagents unless the user explicitly selects them. Await the user's review of this
plan and execution choice before product changes. Do not stage or commit plan/spec files
under the skill's generic frequent-commit suggestion; this session's local-only boundary
takes precedence.
