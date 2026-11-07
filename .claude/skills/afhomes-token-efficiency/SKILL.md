---
name: afhomes-token-efficiency
description: Keep AF Homes sessions cheap and accurate — progressive context loading, narrow search, Graphify for structure, log/output control, model choice, compaction checkpoints and terse reporting. Use when a task risks large reads, long test output or repeated rediscovery.
---

# Token efficiency

## Load order
CLAUDE.md → `docs/ai/README.md` → one domain skill → `rg --files` → `rg -n` → exact line ranges → edit → focused test.

## Search
- `rg -n "sym" api/_lib --glob '!*.spec.ts'`; `rg --files apps/admin/src/features | rg term`;
  `git diff --stat`, `git diff -- <path>`. Use `head_limit`/`| head`.
- Exclude: `node_modules`, `outputs/`, `graphify-out/`, `vercel-static/`, `dist/`, `.turbo/`, root `*.log`
  (~200 files), `docs/mongodb/*.json`, `pnpm-lock.yaml`, `supabase/.temp`.
- `AGENTS.md` is already loaded via CLAUDE.md — don't re-read it. History is in `docs/agents/`:
  `rg -n "keyword" docs/agents/<file>.md`, then read only that range.

## Graphify (installed: `graphify` 0.9.92, graph at `graphify-out/graph.json`)
- `graphify explain "file.ts"`, `graphify path "A" "B"`, `graphify query "question"`.
- **Results may be stale** (graph built 2026-10-23, before most MongoDB work). Treat as
  navigation only; verify every file, symbol and edge in current source before relying on it.
- Skip it for known-file edits.
- Side effect: every query rewrites tracked `graphify-out/cache/last_query_stamp`. Note it in
  reports; restoring it is a working-tree change that needs the user's OK.

### Graph refresh (separately approved step only)
1. Get explicit approval; confirm `git status -- graphify-out` and record which tracked files will change.
2. Copy `graphify-out/graph.json` and `manifest.json` to the scratchpad as a rollback copy.
3. Run local AST-only `graphify update .` (no LLM; never `add <url>`, enrichment or hook install).
4. Check node count didn't drop (it refuses without `--force`; do not pass `--force` unprompted).
5. Spot-check with `graphify explain` on a recently changed `*.mongo.ts`; report changed paths. No commit.

## Output
- Long commands → log file in scratchpad; show tail/failures/exit code only.
- Report: **Result / Files / Verification / Blockers / Next**; omit empty sections.
- Terse, technical, no greetings/recaps. Keep negations, warnings, commands exact.
  Full clarity for security, finance, deployment and business-rule answers.

## Models / agents
Light model for lookups/summaries; default for implementation; strongest for finance, security,
migrations, data integrity. Don't switch mid-release workflow. Avoid subagents for routine work.

## Compaction checkpoint
Branch · goal · changed files · verified findings · tests + results · blockers · next step.
