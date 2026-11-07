# BR-ACM — Assumed Collection Credit

- Status: all SOURCE_DOCUMENTED / NOT_IMPLEMENTED except ACM-04 PARTIAL (conceptual only)
- Sources: C2 §4A (R23) + §5 RV-34–37; A4 §7; A6 §5.5; B8 §1 (cols AC/AD/AG/AH/BC/BD) + §5; A7 §1/§4 (credit columns: AFhomes AG/AH)

### BR-ACM-01 — Credit rates: 40% VIP, 20% IGP (AFhomes); Director-adjustable

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** C2 §4A R23 (40% VIP / 20% IGP; JA&D 20%); B8 §2 (B20/E20); RV-34 (JA&D: 1,000,000 old collection → 200,000 credit); B8 §5 self-test (1M VIP + 1M IGP inherited → 600,000 = 400,000 + 200,000)
- **Source authority:** Management rulings 21 Aug 2026; rates adjustable on written notice (Director-only parameters)
- **Original rule:** The ASSUMED COLLECTION CREDIT is the share of a month's collections on an assumed account counting toward the collector's KPI: 40% for AFhomes VIP, 20% for AFhomes IGP. Discount (not full value) because the collector did not originate the sale; collection is real work and is rewarded below an original sale's rate.
- **Rule explanation:** Taglish: minanang koleksyon — 40% sa VIP, 20% sa IGP ang bibilangin sa iyo; may bawas kasi hindi ikaw ang nagbenta, pero may gantimpala ang trabaho.
- **Formula or calculation:** credit = 40% × VIP inherited collections + 20% × IGP inherited collections (per month)
- **Inputs:** Month collections on assumed accounts by product
- **Outputs:** Credit amount added to KPI figures
- **Conditions:** Collector holds the account's management + collection under current genealogy
- **Exceptions:** Leader already in post at sale closing gets no credit; salesperson who sold it gets none (see BR-ACM-03)
- **Effective dates:** 2026-08-21
- **People and permissions:** Automatic; rates Director-only
- **Workflow:** Receipt on inherited account → credit computed → added behind BA/PA/PB figures.
- **Current code behavior:** NOT VERIFIED — no assumed-credit concept in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ACM-02, BR-ACM-04
- **Open questions:** Q1, Q8 (confirm rates)
- **History:** None

### BR-ACM-02 — Credit reaches BA, PA, PB, the 40% quota measure, and the below-target review (AG/AH reconcile)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** C2 §4A (added behind BA/PA, behind PB, behind two-month review; lifts the 40%-collection-measure figure — one receipt works in both places, deliberately); A4 §7 + A6 Part 6 step 5 (Payroll AG = credit, AH = own + credit = tested figure; E + AG = AH on the line); B8 §1 (AG/AH visible because an untraceable figure cannot be audited; AA–AD hidden working; BC/BD month pairs)
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** The credit is added to the closed-deal TCP figures behind BA and PA, behind PB at AFhomes, and behind the below-target review. The same credited amount also lifts the figure against which the 40% Collection requirement is measured. RV-37: a leader selling nothing but collecting 6,000,000/month on an inherited account reads 1,200,000/month (VIP 20%? — recorded as documented: 6,000,000 → 1,200,000, i.e. the 20% rate in that case) and is NOT flagged.
- **Rule explanation:** Taglish: ang kredito, kasama sa lahat ng sukatan — allowance, kota, at streaming? at review; makikita sa AG/AH kaya natutunton.
- **Formula or calculation:** KPI basis (AH) = own production (E) + assumed credit (AG)
- **Inputs:** Own production; credit (BR-ACM-01)
- **Outputs:** Tested figure AH; allowances; review standing
- **Conditions:** Any month with assumed collections
- **Exceptions:** None documented
- **Effective dates:** 2026-08-21
- **People and permissions:** Automatic; visible to tester and Finance Director on the line
- **Workflow:** Credit computed → AH reconciles (E + AG) → allowances/reviews tested on AH.
- **Current code behavior:** NOT VERIFIED — no KPI-plus-credit figure in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ACM-01, BR-PB-04, BR-REV-02
- **Open questions:** Q1
- **History:** None

### BR-ACM-03 — Credit never touches Override; seller keeps DSC/DRI; no re-test

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §4A R23 (three bullets) + practical consequence (R24 pairing); RV-35 (JA&D case — recorded as documented) and RV-36 (neither the in-post leader nor the salesperson receives credit; salesperson keeps DSC/DRI in full; one person's credit alongside another's commission on the same receipt is CORRECT); B8 §5 self-test (who-does-not-get-it)
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** The credit is NOT added to any figure used to compute Override (earned per transaction under the Commission System; SVD continues at 1% per closed deal ordinarily). An assumed account is not re-tested against the closed-deal threshold — passed at first crediting. When a collector earns credit on another's old sale, DSC/DRI continue to the seller/referrer; payroll must not treat the pairing as an error.
- **Rule explanation:** Taglish: ang kredito, hindi kasali sa override; ang nagbenta, buo pa rin ang komisyon — dalawang tama sa iisang resibo.
- **Formula or calculation:** NONE (exclusion rule)
- **Inputs:** Same receipt feeding credit + commission paths
- **Outputs:** Unchanged Override/DSC/DRI to entitled parties
- **Conditions:** Every assumed-credit receipt
- **Exceptions:** None documented
- **Effective dates:** 2026-08-21
- **People and permissions:** Payroll must accept the pairing (R24 consequence)
- **Workflow:** Receipt → credit to collector AND commission to seller, both correct.
- **Current code behavior:** N/A — neither Override/DSC/DRI nor assumed credit exists in v2.
- **Gap analysis:** Not located (both sides absent).
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-PAR-01, BR-PAR-02
- **Open questions:** Q1
- **History:** None

### BR-ACM-04 — Attribution automatic via current upline chain; no assignment register; vacancy rolls upward

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`
- **Source location:** C2 §4A (Collections carries CURRENT upline chain per receipt; inherited post redirects by itself; vacant post rolls credit upward to first active level); A4 §7 (you assign nothing); B8 §1 (AR/AS blank on exit routing downline upward; AT pass-through with date-window cutting)
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** No assignment register is kept. Every receipt carries the current upline chain, so an inherited post redirects receipts by itself and a vacant unfilled post passes its assumed accounts upward to the first active level above.
- **Rule explanation:** Taglish: walang talaan ng mana — ang resibo mismo ang may dala ng kasalukuyang hanay; bakante, aakyat ang kredito.
- **Formula or calculation:** NONE (routing rule)
- **Inputs:** Per-receipt upline chain (Collections M/N/O); post occupancy (AR/AS effective)
- **Outputs:** Credit attributed to current holder or first active above
- **Conditions:** Inheritance or vacancy
- **Exceptions:** None documented
- **Effective dates:** 2026-08-21
- **People and permissions:** Automatic; sub-team moves must change EVERY upline column (see BR-DUAL-02)
- **Workflow:** Post change → chain updates → subsequent receipts redirect automatically.
- **Current code behavior:** v2 receipts/payments link to sales and sellers via explicit relations; referral upline maintained by `correct_referral_upline` (AGENTS.md Phase 2). No per-receipt chain snapshot or vacancy roll-up located.
- **Gap analysis:** Partial — upline-carried attribution concept resembles v2 relations; automatic redirect + upward roll-up not located.
- **Related tests:** `phase7-genealogy-migration.spec.ts` — NOT RUN.
- **Dependencies:** BR-GEN-01, BR-DUAL-02
- **Open questions:** Q1
- **History:** None
