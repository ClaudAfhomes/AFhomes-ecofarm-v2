# Presidential Demonstration — Financial Operations Walkthrough

Prepared 2026-11-13. About 20 minutes. Companion to `PRESIDENTIAL_DECISION_PACKAGE.md`.

**Ground rules for the demo**

- AF Homes records money that moved outside the system. Nothing in this demo transfers, collects or pays money.
- Run it only against an isolated demonstration database: a local or preview Supabase project seeded with synthetic people (`pnpm seed:demo` refuses the production project). Never against shared or production records.
- Three demo logins: **Finance**, **Super Admin A**, **Super Admin B** (two Super Admins show that a batch is never approved by the person who submitted it). Optionally one **SM** login to show what sales staff cannot do.
- Q1 (governing compensation model) is recorded as **Option C — both models**, on the owner's report that the President approved it; evidence is awaited and no effective date is set (migration `20270105000008`). Q1 approves only the model choice: live payroll lines stay blocked until an approved per-rank compensation policy, approved IST engagements and an approved performance rule exist. Q13 (adjustment authority) stays **pending**; adjustment resolution is shown *locked*.

| # | Step | Login | Screen | What to point out |
|---|---|---|---|---|
| 1 | Record and verify a customer payment | Finance | Finance → Payments (`/admin/finance/payments`) | One flow: amount + purpose → upload proof → review → verify. Only the next valid purpose is offered; an overpayment or a repeated reference is refused; a reference already used on another contract is held until Finance explains it. Pending (recorded) money never counts. |
| 2 | Commission eligibility and payout record | Finance | Finance → Commissions (`/admin/finance/commissions`) | Commission becomes eligible at 40% verified settlement; nothing is paid automatically. The payout is recorded only after separate authorization, as a record of an external payment; holds block it. Finance enters the external reference, method, payment date and an evidence reference; the amount and recipient are fixed. Selecting a commission number opens its details: the frozen calculation, verified collection against the 40% milestone and the one next action. |
| 3 | IST BA/PA/PB simulation | Finance | Finance → IST Payroll → Simulation tab (`/admin/finance/payroll`) | Pick staff by name, staff ID or AA number (ineligible staff greyed with the reason). Historical BA/PA/PB figures are entered as a labelled *reference snapshot*, never saved as policy. Lines show BA, PA, PB, adjustments, withheld and net separately. |
| 4 | Finance submits the batch | Finance | same | Status Draft → Submitted. A line flagged for review (above a configured review limit or above the policy amount) must be reviewed with a note before the batch can be submitted. |
| 4a | Compensation policy lifecycle | Finance, then Super Admin A | IST Payroll → Policies tab | Finance drafts a per-rank policy (amounts, targets, PB rate, collection gate, effective date, basis note) and submits it. Saving or submitting never approves it. Super Admin A approves only with an evidence reference and a note, or returns it with a reason; the person who drafted or submitted it cannot approve it. Use clearly synthetic figures in the demo: no historical amount is approved. |
| 5 | Super Admin approves | Super Admin A | Dashboard approvals card / IST Payroll | Card is labelled **SIMULATION — not real money**. Approve or Return (return needs a reason). The submitter cannot approve their own batch. |
| 6 | Record the external payroll payment | Finance | IST Payroll batch detail | "Record simulated payout" per line: amount must equal the line net; bank reference, method and date are a record of a transfer made outside AF Homes. Simulated payouts live in a separate table and never reach real totals. |
| 7 | Close the payroll batch | Super Admin B | IST Payroll batch detail | Close only when every line is recorded; the batch then freezes. Switch to the **Live** tab: the banner shows the Q1 basis ("Option C — owner-reported, evidence awaited, no effective date"); each line without an approved policy, engagement or performance rule is shown blocked with its reason, and a blocked line can be neither approved nor paid. |
| 8 | Month-end reconciliation and close | Finance, then Super Admin | Finance → Month-End (`/admin/finance/month-end`) | Readiness panel: **blockers** (unverified payments, pending adjustment proposals, unreconciled commission payouts) stop submission; **warnings** (missing evidence, duplicate references, open live payroll) do not. Ordinary finance closing is not held hostage by payroll policy decisions. Finance submits, Super Admin closes; the closed month's figures are snapshotted and protected. |
| 9 | Payment adjustment (returned cheque) | Finance | Payment detail → Adjustments | Finance can *propose* a reversal / returned cheque / refund with reason and evidence. Approve / Reject / Withdraw are visible but disabled: "Resolution authority awaits Presidential approval (Q13)". The original payment is never edited. |
| 10 | Financial audit history | Super Admin | Audit (`/admin/audit`) | Every record, verification, submission, approval, return, payout record, close and proposal appears with actor, time and reason. |
| 11 | Outstanding decisions | — | `PRESIDENTIAL_DECISION_PACKAGE.md` | Walk the summary table: Q1 evidence (awaited), per-rank compensation policy, IST performance-input source, payroll limits, policy effective-date rule, Q13 adjustment authority and downstream effects, plus the remaining items. |

**Optional negative checks (30 seconds each)**

- SM login: no Finance, Payroll or Month-End menu; a direct URL is refused by the server, not just hidden.
- Super Admin tries to approve a batch they submitted → refused.
- Finance tries to approve payroll or close a month → refused.

**What the demo cannot show today**

- A payable live payroll line: blocked by design until an approved compensation policy, approved IST engagements and an approved performance rule exist. None of these is approved; the historical amounts are reference values only.
- Resolving an adjustment: blocked by design until Q13 is decided. The full approve/reject/withdraw path is proven on a disposable test database (DB suite section 87), not in the demo environment.
