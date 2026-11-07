# Provisional Business Rules Documentation Plan — AF Homes Ecofarm v2

- Date: 2026-10-14 (UTC)
- Inputs: `docs/system-audit/SYSTEM-ARCHITECTURE-AUDIT.md`, `docs/system-audit/BUSINESS-RULES-TRACEABILITY-AUDIT.md`, `Business Rules.zip` (18 of 30 files present).
- Standing constraint: the Generator payroll model (BA/PA/PB, DSC/DRI, QP/EP, Equivalent TCP, Close Month) vs the v2 application model (cards, verification, activation, points, single-level commission) is an **unresolved MISMATCH** requiring presidential ruling. Nothing below declares workbook rules approved v2 requirements, treats code as policy, deletes/replaces implementations, or resolves conflicts silently.
- Everything proposed here is a **RECOMMENDATION requiring review**. Nothing is implemented by this document.

## 1. Proposed Directory Tree

```text
docs/business-rules/
  INDEX.md               entry point + full rule map (ID → file → code → test → status)
  _TEMPLATE.md           blank rule template (normative field definitions live here)
  STATUSES.md            status definitions + allowed transitions + who may set each
  AGENT-GUIDE.md         how an agent discovers, cites, and refuses rule changes
  CONFLICTS.md           live conflict register (§7 of traceability audit, with owners)
  OPEN_QUESTIONS.md      approval-gated questions, each with required approver
  CHANGELOG.md           append-only record of every rule change (old→new, authority, date)
  BR-GEN-allowances.md   genealogy/vacancy/succession/pro-ration (BR-GEN-01…07)
  BR-ENG-periods.md      engagement dates, QP/EP, transitional month (BR-ENG-01…04)
  BR-QLF-qualification.md closed-deal qualification, freeze, refund, stage gates (BR-QLF-01…04)
  BR-AUTH-governance.md  Director-only figures, per-person rates, logging (BR-AUTH-01/02)
  BR-REV-reviews.md      QP + below-target reviews (BR-REV-01…03)
  BR-PB-bonus.md         Equivalent TCP, Table A, 40% quota (BR-PB-01/02)
  BR-ACM-assumed.md      assumed collection credit (BR-ACM-01)
  BR-PAR-parallel.md     commission/engagement independence (BR-PAR-01)
  BR-DUAL-roles.md       dual engagement, transfers, chain integrity (BR-DUAL-01/02)
  BR-RATE-freeze.md      DSC/DRI freeze, anniversary, early performer (BR-RATE-01…03)
  BR-CTL-controls.md     approval locks, Close Month, 11 actions, referral review (BR-CTL-01/02)
  BR-CUT-cutover.md      27-Sept no-grandfathering cutover (BR-CUT-01)
  BR-OPS-golive.md       go-live prerequisites (BR-OPS-01)
  BR-CODE-observed.md    code-only behaviors, all UNAPPROVED (points, spot-cash, schemes,
                         redemption txn, QR rotation, 100% activation, seller rules,
                         flexible commissions, tier discounts, portal paths)
```

One file per rule domain keeps diffs reviewable; `BR-CODE-observed.md` is deliberately separate so unapproved behavior can never be mistaken for documented rules. No file is created until Phase 1 acceptance (see §7).

## 2. File Specifications

- `INDEX.md`: table with columns `Rule ID | Domain file | Source ref | Code ref | Test ref | Status | Effective | Owner`. It is the agent's first read and the reviewer's dashboard. Any rule missing from INDEX does not exist for enforcement purposes.
- `_TEMPLATE.md`: the normative template (§3). Rule files deviate from it only by leaving fields `UNKNOWN` — never by dropping fields.
- `STATUSES.md`: the eight statuses, entry/exit criteria, who may set each, and the allowed transition graph. Statuses are set by humans (or recorded from a named authority), never inferred by an agent.
- `AGENT-GUIDE.md`: discovery order (INDEX → domain file → CONFLICTS/OPEN_QUESTIONS check), citation format for code comments and PRs, and the refusal script: agent must stop and ask when a requested change touches a rule file or a guarded code path without a cited APPROVED rule.
- `CONFLICTS.md`: one entry per §7 traceability item: competing sources quoted verbatim (short excerpts), practical impact, owner, date opened, resolution (only with authority + date + CHANGELOG entry).
- `OPEN_QUESTIONS.md`: one entry per §11 item: question, why it blocks, required approver role, date asked, answer (only with approver name + date).
- `CHANGELOG.md`: append-only; entries never edited. Format: `date | rule ID | old → new | authority | effective`.
- `BR-*.md`: 2–8 rules each, every rule fully templated. `BR-CODE-observed.md` carries a header banner: "UNAPPROVED — observed behavior only; do not implement from this file."
- Every file starts with a `Status:` line for the file as a whole (highest-attained status of its rules, or MIXED) and ends with `Last reviewed:` + reviewer.

## 3. Rule Template

```markdown
## <BR-XXX-nn> — <short name>

- Status: SOURCE_DOCUMENTED | CODE_OBSERVED | MATCH | MISMATCH | PENDING_APPROVAL | APPROVED | SUPERSEDED | OUT_OF_SCOPE
- Source document: <exact filename> (version/build, e.g. BUILD 2026-09-10a)
- Source location: <sheet + columns/cells | page/section/paragraph | function/procedure name>
- Source authority: <who issued it, e.g. "Management rulings 20–21 Aug 2026 via C2", or UNKNOWN>
- Rule statement: <faithful summary, no paraphrase drift>
- Formula: <exact formula/logic if documented, else NONE DOCUMENTED>
- Inputs / Outputs / Conditions / Exceptions: <each listed, or UNKNOWN>
- Effective dates: <only when evidenced, else NOT EVIDENCED>
- Current code behavior: <observed behavior + file:line refs, or NO IMPLEMENTATION LOCATED>
- Related tests: <spec file + case, verification status: NOT RUN / PASS (date, runner) / ABSENT>
- Approval status: <unapproved | approver + date>
- Unresolved questions: <links to OPEN_QUESTIONS entries, or NONE RECORDED>
- History: <CHANGELOG entry refs>
```

Rules are atomic: one gate, one rate, one threshold per rule. Compound rulings (e.g. R23) split into separately statused sub-rules so one approval never smuggles in an unapproved sibling.

## 4. Proposed AGENTS.md Changes (NOT applied — review only)

```markdown
> Business rules authority: `docs/business-rules/INDEX.md` is the entry point.
> Before changing business logic (any file under `api/_lib/commerce.ts`,
> `api/_lib/identifier.ts`, `packages/contracts/src/schemas/`,
> `packages/shared/src/`, `api/_handlers/`, or `supabase/migrations/`
> touching money, rates, thresholds, eligibility, or state transitions),
> the agent MUST: (1) read INDEX.md, (2) read the applicable rule file,
> (3) check CONFLICTS.md and OPEN_QUESTIONS.md, (4) cite the rule ID and
> status in the change description. If the rule is not APPROVED — or no
> rule exists — the agent MUST NOT change the behavior; it must record
> the request in OPEN_QUESTIONS.md format and ask. Observed code behavior
> is never cited as authority. `BR-CODE-observed.md` is never a basis
> for implementation.
```

Also proposed: a `docs/business-rules/` CODEOWNERS entry (president + Finance Director) and a merge-blocking check that fails when a guarded path changes without a rule-ID citation.

## 5. Traceability and Enforcement Controls (all RECOMMENDATIONS)

- **Triple citation**: every calculation carries rule ID in three places — SQL comment above the function, TS docblock above the mirror logic, spec name prefix (`br-qlf-01-*`). A rule without all three is not MATCH.
- **Guarded paths** (change requires cited APPROVED rule + human approval): `private.money()` and any money/rate CHECK regex; `record/verify/activate_card_sale` RPCs; `redeem_membership_points` + points cap/debt/conversion logic; `resolve_commission_rule` + lifecycle transition maps; `snapshotSaleTerms`/scheme economics; identifier hashing/normalization; any per-request auth change.
- **Automated checks** (to be built in a later implementation phase, not here): route-coverage-style test asserting every guarded-path diff cites a rule ID; `rls_invariants.sql` on every migration batch; `test:db:local` + `test:db:harness` green before merge; a lint rule rejecting formula duplication (formulas live in rule files; code comments cite IDs only).
- **Human-approval gates**: any status change to APPROVED or SUPERSEDED; any CONFLICT resolution; any threshold/rate/effective-date change; any new CODE_ONLY → documented-rule promotion; first-time scaffolding of the directory itself.
- **Non-goals**: agents never set statuses, never resolve CONFLICTS, never answer OPEN_QUESTIONS, never backfill formulas from variable names.

## 6. Approval and Open-Question Register (seed — carried from traceability §§7/11)

| # | Question / conflict | Blocks | Required approver |
|---|---|---|---|
| Q1 | Workbook payroll vs v2 model: operative alongside, superseded, or out of scope? | All authority | President |
| Q2 | Does the 27-Sept no-grandfathering cutover bind v2 data? | BR-CUT-01, migration policy | President |
| Q3 | Resolve MISMATCH rows (qualification gate 25% vs 100%; commission models) + effective dates | BR-QLF-01, commission rules | President |
| Q4 | Produce/absolve absent C3–C7 contracts + Pack D evidence | Contract-gap closure, test claims | President / QA holder |
| Q5 | "Master List" identity | Reading-order completeness | Package author / Finance Director |
| Q6 | C2 version authority (2026-10-11 mtime) | Top ruling document | Document owner |
| Q7 | VIP DSC default rate (missing from B8 §2) | BR-RATE completeness | Finance Director |
| Q8 | Confirm Table A values, B19=0% posture, assumed-credit rates, anniversary practice | BR-PB/BR-ACM/BR-RATE | Finance Director |
| Q9 | Validate each CODE_ONLY behavior before documentation (points, spot-cash, schemes, redemption, QR, seller rules, discounts) | BR-CODE-observed.md | President / Finance Director |
| Q10 | Approve running `pnpm test` + `test:db:local` to convert test evidence to VERIFIED | All test citations | Engineering lead |

## 7. Phased Execution Plan and Acceptance Criteria

- **Phase 0 — Freeze (this document).** No logic, schema, or docs changes. Acceptance: this plan reviewed; Q1–Q10 acknowledged by named owners; explicit go/no-go for Phase 1.
- **Phase 1 — Scaffold.** Create the tree with `_TEMPLATE.md`, `STATUSES.md`, `AGENT-GUIDE.md`, empty `INDEX.md`/`CONFLICTS.md`/`OPEN_QUESTIONS.md`/`CHANGELOG.md`; no rule content. Human approval required to merge. Acceptance: structure matches §1; template renders all §3 fields; AGENTS.md edit ( §4) reviewed but still unapplied or applied only with approval.
- **Phase 2 — Extract (UNAPPROVED).** Fill rule files from traceability §4 with statuses SOURCE_DOCUMENTED / CODE_OBSERVED / MISMATCH as classified; every number carries its source ref; unknowns marked UNKNOWN. Acceptance: 100% of §4 rules present; zero APPROVED statuses; zero invented formulas; review confirms no silent resolutions.
- **Phase 3 — Reconcile.** Work Q1–Q10 with stakeholders; record answers with approver+date; move rules to PENDING_APPROVAL only on documented authority. Acceptance: each Q has an owner response or a dated deferral; CONFLICTS entries all owned.
- **Phase 4 — Approve.** Named approvers set APPROVED per rule with effective dates; CHANGELOG entries written. Acceptance: approval = named human + date + effective range; no bulk approvals without per-rule sign-off.
- **Phase 5 — Trace.** Add triple citations (rule ID in SQL/TS/spec); build the automated checks (§5). Acceptance: every APPROVED rule has code+test pointers; guarded-path check runs in CI/local gate; `test:db:local` + harness green (needs Q10 approval).
- **Phase 6 — Controlled change.** Only now may behavior change, one rule domain at a time, citing APPROVED IDs. Acceptance per change: rule cited, tests updated, CHANGELOG entry, human approval on the diff.

Entry to each phase requires the previous phase's acceptance; any failed acceptance returns to the blocking question, never forward by exception.
