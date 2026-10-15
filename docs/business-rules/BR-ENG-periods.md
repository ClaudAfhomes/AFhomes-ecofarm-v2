# BR-ENG — Engagement Dates, Periods, Transitional Months

- Status: all SOURCE_DOCUMENTED / NOT_IMPLEMENTED (no QP/EP, contract-start, or transitional-month concepts in v2 — grep VERIFIED absent)
- Sources: C2 §3 (R8–R11); A4 §3.3/§8; A6 §2.3/Part 5.6; B8 §1 (cols AV/AW); C1 §1

### BR-ENG-01 — Engagements start on the 1st or 16th; other days flagged, not blocked

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R8; B8 §1 col AW (start-day check); A4 §9 warning `START DAY n — EXCEPTION`; C1 §1.4
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Any other start day is an exception requiring confirmation. The workbooks flag it; they do not block it.
- **Rule explanation:** Taglish: uno o dise-sais ang pasok — ibang araw, may bandila pero tuloy pa rin; kumpirmahin lang.
- **Formula or calculation:** NOT DOCUMENTED (flag only)
- **Inputs:** Contract start date
- **Outputs:** `START DAY n — EXCEPTION` warning or clear
- **Conditions:** Start day ≠ 1st and ≠ 16th
- **Exceptions:** Confirmed exceptions proceed normally
- **Effective dates:** 2026-08-20
- **People and permissions:** Clerk enters; supervisor confirms intent
- **Workflow:** Date entered → flag raised → confirmation recorded → proceeds.
- **Current code behavior:** NOT VERIFIED — no engagement dates in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-05, BR-OPS-01
- **Open questions:** Q1
- **History:** None

### BR-ENG-02 — Contract start date (never accreditation date) drives QP/EP

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R9; RV-18; B8 §1 col AV (contract start, NOT accreditation) + col AW (QP/EP/ENDED); A6 §2.3; C1 §1 (blank = silent underpayment)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** The Qualifying/Adjustment Period split is driven by the CONTRACT START DATE and must never be inferred from the accreditation date. Left blank, the workbook treats the person as Extended Period — the stricter branch — so a new hire's unconditional first-month allowance is instead tested against a threshold: silent underpayment, nothing flagged.
- **Rule explanation:** Taglish: kontrata ang basehan, hindi akreditasyon — walang petsa ng kontrata, lulubog ang baguhang suweldo nang walang babala.
- **Formula or calculation:** Blank start → EP branch (stricter); dated start → QP month 1 unconditional BA (see BR-ENG-03)
- **Inputs:** Contract start date (Accreditation col AV)
- **Outputs:** Period classification QP / EP / ENDED + `NO CONTRACT START DATE` warning
- **Conditions:** Every engaged person, both companies
- **Exceptions:** None — prerequisite before first live payroll (C1 §1, C2 §6)
- **Effective dates:** 2026-08-20; go-live prerequisite
- **People and permissions:** Clerk enters; C1 §1 sign-off
- **Workflow:** Date entered → period classified → blank triggers warning + EP treatment until fixed.
- **Current code behavior:** NOT VERIFIED — no contract-start/QP/EP fields in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-03, BR-REV-01, BR-OPS-01
- **Open questions:** Q1
- **History:** None

### BR-ENG-03 — First-month BA is compliance-based; the contract clause is not a TCP gate

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R10a; RV-32 (zero-production SSC/SVD receive full formula BA 20,000/30,000; neither receives PA below 2,000,000; SVD AP PA target 2,000,000 not 4,000,000)
- **Source authority:** Management rulings 20 Aug 2026 (contract interpretation; clause stays unchanged)
- **Original rule:** The sentence that BA "shall not be construed as an entitlement in the event of zero Closed Deal TCP, zero collection, or failure to comply" does NOT impose a production test — it preserves company discretion, with production considered among other things at performance evaluation. The workbooks encode no production test on the first month's BA; withholding is a Director judgement on the whole picture (A4 §5.1 step 5, A6 Part 6 step 6: attendance/policy/evaluation).
- **Rule explanation:** Taglish: unang buwang allowance, pakikisama at pagdalo ang basehan — hindi benta; ang pagbawas, desisyon ng Direktor, hindi formula.
- **Formula or calculation:** Month-1 BA = full Table A figure (e.g. SVD 50,000; RV-32 JA&D figures 20,000 SSC / 30,000 SVD) regardless of TCP; withholding is extra-formula.
- **Inputs:** Table A BA per position; Director evaluation (attendance, policy, evaluation)
- **Outputs:** Full BA paid, unless Director withholds on overall evaluation
- **Conditions:** First contract month (QP/AP month 1)
- **Exceptions:** Director may withhold on unsatisfactory overall evaluation (outside workbook)
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic payment; Director-only withholding
- **Workflow:** QP month 1 → full BA in formulas → Director withholds only on judgement.
- **Current code behavior:** NOT VERIFIED — no BA in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-PB-03, BR-ENG-02
- **Open questions:** Q1
- **History:** None

### BR-ENG-04 — BA releasable monthly/semi-monthly, always by days; PA/PB/Override calendar-month only

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R10 (16th of 31-day month = 16/31, not one half); no service-contract amendment needed
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** BA may be released monthly or semi-monthly but the amount is always by days. PA, PB and Override are counted and released on natural calendar months only and never straddle a month boundary.
- **Rule explanation:** Taglish: kahit hati ang bigay, araw pa rin ang tuos (16/31, hindi kalahati); ang PA/PB/Override, buong kalendaryong buwan lang.
- **Formula or calculation:** BA × (days ÷ month length); PA/PB/Override assessed per natural calendar month, no straddling
- **Inputs:** Start day, month length, release cadence
- **Outputs:** Pro-rated BA; calendar-month PA/PB/Override
- **Conditions:** Mid-month starts (BA); all months (PA/PB/Override)
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic; contract terms unchanged by construction
- **Workflow:** Start day → day-count → BA pro-rated; PA/PB/Override wait for clean calendar months.
- **Current code behavior:** NOT VERIFIED — no BA/PA/PB cadences in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-GEN-06, BR-ENG-05
- **Open questions:** Q1
- **History:** None

### BR-ENG-05 — Transitional month splits QP and correction stretch; one assessment each

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R11 + example (engaged 16 Jul → QP 16 Jul–15 Aug, correction 16–31 Aug, clean months from 1 Sep); RV-19 (July wholly QP at 16/31; August 15/31 QP + 16/31 EP each vs own pro-rated quota; September clean)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** For a start day other than the 1st, contract month 1 runs a full 30/31 days ending mid-following-calendar-month. The remainder of that calendar month is a correction stretch. Exactly one payroll month is split; each stretch is assessed on its own days against a quota pro-rated to those days; no assessment crosses a month boundary.
- **Rule explanation:** Taglish: unang buwan, hahatiin sa kalendaryo — bawat putol, sariling araw at sariling kota; walangPrima? walang assessment na tumatawid ng buwan.
- **Formula or calculation:** Stretch quota = position quota × (stretch days ÷ month length); each stretch judged independently
- **Inputs:** Contract start date, position targets (Table A)
- **Outputs:** Two assessments for the split month, then clean calendar months
- **Conditions:** Start day ≠ 1st
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic
- **Workflow:** Mid-month start → QP runs full 30/31 days → correction stretch → clean months.
- **Current code behavior:** NOT VERIFIED — no transitional months in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-01, BR-ENG-02, BR-REV-02 (below-target watched from 3rd natural month so no partial month is judged)
- **Open questions:** Q1
- **History:** None
