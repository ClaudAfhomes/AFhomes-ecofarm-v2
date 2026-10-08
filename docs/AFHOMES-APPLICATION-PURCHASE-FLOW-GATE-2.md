# AF Homes application-first purchase flow — Gate 2 concrete contract

Date: 2026-10-07. Execution: native. Gate 1 approved; Gate 2 pending human review.
Workspace: AFhomes-ecofarm-v2-claud-promote, branch claud/develop.
Base: c165a21ad4a835b20ee71cc51eebc00d6be21d62.

## Execution ledger and scope

Task A: new opt-in contracts and regression tests implemented. Existing runtime handlers and legacy schemas are unchanged.
Task B: concrete local DDL/private-helper draft, SQL text guards and a read-only catalog-check module drafted.
STOP at Gate 2. Tasks C onward have not started. No database apply, commit, push or deployment occurred.
The migration is NOT RELEASEABLE: operational transaction RPCs and legacy lock-order replacements must be completed after this review.

Files:
- packages/contracts/src/schemas/purchase-flow.ts and purchase-flow.spec.ts
- packages/contracts/src/index.ts: new export only
- api/_handlers/purchase-flow-migration.spec.ts
- supabase/purchase-flow-integration.ts: uninvoked read-only catalog checks
- supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql

Migration SHA-256:
373ECB106B5F654FA827F8BCFEB9D27FDA7C01EDD6CF31B8FF7A62A12C3E7E88

## Concrete schema delta

1. customer_application_purchase_terms stores immutable versioned terms. UNIQUE(application_id,version) and composite identity FKs bind the application, customer, plan and seller. Terms contain frozen scheme, price, included 10000 reservation amount, initial/installment figures, benefit period/points/inclusions, commission rule/rate/basis/amount, capture actor/time and review reason.
2. customer_applications gains nullable purchase_terms_id. Its composite FK binds that exact terms row to the same application. A live reservation freezes the application terms pointer.
3. reservation_agreements.sale_id becomes nullable. Existing rows default origin='sale' and still require a sale. origin='application' requires application/customer/seller/terms and all added economic snapshots. Its exact terms identity FK plus snapshot guard prevents unrelated or rewritten terms. Existing sale_id uniqueness remains. A partial unique index permits only one non-cancelled application-origin reservation per application.
4. Application-origin reservation source/date fields are immutable. Executed/cancelled states are terminal. Final sale linking requires sale_id, finalized_by and finalized_at together, with executed status. Once linked, the sale reference cannot change.
5. payments.sale_id becomes nullable. Existing rows default origin='sale', requiring a sale and no reservation. origin='reservation' requires reservation/customer. The same row may acquire the final sale ID once; it is never copied or changed to sale origin. A reservation/reference partial unique index prevents duplicate references within that source.
6. private.mutation_requests gains result_receipt. Existing operations remain; purchase terms review, submit/decide, reservation transition, verification and finalization are added. A non-null receipt cannot be rewritten. Existing complete_mutation remains unchanged.
7. private.purchase_document_evidence stores kind, one source FK, generated source_id, revision, schema version, actor/time and allowlisted fields. Exactly one source must match the kind. UNIQUE(kind,source_id,revision). Updates/deletes are refused, except explicit table-owner disposable-test cleanup.

No old terms, sale economics, payments, identifiers or evidence are fabricated or backfilled. Old applications require an explicitly confirmed new offer later in Task C.

## Deferred consistency contract

A deferred composite FK connects payments(reservation_id,sale_id) to reservation_agreements(id,sale_id).
NULL pre-sale links additionally need explicit checks; the FK alone is insufficient.
The same deferred constraint function runs on payment insert/update, reservation insert/update, application update and sale update.
At commit, every reservation payment must have the reservation customer and exactly the reservation sale ID, including NULL before finalization.
A finalized application reservation must reference a sale with the same customer/plan/seller; its application must reference that same sale.
Checks read final transaction state and acquire no explicit parent FOR UPDATE locks. Operational RPCs must serialize mutations in the canonical order; this draft alone does not prove concurrency safety.

Canonical operational order:
request/advisory → application → reservation → sale if present → payments by UUID → membership → customer → commission/points descendants.
Future parent-first replacement of verify_card_payment is mandatory before enabling finalization. Existing allocator definitions stay intact.

PostgreSQL rationale: composite FK NULL behavior and constraint triggers require real commit-time probes.
Sources: https://www.postgresql.org/docs/current/ddl-constraints.html and https://www.postgresql.org/docs/current/sql-createtrigger.html

## Field-by-field document evidence

All kinds include reservation/sale/application numbers where present, customer number/name, seller name, actor name and frozen total price.
Commercial evidence adds exact terms ID/version, tier/scheme, reservation/initial/minimum amounts, monthly amount/months, spot-cash days, validity months, discount, annual points/tranches, holder limit, inclusions and commission rate/amount.

- reservation: commercial fields, lifecycle status, holder names/addresses, agreement/reservation dates, revision text, amortization dates/due day, signature statuses, schedule lines and captured verified total/balance.
- payment_recorded: payment number/amount/method/reference; recorded status; captured verified totals and balances before/after. Recording itself adds no verified money.
- payment_verified: the same payment fields, verified status and captured before/after figures.
- purchase_finalized: commercial fields, payment_verified status, contributing verified payment numbers, verified total/remaining amount and finalization timestamp.
- membership_activated: membership number, active status, yearly points, actual allocated points, validity months, verified total and expiry.

Schedule entries allow only lineNumber, particular, amount, paymentDate and remarks. No whole-row to_jsonb or generic object snapshot is used. Builders select source rows internally and call jsonb_build_object with explicit keys. Government IDs, receipt/storage paths, QR/fallback tokens/hashes and activation URLs have no allowed key.

Plan refinement for review: private.append_purchase_document has FOUR parameters, not the proposed fifth generic JSON payload. The builder owns field derivation. This reduces the ability of a caller to smuggle sensitive fields into history.
Second refinement: a generated source_id plus one unique key replaces four source-specific evidence indexes, while explicit source-kind checks retain the same uniqueness rule.

## Implemented private helper signatures

private.build_purchase_document_fields(kind text, source_id uuid, actor_id uuid) RETURNS jsonb
private.append_purchase_document(kind text, source_id uuid, revision integer, actor_id uuid) RETURNS uuid
private.complete_purchase_mutation(actor uuid, operation text, request uuid, payload jsonb, result uuid, receipt jsonb) RETURNS void

All three are revoked from PUBLIC, anon, authenticated and service_role. Future authorized SECURITY DEFINER transaction cores invoke them internally. No helper independently grants business authority. Evidence table direct access is revoked from those same roles. Terms expose only service-role SELECT, with RLS enabled and browser access revoked.
Receipt keys are restricted to resultId/status/purchaseTermsId/termsVersion/documentEvidenceId/revision/recordedAt/verifiedAt/finalizedAt. Future wrappers return the original stored receipt after fresh authorization and request-fingerprint validation.

## Exact future RPC interfaces — proposed, NOT installed

private.purchase_terms_for_application(application uuid, seller uuid) RETURNS jsonb
public.review_application_purchase_terms_once(request uuid, actor uuid, application uuid, expected_hash text, reason text, seller_candidate uuid DEFAULT NULL) RETURNS uuid
public.submit_purchase_application_once(request uuid, actor uuid, application uuid, expected_hash text, seller_candidate uuid DEFAULT NULL) RETURNS uuid
public.decide_purchase_application_once(request uuid, actor uuid, application uuid, decision text) RETURNS uuid
public.reserve_application_purchase_once(request uuid, actor uuid, application uuid, terms uuid, input jsonb) RETURNS uuid
public.transition_purchase_reservation_once(request uuid, actor uuid, reservation uuid, action text, input jsonb DEFAULT '{}') RETURNS uuid
public.record_reservation_payment_once(request uuid, reservation uuid, input jsonb, actor uuid) RETURNS uuid
public.verify_purchase_payment_once(request uuid, payment uuid, decision text, reason text, actor uuid) RETURNS jsonb
public.finalize_reservation_purchase_once(request uuid, reservation uuid, actor uuid) RETURNS uuid
public.purchase_document(kind text, source uuid, revision integer, actor uuid) RETURNS jsonb

These will be service-only public entrypoints: revoke PUBLIC/anon/authenticated EXECUTE; fresh existing permission/ownership checks repeated inside SQL; qualified columns and safe search_path. No new role vocabulary.
Existing verify_card_payment and activate_card_sale signatures/results remain compatible; their ordered cores/authorization/evidence changes are pending Tasks F/H.

## Fresh local verification

- Contracts: 183 tests passed in 12 files, including 31 new purchase-flow cases.
- API: 1790 tests passed in 85 files, including 4 new migration text guards.
- Full pnpm typecheck passed, including supabase TypeScript. Deployment typecheck is included in the same Turbo run.
- Prettier check on all four new TypeScript files passed.
- check:env passed; git diff --check passed.

Observed RED before implementation: missing contract module/migration, and subsequently invalid commission arithmetic, non-whole-year validity and inconsistent installment totals. These are now GREEN.
SQL text guards are not PostgreSQL proof. The catalog module compiles but has not run. No migration execution/reapplication, RLS runtime probes, lock/concurrency tests, live browser flow, PDF rendering or production proof is claimed.

## After Gate 2 approval

Complete transaction cores/permission wrappers and legacy lock-order replacements before treating this migration as usable. Execute/reapply on disposable PostgreSQL with synthetic legacy rows at Gate 3; inspect catalogs/ACLs, force deferred constraints, reject contradictory direct writes, compare unchanged legacy snapshots and prove every-table cleanup. Failures must be corrected before later gates.
The shared database, push and Production still require their separate explicit approvals. Roll forward corrections; do not delete purchase history or restore NOT NULL after pre-sale rows exist.