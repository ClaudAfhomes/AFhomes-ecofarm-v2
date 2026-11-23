# BR-OPS — Go-Live Prerequisites and Operational Controls

- Status: MIXED (SOURCE_DOCUMENTED; implementation NOT_IMPLEMENTED ×2, PARTIAL ×2, OUT_OF_SCOPE ×1)
- Sources: C1 §§1–6; C2 §6; A4 §§3/5; A6 Part 6/App. B–C; B7/B8 version rule; IDX version rule

### BR-OPS-01 — Contract start dates for every person before first live payroll

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx`
- **Source location:** §1 (tasks 1.1–1.5: both registers, no `NO CONTRACT START DATE` rows, start-day exceptions confirmed, carried-over first-period reviews recorded as passed; back-dated NEW-agreement note); C2 §6 (prerequisite: blank → EP branch → underpayment; nothing wrong until live data)
- **Source authority:** Go-live sign-off gate (C1 §7: §§1–4 complete before first live payroll; §1 non-optional — causes silent underpayment)
- **Original rule:** Enter the contract start date for every person on both personnel sheets; confirm no `NO CONTRACT START DATE` remains; confirm non-1st/16th starts are intended; record carried-over first-period reviews as passed. New one-year agreement → enter that agreement's start, service length separately.
- **Rule explanation:** Taglish: bago ang unang sahod — lahat may petsa ng kontrata; walang petsa, kulang ang sahod nang walang babala.
- **Formula or calculation:** Blank → EP-branch treatment (see BR-ENG-02)
- **Inputs:** Personnel registers (JA&D AATS, AFhomes Accreditation)
- **Outputs:** Complete dated registers + §1 sign-off
- **Conditions:** Pre-first-live-payroll, both companies
- **Exceptions:** None — items 1–3 must complete before first live payroll (C1 §7)
- **Effective dates:** Pre-go-live gate
- **People and permissions:** Data entry + C1 §7 confirmer
- **Workflow:** Enter → verify no warnings → confirm exceptions → sign §1.
- **Current code behavior:** NOT VERIFIED — no contract-start field or EP/QP branching in v2.
- **Gap analysis:** Not located (workbook-operational prerequisite).
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-ENG-02, BR-DUAL-03
- **Open questions:** Q1
- **History:** None

### BR-OPS-02 — Placeholder passwords changed; VBA locked; three distinct secrets; Sheets editor list reviewed

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx` + `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx`
- **Source location:** C1 §2 (tasks 2.1–2.7: sheet password, differing Director password, VBA lock, distinct file-open password, Sheets Director password + editor-list review, password custody record); C2 §6; B8 §8 (placeholders ship; Apps Script Director password readable by script-editor openers — real boundary is editor list + protected ranges); A2 Control Panel A17 (shipped default protection password FD2026, CHANGE IT IMMEDIATELY on receipt — placeholder evidence)
- **Source authority:** Go-live sign-off gate + Deployment Plan v1.4/v1.4-AF (cited, not in package)
- **Original rule:** Change both module password constants on installation, lock the VBA project for viewing, keep the file-open password different from both; on Sheets change the Director password and prune the editor list (anyone opening the script editor can read it). Record who holds each password and where.
- **Rule explanation:** Taglish: bago mag-live — palitan ang panimulang password, ikandado ang module, magkakaiba ang tatlong susi; sa Sheets, ang listahan ng editor ang tunay na bantay.
- **Formula or calculation:** NONE (security hygiene)
- **Inputs:** Placeholder constants in Rev E / v2.1 modules
- **Outputs:** Changed secrets + custody record + §2 sign-off
- **Conditions:** Installation, both platforms
- **Exceptions:** None — mandatory prerequisite
- **Effective dates:** Pre-go-live gate
- **People and permissions:** Installer + password custodians
- **Workflow:** Install → change constants → lock → review editors → record custody → sign §2.
- **Current code behavior:** v2 holds secrets in environment (`.env.example` key names verified; values never read); `pnpm check:env` enforces browser/server split (AGENTS.md). Different secret model; placeholder parity not assessed.
- **Gap analysis:** Partial — secret-hygiene principle matches; workbook-specific mechanics N/A.
- **Related tests:** `pnpm check:env` — NOT RUN.
- **Dependencies:** BR-OPS-03
- **Open questions:** Q1
- **History:** None

### BR-OPS-03 — Install Rev E / Apps Script v2.1 only; verify Alt+F8 + eleven-item menu; build stamp; delete older copies

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** OUT_OF_SCOPE
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx` + `MASTER_FILE_INDEX-BUILD_2026-09-10a.docx`
- **Source location:** C1 §4 (tasks 4.1–4.8: A3 = BUILD 2026-09-10a; whole-module paste as .xlsm; `DirectorOverrideClosedDealDate` listed; fresh Sheets conversion; v2.1 + On-edit trigger + authorize; eleven-item Controls menu; protected ranges per Deployment Plan; DELETE earlier copies, not archive); C2 §6 (trailing-space filenames are older revisions — never install); IDX version rule (unstamped/older = superseded → delete, not file)
- **Source authority:** Go-live sign-off gate + index version rule
- **Original rule:** Only Rev E (built on Rev D) and Apps Script v2.1 install; verify by macro listing, menu count, and A3 stamp; every earlier copy deleted. Three earlier builds (21 Aug first issue, 31 Aug pair, 2026-08-21b/c) must not circulate — superseded copies caused most testing confusion.
- **Rule explanation:** Taglish: tamang bersyon lang — beripikahin, tapos burahin ang luma (huwag itago).
- **Formula or calculation:** NONE (installation control)
- **Inputs:** Pack B modules + workbooks
- **Outputs:** Verified install + §4 sign-off
- **Conditions:** Installation, both platforms
- **Exceptions:** None
- **Effective dates:** BUILD 2026-09-10a
- **People and permissions:** Installer; C1 §7 confirmer
- **Workflow:** Paste whole modules → verify listing/menu/stamp → ranges → delete old → sign §4.
- **Current code behavior:** N/A — workbook installation procedure. v2 deploys through the Vercel build chain (`vercel.json`: typecheck → env prep → turbo build → static assembly); no .xlsm/module installation exists. OUT_OF_SCOPE basis: IDX assigns this procedure to Pack B (workbook installers) and C1 §4 to workbook files only — no shared artifact with v2 deployment.
- **Gap analysis:** Out of scope for v2 (justified 2026-10-14 — see basis above).
- **Related tests:** None.
- **Dependencies:** BR-CTL-04
- **Open questions:** None (C2 mtime anomaly tracked separately in CF-03)
- **History:** None

### BR-OPS-04 — First-live-month run: dated backups, hand-checks, pre-5th approvals, month-start personnel changes

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** NOT_IMPLEMENTED
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx`
- **Source location:** §6 (tasks 6.1–6.7: day-one backup + log; mid-month hand-checks for 3–4 people; pre-5th approvals; second-person payroll read; rate-override column review; Close Month then immediate backup; warning-fluency review) + month-start rule (mid-month change recomputes whole unclosed month — close first)
- **Source authority:** Go-live procedure
- **Original rule:** Run the first month differently: whatever was missed surfaces in it, and pre-Close catching is far cheaper because a closed month never moves again. Personnel changes belong at month start.
- **Rule explanation:** Taglish: unang buwan, masusi — mag-backup, mag mano-manong tsek, isara muna bago magpalit ng tao sa kalagitnaan.
- **Formula or calculation:** NONE (operational runbook)
- **Inputs:** First-month live entries
- **Outputs:** Validated first close + Backup Log rows
- **Conditions:** First live month
- **Exceptions:** None
- **Effective dates:** First live month
- **People and permissions:** Director + preparer + independent reader (C1 §6.4)
- **Workflow:** Backup → enter/approve → hand-check → second read → close → backup → warning review.
- **Current code behavior:** NOT VERIFIED — no Close Month/backup-log discipline in v2.
- **Gap analysis:** Not located.
- **Related tests:** None; NOT RUN.
- **Dependencies:** BR-CTL-03
- **Open questions:** Q1
- **History:** None

### BR-OPS-05 — People and documents: guides issued, walkthroughs done, no self-approval

- **Documentation status:** SOURCE_DOCUMENTED
- **Implementation status:** PARTIAL (CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED)
- **Source document:** `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx` + `A6-AFhomes_Operations_Manual-2026-09-10a.docx`
- **Source location:** C1 §5 (tasks 5.1–5.7: User Guide to all; Manual to supervisors/Director; clerk walkthrough of one sale + one receipt; salesperson-before-number habit; approval-locks-whole-row understanding; Director holds Deployment Plan + eleven actions; agree who-approves-whom); A6 Part 1 (must-not columns; no self-approval where separation kept)
- **Source authority:** Go-live procedure
- **Original rule:** No one works unsupervised before walkthrough; no one approves their own entries where the office keeps separation; the approve-chain is agreed in advance.
- **Rule explanation:** Taglish: bago mag-isa — magsanay muna; walang apruba sa sariling gawa.
- **Formula or calculation:** NONE
- **Inputs:** Guides, manuals, staff roster
- **Outputs:** Briefed staff + agreed approval chain + §5 sign-off
- **Conditions:** Pre-live
- **Exceptions:** None
- **Effective dates:** Pre-live
- **People and permissions:** All roles per A6 Part 1 matrix
- **Workflow:** Issue → walk through → confirm habits → agree chain → sign §5.
- **Current code behavior:** v2 enforces role permissions per request + `role-baseline.spec.ts` exists; self-approval prevention not traced in this phase.
- **Gap analysis:** Partial — role-gating exists; briefing/self-approval-chain evidence not traced.
- **Related tests:** `api/_handlers/role-baseline.spec.ts` — NOT RUN.
- **Dependencies:** BR-CTL-01
- **Open questions:** Q1
- **History:** None
