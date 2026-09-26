# AF Homes Ecofarm

TypeScript monorepo for the AF Homes Ecofarm platform — membership-card sales,
operations, and staff administration. pnpm workspaces + Turborepo.

## Layout

- `apps/web` - public site SPA (React + Vite). Phase 1 ships a placeholder
  shell; public pages land in a later phase.
- `apps/admin` - staff operations console (React + Vite). Dashboard, Staff,
  Departments, Roles & Permissions.
- `api/` - REST API as a single Vercel Function, backed by Supabase Postgres +
  Supabase Auth.
- `packages/contracts` - Zod request/response contracts (single source).
- `packages/config` - typed public environment.
- `packages/shared` - framework-free exact-decimal money helpers.
- `packages/ui` - design tokens and shared components.
- `supabase/` - migrations, reference seed, Super Admin bootstrap, RLS audit.
- `legacy/` - the retired JAD Realty application, kept for reference only.
  Never applied, never imported.

## Commands

```sh
pnpm install
pnpm dev          # dev servers (web :5173, admin :5174)
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm lint
pnpm build

pnpm db:migrate               # apply supabase/migrations
pnpm seed                     # reference plans only
pnpm bootstrap:superadmin     # one-time invite-based Super Admin bootstrap

pnpm exec tsx api/dev-server.ts   # local API on :3000
```

## Conventions

Engineering conventions and invariants live in `AGENTS.md` — read it before
changing authorization, RLS, migrations, or money handling. Current scope is
`docs/AFHOMES-PHASE-1-PLAN.md`; the other documents under `docs/` describe the
retired JAD platform and are historical reference only.
