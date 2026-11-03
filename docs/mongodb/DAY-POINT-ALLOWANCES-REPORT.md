# Weekday and weekend points

28 October 2026. `AFhomes-ecofarm-v2`, local `claud/mongodb-conversion`.

## System-wide correction

The first native manual adjustment handler maintained the total but omitted the
PostgreSQL allowance trigger from
`20261223000002_afhomes_stay_date_point_allowances.sql`. Customer Lookup correctly
reads persisted day balances, so it showed zero day allowances beside a positive
total. This was a persistence defect, not a reason to split the remaining total
in the browser: previously spent day balances must remain intact.

Every native manual adjustment now records signed weekday/weekend ledger deltas
and updates both account balances in the same transaction as total, membership
balance and audit. It reuses the shared whole-point 70/30 rounding policy. Existing
asymmetric day balances are preserved; unknown discrepancies fail for review.
New activation initializes both balances to zero. Annual reset maintains the
same allowance invariant, including reversal debt, instead of leaving stale
buckets. Services and Redemption remain disabled.

The Record Points dialog previews the added points using the same rounding helper
and labels them as additions. A successful recording invalidates Customer Lookup
and membership caches so reopening them requests current balances.

## Existing records

Following the user's direction to fix the system, all two existing points
accounts were reviewed. One account had one unattributed manual adjustment.
Operator-only reconciliation filled the missing day deltas and balances with an
atomic `POINT_ALLOWANCES_REPAIRED` audit. It requires the existing active bootstrap
owner and Super Admin role, preserves amounts/dates and total/debt, is replay-safe,
and refuses partial attribution or unexplained history. It is not mounted in API
requests or startup.

Apply exited 0: one account/entry repaired. Post-apply reads confirmed all accounts
reconcile, all total/debt values are unchanged, and original ledger amounts,
before/after totals and creation dates are unchanged. The reported customer's
directory/lookup mapper now returns positive weekday and weekend points whose
sum matches that customer's total. No payment or authentication writes occurred.

## Verification

- 26 focused API tests passed: native adjustment and lookup flow, concurrent
  updates, negative correction, permission/input denials, audit rollback,
  signed rounding, preservation of spent buckets, annual reset, activation and
  reconciliation authorization/rollback/replay.
- Eight shared rounding tests and one Record Points UI/cache test passed.
- API/admin TypeScript, targeted admin ESLint and environment isolation passed.
- Browser interaction and production deployment were not performed. Refresh an
  already-open Customer Lookup page to discard cached pre-repair values.
