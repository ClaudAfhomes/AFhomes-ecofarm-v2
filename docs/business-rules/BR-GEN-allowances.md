# BR-GEN — Genealogy, Vacancy, Succession, Proration

- Status: MIXED (all SOURCE_DOCUMENTED; implementation NOT_IMPLEMENTED except GEN-04/05 PARTIAL)
- Sources: C2 §3 (R1–R7); B8 §1 (Accreditation cols AM–AT); A7 §3 (SC/SSC/SVD vs SM/SSM/SVD)

### BR-GEN-01 — Vacant post earns nil, downline rolls up

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R1 (AFhomes: BA, PA, PB nil during vacancy)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** While a post is vacant its BA, PA and PB are nil; its downline TCP and collections aggregate to the next active level above. A top-of-tree vacancy has no destination and earns nothing.
- **Rule explanation:** Taglish: bakanteng puwesto, walang kita — pero ang produksyon ng ilalim, aakyat sa susunod na aktibong lider.
- **Formula or calculation:** NOT DOCUMENTED (aggregation, no formula stated)
- **Inputs:** Vacancy period, downline TCP/collections per receipt date
- **Outputs:** Vacant post figures nil; upline figures include rolled-up stream
- **Conditions:** Post vacant (no active holder) for the period
- **Exceptions:** Top-of-tree vacancy: stream earns nothing (no destination)
- **Effective dates:** 2026-08-20 (rulings); NOT EVIDENCED further
- **People and permissions:** Automatic through genealogy; RV-12a case
- **Workflow:** Before: holder exits unreplaced. During: receipts aggregate upward. After: successor appointed (see BR-GEN-04).
- **Current code behavior:** NOT VERIFIED — no vacancy/roll-up concept located in v2 (seller resolution at `api/_lib/commerce.ts:437-470` honors a supplied seller only if active; no upward aggregation).
- **Gap analysis:** Not located in implementation.
- **Related tests:** None located; NOT RUN.
- **Dependencies:** BR-GEN-04, BR-ACM-01, BR-ENG-04
- **Open questions:** Q1 (model authority)
- **History:** None

### BR-GEN-02 — Override exact to receipt date; ends at End Date

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R2 + worked example (10 Jun sale at 30%, exit 14 Jul, 40% on 20 Jul → neither paid)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Override accrues per transaction and releases in stages with collection. A receipt earns override only if dated on or before the holder's End Date. After departure the former holder has no claim, including instalment remainders.
- **Rule explanation:** Taglish: override, kada resibo — resibong lampas sa huling araw, wala nang habol kahit dating hawak.
- **Formula or calculation:** Per-transaction accrual, staged release with collection; SVD rate 1% (see BR-PB-03 for grid; JA&D-side rate, AFhomes has no Override — A7 §3).
- **Inputs:** Receipt date, holder End Date, transaction genealogy
- **Outputs:** Override credit per receipt or nil
- **Conditions:** Receipt date ≤ End Date; holder in genealogy at receipt date
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** SVD only (A7 §3: SSC/SSM/SM never earn Override on either side)
- **Workflow:** Before: holder active. During: receipts accrue per transaction. After departure: cut-off exact.
- **Current code behavior:** NOT VERIFIED — repo-wide grep for Override/DSC/DRI commission mechanics returns zero true code matches; v2 commission is single-level rate × price (`api/_lib/commerce.ts:33`).
- **Gap analysis:** Not located; AFhomes-side inapplicable by A7 §3 (AFhomes has Performance Bonus instead).
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-GEN-03, BR-PB-03
- **Open questions:** Q1
- **History:** None

### BR-GEN-03 — Vacant seat earns no override in vacancy period

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R3; acceptance RV-12b (SVD vacancy: pre-exit receipts credit 1%, post-exit credit nobody)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Receipts after the exit date credit nobody where no level sits above the vacant post; closed months unchanged.
- **Rule explanation:** Taglish: umalis ang SVD — ang koleksyong dumating pagkatapos, walang tatanggap.
- **Formula or calculation:** NOT DOCUMENTED beyond R2 mechanics
- **Inputs:** Receipt dates vs exit date
- **Outputs:** Override to departing SVD (≤ exit) or nil
- **Conditions:** Unreplaced vacancy at top of tree
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic; RV-12b
- **Workflow:** Exit → pre-exit receipts still credit → post-exit receipts nil.
- **Current code behavior:** NOT VERIFIED — no Override, no vacancy in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-GEN-01, BR-GEN-02
- **Open questions:** Q1
- **History:** None

### BR-GEN-04 — Successor inherits genealogy only; pre-appointment transactions excluded

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R4 + 21 Aug amendment (R23 softening); RV-13, RV-14, RV-17
- **Source authority:** Management rulings 20–21 Aug 2026 (amendment: successor collecting old accounts earns discounted credit under R23, not full value)
- **Original rule:** A successor does not acquire historical TCP; later instalment receipts on pre-appointment transactions are not their production. AFhomes PA/PB computed on transactions dated after appointment. Where the successor takes over management and collection, those collections earn the R23 assumed credit instead.
- **Rule explanation:** Taglish: mana ang puno, hindi ang bunga — ang lumang benta, hindi sa iyo; ang kolektang ikaw ang nagdala, may diskuwentong kredito (tingnan BR-ACM).
- **Formula or calculation:** Date filter: transaction date > appointment date counts in full; older counts only via BR-ACM-01 rates.
- **Inputs:** Appointment (position-effective) date (B8 §1 col AU), transaction dates, receipt dates
- **Outputs:** Successor production figures excluding pre-appointment TCP
- **Conditions:** Appointment to a post (vacant or replaced)
- **Exceptions:** R23 collection-work credit (BR-ACM-01); upline above unaffected (BR-GEN-07)
- **Effective dates:** 2026-08-20, amended 2026-08-21
- **People and permissions:** Automatic via genealogy; frozen rows keep old name (RV-13)
- **Workflow:** Appointment → genealogy redirects → old transactions excluded → collections credited at discount.
- **Current code behavior:** `correct_referral_upline` RPC (Phase 2 set, `20260927000003_afhomes_phase2_rpc.sql`; AGENTS.md) maintains referral genealogy; commission rules resolve per sale date with effective windows (`20261018000002_afhomes_flexible_commission_rules.sql:111-112`). No appointment-date filtering or assumed-credit concept located.
- **Gap analysis:** Partial — genealogy maintenance exists; inheritance/exclusion/credit semantics not located.
- **Related tests:** `api/_handlers/phase7-genealogy-migration.spec.ts` — NOT RUN.
- **Dependencies:** BR-ACM-01, BR-GEN-07
- **Open questions:** Q1, Q3
- **History:** None

### BR-GEN-05 — Leader covers the whole genealogy beneath them

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R5; RV-15 (SVD credited with SSC in post; old no-SSC restriction removed). AFhomes unchanged in principle (already aggregated at every level).
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** JA&D SVD covers SSCs and SSCs' OSTs alike (old restriction — SVD paid only where salesperson had no SSC — removed). AFhomes: each leader counts own sales, own referrals, entire downline (B8 §3).
- **Rule explanation:** Taglish: sakop ng lider ang buong ilalim — walang lusot kahit may nasa gitna.
- **Formula or calculation:** Team TCP = own sales + own referrals + full downline (AFhomes, B8 §3)
- **Inputs:** Full upline chain per receipt (Collections M/N/O per A7 §4)
- **Outputs:** Team TCP per leader level
- **Conditions:** Active holder in chain
- **Exceptions:** Vacancy rolls upward (BR-GEN-01), not sideways
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic aggregation
- **Workflow:** Receipt carries current chain → aggregates at every active level above.
- **Current code behavior:** Seller resolution honors downline membership (`api/_lib/commerce.ts:437-470`, used `api/_handlers/sales.ts:400`); v2 commissions are single-level (one beneficiary per sale), not multi-level aggregation.
- **Gap analysis:** Partial — downline concept exists; whole-tree aggregation does not.
- **Related tests:** `phase7-genealogy-migration.spec.ts`, `referral-contexts.spec.ts` — NOT RUN.
- **Dependencies:** BR-GEN-01, BR-PB-02
- **Open questions:** Q1
- **History:** None

### BR-GEN-06 — BA/PA day-pro-rated on appointment and departure; Override/PB not pro-rated

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R6; RV-16 (15th-of-31 departure → 15/31 and 16/31); RV-09/10 read with R6. Supersedes Rev C ¶10(b) departure granularity + Rev B §2 (per C2 §2).
- **Source authority:** Management rulings 20 Aug 2026 (supersession claim single-source — Rev B/C absent)
- **Original rule:** Whenever a person is not active the whole month — appointment as well as departure — BA and PA pro-rate by days (e.g. start 16th of 31-day month = 16/31). Override needs no pro-ration (exact to receipt date); PB is date-filtered instead. Departure Type (NORMAL/FOR-CAUSE, B8 §1 col AO) is a record, not a calculation input.
- **Rule explanation:** Taglish: hindi buwang aktibo, hindi buwang allowance — ayon sa araw; ang uri ng pag-alis, tala lang, hindi kasali sa tuos.
- **Formula or calculation:** allowance × (active days ÷ days in month); 16th of 31-day month = 16/31 (C2 R10)
- **Inputs:** Appointment date (col AU), End Date (col AN), month length
- **Outputs:** Pro-rated BA/PA
- **Conditions:** Partial-month activity (appointment or departure)
- **Exceptions:** Override (receipt-exact), PB (date-filtered base); NORMAL/FOR-CAUSE never changes arithmetic
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic; B8 §1 cols AM–AO
- **Workflow:** Appointment/departure recorded → month figures pro-rated → no retroactive change on close.
- **Current code behavior:** NOT VERIFIED — no BA/PA/PB, allowances, or pro-ration in v2 (grep VERIFIED absent).
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-04
- **Open questions:** Q1; Rev B/C texts absent (single-source supersession)
- **History:** None

### BR-GEN-07 — Successor window never limits the upline

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R7; RV-17 (successor excludes pre-appointment; upline unchanged)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Each person is tested against their own appointment window; a leader covers the whole tree's history from their own appointment date, whoever was replaced beneath them.
- **Rule explanation:** Taglish: palit sa ibaba, hindi bawas sa itaas — buo pa rin ang sakop ng lider mula sa sarili niyang araw ng pag-upo.
- **Formula or calculation:** Per-person date window filter; upline window independent
- **Inputs:** Each holder's appointment date
- **Outputs:** Unchanged upline figures after middle-layer replacement
- **Conditions:** Replacement beneath an active upline
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic; RV-17
- **Workflow:** Replacement → successor filtered → upline re-tested on own window → unchanged.
- **Current code behavior:** NOT VERIFIED — no appointment windows in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-GEN-04
- **Open questions:** Q1
- **History:** None
