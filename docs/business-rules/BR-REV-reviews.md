# BR-REV — Engagement Reviews

- Status: all SOURCE_DOCUMENTED / NOT_IMPLEMENTED (no reviews board or engagement lifecycle in v2)
- Sources: C2 §3 (R18–R20) + §5 RV-24; A6 §5.4; A4 §5/§6; B2 `ReviewQualifyingPeriod` (:870), `ReviewPerformanceStreak` (:934); B8 §1 (cols AX–BJ), §7 (Engagement Reviews sheet)

### BR-REV-01 — Qualifying/Adjustment Period review board

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R18; RV-24 (both appear on board with figures; PASS retains and clears flag; FAIL sets TERMINATED with correct End Date); A6 §5.4; B8 §1 (cols AX–AZ result/by/date; BA review-due with day count; BB hidden rank) + §7 (read-only board, section A)
- **Source authority:** Management rulings 20 Aug 2026 (service contracts reserve the proceed-to-Extended-Period decision; the workbook previously let people drift into EP undecided)
- **Original rule:** A read-only board lists everyone whose period ended undecided with the qualified TCP built during it. PASS keeps the person ACTIVE; FAIL sets TERMINATED with the End Date on the period end date.
- **Rule explanation:** Taglish: tapos ang unang buwan nang walang desisyon — nasa talaan; pasado, tuloy; bagsak, tapos sa huling araw ng buwan.
- **Formula or calculation:** Figure shown = closed-deal TCP built during the period (incl. assumed credit per B8 §1 cols BC/BD)
- **Inputs:** Period end dates; period TCP per person
- **Outputs:** PASS (ACTIVE, flag cleared) / FAIL (TERMINATED, End Date = period end)
- **Conditions:** Period ended without recorded decision
- **Exceptions:** None — undecided retains (see BR-REV-03)
- **Effective dates:** 2026-08-20
- **People and permissions:** Director decides from Engagement Reviews sheet section A
- **Workflow:** Period ends undecided → board lists with figures → PASS/FAIL recorded with stamp.
- **Current code behavior:** NOT VERIFIED — no QP/EP, review board, or engagement-termination flow in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-02, BR-REV-03
- **Open questions:** Q1
- **History:** None

### BR-REV-02 — Two consecutive months below target (from 3rd natural month; pair recorded)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R19; RV-24 (two months below target put on board; PASS records covered pair so one streak never asks twice; FAIL End Date = last day of second month); A6 §5.4; B8 §1 (BE streak watched from 3rd natural month; BF–BI result/by/date/pair; BJ hidden rank) + §7 (section B)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Watched from the third natural month after engagement — the first month on which everyone is on clean calendar months, so no partial month is ever judged. Target is the position's own bar. PASS records which pair of months it covers. FAIL sets TERMINATED with the End Date on the last day of the second month.
- **Rule explanation:** Taglish: dalawang sunod na buwang kapos — mula ikatlong buwan lang huhusgahan; ang pasya, tanda kung aling dalawang buwan para hindi maulit.
- **Formula or calculation:** Month figure (incl. assumed credit, BR-ACM-02) < position target (Table A PA threshold) for two consecutive completed months
- **Inputs:** Monthly figures per person; position targets
- **Outputs:** PASS (pair recorded) / FAIL (TERMINATED, End Date = second month-end)
- **Conditions:** Completed months only; counting starts 3rd natural month
- **Exceptions:** Partial months never judged; assumed credit counts toward the figure
- **Effective dates:** 2026-08-20
- **People and permissions:** Director decides from section B
- **Workflow:** Streak detected → board lists → decision with pair stamp.
- **Current code behavior:** NOT VERIFIED — no streak review in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-05, BR-ACM-02, BR-REV-03
- **Open questions:** Q1
- **History:** None

### BR-REV-03 — Unrecorded review retains the engagement; pending count reported on open

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R20; RV-24 (both engagements CONTINUE while unreviewed; pending count reported on open); A4 §5 (file reports pending reviews on open; worked before settling); A6 §5.4; B4 `notifyPendingReviews`, `qpPendingRows`, `streakRows`
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** The system never drops anyone by silence; it only keeps asking. A missed review is a management lapse and must not fall on the person concerned.
- **Rule explanation:** Taglish: walang desisyon, walang tanggal — tuloy ang tao; kasalanan ng namamahala ang nakaligtaan, hindi ng tao.
- **Formula or calculation:** NONE (lifecycle rule)
- **Inputs:** Undecided review rows
- **Outputs:** Continued engagement + growing pending count until worked
- **Conditions:** Any unrecorded QP or streak review
- **Exceptions:** None — silence never terminates
- **Effective dates:** 2026-08-20
- **People and permissions:** Director must work the lists; system only reminds
- **Workflow:** Open file → pending count shown → lists worked → count clears.
- **Current code behavior:** NOT VERIFIED — no engagement lifecycle in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-REV-01, BR-REV-02
- **Open questions:** Q1
- **History:** None
