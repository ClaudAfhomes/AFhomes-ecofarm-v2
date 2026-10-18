# WORKFLOW.md — operating manual for the AF Homes OpenCode agent

**Recurring user instruction:** `Read @WORKFLOW.md before doing my task.`

This file tells you *how to work* in this repository. It does not tell you
*what the rules are*. Every stage below defers to `AGENTS.md`.

---

## 0. Authority order (read first, applies everywhere)

1. **`AGENTS.md`** (repo root) — authoritative for repository instructions,
   approval gates, security, database invariants, deployment, git policy.
2. **This `WORKFLOW.md`** — process only. **Never overrides, relaxes or
   contradicts `AGENTS.md`.** If the two disagree, `AGENTS.md` wins and you
   report the conflict instead of picking a side.
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

## 1. Stage 1 — Start of session

**MANDATORY**

1. Read `AGENTS.md` (root, ~792 lines) and hold every applicable instruction.
   Re-read it whenever a task touches auth, money, SQL, deploy or git.
2. Read this `WORKFLOW.md` when invoked via `@WORKFLOW.md`.
3. Recover prior context **only if the task is a continuation**:
   - Read `SESSION.md` **and verify it against the repository** before
     trusting it. Compare its `Repo state` claims to `git log` / `git status`.
   - If `SESSION.md` disagrees with the repo, **the repo wins**; note the
     drift in your report and do not "restore" the stale text.
   - For a genuinely new task, do **not** load `SESSION.md` — stale context
     costs tokens and misleads.
4. Establish repo state, read-only:
   ```sh
   git status --porcelain      # what is already modified (often the user's WIP)
   git log --oneline -5
   git rev-parse --abbrev-ref HEAD
   ```
   Treat existing modifications as **user work**. Leave foreign diffs alone;
   never revert, restore or "fix" something the user deliberately removed.
   Note that the user may edit and commit **while you work** — re-check
   `git status` before assuming state, and re-read shared files before
   editing them.
5. Understand the request before acting. Ask a focused question only when
   essential information is missing — do not interrogate, and do not start
   implementing an under-specified task.

**Do not** begin any edit in this stage.

---

## 2. Stage 2 — Task classification

Classify the task, then set risk and verification from it.

| Class | Typical tell | Extra obligations |
|---|---|---|
| UI / UX | admin/web page, copy, layout | visual pass at 3 widths if tooling allows; preserve every flow + permission |
| Feature implementation | new handler + contract + screen | follow Stage 4 plan; contracts are SSOT |
| Bug investigation | wrong behaviour, failing test | reproduce before fixing; `systematic-debugging` discipline |
| Refactoring | restructure, no behaviour change | prove no behaviour change with existing tests |
| Database / schema | `supabase/migrations/` | Stage 4 approval gate; `pnpm test:db:local` mandatory |
| API / backend | `api/_handlers/**` | handler + Zod contract + regression spec together |
| **Security / permissions** | authz, RLS, PII, tokens | **approval gate always**; never self-authorize |
| Testing / QA | specs, gates, harnesses | a test that cannot fail is not a test |
| Docs / knowledge | `docs/`, vault, graph | see Stage 8/9 — post-acceptance, not during |

Then state, briefly: **risk level** (low / medium / high), **system areas
touched**, **expected behaviour**, **constraints**, and **what will verify it**.

### Which tools this task actually needs

| Need | Graphify | Obsidian | Neither is enough |
|---|---|---|---|
| Trace callers, dependencies, blast radius, "what breaks if I change X" | ✅ | — | — |
| "Why is it like this", prior lesson, known trap, prior decision | — | ✅ | — |
| Behaviour, contracts, statuses, invariants, SQL, tests | — | — | ✅ **read the code** |

Skip both for: a one-file typo, a copy tweak, a question fully answered by
`AGENTS.md`. Do not skip Graphify or Obsidian when the question is structural
or historical. **Skipping a tool is a decision you state, not a silent one.**

---

## 3. Stage 3 — Context and knowledge retrieval

### 3.1 Vault (curated notes — read the matching note, never the whole vault)

Vault root: `C:\Users\SSD-ORLANDO\Documents\DevVault`

| Area | Note |
|---|---|
| Home / entry, how to work | `00-Home/Home.md`, `Knowledge-Map.md`, `Agent-Workflow.md` |
| Architecture | `01-Projects/AF-Homes-Ecofarm/Architecture.md` |
| Money, sales, activation, points | `…/Business-Rules.md`, `…/System-Flows.md` |
| Tables, migrations, grants | `…/Data-Model.md` |
| Endpoints | `…/API-Reference.md` (+ the contract file it names under `packages/contracts/src/schemas/`) |
| Auth, roles, PII, RLS | `…/Security-Notes.md` |
| Test strategy, gates, harness traps | `…/Testing-Guide.md`, `02-Engineering-Standards/Testing-Practices.md` |
| Prior breakage, open leads, deliberate non-features | `…/Known-Issues.md` |
| Approved decisions + why | `…/Decisions.md` |
| Reusable lessons, debugging patterns | `03-Learning-Log/Lessons-Learned.md`, `Debugging-Patterns.md` |
| Code standards, security practice | `02-Engineering-Standards/Coding-Standards.md`, `Security-Practices.md` |
| Accepted-work timeline | `…/Development-Log.md` |
| Generated (never hand-edit) | `…/Graphify-Export/` |

`Lessons-Learned` / `Debugging-Patterns` live under `03-Learning-Log/`, not the
project folder.

### 3.2 Graphify — run from the repo root

The default `--graph graphify-out/graph.json` is **relative**, so run from the
repo root or pass an absolute `--graph`.

```sh
graphify query "how does points redemption reach the database"   # BFS from a question
graphify explain "redeem_membership_points"                     # a node + its neighbours
graphify path "MemberDetailDialog" "api/router"                 # shortest path A->B
graphify affected "points_accounts" --depth 3                   # who breaks if this changes
graphify god-nodes --top 10                                     # architectural hubs
graphify check-update .                                         # staleness flag (cron-safe, read-only)
```

Useful flags: `query --seed X --budget N --context C --dfs`;
`explain --all`; `path --directed|--undirected`; `affected --relation R`.

**Read the exit code, not just stdout.** `query`, `path`, `explain` exit:
`0` answer · `3` ambiguous (candidates listed — disambiguate and retry) ·
`4` no node matched. **`3` and `4` are not successes.**

**Known graph blind spot (VERIFIED):** handlers reach SQL through
`db.rpc('function_name', …)` — a *string* call — so the graph has **no
handler→SQL edge**. To trace one: grep the handler for the rpc name, then read
that function's definition in `supabase/migrations/`.

If the CLI is unavailable or a query errors, **say so** and fall back to direct
source search (`grep`/`glob`). Never report a graph query that did not run.

### 3.3 Repository SSOT

- `AGENTS.md` — invariants, conventions, deployment, git policy.
- `docs/business-rules/` — ⚠️ **status MIXED; no rule is APPROVED**
  (`docs/business-rules/INDEX.md`, and `OPEN_QUESTIONS.md` Q1). Each rule
  carries `Doc` (documentation status) and `Impl` (implementation status);
  `CONCEPTUAL MAPPING — NOT FORMULA-VERIFIED` means the cited code shares the
  principle only. **Never treat a `BR-*` file as shipped behaviour** — check
  `STATUSES.md`, `CONFLICTS.md`, `OPEN_QUESTIONS.md`,
  `IMPLEMENTATION-GAP-MATRIX.md`, `CONFORMANCE-EVIDENCE.md`,
  `AGENT-GUIDE.md` first. Much of the corpus is `NOT_IMPLEMENTED` / `PARTIAL`.
- `docs/supabase/SUPABASE-FREE.md` — quotas/meters; read before changing
  queries, projections, polling, indexes, uploads or Auth surfaces.
- `docs/supabase/MIGRATION-APPLICATIONS.md` — which migrations were applied
  where and when.
- `docs/supabase/CURRENT-SCHEMA.sql` — **refresh BY AGENT only on an explicit
  "update schema" trigger from the user.** Never regenerate it incidentally.
- `docs/handoffs/CONTINUE-SESSION.md` + the dated handoffs — release state and
  authorized scope. Read before any release/planning work.
- `packages/contracts/src/schemas/` — request/response SSOT; `lifecycle.ts` is
  the single source for core statuses and legal transitions.
- `api/_lib/` — pure rules (`commerce.ts`), handler plumbing (`handler-kit.ts`),
  the two separate authorization paths (`afhomes-access.ts` staff vs
  `customer-access.ts` ownership).

### 3.4 Label every non-obvious finding

| Label | Meaning |
|---|---|
| `VERIFIED` | confirmed in source, or by actually running the thing |
| `INFERRED` | reasoned from evidence, not directly confirmed |
| `UNVERIFIED` | asserted, not checked |
| `CONFLICTING` | two sources disagree — report both, do not silently pick |

A semantic graph edge or a plausible-looking doc sentence is `INFERRED` at
best. Never promote it to a business rule.

---

## 4. Stage 4 — Investigation and planning

Establish, in writing, before editing:

1. **Current behaviour** — what actually happens now, with the evidence.
2. **Expected behaviour** — what the user asked for.
3. **Root cause / requirement** — especially for bugs: reproduce, do not guess.
4. **Affected modules and files** — Graphify `affected` / `path` plus the real
   file list.
5. **Applicable business rules and security constraints** — quote the
   `AGENTS.md` section or contract field that binds this change.
6. **Regressions and edge cases** — who else calls this, what breaks.
7. **Proposed solution** — minimal, matching existing patterns.
8. **Tests and checks** that will prove it.

### Mandatory approval gate — present a plan and wait

Stop and get explicit approval **before** implementing when the task:

- touches **security, permissions, roles, RLS, or PII**;
- changes a **business rule, status, transition or invariant**;
- adds or changes a **migration** (production apply always);
- changes **API contracts** in a breaking way;
- adds a **dependency**, or a new architectural pattern;
- is **cross-cutting** (many features/modules) or otherwise ambiguous;
- involves **deploy, cron, production data, or git state**.

Routine, low-risk, single-surface work: state the plan briefly in your reply
and proceed. **Never treat silence as approval.** Approval for one stage is not
approval for the next.

---

## 5. Stage 5 — Implementation

**MANDATORY**

- Follow existing architecture, naming, file placement and patterns. Match the
  surrounding code; do not import a style from elsewhere.
- Smallest change that fully solves the task. No opportunistic refactoring, no
  unrelated cleanup, no scope drift. If you must widen scope, say so first.
- Preserve the security invariants in `AGENTS.md` verbatim in spirit: browser
  roles stay read-only, identifiers authorize nothing, passwords/TIN/gov-IDs
  are write-only and never appear in audits, money is exact-decimal text,
  snapshots are never recomputed, `SECURITY DEFINER` functions re-check every
  precondition the handler checks.
- Finish the whole slice: handler → contract → screen → **tests** → fixtures →
  callers. A partial slice is a broken slice.
- New dependencies need justification and approval.
- Never weaken an assertion to make a test pass. Never delete a test to get
  green.
- Keep tests green as you go — run the focused suite after each meaningful
  hunk, not once at the end.
- Do not modify generated graph artifacts by hand; do not touch
  `graphify-out/` as part of implementation.

**Repository gates (from root, `package.json`):**

```sh
pnpm test          # canonical: turbo, --concurrency=2 -- --maxWorkers=2
pnpm typecheck     # turbo typecheck + tsc --noEmit -p supabase
pnpm lint
pnpm build
pnpm check:env     # environment isolation guard
pnpm format        # prettier --write . (style only; not a verification gate)
```

Gate on `pnpm typecheck` + `pnpm lint` + tests. Do not reformat files you did not
touch, and never rewrite pre-existing formatting to make a diff look tidy.
Prettier config (`semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`)
lives in `AGENTS.md` → Conventions; any deviation rule is stated in `SESSION.md`.

Focused runs (workspace-scoped):

```sh
pnpm --filter @afhomes/admin exec vitest run src/features/<area>
pnpm --filter @afhomes/web   exec vitest run src/features/<area>
pnpm --filter api            exec vitest run <path>     # the API workspace is named `api`
```

Workspace names (verify with `node -p "require('<pkg>/package.json').name"` if
one looks unfamiliar): `api`, `@afhomes/admin`, `@afhomes/web`,
`@afhomes/contracts`, `@afhomes/shared`, `@afhomes/ui`, `@afhomes/config`,
`@afhomes/db-testing`.

Database (only when SQL changed):

```sh
pnpm test:db:local     # disposable local PostgreSQL; applies shim + migrations
pnpm test:db:harness   # proves the suite fails closed on an injected fault
supabase/security/rls_invariants.sql   # empty output = PASS
```

`pnpm` runs through corepack; if `turbo` cannot find the package manager
binary, use `npx pnpm <cmd>` or `corepack enable`. Root `pnpm test` and the DB
suites are expensive — never launch two admin suites in parallel in one
workspace, and re-run a flaked suite solo before believing the flake.

---

## 6. Stage 6 — Testing and verification

In order:

1. Run the **most relevant existing tests** first (focused suite), then widen
   to the root gate when the blast radius justifies it.
2. Run applicable `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm check:env`.
   Run the **DB suites** when SQL changed — a schema that compiles is not a
   schema that works.
3. Add or update **regression tests** for the behaviour you changed. A bug fix
   without a failing-first regression test is incomplete.
4. **Review the full diff** (`git diff`, `git status`): correctness, security,
   unintended files, scope creep, leftover debug code, secrets, accidental
   changes to files you were told not to touch.
5. **Verify the requested behaviour actually works** where the environment
   permits (run the app, exercise the route, run the harness). Code that
   compiles is not behaviour that works.
6. **Report honestly.** List every check that failed, was skipped, or could not
   be executed, and why.

Use these words precisely — never collapse them into "done":

| State | Meaning |
|---|---|
| **Implemented** | code written; nothing proven yet |
| **Tested** | relevant suites run and green |
| **Verified working** | observed correct in the running app / real execution |
| **Blocked / partially verified** | something prevented full proof — say what |

Per `AGENTS.md`, open items include the browser visual pass and live
authenticated checks; report them as unverified rather than assuming.

---

## 7. Stage 7 — Wait for explicit acceptance

After implementation and verification, **stop and report**. Do not continue
into maintenance, and do not start the next task.

Report: what changed and why · files touched · tests/checks and results ·
limitations · open risks.

**Acceptance** — the user may say "Passed", "Tested and working", "Task
completed successfully", "Okay na, working na", or any phrase whose meaning is
unambiguous in context. Judge meaning, not exact wording.

**Acceptance is scoped.** It means *this task is accepted*. It is **not**:

- authorization to deploy, migrate, commit, push, or alter git state;
- approval to change business rules, architecture, security or RLS;
- approval to skip any gate in this file or `AGENTS.md`;
- blanket approval for the next task.

If the user reports a failure, go back to Stage 4 (investigate), then Stage 5,
then re-verify. Do not mark the task complete.

---

## 8. Stage 8 — Post-acceptance Graphify maintenance

Only after explicit acceptance (Stage 7).

### 8.1 Decide whether the graph is stale — cheap, read-only checks

```sh
graphify check-update .                                          # exit 0 + no output = nothing pending
node -p "require('./graphify-out/graph.json').built_at_commit"   # commit the graph was built at
git rev-parse HEAD
git diff --name-only <built_at_commit>..HEAD                     # what actually moved
```

Interpretation:

- `check-update` reports pending work, **or** `git diff` shows **source** files
  changed since `built_at_commit` → **stale, refresh it**.
- Only docs/`graphify-out/` moved → the **code graph is still valid**; say so
  and skip the rebuild (a doc-only note costs far more than it buys).
- Nothing changed → **do not rebuild.** Rebuilding an unchanged repo burns
  tokens and time for nothing.

`graphify-out/manifest.json` holds a per-file `mtime` / `seen` / `ast_hash` /
`semantic_hash`, which is what the incremental path uses.

### 8.2 Refresh — prefer incremental

```sh
graphify update .                       # re-extract changed code, no LLM needed
```

Use when refactors **delete** code and the rebuild looks smaller:

```sh
graphify update . --force               # overwrite graph.json even if fewer nodes
```

Other verified options (use only when they apply):

```sh
graphify cluster-only . --no-viz        # re-cluster + regenerate report
graphify label . --missing-only         # name only unlabelled communities
graphify extract . --code-only          # headless full re-extraction (AST only)
```

Note: **no git hooks are installed** (`graphify hook status` → all *not
installed*), so nothing rebuilds automatically — maintenance is manual and
intentional. Installing hooks would alter git state; that needs approval.

### 8.3 Verify the refresh — before claiming success

```sh
node -p "const g=require('./graphify-out/graph.json');'nodes '+g.nodes.length+' links '+(g.links||[]).length"
graphify query "check a node you touched"    # exits 0 with an answer
graphify check-update .                      # now reports nothing pending
```

Edges live in `links` (not `edges`); `directed` is `false`. A successful run
should show a non-zero node/link count and resolve a node you just changed. If
the count collapsed, you overwrote the graph with a partial one — stop and
report.

**If the rebuild fails, report the failure. Never claim the graph is current.**

---

## 9. Stage 9 — Post-acceptance Obsidian maintenance

Only after explicit acceptance, and after Stage 8 has settled the graph state.
Vault root: `C:\Users\SSD-ORLANDO\Documents\DevVault`

### 9.1 Generated export — only through the export command

Only when the graph itself was refreshed in Stage 8 (or the export is
demonstrably stale):

```sh
graphify export obsidian \
  --graph  graphify-out/graph.json \
  --labels graphify-out/.graphify_labels.json \
  --dir    "C:/Users/SSD-ORLANDO/Documents/DevVault/01-Projects/AF-Homes-Ecofarm/Graphify-Export"
```

**Never** hand-edit anything under `Graphify-Export/`. Never iterate, bulk-summarize
or copy that tree — open one note by symbol/file name when you need it. Do not
hardcode the note count anywhere; it changes on every re-export.

### 9.2 Curated notes — approval rules

Approval policy (from `AGENTS.md`): propose; apply only with approval **except**
a dated `Development-Log.md` entry that factually summarizes work the user has
**already explicitly accepted**. That exception does **not** authorize changes
to business rules, architecture, security controls, or other approval-gated
content.

| Note | Write when |
|---|---|
| `Business-Rules.md` | a confirmed business invariant |
| `Architecture.md` / `Decisions.md` | an approved architectural decision |
| `System-Flows.md` | a verified flow change |
| `Data-Model.md` / `API-Reference.md` | a confirmed structural change |
| `Security-Notes.md` | approved security documentation |
| `Known-Issues.md` | a verified outstanding issue / deliberate non-feature |
| `Lessons-Learned.md` / `Debugging-Patterns.md` | a reusable, generalizable lesson |
| `Development-Log.md` | factual summary of accepted work |

Rules:

1. **Preserve user-authored content and formatting.** Keep the front-matter
   shape (`tags`, `confidence`, `sources`, `updated: YYYY-MM-DD`) and the
   `[[WikiLink]]` style. Update `updated` when you edit.
2. `Development-Log.md` is **reverse-chronological** — a new `## YYYY-MM-DD —
   Title` section goes directly **below the intro line and above the older
   entries**, not at the bottom of the file. Entries are evidence-backed;
   speculative items belong in `Known-Issues.md`.
3. **Never duplicate** knowledge that already exists, and never promote an
   `INFERRED` finding to a verified fact.
4. **Never store secrets, credentials, tokens, keys, connection strings or
   customer PII** in the vault.
5. If nothing needs updating, **make no edit** and report that no update was
   needed. An unnecessary edit is a defect.

The whole post-acceptance maintenance pass — assessment *and* the permitted
action — is yours to perform. Do not ask the user to re-issue these
instructions.

---

## 10. Stage 10 — Final handoff

After permitted post-acceptance maintenance, report all of the following:

1. **What changed and why** — the reasoning, not just a file list.
2. **Files modified** — full paths.
3. **Tests and checks executed** — command, result; plus anything skipped,
   blocked, or unverified, and why.
4. **Graphify** — refreshed and verified (with the numbers), or why it was not
   necessary.
5. **Obsidian** — what was updated, or why no update was needed.
6. **Curated-note changes still awaiting approval** — listed explicitly.
7. **Remaining risks, limitations, known issues** — from the repo's
   `Known-Issues.md` and this session's evidence.
8. **Suggested next step**, when useful.

Do not report a successful knowledge update unless the operation *and* its
verification actually succeeded. Do not open a git commit; leave the working
tree as the user expects to find it.

---

## 11. Stage 11 — Start-of-day / end-of-day procedures

Lightweight by design. Neither routine rebuilds Graphify nor loads the vault.

### Start of day

```sh
git status --porcelain && git log --oneline -3
```

Then: verify `SESSION.md` against that output (repo wins) and read only the
curated note matching today's area. Confirm unfinished work exists, but do not
resume it unless asked.

### End of day / before a context reset

Produce a concise handoff covering:

- completed tasks and what each shipped;
- **unfinished work**, stated precisely enough to resume cold;
- failing / blocked checks and the last command that ran;
- unverified items (e.g. no browser pass, no live authenticated check);
- awaiting-approval proposals;
- whether Graphify and the vault are current.

Update `SESSION.md` **only when the user asks** — it is a user-owned file. The
existing structure works well: *Stack · Standing user preferences · Repo state ·
Last session's work · Test gotchas · Open threads · Verify commands*, dense, no
prose essays. Replace the whole file rather than appending stale sections, and
re-verify every repo-state claim before you write it.

---

## 12. Task-type quick reference

This is the lookup form of the Stage 2 decision rule ("which tools this task
actually needs"). Use Section 2 to decide; use this table to confirm.

| Task | Graphify | Obsidian | Mandatory gates |
|---|---|---|---|
| UI / copy tweak | — | maybe (if a lesson) | focused vitest, `tsc`, `eslint`, admin build |
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
- The graph was built at commit `50511e6` with 7,511 nodes / 23,390 links /
  370 communities. Treat these as a snapshot, not a permanent fact; re-measure
  per Stage 8.3.
- Vault note locations reflect the vault as inspected on 2026-10-18; if a note
  moves, follow the file, not this table.
- `docs/business-rules/` is documentation-only corpus with mixed implementation
  status — see Stage 3.3 before citing any rule from it.