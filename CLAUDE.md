# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This is Claude Code's compact reference. Full project authority is in **AGENTS.md**.
> Current session state lives in **SESSION.md** (replace on handoff; never append).

## Project

AF Homes Ecofarm — membership-card business. pnpm + Turborepo monorepo.
React 19 + Vite 8 SPAs → TanStack Query → REST API → MongoDB (dev, active conversion) / Supabase Postgres (production, preserved).
Conversion work spans branches (check `git branch`; don't assume). Production routing is still Supabase. No Atlas import, no production cutover authorized.
Ports below are authoritative — README/AGENTS.md Layout still list stale `:5173`/`:5174`/`:3000`.

## Workspace Layout

| Path | Package | Dev port | Purpose |
|------|---------|----------|---------|
| `apps/web` | `@afhomes/web` | :5183 | Public SPA + `/customer/**` + `/ost/**` + dev staff entry |
| `apps/admin` | `@afhomes/admin` | :5184 | Staff console, base `/admin/` |
| `api/` | `api` | :3084 | Single entry `router.ts` → `_lib/router.ts` → `_handlers/**` |
| `packages/contracts` | `@afhomes/contracts` | — | Zod SSOT; `lifecycle.ts` owns every status/transition |
| `packages/shared` | `@afhomes/shared` | — | Exact-decimal money helpers (`formatMoney`, BigInt helpers) |
| `packages/config` | `@afhomes/config` | — | `VITE_`-only env reader |
| `packages/ui` | `@afhomes/ui` | — | Design tokens + shared primitives incl. `TurnstileChallenge` |
| `packages/db-testing` | `@afhomes/db-testing` | — | Disposable-Postgres DB suite + harness scripts |
| `supabase/` | — | — | Migrations (`afhomes_*` only), seeds, Super Admin bootstrap |

## Commands

**Daily:**
```sh
pnpm dev                                                        # MongoDB: API :3084, admin :5184, web :5183
pnpm --filter api typecheck
pnpm --filter <workspace> exec vitest run <path> --maxWorkers=1 # single spec
pnpm check:env                                                  # enforce browser/server env split
```

**Full gates (run before declaring a task done):**
```sh
pnpm test       # all workspaces, serial
pnpm typecheck  # all + supabase/ scripts
pnpm lint
pnpm build
```

**DB / MongoDB:**
```sh
pnpm dev:mongodb:local     # disposable synthetic runtime
pnpm test:db:local         # disposable PostgreSQL + all SQL migrations
pnpm test:db:harness       # fail-closed harness (pre-existing §77 failure — do not claim clean)
pnpm mongodb:validators    # read-only Atlas validator preflight
pnpm build:hosted / pnpm start:mongodb   # native hosting; need explicit hosted config (no deploy authorized)
```

If `turbo` says "Unable to find package manager binary", run `corepack enable` (or `npx pnpm <cmd>`).

**Single workspace typecheck / test pattern:**
```sh
pnpm --filter api typecheck
pnpm --filter @afhomes/web exec vitest run src/features/staff/staff-entry.spec.tsx --maxWorkers=1
```

## Standing User Preferences (apply without asking)

- **@ponytail full** — smallest complete change; house components first; no new deps; finish callers + tests + fixtures in the same change.
- **UI rounds are UI-only** — no handler/contract/SQL/history edits; desktop + tablet + mobile; gate: focused vitest + `tsc` + `eslint` + admin build; one named surface at a time.
- **User-facing copy** — every sentence max 5–6 words. Added copy gets reviewed and stripped.
- **Prettier is NOT a gate** (CRLF artifact on Windows). Gate on `tsc` + `eslint` only.
- **Re-check state before assuming** — `git status` / `git log` before touching anything; re-read shared files before editing; leave foreign diffs alone; never restore what user deliberately removed.
- User may edit and commit mid-session — treat working tree as unstable during long tasks.

## Critical Do-Nots

**Version control** — never without explicit in-session command:
`git add`, `git commit`, `git push`, branch, tag, stash, reset, or any GitHub action.

**Secrets** — never print or log:
passwords, TIN, government IDs, Turnstile secrets, connection strings, service-role keys, raw MongoDB errors.

**Data / deploy** — never without explicit authorization:
deploy to Vercel, `pnpm db:migrate` against production, trigger remote crons, write to Atlas, `pnpm bootstrap:superadmin`.

**`.env.local`** — read-only unless user explicitly authorizes editing. Never commit it.

## Code Conventions

- **Money** — exact-decimal text strings. Use `@afhomes/shared` (`formatMoney`, BigInt). Never float math, `to_char`, or `₱{…}` string concat.
- **Statuses/transitions** — import from `packages/contracts/src/schemas/lifecycle.ts`. Never re-declare inline.
- **HTTP from apps** — always through `apps/<app>/src/lib/api/client.ts` (`request`/`requestList`). No ad-hoc `fetch` in features.
- **Business query keys** — import from `features/business/queryKeys.ts`; invalidate by scope, never by string literal.
- **Mutations** — use `useBusinessMutation` (`apps/admin/src/lib/`).
- **Form controls** — use `@afhomes/ui` (`Select`, `TextField`, `DateField`, `TextAreaField`, `FileField`). Mark optional fields with `"(Optional)"`.
- **Styling** — CSS Modules per component; tokens from `@afhomes/ui`. No inline styles for layout/color.
- **Tests** — colocated `<target>.spec.ts(x)`. API handler tests use the in-memory Supabase fake (`api/_lib/testing/supabase-fake.ts`); MongoDB-backed specs are named `*.mongo.spec.ts` and use `testing/mongo-replica.ts`. Never import `@afhomes/mock` (removed).
- **Input normalization** — rules in `packages/contracts/src/schemas/input.ts`. Frontend normalizes on submit via `apps/admin/src/lib/normalize.ts`; handlers normalize optional fields on write.
- **Live search** — `useDebouncedValue` (~300 ms), debounced term in queryKey. Latest query wins by key change.

## Authorization Architecture

Two completely separate systems — they never share code or cross-call each other.

| System | Entry point | Mechanism |
|--------|-------------|-----------|
| Staff | `api/_lib/afhomes-access.ts` | `private.has_permission()` in SQL. Principal re-resolved per request. Deny-only restrictions. |
| Customer | `api/_lib/customer-access.ts` | Ownership (`auth_user_id`). No `modules` row for the portal. |

Client permission state is **UX-only**. The server is always the security boundary.

## Environment Isolation

- `VITE_`-prefixed: browser-only. Never read in `api/` or any server code.
- Server vars: `process.env` only. Never `import.meta.env` in `api/`.
- `pnpm check:env` enforces this. Run it after any env-touching change.

## Key Files to Read Before Starting a Task

| Task area | Read first |
|-----------|-----------|
| Any API handler | `api/_lib/handler-kit.ts`, `api/_lib/afhomes-access.ts` |
| Commerce / sales | `api/_lib/commerce.ts`, `packages/contracts/src/schemas/lifecycle.ts` |
| Customer portal | `api/_lib/customer-access.ts` |
| Auth (MongoDB) | `api/_lib/auth.ts`, `api/_lib/mongo-runtime.ts` |
| Startup / config | `api/_lib/startup-diagnostics.ts` |
| Navigation / permissions UI | `apps/admin/src/app/navigation.ts` |

## Known Pre-Existing Failures (do not fix silently)

- **`pnpm test:db:harness`** — blocked by DB suite section 77: `public.transfer_sale_team_member` sets `startsOn: null` on OST→IST conversion. Do not adjust the assertion; investigate the root cause first.
- **Sections 48, 58** — customer import referral hierarchy and purchase-terms reason refusal. Pre-exist current work.
