# AF Homes End-to-End Workflow

Source and disposable-local verification as of 17 November 2026 on `claud/supabase`, including uncommitted work.
This document describes the coordinated workflow implemented by migration
`20270105000016_afhomes_coordinated_application_workflow.sql` and its API/UI consumers.
It does not authorize compensation values, commission qualification rules, payouts,
or production activation. Existing financial policy guards remain in force.

## 1. Application to activation

| Step | Action | Authority | Persisted result |
|---|---|---|---|
| 1 | Create Application & RA | Active SM for self; Admin/Super Admin on behalf of an active SM; existing create permission required | Application `draft` and one linked RA `draft`, in one transaction |
| 2 | Submit for Approval | Assigned SM/creator or Admin/Super Admin, subject to server permissions | Required details and current reviewed ID validated; terms frozen; existing RA reused; both `submitted` |
| 3 | Upload Signed Application / Upload Signed RA | Authorized application access and `sales.customers` update | Private files registered as `pending_review` |
| 4 | Review Signed Documents | Authorized document reviewer | Each document independently `accepted` or `rejected`; purchase remains unapproved |
| 5 | Approve Application & RA | Admin/Super Admin **and** `sales.application_approval` update | Application `approved`, linked RA `executed`, with actor/time/audit evidence in one transaction |
| 6 | Automatic Finance handoff | Server queue eligibility | Approved application and executed RA appear in Finance; no handoff or separate execution button |
| 7 | Record Reservation Payment, then Verify Reservation Payment | `finance.payment_verification` | Separate recorded and verified ledger/audit events; required only when frozen terms include a reservation fee |
| 8 | Record Payment, then Verify Payment | Finance | Verified cumulative collection and remaining balance updated; first qualifying non-reservation verification issues this purchase's VIP Card ID |
| 9 | Commission Eligible | Automatic at 40% verified collection | Eligibility timestamp and frozen attribution retained; no automatic qualification or payout |
| 10 | Finalize Purchase | Authorized Finance | Fully verified settlement creates one `payment_verified` card sale and its commission reference |
| 11 | Activate VIP Membership | `finance.card_activation` update | Membership `active`; existing points initialization, credentials and onboarding issuance apply |

Approval, payment verification, finalization, activation and commission payment are
separate business events. There is one administrative Application & RA approval.

## 2. Creation and submission

`POST /official-forms/customer-applications` uses one idempotent database operation.
Application creation immediately creates its linked RA and allocates its existing
business number. Failure creating either record rolls back both. Retrying does not
allocate another RA. Draft commercial snapshots are provisional; submission binds
that same agreement to the exact immutable purchase-terms version.

Only an active SM, Admin or Super Admin may originate. Administrators must name an
active SM before creation. SSM, SVD, OST and Finance monitoring permissions do not
authorize origination. Restrictions are enforced by the API and database, as well
as by visible UI actions. The public normal `POST /sales` shortcut returns
`PURCHASE_WORKFLOW_REQUIRED`; existing sale reads and legitimate historical payment
and activation paths remain available.

Submission validates the application, seller, current confirmed/reviewed identity
document, proposal hash and commercial terms. It freezes terms and submits the
existing RA. A stale proposal fails rather than silently taking new prices.

The new-customer wizard first saves the Application & RA and uploads the ID for
review. An authorized reviewer opens the private preview and explicitly confirms
the holder match through **Review ID**. **Submit for Approval** becomes available
after that review and the other required fields pass validation. A replacement ID
is saved for review before submission. Uploading an ID never confirms it automatically.

## 3. Documents and coordinated approval

The application displays one **Required Signed Documents** section containing the
Signed Application Form and Signed Reservation Agreement. Upload and review are
explicit actions. Uploading either document never approves the purchase.

PDF, JPEG and PNG files use the existing private `afhomes-signed-documents` bucket
and size limit. The API validates stored bytes, size and SHA-256 at registration;
the database associates the evidence with the application and agreement. Acceptance
records uploader, reviewer and review time. Existing self-review permission is
preserved; administrative approval still requires Admin/Super Admin authority.
There is no OCR or automatic signature authenticity determination.

`POST /official-forms/customer-applications/:id/decision` rechecks the submitted
application, matching frozen terms, active SM, linked RA and both accepted current
signed documents. Missing evidence produces a specific refusal. Approval and RA
execution share one transaction and one request identity; an unsuccessful transition
leaves neither record partially approved. A separate normal RA execution request
is refused with `APPLICATION_APPROVAL_REQUIRED`.

Older approved applications with an unfunded draft/submitted RA finish through the
same joint approval action, with both accepted documents and matching frozen terms.
The original application approval timestamp and all earlier evidence are retained.

Return for Corrections and Reject preserve the linked RA and all older evidence.
They advance the workflow revision, so old accepted signatures cannot approve a
revised application. Resubmission reuses the original RA. Unfunded cancellation
moves the application and RA together; recorded/verified money or a finalized sale
blocks cancellation. Cancellation does not silently replace a signed agreement.

## 4. Finance and purchase identity

The Finance queue includes an application purchase only when its application is
`approved` and RA `executed`. It displays **Awaiting Reservation Payment** only when
the frozen reservation amount is required and has not been verified. Other valid
initial stages use their actual payment action.

Finance records money received externally, with amount, payment date, method,
reference and supporting receipt. Recording and verification remain separate
server calls and audit events. A positive frozen reservation fee must be received
in its exact amount and verified before subsequent purposes. Pending money does
not count as verified collection; it is included when preventing overcommitment.
Payment proofs, duplicate checks, period locks and immutable verified history apply.
No real financial transfer is initiated by these actions.

Reservation-only, pending and rejected payments issue no VIP Card ID. The first
verified qualifying non-reservation payment allocates one ID atomically, using the
existing numbering format/counter. It is stored on the purchase RA and returned to
Finance immediately. A second purchase receives a distinct ID; the older purchase
and compatibility customer projection are preserved. Memberships and points accounts
remain associated with their individual finalized purchases.

Finalization rechecks the full verified balance, unresolved receipts, approved
application, executed RA and frozen terms. Retries/concurrent finalizers cannot
create duplicate sales or commissions. Finance then activates the finalized sale;
activation remains idempotent and does not pay commission.

## 5. Connected financial processes

The existing RA eligibility event represents 40% collection before finalization.
Finalization carries its original timestamp and frozen beneficiary/calculation
references into the commission record. Eligibility does not mean earned or payable.
Qualification remains the existing manual, permission-gated, audited decision.

`finance.commission_payouts` authorizes Finance's external-payment recording,
failed-attempt recording and reconciliation duties. `network.commissions` retains
qualification, policy, hold and recovery authority. Existing payout approval,
qualification and evidence guards remain applicable; no new rate or payout authority
is established by this workflow correction.

Recording an external commission payment requires the external reference (with at
least one letter or digit; one reference backs one payout), the payment method, the
payment date (not in the future, Asia/Manila) and a payment evidence reference of
10-500 characters. The amount and recipient come from the frozen commission; there
is no partial payout. These facts are frozen once recorded (`20270105000017`). The
payout row carries the recorded method and date. A seller reading their own
commission sees the reference, method and date, not Finance's evidence reference:
the API masks it and the browser database role holds no grant on that column.
The commission detail view shows the frozen calculation, verified collection against
the 40% milestone, the decision history and the one next action available.

IST Payroll retains BA/PA/PB, approved policy and verified evidence requirements,
Finance submission, authorized approval, external payout recording, reconciliation
and close, with simulation/live isolation. Batch lines are listed exception-first:
lines needing configuration, then lines awaiting review. Month-End retains readiness checks,
separation of duties, immutable snapshots and accounting-period locks. Neither
module's financial policy is approved by this change.

## 6. Verification and release limits

`pnpm test:db:workflow` boots a disposable loopback PostgreSQL, applies all migrations,
reapplies the workflow migration, exercises the coordinated flow and independent
session races, checks RLS invariants and destroys the database. The focused run
proved creation rollback/retry, document requirements, role denial, Admin and Super
Admin approval, payment ordering, purchase-specific IDs, 40% history, finalization,
activation, corrections and cancellation. Concurrent creation, submission, approval,
recording, verification, finalization and activation preserved single records and
produced no deadlocks.

### Executed browser proof

The isolated local Supabase/Auth/Storage walkthrough passed on 17 November 2026.
All identities, documents and payment references were synthetic.

- The SM created application `a2af0ed1-90b8-43a2-a68b-63504b62c688` and linked RA
  `46576ea1-97f9-4e94-b39f-c2d5725a98ff` together. Their creation audit timestamps
  match. The browser resumed that same draft after the ID-review correction.
- Explicit ID review completed before successful submission. Both signed documents
  were uploaded and accepted. The SM saw no administrative approval action.
- Admin used **Approve Application & RA** once. Application approval and RA execution
  share the same audit timestamp. Finance received RA `2026-0001` automatically.
- Finance recorded and verified the frozen Silver spot-cash reservation fee of
  PHP 10,000.00. The purchase still had no VIP Card ID. Reusing that receipt for a
  different payment correctly failed with `RECEIPT_ALREADY_USED` and created no
  additional payment. A distinct synthetic receipt allowed the PHP 182,000.00
  balance payment. Recording and verification were distinct API calls/audit events
  within the existing Finance dialog.
- Verified collection reached PHP 192,000.00 with zero remaining balance. The first
  qualifying non-reservation verification issued `26111700001S1C01S` and recorded
  commission eligibility before finalization. The spot-cash UI required the exact
  remaining balance, so this browser case crossed 40% at full settlement. Partial
  threshold behavior is covered by the disposable database tests.
- Finance finalized sale `AF-CSALE-YYDHP` and activated its membership. The sale and
  membership are `active`. Commission remains `final_qualification_pending`, with
  the original eligibility timestamp preserved. Exactly one linked RA and two
  verified payment rows remain.
- A separate application `361a0859-407d-4727-a984-b95f17bda101` and RA `2026-0002`
  were prepared through the authorized local API, with reviewed ID and both accepted
  signed documents. Super Admin inspected the previews and completed the joint
  approval in the browser. Database state and actor audit confirm one approval.

Browser-found repairs added the SM application entry points, explicit ID review,
issued agreement numbers in saved-form display/export, frozen-snapshot exports,
and a frozen terms summary on read-only records. Read-only records no longer show
save/submission blockers or a new proposal calculated from current configuration.
Non-draft exports load the stored agreement, including a single cancelled agreement
retained for history. Missing agreement evidence blocks export instead of rebuilding
historical terms from current plan configuration.

Chrome responsive emulation at 390 x 844 showed usable application status/workflow
cards, Finance payment rows/actions, the scrollable payment dialog and activation
queue. This is an emulated viewport check. No physical-device test was performed.
Console inspection of the checked application/Finance pages showed no runtime
errors. Chrome reported form-field id/name attribute improvements on Finance views.
The expected duplicate-receipt HTTP 409 is preserved as refusal evidence.

### Regression evidence

| Check | Result |
|---|---|
| Full disposable PostgreSQL suite | 3,916 passed, 0 failed |
| Failure-injection and cleanup harness | 13 passed, 0 failed |
| Focused coordinated workflow | 64 assertions passed |
| Independent-session concurrency | 27 assertions passed |
| Migration ordering/replay | 185 migrations, replay unchanged, zero RLS violations |
| Supabase API suite | 3,278 passed, 1 existing customer-import failure |
| Contracts | 357 passed, 0 failed |
| Customer web | 277 passed, 0 failed |
| Final changed Admin workflow/ID/export/IST checks after resume | 115 passed, 0 failed across 5 files |
| Address/network timeout-file rerun | 28 passed, 0 failed |
| Final Admin typecheck | Passed |
| Final scoped lint | 0 errors, 2 existing warnings |
| Full final Admin sweep | Interrupted by host stalls and worker timeouts |

The API failure is `customer-imports.spec.ts` for seller resolution on an
application-only imported row. Its assertion expects one valid row and receives
two. It remains recorded and enabled. Normal application/RA origination independently enforces the active-SM requirement
in the API and database.

The full Admin rerun was interrupted by host clock advances and Vitest worker
timeouts. It does not establish a complete final full-suite pass. Two address/network
case timeouts coincided with the first host stall. Both files passed on rerun,
28/28 tests. The final changed-workflow checks were restarted after resume and passed 115/115
across five files, including explicit ID review, permission-sensitive entry points,
frozen exports, missing historical agreement refusal and cancelled-history export. Typechecking and linting
are separate checks. Existing lint warnings are retained.

This is local technical verification. Production migration history and hosted
behavior remain unverified. Compensation, qualification and adjustment/reversal
policy require their existing financial authorizations. The work does not approve
Q13/Q15/Q16 or activate unapproved compensation. No commit, push, merge, deployment
or shared/production database write is included.


### Commission and payroll continuation QA ? 18 November 2026

The latest Claude session added required external commission payment facts
(reference, method, payment date and evidence reference), a contextual commission
detail dialog, and stable exception-first payroll ordering. The BA/PA/PB engine,
approved engagements/policies, Finance submission, separate approval, disbursement
and reconciliation workflows already existed; they were not rebuilt by that session.

Continuation verification on the current source:

- API: 139 focused commission, concurrency, operations and payroll tests passed.
- Admin UI: 70 focused commission detail/operations and payroll tests passed.
- Disposable PostgreSQL: 3,942 core checks passed, including migration 20270105000017.
- Workspace typecheck passed. Scoped lint: zero errors, two Fast Refresh warnings.
- The generated schema index now includes all 186 migration files.

Earlier session artifacts record 1,335 passing admin tests and 277 passing web
tests. The complete root unit command still failed on the existing customer-import
seller-resolution assertion (expected one valid row, received two). The full local
DB wrapper also failed in the unrelated external-import script, which expected an
application origin and received reservation. These failures were documented and
left outside this commission/payroll continuation.

Browser evidence recovered from the isolated 18 November commission stack covers
Finance recording a prepared earned commission's external payout, saved payment
facts, duplicate prevention, and seller visibility. It is not a fresh full-flow
browser proof: the fixture started earned, the observed eligibility-label problem
was repaired afterward with regression tests, and no complete mobile or seven-role
walkthrough was executed in this continuation. The recorded browser console had
setup/login, favicon and sign-out redirect errors; it was not universally clean.

Release dependency at the earlier read-only check (resolved by the later approved
application recorded below): normal localhost development points at the shared hosted
Supabase database. Read-only inspection found migration 20270105000017 absent and
none of paid_method, paid_on or paid_evidence_reference present there. New external
commission payout recording requires that migration before use on that backend.
No shared migration or financial write was performed during that read-only check.

Financial authorization remains separate: live compensation requires applicable
approved policies, engagements and performance rules. Q1's owner-reported approval
has evidence awaiting confirmation and no effective date. DRI entitlement, unresolved
adjustment/recovery rules and any separate payout-approval policy remain governed
by their existing approval requirements. Synthetic approvals establish test proof
only. This handoff does not declare production readiness or full acceptance of every
UI enhancement in the commission/payroll automation brief.


### Approved payout migration application ? 18 November 2026

Following explicit owner authorization, migration `20270105000017` was applied
first to local Supabase and then to the shared hosted backend used by normal
localhost:5174. Its three payout-detail columns, payment-fact guard, payout trigger
and browser column restrictions are verified. Existing financial and governing
policy rows were preserved. The missing-migration blocker described above is now
resolved. Full operation evidence and the exact checksum are in
`docs/supabase/MIGRATION-APPLICATIONS.md`. This application approves no compensation
values, DRI entitlement, reversal/recovery policy or new payout authority.

### Payroll and commission completion evidence - 18 November 2026

See [Financial Operations continuation QA](FINANCIAL_OPERATIONS_QA_2026-11-18.md) for the saved-calculation workspace, atomic selected-seller rate operation, test results, financial authorization boundaries and remaining browser/hosted gates.
