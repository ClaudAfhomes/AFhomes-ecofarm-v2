# Unified customer sales reporting

Implemented locally on `claud/clean-develop` (2026-10-24).

- Total Sales includes finalized canonical card sales. Pending applications, reservations and incomplete Finance purchases stay in their existing workflows.
- Qualifying Sales counts active sales/memberships. Imported expired, suspended and cancelled memberships remain visible in finalized sales history but never qualify.
- Committed imports feed the ordinary OST and IST sales lists, dashboards, performance and authorized team activity. Team totals deduplicate by canonical sale ID. Both recorded OST referrer/recommender can see their involved purchases.
- Imported purchase attribution uses the original committed roster and current authorized account scope, never an inferred current genealogy history. Unrelated and moved teams retain no extra access.
- Settled historical imports create no new commissions; old settlement-marked entries remain excluded. Unpaid imports continue through normal qualification.
- Team Sales Activity moved from Genealogy Details to Team Sales for VD, SSM and SM, preserving the original panel layout and its independent Today / Past 7 Days / Past 28 Days / Past 6 Months presets, optional Start/End Date filters, KPI labels, role/activity badges and reporting footer. The separate imported customer panels were removed.

## Verification

- Complete API: 2705 passed (138 files, maxWorkers=2); contracts: 313 passed. Release-focused Admin UI: 30 passed; Web UI: 9 passed. Legacy analytics fixtures register the new RPC; production still fails closed if the migration is unavailable.
- Seven workspace typechecks, both app builds and lint passed (existing lint warnings).
- Ten-customer real PostgreSQL/parser/import/API suite passed, including 6 initial finalized sales / 2 qualifying; after finalizing one unpaid purchase, 7 finalized / 2 qualifying. All three leader activity scopes and both recorded OST scopes passed. Browser-role RPC execute denied; RLS audit empty.
- Authenticated localhost browser: OST My Sales and VD/SSM/SM Team Sales show 6 / 2; no separate import panel. SM Team Sales Activity shows its authorized OST with two qualifying sales; SSM sees both recorded OST participants with two each, while team totals remain deduplicated. Genealogy Details retains network details without the activity section.
- Complete disposable DB suite: 1453 passed, 4 existing purchase/reservation failures (two review reason expectations, PURCHASE_TERMS_VERSION_FROZEN cleanup, RESERVATION_ALREADY_EXISTS fixture). Overall suite is not green.

## Release boundary

User approved the shared migration apply and commit/push on 2026-10-24. `20261224000001_afhomes_unified_sales_reporting.sql` was applied to shared Supabase alongside consolidated settings migration `20261225000001`; history increased exactly 125 -> 127. Existing customer/points/commission fingerprints remained unchanged. All three reporting/settings RPCs remain service-only. The schema index is a repository manifest, not a full live schema dump. Hosted authenticated browser acceptance remains unverified.

## Activity panel correction

Restored the original genealogy panel markup and CSS in Team Sales, including independent preset/custom dates and unchanged KPI/table labels. All 24 affected UI tests passed; Admin typecheck and scoped lint passed. Authenticated browser confirmed Past 7 / Past 28 presets, custom range changing activity from 2 to 0 and back, and invalid range feedback. The parent sales history retained its own reporting filter. No API, SQL or authorization changes in this correction.
