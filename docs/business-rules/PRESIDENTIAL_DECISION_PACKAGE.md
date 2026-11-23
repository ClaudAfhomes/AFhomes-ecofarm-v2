# Presidential Decision Package: Financial Policies Before Production Activation

Prepared 2026-11-13 for the President and management. **One decision is recorded as approved on the owner's report: Q1, Option C (both compensation models). No approval document, signature, approval date or effective date is on file for it, so its evidence status is "Awaiting Evidence".** Every other decision below is open and nothing else has been approved.

Status vocabulary: **Approved** (decided, evidence on file) · **Awaiting Evidence** (owner reports it decided; no document yet) · **Pending Decision** (not decided) · **Configuration Required** (decided in principle; values or data must be entered) · **Ready for Activation** (everything on file; only an authorized migration or configuration is left).

"Historical reference" means the 2026 workbook package (rulings C2, guides A4/A6, build note B8, as catalogued in `docs/business-rules/`). Those rules are documented, not approved for this system (`INDEX.md:3`, `INDEX.md:170`), and their figures are used only in labelled simulations.

## Summary

The AF Homes system records payments, verifies them, tracks commissions and runs an IST payroll engine. It never moves money: every payout, refund or transfer happens outside the system and is only recorded afterward. Engineering has built the full workflow (Finance submits, Super Admin approves, Finance records the external payment, Super Admin closes the period). The governing compensation model (Q1) is recorded as Option C on the owner's report, so the blanket Q1 lock is gone. The system still **refuses** to make any amount payable until a compensation policy for each rank is approved with evidence and the performance-input rules are decided. Of fourteen decisions, one (Q1) is recorded and thirteen remain. Until they are made, no real amount can become payable.

## Decisions at a glance

| # | Decision | Status | Owner |
|---|---|---|---|
| 1 | Governing compensation model (Q1) | Option C (both models) — Awaiting Evidence (owner-reported) | President |
| 2 | BA / PA / PB amounts and PB rates | Pending Decision; workbook figures are reference only. Policy screen ready (Configuration Required once decided) | President |
| 3 | BA / PA / PB targets and qualifying period | Pending Decision; reference only | President |
| 4 | Collection and counting thresholds | Pending Decision for IST payroll | President |
| 5 | Commission release conditions | Eligibility at 40% Approved; release Pending Decision | President |
| 6 | DSC / DRI rates and eligibility | Pending Decision; VIP DSC default missing (Q7) | President / Finance Director |
| 7 | Commission payout schedule | Pending Decision | President |
| 8 | IST payroll payout schedule | Pending Decision | President |
| 9 | KPI and team attribution (IST performance rule) | Pending Decision; rule screen ready, no rule approved | President |
| 10 | Policy effective dates and mid-month transitions | Pending Decision; months spanning two policies or two rules are refused | President |
| 11 | Payroll limits and exceptions | Pending Decision; review limits are configurable per policy, none set | President |
| 12 | Payment adjustment authority (Q13) | Pending Decision; resolution path built but refused | President / Finance Director |
| 13 | Clawback and deduction policy | Pending Decision; proposals only | President |
| 14 | Authorized external payment methods | Pending Decision; method recorded as entered | President / Finance Director |

## What the system does today (verified by engineering)

- Finance records and verifies a payment in one flow (amount and purpose, proof upload, review, verify). Overpayments are refused (`CLAUDE.md:40,44`).
- Payment adjustments (reversal, returned cheque, refund) can be proposed; resolution exists but is refused for everyone until Q13 is approved (§12).
- Commission eligibility begins at 40% verified settlement; payout needs separate authorization (`CLAUDE.md:42`). Commissions can be put on hold with a reason; recovery cases are proposals only (`20270105000004_afhomes_finops_commissions.sql:13-16`).
- Membership activation requires full verified settlement and is a manual Finance step (`CLAUDE.md:43`).
- IST payroll computes BA, PA and PB separately. Labelled simulations run end to end. Live payroll is no longer held by a Q1 lock; it stays blocked line by line until an approved compensation policy and the performance inputs exist.
- Authority: Finance submits batches and records disbursements; Super Admin approves or returns batches and closes periods; a batch is never approved by its submitter; SM, SSM and SVD (Sales Vice Director) have no approval authority (`CLAUDE.md:49`).
- A live payroll batch is re-checked against current verified-payment evidence when it is submitted and approved; if anything changed (a payment, an engagement, a rule), the step is refused and the batch must be regenerated. Once approved, recording an external payout is never refused (the money has already moved); a change in evidence since approval is flagged in the audit trail for review. Who reviews such a flag is undecided (`OPEN_QUESTIONS.md` Q15 j).
- Verified payments, frozen sale terms, commission figures and the audit trail cannot be edited or deleted through the application or its server account (migration `20270105000010`); only the database owner can remove records, for an authorized customer purge. The one permitted change is linking a verified reservation payment to the sale that reservation became.
- The system only records transactions made outside it. It never moves money.

---

Each item uses the same fields. Paths are relative to the repository root; `BR-*`, `INDEX.md` and `OPEN_QUESTIONS.md` are under `docs/business-rules/`.

## 1. Q1 Governing compensation model

- **Status: Awaiting Evidence.** The owner reports (2026-11-13) that the President approved **Option C: both compensation models**, kept independent with no duplicate entitlements. The source is the owner's report only. No approval document, signature, approval date or effective date has been supplied and none is invented; the system records the recording date, not an effective date. Evidence should be attached when available.
- **Q1 does not approve anything it did not decide:** BA/PA/PB amounts, rates, targets, collection gates, KPI attribution, effective dates, payroll limits, payout schedules, Q13 and clawback all remain open (items 2-14).
- **Previous status (superseded):** Pending Presidential Approval (`OPEN_QUESTIONS.md:5-6`).
- **Historical reference rule (reference only, not approved):** The workbook payroll model (BA/PA/PB, DSC/DRI, QP/EP, Equivalent TCP, Close Month) and the v2 card/points model conflict (`CONFLICTS.md:5`, CF-01; `SOURCE-DECISIONS.md:8`).
- **Proposed change / decision requested:** Choose one: (a) workbook payroll model; (b) card/points model only; (c) both, kept independent and never combined; (d) IST payroll superseded.
- **Missing governing authority:** A Presidential decision on Q1.
- **Approval required:** President. Recording it then needs an explicitly authorized migration.
- **System today:** migration `20270105000008` (local only, not applied to any shared or production database) records `Q1_GOVERNING_COMPENSATION_MODEL` as approved with source "owner_reported", option C, evidence "awaiting_evidence" and no effective date. Until it is applied by an authorized person, a shared database still holds the pending row and refuses live payroll.

## 2. BA / PA / PB amounts and PB rates

- **Current approved policy:** None approved. Historical figures are simulation fixtures only (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** Table A: BA / PA per month SM 15,000 / 15,000, SSM 25,000 / 25,000, SVD 50,000 / 50,000; PB rate SM 1%, SSM 3%, SVD 2% (`BR-PB-bonus.md:63-67`). BA and PA are pro-rated by days on appointment and departure; Override and PB are not (`BR-GEN-allowances.md:133-135`). First-month BA is paid without a production test, subject to Director withholding (`BR-ENG-periods.md:61-67`). Simulation example: SM BA 15,000, start 16 July, 16/31 of the month = **PHP 7,741.94** (`packages/shared/src/ist-payroll.spec.ts:89-105`).
- **Proposed change / decision requested:** Approve or replace the BA, PA and PB rate for each rank. Confirm day-based proration of BA/PA. Decide whether first-month (qualifying-period) BA is paid without a production test.
- **Missing governing authority:** An approved compensation policy per rank, plus Q1.
- **Approval required:** President.
- **System today:** `ist_compensation_policies` is empty by design. Without an approved row a line is blocked ("Configuration Required") (`supabase/migrations/20270105000001_afhomes_finops_foundation.sql:10-13,50-73`). Since migration `20270105000008`, Finance can draft and submit a per-rank policy in IST Payroll → Policies; Super Admin approves it only with an evidence reference and a note, and the drafter or submitter can never approve it. Saving or submitting never approves. The engine flags `QP_BA_DECISION_PENDING` until the first-month BA decision is supplied (`packages/shared/src/ist-payroll.ts:310-312`).

## 3. BA / PA / PB targets and qualifying period

- **Current approved policy:** None approved (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** Thresholds: BA / PA / PB SM 200,000 / 1,000,000 / 2,000,000; SSM 600,000 / 2,000,000 / 4,000,000; SVD 1,800,000 / 5,000,000 / 10,000,000 (`BR-PB-bonus.md:63-67`). The contract start date (never the accreditation date) drives the qualifying period (`BR-ENG-periods.md:37`). A start on 16 July gives a qualifying period of 16 July to 15 August and a correction stretch of 16-31 August, with each stretch assessed on its own days (`BR-ENG-periods.md:107-111`).
- **Proposed change / decision requested:** Approve a target per rank and component. Confirm or replace the qualifying-period rule (one calendar month minus a day).
- **Missing governing authority:** An approved compensation policy per rank, plus Q1.
- **Approval required:** President.
- **System today:** The engine applies the qualifying-period rule as shown (`packages/shared/src/ist-payroll.ts:160-175`). It flags start days other than the 1st or 16th but does not block them (`:268-269`).

## 4. Collection and counting thresholds

- **Current approved policy:** None approved for IST payroll. Commission eligibility at 40% verified settlement is approved (`CLAUDE.md:42`). The 25% Closed Deal threshold is NOT approved (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** The workbook has three separate thresholds that must not be confused (`BR-PB-bonus.md:92`; `BR-QLF-qualification.md:110`): (1) a sale **counts** as a closed deal at 25% (VIP) / 10% (IGP) (`BR-QLF-qualification.md:30-37`); (2) commission **pays** at 40% (`BR-QLF-qualification.md:110-112`); (3) PA and PB require a **monthly collection quota** of 40% of the rank's own PB threshold, measured on the team's monthly total (`BR-PB-bonus.md:92-94`). There is no minimum collection rate (B19 = 0%) (`BR-PB-bonus.md:13-15`).
- **Proposed change / decision requested:** Set the collection gate for each rank (the workbook used 40%). Decide whether a per-sale counting threshold applies and at what level, and whether a minimum collection rate applies.
- **Missing governing authority:** Q1 and Q3 (`OPEN_QUESTIONS.md:8`), plus an approved policy.
- **Approval required:** President.
- **System today:** The gate is a per-policy `collection_gate` value with none configured (`supabase/migrations/20270105000001_afhomes_finops_foundation.sql:59`). Activation requires 100% verified payment (`BR-QLF-qualification.md:47`).

## 5. Commission release conditions

- **Current approved policy:** Eligibility begins at 40% verified settlement; payout needs separate authorization (`CLAUDE.md:42`). Automatic release at 40% is NOT approved (`CLAUDE.md:50`). No final-qualification rule exists (`AGENTS.md`, "Current state").
- **Historical reference rule (reference only, not approved):** At 40% a VIP sale released 100% of DSC/DRI; an IGP sale released 40%, with the remainder on full payment (`BR-QLF-qualification.md:110-112`).
- **Proposed change / decision requested:** Choose one: (a) fully manual, case by case; (b) release at a stated verified-settlement percentage; (c) release only at full settlement. Name who authorizes release.
- **Missing governing authority:** An approved release rule.
- **Approval required:** President.
- **System today:** The move to `earned` is a manual, permission-gated, audited decision with mandatory notes. Commissions on hold cannot be paid (`supabase/migrations/20270105000004_afhomes_finops_commissions.sql:13-14`).

## 6. DSC / DRI rates and eligibility

- **Current approved policy:** None approved. New DRI entitlements are NOT approved (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** Default DRI 5% (VIP) / 4% (IGP); default DSC IGP 8%; the **VIP DSC default is not in any inspected source** (`BR-RATE-freeze.md:107-109`; `OPEN_QUESTIONS.md:15`, Q7). Rates freeze when the sale number is issued (`BR-RATE-freeze.md:13`). Rates are reviewed on each person's accreditation anniversary, and only new sales carry a new rate (`BR-RATE-freeze.md:61`).
- **Proposed change / decision requested:** Approve the DSC and DRI rates, including the missing VIP DSC rate, and who is eligible for each. Decide whether anniversary reviews apply.
- **Missing governing authority:** Q7 and Q8 (`OPEN_QUESTIONS.md:15-16`).
- **Approval required:** President, with Finance Director confirmation (Q7/Q8 owner).
- **System today:** There is no DSC/DRI. Each sale freezes a single commission rate and expected commission (`BR-RATE-freeze.md:23`).

## 7. Commission payout schedule

- **Current approved policy:** None approved.
- **Historical reference rule (reference only, not approved):** Release depends on events, not dates: payment at 40%, remainder on full payment (`BR-QLF-qualification.md:119`). Settlement ran monthly on the 5th of the month (`BR-CTL-controls.md:68`).
- **Proposed change / decision requested:** How often are released commissions paid (per release, weekly, twice monthly, monthly), and on what day?
- **Missing governing authority:** No governing source in repository for a payout calendar.
- **Approval required:** President.
- **System today:** Finance records each payout or failure after paying outside the system. No schedule is enforced. Each recorded commission payment keeps its external reference, method, payment date (not in the future) and an evidence reference on the commission, frozen once recorded; the payout row carries the reference, method and date (`supabase/migrations/20270105000017_afhomes_finops_commission_payout_details.sql`).

## 8. IST payroll payout schedule

- **Current approved policy:** None approved.
- **Historical reference rule (reference only, not approved):** BA may be released monthly or twice a month but is always computed by days. PA, PB and Override are calendar-month only (`BR-ENG-periods.md:85`). Settlement run on the 5th, with approvals before the 5th (`BR-CTL-controls.md:68`; `BR-OPS-golive.md:83`).
- **Proposed change / decision requested:** Monthly or twice-monthly BA; the pay date or dates after a period closes.
- **Missing governing authority:** Q1 and an approved pay calendar.
- **Approval required:** President.
- **System today:** Batches cover a calendar month. Close needs Finance submission and Super Admin authorization. No pay date is defined or enforced.

## 9. KPI and team attribution

- **Current approved policy:** None approved. Assumed-credit percentages are NOT approved (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** A vacant post earns nothing and its downline rolls up (`BR-GEN-allowances.md:6`). A successor inherits only the genealogy, not transactions before the appointment (`:78`). A leader covers the whole genealogy (`:102`). Assumed credit is 40% (VIP) / 20% (IGP) of collections on inherited accounts (`BR-ACM-assumed.md:6-15`). Equivalent TCP = MIN(collection ÷ 40%, Team TCP) once the quota is met (`BR-PB-bonus.md:37-39`). Simulation example: SM with KPI 5,000,000 and collection 1,000,000 gives Equivalent TCP 2,500,000 and PB at 1% = **PHP 25,000** (`packages/shared/src/ist-payroll.spec.ts:214-217`).
- **Proposed change / decision requested:** Decide how KPI and team credit are assigned (own sales, downline, vacant posts, successors, assumed accounts). Approve or reject the Equivalent TCP formula. Name the source of IST performance data.
- **Missing governing authority:** Q1 and Q8 (`OPEN_QUESTIONS.md:16`).
- **Approval required:** President.
- **System today:** Migration `20270105000009` adds two governed records, each drafted by Finance and approved by Super Admin with evidence: an **IST engagement** (staff, rank, contract start/end) and an **IST performance rule** (attribution basis, closed-deal threshold, count-date basis, assumed-credit rate, adjustment treatment). KPI and collection are then derived only from verified payments on the sales of record, with a per-payment evidence list. No rule is approved and no value is pre-filled, so every live line stays blocked (`RULE_NOT_APPROVED`). Assumed credit is always 0.00 until its base is defined. Adjustments are reported, never deducted.
- **Decisions this needs (one rule covers them):** attribution (seller of record only, or team/genealogy roll-up); the closed-deal threshold, if any; which date counts a sale (payment date or verification date); the assumed-credit rate and base; how approved reversals and refunds affect KPI/collection; how pre-system (imported) sales count. Open details are listed under Q15 in `OPEN_QUESTIONS.md`.

Payments outside an approved engagement window have `UNDETERMINED` eligibility and block the staff member's live line. Live batch submission and approval recompute performance under the engagement and rule locks. Each line must remain CALCULABLE and carry the current evidence hash, including the count date and count period. Missing or changed evidence requires draft regeneration.

Engagement and performance-rule lists are viewable with view permission on any of `finance.payroll`, `finance.payroll_approval`, `finance.payroll_policy` or `finance.payroll_policy_approval`. Drafting and approval retain their separate permissions.

## 10. Policy effective dates

- **Current approved policy:** None approved.
- **Historical reference rule (reference only, not approved):** Rate, threshold and personnel changes apply from the current unclosed month onward. A personnel change in mid-month recomputes the whole unclosed month (`BR-CTL-controls.md:63`). A threshold change applies only to new qualifications (`BR-QLF-qualification.md:54`). A sale keeps the rates frozen at issue (`BR-RATE-freeze.md:61`).
- **Proposed change / decision requested:** Which date selects the policy: the 1st of the month, the start of the qualifying period, the sale date or the payment date? Is a month spanning two policies paid under one policy, or split by days?
- **Missing governing authority:** No governing source in repository for selecting the payroll policy date.
- **Approval required:** President.
- **System today:** Policies are effective-dated approved rows, and approved windows cannot overlap. Ordinary value changes need no code change: a new row is added. A month covered by one policy uses it. A month in which a rank's policy (or the performance rule) changes is **refused** for live payroll: decision keys `COMPENSATION_POLICY_TRANSITION_RULE` and `PERFORMANCE_RULE_TRANSITION_RULE` are pending, and even once approved, split-month payout is not implemented until the rule itself is specified. Policies are created and approved in IST Payroll → Policies (migration `20270105000008`); an approved policy already used by a finalized payroll month cannot be ended retroactively.

Engagements and performance rules also protect approved or closed payroll months against retroactive changes. A replacement performance rule with a changed threshold, count-date basis, attribution basis or adjustment treatment is refused while `PERFORMANCE_RULE_TRANSITION_RULE` is pending. After approval of that decision, succession remains blocked until the transition behavior is implemented. An incomplete performance rule cannot be approved.

## 11. Payroll limits and exceptions

- **Current approved policy:** None approved.
- **Historical reference rule (reference only, not approved):** The Director console range-checked and logged every change to a pay figure (`BR-AUTH-governance.md:13`). A deviation for one person was a logged Director decision that went back for re-approval (`BR-AUTH-governance.md:37`). The Director could withhold first-month BA (`BR-ENG-periods.md:67`). No per-rank payroll maximum is documented.
- **Proposed change / decision requested:** Set any per-rank maximum and decide whether a split (transition) month may exceed it. Name who approves exceptions and withholdings.
- **Missing governing authority:** No governing source in repository for payroll amount limits.
- **Approval required:** President.
- **System today:** No maximum is invented. Each policy can carry optional BA / PA / PB / net **review limits** (none set). A line above a limit, or with BA/PA above the policy amount, is not truncated: it is flagged and must be reviewed by Finance with a note before the batch can be submitted. A disbursement must equal the approved line's net amount (`supabase/migrations/20270105000005_afhomes_finops_payroll.sql:315`).

## 12. Payment adjustment authority (Q13)

- **Current approved policy:** None approved. New refund or reversal authority is NOT approved (`CLAUDE.md:50`). Q13 is open (`OPEN_QUESTIONS.md:18`).
- **Historical reference rule (reference only, not approved):** A refund removes the sale's qualification outright, and a replacement sale qualifies from zero. Partial refunds were negative receipts recorded only against CANCELLED sales. The cashier raised the case and the Director investigated (`BR-QLF-qualification.md:85,93`).
- **Proposed change / decision requested:**
  - Who may approve, reject and withdraw a proposed adjustment (reversal, returned cheque, refund), and may anyone other than the requester withdraw?
  - What an approved adjustment does to the sale's verified total, commission eligibility, activation, contract balance and card status, and whether it triggers a refund disbursement.
  - Whether approved adjustments are netted against the period's collections.
- **Missing governing authority:** A Q13 decision.
- **Approval required:** President / Finance Director (Q13 owners).
- **System today:** `resolve_payment_adjustment` (approve, reject, withdraw) requires module `finance.payment_adjustment_decision`, which only Super Admin holds, **and** key `Q13_PAYMENT_ADJUSTMENT_AUTHORITY` = approved. That key is pending, so in live use nobody can resolve anything (`supabase/migrations/20270105000007_afhomes_finops_adjustment_resolution.sql:3-11,188-190`). Approve and reject are never by the requester. The requester may withdraw only by holding that module (`:21-24,206-207`). An approved adjustment appears in period figures (`approvedAdjustmentsCount/Total`). It does **not** reduce `verifiedTotal`, commission eligibility, activation, contract balance or card status (`:25-32`). A proposed adjustment blocks its month's close (`PAYMENT_ADJUSTMENTS_PENDING`).

## 13. Clawback and deduction policy

- **Current approved policy:** None approved. Automatic deductions, clawback recovery and performance-based auto-termination are NOT approved (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** The settlement run included a Director "withhold" step (`BR-CTL-controls.md:61`). A failed qualifying-period review ended the engagement at the end of the period (`BR-REV-reviews.md:6`), as did two consecutive months below target (`BR-REV-reviews.md:30`). No clawback or deduction rule is documented.
- **Proposed change / decision requested:** Is overpaid commission or allowance recovered? If so, decide how (deduction from future pay, direct repayment or write-off), within what limits and with whose approval. Decide whether performance reviews may lead to termination.
- **Missing governing authority:** No governing source in repository for clawback or deductions.
- **Approval required:** President.
- **System today:** Recovery cases are proposals only. No function approves, offsets, deducts or refunds (`supabase/migrations/20270105000004_afhomes_finops_commissions.sql:15-16`). Payroll net subtracts only approved BA withholding and authorized adjustments, with a floor of zero (`packages/shared/src/ist-payroll.ts:19`).

## 14. Authorized external payment methods

- **Current approved policy:** None approved. Automatic bank transfers are NOT approved (`CLAUDE.md:50`).
- **Historical reference rule (reference only, not approved):** No governing source in repository.
- **Proposed change / decision requested:** Which methods are authorized for customer payments, commission payouts and payroll disbursements, and are there per-method limits or evidence requirements (for example, a cash limit)?
- **Missing governing authority:** No governing source in repository.
- **Approval required:** President / Finance Director.
- **System today:** Customer payments offer cash, bank transfer, GCash, Maya, card and cheque (`packages/contracts/src/schemas/customer-workflow.ts:299`). The payroll disbursement screen suggests Bank transfer, Cheque, Cash and E-wallet (`apps/admin/src/features/business/PayrollDisbursementDialog.tsx:10`). Commission and payroll payouts store the method as free text of 1-40 characters (`supabase/migrations/20270105000005_afhomes_finops_payroll.sql:157`). The commission payment screen suggests the same four methods; the list records how a payment was made and authorizes none. No money is sent.

---

## What activation requires after approval

1. **Record the decision.** Write each approved decision, with date and approver, in `docs/business-rules/OPEN_QUESTIONS.md` and the decision register. Engineering will not record or infer a decision on the President's behalf.
2. **Authorized application of the Q1 migration, and a Q13 decision.** Migration `20270105000008` records Q1 (owner-reported). It must be applied to the real database by an authorized person; Q13 (`Q13_PAYMENT_ADJUSTMENT_AUTHORITY`) stays pending until separately decided. Nothing in the application writes these keys. No migration runs without that authorization.
3. **Configure the approved policy per rank.** Finance drafts each rank's policy (BA, PA, targets, PB rate, collection gate, effective date, optional review limits) in IST Payroll → Policies; Super Admin approves it with the evidence reference. Payable amounts stay blocked for any rank without one.
4. **Configure IST engagements and the performance rule.** Finance records each IST's engagement (rank, contract start/end, evidence); Super Admin approves. Once the President decides item 9, Finance drafts the performance rule and Super Admin approves it with evidence. KPI and collection then come from verified payments, never from typed figures.
5. **Test and sign off.** Run the labelled simulation against the approved policy, compare to your expected figures, then take the first live period through the Finance submit, Super Admin approve, external payment and close steps.

Decisions that stay out of scope until separately approved: historical BA/PA/PB figures, automatic commission release, the 25% Closed Deal threshold, automatic deductions, new refund authority, performance-based auto-termination, assumed-credit percentages and automatic bank transfers.

## Financial integrity completion — 15 November 2026

Q1 remains approved Option C on the owner's report with documentation awaited. No approval date, signature or effective date has been invented. Synthetic local approvals provide test evidence only. Actual company compensation still requires approved terms and supporting authority.

Finance can draft policies, engagements and performance rules through IST Payroll. Each record is submitted to a separate authorized approver. Enter effective dates and evidence references from the approved company documents. Actual engagement start dates are supported. QP ends one calendar month minus one day after start and EP begins the next day. A documented QP BA decision is captured on the approved engagement. Missing QP authority blocks the affected line.

Migrations `20270105000010`–`20270105000015` preserve verified receipts, frozen commercial and commission facts, completed qualification and payment decisions, audit records, payroll evidence snapshots and closed accounting history. Payroll submission, approval and month-end closing serialize with financial writes and recheck their evidence. Duplicate and competing commission decisions preserve the winning record.

External payroll payments require proof. If evidence changes after approval, Finance can still record the factual payment against the original entitlement. The UI displays the discrepancy. An actor with payroll-close authority records a review note and evidence reference before closing. The review and proof are immutable. Any recovery, deduction or future-period adjustment requires its own approved policy.

Q16 customer purge is blocked at both API and database when financial history or retained identity documents exist. Receipt objects are preserved. Company retention periods, legal basis and an authorized anonymization or erasure procedure remain pending. Customer records without protected history can still follow the existing purge workflow.

Q13 resolution remains guarded by its separate pending decision. Approved-adjustment netting, balance, commission, activation and historical-entitlement effects require explicit accounting policy. Mid-month policy and performance-rule segments are detected and versioned. Affected live lines remain blocked until the transition rule and its calculation behavior are authorized and implemented.

Local positive-path evidence covers a payable October batch with BA100.00, PA200.00, PB100.00 and net400.00, followed by payroll and month-end close. A separate November 3 engagement demonstrates QP proration with BA93.33, PA186.67, PB100.00 and net380.00, changed evidence after approval, factual payment recording, required reconciliation and closing. Every amount and approval in these scenarios is TEST ONLY.

The full API run retains the customer-import failure at `api/_handlers/customer-imports.spec.ts:824`. Its application-only fixture has no member/payment requirement, so seller resolution is skipped and two rows remain valid. The test expects one invalid seller row. The import implementation and MongoDB reference are preserved. This failure requires a separately scoped fixture correction or an approved change to application-only import requirements.
