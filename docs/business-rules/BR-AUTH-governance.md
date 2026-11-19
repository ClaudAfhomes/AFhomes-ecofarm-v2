# BR-AUTH — Director-Controlled Figures, Per-Person Rates, Logging

- Status: both SOURCE_DOCUMENTED / PARTIAL (gated-change principle matches; no parameter console in v2)
- Sources: C2 §3 (R16–R17); A6 §5.1; A4 §6; B2 `DirectorSetParameter` (:1065), `DirectorSetPersonRate` (:1234); B8 §2

### BR-AUTH-01 — Every pay-governing figure is Director-only, range-checked, warned, logged

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R16; RV-23 (Clerk/Supervisor typing into CONFIG or rate cells refused; Director console accepts, range-checks, warns, logs old→new; abandon-at-warning logged); A6 §5.1 (percentages typed as 10/40, pesos in amounts; DEFAULT restores shipped value; threshold-lowering warning); B2 `DirectorSetParameter` (:1065)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Thresholds, release portions, default rates, contract standard allowances, the Table A grid, closed-deal thresholds and the audit reference line are LOCKED cells no Clerk/Supervisor can change whatever sheet access they hold. The Director console shows each figure beside its shipped default, range-checks entry, warns before any change in the direction that can inflate reported performance, and logs every change old-to-new against the responsible account. Abandoning at a warning is itself logged. Control is the record, not the restriction (A6 Part 1): the Director can move any figure; the system guarantees capture.
- **Rule explanation:** Taglish: numero ng sahod, Direktor lang ang gagalaw — may babala kapag pataas, may tala kahit umatras.
- **Formula or calculation:** NOT DOCUMENTED (governance, not arithmetic)
- **Inputs:** Parameter group + figure + new value (or DEFAULT)
- **Outputs:** Changed figure + log row (Timestamp, User, Sheet, Cell(s), Old, New — B8 §4)
- **Conditions:** Any change to a pay-governing figure
- **Exceptions:** None — even abandoned warnings are logged
- **Effective dates:** 2026-08-20
- **People and permissions:** Director only (password per action); clerks/supervisors refused
- **Workflow:** Pick group → figure shown beside shipped default → type value → inflation-direction warning → confirm/abandon (both logged) → backup + reason in Backup Log (A6 §5.1 step 5).
- **Current code behavior:** v2 gates money-state changes behind staff permissions per request (`api/_lib/afhomes-access.ts`) with append-only `audit_events` (AGENTS.md Phase 1); commission `earned` requires an explicit permission-gated audited decision with mandatory notes (`api/_handlers/commissions.ts:362-370`; `lifecycle.ts:239-244`). No parameter console, range-checks, or old→new value log located.
- **Gap analysis:** Partial — gated + audited change principle matches; console/range/warn/log mechanics not located.
- **Related tests:** `api/_handlers/authorization.regression.spec.ts` — NOT RUN.
- **Dependencies:** BR-PB-03, BR-QLF-03, BR-CTL-04
- **Open questions:** Q1
- **History:** None

### BR-AUTH-02 — Per-person rates resolve from standard; deviation is a logged Director act returning row to PENDING

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §3, R17; B8 §1 (Accreditation AC–AI auto from standard, locked; col BK names deviations); RV-23; B2 `DirectorSetPersonRate` (:1234)
- **Source authority:** Management rulings 20 Aug 2026
- **Original rule:** Rate columns resolve automatically from the contract standard for the position — ordinary engagements need no typing and supervisors have nothing to check. Deviating for one named person is a Director decision, logged, with the record returned to PENDING for re-approval; a dedicated column (BK) names every deviation so month-end review sees exceptions on one screen.
- **Rule explanation:** Taglish: awtomatiko ang rate ayon sa puwesto — ang ibahin para sa isang tao, desisyon ng Direktor, may tala, at balik sa pila ng apruba.
- **Formula or calculation:** Person rate = contract standard(position) unless Director-set deviation
- **Inputs:** Position, contract standard grid, deviation value + reason
- **Outputs:** Person rate + PENDING status + BK deviation flag + log row
- **Conditions:** Any named-person deviation
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** Director sets; supervisor re-approves (PENDING)
- **Workflow:** Set deviation → row to PENDING → re-approval → BK shows at month-end review.
- **Current code behavior:** v2 commission rules resolve account-specific → role default → 0% (`20261018000002_afhomes_flexible_commission_rules.sql:3,82,111-112`), service-role only (`:122`); per-sale rate frozen at issue (`commerce.ts:193-201`). No PENDING-reapproval or deviation-column concept located.
- **Gap analysis:** Partial — standard-with-override resolution matches; PENDING + named-deviation visibility not located.
- **Related tests:** commissions handler specs — NOT RUN.
- **Dependencies:** BR-RATE-03, BR-CTL-04
- **Open questions:** Q1
- **History:** None
