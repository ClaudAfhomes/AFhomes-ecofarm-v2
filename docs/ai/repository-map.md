# Repository map (verified 2026-11-04)

- Remote: `https://github.com/ClaudAfhomes/AFhomes-ecofarm-v2.git`
- Branch: `claud/mongodb-conversion` @ `d89023d` (many uncommitted user changes — preserve)
- Other local branches: `main`, `develop`, `claud/clean-develop`. Remote also has `release/v1.0`,
  `staging/v1.0`, `orly/develop`. **No `release/v2.0`** locally or on origin.

## Workspaces (`pnpm-workspace.yaml`: apps/*, packages/*, api)

| Path | Package | Purpose |
|---|---|---|
| `apps/web` | `@afhomes/web` | Public SPA, customer portal `/customer/**`, OST portal, marketing |
| `apps/admin` | `@afhomes/admin` | Staff console (`/admin/`) |
| `api` | `api` | REST API, handlers, native Mongo logic, scripts |
| `packages/contracts` | `@afhomes/contracts` | Zod contracts, lifecycle SSOT, role baseline |
| `packages/shared` | `@afhomes/shared` | Exact-decimal money, formatters, `FEATURE_FLAGS` |
| `packages/ui` | `@afhomes/ui` | Tokens + form/primitives |
| `packages/config` | `@afhomes/config` | Typed public env |
| `packages/db-testing` | `@afhomes/db-testing` | Disposable Postgres/Mongo harnesses |
| `supabase/` | — | Legacy migrations, seed, bootstrap (historical) |
| `deploy/digitalocean/` | — | systemd + Nginx templates |

## Entry points
- API: `api/router.ts` → `api/_lib/router.ts`; hosted `api/server.ts`; local `api/scripts/dev-mongodb-admin.ts`
- Mongo client/scope: `api/_lib/mongodb.ts`, `api/_lib/mongodb-scope.ts`
- Staff authz: `api/_lib/afhomes-access.mongo.ts`; nav `apps/admin/src/app/navigation.ts`
- Admin routes: `apps/admin/src/app/App.tsx`; admin features `apps/admin/src/features/`
- Feature flags: `packages/shared/src/features.ts`

## Commands
`pnpm dev` (real Mongo; admin 5184, web 5183, API 3084) · `pnpm dev:mongodb:local` · `pnpm typecheck` ·
`pnpm lint` · `pnpm check:env` · `pnpm test` (serial) · `pnpm test:mongodb:local|harness|recovery` ·
single spec `pnpm --filter <ws> exec vitest run <path>`.

## Noise to skip
Root `.mongodb-*.log` (~200), `outputs/`, `graphify-out/`, `vercel-static/`, `.turbo/`, `docs/mongodb/*.json`.
