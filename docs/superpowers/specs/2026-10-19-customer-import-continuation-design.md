# Customer import with normal application continuation

Date: 2026-10-19, Asia/Singapore
Status: original specification approved on 2026-10-19; R1 safeguards amended after user review, awaiting revised-plan approval
Scope: local implementation and disposable-database verification. No live data repair,
migration application, commit, push, or deployment is authorized by this specification.

## Outcome and approved requirements

An imported customer must have complete, searchable details and a visible next action
in the same workflow used by normally entered applications. A spreadsheet claiming a
payment must not itself verify that payment or activate membership.

The user approved the conversational design and confirmed use of both Excel Desktop
and Excel Online. They clarified that RA NO identifies the customer, not a reservation
agreement. Preserve all existing customer, employee, accreditation, application,
reservation, payment, membership, sale, and import identifiers and historical aliases.

## Verified defect

The current company workbook path creates a prospect through
`private.commit_company_customer_import`, while explicitly requiring no payment and
no membership creation. It passes only basic person/address data into the existing
import function. Company facts remain in `customer_import_rows.raw_data`; Customer
Details instead reads the customer columns, so those facts are absent there.

A read-only live diagnosis confirmed that the matching Gold import has source data
for citizenship, tier, and reservation fee but empty corresponding customer fields,
and no application, application-linked reservation, or card sale. The importer also
compares `ra_number` with `reservation_agreements.reservation_number`, conflating two
identity domains. Existing customer actions depend on workflow records that do not exist.

Relevant source:

- `api/_lib/customer-workbook.ts`: parsing, staff/geography validation and application prefill.
- `api/_lib/customer-workbook-staff.ts`: registered identities and authoritative genealogy.
- `api/_handlers/customer-imports.ts`: preview, confirmation, duplicate handling and export.
- `supabase/migrations/20261206000006_afhomes_reconcile_workbook_network_version.sql`:
  current company-import persistence and dispatcher.
- `packages/contracts/src/schemas/customer-ssot.ts`: customer detail fields.
- `apps/admin/src/features/business/CustomerDetailPage.tsx`: company detail rendering.
- `apps/admin/src/features/business/official-forms-applications.tsx`: application and next action UI.
- `apps/admin/src/features/business/official-forms-reservations.tsx`: IST reservation queue.
- `apps/admin/src/features/business/BusinessFinanceQueuePage.tsx`: collection and verification.
- `supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql`:
  frozen terms, reservation collection, idempotent transitions and finalization.

## R1 review decisions

The [exhaustive field map](2026-10-19-customer-import-field-map.md) and revised plan's R1
contracts are part of this specification. The user returned the first plan for targeted
revisions before product implementation. Claims require explicit Finance reconciliation
and per-claim acceptance before any ledger recording; verification remains separate.
Canonical source identity, not request ID or customer alone, enforces application
uniqueness. Use private purchase-source, claim and source-row linkage records with
database unique constraints. Preserve multiple legitimate purchases for one customer.
Compare source hash AND current-target revision under mutation locks. Commit and recovery
call one private canonical transaction helper. Derive actor from verified API principal;
service-only RPCs revalidate permissions but do not authenticate an end user independently
from a shared service credential. Direct browser-role access stays denied.

Migration creation follows a fresh branch/local/live history and dependency audit. Current
effective maximum is `20261208000015`; `20261208000016` is an unused candidate only.
Historical missing/extra/duplicate migration versions are not authorization to replay,
rename or repair history. Both Excel Desktop and Online acceptance are required before
claiming dual-platform readiness. Unknown populated/unmapped columns and unsafe formula/
external reference content block confirmation, and populated exports need an explicit
customer-view plus import-view and row-scope gate. Import-view alone is insufficient.

The existing application schema requires real plan, acknowledgment date and mandatory
holder facts even for drafts. An incomplete imported customer therefore appears as a
resumable source intake in Applications until those minimum real facts exist; it does
not receive an invalid draft with fake dates/addresses. Once completed, the same source
links exactly one normal draft and follows the normal application lifecycle. This is
an intake representation in the existing Applications screen, not a separate sale flow.

## One workflow, with review before progression

Import uses the existing customer/application/reservation/payment graph. It does not
introduce a second sale lifecycle or trust a workbook status as a transition command.

| Available and reviewed evidence | Saved result and next action |
| --- | --- |
| Customer details only or missing application requirements | Complete customer facts plus resumable source intake in Applications; create a linked normal draft only when the existing schema's real mandatory fields are available. Show Complete imported application and exact missing requirements. |
| Application complete, reservation not completed | Existing submission/terms-review/approval gates; approved application proceeds to IST Reservations. |
| Approved application and reviewed, completed reservation requirements | Create/reuse and execute an application-origin reservation through normal authorized transitions; Finance lists collection and payment review. |
| Reservation completed with outstanding balance | Finance continues collection against that reservation and its frozen terms. |
| Claimed fully paid, evidence incomplete or unverified | Finance review; no automatic fully-paid or membership activation. |
| Fully paid with verified evidence | Existing finalization then activation workflow; do not create a second sale, membership or points allocation. |
| Cancelled, refunded, suspended, expired or contradictory historical data | Explicit review with the exact blocker and available normal action; import does not silently reopen a cancelled transaction or fabricate missing history. |

Successful import always has a destination and continuation link. If progression is
blocked by required consent, signatures, ID documents, payment proof or term approval,
the preview and destination explain that blocker. A reservation cannot be marked
executed solely because a spreadsheet says Reservation Paid.

For the synthetic Gold Move A example, cash contract price is 312000.00 and monetary
discount is 0.00. Contract total is 312000.00 including the 10000.00 reservation fee,
giving a claimed balance of 302000.00 and four subsequent installments of 75500.00.
Before explicit Finance acceptance there is a source claim only; after recording but
before verification, verified balance remains 312000.00 if no other payment is verified.
Once verified, the normal financial summary reflects 302000.00. A pre-existing frozen
contract overrides this example; a mismatched historical price requires terms review.
There is no duplicate reservation-fee charge or second credit for the same receipt.

## Identity and complete customer facts

- Label RA NO as Customer ID (RA No.) in the new template and UI. Resolve it against
  the existing customer identity/approved legacy alias, then cross-check email and other
  strong identifiers. A conflicting ID and email blocks import instead of merging people.
- Remove reservation-number ownership checks from this customer-ID field. Reservation
  reference is a separate optional field and never an alias for the customer identity.
- Preserve current ID generators and existing values. The current contract includes
  `AF-CUS-XXXXX` and a separate `AF-CC-XXXXXXXX`; this work does not convert them into
  a newly asserted year/sequence format. External historical customer IDs remain
  preserved aliases and are not silently replaced by a generated number.
- Map primary, optional Gold supplementary holder, structured address, citizenship,
  civil status, occupation, related-person facts and package statements into existing
  canonical customer/application fields using established contracts and normalization.
- Keep TIN and identity documents private; mask sensitive values on detail readouts.
  An unavailable optional TIN may be blank; an incomplete one must never be padded.
- Resolve both OSTs by canonical registered identity, checking each lineage separately.
  Accept a common registered VD root with different direct uplines; reject different
  roots, ambiguous identities and workbook managers that contradict the actual Referrer.
  Never create replacement IST/OST accounts or alter genealogy.
- New human-readable staff choices include name and AA number (or a short distinguishing
  reference), mapped to canonical IDs in the server. IDs are revalidated at confirmation.

## Import preview, persistence and recovery

1. Parse the workbook into the existing import-job/row system with a versioned contract.
2. Validate identity, genealogy, geography, money, payment evidence references, workflow
   requirements and duplicate references. Explain every conflict in human-readable terms.
3. Show a per-customer preview: preserved/matched identity, all imported details, source
   claims versus verified facts, intended destination, missing requirements and records
   to create or reuse. The whole job remains read-only until normal import confirmation.
4. Confirm in an authorized transactional database operation: recheck ownership, roles,
   row state, identities and genealogy plus source/target revision tokens; persist complete
   fields and canonical source intake, linking one draft only when mandatory real facts
   exist. The source/draft/continuation receipt commits atomically or the row rolls back.
5. Use normal permission-gated submission, terms review, reservation execution and
   Finance verification actions. Do not call a sequence of browser writes to simulate
   atomic import, and do not weaken existing transition requirements for imported rows.
6. Link import provenance and existing lifecycle records in the protected import result.
   Use canonical purchase/claim source keys and database uniqueness so refresh, duplicate upload and retries
   cannot create duplicate applications, reservations, payments, memberships or points.
7. Show Continue application, Complete reservation, Review payments, Continue collection,
   or Continue activation on Customer Details and the import result, based on current
   server state and effective permissions. Search and direct routes obey the same scope.

Recovery for already imported company rows uses an explicit authorized preview of the
original source and current records. Fill missing customer details only, flag conflicting
later edits, reject stale target revisions, and create only missing workflow links. Preserve original import receipts,
existing terms, memberships, payments and all history. Report repaired, unchanged and
blocked rows separately. No automatic backfill runs during deployment; a live recovery
requires separately approved target scope after local proof.

## Payment data and historical terms

The current workbook has a reservation-fee cell but no reliable payment ledger. The new
template separates contract amounts from actual payments and never treats Total amount
as Amount paid. Each payment row identifies a customer, payment purpose, amount, actual
payment date, method and receipt/reference. Evidence is uploaded privately during system
review; local paths and arbitrary external URLs are not proof and are not fetched.

Imported payments start as source claims, outside the ledger. Finance reconciles proof,
references, date, amount, customer and existing payments, then explicitly accepts each
claim for recording, matches an existing payment, or holds/rejects it with a reason.
Recorded imported payments remain recorded/unverified until a separate Finance decision.
Missing proof does not discard a payment claim; it remains visible with its review task.
Duplicate payment rows are rejected within the file; repeat uploads resolve against
the import receipt and existing payments. Similar references from different customers
require review rather than automatic merging or globally assuming uniqueness.

Exact-decimal server calculations are authoritative. Reconcile reservation payment,
other payments, discounts, contract total and remaining balance without double-counting.
Validate whether reservation fees are included in the quoted contract under the existing
scheme. Do not silently use today's plan price to rewrite historical terms. A historical
price/discount/scheme mismatch is held for authorized terms review before progression.

## New human-readable Excel template

Deliver a macro-free `.xlsx` supported by Excel Desktop and Excel Online. Keep the
current workbook readable by the importer; add an explicit new template version rather
than repurposing old columns or breaking existing exports.

| Sheet | Purpose |
| --- | --- |
| Start Here | Brief instructions, field-color key, stages, examples and review requirements. |
| Customers | One row per customer purchase: Customer key, Customer ID (RA No.), Purchase reference, optional Existing reservation reference, person/contact/address, readable plan/terms, claimed stage, contract figures and calculated payment totals/balance. |
| Supplementary Holders | Optional Gold holder linked by the same customer key. |
| Sales Team | Customer key, Referrer and VIP Recommender choices; each OST's actual lineage shown separately, workbook manager claims validated against the Referrer. |
| Payments | One row per payment claim, with stable Payment claim reference and Customer key; supports reservation-only, installments and fully-paid claims without inventing ledger transactions. |
| Reference Lists | Registered team/plan/reference values available to the authorized downloader, with generated date and searchable table filters. |

Every row uses a workbook-only Customer key across sheets; it cannot masquerade as an
issued system ID. Existing customers additionally use their preserved Customer ID. Two
keys may resolve to one customer only when they identify distinct legitimate purchases.
Purchase reference, scoped to the authorized source issuer, identifies the purchase
across jobs/request IDs. Related sheets never depend on row order.

Usability requirements:

- Familiar labels such as Gold, Reservation paid, Bank transfer and Move A; translate
  them to canonical internal enums server-side. No UUIDs or snake_case in user inputs.
- Distinct input and calculated-cell colors, frozen headers, readable widths, wrapped
  guidance, required-field markers, filters and consistent currency/date formats.
- Dropdowns for controlled choices, dependent geographic/team choices where supported,
  and input messages that state the required format and explain validation failures.
- Searchable dropdown behavior uses Excel's native support on compatible versions.
  Provide searchable/filterable reference tables as the cross-version fallback and a
  guaranteed searchable selector in the system review screen. Do not claim that an
  `.xlsx` file adds a custom search widget to every Excel edition.
- Real Excel date cells with date validation and unambiguous display. Test native
  calendar selection in Online and supported Desktop builds. Provide a portable
  day/month/year selector with a calculated date when a native calendar is absent.
  The system review form also has a date picker. Do not require ActiveX or VBA.
- Use ordinary bounded formulas for age, contract total, payment sum and claimed
  balance. Protect calculated cells against accidental edits while keeping inputs
  editable. Server code recomputes all amounts and ignores cached/formula claims.
- Blank template contains no real customers or default payments. Synthetic examples
  are clearly separated from importable rows. No macros, external links, secrets,
  credential-bearing formulas or unscoped staff directory exports.

Excel support references: Microsoft, Create a drop-down list
(https://support.microsoft.com/en-us/excel/get-started/create-a-drop-down-list),
Apply data validation to cells
(https://support.microsoft.com/en-gb/excel/get-started/apply-data-validation-to-cells),
and AutoComplete for dropdown lists in Excel for Windows
(https://techcommunity.microsoft.com/blog/excelblog/speed-up-data-entry-and-validation-with-autocomplete-for-dropdown-lists-in-excel/3072083).
Native calendar/search availability must be reported from actual platform testing.

## Database and authorization boundaries

Implement a new forward-only migration; never edit applied migrations. Reuse existing
customer, application, frozen terms, reservation, payment and import tables/functions.
Add the three private source/claim/link structures to enforce cross-request and cross-job
source identity and payment linkage; existing request receipts alone cannot provide this
purchase-level uniqueness. Private helpers remain private and validate actor permission.
Existing import permission alone does not grant application approval, reservation
execution, payment verification or activation permission. A user without a later-stage
permission can import a draft and see the authorized handoff rather than impersonating
the next role. Queue visibility uses existing ownership/team permission rules.

Keep shared Supabase usage read-only during development. Prove transactional functions,
privileges, denial paths and idempotency on disposable PostgreSQL. Regenerate
`docs/supabase/CURRENT-SCHEMA.sql` from authoritative migrations after SQL changes.
Live migration, existing-data recovery and Preview deployment are separate release gates.

## Acceptance evidence

Use synthetic registered IST/OST accounts and customer data, covering:

1. Gold reservation-only: complete details, correct team, one application after mandatory
   facts exist, reservation handoff, one source claim, explicit Finance acceptance then
   unverified recording and separate verification/collection.
2. Gold with multiple payments and balance: exact totals and schedule; reload and retries
   preserve one instance of every record and never double-credit reservation money.
3. Fully-paid claim remains inactive until all normal evidence and verification gates pass.
4. Incomplete application has an exact missing-requirements list and working Continue action.
5. Same genealogy/different direct OST uplines succeeds; different trees or manager conflicts fail.
6. RA/customer identity conflicts, historical aliases and reservation numbers remain separate.
7. Existing imported customer recovery fills absent details, preserves later edits and
   links existing records; rerunning recovery changes nothing.
8. Unauthorized import, approval, execution, verification, ownership and direct-route
   attempts are denied server-side; sensitive fields/evidence never leak.
9. Invalid TIN/citizenship, wrong customer payment keys, contradictory totals, duplicate
   receipts, historical-price conflicts and formula-only rows produce precise explanations.
10. Desktop and Online: populate, calculate, save/reopen and import the same template;
    check dropdown/search fallback, date input/selector, protected cells and export round trip.
11. Two request IDs for one source produce one application; two legitimate purchase
    references for one customer produce two applications; cross-import payment candidates
    cannot create a duplicate ledger entry before reconciliation.
12. A target customer edit after preview rejects stale recovery, preserving that edit;
    unknown populated headers, formula injection and unauthorized PII exports are denied.
13. Verify migration ordering against actual branches and applied history; no baseline
    history rewrite. Direct browser-role RPC invocation with a spoofed actor fails with
    zero business writes. Claim/import/recording do not change verified money or downstream states.

Require API/UI regression tests, real disposable-PostgreSQL RPC proof, and local browser
verification of Details -> next action -> queue -> reload persistence. A passing build
alone is not acceptance. A live authenticated import/recovery is not run without explicit
business-data write authorization. Retain the prior parser's compatibility tests.

## Next review

User review of this written specification precedes the implementation plan. The plan
will name exact files, transactional boundaries and local proof commands. Do not commit
this document merely because a workflow template recommends it; the current scope is local.
