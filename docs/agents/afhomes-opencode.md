# OpenCode session instructions

> Relocated verbatim from `AGENTS.md` (section "Automatic Skill Invocation (OpenCode)") on 2026-11-13 to reduce
> always-loaded context. `AGENTS.md` remains the authority; it keeps every
> invariant and points here. Package names updated from `@jad/*` to `@afhomes/*`.

## Automatic Skill Invocation (OpenCode)

This section applies to OpenCode only.

This project uses OpenCode with global plugins (Ponytail, Superpowers, Caveman),
MCP servers (Context7, Playwright), and 30+ global skills. OpenCode v2.2.6
automatically discovers these when the project config is minimal.

**At task start:** Identify task type → load relevant skills via native `skill`
tool → follow their instructions. Do not wait for user to invoke skills.

**Task-type → skill mapping (from engineering-router):**
- Bugs/errors: `systematic-debugging` + `root-cause-debugger`
- Features: `feature-completion-engineer` + `architecture-guardian` + `evidence-first-engineer`
- UI/frontend: `product-ui-ux` + `frontend-quality-engineer` + `accessibility-guardian`
- Database: `secure-database-engineer` + `data-integrity-guardian`
- Auth/permissions: `security-reviewer`
- APIs: `api-contract-guardian`
- Dependencies: `dependency-guardian`
- Refactor: `safe-refactor`
- Performance: `performance-engineer` (only when justified)

**Always-active:** `ponytail` (full), `caveman` (full), `using-superpowers`
**MCP:** `context7` for library docs, `playwright` for browser verification
**Subagents:** `explore` for code search, `code-reviewer`/`security-reviewer`/`database-reviewer` for reviews

**Progressive discovery:** Read AGENTS.md → identify skills → load only necessary → explore affected areas → verify.

**Verification:** After implementation, report skills loaded, MCP/tools used, subagents invoked.
