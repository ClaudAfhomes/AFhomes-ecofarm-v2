# Native purchase continuation review

27 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS remains last.

Follow-up: [ordinary workbook confirmation and purchase continuation](IMPORT-CONFIRMATION-REPORT.md)
implements company-workbook confirm/source/application writes. Statements below
about those writes being blocked describe this earlier read-only checkpoint.

## Delivered

The existing continuation panel and application-prefill services now have native
MongoDB readers for ordinary company workbook source records:

- `GET /customer-imports/continuations`
- `GET /customer-imports/rows/:id/continuation`
- `GET /customer-imports/rows/:id/intake`
- `GET /customer-imports/sources/:id/intake`

Behavior follows the ordinary continuation and source-intake rules from
`20261208000016_afhomes_customer_import_continuation.sql`. Certified historical
continuation from `20261223000001_afhomes_customer_historical_import.sql` remains
explicitly blocked with HTTP 501; it is not approximated as ordinary purchasing.

The reader identifies the correct application/reservation/Finance/activation/
completed or review stage from the actual linked purchase. Cancelled reservations
and rejected/cancelled applications retain their review path. An existing active
membership does not imply that another imported purchase is complete. Explicit
existing-reservation references must match the exact customer and frozen terms.

Both import-view and customer-view permissions are required. Source-row access
also requires job ownership or the existing customer-update/Finance-update
authority. List queries filter authorized jobs, deduplicate source-linked rows,
then sort and paginate in MongoDB. The source endpoint checks the original row's
authority rather than granting access from a supplied identifier alone.

Current customer identity is checked against email and supplied customer/RA
references. Ambiguity fails closed. Missing customer fields are proposed using
the source's explicit field whitelist; differing identity, address or company
facts require review. Equal exact money and equivalent phone formats do not
create false conflicts. Statements belonging to a different purchase do not
overwrite the customer's original statement. Private TIN proposals use a
placeholder, and intake strips TIN values before invoking the existing prefill
builder.

Older rows without normalized customer facts use the existing recovery builder
without rewriting raw or normalized evidence. A new person receives a manual
application-completion path with missing consent/acknowledgment requirements.
Reading that path never creates a customer or accepts consent.

Source, target and team review revisions are derived from current records. The
claim-reconciliation revision builder is shared with these readers, including
customer/source identity checks and the expanded membership/points graph. The
existing real-development gate allows only the new read routes. Continuation
writes and workbook upload/commit remain blocked.

## Proof

PASS: 76 targeted API tests in native continuation, native claim reconciliation
and development-gate suites. Eight new continuation tests use a fresh disposable
MongoDB replica set, actual HTTP and normal cookie/password setup for fictional
accounts. They cover purchase stages, immutable source/customer evidence, private
prefill, source deduplication before pagination, ownership and permission denials,
identity conflicts, new-person intake, existing-reservation term checks, older
fact reconstruction and fail-closed certified/write paths. Initially, the native
continuation tests failed with HTTP 501 before implementation.

PASS: 42 existing React tests for `ImportContinuationPanel` and
`OfficialFormsPages`. The test environment emitted its existing `scrollTo`
not-implemented messages. These tests use test services; they do not establish
browser acceptance of the native backend.

PASS: API TypeScript, environment isolation and scoped whitespace checks.
Browser acceptance, full-suite/build reruns and Atlas smoke tests are NOT RUN.

No administrator, Atlas business data/indexes, Supabase data, `.env.local` or
existing CMS work was changed. No dependency was added. Nothing was staged,
committed, pushed or deployed.

## Remaining

Follow-up: [workbook upload/review jobs](WORKBOOK-REVIEW-REPORT.md) now implements
the file and persisted-preview portion. Business commit/recovery is still pending.

This completes continuation review/intake reads, not workbook importing end to
end. Native file upload/parse, job review/commit, source creation/recovery writes,
import-backed application completion and certified historical processing still
need their own implementations and verification. Continue those workflows,
then reporting and outstanding acceptance. Preserve the current interface and
business history. CMS stays last.
