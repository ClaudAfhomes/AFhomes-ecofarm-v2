# BR-RATE — DSC/DRI Rates, Freezing, Anniversaries, Early Performers

- Status: MIXED (SOURCE_DOCUMENTED ×4 + PARTIAL ×1; implementation PARTIAL ×2, NOT_IMPLEMENTED ×3)
- Sources: A4 §3.1; A6 §5.2–5.3; B8 §§1–2, §6; B2 `FreezeSaleRates` (:534), `FreezeNumbers`, `DirectorUnlockSaleRate` (:1377); A7 §4 (rate columns: VIP AQ/AR, IGP AR/AS)

### BR-RATE-01 — DSC/DRI rates freeze at sale-number issue (Register AQ/AR, IGP AR/AS)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` + `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- **Source location:** A4 §3.1 (enter salesperson BEFORE number appears; system fixes rate at issue from salesperson; number FREEZES); A6 §2.1 (ORDER MATTERS); B8 §1 (rate cols); B2 `FreezeSaleRates` (:534) + `FreezeNumbers`
- **Source authority:** BUILD 2026-09-10a behavior; operational safe habit (order remains recommended after BUG-001 fix)
- **Original rule:** The sale number appears by itself and FREEZES with the DSC/DRI rates then in force, read from the salesperson (DSC) and referrer (DRI). Check date and salesperson before moving on; the frozen cells include lifecycle fields after approval (A6 Part 3).
- **Rule explanation:** Taglish: lumabas ang sale number — kasamang nagyelo ang rate; bago magpatuloy, tsek ang petsa at ahente.
- **Formula or calculation:** At issue: rate cells = live VLOOKUP from salesperson/referrer → converted to values (frozen)
- **Inputs:** Salesperson, referrer, accreditation rates at issue instant
- **Outputs:** Frozen per-sale DSC/DRI + frozen sale number
- **Conditions:** Every new sale row, both registers
- **Exceptions:** Zero rate never freezes (see BR-RATE-02); Director single-cell unlock (see BR-RATE-04)
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Clerk enters name first; system freezes
- **Workflow:** Name → number appears → rates freeze → Row Check cleared → supervisor.
- **Current code behavior:** v2 freezes `cash_price`, `minimum_down_payment`, `yearly_points`, `commission_rate`, `expected_commission` per sale (`snapshotSaleTerms`, `api/_lib/commerce.ts:193-201`, used `api/_handlers/sales.ts:447`); never recomputed from `card_plans` (AGENTS.md). Different rates frozen (single commission rate, not DSC/DRI).
- **Gap analysis:** Partial — freeze-at-issue principle matches; DSC/DRI rates absent from v2.
- **Related tests:** `api/_lib/commerce.spec.ts` — 33 passed 2026-10-14 (snapshot helper behavior; not DSC/DRI conformance). `sale-number-regression.spec.ts` — passed 2026-10-14 batch (see Phase 3 report). NEW `api/_handlers/sale-creation-order.spec.ts` — 2 passed 2026-10-14: rejected seller consumes no sale number; one number per created sale (ordering half of this rule TEST_VERIFIED; DSC/DRI freeze still absent from v2).
- **Dependencies:** BR-RATE-02, BR-RATE-04
- **Open questions:** Q1
- **History:** None

### BR-RATE-02 — Zero rate never freezes (BUG-001 fix)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx` + `B2-AFhomes_Generator_v10_2_0_VBA_Module-RevE.txt`
- **Source location:** B8 §6 (BUG-001: rate froze at 0% when salesperson not yet entered — permanent, silent, commission never appeared; fix: zero not frozen, formula stays live until a real rate appears; applied to both VBA modules + both Apps Scripts); B2 `FreezeSaleRates` (:534, `If Num(cc.Value) > 0` guard with explanatory comment — body verified)
- **Source authority:** QA finding on BUILD 2026-09-10a, fixed + retested; found in live Excel (formula correct; fault was freeze timing — formula-level verification could never catch it)
- **Original rule:** A zero means the salesperson/referrer is not yet recorded — no rate to fix yet. The formula stays live and freezes later once a real rate appears.
- **Rule explanation:** Taglish: serong rate, huwag nagyeyelo — ibig sabihin wala pang ahente; kapag nailagay, saka magyelo.
- **Formula or calculation:** IF rate cell has formula AND value > 0 → freeze to values + log `RATE FROZEN AT ISSUE`; ELSE leave live
- **Inputs:** Rate cell formula + value at freeze pass
- **Outputs:** Frozen rate or still-live formula
- **Conditions:** Every freeze pass over Register/IGP Register rows
- **Exceptions:** None — zero always defers
- **Effective dates:** BUILD 2026-09-10a (fix verified on build)
- **People and permissions:** Automatic (macro/script)
- **Workflow:** Number issued → freeze pass → zero stays live → name entered → later pass freezes.
- **Current code behavior:** NOT VERIFIED — no zero-deferral case located in v2 snapshot logic.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-RATE-01
- **Open questions:** Q1
- **History:** None

### BR-RATE-03 — Anniversary rate reviews; only new sales carry new rates

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `A6-AFhomes_Operations_Manual-2026-09-10a.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** A6 §5.2 (ACCREDITATION anniversary, not calendar year; flag current/next month — B8 §1 col AQ; `DirectorSetPersonRate`; row to PENDING; re-approval); B8 §1 col AP (latest re-accreditation, falls back to col E); A4 §5 (mid-month anniversary reviews)
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** DSC/DRI rates adjust on each person's accreditation anniversary. Sales already issued keep the rate frozen on their rows, including unreleased instalment remainders. Only new sales carry the new rate.
- **Rule explanation:** Taglish: anibersaryo ng akreditasyon ang basehan ng bagong rate — lumang benta, lumang rate pa rin kahit may matitira.
- **Formula or calculation:** New rate applies to sales issued after the rate decision; issued sales immutable
- **Inputs:** Anniversary month; Director's new rate decision
- **Outputs:** Updated person rate; unchanged issued-sale rates
- **Conditions:** Each accreditation anniversary
- **Exceptions:** Early-performer single-sale unlock (see BR-RATE-04)
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Director decides via `DirectorSetPersonRate`; supervisor re-approves PENDING row
- **Workflow:** Anniversary flagged → Director sets → row PENDING → re-approved → new sales carry rate.
- **Current code behavior:** v2 commission rules carry effective windows (`effective_from/until`, `20261018000002_afhomes_flexible_commission_rules.sql:11-12,111-112`) with no-overlap enforcement (`:26-37`); per-sale rate frozen at issue. No anniversary trigger located.
- **Gap analysis:** Partial — prospective-only rate application matches; anniversary mechanics absent.
- **Related tests:** commissions specs — NOT RUN.
- **Dependencies:** BR-AUTH-02, BR-RATE-01
- **Open questions:** Q1
- **History:** None

### BR-RATE-04 — Early-performer single-cell unlock (one rate cell, one sale, then re-approve)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- **Source location:** §5.3 (new accreditee earning higher rate on first-month first sale; `DirectorUnlockSaleRate` with register/row/DSC-or-DRI; ONE cell opens, row to PENDING, supervisor re-approves; every other sale keeps its rate) + ALSO AVAILABLE (`Override Closed Deal Date` — automatic rule normally decides; deliberate use only; logged; row to PENDING); B2 `DirectorUnlockSaleRate` (:1377), `DirectorOverrideClosedDealDate` (:1443)
- **Source authority:** BUILD 2026-09-10a behavior
- **Original rule:** Exactly one rate cell on one sale opens for an approved early performer; the row returns to PENDING and a supervisor re-approves. All other sales keep their sold-under rates.
- **Rule explanation:** Taglish: pambihirang baguhan — isang selda, isang benta lang ang bubuksan; balik-apruba pagkatapos.
- **Formula or calculation:** NONE (controlled override)
- **Inputs:** Register, row, DSC-or-DRI selector; approved rate value
- **Outputs:** Single edited rate cell; PENDING row; re-approval
- **Conditions:** Approved early performer, first-month first sale
- **Exceptions:** Closed-deal-date override exists as separate deliberate action (logged)
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Director unlocks; original flow re-approves
- **Workflow:** Approval → unlock one cell → type rate → PENDING → re-approve.
- **Current code behavior:** NOT VERIFIED — no sale-rate unlock in v2 (snapshots immutable by design).
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-RATE-01, BR-CTL-02
- **Open questions:** Q1
- **History:** None

### BR-RATE-05 — Shipped default rates (DRI 5%/4%, DSC IGP 8%; VIP DSC default NOT LISTED)

- **Documentation status:** PARTIAL
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** §2 (Control Panel B10/B11 default DRI VIP/IGP 5%/4%; E12 default DSC IGP 8%; B20/E20 assumed credit; VIP DSC default absent from the section)
- **Source authority:** BUILD 2026-09-10a shipped values — except the missing VIP DSC figure, whose absence is a documentation gap, not a zero
- **Original rule:** As listed. The VIP DSC default is NOT DOCUMENTED in the inspected sources — do not infer it from DRI, IGP, or code.
- **Rule explanation:** Taglish: DRI 5% (VIP) / 4% (IGP), DSC 8% (IGP) ang pan concealed? — ang DSC ng VIP, walang nakasulat; huwag hulaan.
- **Formula or calculation:** Rate defaults feed the per-sale freeze (BR-RATE-01)
- **Inputs:** N/A (shipped constants)
- **Outputs:** Default DSC/DRI per product
- **Conditions:** New sales without person-level deviation
- **Exceptions:** Person/deviation overrides (see BR-AUTH-02, BR-RATE-04)
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Director-only changes (see BR-AUTH-01)
- **Workflow:** Ship → freeze uses defaults → Director adjusts via console.
- **Current code behavior:** N/A — no DSC/DRI in v2.
- **Gap analysis:** Source gap (VIP DSC) + no implementation target in v2.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-AUTH-01, BR-RATE-01
- **Open questions:** Q7 (VIP DSC default)
- **Phase 5 search note (2026-10-14):** VIP DSC default absent from B8 §2, B2 `ParamInfo` (all 30 cases incl. DRI VIP/IGP + DSC IGP + full Table A grid, B2:1028+), A2 Control Panel staged history (A28), and A4/A6. Exhaustively missing from available sources — Q7 stands.
- **History:** None

### BR-RATE-06 — Invalid inputs generate NO sale number; duplicates prevented at freeze

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** TEST_VERIFIED
- **Source document:** `A2-AFhomes_VIP_IGP_Integrated_Generator-v10_2_0-BUILD_2026-09-10a.xlsx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** A2 Control Panel A23 (remediation v10.1: "invalid inputs generate NO number"; sequence caps 99,999 VIP / 9,999 IGP; duplicate-number checks) + A25 (duplicate-number prevention enforced by the Rev D control module at freeze time)
- **Source authority:** v10.1 remediation notes in-workbook (BUILD lineage); B8 records the Rev D module as installed base
- **Original rule:** Invalid inputs generate no number. Duplicate numbers are prevented at freeze time (control module); sequences are capped per series.
- **Rule explanation:** Taglish: maling datos, walang numero — ang numero, sa wastong benta lang; walang kambal.
- **Formula or calculation:** NONE (issuance-gating rule)
- **Inputs:** Validated sale request (seller, product, customer, scheme)
- **Outputs:** Issued number + frozen row, or rejection with nothing consumed
- **Conditions:** Every sale-number issuance, both registers/series
- **Exceptions:** None documented (series caps are workbook-format-specific: 99,999 VIP / 9,999 IGP — NOT transferred to v2's `next_sale_number` series)
- **Effective dates:** v10.1 remediation (20 Jul 2026 per A23); carried into BUILD 2026-09-10a
- **People and permissions:** Automatic (freeze-time enforcement)
- **Workflow:** Validate everything → issue number → freeze; rejection consumes nothing.
- **Current code behavior:** v2 validates everything before issuing numbers on all three sequential series: sales — seller (`sales.ts:400`) AND scheme (`sales.ts:422-452`, moved before numbering in Phase 5) precede `next_sale_number`; customers — referrer-role, Zod, then duplicate gov-ID/email pre-checks precede `next_customer_number` (`customers.ts:218-270`, pre-check added Phase 6); OST approval — status/sponsor/clash/email/role/invite checks all precede `nextOstNumber` (`ost.ts:410-477`, verified-conformant, no change). Duplicates prevented by DB unique constraints (`phase1:227` sale_number; customers gov-ID/email uniques + 23505 race net). Pre-Phase-5/6 orders consumed numbers before scheme validation and duplicate detection — fixed by reorder + pre-check, no other behavior changed.
- **Gap analysis:** Implemented for sales, customers, and OST approval. Membership/credential numbers are minted inside atomic RPCs (no pre-issue gap); AF-RES/AF-CSALE/AF-CC series issuance order not audited this phase (recorded gap, not claimed).
- **Gap analysis:** Implemented for v2's validation set (seller, product/customer/Zod, scheme). Workbook series caps and module-level freeze checks are format-specific and not transferred.
- **Related tests:** NEW `api/_handlers/sale-creation-order.spec.ts` — 4 passed 2026-10-14 (rejected seller → 403 + zero number calls; one number per created sale; unconfigured scheme → 409 + zero number calls + no row; unsellable product → 409 + zero number calls + no row). NEW `api/_handlers/customer-creation-order.spec.ts` — 3 passed 2026-10-14 (duplicate gov-ID/email → 409 + zero number calls + no row; one number per registration). Affected suites re-run green: phase2, phase26-finance, sale-payments, sale-cancel, vip-payment-schemes, application-purchase-flow, purchase-flow-migration, queues-dashboard (226 tests) + customer batch (296 tests).
- **Dependencies:** BR-RATE-01
- **Open questions:** None for the v2 mapping (caps/module mechanics intentionally not transferred — recorded above, not silent).
- **History:** Implemented Phase 5 (sales.ts reorder + 3rd test).
