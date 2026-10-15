# Status Definitions

Statuses describe **evidence and implementation progress**. They are not business-policy approval gates: a clear, complete documented rule remains the implementation target even when the current code mismatches it. Never invent a rule to fill a gap; never relabel a MISMATCH to make it disappear.

## Documentation status (one per rule)

- `SOURCE_DOCUMENTED` — supported by an identifiable company source (filename + version + location cited).
- `CODE_OBSERVED` — found in application code but not established as a company business rule. Lives in `BR-CODE-observed.md` only.
- `PARTIAL` — only some details are supported by the available evidence (state exactly which).
- `MISMATCH` — documented rule differs from the observed implementation. Records a gap for a later phase; the documented rule is not altered to match the code.
- `SOURCE_CONFLICT` — authoritative-looking sources disagree. Both positions quoted in `CONFLICTS.md`; nothing selected silently.
- `SOURCE_MISSING` — a necessary source document is unavailable (name the exact expected file).
- `SUPERSEDED` — a source explicitly establishes replacement (cite the superseding source; inference is not enough).
- `OUT_OF_SCOPE` — a source explicitly establishes non-applicability to this system or process.

## Implementation status (one per rule)

- `NOT_ASSESSED` — implementation not yet investigated.
- `NOT_IMPLEMENTED` — required behavior checked and not found (cite the check: grep pattern, file range read).
- `PARTIAL` — only part of the documented behavior is implemented (state which part).
- `MISMATCH` — existing behavior conflicts with the documented rule (state the difference with refs).
- `IMPLEMENTED_UNVERIFIED` — code appears to implement the rule but adequate tests have not verified it.
- `TEST_VERIFIED` — relevant tests were **executed** against the documented requirement. Never claim on file existence alone; always record command, date, and result (e.g. `pnpm --filter ./api exec vitest run _lib/commerce.spec.ts — 33 passed, 2026-10-14`).

## Allowed transitions

- Any status → `PARTIAL` / `MISMATCH` / `SOURCE_CONFLICT` / `SOURCE_MISSING` when new evidence justifies it (record evidence + date).
- `SOURCE_DOCUMENTED` → `SUPERSEDED` only with a cited superseding source.
- `CODE_OBSERVED` → documented-rule file only when a company source is located and cited (rule keeps its history).
- Nothing transitions to an approval-like state in Phase 1: there is no APPROVED status in this phase by design.
