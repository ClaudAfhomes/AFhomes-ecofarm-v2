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

