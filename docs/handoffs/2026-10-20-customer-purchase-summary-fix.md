# Customer purchase summaries: local fix awaiting release approval

## Verified causes and changes

- `customer_directory` read only finalized card sales. Open reservations therefore appeared to have no plan or payments. The forward summary migration aggregates verified sale payments and submitted/executed, unfinalized reservation payments. It uses the canonical application plan when no purchase exists, without counting an application quote as committed debt.
- The customer Overview settlement strip read only sales and displayed an empty debt message even for an open reservation or a failed request. It now includes the separate reservation totals, excludes cancelled sales, and shows loading/error states accurately. The directory distinguishes no payment, partial payment, and fully paid.
- The installed directory also lacks its company Customer ID search branch. The summary migration restores that branch while preserving existing identifier aliases, filters and pagination.
- The later application mirror reformats/truncates supplementary facts during externally verified import, making an unchanged Gold workbook conflict on reimport. A separate forward guard preserves the facts during that import transaction. Ordinary application mirroring remains enabled.

No business rows, genealogy, IDs, consent, signatures, membership status, or payment ledger entries are rewritten by these migrations. The two new response fields contain only exact-decimal reservation aggregates. No new endpoint or client-side authority is introduced.

## Prepared migration scope

1. `20261208000020_afhomes_customer_purchase_summary.sql` — only the installed public directory read function and its existing service-only ACL.
2. `20261210000006_afhomes_preserve_imported_holder_facts.sql` — only the installed private mirror function and its restricted execute ACL.

Fresh read-only inspection of shared project `ikaevepedpqygdlipsei` found 113 history entries through version 19 and confirmed both target functions and the required patch anchors. Recorded history does not fully describe installed objects: the private mirror exists despite the later files not being recorded. Do not replay the intervening historical/backfill migrations. Recheck function hashes and exact file hashes before any approved apply; stop if they drift. Ignored evidence: `.tmp-bin/customer-summary-preflight.json`.

## Verification

- Before the patch, three focused UI regressions failed and the real PostgreSQL test reproduced a missing application/reservation tier.
- After the patch: 55 UI tests and 56 API tests passed; admin/API typechecks and the admin build passed. Changed UI lint reported no errors.
- Full ordered migration chain: all 15 Gold/Silver/Bronze import scenarios passed, including repeated import, Gold supplementary facts, ordinary purchase finalization, protected evidence, and permission gates.
- Released-schema profile: applies the summary migration to existing synthetic records, compares protected business-table counts and digests, and exercises the installed directory variant without RA lookup. All 15 scenarios passed, including identifier search, tier/payment filters before pagination, unverified payment exclusion, and no double-counting after finalization.
- Repeatable database commands: `node --import tsx packages/db-testing/scripts/test-external-customer-import.mjs` and the same command with `--released-schema`. Both own only a disposable loopback PostgreSQL instance; run sequentially because they share the test port/data directory.

## Remaining release work

Obtain explicit scoped approval before staging/commit/push, either live migration, or deployment. Proposed Git target: `claud/develop` Preview only. After the approved release, recheck the existing imported test records in Customer directory/Overview and the unchanged Finance, Reservation and Activation queues. Do not reimport, activate memberships, or record additional payments merely to verify this display fix.

Live application and deployed browser verification of this patch: NOT RUN.
