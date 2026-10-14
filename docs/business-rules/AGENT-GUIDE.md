# Agent Guide — Business Rules

Read this before changing business logic (money, rates, thresholds, eligibility, state transitions, settlement, credentials, or anything under `api/_lib/commerce.ts`, `api/_lib/identifier.ts`, `packages/contracts/src/schemas/`, `packages/shared/src/`, `api/_handlers/`, or `supabase/migrations/` touching those concerns).

1. Read `INDEX.md` first, then the applicable rule file. Never work from memory of a rule.
2. Inspect the cited company source (ZIP entry + sheet/cell/section/function) yourself. The rule file is a map, not the territory.
3. Check `CONFLICTS.md` and `OPEN_QUESTIONS.md` for anything touching your change.
4. Treat company documents as the business requirement. A clear, complete documented rule is the implementation target.
5. Never treat observed code behavior as proof of company policy. `BR-CODE-observed.md` is investigation inventory, never implementation authority.
6. Never change a documented rule to match the existing implementation. Record the gap; do not resolve it.
7. Cite rule IDs in code comments and tests when implementing rules (e.g. `// BR-QLF-02: VIP 25% threshold`). One ID per behavior; no formula duplication in comments.
8. Preserve exact formulas, thresholds, effective dates, exceptions, and audit requirements from the source. Do not round, rephrase, or "simplify" numbers.
9. Record discrepancies between rule and implementation in the rule file's Gap analysis + `CONFLICTS.md` if sources disagree.
10. Ask for missing source material only when needed to avoid inventing a requirement; keep working on unambiguous documented rules meanwhile. Missing file? Mark `SOURCE_MISSING`, name the exact file, continue elsewhere.
11. Refuse rule-behavior changes that lack a citable rule: stop, state which rule/approval is missing, and ask. Changing code without a rule is how MISMATCH rows are born.

Proposed root `AGENTS.md` addition (NOT applied — saved in the Phase 1 report for review):

> Business rules live in `docs/business-rules/` (`INDEX.md` first). The eight documentation statuses and six implementation statuses in `STATUSES.md` describe evidence only and grant no approval. No rule is APPROVED in Phase 1. Before changing business logic, follow `AGENT-GUIDE.md` steps 1–11 and cite the rule ID; without a citable rule, do not change the behavior.
