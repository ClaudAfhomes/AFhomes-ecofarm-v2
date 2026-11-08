# Customer Application RA draft review ? 8 November 2026

Status: implemented locally on `claud/supabase`; the single RA migration was explicitly approved and APPLIED to `ikaevepedpqygdlipsei` on 8 November 2026. No commit, push or deployment.

## Authorized product behavior

User chose **Save an RA draft with the application**. Application Review and Reservation Agreement Review remain separate sections of the existing seventh step. Seven step URLs and application validation remain intact.

- OST Referrer AA number and OST VIP recommender AA number offer native keyboard-accessible AAO suggestions from active OST members in the caller's existing authorized genealogy. Choosing a suggestion still invokes the existing exact AA resolver; authoritative same-team validation is preserved.
- The RA review collects reservation/agreement/payment dates, proposed reservation/revision numbers, payment method/reference, reported (unverified) received amount, and editable payment-summary fields.
- Initial proposed economics come from selected plan/scheme using existing exact-decimal helpers. Reservation fee is included in the initial amount, not added to total price. Inexact monthly division is left blank for review. Changing scheme resets proposed economics; resetting payment terms preserves document dates/reference details. Individual edited figures are proposals and do not recalculate other edited figures automatically.
- Print RA and RA downloads share the same A4 document renderer and use these actual entries. Printing does not submit or save the application. Verified payments, official reservation issuance, approvals and Finance economics are unchanged. Missing fields/signatures stay blank. RA document data is never passed to purchase-terms or payment calculations.
- Saved drafts restore their entered values, including intentionally blank fields. Older API clients which omit `raDraft` preserve it in the database. Existing application draft-only edit rules still apply.

## Persistence and approval boundary

Exact migration: `supabase/migrations/20261229000001_afhomes_application_ra_draft.sql`

SHA-256: `f604b4bec858c5a5288d980b55e17786a23932261b3043e8399e3c50fe661214`

Verified and applied project: `ikaevepedpqygdlipsei`. Exact file hash and the live predecessor function were checked before the approved apply.

Scope: add nullable bounded JSON object `customer_applications.ra_draft`; replace the immediately preceding `save_customer_application` body with the same body plus transactional draft persistence; preserve service-role-only execution; notify PostgREST to reload schema. No backfill, seed, administrator/Auth change, payment/reservation workflow modification, other migration, push or deployment.

API checks storage capability before application writes and returns `RA_DRAFT_STORAGE_UNAVAILABLE` when migration is absent. After the approved apply, the service API capability check `select(ra_draft).limit(0)` succeeds. RA draft storage is now available to application submissions. Browser session draft remains available; do not clear it.

Project `AGENTS.md` requires explicit authorization for remote migrations. The user separately approved this RA migration in the message requesting Print RA. Prefix approval was not reused.

## Verification

- Focused frontend tests: ApplicationRaReview, OfficialFormsPages, official-forms-fields, ApplicationReview, ApplicationReview.print, reservation-print passed (latest relevant runs: 88 tests across editor/AA/review, then 50 across final editor/review/RA/document changes).
- API official-forms transitions and team-match: 58 passed, including missing RA storage refusal before writes.
- Admin TypeScript and Vite production build: passed. API and contracts typechecks: passed.
- Affected frontend ESLint: zero errors, 19 Fast Refresh export warnings. Existing Vite large-chunk warning remains.
- `node packages/db-testing/scripts/test-application-prefix.mjs`: 152 migrations replayed on disposable loopback PostgreSQL; RA create/read/update, legacy-client preservation, object constraint, no payments created, Prefix roundtrip, idempotent replay, service-only function ACL and RLS invariants passed.
- Isolated real React browser fixture at 1440 and 390 pixels: separate reviews, scheme suggestions, editable dates/terms, session draft retention, actual PDF download, no horizontal overflow or page errors. Screenshots inspected, including mobile RA form. Synthetic fixtures only; no submission and no production data.
- Authenticated live application submission and a customer-data RA roundtrip: NOT VERIFIED; no remote business test records were inserted. Shared RA storage capability is verified. Turnstile unchanged.

Evidence (ignored local artifacts): `.tmp-bin/ra-final-tests.log`, `ra-integration2.log`, `ra-api.log`, `ra-build2.log`, `ra-api-type.log`, `ra-contract-type.log`, `ra-lint.log`, `ra-db3.log`, `ra-visual.log`, `v4-comparison/ra-review-1440.png`, `v4-comparison/ra-review-390.png`, `ra-review-1440.pdf`, `ra-review-390.pdf`.

## Files changed for this addition

`official-forms-fields.tsx` and tests; new `ApplicationRaReview.tsx` and tests; `official-forms-applications.tsx`; `ApplicationReview.tsx` and print tests; `reservation-print.ts` and tests; contracts `official-forms.ts` and index exports; API `official-forms.ts` and transitions tests; editor test fixture; disposable PostgreSQL proof; migration above. All earlier shared changes preserved.

## Approved live application and Print RA verification

- Applied ONLY `20261229000001`; history 130 -> 131. Hash matches the exact file listed above.
- Migration and history insertion committed atomically with verified TLS and the expected project guard.
- Live save function exactly matches the approved migration; nullable `ra_draft jsonb`, validated JSON-object/16,000-byte constraint, service-only execution, table ACL/RLS and function settings verified.
- All business/Auth row counts unchanged. The same two pre-existing platform cron RLS audit findings remain; no unrelated policies changed.
- Read-only Supabase service capability probe confirms `ra_draft` is available (no error).
- Print RA action uses actual draft details, stays enabled for valid incomplete documents, reports preparation failures, and does not submit or mutate document values. Application printing retains its default title; RA printing uses `AFhomes Reservation Agreement`.
- Latest focused print/editor/document tests: 54 passed across five files. Admin TypeScript/Vite build passed. Affected lint: zero errors, two Fast Refresh warnings; large-bundle build warning unchanged.
- Synthetic browser checks passed at 1440 and 390 pixels: actual RA action prepared A4 pages and invoked the browser print API, with the correct document title. PDF download still passed. No submission or page errors. A physical printer and live authenticated submission were not tested.
- Metadata-only live evidence: `.tmp-bin/ra-draft-live-before.json`, `.tmp-bin/ra-draft-live-after.json`; test logs: `.tmp-bin/ra-print-tests.log`, `ra-print-build.log`, `ra-print-lint.log`, `ra-print-visual.log`.
