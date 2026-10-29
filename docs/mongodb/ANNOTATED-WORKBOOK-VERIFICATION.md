# Annotated import workbook — 29 October 2026

Later recovery/load checkpoint: the two-upload/round-trip integration scenario
exceeded the default 5s test limit (5.6s) during the combined recovery run. That
single multi-step scenario now has a bounded 30s test budget. Assertions and
application request limits are unchanged. Other test deadlines are unchanged.

User requirement: flag incorrect workbook details, explain each issue and offer
a downloadable workbook retaining the entered values and source layout.

The native MongoDB parse handler already calls the same
`annotateCustomerWorkbook` / `annotateFlatCustomerImport` generators as the source.
The existing import page exposes **Download Review Workbook** when the parse
response contains `reviewFile`. Incorrect cells are red; warning cells are amber.
Review status, error explanations and warning explanations accompany the rows.
Correction happens in the source cells, followed by re-upload; review notes are
generated again rather than reused as input facts.

Added a native disposable HTTP regression in
`api/_lib/import-continuation.mongo.spec.ts` that:

1. Uploads an actual guided workbook with an invalid mobile and a second valid
   customer, retaining their Sales Team source rows.
2. Receives the downloadable XLSX response and confirms both original rows are
   present. Every original source-field value is compared with the returned
   workbook, excluding the generated review annotation fields.
3. Resolves the invalid mobile cell's actual style/fill and verifies its red
   error color, plus the row status and returned validation explanation.
4. Edits the invalid value in the downloaded workbook and uploads that same
   reviewed workbook again. Both rows validate and stale error notes disappear.
5. Verifies preview/download/correction creates no customer business records.

The new scenario passed independently and in the focused **203-test / 8-file**
import run. API typecheck, targeted lint and environment isolation also pass.
The existing UI download control remains unchanged. Browser clicking/save/open
acceptance is **not run** in this checkpoint; HTTP and XLSX round-trip proof
must not be represented as browser acceptance.

The full API run passed **3,105 tests / 192 files** with `--maxWorkers=2` before
this additional regression was loaded. The initial unrestricted run had two
5-second workbook timeouts; the bounded rerun passed without raising timeouts or
changing product behavior. The latest focused run includes the extra regression.

No real workbook/customer data, credentials, Atlas schema or accounts were
changed. No deployment, push or commit.
