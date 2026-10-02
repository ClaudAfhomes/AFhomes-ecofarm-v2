# AF Homes UAT D1–D4 and post-import integration

Date: 2026-10-01 (Asia/Singapore). Branch: `preview/afhomes-rebuild`.
HEAD remains `6001155021039c3b1aa3883e8938369fb98604c5`.

**PASS — READY FOR CORRECTIVE MIGRATION REVIEW (local verification).**
The deployed application remains unchanged. Migration review and an explicitly
authorized deployment are still required before these fixes become live.

## D1 — database defect; corrective migration required

The applied `public.save_customer_application` function reads the nonexistent
`v_plan.holder_limit` in its Gold secondary-holder check and application holder-limit
snapshot. The real plan column is `cardholder_limit`.

Proposed migration: `20261019000001_afhomes_fix_customer_application_plan_field.sql`.
The version was unused in the local migration directory and is absent from live history.
Read-only live inspection confirmed exactly two invalid references. The local applied
function body matches the live body. The corrective body matches that body exactly
after replacing those two references with `v_plan.cardholder_limit`. Its signature,
return type, SECURITY DEFINER, search_path, locks, transaction behavior, snapshots,
Gold validation and service-role-only execution are preserved.

Real PostgreSQL section 45 passes 31 checks. Bronze and Silver without secondary,
Gold without secondary, and Gold with secondary succeed. Bronze and Silver with
secondary reject. The installed corrected body contains no invalid reference.
The applied `20261018000003` file is unchanged.

## D2 — application authorization defect

The actual selling-role baseline gives Vice Director, Senior Sales Manager, Sales
Manager and OST card-sale view/create permission, without broad update permission.
The previous update gate therefore prevented their normal IST workflow.

Execute finalizes the reservation contract. Its existing handler/lifecycle records
an executed timestamp and agreement status; it does not verify payments, activate
membership or approve finance. Seller finalization therefore uses existing card-sale
create permission with ownership checks. No selling role receives broad update and
no separate reservation permission system is introduced.

Draft mutations, submit, execute, cancel and permitted reopen require create permission
and agreement ownership, or existing card-sale update authority for oversight. Creating
or editing an agreement additionally checks ownership of the selected sale, preventing
creation against or reassignment to another seller's sale. Existing Admin/Super Admin
permissions remain authoritative; Admin is not silently granted cross-seller update.
Executed agreement immutability and existing lifecycle transition checks remain.

Regression coverage includes allowed own edits/submission/finalization/reopen,
unrelated seller refusal, unauthenticated and unauthorized employee refusal,
Super Admin oversight, selected-sale tier conflict, and invalid transitions.
Classification: application fix; no D2 permission migration required.

## D3 — spreadsheet contract defect

IST exports carried `secondary_enabled` without tier context. Import validation
could not determine whether the exported Gold secondary holder was legal.
The template, import and export now carry machine-readable `vip_tier`:
`GOLD`, `SILVER`, or `BRONZE`. Existing secondary columns are retained.

Gold with secondary and Gold without secondary round-trip through real XLSX
serialization/parsing with zero validation errors and preserved fields. Silver
and Bronze without secondary also round-trip. Both reject secondary data, including
data supplied with `secondary_enabled=false`. Unknown/missing tiers reject.
Imported tier is preview context only; conflict with the selected sale's plan returns
409 and does not change the sale tier or economics.
Classification: application/contract fix; no D3 migration required.

## D4 — deterministic business error mapping defect

`SALE_COMPLETE_HIERARCHY_REQUIRED` maps to HTTP **409**, response code **CONFLICT**,
message **“Complete the seller hierarchy before creating this sale.”**
The response contains no PostgreSQL error number, raw trigger message or internals.
The existing trigger's stable seller-required, seller-role-required and over-deep
hierarchy codes also receive controlled mappings. Unknown failures still fail closed.
Classification: application fix; no D4 migration required.

## Post-import integration

`20261019000002_afhomes_customer_import_jobs.sql` supplies the normal-record import
and shared customer search RPCs. An Admin-authorized source-row commit creates normal
customers, reconciled historical sale/payment records when needed, memberships,
points accounts and opening ledger entries. Source rows link to those normal identities;
the application does not use import rows as a parallel customer/member store.

The row RPC locks the source row and job, validates the actor/permission and current
referral/seller codes, writes the graph and source/audit linkage atomically, and returns
the same identities on retry. UPDATE preserves existing tier and financial history,
allows only existing forward lifecycle transitions, and commits its source/audit
linkage in the same transaction. Late-failure tests prove CREATE leaves no partial
customer and UPDATE preserves the previous customer/member state.

Opening balances, including zero and balances below the plan allocation, are preserved
exactly. A positive opening balance produces an adjustment ledger entry; import does
not award new annual points. Export reads the authoritative points account. Historical
payments must cover the plan price before a membership is imported; payments and
commissions are not fabricated. Existing customers without a membership cannot be
silently activated by an UPDATE: the row returns a controlled conflict and directs
the operator to the normal sale/membership workflow.

Normal customer search covers full/partial names, customer numbers, membership numbers,
`AFHOMES:MBS-...`, the hashed fallback member-code mechanism, email, phone and tier.
Normal customer categories use the shared resolver with membership lifecycle and
verified payments/frozen sale terms. The Customers screen filters those categories
server-side. Export reads normal records and uses that same category resolver.
Import completion refreshes customer, membership, analytics and report queries.

The existing number/QR/member-code resolver and customer portal continue to read
normal memberships. Real token redemption links an imported customer account and
preserves its existing membership; the no-duplicate assertion passes. Real import
tests cover active, suspended and expired memberships, exact points, source audit,
retry idempotency and rollback. Existing report, analytics, identity and portal suites
also pass. Live authenticated UI acceptance was not performed.

## Additional audit correction

The required RLS audit found default PUBLIC EXECUTE on two pre-existing private
trigger functions: `reject_overlapping_commission_rule` and
`validate_official_form_holders`. Proposed migration
`20261019000003_afhomes_private_trigger_execute_grants.sql` removes only those
browser/PUBLIC grants. It changes no trigger body or business behavior.
All RLS invariant queries return zero violations after the proposed migrations.

Full validation also found a calendar-week end boundary calculated from the original
date's month/year. It now derives the end from the normalized week start. Regression
cases cover month/year boundaries. Two signed-URL test fixtures used an expired fixed
timestamp; they now model their stated TTL from the test clock.

## Verification and mutation status

| Check | Result |
|---|---|
| API | 1,417 tests passed, 67 files |
| Admin | 394 tests passed, 30 files |
| Web/customer portal | 179 tests passed, 13 files |
| Contracts | 58 tests passed, 3 files |
| Shared | 24 tests passed, 2 files |
| Config | 6 tests passed, 1 file |
| UI | 71 tests passed, 14 files |
| Total workspace tests | 2,149 passed; workspaces verified with one worker |
| Real PostgreSQL | 1,026 checks passed, zero failures; cleanup passed |
| `pnpm typecheck:deploy` | PASS |
| Full typecheck including Supabase scripts | PASS |
| `pnpm build` | PASS |
| Lint | PASS; 17 existing Fast Refresh warnings |
| Environment isolation including built output | PASS |
| Whitespace check | PASS |
| Migration required | YES: three proposed forward-only files listed above |
| Migration applied remotely | NO |
| Migration applied to disposable test DB | YES; fixture history plus proposed files |
| Migration #19 | Unchanged, absent from live history; existing disposable runner includes it in fixture history |
| Commit | NO; HEAD unchanged, working tree remains uncommitted |
| Deployment | NO |
| Live mutation | NO; function/history inspections were read-only |

The initial sandbox/parallel test command encountered child-process restrictions and
timeout noise. The serial workspace runs above are the successful verification.
Build output retains an existing large Admin chunk warning. Local PostgreSQL uses
the platform shim; it does not prove deployed PostgREST/Auth/Storage UI behavior.

Read-only live migration history confirmed `20261018000001`, `20261018000002` and
`20261018000003` recorded, and #19 plus all three proposed versions absent.

## Files in the final working tree

The task began with pre-existing implementation changes. They were preserved,
reviewed and corrected; the list below describes the complete reviewable working
tree rather than claiming every file was first authored in this session.

- api/_handlers/analytics.spec.ts
- api/_handlers/analytics.ts
- api/_handlers/customer-imports.spec.ts
- api/_handlers/customer-imports.ts
- api/_handlers/customers.ts
- api/_handlers/official-forms.ts
- api/_handlers/official-forms-transitions.spec.ts
- api/_handlers/phase12-documents.spec.ts
- api/_handlers/phase2.spec.ts
- api/_handlers/phase27-documents.spec.ts
- api/_lib/customer-categories.spec.ts
- api/_lib/customer-categories.ts
- api/_lib/customer-import.spec.ts
- api/_lib/customer-import.ts
- api/_lib/handler-kit.spec.ts
- api/_lib/handler-kit.ts
- api/_lib/official-forms.spec.ts
- api/_lib/official-forms.ts
- api/_lib/router.ts
- api/_lib/testing/supabase-fake.ts
- apps/admin/src/app/App.tsx
- apps/admin/src/app/navigation.ts
- apps/admin/src/features/business/BusinessCustomersPage.tsx
- apps/admin/src/features/business/CustomerImportExportPage.tsx
- apps/admin/src/features/business/OfficialFormsPages.tsx
- apps/admin/src/features/business/services.ts
- docs/AFHOMES-UAT-D1-D4-IMPORT-FIX-REPORT.md
- packages/contracts/src/index.spec.ts
- packages/contracts/src/index.ts
- packages/contracts/src/schemas/afhomes.ts
- packages/contracts/src/schemas/customer-import.ts
- packages/contracts/src/schemas/official-forms.ts
- packages/contracts/src/schemas/role-baseline.spec.ts
- packages/contracts/src/schemas/role-baseline.ts
- packages/contracts/src/schemas/sales.ts
- supabase/db-integration.ts
- supabase/migrations/20261019000001_afhomes_fix_customer_application_plan_field.sql
- supabase/migrations/20261019000002_afhomes_customer_import_jobs.sql
- supabase/migrations/20261019000003_afhomes_private_trigger_execute_grants.sql

## Customer import release blocker corrective pass - 2026-10-02

**READY FOR EXPLICIT APPLY APPROVAL (local verification only).**

The earlier report above records the preceding UAT work. This section supersedes its import review verdict and describes the final corrective pass. No managed Supabase apply, production data mutation, deployment, commit or push occurred. No authenticated deployed-browser acceptance is claimed.

1. Category query: uses the actual frozen cash_price_snapshot; removes the nonexistent scheme_total_snapshot dependency. The shared customer_directory RPC executes on real PostgreSQL.
2. Historical payments: positive exact-decimal amount, real date, method and actual payment scheme are required. Reference is optional. Future dates, amount-only rows and missing scheme facts reject; no current timestamp or cash method substitutes for historical evidence.
3. Legacy provenance: card_sales.origin=legacy_import with import_job_id/import_row_id and normal customer, payment and membership records. Unknown historical seller remains NULL; created_by records the importer only as the actor. No current hierarchy is captured.
4. Analytics: operational card-sale queries exclude legacy_import. Global payment revenue/trends and operational payment reports also exclude payments attached to legacy sales. No legacy commission is created. Customer/member lookup and customer export include the normal imported records.
5. Membership sequence: supplied and generated MBS numbers share a transaction advisory lock; the supplied number advances the shared sequence; allocation skips existing numbers. Normal activation uses the same allocator.
6. DB membership format: MBS-[0-9]{6} is checked in the import RPC; malformed/duplicate values and sequence exhaustion fail closed.
7. Reactivation: suspended, expired and cancelled members requested as active return IMPORT_REACTIVATION_CONFLICT containing the actual existing and requested states. Bulk import cannot silently reactivate them.
8. Cross-links: membership number, customer number and email must agree on the same customer. Preview and atomic commit reject contradictions; email-based matching resolves the actual existing membership before lifecycle/tier checks.
9. Email: match_import_emails performs case-insensitive trimmed matching in PostgreSQL. Browser callers have no execute grant.
10. Precedence: cancellation, suspension and expiry override Active VIP, consistently in SQL and contracts; an active membership cannot override a suspended customer.
11. Reservation/down payment: actual historical reservation and required-initial snapshots are supported. DP requires a threshold above reservation, fulfilled by verified payment. Equal reservation/initial thresholds remain Reservation Paid. No old plan minimum-down-payment floor is inferred. Non-spot-cash imports require their historical fee snapshots; ordinary scheme configuration remains unchanged.
12. Retry/resume: committing jobs resume through the HTTP handler and UI. Committed row RPCs return the original IDs; invalid/failed rows remain failed. Row reads are paged in batches of 500 through the 5000-row limit and must match the stored total before completion.
13. Counts: CONFLICT/error rows count as failed/invalid, not successful skips. 500 rows with 495 committed and 5 invalid produces completed_with_errors and 495+5 consistent counts. A 1500-row HTTP test proves all pages are processed.
14. Lifecycle: validated_at, committed_at, failed_at and cancelled_at are handled. A trigger rejects backward or unsupported status transitions; retries preserve completion semantics.
15. XLSX bounds: 8 MB compressed upload; 24 MB total expanded; 6 MB per XML part; 4 MB shared strings; 100000 shared strings; 250000 cells; 64 columns; 4096 characters per cell; 5000 data rows; 128 ZIP entries. Declared sizes are checked before inflation; inflation is bounded, actual sizes and CRC checked. XML depth/node budgets also apply.
16. XLSX structure: the single worksheet is located through workbook relationships, including a valid non-sheet1 path. Unsupported compression/encryption, multiple sheets, external/unsafe targets, traversal/duplicate ZIP paths, malformed XML, DOCTYPE, missing/duplicate cell references, invalid shared-string indices and formula cells reject explicitly. A real deflated fixture succeeds.
17. Google redirects: redirect=manual; all redirects reject before a follow-up request. URL host/path, userinfo, port and gid are validated. No OAuth/credentials are introduced.
18. Google streaming: response bytes are counted while reading, with a 5 MB cap and reader cancellation on overflow; Content-Length is prechecked and the 20-second abort timeout remains. Unexpected content types and private/HTML responses reject.
19. Historical price: historical_sale_total is mandatory for new legacy members and is frozen on the sale. Full membership payment must equal that total, independently of current plan price. A missing total for a non-member payment intent is explicitly warned as a current-price estimate; it is not historical evidence.
20. Multiple payments: deferred, explicitly unsupported; do not consolidate real transactions into invented history. Existing-record payment additions must use the normal payment workflow.
21. Secondary holders: Gold secondary information is legacy reference only; Silver/Bronze reject it. The UI states this limitation. DESIGN GAP: normalized membership holders require a separate design change; no second membership or parallel holder system was invented.
22. Export: category, tier, seller UUID, date and search filters execute before final SQL order/limit. Stable seller IDs are used; customer exports include legacy members and protect text formula prefixes. Actual numeric negative report values remain numeric.
23. Customers: all requested category filters, dedicated tier/seller/date filters and seven sort choices are implemented with server-side filtering/sorting and deterministic pagination.
24. Employee lookup: /admin/member-lookup and GET /memberships/lookup use existing operations.redemption view permission. Name/partial name, membership number and current QR/fallback identifier search use the normal directory, never an imported-only query. Results expose only operational name, numbers, tier, statuses/category, validity, points and privilege availability.
25. Imported lookup proof: the real PostgreSQL atomic import is followed by customer_directory search and the same strict member-lookup mapper used by the API. The imported member and exact opening points are found without PII/Auth/payment internals. Real handler tests prove employee lookup succeeds, import is denied, and lacking view permission denies lookup. UI tests verify denied VIP privilege display. This is local SQL/handler/UI evidence, not a deployed signed-in browser session.
26. Real PostgreSQL: 1087/1087 checks pass; section 48 contains 60 checks. The verified 25-version live-equivalent baseline plus A/B/C is applied only to disposable loopback PostgreSQL; #19 is excluded. RLS invariants return no violations. Harness 13/13 proves normal success, injected non-zero failure, and restoration of every tracked table's pre-run count.
27. Unit tests: 2175/2175 pass across 132 files (API 1442, Admin 395, Web 179, contracts 58, UI 71, shared 24, config 6). Final complete invocation used Turbo concurrency=1 with Vitest threads/maxWorkers=1. Earlier product/fixture failures were corrected; Windows process-spawn failures were rerun with permitted local process access.
28. Validation: typecheck:deploy, full typecheck including supabase scripts, lint, build, check:env, network-free db:migrate --check and git diff --check pass. Lint retains 17 existing warnings; build retains chunk-size notices. The DB commands' dependency-install wrapper refused non-TTY module removal after the dependency change, so their existing installed local runner entrypoints were executed directly with identical suite/harness behavior. Reused Windows disposable directories stalled initdb; only the exact workspace test initializers were stopped and fresh isolated directories passed. No real PostgreSQL service was stopped.
29. Migration A 20261019000001: APPROVE. Untouched; real corrected application RPC tests pass. Its holder_limit to cardholder_limit repair remains limited to the two identified references.
30. Migration B 20261019000002: APPROVE. Corrected, unapplied, locally executed and reviewed with the evidence above. This is not authorization to apply it.
31. Migration C 20261019000003: APPROVE. Untouched; only the two private trigger execute revocations remain, with real invariant verification.
32. Migration #19 20261013000001: untouched and excluded from the disposable baseline and selected migration preflight. Raw bytes equal HEAD; no apply performed. The three 2026101800000x applied files also remain byte-identical to HEAD.
33. Changed files: complete current working-tree manifest below, including preceding authorized UAT work. New shared import/directory/lookup code, parser/security tests, migration B, bounded runner selection, customer filters, employee lookup and integration tests comprise this corrective pass. A/C are existing proposed untracked files, not edits in this pass.
34. Commit: none. Branch preview/afhomes-rebuild; HEAD remains 6001155021039c3b1aa3883e8938369fb98604c5. No push/merge occurred.
35. Live mutation: NO. No migration apply, seed, Auth/user mutation, invitation, live import or deployment occurred.

The bounded migration preflight selects exactly 20261019000001,20261019000002,20261019000003. Bare/repeated --only selectors reject before any connection; the preflight acknowledgement example preserves the selected versions. Production apply remains a separately authorized operation. STOP here.

### Current working-tree file manifest

- api/_handlers/analytics.spec.ts
- api/_handlers/analytics.ts
- api/_handlers/customers.ts
- api/_handlers/memberships.ts
- api/_handlers/official-forms-transitions.spec.ts
- api/_handlers/official-forms.ts
- api/_handlers/phase12-documents.spec.ts
- api/_handlers/phase2.spec.ts
- api/_handlers/phase27-documents.spec.ts
- api/_handlers/reports.spec.ts
- api/_handlers/reports.ts
- api/_lib/handler-kit.ts
- api/_lib/official-forms.spec.ts
- api/_lib/official-forms.ts
- api/_lib/report-export.ts
- api/_lib/router.ts
- api/_lib/testing/supabase-fake.ts
- api/package.json
- apps/admin/src/app/App.tsx
- apps/admin/src/app/navigation.ts
- apps/admin/src/features/business/BusinessCustomersPage.tsx
- apps/admin/src/features/business/OfficialFormsPages.tsx
- apps/admin/src/features/business/services.ts
- packages/contracts/src/index.spec.ts
- packages/contracts/src/index.ts
- packages/contracts/src/schemas/afhomes.ts
- packages/contracts/src/schemas/official-forms.ts
- packages/contracts/src/schemas/role-baseline.spec.ts
- packages/contracts/src/schemas/role-baseline.ts
- packages/contracts/src/schemas/sales.ts
- pnpm-lock.yaml
- supabase/apply-migrations.ts
- supabase/db-integration.ts
- api/_handlers/customer-imports.spec.ts
- api/_handlers/customer-imports.ts
- api/_lib/customer-categories.spec.ts
- api/_lib/customer-categories.ts
- api/_lib/customer-directory.ts
- api/_lib/customer-import-security.spec.ts
- api/_lib/customer-import.spec.ts
- api/_lib/customer-import.ts
- api/_lib/customer-xlsx.ts
- api/_lib/handler-kit.spec.ts
- api/_lib/member-lookup.ts
- apps/admin/src/features/business/CustomerImportExportPage.tsx
- apps/admin/src/features/memberships/MemberLookupPage.spec.tsx
- apps/admin/src/features/memberships/MemberLookupPage.tsx
- docs/AFHOMES-UAT-D1-D4-IMPORT-FIX-REPORT.md
- packages/contracts/src/schemas/customer-import.ts
- supabase/migrations/20261019000001_afhomes_fix_customer_application_plan_field.sql
- supabase/migrations/20261019000002_afhomes_customer_import_jobs.sql
- supabase/migrations/20261019000003_afhomes_private_trigger_execute_grants.sql
