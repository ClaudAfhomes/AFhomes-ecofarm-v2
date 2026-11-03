# Legacy member creation — 29 October 2026

Later checkpoint: non-member financial imports are now enabled with a corrected
verified-payment-derived status. See `LEGACY-FINANCIAL-IMPORT-REPORT.md`; the
"Still gated" section below describes the preceding checkpoint.

Native import confirmation now supports flat legacy CREATE rows for Active VIP,
Suspended and Expired histories with actual full payment evidence. It uses the
same CSV/XLSX parser, row preview and guarded per-row transaction as other imports.

## Preserved behavior

Reference: `public.import_legacy_member` in
`20261204000001_afhomes_customer_ssot_alignment.sql`, its retained legacy
dispatcher and the subsequent removal of the retired `ost_ist_name` field.

- Revalidate the original row and current customer/member identity before any
  business writes. A supplied membership number claimed after preview fails.
- Require the registered active plan, historical frozen sale total, actual
  payment date/method and exact full settlement. Money uses existing decimal
  helpers; it is never calculated with floating-point arithmetic.
- Preserve actual payment reference/date, membership activation/expiry dates,
  supplied member number and active/suspended/expired status. Optional legacy
  dates retain the source's current-time/plan-validity defaults; leap-day expiry
  is clamped to the last valid day of the target month.
- Create a legacy-origin sale with import provenance and zero commission terms.
  No commission, login account, invitation or customer activation token is made.
  Existing administrator identity/password/assignments are untouched.
- Preserve the opening points balance, including zero. The single opening ledger
  entry is existing history, not an annual award; current-period linkage and
  70/30 day allowances keep the native points readers consistent. It does not
  consume new earning capacity. A replay does not replenish spent points.
- Reuse canonical business IDs and the native VIP-number allocator. Modern
  certified history fields requiring purchase-source reconciliation continue
  through the guided workflow, rather than being silently dropped by this path.
- Import view/update authorization, customer/sale/payment/member/points writes,
  identifiers and audit records use the existing guarded transaction. A row
  failure rolls back its business records and leaves an observable failed row.

No new collections/indexes, dependencies, environment changes or shared database
apply were needed. All write verification uses fresh disposable loopback replicas.

## Verification

Four added native HTTP scenarios cover exact cents, historical dates, allowance
splits, opening balance after spending/replay, no new credentials/commission,
zero balances, supplied member numbers, suspended/expired status, rollback of all
business/points records on audit failure, inactive plan/future payment/underpaid
rejection, concurrent confirmation and competing membership claims.

The initial two positive tests reproduced the prior 501 gate before implementation.
The focused import-confirmation file now has **26 passing tests**. The completion
checkpoint records the broader suite and static verification separately.

## Still gated

Flat non-member financial CREATE rows (Reservation Paid, Down Payment Completed,
Partially Paid, Fully Paid awaiting activation) remain 501. In particular, the
source legacy function assigns `payment_pending` even to fully settled purchases,
while its activation function accepts only `payment_verified`/`activation_pending`.
This source mismatch must be resolved before enabling that branch; it must not be
silently treated as a successful end-to-end activation path. The existing guided
purchase/historical workflows remain separate and already have native proof.

Browser acceptance, migration compatibility and backup/restore remain unfinished.
No Atlas business writes, migration, commit, push or deployment occurred. Keep
CMS last; this report is not full-system parity or release acceptance.
