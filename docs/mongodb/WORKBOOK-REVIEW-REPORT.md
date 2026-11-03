# Native workbook upload and review jobs

27 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS remains last.

Follow-up: [ordinary workbook confirmation and purchase continuation](IMPORT-CONFIRMATION-REPORT.md)
implements company-workbook confirm/source/application writes. Statements below
about those writes being blocked describe this earlier review-only checkpoint.

## Delivered

The existing import screen now has MongoDB endpoints for file parsing, persisted
review jobs, paginated row previews, template download and cancellation:

- `POST /customer-imports/parse`
- `GET /customer-imports/jobs`
- `GET /customer-imports/jobs/:id`
- `POST /customer-imports/jobs/:id/cancel`
- `GET /customer-imports/template/csv`
- `GET /customer-imports/template/xlsx`

The source handler and native handler share the extracted file parser, row
validators and private-safe response projections. Existing guided/company,
sectioned, legacy 45-column, flat CSV/XLSX and Google Sheets parsing rules remain
in those shared helpers. Deprecated-template rejection, reference resolution,
geography checks, duplicate identity warnings, exact money and original workbook
review annotations are retained. Google fetches retain the existing URL and
redirect guards; no live Google Sheet was fetched for acceptance here.

Native context comes from registered MongoDB plans, customers, memberships,
staff roles/hierarchy, accreditation numbers and referral-code hashes. It does
not instantiate a Supabase client or use an in-memory Supabase adapter for native
persistence. Ordinary company rows receive the native continuation review and
application-completion proposal. Private TIN values are masked in row responses.
The returned annotated workbook retains the existing source-file review behavior.

File validation and continuation reads prepare evidence before a short write
transaction. That transaction rechecks import-create authority, assigns the
existing AF-IMP identifier format, inserts the job/rows in bulk and appends its
audit. Failure rolls back the entire persisted preview. Preview creates no
customer, application, membership, payment or source claim. Cancellation requires
import-update authority and a ready/validated job, and is audited atomically.

The native local request limit now accommodates the existing 8,000,000-byte file
limit plus base64/JSON overhead, rather than applying the ordinary small JSON
limit to workbook uploads. Operator-only setup defines job-number and job/row
uniqueness indexes; no localhost or request handler applies indexes automatically.
The development gate allows the converted read endpoints and permits parse/cancel
only in its explicit core-write mode. Business import confirmation stays blocked.

## Verification

PASS: 260 relevant API tests across native continuation/review, claim reconciliation,
development gating, inherited import-handler behavior, continuation helpers,
general import parsing and guided workbook parsing. After changing persistence to
one short bulk transaction, all 11 native continuation/review HTTP tests passed
again. They use a fresh disposable MongoDB replica set and synthetic accounts.

New native checks cover CSV upload, 12-row preview/pagination, masking, job reload,
cancellation/repeat denial, company XLSX parsing, uploads above the ordinary JSON
limit, invalid rows, template downloads, invalid Google/private URLs, unsupported
certified mode, permission denial and atomic audit-failure rollback. The upload
test first failed with HTTP 501 before the native endpoints were implemented.

PASS: 25 existing React tests for the import screen, continuation panel and
import prefill. Existing JSDOM scroll/navigation not-implemented messages were
emitted. The earlier continuation/application UI run also passed 42 tests.
These tests use test services, not a live browser session.

PASS: API TypeScript, environment isolation and scoped whitespace checks. Browser
acceptance, the full repository suite/build and Atlas smoke tests remain NOT RUN.
Large-workbook performance against Atlas has not been measured.

No administrator, Atlas data/indexes, Supabase data, `.env.local` or existing CMS
work was changed. No dependency was added, and nothing was staged, committed,
pushed or deployed.

## Remaining

Upload/review is now native. `POST jobs/:id/confirm`, source creation/recovery
writes, import-backed application completion and certified historical processing
still require implementation and remain explicitly blocked. The current work
does not import business records or accept workbook-stated payments as money.
Continue those transactions, then reporting and remaining browser acceptance.
CMS stays last.
