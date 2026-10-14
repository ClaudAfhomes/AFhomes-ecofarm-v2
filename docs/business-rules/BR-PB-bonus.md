# BR-PB — Performance Bonus, Equivalent TCP, Table A, Collection Quota

- Status: all SOURCE_DOCUMENTED / NOT_IMPLEMENTED (no PB, Equivalent TCP, Table A, or quota in v2 — grep VERIFIED absent)
- Sources: C2 §3–4 (R21 + quota passages); B8 §§2–3, §5; A4 §7; A7 §3 (AFhomes: PB yes, Override no)

### BR-PB-01 — Equivalent TCP carries no minimum collection rate (B19 = 0%)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx`
- **Source location:** §4, R21 (Condition D from V8/V9 NOT adopted; B19 holds 0%); RV-25 (SSM 20M TCP + 1.8M collection at 9% rate → PB IS paid); B8 §2 (B19 ships 0%; a floor can be imposed later without rebuild, with contracts amended together)
- **Source authority:** Management rulings 21 Aug 2026. Safety reasoning: a 10% floor would be STRICTER than the contract text (contracts state only Team TCP + collection gates) — the dangerous direction; the parameter stays Director-only so a floor can be imposed later with contracts amended together.
- **Original rule:** Equivalent TCP applies whenever the month's Team TCP AND the month's collection both meet their targets — however low the resulting collection RATE.
- **Rule explanation:** Taglish: kahit mababa ang porsyento ng koleksyon, basta pasado ang dalawang kota (TCP at koleksyon), may bonus — walang minimum na rate.
- **Formula or calculation:** No floor: rate gate = none. Gates actually applied: month Team TCP ≥ target AND month collection ≥ quota (40% of own PB threshold).
- **Inputs:** Month Team TCP, month collection, position PB threshold
- **Outputs:** Eligibility for Equivalent-TCP computation (see BR-PB-02)
- **Conditions:** Both stated gates met, any collection rate
- **Exceptions:** None — low rate never blocks
- **Effective dates:** 2026-08-21
- **People and permissions:** Automatic; B19 remains Director-adjustable on written notice
- **Workflow:** Month closes → both gates tested → Equivalent TCP computed without floor.
- **Current code behavior:** NOT VERIFIED — no Equivalent TCP or floor parameter in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-PB-02, BR-PB-04
- **Open questions:** Q1, Q8 (B19 posture)
- **History:** None

### BR-PB-02 — Equivalent TCP formula, quota-gated, capped (SSM pays / SVD nil worked example)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** C2 §4 R21 worked example; B8 §3 (mechanism) + §5 self-test (PB with Equivalent TCP; PB on actual TCP when collection ≥ 40% of actual)
- **Source authority:** Management rulings 21 Aug 2026
- **Original rule:** Where the month's collection is below 40% of actual Team TCP but the fixed quota is met, PB is paid on collection ÷ 40%, capped at actual Team TCP. Collection at or above 40% of actual pays on the ACTUAL figure. Worked: SSM Team TCP 20,000,000 + collection 1,800,000 clears the 1,600,000 quota → Equivalent TCP = 1,800,000 / 40% = 4,500,000 (capped at actual, unchanged) → PB = 3% × 4,500,000 = 135,000. Same figures for an SVD fail the 4,000,000 quota → nil (gate failure, not a floor). The quota is always 40% of the position's OWN PB threshold — read against the right rank.
- **Rule explanation:** Taglish: kulang sa 40% pero pasado sa kota — ang koleksyon, hatiin sa 40%, hanggang aktwal na TCP lang; iba ang kota ng SSM at SVD, huwag pagpalitin.
- **Formula or calculation:** quota = 40% × own PB threshold; if collection ≥ quota and collection < 40% × Team TCP → Equivalent TCP = MIN(collection / 0.40, Team TCP); PB = PB rate × Equivalent TCP. If collection ≥ 40% × Team TCP → PB on actual Team TCP.
- **Inputs:** Month Team TCP, month collection, own PB threshold + rate
- **Outputs:** PB amount or nil
- **Conditions:** Quota gate met; sub-40% rate (else actual-TCP path)
- **Exceptions:** SVD/SSM quotas differ — same figures pay differently by rank
- **Effective dates:** 2026-08-21
- **People and permissions:** Automatic monthly aggregate (AFhomes PB is monthly team aggregate, not per-transaction — B8 §3)
- **Workflow:** Month figures → quota test → Equivalent or actual base → rate applied.
- **Current code behavior:** NOT VERIFIED — no Equivalent TCP, quotas, or PB rates in v2.
- **Gap analysis:** Not located. Formula recorded exactly as documented; not re-executed.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-PB-01, BR-PB-03, BR-PB-04
- **Open questions:** Q1
- **History:** None

### BR-PB-03 — Table A: thresholds, allowances, PB rates per position

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** §2 Table A (Control Panel grid; Director-only via `Set Parameter`)
- **Source authority:** BUILD 2026-09-10a shipped values; SVD-below-SSM rate deliberate and confirmed (recorded so it is not "corrected" later)
- **Original rule:** Per-position grid:

  | Role | BA threshold | PA threshold | PB threshold | BA | PA | PB rate |
  |---|---|---|---|---|---|---|
  | SM | 200,000 | 1,000,000 | 2,000,000 | 15,000 | 15,000 | 1% |
  | SSM | 600,000 | 2,000,000 | 4,000,000 | 25,000 | 25,000 | 3% |
  | SVD | 1,800,000 | 5,000,000 | 10,000,000 | 50,000 | 50,000 | 2% |

- **Rule explanation:** Taglish: bawat puwesto, may sariling kota at allowance — mas mataas ang SVD, kaya mas mababa ang porsyento nito (2% laban sa 3%); sinadya ito.
- **Formula or calculation:** Allowance/rate lookups by position; BA/PA tested against BA/PA thresholds, PB against PB threshold via BR-PB-02
- **Inputs:** Position; month Team TCP / collection figures
- **Outputs:** BA, PA, PB amounts
- **Conditions:** Monthly settlement per position grid
- **Exceptions:** Per-person deviations (see BR-AUTH-02); first-month BA unconditional (see BR-ENG-03); SVD AP PA target 2,000,000 in RV-32 context (JA&D-side note, do not cross-apply)
- **Effective dates:** BUILD 2026-09-10a shipped values
- **People and permissions:** Director-only changes (see BR-AUTH-01)
- **Workflow:** Settlement → position lookup → thresholds tested → amounts released.
- **Current code behavior:** NOT VERIFIED — no Table A, BA/PA/PB in v2 (grep VERIFIED absent).
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-AUTH-01, BR-ENG-03, BR-PB-02, BR-PB-04
- **Open questions:** Q1, Q8 (confirm values)
- **History:** None

### BR-PB-04 — 40% monthly collection quota gates PA and PB (aggregate, independent)

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C2-Upgrade_Memorandum-Ruling_Addendum-2026-08-20.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** C2 §3 (AFhomes IST 40% COLLECTION QUOTA for PA/PB — monthly team aggregate, NOT per-sale; conflated with closed-deal threshold in earlier draft, now separated); B8 §2 (B12 = 40%, drives PB quota and release tests) + §3 (second independent gate)
- **Source authority:** Management rulings 20 Aug 2026; IST Service Contracts SM/SSM/SVD (absent C5–C7 — contract text single-sourced via C2)
- **Original rule:** A second, independent gate on PA and PB measured on the month in aggregate: quota = 40% of the position's own PB threshold (SSM 1,600,000; SVD 4,000,000). It is NOT the closed-deal threshold and the two must not be conflated.
- **Rule explanation:** Taglish: bukod sa kada-benta, may buwanang kota pa — 40% ng sariling PB threshold; hindi ito ang 25%/10%.
- **Formula or calculation:** quota(position) = 40% × PB threshold(position); month collection ≥ quota required for PA/PB
- **Inputs:** Month aggregate collection; position PB threshold
- **Outputs:** PA/PB eligibility (yes/no)
- **Conditions:** Monthly settlement, PA and PB only
- **Exceptions:** None documented
- **Effective dates:** 2026-08-20
- **People and permissions:** Automatic; B12 Director-only
- **Workflow:** Month aggregate → quota test → PA/PB computed or nil.
- **Current code behavior:** NOT VERIFIED — no quota gate in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-PB-02, BR-QLF-05
- **Open questions:** Q1; contract text absent (C5–C7)
- **History:** None
