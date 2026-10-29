# AF Homes Ecofarm

MongoDB conversion work is on local `claud/mongodb-conversion` in this repository.
See [active workspace and verification](docs/mongodb/WORKSPACE-HANDOFF.md).
Default runtime still uses Supabase. The controlled `pnpm dev:mongodb:local`
command uses a fresh disposable local database; the existing administrator and
shared databases must remain untouched.

TypeScript monorepo for the AF Homes Ecofarm platform — membership-card sales,
operations, and staff administration. pnpm workspaces + Turborepo.

## Layout

- `apps/web` - public SPA (React + Vite): marketing site, customer portal
  (`/customer/**`: login, activate, dashboard, card, points, profile), and
  OST/staff surfaces. Production base `/`.
- `apps/admin` - staff operations console (React + Vite): dashboard, staff,
  departments, roles & permissions, plus business (products, sales, payments,
  activation), redemption, documents, genealogy, memberships, OST, CMS and
  reports. Production base `/admin/` (also `/staff`, `/employee`, `/finance`,
  `/hr`, `/sales`).
- `api/` - REST API as a single Vercel Function, backed by Supabase Postgres +
  Supabase Auth.
- `packages/contracts` - Zod request/response contracts (single source).
- `packages/config` - typed public environment.
- `packages/shared` - framework-free exact-decimal money helpers.
- `packages/ui` - design tokens and shared components.
- `supabase/` - migrations, reference seed, Super Admin bootstrap, RLS audit.
- `docs/supabase/` - Supabase Free capacity SSOT (`SUPABASE-FREE.md`) plus
  phased implementation plans (`solutions/`: egress, database, MAU, storage,
  log ingestion, log query).

## Commands

```sh
pnpm install
pnpm dev          # dev servers (web :5173, admin :5174)
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm lint
pnpm build
pnpm format       # prettier --write .
pnpm check:env    # environment isolation guard

pnpm db:migrate               # apply supabase/migrations
pnpm seed                     # reference plans only
pnpm seed:demo                # preview-only; refuses the production project
pnpm bootstrap:superadmin     # one-time invite-based Super Admin bootstrap

pnpm test:db:local            # DB suite against a disposable local PostgreSQL
pnpm test:db                  # …against an approved dev DB URL

pnpm exec tsx api/dev-server.ts   # local API on :3000
```

## Conventions

Engineering conventions and invariants live in `AGENTS.md` — read it before
changing authorization, RLS, migrations, or money handling. `AGENTS.md` is the
authority for the current scope; the retired JAD reference material was removed
from the repo during cleanup.
