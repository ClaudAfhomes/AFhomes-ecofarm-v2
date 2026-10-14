# BR-CTL — Approval Locks, Corrections, Close Month, Director Actions, Referral Review, Audit Log

- Status: MIXED (all SOURCE_DOCUMENTED; implementation PARTIAL ×3, NOT_IMPLEMENTED ×3)
- Sources: A6 Parts 3/5/6 + App. A; A4 §§4–6; B2 (`HandleApproval` :386, `LockRow` :398, `UnlockRow` :508, `CloseMonth` :683, `Director*`); B4 33-function listing; B8 §4

### BR-CTL-01 — Supervisor approval stamps account+time and locks the whole row

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `A6-AFhomes_Operations_Manual-2026-09-10a.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`
- **Source location:** A6 Part 3 (review columns → Row Check clear → APPROVED stamps name + server time, locks every column incl. frozen rate and lifecycle fields); A4 §4 (approve when meant; lock covers whole row); B2 `HandleApproval` (:386), `LockRow` (:398); B4 `handleApproval`, `approveSelectedRow`
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** Set Review Status to APPROVED only when meant: the stamp is automatic and the lock covers the whole row. A receipt counts toward nothing until approved — hand over same day (A4 §3.2, A6 §2.2).
- **Rule explanation:** Taglish: aprubado — selyado; buong hanay naka-kandado kasama rate; ang hindi pa aprubado, walang bilang.
- **Formula or calculation:** Approval flag gates all downstream counting (cf. `QualFormula` approved-flag term, B2 :660)
- **Inputs:** Full row review; clear Row Check
- **Outputs:** APPROVED + account/time stamp + locked row
- **Conditions:** Every entered sale, receipt, person, payment plan
- **Exceptions:** No self-approval where the office keeps separation (A6 Part 1, C1 §5.7)
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Supervisor approves; clerks never approve (A6 Part 1)
- **Workflow:** Read whole row → Row Check clear → APPROVED → locked.
- **Current code behavior:** v2's equivalent gate is payment verification (`recorded→verified|rejected`, `20260927000003_afhomes_phase2_rpc.sql:224-352`); only verified money counts. No name+time row lock located.
- **Gap analysis:** Partial — approve-before-counting matches; stamp+lock mechanics differ.
- **Related tests:** `api/_handlers/sale-payments.spec.ts` — passed 2026-10-14 (actor-name resolution incl. missing-verifier-as-null).
- **Phase 5 source note (2026-10-14):** A2 Control Panel A12/A14 distinguish APPROVED-lock (confirmed, edits blocked, correction path open) from ARCHIVED-close (period closed + dated backup saved; changes only exceptional via Director + full re-approval); A20 requires a Reference No. before a Supervisor may APPROVE money rows — v2's reference-or-requestId requirement at record time (`sales.ts:718`) is the corresponding gate, differently placed.
- **Dependencies:** BR-QLF-01, BR-CTL-02
- **Open questions:** Q1
- **History:** None

### BR-CTL-02 — Locked-row correction needs Director unlock → clerk corrects → re-approve

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- **Source location:** Part 3 (wrong locked row: ask Director for unlock; original clerk corrects; supervisor re-approves; no workarounds); B2 `DirectorUnlockRow` (:508), `UnlockRow`; B4 `directorUnlockRow`
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** Never work around a locked row. Unlock is controlled and logged; correction is by the original clerk; re-approval follows.
- **Rule explanation:** Taglish: nagkamali sa nakakandado — Direktor ang magbubukas, ang orihinal na klerk ang magtatama, apruba ulit.
- **Formula or calculation:** NONE (controlled-correction flow)
- **Inputs:** Unlock request (sheet, row, reason)
- **Outputs:** Corrected row + re-approval + log entries
- **Conditions:** Any error found after approval
- **Exceptions:** None — workarounds forbidden
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Director unlocks; original clerk corrects; supervisor re-approves
- **Workflow:** Request → unlock (logged) → correct → re-approve (logged).
- **Current code behavior:** NOT VERIFIED — no unlock/correction flow located in v2 (void statuses exist on payments/redemptions but nothing writes redemption voids — AGENTS.md Phase 4).
- **Gap analysis:** Not located.
- **Phase 4 correction-flow finding (2026-10-14, traced sales.ts:744-817,995-1078; lifecycle.ts:223-228; commissions.ts:397-399,455; points.ts reverse/refund routes):** per-domain semantics differ and must not be unified: card payments `recorded→verified|rejected` only (verified terminal; `voided` map-permissive but unexposed — no void endpoint); sale cancel draft-only, blocked by payments/membership/commissions; commissions qualify→`cancelled` with reason, no clawback (explicitly non-invented per commissions.ts:16); operational purchases have full reverse/refund/point-refund flows with reason-required + already-reversed guards + reversal-debt blocking spend-not-earn; redemptions void unwritten. No generic void endpoint created (would invent cross-domain semantics).
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-CTL-01, BR-AUTH-01
- **Open questions:** Q1
- **History:** None

### BR-CTL-03 — Close Month writes values, refuses repeats, warns on unapproved (abort + override both logged)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` + `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- **Source location:** A4 §5.1 (settlement run order: month → reviews → audit sheet → payroll → withhold → Close Month → backup; closed month never moves; personnel changes at month start or close first); A6 Part 6 (same + rate-override column check); B2 `CloseMonth` (:683), `LedgerHasMonth`, `LedgerNextRow`; B4 `closeMonth`, `unapprovedReceipts`
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** Close Month is the FINAL, irreversible step: writes the month to the Commission Ledger as values and locks them; an already-closed month is refused; unapproved receipts trigger a warning first and both aborting and overriding are recorded (override logged as "(close override)" — A7 §1). Later rate/threshold/personnel changes apply from the current unclosed month onward. A mid-month personnel change recomputes the whole unclosed month from its start — close first (C1 §6).
- **Rule explanation:** Taglish: pagsara ng buwan — huli, hindi na mababawi; tapos na, ayaw na ng ulit; may babala sa hindi-aprubado, may tala kahit umurong o tumuloy.
- **Formula or calculation:** NONE (finalization flow; values-frozen, not formulas)
- **Inputs:** Settled month (reviews worked, receipts approved, audit rows settled, payroll reviewed)
- **Outputs:** Locked ledger month + dated backup + Backup Log entry
- **Conditions:** 5th-of-month settlement run, in order
- **Exceptions:** Close override over unapproved receipts (warned, logged — not a normal path)
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Director runs; second-person payroll read (C1 §6.4)
- **Workflow:** Approve all → reviews → audit → payroll → withhold → Close Month → backup.
- **Current code behavior:** v2 activation is idempotent (existing membership returned, no new codes — AGENTS.md Phase 2); sale snapshots immutable. No month-close/ledger concept located.
- **Gap analysis:** Partial — immutability-after-finalization principle matches; month/ledger mechanics absent.
- **Related tests:** `api/_handlers/phase2.spec.ts` (idempotency) — passed 2026-10-14.
- **Dependencies:** BR-REV-01/02/03, BR-AUTH-01, BR-CTL-01
- **Open questions:** Q1
- **History:** None

### BR-CTL-04 — Eleven Director actions under one password per action, all logged

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** A4 §6 (Set Parameter, Set Person Rate, Unlock Sale Rate, Override Closed Deal Date, Unlock Row, Close Month, Review Qualifying Period, Review below-target streak, Show/Hide Log — plus approve/close-month/review flows = eleven; Alt+F8 / Controls menu; inflation-direction warning); B8 §4 (same eleven on both platforms; `Override Closed Deal Date` ADDED LATE to AFhomes Excel — present both since BUILD 2026-09-10a); B2/B4 procedure listings verified (B2 57 procs incl. all eleven; B4 33 functions)
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** Each action asks the Director password and records what it did; the Finance Director holds the Deployment Plan and knows the eleven actions (C1 §5.6).
- **Rule explanation:** Taglish: labing-isang gawain ng Direktor — bawat isa, may password at may tala.
- **Formula or calculation:** NONE (console inventory)
- **Inputs:** Director password per action
- **Outputs:** Logged administrative effects
- **Conditions:** Installed Rev E / Apps Script v2.1 (see BR-OPS-03)
- **Exceptions:** None documented
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Director/Finance Director only
- **Workflow:** Alt+F8 or Controls menu → password → action → log.
- **Current code behavior:** NOT VERIFIED — no Director console in v2 (admin console has role-gated screens, different model).
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-AUTH-01, BR-CTL-03
- **Open questions:** Q1
- **History:** None

### BR-CTL-05 — REFERRAL RIGHT—REVIEW: sale referred >1yr after referrer's latest accreditation → Director decision, not blocked

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- **Source location:** App. A warning table (REFERRAL RIGHT — REVIEW); NO C2 ruling located — guide + manual only
- **Source authority:** UNKNOWN (operational manual v1.0; no memorandum citation found)
- **Original rule:** A sale referred more than a year after the referrer's latest accreditation raises a Director decision. Amounts are not blocked.
- **Rule explanation:** Taglish: lumang akreditasyon ng nag-refer, bagong benta — desisyon ng Direktor, pero hindi hihinto ang halaga.
- **Formula or calculation:** Referral date − latest (re-)accreditation date > 1 year → flag (B8 §1 col AP falls back to col E when blank — staleness caveat)
- **Inputs:** Referral date; referrer's latest (re-)accreditation
- **Outputs:** Warning flag; Director decision recorded
- **Conditions:** Referral rows breaching the 1-year span
- **Exceptions:** Decision does not block amounts
- **Effective dates:** NOT EVIDENCED (manual v1.0, 21 Aug 2026 per cover)
- **People and permissions:** Director decides
- **Workflow:** Flag → Director decision → proceeds unblocked.
- **Current code behavior:** NOT VERIFIED — no referral-age check located in v2.
- **Gap analysis:** Not located; weakest authority in this file (no C2/B8 backing).
- **Related tests:** None; NOT RUN.
- **Dependencies:** None
- **Open questions:** Q1; authority for this warning (no ruling located)
- **History:** None

### BR-CTL-06 — Six-column audit log, Excel/Sheets reconciled row-for-row

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** §4 (Apps Script log now carries Timestamp, User, Sheet, Cell(s), Old Value, New Value — same six as Excel Audit Log; before: four columns with `(close override)` glued into one cell and month dropped, unreconcileable); B2 `LogIt`, `AuditChange`, `AuditConfigChange`, `ShowAuditLog`/`HideAuditLog`; B4 `log`, `ensureLog`, `showLog`, `hideLog`
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** Both platforms log the same six columns so the two audit trails reconcile row for row.
- **Rule explanation:** Taglish: anim na hanay ang tala — pareho sa Excel at Sheets para magtugma bawat hilera.
- **Formula or calculation:** NONE (log schema)
- **Inputs:** Every Director action + approval + freeze event
- **Outputs:** Comparable audit trails on both platforms
- **Conditions:** Always on
- **Exceptions:** None documented
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** System-written; Director views via Show/Hide Log
- **Workflow:** Action → six-column row → cross-platform reconciliation.
- **Current code behavior:** v2 appends `audit_events` (AGENTS.md Phase 1: append-only) with sanitized payloads (`api/_lib/audit-sanitize.spec.ts` exists). Different schema; cross-platform reconciliation N/A.
- **Gap analysis:** Partial — append-only audit principle matches; six-column schema absent.
- **Related tests:** `api/_lib/audit-sanitize.spec.ts` — passed 2026-10-14 (135-test batch).
- **Dependencies:** BR-AUTH-01
- **Open questions:** Q1
- **History:** None
