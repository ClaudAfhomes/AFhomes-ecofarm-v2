# Repository safety (global)

- Branch `claud/mongodb-conversion` holds many uncommitted user changes. Never revert,
  reformat, stash or "clean up" files you were not asked to touch.
- No git state changes (add/commit/push/branch/tag/stash/reset/PR) without an explicit
  command in the current session. Reading `git status/diff/log` is fine.
- Never open or print `.env.local`, `.env.mongodb-maintenance.local`, `*.crt`, private
  storage under `~/.afhomes/`, or `outputs/` customer exports. Env var *names* are fine.
- Do not run `pnpm format` / `prettier --write .`; format only files you changed.
- Do not delete Supabase code, migrations, CMS work, disabled modules or migration
  preparation code — it is preserved on purpose.
- Archived evidence (`docs/mongodb/*.json`, capture archives) is immutable.
- Report conflicts between docs and code; never silently merge architectures.
