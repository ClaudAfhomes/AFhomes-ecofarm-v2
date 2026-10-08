# Application-first purchase flow — proposed design

Status: design for review; no product implementation or migration applied.
Baseline: claud/develop c165a21ad4a835b20ee71cc51eebc00d6be21d62.

## Outcome

An approved customer application creates an AF-RES reservation before any card sale exists. Finance records and verifies payments against that reservation. Full verified payment permits creation of one AF-CSALE, after which the existing secure activation path creates the membership. The PHP 10,000 reservation fee is part of the purchase total: Bronze spot cash PHP 54,000 minus a verified PHP 10,000 payment leaves PHP 44,000.

## Evidence and root cause

OfficialFormsPages.tsx requires saleId before saving. createReservationAgreementSchema requires saleId. The reservation handler authorizes an existing sale, and reserve_from_customer_application_once queries it before saving. reservation_agreements.sale_id is NOT NULL and UNIQUE. payments.sale_id is also NOT NULL; queues.ts builds the payment queue from card_sales. Removing the dropdown alone cannot support first-time purchasers.

The existing reservation RPC permits submitted applications as well as approved ones. The new application-first path accepts approved applications only. Existing application snapshots include tier and benefits, but vip_amount_snapshot is cash price and is insufficient evidence for every payment scheme; application seller names are not authoritative seller IDs.

## Approach

Reuse the existing reservation table, payment ledger, identifier allocator, mutation idempotency store, audit_events, exact-decimal helpers, permission model and PDF writer. Extend them to accept an application-origin reservation before sale creation.

Creating a provisional sale would preserve more existing code but violates the requested timing. A parallel reservation payment ledger would require reconciliation and duplicate finance logic. Neither is selected.

## Commercial evidence

New application submissions capture complete canonical scheme economics and an authorized seller ID server-side. Approval preserves those snapshots; reservation creation copies them without reading current plan prices. Freeze customer/application/plan references, tier, scheme, total, PHP 10,000 included reservation fee, benefit snapshots, seller reference, commission terms and reservation date.

Older approved applications with incomplete commercial evidence require an explicit authorized review that confirms the complete terms in an append-only purchase-terms record linked to the application. Record the actor, time, reason and confirmed values. Do not overwrite historical application snapshots or pretend current plan values were approved historically. Reservation creation fails with a clear review-required conflict until that record exists. This reviewed terms capture uses existing staff review authority and canonical scheme calculations, with no browser-controlled seller or prices.

Freeze the seller reference for the purchase. Preserve the existing analytics rule: sale hierarchy is captured at actual sale creation. Do not rewrite historical hierarchy or infer missing ancestry. Finalization fails safely if the required seller hierarchy is invalid.

## Database and transactions

Proposed migration: 20261101000001_afhomes_application_purchase_flow.sql; verify version availability before creating it. Historical migrations remain untouched.

Allow reservation sale_id to be null until finalization. Add a partial unique application constraint for non-cancelled reservations; preserve legacy sale uniqueness. Add an explicit origin discriminator with constraints requiring the correct source references. Existing rows retain their sale-origin behavior.

Add reservation_id to payments and allow sale_id to be null for reservation-origin payments. Every payment must have a valid source. A reservation payment derives customer/application through its reservation; any linked sale must be that reservation's final sale. Preserve existing payment IDs and rows when linking the finalized sale. Never copy payments or count a payment twice.

Creation locks the application and checks approval, confirmed terms, ownership, duplicate constraints and idempotency before inserting the reservation and audit event. Duplicate request retries return the original result; changed-payload retries conflict.

Payment recording locks the reservation and validates its lifecycle, amount, source and staff authority. Verification locks the reservation before its payment rows; the legacy sale path retains its established sale lock order. Required financial totals are recomputed from verified rows using exact-decimal arithmetic. Capture immutable verification evidence: actor/time, verified total and balance before/after. Receipt versions distinguish recorded from verified money. Rejection and void behavior retain existing legal transitions and authorization.

Finalization locks the reservation, rechecks executed agreement and full verified payment, and creates exactly one sale from frozen terms. Insert through the existing sale snapshot and hierarchy rules, link payments and application, and append audit evidence in one transaction. Replays return the existing sale. Activation remains a separate authorized transaction using the existing full-payment-rechecking activation RPC; sale creation alone does not activate membership.

No unverified payment affects balance or activation. Cancellation of paid or finalized reservations is blocked unless an existing authorized lifecycle path explicitly permits it; this change does not introduce refunds.

Browser roles remain read-only. New tables/functions receive explicit private grants, SELECT-only RLS where appropriate, and narrow server/RPC authorization. SQL rechecks actor permissions and ownership; no client payload supplies actor, status, economics or credentials.

## API and UI

Use strict discriminated request contracts for application-origin and explicit legacy sale-origin creation. Application-origin accepts application ID, idempotency key and editable agreement fields; derived commercial values are server-owned. Responses and list summaries permit saleId null before finalization.

The approved application's action opens the reservation editor with read-only derived purchase details and Create Reservation Agreement as the primary action. Remove the required sale selector from this mode. Save navigates to reservation detail with its AF-RES identifier, lifecycle actions and print action. Keep legacy mode explicitly labelled.

Finance receives reservation-backed queue entries as soon as a valid reservation is ready for collection. Reuse existing finance permissions and payment controls, adapting source references rather than introducing a separate finance subsystem. Show verified paid amount, remaining balance, AF-PAY history and print actions. Finalize becomes available only after execution and full verified payment; server checks are authoritative. Activation queue continues to consume finalized sales.

## Printable records

Reuse the existing server-side PDF builder. Provide reservation agreement, recorded-payment receipt, verified-payment receipt/verification record, finalized purchase record and activation confirmation. Each document includes its stable business identifier, linked transaction identifiers, relevant frozen commercial values, status, actor and timestamp. Recorded receipts clearly state that verification is pending. Verification totals come from immutable verification evidence, not today's balance.

Authorize every export against its source record. Do not print government ID plaintext, onboarding tokens, QR/fallback secrets or private storage links. Activation confirmation references the membership's normal business identifier only. Reprinting must preserve historical financial evidence while accurately labelling the document version.

## Verification and release boundaries

Add meaningful regressions covering all requested eligibility, duplicate, economic, print, authorization and replay cases. Prove the entire chain on disposable PostgreSQL, including concurrent duplicate reservations/payments/finalization, denied actors, full-payment activation, rollback and cleanup. Run API/admin/contracts tests, full unit suite, DB local and harness, deployment/full typechecks, lint, build, environment and diff checks.

Use dedicated explicit-path commits only after implementation and checks. Keep communications work separate. Produce the migration review package with schema changes, invariants, validation queries, local execution evidence and rollback limitations. Do not apply to shared Supabase, push, or deploy Production under this task. Stop for separate shared-migration approval.

## Acceptance

An approved Bronze spot-cash application can create AF-RES without AF-CSALE; verified PHP 10,000 leaves PHP 44,000. Completing verified PHP 54,000 permits one AF-CSALE and then one membership through existing activation. Every link persists across reloads; retries create no duplicate IDs, payment rows or memberships. All five document types export with authorized historical evidence. Legacy sale-origin flows remain valid. Missing commercial evidence produces an actionable review requirement rather than an invented historical price.
