# 00 — Graphify + Obsidian Workflow Guide

This file is part of the self-contained Graphify + Obsidian workflow pack. It distributes content from the former root-level `WORKFLOW.md`, which has now been retired in favour of this pack. `AGENTS.md` remains the higher authority.

Original `WORKFLOW.md` preamble:

# WORKFLOW.md — operating manual for the AF Homes OpenCode agent

**Recurring user instruction:** `Read @WORKFLOW.md before doing my task.`

This file tells you *how to work* in this repository. It does not tell you
*what the rules are*. Every stage below defers to `AGENTS.md`.

---

## 0. Authority order (read first, applies everywhere)

1. **`AGENTS.md`** (repo root) — authoritative for repository instructions,
   approval gates, security, database invariants, deployment, git policy.
2. **This workflow pack (`workflow/graphidian/*.md`)** — process only.
   **Never overrides, relaxes or contradicts `AGENTS.md`.** If the two
   disagree, `AGENTS.md` wins and you report the conflict instead of picking
   a side.
3. **Repository source + SSOT docs** — actual behaviour. `supabase/migrations/`,
   `packages/contracts/src/schemas/`, `apps/*/src`, `api/**`, and the specs
   decide what the system does.
4. **Obsidian vault** — a *navigator*, never an authority. If a vault note
   contradicts the repository, **the repository wins** and you propose a
   correction to the note.
5. **Graphify graph** — a *structural index*, not a source of business truth.
   A semantic or inferred edge is never an established rule.

### Standing hard rules (never relaxed, at any stage)

- **Git state is untouchable** unless the user explicitly authorizes it in the
  current session. No `add`, `commit`, `push`, `branch`, `tag`, `stash`,
  `reset`, `checkout`, merge or GitHub action. Read-only git
  (`status`, `log`, `diff`, `rev-parse`, `show`, `ls-files`) is always fine.
- **No approval-gated action without approval:** deploying, running migrations
  against production, triggering remote crons, Super Admin bootstrap,
  production seed, or altering business rules / architecture / security
  controls / permissions / RLS.
- **Never** persist or echo secrets, credentials, tokens, keys, connection
  strings, or customer PII — not into the vault, not into generated graph
  artifacts, not into reports, not into audits.
- **Never** hand-edit generated graph notes under `Graphify-Export/`.
- **Never** read the whole generated graph export in bulk.
- **Never** claim a check passed that did not run. "Skipped", "blocked" and
  "not run" are valid, valuable answers.
- **Never** edit `.opencode/**` — `opencode.json` sets `permission.edit` to
  `deny` for that path (and `.opencode/` is gitignored as local-only).
- **User-owned files, leave alone:** `SESSION.md`, `docs/security/`,
  `docs/testing/`. Edit them only if the user asks directly.

### How the four things fit together

```
        user instruction
              |
              v
   AGENTS.md  ---------> WHAT is allowed / required  (authority)
   WORKFLOW.md ---------> HOW to work, in order       (process)
              |
     +--------+---------+
     |                  |
     v                  v
  Graphify            Obsidian vault
  (graphify-out/)     (C:\...\Documents\DevVault)
  structure & deps    curated knowledge
  VERIFY in source    VERIFY in repo
```

Use Graphify to *find* the code. Use Obsidian to *recall* the reasoning. Read
the code and `AGENTS.md` to *decide*. The two never decide.

---

## 12. Task-type quick reference

This is the lookup form of the Stage 2 decision rule ("which tools this task
actually needs"). Use Section 2 to decide; use this table to confirm.

| Task | Graphify | Obsidian | Mandatory gates |
|---|---|---|---|
| UI / copy tweak | — | maybe (if a lesson) | `pnpm test` (focused), `pnpm typecheck`, `pnpm lint`, `pnpm build` |
| Feature (handler+contract+screen) | `affected` | `Business-Rules`, `System-Flows` | plan if cross-cutting, full focused suite |
| Bug fix | `explain` on the suspect | `Known-Issues`, `Lessons-Learned` | reproduce first, failing-first regression test |
| SQL / migration | `path` to the function | `Data-Model` | **approval gate**, `test:db:local`, `rls_invariants.sql` |
| Security / RLS / PII | — | `Security-Notes` | **approval gate always** |
| Release / deploy | — | `Known-Issues`, `docs/handoffs/` | **explicit deploy approval** |
| Docs / vault update | — | — | `AGENTS.md` approval policy (Stage 9) |

---

## 13. Known limitations of this file

- Graphify commands were verified against the installed CLI on 2026-10-18
  (`graphify 0.9.92`). Re-run `graphify --help` if behaviour differs.
- The `Graphify-Export/` note count is intentionally not recorded — it changes
  on every re-export.
- The graph was last built at commit `73f0a85` (7,861 nodes / 23,902 links). HEAD
  is now `6681fcc` (one commit ahead) and the working tree carries uncommitted
  changes, so the graph is stale by the Stage 8.1 git-diff criterion — refresh it
  before relying on it. Treat these as a snapshot, not a permanent fact;
  re-measure per Stage 8.3.
- Vault note locations reflect the vault as inspected on 2026-10-18; if a note
  moves, follow the file, not this table.
- `docs/business-rules/` is documentation-only corpus with mixed implementation
  status — see Stage 3.3 before citing any rule from it.


## Project customization

Fill in these placeholders for the target repository before relying on this pack:

- `<vault-root>`: `C:\Users\SSD-ORLANDO\Documents\DevVault`
- `<graphify-output>`: `graphify-out/` relative to the repository root
- `<session-handoff-file>`: the project's handoff file, if any
- `<security-docs-dir>`, `<testing-docs-dir>`: project documentation directories
- `<contracts-dir>`, `<api-lib-dir>`, `<migrations-dir>`: project source directories
- `<security-invariants-file>`: project security invariant check, if any
- `<test-command>`, `<typecheck-command>`, `<lint-command>`, `<build-command>`, `<env-check-command>`: project verification commands
- `<db-test-command>`, `<db-harness-command>`, `<security-invariants-check>`: database checks, if applicable
- `<admin-workspace>`, `<web-workspace>`, `<api-workspace>`: project workspace names

Filled-in values for this repo (see the audit for the full mapping):

- `<vault-root>`: `C:\Users\SSD-ORLANDO\Documents\DevVault`
- `<session-handoff-file>`: `SESSION.md` (repo root)
- `<security-docs-dir>`: `docs/security/`
- `<testing-docs-dir>`: `docs/testing/`
- `<contracts-dir>`: `packages/contracts/src/schemas/`
- `<api-lib-dir>`: `api/_lib/`
- `<migrations-dir>`: `supabase/migrations/`
- `<security-invariants-file>`: `supabase/security/rls_invariants.sql`
- `<business-rules-docs>`: `docs/business-rules/`
- `<capacity-doc>`: `docs/supabase/SUPABASE-FREE.md`
- `<migration-applications-doc>`: `docs/supabase/MIGRATION-APPLICATIONS.md`
- `<current-schema-doc>`: `docs/supabase/CURRENT-SCHEMA.sql`
- `<handoff-docs-dir>`: `docs/handoffs/`
- `<test-command>`: `pnpm test`; `<typecheck-command>`: `pnpm typecheck`;
  `<lint-command>`: `pnpm lint`; `<build-command>`: `pnpm build`;
  `<env-check-command>`: `pnpm check:env`
- `<db-test-command>`: `pnpm test:db:local`; `<db-harness-command>`: `pnpm test:db:harness`;
  `<security-invariants-check>`: run `supabase/security/rls_invariants.sql` (empty = PASS)
- `<admin-workspace>`: `apps/admin` (`@afhomes/admin`); `<web-workspace>`: `apps/web` (`@afhomes/web`);
  `<api-workspace>`: `api`

The Obsidian vault path is fixed at `C:\Users\SSD-ORLANDO\Documents\DevVault` because that vault contains the project folder for this workflow.
