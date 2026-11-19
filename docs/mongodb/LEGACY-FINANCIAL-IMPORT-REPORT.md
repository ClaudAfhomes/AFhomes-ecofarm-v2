# Legacy financial imports — 29 October 2026

Flat CREATE imports now support Reservation Paid, Down Payment Completed,
Partially Paid and Fully Paid awaiting activation. They reuse the shared parser,
annotated review download, fresh identity/referral checks and guarded row
transaction; existing-member restoration continues through the same writer.

## Source mismatch corrected

The legacy function in
`20261204000001_afhomes_customer_ssot_alignment.sql` writes verified historical
payments but assigns `payment_pending` to every non-member sale. Both source and
native activation require `payment_verified` or `activation_pending`. Copying
that assignment literally strands a fully settled import before activation.

The native writer instead derives the state from actual verified amounts:

| Imported verified amount | Sale status | Next action |
| --- | --- | --- |
| Below frozen total | `payment_in_progress` | Finance records/verifies remaining payments |
| Exactly frozen total | `payment_verified` | Authorized Finance activation |
| Above frozen total | Row fails | Correct/review source payment facts |

No membership is created by a non-member financial import. Recording later money
does not activate a purchase; verification must make its server-computed balance
fully paid, then a separate authorized activation creates the membership. This
is a correction to contradictory stored state, preserving that workflow.

Historical total, actual payment date/method/reference, reservation fee,
required-initial amount and scheme remain frozen. Exact decimal helpers are used.
Where the old flat parser explicitly permits a current-plan price estimate, its
existing preview warning remains; the writer freezes the accepted price once.
No missing historical payment date/method is invented. Overpayment is refused.

Import governance view/update permissions, live source/customer/referral checks,
row-level replay and the organization/sales transaction guards remain intact.
Audit failure rolls back customer/sale/payment creation. A retry never resets an
activated sale or re-records its historical money. Imported commission terms
remain zero; no current genealogy is substituted for missing historical ancestry.

## Verification scope

Native disposable HTTP tests prove:

- Fully paid import -> activation queue -> separate membership activation.
- Reservation/down-payment/partial amounts and historical scheme thresholds are
  retained; partial purchases appear in Finance and cannot activate early.
- Partial import -> remaining payment recorded -> still cannot activate ->
  payment verified -> activation succeeds. Confirming the original job again
  does not duplicate either payment.
- Audit-failure rollback and overpayment rejection leave business counts intact.
- Existing active/suspended/expired restoration retains its earlier exact
  settlement, dates, points, replay and concurrency proof.

Fresh full suite: `pnpm --filter api exec vitest run --maxWorkers=2` passed
**3,108 tests / 192 files**. The confirmation file contains 28 passing tests.
API typecheck, targeted ESLint and environment isolation passed. Tests use
fresh disposable loopback replicas only; no Atlas data/schema, administrator,
credentials or environment settings changed. No commit, push or deployment.

Browser import/download/Finance acceptance, one-time migration compatibility,
recovery and remaining legacy edge cases are still open. CMS stays last; this
checkpoint is not full-platform acceptance.
