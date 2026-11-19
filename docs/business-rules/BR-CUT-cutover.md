# BR-CUT — 27 September 2026 Cutover, No Grandfathering

- Status: both SOURCE_DOCUMENTED; CUT-01 implementation UNASSESSED pending Q2; CUT-02 OUT_OF_SCOPE
- Sources: C1 §3; IDX Pack C (identical wording in both — decision text, not a new ruling document)

### BR-CUT-01 — New terms apply in full to both companies; sub-threshold sales never count whenever entered

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_ASSESSED
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx` + `MASTER_FILE_INDEX-BUILD_2026-09-10a.docx`
- **Source location:** C1 §3 (NO GRANDFATHERING — CONFIRMED block); IDX Pack C (same block)
- **Source authority:** "DECIDED, 27 September 2026" — decision recorded in both documents; deciding body not named beyond the go-live sign-off context
- **Original rule:** The new terms apply to BOTH companies in full, with NO grandfathering. A sale below the closed-deal threshold does not count, whenever it was entered. This TIGHTENS terms for anyone already engaged — under the older wording a completed sale with any down payment counted — so present it as a change in terms, with the reason, not as a clarification. Check the AFhomes VIP register in particular: its threshold is 25%, so a sale with a 15% down payment counted before and does not now.
- **Rule explanation:** Taglish: walang lolo — bagong patakaran, lahat sakop; ang dating pasadong 15% sa VIP, hindi na; ipaliwanag na pagbabago, hindi paglilinaw.
- **Formula or calculation:** Threshold test applies by entry/qualification date with no legacy exemption (15% VIP example is the documented boundary case)
- **Inputs:** All sales whenever entered; 25%/10% lines
- **Outputs:** Binary count/no-count under new terms
- **Conditions:** Cutover decision 2026-09-27
- **Exceptions:** Credited Closed Deals protected by contract (see BR-CUT-02) — nothing else carried over
- **Effective dates:** Decided 2026-09-27; applies to all entries regardless of entry date
- **People and permissions:** Present to engaged sellers as change-in-terms with reason
- **Workflow:** Decision → registers re-tested under new lines → sub-threshold sales drop out.
- **Current code behavior:** NOT ASSESSED — v2 has no per-sale qualification threshold to grandfather; whether the cutover binds v2 sales/collections data is exactly Q2. Closest analog (prospective 4% zeroing, history untouched) is a design choice, not a cutover ruling.
- **Gap analysis:** Applicability to v2 unassessed pending stakeholder ruling; do not assume bound or unbound.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-QLF-02
- **Open questions:** Q2 (does this bind v2 data?); deciding body unnamed
- **History:** None

### BR-CUT-02 — Already-credited Closed Deals protected by the contracts; nothing else carried over

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_ASSESSED
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx`
- **Source location:** §3 (same block: "Closed Deals already credited are protected by the contracts themselves")
- **Source authority:** 27 Sept 2026 decision + service contracts (C3–C7 absent — protection mechanism not independently verifiable)
- **Original rule:** Credited qualifications survive the cutover through contract protection; every non-credited expectation does not.
- **Rule explanation:** Taglish: ang na-kredito na, protektado ng kontrata; ang hindi pa, hindi na dadalhin.
- **Formula or calculation:** NONE (cutover boundary)
- **Inputs:** Pre-cutover credited Closed Deals
- **Outputs:** Preserved credits
- **Conditions:** Credit earned before cutover under old terms
- **Exceptions:** None — sole carry-over
- **Effective dates:** Decided 2026-09-27
- **People and permissions:** Contract-side protection (not a workbook computation)
- **Workflow:** Cutover → credited rows stand → all else re-tested.
- **Current code behavior:** NOT ASSESSED — applicability to v2 data (whether workbook credits migrate or v2 holds an equivalent artifact) is exactly Q2; the contract instruments are absent (Q4).
- **Gap analysis:** Applicability unknown pending Q2/Q4; do not assume bound or unbound (corrected 2026-10-14 — was OUT_OF_SCOPE without sufficient source evidence).
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-CUT-01
- **Open questions:** Q2, Q4 (absent contracts)
- **History:** None
