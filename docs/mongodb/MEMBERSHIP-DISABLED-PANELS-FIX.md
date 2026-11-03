# Membership page feature-flag repair - 30 October 2026

The reported membership page displayed two conversion-guard failures:
`Service transactions could not be loaded` and
`Card history is unavailable right now`. Its service transactions query used
`/reports/redemptions`, and history used `/reports/audit`. Both are deliberately
disabled by the current shared feature flags, but these embedded panels checked
only role permissions. The page therefore requested features that the server
correctly refused, including repeated transaction-report reads.

## Change

`MembershipActivity` now requires the shared path flag as well as the existing
redemption permission before rendering or querying transaction reports.
`MembershipDetailPage` does the same for audit history. Disabled source remains
intact. Reports, Services and Redemption stay off; no API allowlist, feature flag,
role grant or database was changed. Active points, payments, printing and
credential controls retain their existing permission checks.

The touched loading states also used a block Skeleton inside a paragraph, which
React reported as invalid HTML. Their status wrappers are now div elements;
status semantics and loading text are retained.

## Verification

- The two new disabled-panel regressions failed before implementation.
- All membership/feature-flag tests passed: **40 tests / 5 files**. Retained
  history is tested with an explicit test-only feature opt-in; the permission
  denial case still runs with that feature enabled to avoid a false pass.
- Admin typecheck, actual scoped ESLint, environment isolation and changed-file
  whitespace checks passed.
- Native Chrome verification on the isolated QA membership page confirmed that
  Transactions and History are absent, Points loads its authoritative account
  and ledger, and printable-card/record-print controls remain visible.
- The active Payments panel exposed an independent old-fixture problem described
  below. This checkpoint is not a full membership or platform acceptance claim.

## Independent synthetic payment fixture correction

The browser fixture's original `SYNTHETIC-PAYMENT` lacked `payment_type` and
`recorded_by`, so the native API returned HTTP data that the payment contract
correctly rejected. The fixture now supplies full payment type, recording and
verification actors, and verification time. Production response validation was
not weakened and the business handler was not changed.

A regression reads that seeded payment through the native HTTP sales endpoint
and validates its complete payment contract. It failed against the old fixture;
all **11 native sales tests** pass after correction. API typecheck and actual
scoped ESLint also pass. The complete serial API suite then passed **3,134 tests
across 198 files**, exit 0 (600.66 seconds). The full root/frontend build was not
repeated for this patch; the fresh 40-test membership/UI run and Admin typecheck
cover the changed frontend, with native browser checks described above.

The already-running browser fixture was seeded before this correction; its old
row was not edited. An attempted loopback-process identification could not prove
the live database target and stopped before any connection/write. The next fresh
QA start will use the corrected seed. No live credential was read, reset or
replaced, and no Atlas or existing localhost business data was modified.
