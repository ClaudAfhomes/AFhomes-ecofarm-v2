# BR-DUAL — Dual Engagements, Transfers, Chain Integrity, Back-Dated Dates

- Status: all SOURCE_DOCUMENTED / NOT_IMPLEMENTED
- Sources: C2 §4A (R25–R26) + §5 RV-38–40; A4 §8–9; A6 §5.6/App. A; B8 §1 (cols BL/BM/L/O/BC/BD)

### BR-DUAL-01 — Dual engagement is two accreditation rows with link column and three warnings

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §4A, R25; RV-38 (distinct numbers, no collision, per-team production; unlinked duplicate-name warning; same-team warning); A4 §8; A6 §5.6 table; B8 §1 (BM link input; BL check); A7 §4 (duplicate-name Accreditation L; link BM; checks BL)
- **Source authority:** Management rulings 21 Aug 2026. System key is the ACCREDITATION NUMBER, not the person.
- **Original rule:** A second role in a different team is a second accreditation row: different numbers, each team sees only its own production, each role carries its own targets/allowances/obligations; reduce one row's BA where appropriate. Link column (BM) records the pairing. Warnings: duplicate name unlinked; link points nowhere; both roles in one team (a genuine dual engagement never sits in one team). A TRANSFER is different: change the existing row's uplines + appointment date — never open a second row or the old post keeps producing KPI.
- **Rule explanation:** Taglish: dalawang tungkulin, dalawang hanay — magkaibang numero, magkaibang kota; itala ang ugnayan; ang lipat, ayusin ang hanay, huwag dagdagan.
- **Formula or calculation:** NONE (identity/routing rule)
- **Inputs:** Two accreditation rows; link numbers; team assignments
- **Outputs:** Separated production/KPI/allowances per row; warnings as applicable
- **Conditions:** One person engaged in two roles in two teams
- **Exceptions:** Same-team dual rows warn (never genuine); transfers mutate instead of duplicating
- **Effective dates:** 2026-08-21
- **People and permissions:** Clerk enters rows + links; Director reduces one row's BA if intended
- **Workflow:** Second role → second row + link → per-team figures separate → warnings cleared or confirmed.
- **Current code behavior:** NOT VERIFIED — no dual-accreditation-row concept located in v2 (one staff user, role assignments; link column absent).
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-DUAL-02
- **Open questions:** Q1
- **History:** None

### BR-DUAL-02 — BROKEN CHAIN warns (never blocks); sub-team moves change every upline column

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`
- **Source location:** C2 §4A R26 + RV-39 (change one upline column only → BROKEN CHAIN on affected rows; correcting clears); A4 §7 (move procedure) + §9; A6 §5.6; B8 §1 col BL
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** Reassigning a sub-team by changing one upline column and leaving the one above unchanged produces a chain where a person's recorded leader sits under a different leader than their own record names. Nothing breaks — the danger: production flows silently to the wrong leader while every figure looks ordinary. Both workbooks flag it as a warning, not a block, because managing a sub-team across two teams can be deliberate.
- **Rule explanation:** Taglish: kapag naglipat ng grupo, lahat ng hanay ng pinuno ayusin — kapag isa lang, may babalang BROKEN CHAIN; hindi hihinto, pero aayusin o kumpirmahin.
- **Formula or calculation:** NONE (integrity check)
- **Inputs:** Upline columns per row (SM/SSM/SVD numbers)
- **Outputs:** BROKEN CHAIN warning on disagreeing rows, or clear
- **Conditions:** Any upline reassignment
- **Exceptions:** Deliberate cross-team management confirms the warning instead of correcting
- **Effective dates:** 2026-08-21
- **People and permissions:** Clerk moves columns; supervisor/Director confirms or corrects
- **Workflow:** Change all upline columns → check clears; partial change → warning → correct or confirm deliberate.
- **Current code behavior:** NOT VERIFIED — no chain-agreement check located in v2 (`correct_referral_upline` maintains the relation; disagreement flagging not evidenced).
- **Gap analysis:** Not located.
- **Related tests:** `phase7-genealogy-migration.spec.ts` — NOT RUN.
- **Dependencies:** BR-DUAL-01, BR-ACM-04
- **Open questions:** Q1
- **History:** None

### BR-DUAL-03 — Back-dated engagement dates accepted; 12mo+ reads CONTRACT ENDED; overdue QP review expected

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`
- **Source location:** C2 §4A R26 + RV-40 (8 months back → month 9 of 12, skips first period; 14 months back → CONTRACT ENDED; both raise overdue first-period decision, expected); A4 §8 (experienced hire: enter actual date; NEW one-year agreement → enter agreement start, service length separately); A6 §5.6; A4 §9 (`CONTRACT ENDED`: renew/close; allowances NOT auto-stopped); C1 §1.5 (record carried-over first-period review as passed)
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** An experienced hire should not serve a fresh first period: the entered date is their actual start and the period counter follows it — expect an at-once overdue first-period decision (record as passed on earlier service) and, past twelve months, a CONTRACT ENDED reading. Where a NEW one-year agreement is signed, enter that agreement's start (not original service date) or the workbook reads the contract as ended; record length of service separately.
- **Rule explanation:** Taglish: beterano, tunay na petsa ang ilagay — tatanggapin kahit luma; lalabas ang overdue review (ipasa batay sa dati) o CONTRACT ENDED (baguhin kung bagong kasunduan).
- **Formula or calculation:** Period counter follows entered date; >12 months → ENDED branch
- **Inputs:** Entered engagement date; agreement start (if renewed)
- **Outputs:** Period position (incl. skip-first-period) or CONTRACT ENDED + overdue review flag
- **Conditions:** Experienced hires; renewals
- **Exceptions:** New agreement resets the date (service length kept separately)
- **Effective dates:** 2026-08-21
- **People and permissions:** Clerk enters; Director records carried-over PASS; renewal/closure by month 11 (A4 §5)
- **Workflow:** Enter actual date → overdue review appears → record PASS → proceed; or ENDED → renew/close.
- **Current code behavior:** NOT VERIFIED — no back-date/period-counter/ENDED handling in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-02, BR-REV-01
- **Open questions:** Q1
- **History:** None
