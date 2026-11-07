# Legacy member import updates — 29 October 2026

Flat CSV/standard-column Excel imports can now update existing members through
the native confirmation handler. New legacy financial/member creation remains
blocked; certified guided historical creation is a separate, existing workflow.

## Source behavior preserved

The update branch of `20261204000001_afhomes_customer_ssot_alignment.sql`
(`commit_customer_import_row`, subsequently retained as the private legacy
dispatcher) is the reference. The later removal of `ost_ist_name` remains intact.

- Match customer/member identity again inside the guarded row transaction.
  A changed match, missing sale/plan, contradictory tier or ambiguous membership
  fails the row; an import cannot create membership for an existing customer.
- Active members may remain active or become suspended, expired or cancelled.
  Inactive members may keep their status; import cannot reactivate them or move
  them to another inactive state.
- Suspension/cancellation also changes the customer status. Expiry preserves
  the customer status, matching the source behavior.
- Blank metadata/address parts preserve existing values. Existing identity and
  email remain protected by the shared parser and fresh identity comparison.
- Original activation/expiry dates, identifiers, sale economics, verified money,
  points accounts and ledger remain intact. Supplied opening balance/expiry
  values do not rewrite existing membership history.
- A legacy-origin sale receives the committed import row provenance, as in the
  source. An ordinary sale is untouched.
- Governance import view/update permissions are required. Organization/sales
  guards, row/customer/member changes and the import-row audit share the existing
  transaction. Replay returns the original customer/member IDs.

## Fresh verification

`pnpm --filter api exec vitest run _lib/import-commit.mongo.spec.ts
_lib/import-continuation.mongo.spec.ts _lib/import-claims.mongo.spec.ts
_lib/historical-import.mongo.spec.ts _lib/historical-import-review.mongo.spec.ts
_lib/customer-import.spec.ts _handlers/customer-imports.spec.ts`

**7 files / 184 tests passed.** This combines native disposable MongoDB/HTTP,
shared parser and retained source handler tests; these are not all native tests.

Four new native HTTP scenarios cover concurrent suspension/replay, expiry and
cancellation, forbidden reactivation/inactive transitions, stale ownership/tier,
audit-failure rollback, denied access and preservation of points/dates/ordinary
sale history. The initial suspension test reproduced the prior 501 block before
the implementation was added.

API typecheck, targeted ESLint and environment isolation are recorded with the
completion checkpoint. No shared database, schema, credentials, accounts or
environment configuration changed. No commit, push or deployment.

## Remaining proof and work

Legacy CREATE rows containing financial/member history remain 501 and direct
users to the guided workbook. Browser import acceptance, migration compatibility
and backup/restore remain unfinished. This checkpoint is not full-system parity
or production readiness. Keep CMS last.
