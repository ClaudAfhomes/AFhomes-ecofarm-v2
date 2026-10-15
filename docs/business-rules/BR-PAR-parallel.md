# BR-PAR — Commission/Engagement Parallel Independence

- Status: both SOURCE_DOCUMENTED / NOT_IMPLEMENTED
- Sources: C2 §4A (R24); A4 §1; A6 §5.5

### BR-PAR-01 — DSC/DRI/Override follow accreditation (not engagement), incl. OST, for accreditation life

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §4A, R24; A4 §1 (commission table: whoever sold/referred; follows accreditation not contract; continues while accreditation valid)
- **Source authority:** Management rulings 21 Aug 2026 (accreditation and commission policy, NOT the service contract)
- **Original rule:** DSC, DRI and Override are earned under the accreditation and commission policy, NOT under the service contract. They belong to whoever sold or referred the sale, do not ask whether that person is engaged as IST or OST, and continue for as long as the accreditation is valid, irrespective of any service-contract term. BA, PA and PB are the engagement-side compensation. Neither system reduces or conditions the other.
- **Rule explanation:** Taglish: komisyon, sa akreditasyon nakakabit — kahit OST o tapos ang kontrata, basta bisa ang akreditasyon, tuloy ang komisyon; hiwalay ang allowance.
- **Formula or calculation:** NONE (jurisdiction rule)
- **Inputs:** Accreditation validity; sale/referral attribution
- **Outputs:** Continued commission entitlement independent of engagement state
- **Conditions:** Valid accreditation at earning time
- **Exceptions:** None documented
- **Effective dates:** 2026-08-21
- **People and permissions:** Sellers, referrers, IST and OST alike
- **Workflow:** Engagement ends → accreditation persists → commission continues.
- **Current code behavior:** NOT VERIFIED — v2 has one commission model (single-level rules + manual qualify→earned→paid) with no accreditation/engagement split; OST accreditation workflow exists (`ost-accreditation` family) but its relation to commission entitlement was not traced in this phase.
- **Gap analysis:** Not located.
- **Related tests:** `ost-accreditation.spec.ts` — NOT RUN (workflow, not entitlement).
- **Dependencies:** BR-PAR-02, BR-ACM-03
- **Open questions:** Q1; Q12-adjacent (OST↔commission entitlement mapping in v2)
- **History:** None

### BR-PAR-02 — Collector credit and seller commission on one receipt are both correct

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`
- **Source location:** C2 §4A practical consequence; A4 §1 (neither reduces the other) + §10 (looks-wrong-but-isn't list)
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** When a collector earns an assumed credit on someone else's old sale, DSC and DRI on that sale continue to the seller/referrer. Both are correct at once, and payroll must not treat the pairing as an error.
- **Rule explanation:** Taglish: dalawang tama sa iisang resibo — kredito sa nangolekta, komisyon sa nagbenta; huwag ituring na mali.
- **Formula or calculation:** NONE (reconciliation rule)
- **Inputs:** Same receipt
- **Outputs:** Two correct attributions; no error flag
- **Conditions:** Assumed-credit receipts
- **Exceptions:** None documented
- **Effective dates:** 2026-08-21
- **People and permissions:** Payroll reviewer must accept pairing
- **Workflow:** Receipt → both postings → reviewer accepts.
- **Current code behavior:** N/A — neither posting exists in v2.
- **Gap analysis:** Not located (both sides absent).
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ACM-03, BR-PAR-01
- **Open questions:** Q1
- **History:** None
