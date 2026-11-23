# Financial Operations continuation QA - 18 November 2026

## Implementation

Continues claud/supabase; no prior phase restarted. Claude added commission payment facts, contextual review and exception-first payroll sorting. The governed BA/PA/PB engine already existed.

This continuation adds:

- Permission-gated inspection of saved payroll calculations: engagement dates, QP/EP days, KPI/collections, policy/rule references, original payment evidence and review/payment history.
- Policy parameters captured on new live draft calculations. Older approved lines remain unchanged and disclose missing historical parameters.
- Payroll summary cards, employee search, position/status filters, contextual actions and draft-only Refresh calculations.
- Payment verification refreshes payroll/commission queries. Disbursement forms prevent future dates and dismissal while saving.
- Commission amounts summarized for displayed records, explicitly identifying overlapping eligibility/later-stage totals.
- Missing POST /commissions/rules/bulk handler and migration 20270105000018: atomic selected-seller rate configuration, audit history, safe retries and serialized writes. The migration installs no rate and changes no frozen sale/commission.

## Payroll flow

1. Eligible IST employee with approved engagement, applicable compensation policy and performance rule; QP BA decision where required.
2. Verified evidence produces KPI and eligible collections; exact-decimal calculation of BA, PA and PB.
3. Finance generates or refreshes a draft and resolves configuration/review exceptions.
4. Finance submits; a separate authorized approver approves. Both stages revalidate evidence.
5. Finance records an externally completed payment with method, date, reference and proof. The system transfers no money.
6. Changed evidence requires authorized reconciliation; an authorized closer closes the batch.

Customer receipt entry accepts actual amounts and purpose. Payroll payments use approved net entitlement; partial payroll and entitlement adjustments need policies that engineering cannot invent.

The earlier hosted inspection found no compensation policies, engagements or batches. Q1's owner-reported decision is separate from approval of compensation values and performance rules. Synthetic approvals are never production authorization.

## Verification

- API: 230 focused tests passed across payroll, IST evidence, commission operations/concurrency and Phase 2 handlers.
- Admin: 143 focused tests passed across payroll, commission detail/settings and Finance lifecycle.
- Workspace typecheck: seven tasks passed.
- Admin build passed; existing large-chunk warning remains.
- Scoped lint: zero errors, one existing Fast Refresh warning.
- Disposable core PostgreSQL: 3,944 checks passed, including migration ordering, financial invariants and rollback-only bulk configuration.
- Managed local Supabase: 14 bulk-rule assertions, two-session serialization and actual API retry passed. Frozen sales/commissions unchanged.
- Managed local Supabase: 10 saved-payroll checks passed. Finance and Super Admin read original net 380.00 and source evidence; IST was refused. Reads changed no financial facts.
- Earlier complete synthetic positive workflow: approved-for-test engagement/policy/rule, verified evidence, BA 100.00 + PA 200.00 + PB 100.00 = net 400.00, Finance submit, separate approval, external payment and close (48 assertions). Advanced QP fixture: 93.33 + 186.67 + 100.00 = 380.00, later evidence change, reconciliation and immutable approved amount (43 assertions). These historical artifacts are not fresh browser walkthroughs.

## Q15(a) and financial integrity

Migrations 20270105000010 through 20270105000015 preserve verified receipt values/metadata/links, frozen sale attribution, completed commission decisions, payroll inputs and accounting snapshots. Financial writers serialize with payroll/month-end decisions. Submission and approval reject stale evidence. Corrections require traceable events rather than editing original receipts.

Q13/Q15 reversal effects, returned-cheque/refund accounting, recovery offsets, DRI entitlement, rule-transition treatment and unresolved eligibility assumptions remain governed. Adjustment proposals are not automatically deducted. No real policy decision was approved here.

## Remaining failures and unverified checks

Resolved the customer-import API test fixture: its seller-denial case used an application-only row, which intentionally skips sale-seller resolution. The case now uses a payment-bearing row and asserts that only that row reaches seller validation. The application-only test asserts no seller RPC. All 35 import-handler tests passed; the complete API suite passed 3,300 tests across 169 files. No import business behavior was changed by this test repair.

The earlier full DB wrapper failed its separate external-customer-import script: expected application origin, received reservation. The core suite was run directly; the full wrapper is not claimed passing.

Fresh browser/mobile/console acceptance is NOT VERIFIED. Browser host unavailable; native Chrome repeatedly refused input with "window bounds changed; call get_window_state before using this window", including after fresh state/screenshots. No real financial action attempted. Earlier partial commission browser evidence had setup/login, favicon and sign-out errors and does not prove a clean console.

## Git, migrations and activation

Repository manifest: 188 ordered migration files. Migration 17 was explicitly authorized and verified locally and hosted. Following explicit authorization, migration 18 is now applied and verified on hosted Supabase as well as disposable local Supabase. Hosted history increased 183 to 184; all existing records across 107 public/private application tables were preserved. PostgREST recognizes the operation. Dependencies: existing commission_rules schema and private.mutation_actor_role. It installs a function/grants only; no rates, compensation approvals or existing financial rows change.

Normal pnpm dev on localhost:5173/5174 still uses this checkout and its original hosted backend. It was not switched to synthetic users. Payroll UI/API changes are local and hosted Supabase now contains migration 18 for bulk commission configuration.

Existing dirty work and staged deletions of GlobalSearch.tsx, GlobalSearch.spec.tsx and MyWorkToday.tsx are preserved. No commit, push, merge or application deployment.

Payroll implementation and backend flow work with approved test configuration. Financial authorization and fresh browser/mobile acceptance remain separate release gates. Production readiness is not claimed.



## Subsequent browser inspection and sign-in correction

A later native Chrome session reached the disposable Finance app and found a real sign-in rendering defect: ScrollToTop passed an authentication fragment into document.querySelector. Invalid CSS caused an exception and included the synthetic sign-in fragment in the console message. The shared component now looks up decoded element IDs, keeps malformed fragments literal and never parses fragments as CSS. Six focused tests passed, including sign-in fragments, encoded IDs and invalid fragments. Both Admin and Web use this component. Admin now declares its existing logo as its favicon.

After the hot reload, Chrome visibly rendered the synthetic Finance dashboard and November closed payroll. The saved batch showed BA 93.33, PA 186.67, PB 100.00, net/recorded payment 380.00, outstanding 0.00, zero attention items and the recorded discrepancy review. This is partial fresh browser proof, not a new positive payment walkthrough.

The closed table also displayed an unavailable Record disbursement button on a zero-net line. It now shows a read-only payment state when nothing is payable or the viewer has no recording action. Positive payable lines retain their authorized action. The payroll table/page regression run passed 50 tests.

Further browser actions were stopped by URL-confidence checks. A session reset and extension-browser inventory retry still returned 'The browser access host is unavailable'. Chrome extension reconnection is pending; remaining action, mobile and full console acceptance are not claimed. These source-only fixes require no database migration. Existing staged deletions and all business-policy gates remain preserved.


Follow-up verification: all 251 shared UI tests passed, the 50 payroll tests passed, all seven workspace typecheck tasks passed, and the Admin production build passed. The compiled HTML references the emitted logo favicon under /admin/assets/. Scoped lint has zero errors and one existing Fast Refresh warning. The user reported the Chrome extension connected, but both browser inventory and selecting the localhost tab still returned browser access host unavailable in this chat. Reopening in a new Codex chat with the localhost tab attached is the remaining supported connection-recovery step. Continue browser acceptance using synthetic local accounts/data; never turn test policy fixtures into hosted compensation authorization.


## Final continuation: API suite and imported application review stage

The full API suite is green: 3,300 tests across 169 files. Migration 20270105000019 corrects only imported next-step classification: the immediate provisional RA must not make a draft/submitted application bypass the combined Application & RA approval screen. Three new database assertions check application stage, the unchanged linked RA and the correct application review path. Migration ordering/replay, 72 workflow assertions, 27 concurrency assertions, all 3,944 core database checks and workspace typecheck passed.

The migration is applied to managed local and hosted Supabase under the owner's migration authorization. Hosted history is now 185 entries. Existing records across all 107 application tables and all RLS/EXECUTE restrictions were preserved. The ordinary localhost backend therefore receives this fix as well.

At that checkpoint, the external-history DB suite remained FAIL (resolved in the 19 November continuation below). The original application-versus-reservation assertion is corrected, but its older paid-history writer then attempts a second RA (RESERVATION_ALREADY_EXISTS). Aligning that writer also intersects the executed-agreement requirement before payment insertion; no guard was weakened, no unapproved execution was invented, and the experimental write-path change was discarded. This remaining import incompatibility is documented rather than disguised as a passing test. Browser actions, mobile layout and complete console acceptance still await a working browser connection. No new production-readiness claim is made.


## 19 November continuation: reservation claims require combined approval

The owner confirmed that an externally certified Reservation Paid import must pass normal combined Application & RA approval before Finance. Migration `20270105000020_afhomes_external_import_coordinated_reservation.sql` now enforces this for new, unaccepted claims. Intake retains source facts and payment claims, records one approval-required audit event, and reports unverified money. It does not fabricate approval, execute an agreement or post a verified payment. Already accepted historical receipts retain their existing treatment and payment values.

The legacy paid-history writer now reuses the provisional unfunded RA through the existing guarded draft synchronizer. It no longer attempts a second agreement. When Finance explicitly records a reviewed claim, the existing receipt-details function preserves its original payment date. Recording still leaves verified totals unchanged; separate verification is required. Historical terms that differ from the current commercial offer still require review; this migration does not invent a resolution or change the offer.

Fresh proof: the complete external-import suite passed all 30 tier/status combinations, source conflict and duplicate checks, a two-connection retry of the approval-required intake, unauthorized requests, and the complete deferred GOLD reservation claim path. That path includes application completion, confirmed identity fixture, both signed documents, one combined approval, receipt object, claim recording, original date, duplicate retry and verification. An accepted-history fixture preserved its original payment rows. Existing normal-payment fixtures were corrected to meet current seller, identity, RF and combined-approval prerequisites; no production guard was weakened.

All 3,944 core database checks passed. Workflow proof passed 72 assertions, 27 concurrency assertions, 189-migration ordering/replay and zero RLS violations. The import continuation UI passed nine tests, including the unverified claim label and application destination. All seven workspace typecheck tasks passed.

The exact tested migration is applied to managed local and hosted Supabase. Hosted history increased 185 to 186; records across all 107 public/private application tables were preserved. Four hosted function definitions and EXECUTE ACLs match tested local definitions. An independent read-only post-commit verification passed. The two existing platform cron RLS findings remain unchanged, with no AF Homes violations. Normal localhost uses the original hosted backend; no environment switch, real import, rate change, compensation approval or payment was performed.

Current remaining gates: browser/mobile/full-console acceptance remains unverified because the attached browser page is empty and the connection is unavailable. Financial policy approvals remain separate from these technical tests. Existing dirty work and the three staged deletions remain preserved; no commit, push, merge or application deployment was performed. The previously failing external-import suite is now resolved; the complete wrapper was not rerun as a single command, although its core and external suites both passed independently with this migration.


## 19 November browser/device QA (fresh observations)

**Browser access.** The Playwright MCP server failed to connect (CONNECT_TIMEOUT after 30000 ms). As a workaround, `playwright-core` was installed outside the repo (session scratchpad) and drove the locally installed Chromium 1243 headless. The earlier native-Chrome "browser access host unavailable" blocker no longer applies to this evidence.

**Target.** Disposable local stack only: Admin 127.0.0.1:5974, API 127.0.0.1:5900, local Supabase 59321/59322 (migrations through 20270105000020 already present). Fresh synthetic Finance, Super Admin and IST (Sales Manager) accounts created for this run; no credentials recorded here. Normal `pnpm dev` (5173/5174, hosted Supabase) was not touched. No hosted write.

**Coverage.** 3 roles x 15 routes x 4 viewports (desktop 1440x900, tablet 768x1024, mobile 390x844, mobile 320x640), real Supabase sign-in, 183 page loads. Screenshots were taken at desktop and 320 wide. Console errors/warnings, page errors, failed requests and HTTP >=400 captured per load.
- Horizontal overflow: none at any viewport.
- Roles routed to correct portals (Finance `/finance/...`, IST `/sales/...`, Super Admin `/admin/...`). Finance: payments, payroll, commissions, activation, month-end, applications, reservations render; staff/roles/import-export show Access denied. IST: payroll, payments, activation, month-end, import-export, staff, roles show Access denied; Commission Settings shows a permission message with no actions.
- Audit, Reports and CMS show Access denied even for Super Admin because `FEATURE_FLAGS` in `packages/shared/src/features.ts` disables them deliberately. Not a defect; do not report as one.
- Only other network noise: one aborted `/api/v1/analytics` request on navigation (benign cancellation).

**Defect found and fixed.** Finance opening Commission Settings (`/admin/finance/commissions/settings`) hit "Maximum update depth exceeded" and the page never settled. Cause: for the Finance portal both that redirect-only bookmark twin and the canonical `/admin/commissions/settings` map to `/finance/commissions/settings`; the twin was declared first, redirected to `/admin/...`, and the portal canonicalizer sent it back. Fix: canonical route now declared first in `apps/admin/src/app/App.tsx`, with a comment. Regression test added in `app/role-routes.spec.tsx` (8 tests pass). Rechecked in the browser: Finance lands on the page after 2 navigations, no console error. Limitation: the test proves the route-resolution contract, not App.tsx order itself; the browser recheck covers that.

**API authorization (fresh, direct calls, 20 endpoints x 4 principals).** No token: 401 everywhere. IST: 403 on every payroll, commission, period and payment action. Finance: refused approving policies/engagements/rules/batches, closing batches/periods, commission rule configuration and reading rules. Super Admin allowed. Validation (400) and not-found (404) only appear after the permission check. Note: two probes wrote to the disposable DB (draft batch and submitted accounting period for 2026-08, zero net); these are synthetic and local.

**Not completed: fresh end-to-end payroll walkthrough.** Attempt: new synthetic fixtures for period 2026-09. Superadmin approval of a new synthetic engagement was refused with `IN_USE_BY_FINALIZED_PAYROLL` (409): the disposable database already has closed live payroll for 2026-10 and 2026-11, and the immutable-history guard rejects retroactive engagement changes. This is the safeguard working; it was not bypassed. A fresh positive run needs a fresh disposable database, or a period after the last closed one that is not in the future. Browser-driven Submit/Approve/Record/Close/reconciliation was therefore NOT observed in this session. Earlier evidence stands as earlier evidence only: 48-assertion and 43-assertion API/DB workflows, and the earlier partial browser view of the closed November batch.

**Also not done this session:** browser walkthrough of the Reservation Paid import through combined approval and Finance (covered earlier only by DB/API suites and nine UI tests), dialog-level mobile checks, and dedicated IST payroll-UI negative checks beyond route denial. Not claimed.

**Technical vs financial authorization.** Everything above is technical QA with synthetic fixtures. No Q13/Q15 policy, historical BA/PA/PB value, PB rate, DRI entitlement, 25% Closed Deal threshold, automatic release at 40%, clawback recovery or refund/reversal authority was approved or activated. Outstanding owner decisions with required evidence: (1) dated, signed approval for the live compensation policy values per rank (BA/PA/PB amounts, targets, PB rate, collection gate) and effective date; (2) approved performance rule (attribution basis, count date basis, Closed Deal threshold, assumed-credit treatment, adjustment treatment); (3) Q1 documentation evidence behind the owner-reported Option C; (4) Q13/Q15 reversal, returned-cheque, refund and recovery-offset terms; (5) DRI entitlement terms. Working software and passing tests are not approval.

**Local vs hosted.** All results above are local. No hosted verification was performed this session. No commit, push, merge, deploy or migration was run; staged deletions and other dirty work are untouched.


## Developer continuation: actionable payroll configuration

The user authorized live payroll activation and asked developers to finish the software. A fresh read-only hosted inspection found the Q1 compensation-model gate already marked approved, source owner_reported, Option C, evidence awaiting and no effective date. Hosted compensation policies and performance rules were both empty. There is no additional global developer switch to remove; company configuration is absent. This instruction supplies activation intent, not numeric salaries, targets, rates or a performance-rule definition.

The live payroll empty/blocked state now provides direct Review compensation policies and Review engagements and rules buttons, using the existing tabs and approval forms. Configuration no longer requires following an explanation and searching for the correct tab. These actions only navigate; they do not save rates, approve policies or submit payroll. Existing Finance drafting and Super Admin approval remain enforced by the server. Company values can be entered in the application without sending salaries through chat.

Verification: 52 payroll page/table tests passed, including empty-month policy navigation, blocked-draft engagement/rule navigation and assertions that neither action sends a POST. Admin typecheck passed. This is a local source change with no migration or hosted write. No compensation values, real payment or historical financial record changed. Fresh end-to-end browser acceptance is still separate from these UI regression checks.


## 19 November: payroll warnings and Month-End screen correction

Payroll now presents one short blocked-line count and keeps the complete configuration reasons under a closed-by-default disclosure. Combined reason strings translate known internal tokens through the existing labels or retain their supplied explanation. Owner-reported compensation context remains available in a separate compact disclosure. The summary says Not calculated when no staff line was calculated; it does not portray missing setup as a completed zero payroll. Existing configuration links and server-side approval guards remain intact.

Month-End now uses a wider responsive summary grid, with closing controls above the figures, consistent green links, a separate closing-checks panel and collapsed period history. Missing-evidence warnings link to payment review, pending verification/adjustments link to Finance and open-payroll warnings link to payroll. Warnings remain non-blocking according to the server response; this change neither supplies missing evidence nor changes the accounting rules. A Refresh action and conservative polling update the displayed checks across sessions.

A real client defect was corrected: failed or pending readiness requests previously left submission enabled and were not displayed. Closing controls now require successful readiness checks; closing also waits for approval history. Retry is visible, and the confirmation remains tied to its selected month. Pending mutations prevent dismissal and duplicate confirmation. The server remains the authoritative decision boundary.

Proof: 70 targeted payroll/month-end/table tests passed, including blocker disclosure, readable reasons, uncalculated state, warning links, action order, readiness failure/recovery, disabled closing, confirmation/month consistency and existing role/close-history cases. Admin typecheck and build passed. Scoped lint passed with zero errors and the existing Fast Refresh warning on the helper export. The normal localhost:5174 dev server was independently checked and serves the updated MonthEndClosePage and IstPayrollPage modules. Fresh visual/mobile browser review remains unverified: Computer Use inventory still reports browser access host unavailable. Responsive CSS is implemented, without claiming fresh visual acceptance. No migration, hosted data write, commit, push or application deployment occurred; staged deletions remain unchanged.


## Configurable compensation reference templates

The existing payroll policy workflow now supports historical rank templates, editable percentages/currency, new-version drafts, rank summaries, history and simulation reference loading. These do not activate payable policies. See [the scoped implementation report](IST_PAYROLL_POLICY_TEMPLATES_2026-11-19.md) for exact source values, tests, files, configuration and the unrelated Admin typecheck/build failure. No shared database write or migration was performed.


## 19 November: fresh isolated stack, end-to-end browser walkthroughs

**Target.** A NEW disposable local stack created for this run only: Admin 127.0.0.1:5984, API 127.0.0.1:5910, local Supabase 56321/56322, all repository migrations applied (189 files). The earlier disposable stack (5974/5900/59321/59322) and its closed payroll history were not touched. Normal `pnpm dev` and hosted Supabase were not touched; no hosted write. Synthetic accounts (Super Admin, Admin, Finance, SM, SSM, SVD) and a synthetic SM->SSM->VD hierarchy; all policy/engagement/rule records are labelled TEST ONLY with no production authority. Browser: `playwright-core` driving local Chromium (the Playwright MCP server still fails with CONNECT_TIMEOUT). No credentials are recorded here.

One test-only fixture change on the new stack: the `finance.payroll_policy` permission (view/create/update) was granted to the `finance` role, because the earlier custom test role cannot sign in through any portal (the portal resolver only accepts known role slugs; by design). Standard Finance in the repository seed is unchanged.

### Reservation Paid import -> combined approval -> Finance (observed in the browser)
1. Guided XLSX import as Admin, "externally verified" left unchecked: only the customer was created; no application, RA or payment existed after import (DB-checked).
2. "Create Application & RA" wizard (7 steps), acknowledgement date 2026-10-16, Move A, Driver's License with synthetic ID PDF, Admin chose the SM seller of record, certification ticked -> draft saved with RA number 2026-0001.
3. ID review confirmed, then **Submit for Approval** -> `submitted`.
4. Signed Application Form and Signed Reservation Agreement uploaded; each was accepted by its uploader (allowed by the confirmed rule).
5. **Approve Application & RA** double-clicked: exactly one `POST .../decision`; application `approved`; exactly one RA (`executed`, origin `application`, seller = SM).
6. Before recording: no payment rows. Finance queue showed "No Verified Payments", balance PHP 312,000.00.
7. Finance "Record & verify payment": amount 10,000.00, payment date 2026-10-16, receipt uploaded to the private receipts bucket, review step showed balance 312,000.00 -> 302,000.00. Final button double-clicked: one record POST and one verify POST. DB: one payment, `verified`, `reservation_fee`, `paid_on` 2026-10-16 (original date kept), `posting_period` 2026-11 (shown as a late posting).
8. Reusing the same receipt file for the next payment was refused (409 "This receipt was already used for another payment").

Note on the requested "separate payment verification": the current, user-confirmed rule is that Finance records and verifies in one flow. The UI does exactly that (two API calls, one action). No separate verifier step exists to test.

### Payroll walkthrough (observed in the browser)
- Pre-existing TEST ONLY fixtures on the new stack: SM and SVD engagements (contract start 2025-01-01), SM/SVD policies (BA 100.00 / target 1,000.00, PA 200.00 / 1,000.00, PB target 1,000.00 @ 0.01, collection gate 0.40, from 2026-10-01) and performance rule v1 (seller only, 25% closed-deal threshold, paid-on count date). These synthetic numbers exist only to exercise the arithmetic.
- In the browser this run: Finance drafted the SSM policy and the SSM engagement and submitted each; Super Admin approved each with an evidence reference (a different account from the submitter).
- Evidence: two further verified installments of 75,500.00 dated 2026-10-20 and 2026-10-25. October evidence for the SM: 3 payments, KPI 312,000.00, collection 161,000.00, each with its original paid-on date.
- Generate draft (double-clicked): one batch. Draft at that time: BA 100.00, PA 200.00, PB 2,137.50, net 2,437.50 = 1% x min(312,000; 85,500 / 0.40).
- **Stale evidence:** after the 2026-10-25 payment was verified, the draft kept its old figures and its old SSM block, and **Submit for approval was disabled**. Refresh calculations gave BA 100.00, PA 200.00, PB 3,120.00 = 1% x min(312,000; 161,000 / 0.40), net **3,420.00**. Hand-checked against `packages/shared/src/ist-payroll.ts`.
- Submit (double-clicked): one `POST .../submit`. Super Admin **Approve**: one POST; DB shows submitter != approver and creator != approver.
- Finance **Record disbursement**: the amount field is read-only and taken from net pay (3,420.00); the button stays disabled until the bank and proof references are valid. Double-click: one `POST .../disbursements`. Synthetic external payment only; nothing was sent to any bank.
- Only Super Admin sees **Close batch**; Finance does not. There is no separate reconciliation button: the close step is the reconciliation. After closing and reloading: "Closed ... history is read-only", and no Record or Close actions remain.
- DB: batch 2026-10 `closed`, totals BA 100.00 / PA 200.00 / PB 3,120.00 / net 3,420.00; SM line 3,420.00, SSM and SVD 0.00; one disbursement for 3,420.00.
- Audit: PAYROLL_BATCH_CREATED 1, LINES_REPLACED 3, SUBMITTED 1, APPROVED 1, DISBURSEMENT_RECORDED 1, DISBURSEMENT_PROOF_RECORDED 1, CLOSED 1.
- **Closed-period guard:** Super Admin tried to end the SM engagement on 2026-10-15 and got a 409: "This engagement already backs an approved or closed payroll month, so it cannot be changed that way". The engagement is unchanged. The guard was not bypassed.
- A November 2026 batch was also generated and submitted. It nets 0.00 because no closing payment falls in November. It remains pending approval in the disposable DB.

### Mobile dialog checks (390x700 and 320x700)
For each dialog the check covered: horizontal overflow, whether the dialog fits the viewport, vertical scrolling, field width and clipping, whether the last action can be reached by scrolling, Tab focus and Escape.
- Dialogs checked: payment recording, payroll line details, payroll evidence, new engagement, new policy, Create IST, Create OST. All passed at both widths: no horizontal overflow, the dialog is the full viewport width, the body scrolls, no field is clipped, and the primary action (Next / Close / Save draft / Create / Create and accredit) can be scrolled into view. Escape closes.
- The application detail and approval page at 390 and 320: no overflow, and the record actions can be reached.
- **Not observed on mobile:**
  - Payroll disbursement dialog. No approved batch with a payable line remained after closing, and the November batch nets 0.00. The dialog was observed at desktop width only.
  - Application approval confirmation. Approval posts directly; there is no confirmation dialog.
  - ID-review dialog. The application had already been reviewed.

### Defects found and fixed this run
1. **Dialog focus (shared `packages/ui/src/hooks/useDialogShell.ts`).**
   - Symptom: when a dialog opened, focus moved inside it and then, about 4 ms later, returned to the trigger behind the modal. Tab then moved through the page behind the dialog. On the policy, Create IST and Create OST dialogs, only 1 or 2 of 8 Tab presses stayed inside the dialog.
   - Cause: under React StrictMode the first effect runs, is cleaned up and runs again. The cleanup's focus restore moved focus back to the trigger, and the separate initial-focus effect was skipped on the second run. Separately, the Tab trap only wrapped at the first and last element, so focus that had left the dialog never came back.
   - Fix: initial focus now happens inside the same effect, after the trigger is captured. A Tab press while focus is outside the panel pulls it back in.
   - Tests: two new tests in `useDialogShell.spec.tsx` failed before the fix and pass after it.
   - Browser recheck: focus starts and stays inside the Create OST dialog.
   - Verification: UI package 253 tests passed; Admin suite 135 files / 1,359 tests passed; UI typecheck passed. `packages/ui` has no lint script.
2. **Saved seller of record ignored on reopen** (`official-forms-applications.tsx`).
   - Symptom: an Admin or Super Admin reopening a draft that already had `sm_staff_id` saw an empty seller picker. "Choose the active Sales Manager…" blocked submission.
   - Fix: the picker now loads the saved seller, only for creators who must name one. An SM creator still sends nothing.
   - Tests: two tests in `application-actions.spec.tsx`. The saved-seller test fails when the fix is disabled; the no-seller case still blocks.
   - Browser recheck: the blocker is gone after reload.
3. **Commission Settings regression test strengthened.** `authorization.regression.spec.tsx` now resolves `/finance/commissions/settings` and `/admin/commissions/settings` against the route tree that the real `App` declares, using react-router `matchRoutes`. It asserts that the matched page is not a `<Navigate>`. The App.tsx route order was reversed temporarily: the Finance case failed. The order was then restored. The browser recheck from the earlier section remains separate evidence.

### Observations (not fixed)
- A page error, "useSession must be used within SessionProvider", appeared once. It happened while other sessions were editing `IstPayrollPage.tsx` and related files, which triggered Vite hot reloads. Two clean reloads did not reproduce it. This is treated as a dev-server hot-reload artefact, not an application defect.
- An external hero image (`/photo-1470071459604-...`) logs ERR_ABORTED during navigation. This is a benign cancellation.
- Imported last names keep their mixed case ("QaBImport"). Saved names elsewhere are UPPERCASE.
- Text checks for the earlier copy items ("one transaction per row?", the Purchase reference mismatch) were not repeated.

### Financial authorization (unchanged)
Every number above is a synthetic test fixture on a disposable local database. Approving it authorized nothing for production.

Still required from the owner, with dated evidence:
1. Signed approval of the live compensation values per rank (BA/PA/PB amounts, targets, PB rate, collection gate) and their effective date.
2. An approved performance rule (attribution, count-date basis, Closed Deal threshold, assumed credit, adjustment treatment).
3. Q1 documentation behind the owner-reported Option C.
4. Q13/Q15 reversal, returned-cheque, refund and recovery terms.
5. DRI entitlement terms.

Nothing was committed, pushed, merged or deployed. No migration was applied to any shared or hosted database. The staged deletions are untouched.
