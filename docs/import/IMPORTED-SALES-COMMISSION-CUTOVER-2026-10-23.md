# Imported sales visibility and commission cutover

Implemented locally on `claud/clean-develop`. No shared migration, import, commit, push or deployment was performed.

## Behavior

IST My Sales/Team Sales and OST My Sales now have an **Imported customer records** section. It includes applications, reservations and finalized purchases, with VIP/purchase reference, customer number, permitted customer name, VIP tier, current workflow/membership status, recorded involvement and contract total. Missing totals remain unknown rather than becoming zero.

Personal visibility uses the recorded referrer/recommender identities. Team visibility requires both recorded IST participation and current downline authorization. Moving a seller under a new leader does not invent historical participation for that leader. The projection uses the original committed source and deduplicates repeated imports. The section has its own 25-row pagination and polling, and does not count incomplete applications or settled history as new normal sales in existing KPIs. IST reporting dates filter these records by import creation date.

| Original accepted import | Commission treatment |
| --- | --- |
| Active VIP or Fully Paid | Settled before the system; no new commission entry |
| Fully settled Expired, Suspended, Cancelled or Inactive history | Settled before the system; no new commission entry |
| Pending, Reservation Paid, Down Payment or Partially Paid | Existing configured commission rules and normal qualification workflow |

The decision is stored once per canonical purchase source and is immutable. Later payment or activation cannot turn an originally unpaid purchase into excluded pre-system history. For newly accepted unpaid imports, frozen terms use the configured seller rule and imported commercial total. Paying the remaining balance creates a `payment_verified` commission through the existing finalizer; earning and payment still require their normal separate decisions. No new entitlement or commission distribution to uplines/recommenders was invented.

Any older commission entries for settled imported history are retained for Finance/Admin audit with their original amount/status. They are excluded from salesperson lists/totals, cannot be re-qualified/repaid, and cannot have the settled flag cleared. Existing frozen purchase rates and amounts are not retroactively rewritten; previously accepted unpaid imports with zero frozen rates need explicit Finance review rather than automatic repricing.

Migration: `supabase/migrations/20261223000004_afhomes_import_sales_commission_cutover.sql`. The schema index was regenerated from repository migrations; this is not evidence of a live apply.

## Local evidence

- Ten-customer workbook test: parser and validators, canonical preview/commit functions, full payment/finalization, identifiers, geographic persistence, points and RLS passed on disposable PostgreSQL.
- Actual API handlers were exercised against that database through the existing loopback HTTP harness with Auth/PostgREST doubles. Both registered OSTs saw all ten records; recorded VD/SSM/SM accounts saw their attributed team records. An unpaid Bronze purchase produced the configured **2,880.00** commission after the remaining **42,000.00** was verified. Both the OST personal commissions endpoint and SM team endpoint returned it.
- Six settled purchases created no commission entries. A simulated older zero-value entry retained its amount/status after migration re-application, became hidden from salesperson views, and could not have its settlement marker cleared.
- Unrelated/new-leader access, OST team access, missing customer-name permission, invalid dates, pagination and browser-role RPC grants were checked. No genealogy inference or qualification bypass was used.
- Targeted API regression group: **239 passed**; financial/API guard rerun: **77 passed**. Admin UI: **16 passed**. Web UI: **16 passed**. New shared contract tests: **2 passed**.
- Existing 30-case external-import matrix and dated points/allowance/concurrency/refund tests passed.
- All seven workspace type checks and both SPA builds passed. Targeted Admin/Web ESLint checks passed. API/contracts have no configured ESLint command; their type checks and tests were used. Build chunk-size warnings remain.
- Full `test:db:local`: **1,452 passed, 4 failed**. The failures match the independently reproduced baseline recorded in `VERIFICATION-STABILIZATION-2026-10-23.md`: two purchase-review reason expectation mismatches, frozen purchase-term cleanup, and an obsolete manually-created reservation fixture after automatic reservation creation. This is not a full-suite pass.

Evidence logs are under `.tmp-bin/import-sales-*` and `.tmp-bin/ten-customers/commission-db.log`. Re-run the focused workbook check with:

```powershell
corepack pnpm --filter @afhomes/db-testing run test:db:customer-workbook
```

## Unverified

Authenticated browser E2E and managed Supabase Auth/PostgREST behavior remain unverified. The localhost app configuration still targets shared Supabase; it was not used for mutations. The disposable database is stopped and removed, so these sample accounts/records will not appear in the shared app. Release remains pending the separate migration/deployment authorization and broader baseline stabilization.
