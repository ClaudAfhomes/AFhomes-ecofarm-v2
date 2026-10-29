# develop reference catalog and purchase verification

27 October follow-up: the historical Identity and dashboard blockers below are
resolved for the verified native core. See [current acceptance](IDENTITY-PURCHASE-ACCEPTANCE.md).
Full-platform cutover and imported workflows remain incomplete.

26 October 2026. Active workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`.

## Authorized reference configuration

The user requested configuration based on the current repository `develop`
branch. A fresh read-only fetch resolved it to
`f512c1416550feaf0c79a6bb204c51d08fa990f6`.

Reference terms were derived from `supabase/seed.ts` and these migrations at
that commit (not from hosted Supabase data):

- `20261014000001_afhomes_vip_payment_schemes.sql`
- `20261017000001_afhomes_card_plan_order.sql`
- `20261018000001_afhomes_official_vip_benefits.sql`
- `20261018000002_afhomes_flexible_commission_rules.sql`

| Plan | Cash | Installment total | Minimum down payment | Validity | Annual benefit points | Holders |
| --- | --- | --- | --- | --- | --- | --- |
| Gold | 312000.00 | 390000.00 | 20000.00 | 22 years | 25000 | 2 maximum |
| Silver | 192000.00 | 240000.00 | 15000.00 | 12 years | 20000 | 1 |
| Bronze | 54000.00 | 72000.00 | 10000.00 | 7 years | 10000 | 1 |

All totals include the 10000.00 reservation fee; it is not an additional charge.
The spot-cash window is seven days; standard installments are four months.
Move A is enabled for all tiers; B1/B2 are disabled for Bronze. Benefits include
the source discounts, validity extensions, loyalty totals and priority/no-dues flags.
The later flexible-commission migration sets plan commission to **0**. Separate
role/account rules remain authoritative; no invented commission rule was seeded.
Annual-benefit metadata does not create an automatic points-credit scheduler.

The explicit catalog operator inserted the missing membership category and all
three plans in `afhomes_dev`. Its subsequent read-only inspection confirmed
three active plans and `matchesReference: true` for every stored plan field.
It requires the existing owner and approved core marker, inserts missing rows
only, and audits additions in the same transaction. Existing custom/inactive
plans are preserved. An inactive membership category requires a separate
administrator decision instead of silently enabling it.

Commands:

```sh
pnpm mongodb:catalog --plan
# Apply is an explicit approved action, never called by pnpm dev:
pnpm mongodb:catalog --apply --approve-reference-catalog=afhomes_dev
```

No administrator, password, permission, customer, sale, payment, membership or
commission rule was created or changed by catalog setup. No Supabase data was
read or migrated; no environment file, Git commit/push or deployment was made.

## Current proof

- Native purchase/account/public-search suites: **16 passed**, three files,
  disposable loopback replicas only. Purchase proof exercises real HTTP,
  frozen terms, reservation, Finance, finalization, activation and customer
  lookup before/after activation, with denial, concurrency and rollback checks.
- New reference-catalog test: **1 passed**. Covers owner denial, audit rollback,
  exact source terms, idempotent replay and preservation of existing custom
  pricing, inactive plans, identity and unrelated business collections.
- API TypeScript: PASS.
- Disposable browser login through the correct Administration portal: PASS.
- Application wizard renders and accepts a synthetic customer selection.

## Confirmed browser blockers

**Full browser acceptance is BLOCKED, not complete.** At the Identity step, the
wizard cannot load the current ID and cannot proceed without a valid ID upload.
`/documents` is not mounted in the native runtime; its upload grants, binary
transfer, completion/digest checks, ownership-scoped reads and human review still
need conversion to the private object store. Do not bypass the UI's ID gate or
replace persisted file checks with a client-supplied boolean.

The dashboard also displays a load error: its current UI requests analytics
overview, while the native runtime currently serves only the older dashboard
endpoint. Preserve the current role/scope contracts when implementing analytics;
do not substitute unscoped global totals.

The browser's disposable catalog uses intentionally synthetic prices. Those are
separate from the approved real reference catalog installed above. Real Atlas
business mutations were not used as automated QA. The user's existing localhost
session was not stopped or replaced.
