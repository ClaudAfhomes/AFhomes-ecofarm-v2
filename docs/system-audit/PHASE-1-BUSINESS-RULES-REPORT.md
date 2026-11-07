# Phase 1 Implementation Report — Business Rules Documentation and Source Extraction

- Date: 2026-10-14 (UTC). Documentation only — no application, schema, migration, data, or calculation changed. ZIP never repackaged.
- Test execution this phase (offline unit suites only; commands, all passing):
  - `pnpm --filter ./packages/shared exec vitest run src/money.spec.ts` — 14 passed
  - `pnpm --filter ./api exec vitest run _lib/commerce.spec.ts` — 33 passed
  - `pnpm --filter ./packages/contracts exec vitest run src/schemas/input.spec.ts src/schemas/purchase-flow.spec.ts src/schemas/redemption.spec.ts src/schemas/points.spec.ts` — 74 passed
  - Total: 121 passed. These verify helper/contract behavior, NOT workbook-rule conformance — no rule is marked TEST_VERIFIED on that basis.

## 1. Files created/changed

Created under `docs/business-rules/` (21 files, no other paths touched):

- `INDEX.md`, `_TEMPLATE.md`, `STATUSES.md`, `AGENT-GUIDE.md`, `CONFLICTS.md`, `OPEN_QUESTIONS.md`, `CHANGELOG.md`
- `BR-GEN-allowances.md`, `BR-ENG-periods.md`, `BR-QLF-qualification.md`, `BR-AUTH-governance.md`, `BR-REV-reviews.md`, `BR-PB-bonus.md`, `BR-ACM-assumed.md`, `BR-PAR-parallel.md`, `BR-DUAL-roles.md`, `BR-RATE-freeze.md`, `BR-CTL-controls.md`, `BR-CUT-cutover.md`, `BR-OPS-golive.md`, `BR-CODE-observed.md`
- Plus this report (`docs/system-audit/PHASE-1-BUSINESS-RULES-REPORT.md`). Root `AGENTS.md` NOT edited (proposal in §11 below).

## 2. Unique IDs

Every documented rule has a unique ID: BR-GEN-01…07, BR-ENG-01…05, BR-QLF-01…06, BR-AUTH-01…02, BR-REV-01…03, BR-PB-01…04, BR-ACM-01…04, BR-PAR-01…02, BR-DUAL-01…03, BR-RATE-01…05, BR-CTL-01…06, BR-CUT-01…02, BR-OPS-01…05 (48 total), plus BR-CODE-01…12. No duplicates; INDEX is the authority for the ID set.

## 3. Source references

Every rule carries exact source filename + version/build + location (sheet/columns/cells, doc section, or VBA/Apps Script procedure:line). Two VBA function bodies verified at source level (`QualFormula` B2:660, `FreezeSaleRates` B2:534); all other B2/B4 citations are procedure-level (name + file line from grep). Rules depending on absent files are marked accordingly (BR-CUT-02, BR-PB-04 contract text; BR-CTL-05 authority).

## 4. Formulas and numeric values

Every rate/percentage/threshold/date carries its source ref (Table A grid, 25%/10%, 40% gates, 40%/20% credits, 16/31, 135,000 worked example, caps 25/40/60k as observed-code values). VIP DSC default honestly recorded as NOT DOCUMENTED (BR-RATE-05, Q7). No invented scenarios — zero hypothetical examples were needed.

## 5. Code/test references and classification

Code refs are real paths with verified line numbers where grep-confirmed (commerce.ts, money.ts, lifecycle.ts, phase2/phase4/commission/points migrations, commissions.ts, sales.ts); remainder explicitly marked probe-reported. Statuses used: SOURCE_DOCUMENTED 44, PARTIAL 1 (BR-RATE-05), OUT_OF_SCOPE 3, CODE_OBSERVED 12. Implementation: NOT_IMPLEMENTED 33, PARTIAL 11, MISMATCH 1 (BR-QLF-02), NOT_ASSESSED 1 (BR-CUT-01), OUT_OF_SCOPE 3. Conceptual-only mappings labeled `CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED` in INDEX and rule files.

## 6. Code-only separation

`BR-CODE-observed.md` carries the UNAPPROVED banner; INDEX segregates all 12 CODE_OBSERVED items; AGENT-GUIDE forbids implementing from it. No code-only behavior appears in any BR-*.md rule file.

## 7. Conflicts and missing files

5 conflicts recorded without resolution (CF-01 model authority, CF-02 gate mismatch, CF-03 C2 version, CF-04 contract-gap cure, CF-05 Master List). 12 missing files recorded (C3–C7, D1–D7) with dependent claims named. Master List recorded unresolved (no such file/sheet among the 18 present; candidates rejected with reasons).

## 8. Sources not fully inspected

Cell-level workbook formulas beyond the two VBA bodies; Control Panel exact cells (values taken from B8 §2 as documented, not re-read from cells); B5/B6 matrices; JAD-side internals (inventoried + sheet names only, per repo JAD exclusion); Rev B/C memoranda, contract addendum, v4.3/v2.4 contracts, Pack D (absent). Full `pnpm test` and `test:db:local` not run (need Q10 approval).

## 9. Counts

- Rules extracted: 48 documented + 12 code-observed = 60. Domains: 14 files.
- Source gaps: 12 absent files + Master List identity + VIP DSC default + CTL-05 authority.
- Mismatches: 1 MISMATCH (BR-QLF-02) + 11 PARTIAL-implementation gaps + 33 NOT_IMPLEMENTED.
- Unverified: all handler/DB test citations (NOT RUN); 121 helper-level tests passed (not rule conformance).

## 10. Next phase and highest-impact mismatches

Next: stakeholder review of OPEN_QUESTIONS Q1–Q10 (Q1 blocks all authority). Highest impact: CF-01 (which model governs), CF-02/BR-QLF-02 (25% vs 100% gate), BR-CUT-01 applicability (Q2), and the entire BR-CODE-08 points engine (largest unapproved surface). No implementation work begins until Q1 is answered; per standing instruction, clear documented rules are then implemented as-is, not re-approved, and code mismatches are fixed toward the document — never the reverse.

## 11. Proposed AGENTS.md addition (NOT applied — for review)

```markdown
> Business rules live in `docs/business-rules/` (`INDEX.md` first).
> Statuses in `STATUSES.md` describe evidence only and grant no approval;
> no rule is APPROVED in Phase 1. The Generator payroll model and the v2
> card/points model are an unresolved mismatch (see `CONFLICTS.md` CF-01):
> do not assume either side governs; do not implement cross-model
> conformance without a presidential ruling. Before changing business
> logic, follow `AGENT-GUIDE.md` steps 1–11 and cite the rule ID; without
> a citable rule, do not change the behavior. Observed code is never
> authority. Per standing instruction, a clear documented rule is the
> implementation target — code mismatches are fixed toward the document.
```
