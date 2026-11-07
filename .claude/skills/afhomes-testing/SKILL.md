---
name: afhomes-testing
description: Choose and run the right AF Homes verification — focused vitest specs, typecheck, lint, env isolation, disposable Mongo runtimes, full gates — and report results honestly. Use after any code change or when asked to verify.
---

# Testing

## Ladder (stop at the level the change warrants)
1. Focused spec: `pnpm --filter api exec vitest run <path>` / `--filter @afhomes/admin` / `@afhomes/web` /
   `@afhomes/contracts`.
2. Workspace typecheck: `pnpm --filter <ws> typecheck`; scoped lint `pnpm --filter <ws> exec eslint <files>`.
3. `pnpm check:env` (always for env/build/server changes; `-- --built` after builds).
4. Native runtime: `pnpm test:mongodb:local`, `pnpm test:mongodb:recovery`.
5. Full: `pnpm test` (serial; API alone ~3,284 tests — release gate only). Prevent PC sleep for long runs;
   earlier runs broke on sleep/time jumps.

## Output discipline
- Redirect long runs to a log in the scratchpad; show only summary + failures + exit code.
- Never claim a pass you didn't see. Never raise timeouts, skip, or weaken assertions to go green.
- Write the failing (red) test first for bug fixes.

## Never
Point tests at Atlas or shared DBs. Use real customer data as fixtures.
Browser acceptance is separate from unit proof — say which you did.
