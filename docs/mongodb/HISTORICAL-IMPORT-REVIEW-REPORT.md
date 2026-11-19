# Native historical import review — 28 October 2026

Later checkpoint: native certified transactions now have disposable HTTP/database
proof; Atlas enablement still needs separately approved schema. See
`HISTORICAL-IMPORT-TRANSACTION-REPORT.md`. The review-only status below records the
earlier checkpoint.

Workspace: `AFhomes-ecofarm-v2`, branch `claud/mongodb-conversion`.
Status: native upload/review implemented; historical confirmation is NOT enabled.

## Change

Guided workbooks can now be parsed with an explicit historical-certification
reason. The handler reuses the source parser and requires customer creation,
card-sale creation and Finance verification permissions, both before parsing and
again inside the atomic review-evidence write. It does not accept invitations,
invent consent/signatures, verify money or create customer accounts.

The native continuation read model now checks certified history against the
same source rules in `20261223000001_afhomes_customer_historical_import.sql`:

- Recompute exact totals, payment stage and the existing 70/30 points split;
  reject changed cached summaries or missing certification reasons.
- Keep customer identity conflicts; detect another customer's VIP number without
  exposing that person's details. Preserve an existing customer's VIP number.
- Require historical activation/valid-until dates when no membership exists.
  Detect differing opening-points baselines and ambiguous multiple memberships.
- Require explicit reconciliation of an existing application and compare an
  existing reservation's frozen date, amount, fee, tier, scheme and seller.
  Reject lifecycle reversals rather than rewriting executed/finalized history.
- After an accepted historical receipt, show current verified-only financial
  totals without changing the accepted statement, original receipt or payments.
- Include historical baselines and receipts in stale-review tokens.

Ordinary prospect import and claim reconciliation retain their existing paths.
Confirmation/source writes for certified history still return 501. The legacy
flat/business import write guard also remains. Preparing review evidence does not
make either transaction implementation complete.

## Verification

- 57 focused tests passed across native historical review, native HTTP import
  continuation/upload, ordinary import commit, native claim reconciliation and
  shared historical calculations.
- The HTTP test uploads and reloads a certified guided workbook, checks each
  additional permission denial, confirms the 501 write gate and asserts that no
  customer or payment was created.
- Disposable replica tests cover all six source lifecycle stages, VIP privacy,
  missing membership dates, points-baseline conflicts, frozen terms conflicts,
  tampered summaries, verified-only totals and review-token invalidation.
- API TypeScript, targeted ESLint and environment isolation passed.

All database tests used new disposable loopback replicas. No Atlas collections,
indexes, accounts or financial records were changed in this work. No source data
was migrated, no credentials were printed, and nothing was committed, pushed or
deployed. Browser acceptance was not run for this backend checkpoint.

## Remaining work

Port certified confirmation as a single native transaction: immutable commission
cutover policy, application/reservation snapshots, duplicate-safe historical
payments or an explicit settlement certification, finalization provenance, actual
membership dates and replay-safe opening points. Prove concurrency, audit failure
rollback and original-record preservation before removing the write guards.
Prepare any additional shared database schema as an exact reviewed apply plan.
Legacy import writes, one-time migration transformation/recovery and full browser
acceptance remain separate unfinished items. CMS stays last.
