# Customer import v3 release

User-approved scope: finish the customer import simplification, official Customer ID generator and staff involvement history; apply only migrations 17 and 18 to the existing shared database; commit and normally push to `origin/claud/develop` for Preview. Preserve coworker checkouts. No production website promotion, historical record rewrite or live test data creation.

The official annual generator works before imports, preserves supplied company IDs and advances after higher numbers, including case-insensitive historical IDs. Internal references remain separate. Customer detail shows the official ID and internal reference separately. The mapping-3 workbook removes six repeated genealogy columns, retains both registered OST selectors, makes payment claim references optional, restricts supplementary holders to Gold, uses single date fields with calculated age, and provides dependent geography selections. Older mappings remain readable. Preview resolves authoritative staff and addresses rather than trusting cached formulas. Name-only ambiguous history is not automatically assigned.

General sales involvement is shown on member detail and staff profile for viewers holding both staff and customer access. It projects recorded application IDs, the original canonical imported source and frozen sale hierarchy; a repeated import does not create a second purchase entry. Referrer and VIP Recommender upperlines stay separate. Claimed payments and document-status labels do not authorize verified-money or membership transitions.

Verification before release:

- 360 API tests across 11 focused files; 23 UI tests across four customer/member files passed.
- Real disposable PostgreSQL continuation suite passed, including annual issuance before import, higher imported IDs, lowercase IDs, concurrent creation, rollback, deletion high-water preservation, identity conflicts, separate OST uplines, history projection and private ACLs.
- Workspace typechecks, admin build, public build/prerender, scoped ESLint and diff checks passed. Vite reported existing large-chunk advisory warnings.
- Actual version-3 blank and 81-customer/70-payment example workbooks were regenerated and parsed; all supplied synthetic company IDs were retained and all examples had zero preview validation errors. Example files include real registered staff choices and remain local deliverables, outside the Git commit. The committed blank template has no customer or registered staff data.
- Shared migrations 17 and 18 committed at `2026-10-19T13:59:12.524Z`; an independent read-only postcheck passed. All 116 existing table counts and protected row digests were unchanged. Exact hashes and ACL evidence are in MIGRATION-APPLICATIONS.md. Older missing history versions remain untouched.

At preparation: Preview commit/deployment verification is pending. Native Excel Desktop/Online interaction and authenticated new-host workflow acceptance are not yet proven. No live customer/import/receipt was created for testing. The unknown complete company numbering range means a later historical import may correctly flag an ID collision with a test application; never renumber or discard historical records to resolve it automatically.

## Release verification

Feature commit `e65b228e2940e709e0f563b4bb76e135ce5634ab` was normally pushed to `origin/claud/develop`. Vercel Preview `dpl_3wUpM4BUFkpubqgMP4nR6LzJMaPG` reached READY for that exact SHA, with the existing branch alias assigned. No production website promotion occurred.

The signed-in branch Preview loaded the member directory, OST detail and customer import/export screen. The deployed Sales involvement section returned its successful empty-history state without an API error. Populated history remains proved by synthetic PostgreSQL/component tests; no live import or sale was created. Browser logs contained existing SVG image-load errors, including before the new deployment; no sales-history request failure was observed.

The hosted template download was attempted, but the browser download observer timed out without an on-page error. Browser policy blocked checking Chrome's download-history page; no workaround was attempted. The hosted saved file, native Excel Desktop/Online interaction and complete authenticated import/Finance workflow remain unverified.

Final scoped lint covered 16 touched production files with zero errors/warnings after removing two preexisting unused imports and two obsolete suppressions. A follow-up corrects the download description to match the current workbook; its 10 UI tests and scoped lint passed. This cleanup changes no SQL or business behavior and requires no further migration. The follow-up commit is intended for the same Preview branch.
