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

**Repository gates (use the target project's documented commands):**

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm check:env
```

This repo uses pnpm + Turbo (per `AGENTS.md`); the commands above are the documented gates. For another repo, verify the exact script names against its `AGENTS.md` / `package.json` rather than assuming `pnpm`, Turbo, or these names.

Gate on `pnpm typecheck` + `pnpm lint` + tests. Do not reformat files you did not
touch, and never rewrite pre-existing formatting to make a diff look tidy.
Prettier config (`semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`)
lives in `AGENTS.md` → Conventions; any deviation rule is stated in `SESSION.md`.

Focused runs (workspace-scoped):

```sh
pnpm --filter <workspace> exec vitest run <path>
# e.g. pnpm --filter api exec vitest run api/_handlers/foo.spec.ts
#      pnpm --filter @afhomes/admin exec vitest run src/features/x/y.spec.tsx
```

Workspace names for this repo: `api`, `@afhomes/admin`, `@afhomes/web`, `@afhomes/shared`,
`@afhomes/contracts`, `@afhomes/config`, `@afhomes/ui`. Verify any unfamiliar one with
`node -p "require('<pkg>/package.json').name"`.

Database (only when SQL or schema changed):

```sh
pnpm test:db:local
pnpm test:db:harness
# security invariants: run supabase/security/rls_invariants.sql (empty result = PASS)
# also: pnpm test:security:db
```

Use the target project's database test and invariant commands if applicable.

Run the project's test and database suites according to its own documentation. Avoid
running expensive suites in parallel unless the project explicitly supports it.

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

