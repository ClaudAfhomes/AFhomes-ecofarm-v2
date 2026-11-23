# Development workflow

1. **Understand** — identify the module; load `CLAUDE.md` + one skill; read only the relevant files.
2. **Verify** — existing implementation, root cause, governing rule (`afhomes-business-rules`),
   dependencies (`graphify explain`), risk (money/auth/IDs/data = high).
3. **Plan** — non-trivial or high-risk: short plan and confirm. Trivial and authorized: proceed.
4. **Implement** — smallest correct change; reuse contracts, helpers, components; no unrelated edits;
   format only touched files.
5. **Test** — red spec first for bugs; focused specs → workspace typecheck → scoped lint → `check:env`
   when relevant → broader suites only for cross-cutting changes or release gates (`afhomes-testing`).
6. **Report** — Result / Files / Verification (commands + real outcomes) / Blockers / Next.

Gates: no git state changes, Atlas writes, deploys, env/secret changes or module enablement
without explicit per-action approval. Update `decision-register.md` when a decision is made or a
conflict is found.
