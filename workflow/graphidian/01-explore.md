## 1. Stage 1 — Start of session

**MANDATORY**

1. Read `AGENTS.md` (root, ~792 lines) and hold every applicable instruction.
   Re-read it whenever a task touches auth, money, SQL, deploy or git.
2. Read this workflow pack (`workflow/graphidian/00-guide.md`, then the stage file
   matching the task) when invoked via `@workflow/graphidian/`.
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
- `docs/business-rules/` — verify implementation status before citing any
  documented rule. Treat documentation as a navigator, not shipped behaviour,
  unless the project explicitly marks rules as approved.
- `docs/supabase/SUPABASE-FREE.md` — quotas/meters; read before changing
  queries, projections, polling, indexes, uploads or Auth surfaces.
- `docs/supabase/MIGRATION-APPLICATIONS.md` — which migrations were applied
  where and when.
- `docs/supabase/CURRENT-SCHEMA.sql` — **refresh BY AGENT only on an explicit
  "update schema" trigger from the user.** Never regenerate it incidentally.
- `docs/handoffs/` + the dated handoffs — release state and
  authorized scope. Read before any release/planning work.
- `packages/contracts/src/schemas/` — request/response SSOT; `lifecycle.ts` is
  the single source for core statuses and legal transitions.
- `api/_lib/` — pure rules, handler plumbing, and the project's
  authorization paths.

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

