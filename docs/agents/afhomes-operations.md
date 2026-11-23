# AF Homes operations: bootstrap, health, deployment

> Relocated verbatim from `AGENTS.md` (sections "Super Admin bootstrap", "Health", "Deployment") on 2026-11-13 to reduce
> always-loaded context. `AGENTS.md` remains the authority; it keeps every
> invariant and points here. Package names updated from `@jad/*` to `@afhomes/*`.

## Super Admin bootstrap

`pnpm bootstrap:superadmin` is **idempotent** and never handles a password.
It is refused unless `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`AFHOMES_SUPERADMIN_EMAIL`, and `AFHOMES_ADMIN_URL` are all set and the project
host matches the expected ref.

Procedure (requires approval — do not run unattended):

```sh
npx pnpm bootstrap:superadmin -- --check   # validate config; no network
npx pnpm db:migrate                        # only when an approved migration is pending
npx pnpm bootstrap:superadmin              # reconcile after invitation approval
```

It reconciles every partial state: no auth user → invite; auth user without a
profile → create it; profile without an assignment → create it; wrong role →
correct it; already correct → report and change nothing. It deletes an auth
user on failure **only** when that run created it. A pre-existing user is never
destroyed.

The owner then accepts the invitation and sets their own password through the
Supabase-hosted recovery flow. No password variable exists anywhere.

## Health

`GET /health` (and `/api/v1/health`, and the daily Vercel cron) probes the
`modules` table. `ok` is the field to alert on:

| Condition | Status | Body |
|---|---|---|
| Database answers | 200 | `{ ok: true, db: "ok", service: "afhomes-api", time }` |
| Database errors/throws | **503** | `{ ok: false, db: "error", service: "afhomes-api", time }` |
| Supabase not configured | **500** | same shape, `ok: false` |

The response never contains credentials, keys, SQL, stack traces, or
environment values.

## Deployment

Single Vercel project, single origin:

- `/` → `apps/web/dist`, `/admin` → `apps/admin/dist`
- `/api/v1/*` → the single Function `api/router.ts`
- `/health` → readiness probe, also the only scheduled job (daily `0 0 * * *`)

Build chain: `pnpm typecheck:deploy` → `scripts/prepare-vercel-env.mjs` →
`turbo run build` → `scripts/assemble-vercel-output.mjs` (merges both SPAs
into `vercel-static/`). The leading typecheck is load-bearing: `turbo run
build` only builds the two SPAs (each runs its own `tsc --noEmit` first), and
nothing else in the chain typechecks `api/` — so without it a TypeScript error
in deployable API code would ship silently. `typecheck:deploy` is `turbo run
typecheck` (api, apps, shared packages) WITHOUT the `tsc -p supabase` half:
`supabase/` holds operator-only sources (migrations runner, seeds, bootstrap)
that `.vercelignore` deliberately excludes from the build context, so the full
`pnpm typecheck` fails on Vercel with TS5057. Full local validation always
runs `pnpm typecheck` (both halves). Never remove the typecheck step from
`vercel.json`'s `buildCommand`, and never "fix" a build by skipping API
typechecking.

- `functions["api/router.ts"].includeFiles` **must stay `packages/**`**.
  Narrowing it crashes the deployed function with
  `ERR_MODULE_NOT_FOUND .../@afhomes/contracts/src/index.ts`.
- Exactly **one** Vercel Function is discovered: `api/router.ts`. Everything
  under `api/_handlers/` and `api/_lib/` is underscore-prefixed, so Vercel never
  turns it into a function — keep it that way (the Hobby plan caps at 12).
- The only scheduled job is `/health` (daily `0 0 * * *`). The retired
  `/crons/commission-clearing` (JAD) is removed from `vercel.json`; **the
  previously deployed configuration keeps running until the next successful
  deploy**, so production will keep firing that stale cron until then.
- `VITE_WEB_URL`/`VITE_ADMIN_URL` are derived from
  `VERCEL_PROJECT_PRODUCTION_URL`. Do **not** set them in the Vercel env - that
  pins them to one host and breaks preview deployments.
- `installCommand` is `pnpm install --filter=!@afhomes/db-testing`, so the initial
  install covers 8 of 9 workspace projects and never touches
  `embedded-postgres`. Vercel still runs a second, unfiltered install
  (`Scope: all 9 workspace projects`) while processing function outputs — that
  reinstall is Vercel platform behavior, not a repo dependency: nothing in the
  codebase depends on `@afhomes/db-testing` (no manifest lists it, the `api/`
  function imports only `@afhomes/contracts` and `@afhomes/shared`, and there are no
  relative imports into `packages/`). The extra install succeeds silently
  because `allowBuilds` permits exactly the two `embedded-postgres` platform
  packages; the native binary is never loaded by the deployed function, which
  never imports the db-testing sources. Do not "fix" this by weakening pnpm
  security or by narrowing `includeFiles` (see above).

**Do not deploy, run migrations against production, or trigger remote crons
without explicit approval.**

