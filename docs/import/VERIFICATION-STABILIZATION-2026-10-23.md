# Customer import verification and stabilization — 2026-10-23

Status: **NOT RELEASE READY**. Work remains local on `claud/clean-develop`.
No shared migration, live import, commit, push, or deployment was performed.

## Corrections

- Customer Lookup now uses `maskedLastName` throughout its mapper, shared contract, and UI. The mask retains one Unicode grapheme and a fixed `***`; the response does not contain `lastName`. This is an authenticated staff endpoint, not a public search endpoint. Existing staff-only points fields remain available.
- Finance rejects scientific notation and letters without silently converting the amount to a different number. Exact-decimal server validation remains intact.
- Finance queue searches match customer/product display names before pagination. The invalid root PostgREST OR across embedded relations was removed. Search exhausts the authorized status population in existing 500-row pages; unfiltered queues retain bounded reads. This correctness fix increases reads for searches over large queues.
- UI fixtures now open the purchase-details dialog before exercising receipts, await OST account loading, and use current address labels, route coverage, list fields, and genealogy service exports.
- Database funding fixtures write the ledger and account balance atomically. Active redemption preparation fixtures provide an actual service date. `STAY_SERVICE_DATES_REQUIRED` remains enforced.
- Retired catalog spending is checked for refusal. Historical success cases 27–36 are explicitly inapplicable with the new date policy; they are not counted as passing. Current settlement/refund/concurrency coverage runs in `test:db:external-import`.
- Directory permission probes use savepoints so an aborted transaction cannot hide the original error. Their local platform SELECT fixture includes the reservation and application tables now read by the directory.
- The historical-import assertion now checks that no sale-time genealogy is invented from current relationships. The seller remains attributed from supplied evidence.

## Independently reproduced baseline failures

The original disposable DB run without the four pending migrations produced **1,609 checks: 1,605 passed, four failed**. Evidence: `.tmp-bin/import-repair-baseline-db.log`.

1. Historical-import hierarchy assertion expected a snapshot, although the existing import migrations deliberately exempt `legacy_import` from capture. Corrected in the fixture; no historical hierarchy was reconstructed.
2. Missing review reason returns a purchase-terms CHECK violation instead of `REVIEW_REASON_REQUIRED`.
3. Too-short review reason returns the same CHECK violation instead of `REVIEW_REASON_REQUIRED`.
4. Purchase-terms fixture cleanup attempts to clear a terms pointer after approval has automatically created a reservation, producing `PURCHASE_TERMS_VERSION_FROZEN`.

After correcting the hierarchy assertion and allowing the runner to report the purchase-terms failure without silently abandoning the next section, both current and baseline runs expose the next stale workflow fixture: section 59 manually creates a reservation after approval already created one (`RESERVATION_ALREADY_EXISTS`).

Fresh comparison, identical failing checks:

| Disposable migration set | Passed | Failed | Evidence |
| --- | ---: | ---: | --- |
| Current, all pending migrations | 1,447 | 4 | `.tmp-bin/stabilize-full-db.log` |
| Existing migrations, four pending files excluded | 1,606 | 4 | `.tmp-bin/stabilize-baseline-db.log` |

These failures remain explicit; later DB sections are **NOT RUN** after the section-59 abort. The active section-72 date fixtures were updated but are not claimed as executed by the broad suite. The focused dated-points integration suite executes the current policy separately.

The remaining application UI failures were independently reproduced against an isolated `git archive` export of read-only reference commit `77d7436b112c92ef0971a50702efbbea2729ab79`, with dependencies linked to that export's own workspace packages:

- `application-actions.spec.tsx`: 16 failures. Tests still expect removed export/action controls, editable fields on non-draft records, and workflow navigation buttons that the current progress panel does not render.
- `final-blockers.spec.tsx`: three failures. Tests expect a Submit control on intermediate new-application steps; the wizard renders Next until the final step.
- Reference comparison: **18 passed, 19 failed**. Evidence: `.tmp-bin/stabilize-reference/baseline-ui-results.json` and `baseline-ui.log`.

The reference commit and checkout were not edited. These baseline failures do not establish release acceptance and must not be hidden by loosening business rules.

## Localhost browser boundary

The running API on port 3000 and SPAs on ports 5173/5174 belong to this checkout. Its `.env.local` directs frontend and server to the shared production Supabase project. Browser inspection reached `http://localhost:5174/admin/login`.

Authenticated mutation E2E for import, activation, redemption, and refund is **NOT VERIFIED**: executing it on this localhost would write shared data, which this task explicitly excludes. No passwords, session tokens, or environment secrets were copied into this report. A disposable managed Supabase stack, or separately authorized shared test data, is required for that acceptance gate.

## Verification evidence

- Final complete API suite: **2,685 passed** (`.tmp-bin/stabilize-api-final-serial.log`). Run with one worker and a 15-second test timeout. A previous concurrent build/test run timed out one workbook test at the default five seconds; no assertion was removed or changed for that rerun.
- Complete web/customer/OST suite: 260 passed (`.tmp-bin/stabilize-web-full.log`).
- Contracts: 311 passed; shared: 49 passed; shared UI: 230 passed in the complete workspace run (`.tmp-bin/stabilize-all-tests.log`).
- Focused Finance and Lookup UI: 59 passed. Updated receipt and genealogy checks: 23 passed. Address checks passed in the 43-pass focused run.
- Disposable import and dated-points suite: PASS, including the status/tier matrix, generated/supplied identifiers, reimport after spending, mixed nights, allowance exhaustion, concurrent approval, settlement, refund, and retries (`.tmp-bin/stabilize-dated-db.log`).
- Workspace typecheck and Supabase script typecheck: PASS. Lint: zero errors, existing warnings remain.
- Final complete Admin run: **953 passed, 21 failed** (`.tmp-bin/stabilize-admin-final.json`). Nineteen failures match the independently reproduced reference failures above. Two additional loading failures in `role-access-review.spec.tsx` and `OfficialFormsPages.spec.tsx` did not reproduce in the serial rerun: all 47 tests in those files passed (`.tmp-bin/stabilize-loading-rerun.log`). This does not turn the failed full run into a pass.
- Final build: both SPAs PASS (`.tmp-bin/stabilize-build.log`). Final workspace typecheck: all seven workspaces PASS (`.tmp-bin/stabilize-typecheck-final.log`).

Final broad rerun results are recorded in `IMPLEMENTATION_REPORT.md`. A passing build, fake-auth handler test, or disposable PostgreSQL check is not authenticated browser acceptance.
