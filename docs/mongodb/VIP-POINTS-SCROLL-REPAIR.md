# VIP number, manual points and customer scrolling

28 October 2026. Local `claud/mongodb-conversion`, AFhomes-ecofarm-v2.

Follow-up: [day allowances correction](DAY-POINT-ALLOWANCES-REPORT.md) fixes the
subsequently reported missing weekday/weekend attribution and records its scoped
existing-record reconciliation. The no-live-points-write statement below describes
this earlier repair only.

## Findings and changes

- Application creation omitted VIP number issuance. New and existing-customer
  application paths now issue a missing number in their creation transaction,
  using the existing allocator and the selected tier/payment terms. Activation
  also covers older pending applications. Existing numbers remain unchanged.
  A read-only check of the reported active customer found an existing number;
  the directory and Customer Lookup mapper both return it. No live backfill was
  needed or executed. Reload the lookup to discard the earlier blank response.
- Record Points uses `POST /earning/adjust`, which had neither a native handler
  nor development write permission. That exact POST now reaches a native handler
  after core writes are enabled. Other earning routes, Services and Redemption
  remain disabled. Existing `operations.redemption/update` authorization and the
  strict adjustment contract remain authoritative.
- Manual adjustments update account balance, membership balance, adjustment
  ledger and audit in one transaction. They require an active membership, a
  nonzero integer and a reason; negative balances are refused. They do not create
  cap credit, change annual caps, reversal debt or payment/commission records.
  Member writes serialize concurrent adjustments through transaction retries.
  The inherited adjustment contract has no caller idempotency key; do not
  automatically retry an ambiguous HTTP submission as a new correction.
- Shared dialog scroll locks previously captured each other's `hidden` overflow.
  Closing overlapping dialogs out of order could leave scrolling disabled.
  Locks now restore the original overflow only after the last dialog closes.
  Reload an already affected page to clear the old leaked inline style.

## Verification

- 106 API tests across native points adjustments, sales, customers, customer
  points, development access and application integration passed. Includes native
  concurrent adjustments, negative correction, authorization/validation denials,
  audit-failure rollback, payment preservation, installment number formats,
  repeated activation and Customer Lookup number visibility.
- 10 shared UI tests passed, covering dialogs, confirmations, out-of-order locks
  and Strict Mode unmount. 43 customer detail/lookup UI tests passed.
- Two shared feature flag tests passed; disabled modules stay disabled.
- API and UI TypeScript checks and environment isolation passed.
- Repository lint passed with existing warnings. Root `pnpm exec eslint` is not
  available; the repository's `pnpm lint` is the supported command.

No administrator, credentials, real points, payments or configuration were
changed. No migration, push, deployment or paid storage operation was performed.
Tests used disposable local replicas. Authenticated browser acceptance and a
real customer points submission were not performed.
