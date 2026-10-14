# BR-QLF — Closed-Deal Qualification, Thresholds, Freezing, Reversals, Payout Stages

- Status: MIXED (all SOURCE_DOCUMENTED; implementation PARTIAL ×3, MISMATCH ×1, NOT_IMPLEMENTED ×1, OUT_OF_SCOPE ×1)
- Sources: C2 §3 (R12–R15) + §4 (R22); B8 §§1–2; A4 §§2–3; A6 §2.1/Part 4; B2 `QualFormula` (:660); A7 §1

### BR-QLF-01 — Qualification is automatic on counted APPROVED collections

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R12; RV-20 (each product qualifies on the receipt that crossed its line, not the first receipt; unapproved 12% receipt qualifies nothing until approved); B8 §1 (Register AI / IGP AJ automatic-then-frozen; no cell to type); B2 `QualFormula` (:660, body verified: sale#+product match, approved flag, cumulative ≥ threshold×TCP, no negatives, status blank/ACTIVE)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** The qualified date is no longer typed. A sale becomes a CLOSED DEAL on the date of the receipt that first takes its counted, APPROVED collections to its product threshold — removing date-gaming and clerical load.
- **Rule explanation:** Taglish: hindi tina-type ang petsa — kusa itong lilitaw sa araw ng resibong unang umabot sa kota, basta aprubado.
- **Formula or calculation:** closed-deal date = MIN(receipt date) over receipts where sale# + product match, approved = 1, cumulative ≥ threshold × TCP, no negative receipt on sale, sale status ∈ {blank, ACTIVE}, sale# and TCP present (B2 `QualFormula` body, verified).
- **Inputs:** Collections rows (date, product, sale#, amount, approval flag, cumulative col V); Register TCP (col Q); threshold (Control Panel B13/E13)
- **Outputs:** Frozen closed-deal date (Register AI / IGP AJ)
- **Conditions:** Approved collections reaching product threshold
- **Exceptions:** Unapproved receipts count for nothing until approved; negative amounts are refunds (see BR-QLF-04)
- **Effective dates:** 2026-08-20
- **People and permissions:** Clerk posts receipts; supervisor approves; date appears by itself
- **Workflow:** Receipt entered → approved → cumulative crosses line → date appears and freezes.
- **Current code behavior:** v2's closest gate is payment verification: only `recorded→verified|rejected` transitions count money (`20260927000003_afhomes_phase2_rpc.sql:224-352`); `summarizePayments` excludes voided (`api/_lib/commerce.ts:50-114`). No per-sale qualification date exists.
- **Gap analysis:** Partial — approved-before-counting principle matches; automatic date, threshold lines, and freeze semantics not located.
- **Related tests:** `api/_handlers/sale-payments.spec.ts` — NOT RUN. `api/_lib/commerce.spec.ts` — 33 passed 2026-10-14 (helper behavior only).
- **Dependencies:** BR-QLF-02, BR-CTL-01
- **Open questions:** Q1, Q3
- **History:** None

### BR-QLF-02 — Thresholds: AFhomes VIP 25%, AFhomes IGP 10%, JA&D IGP 10%

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** MISMATCH
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** C2 §3 R13; B8 §2 (Control Panel B13 = 25% VIP, E13 = 10% IGP); RV-20 (5%/15%/40% cases); B8 §5 self-test (VIP 15% no / 30% yes; IGP 8% no / 15% yes)
- **Source authority:** Management rulings 20 Aug 2026; company policy asks higher down payments, exceptions granted for buyers, thresholds stop exceptions manufacturing performance
- **Original rule:** Below the line a sale is a concession — still pending, not a closed deal. (C2 correction, same section: these thresholds are STRICTER than the contract text and were written into the DST contracts via the 21 Aug Addendum — see CF-04; the AFhomes IST 40% figure is a separate monthly team quota, not per-sale.)
- **Rule explanation:** Taglish: 25% sa VIP, 10% sa IGP — kulang dito, hindi pa benta para sa estadistika; konsesyon pa lang.
- **Formula or calculation:** counted approved collections ≥ threshold × TCP, tested per transaction, never aggregated across sales
- **Inputs:** Per-sale approved cumulative; TCP; product threshold
- **Outputs:** Counts / does-not-count toward BA/PA/PB statistics
- **Conditions:** Every sale, both AFhomes registers
- **Exceptions:** Company-policy down payments above the lines are unaffected; exceptions below remain pending
- **Effective dates:** 2026-08-20; cutover tightened 2026-09-27 (see BR-CUT-01)
- **People and permissions:** Director-only figures (see BR-AUTH-01)
- **Workflow:** Receipts accumulate → line crossed → counts; below line → pending concession.
- **Current code behavior:** v2 activates memberships only at 100% verified payment: `activate_card_sale` raises `SALE_NOT_FULLY_PAID` unless verified ≥ price (`20260927000003_afhomes_phase2_rpc.sql:418,431`); entry via `POST /sales/:id/activate` (`api/_handlers/sales.ts:819-820`). No 25%/10% counting line exists.
- **Gap analysis:** MISMATCH — same subject (when a sale counts), materially different gate (25%/10% vs 100%). Per standing instruction the documented rule is not altered to match the code; applicability to v2 cards needs Q3.
- **Related tests:** `api/_handlers/phase2.spec.ts`, `phase26-finance.spec.ts` — NOT RUN.
- **Dependencies:** BR-QLF-01, BR-QLF-05, BR-CUT-01
- **Open questions:** Q1, Q3 (are v2 VIP cards the workbook VIP product?)
- **History:** None

### BR-QLF-03 — Qualification date freezes; threshold changes bind new qualifications only

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R14; RV-21 (raise threshold after qualifications → frozen dates do not move); A6 §5.1 (lowering the line judges every not-yet-qualified sale live — most careful parameter)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** The date freezes once reached. A threshold change binds new qualifications only; earlier ones are not re-judged. Lowering the line can turn weak sales into closed deals across every unclosed month — warned before acceptance, abandon-at-warning logged.
- **Rule explanation:** Taglish: kapag naabot, tatakan na — hindi na gagalawin kahit magbago ang kota; bagong kota, bagong aplikante lang.
- **Formula or calculation:** NOT DOCUMENTED beyond freeze + prospective application
- **Inputs:** Frozen dates; new threshold value + effective point
- **Outputs:** Unchanged historical qualifications; live judgement for unqualified sales
- **Conditions:** Any threshold change
- **Exceptions:** None — no retroactive re-judgement
- **Effective dates:** 2026-08-20
- **People and permissions:** Director-only change (see BR-AUTH-01)
- **Workflow:** Threshold changed → frozen rows untouched → unqualified sales judged live from current unclosed month onward.
- **Current code behavior:** v2 freezes commercial terms per sale (`snapshotSaleTerms`, `api/_lib/commerce.ts:193-201`); commission rules carry effective windows with no-overlap enforcement (`20261018000002_afhomes_flexible_commission_rules.sql:11-12,26-37,111-112`); Bronze/Silver/Gold 4% zeroed prospectively, history untouched (`:130`).
- **Gap analysis:** Partial — prospectivity/freeze principle matches; per-sale qualification dates do not exist in v2.
- **Related tests:** `api/_lib/commerce.spec.ts` — 33 passed 2026-10-14 (snapshot helper behavior; not threshold-conformance).
- **Dependencies:** BR-AUTH-01, BR-PB-01 (B19 floor posture)
- **Open questions:** Q1
- **History:** None

### BR-QLF-04 — Refund removes qualification outright; replacement qualifies from zero

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R15; RV-22 (CANCELLED + UPGRADED both leave closed-deal TCP, frozen date cleared); A4 §3.2 (negative = refund, only against cancelled sale); A6 Part 4 (audit flags below-reference-line fallbacks); B8 §5 self-test (UPGRADED VIP with refund leaves; IGP beside untouched); B2 `HasRefund`/`CheckRefundOrphans`; A2 Control Panel A24 (v10.1.1: UPGRADED/DOWNGRADED old row + receipts stop counting, receipts MOVED to new number; CANCELLED receipts REMAIN in collection totals, partial refunds as NEGATIVE receipts only against CANCELLED; counts still blank/ACTIVE-only); A2 Reference R44–R50 (upgrade = NEW transaction/number/terms, old kept UPGRADED never reused, "Replaces" link, old card recalled/voided), R52–R56 (status codes)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Qualification is judged PER TRANSACTION. A refund is not a slide down a percentage — it is a real refund, or a full refund followed by an upgraded/downgraded repurchase. Any refund receipt against a sale, or any status other than blank/ACTIVE, strips qualification and clears the frozen date. The replacement purchase is a new sale qualifying from zero on its own collections. UPGRADED/DOWNGRADED: old row and receipts stop counting and receipts are MOVED to the new number (A24); the upgrade runs fully under the NEW number with the old card recalled and voided (Reference R46–R50). CANCELLED: terminated with no new sale — receipts REMAIN in collection totals (cash accounting) with partial refunds as NEGATIVE receipts, while sales counts and TCP totals exclude the row (A24; Reference R56). On apparent tension with Reference R55 ("UPGRADED still counts"), see CF-06 — resolved by document hierarchy toward A24/R15.
- **Rule explanation:** Taglish: may refund, tanggal ang pagiging closed deal — burado ang petsa; ang kapalit, bagong benta, umpisa sa sero.
- **Formula or calculation:** IF any negative receipt on sale OR status ∉ {blank, ACTIVE} → qualification blank (B2 `QualFormula` body, verified)
- **Inputs:** Refund receipts (Collections col D < 0); Register status (col Z)
- **Outputs:** Qualification cleared; Closed Deal TCP Audit flag (below reference line, audit C4 = 10% advisory)
- **Conditions:** Any qualified sale receiving a refund or non-blank/ACTIVE status
- **Exceptions:** None — UPGRADED/DOWNGRADED treated same as CANCELLED on VIP register
- **Effective dates:** 2026-08-20
- **People and permissions:** Cashier raises with Director (A6 Part 4); Director investigates
- **Workflow:** Refund posted → qualification stripped + date cleared → replacement sale qualifies from zero.
- **Current code behavior:** v2 excludes `rejected`/`voided` from all totals and re-checks verified sums in-transaction (`api/_lib/commerce.ts:50-114`; `phase2_rpc.sql:78-132,224-352`). No frozen-qualification stripping concept.
- **Gap analysis:** Partial — reversal-exclusion principle matches; strip-and-restart semantics not located.
- **Phase 4 finding (2026-10-14):** v2 card payments have no refund path (verified is terminal; no refund endpoint), so the strip rule has no card-payment target — applying it would require inventing card refunds. Operational-purchase reversals exist but are CODE_ONLY (no document source). Left as documented-vs-code gap, not implemented.
- **Related tests:** `api/_handlers/sale-payments.spec.ts`, `sale-cancel.spec.ts` — passed 2026-10-14 Phase 3 batch (handler contracts, not strip semantics).
- **Dependencies:** BR-QLF-01, BR-CTL-03
- **Open questions:** Q1
- **History:** None

### BR-QLF-05 — Closed-deal gate and stage-1 payout gate are independent

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx` + `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` + `A7-QA_Glossary-Ambiguous_Terms-2026-09-10.docx`
- **Source location:** C2 §3 (two-gates passage); B8 §2 (E10/F10 VIP 40%→100%, E11/F11 IGP 40%→40%); A4 §2 (the day-to-day distinction); A7 §1 (THRESHOLD: counts vs pays)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** The closed-deal threshold decides whether a sale COUNTS toward BA/PA/PB statistics; the stage-1 threshold — 40% for JA&D and AFhomes IGP, 40% releasing 100% for AFhomes VIP — decides when DSC, DRI and Override actually PAY OUT, remainder on full payment. A sale can be a closed deal and have paid out no commission. The two must never be conflated.
- **Rule explanation:** Taglish: magkaiba ang "bilang" at "bayad" — puede nang bilang pero wala pang bayad; huwag paghaluin.
- **Formula or calculation:** Gate 1: cumulative ≥ 25%/10% → counts. Gate 2: cumulative ≥ 40% → VIP releases 100% of DSC/DRI, IGP releases 40%, remainder on full payment.
- **Inputs:** Same cumulative per sale; two thresholds
- **Outputs:** Statistics inclusion (gate 1); commission release (gate 2)
- **Conditions:** Every sale, both gates evaluated independently
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** A4 §2: the distinction clerks/supervisors must hold daily
- **Workflow:** Counts at 25%/10% → pays at 40% → remainder at full payment.
- **Current code behavior:** NOT VERIFIED — no stage-release gates in v2; commission pays via manual qualify→earned→paid (`lifecycle.ts:239-244`).
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-QLF-02, BR-PB-02
- **Open questions:** Q1, Q3
- **History:** None

### BR-QLF-06 — "Qualified TCP" renamed "Closed Deal TCP" (presentational)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** OUT_OF_SCOPE
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `A7-QA_Glossary-Ambiguous_Terms-2026-09-10.docx`
- **Source location:** C2 §4 R22 (+ RV-26: audit sheet reads "Closed Deal TCP Audit", no formula breaks, figures identical); A7 §2 (old→current name table incl. `DirectorOverrideQualifiedDate` → Override Closed Deal Date macro alias)
- **Source authority:** 21 Aug 2026 naming ruling
- **Original rule:** Nothing in the arithmetic changed; only the wording — the old name invited confusion with the stage-1 threshold. No formula referenced the old sheet name. 4-August QA materials (TC-01/TC-04) read against the new name.
- **Rule explanation:** Taglish: palit-pangalan lang — walang nagbago sa tuos; ang lumang papeles, basahin sa bagong pangalan.
- **Formula or calculation:** NONE (explicitly no arithmetic change)
- **Inputs:** N/A
- **Outputs:** Renamed audit sheet + macro alias
- **Conditions:** All pre-21-August documents
- **Exceptions:** None
- **Effective dates:** 2026-08-21
- **People and permissions:** QA reads old cases against new names
- **Workflow:** Rename applied at BUILD 2026-09-10a; old Revision Notice/Test Instructions mapped by name.
- **Current code behavior:** N/A — workbook-internal rename; v2 uses `verified` terminology, no TCP naming.
- **Gap analysis:** Out of scope for v2 (no shared artifact).
- **Related tests:** None.
- **Dependencies:** None
- **Open questions:** None
- **History:** None
