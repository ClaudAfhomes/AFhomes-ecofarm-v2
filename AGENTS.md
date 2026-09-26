# AGENTS.md

pnpm + Turborepo monorepo for the **AF Homes Ecofarm** platform (membership-card
business). Stack: **React 19 + Vite 8 SPAs → TanStack Query → Vercel Functions
REST API → Supabase Postgres + Supabase Auth**.

> **This file is the authority for the AF Homes codebase.** The JAD Realty
> documents under `docs/` (BUSINESS-RULES, API-SPECIFICATION, DATABASE-DESIGN,
> CHANGELOG, SESSION.md) describe the **retired** JAD platform and are kept as
> historical reference only. Do not implement from them. The current scope is
> `docs/AFHOMES-PHASE-1-PLAN.md`.

## Current state (Phase 2 — business foundation delivered)

### Phase 1 (complete)

- **Database** — `supabase/migrations/20260926023325_afhomes_phase1_foundation.sql`:
  21 tables, `private.has_permission()`, SELECT-only RLS, 3 private storage
  buckets, append-only `audit_events`.
- **AuthZ** — `api/_lib/afhomes-access.ts`; principal re-resolved per request.
- **API** — `admin/afhomes/{session,roles,departments,staff,dashboard}`, `/health`.
- **Admin SPA** — Dashboard, Staff, Departments, Roles & Permissions.

### Phase 2 (complete — foundation only, no consumer portals)

Four new migrations, all prefixed `20260927…afhomes_phase2_*`:

| File | Contents |
|---|---|
| `…_business_foundation.sql` | `referral_relationships`, `points_accounts`, `points_ledger`, `customer_onboarding_tokens`; customer/sale/payment/membership/commission columns; the new sale, customer and commission status CHECKs; partial unique indexes; 2 new modules |
| `…_rls.sql` | RLS on every new table, SELECT-only grants, and the four narrowed/widened Phase 1 policies |
| `…_rpc.sql` | `private.money`, `private.hash_token`, `private.new_fallback_code`, `private.new_qr_token`, `public.sale_financial_summary`, `record_card_payment`, `verify_card_payment`, `activate_card_sale`, `correct_referral_upline` |
| `…_support_functions.sql` | `next_customer_number`, `next_sale_number`, `issue_customer_onboarding_token` |

API families (`api/_lib/router.ts`, data-driven `BUSINESS_FAMILIES`):
`card-products`, `customers`, `sales` (+`payments`), `memberships` (+`points`),
`commissions`, `referrals`, `queues`. Handlers in `api/_handlers/`.

Contracts: `packages/contracts/src/schemas/{lifecycle,sales,finance}.ts`.
`lifecycle.ts` is the **single source for every status string and every legal
transition** in the system — handlers, contracts and tests all import it.

Pure rules: `api/_lib/commerce.ts` (commission, totals, spot cash, sellability,
seller resolution). `api/_lib/handler-kit.ts` is the shared handler plumbing.

Admin screens: `apps/admin/src/features/business/` — Card Products, Customers,
Card Sales, Payment Queue, Activation Queue (+ commission qualification).

**Still foundation-only (deliberately not built):** customer portal, OST
standalone app, NFC (none exists and none is planned), redemption, genealogy
graph, CMS, OCR, commission payout automation, points renewal, and any cron.
**No final-commission-qualification rule exists in this codebase** — the
`final_qualification_pending → earned` transition is deliberately a manual,
permission-gated, audited decision with mandatory notes. Do not invent it.

## Layout

- `apps/web` (`:5173`) - public SPA. Production base `/`.
- `apps/admin` (`:5174`) - staff operations SPA. Production base `/admin/`.
- `api/` - **one** Vercel Function (`api/router.ts`) dispatching through
  `api/_lib/router.ts`. Handlers in `api/_handlers/**` (underscore dirs are not
  functions). `api/dev-server.ts` runs the same router locally on `:3000`.
- `packages/contracts` - Zod request/response contracts. **Single source** for
  shared types; never re-declare them in apps.
- `packages/config` - typed public env (`loadPublicEnv`).
- `packages/shared` - framework-free exact-decimal money helpers.
- `packages/ui` - design tokens + shared primitives.
- `supabase/` - migrations, reference seed, Super Admin bootstrap, RLS audit.
- `legacy/` - the retired JAD application, migrations, and scripts. **Never
  applied, never imported.** `supabase/apply-migrations.ts` hard-fails if a
  non-`afhomes_` file appears in `supabase/migrations/`.
- `docs/` - SSOT. `docs/AFHOMES-PHASE-1-PLAN.md` is current; the rest is JAD
  history. Never reformat `docs/` (`.prettierignore`).

## Commands (from root)

```sh
pnpm install
pnpm dev            # turbo dev servers
pnpm test           # vitest run (all workspaces)
pnpm typecheck      # tsc --noEmit (all workspaces + supabase/ scripts)
pnpm lint           # eslint
pnpm build          # turbo run build
pnpm format         # prettier --write . (docs/ excluded)
pnpm check:env      # environment isolation guard (see "Environment")

pnpm db:migrate                 # apply supabase/migrations (guarded)
pnpm seed                       # reference plans only; no people, no money
pnpm seed:demo                  # preview-only; refuses the production project
pnpm bootstrap:superadmin       # idempotent Super Admin bootstrap (see below)
```

Local API: `pnpm exec tsx api/dev-server.ts` (`:3000`; Vite proxies `/api`).

> `pnpm` is invoked through corepack. If `turbo` reports "Unable to find package
> manager binary", `pnpm` is not on `PATH` — use `npx pnpm <cmd>` or put a
> `pnpm` shim on `PATH` (this repo has an untracked `.tmp-bin/pnpm.cmd`).

Single spec: `pnpm --filter @jad/api exec vitest run <path>` (same per workspace).

## Database invariants

- **Browser roles are read-only.** `anon` and `authenticated` are revoked from
  every AF Homes table and granted only `SELECT`, gated by RLS policies that
  call `private.has_permission()`. All writes go through service-role handlers
  or narrowly scoped `SECURITY DEFINER` functions. Before adding any
  `anon`/`authenticated` policy, confirm it is SELECT-only.
- **No Super Admin password exists anywhere.** The first Super Admin is created
  by a server-controlled `auth.admin.inviteUserByEmail`; the owner sets their
  own password via the Supabase-hosted recovery flow. The same is true of
  customer onboarding: a hashed, single-use, expiring **token** is issued; the
  customer sets their own password.
- **Money is exact-decimal text** with a `CHECK` regex on every money/rate
  column. No float math anywhere — use the `BigInt` helpers from `@jad/shared`
  (TypeScript) and `numeric` + `private.money()` (Postgres). `to_char` is
  deliberately unused in the money path.
- **A sale is a frozen commercial record.** `card_sales` stores
  `cash_price_snapshot`, `minimum_down_payment_snapshot`,
  `yearly_points_snapshot`, `commission_rate_snapshot` and
  `expected_commission_snapshot`. Never recompute a historical sale from
  `card_plans`; never hand-edit a snapshot.
- **Only VERIFIED money counts.** `recorded` is not money yet, `rejected` and
  `voided` never were. Every total, balance and activation decision comes from
  the payment rows on the server.
- **Activation requires full verified payment, re-checked inside
  `public.activate_card_sale`.** A down payment, an existing Auth user, a seller
  action or a frontend button can never activate a membership. The function is
  idempotent: an already-active sale returns its existing membership.
- **Deny-only restrictions** (`staff_permission_restrictions`) can subtract from
  a role but never add to it; the same rule is enforced in
  `permissionsAreSubset()`.
- **Identifiers never authorize anything.** `memberships.qr_token_hash` and
  `fallback_code_hash` are two identifiers for the **same** row, both stored as
  SHA-256 hashes, both 256-bit/4-byte random with no customer data encoded. They
  are returned in plaintext exactly once at issuance and are never re-displayed.
  `GET /memberships/resolve` is the only path from an identifier to a
  membership, and its response deliberately carries no customer PII.
- **Government ID numbers are write-only.** Stored on `customers`, never
  returned; the API exposes `governmentIdMasked`. They must never appear in an
  `audit_events` payload.
- **Private buckets** (`afhomes-customer-ids`, `afhomes-ost-ids`,
  `afhomes-payment-receipts`) are non-public. Object delivery must use
  short-lived signed URLs from an authorized server API.
- **Migration discipline:** one idempotent migration per change, prefixed
  `afhomes_`, with the validation queries in the file header and a down note.
  After each batch run `supabase/security/rls_invariants.sql` (empty = PASS).

## Conventions

- Styling: CSS Modules per component; tokens in `@jad/ui`. `@/*` maps to
  `apps/<app>/src`.
- Tests colocated as `<target>.spec.ts(x)`. Both apps use
  `renderWithProviders` from `src/test/utils.tsx` (fresh retry-free
  `QueryClient`, `MemoryRouter`, resolved `SessionProvider`). `installMockApi`
  and the `@jad/mock` package were removed with JAD - do not reintroduce them.
- API handler tests use the in-memory Supabase fake in
  `api/_lib/testing/` (`supabase-fake.ts`, `fixtures.ts`). It supports unique-key
  enforcement, column defaults, and read-only vs write-only error injection, so
  tests exercise real handler code (real resolver, real Zod, real query chains)
  without a database. It is excluded from the Vercel upload.
- All HTTP goes through `apps/<app>/src/lib/api/client.ts`
  (`request`/`requestList`), which validates against `@jad/contracts`. No
  ad-hoc `fetch` in features.
- Client route guards are **UX only**; the server is the security boundary.
- Prettier: `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`.

## Authorization architecture

One effective-permission model, evaluated in two places that must agree:

```
Supabase Auth user
  -> staff_users            (must exist, status must be 'active')
  -> staff_role_assignments (must exist)
  -> roles                  (must be is_active)
  -> role_permissions       (per-module view/create/update/delete)
  MINUS
  staff_permission_restrictions  (deny-only; can never add)
  = effective permission (super_admin is granted every module by slug)
```

- **Backend (authoritative)** — `private.has_permission()` in Postgres for RLS,
  and `authorizeAfHomes(req, module, action)` in `api/_lib/afhomes-access.ts`
  for handlers. The principal is resolved **per request**; there is no cache, so
  a permission change takes effect on the very next call with no client
  cooperation.
- **Frontend (UX only)** — `canViewModule()` / `navItemsForPermissions()` in
  `apps/admin/src/app/navigation.ts` decide what is *visible*; `RequireRole`
  gates *direct URL* entry. Both read the same `afHomesSessionSchema` payload
  the API returns, so there is no second definition to drift. Hiding a link is
  never the only control — every action is re-checked server-side.

Enforced invariants (each has a named regression test):

| # | Invariant | Test |
|---|---|---|
| A | A user restriction removes access, never adds it | `api/_handlers/authorization.regression.spec.ts` |
| B | A user cannot assign a permission they do not hold | same |
| C | An Admin cannot alter or deactivate the Super Admin | same |
| D | System roles cannot be deleted or defanged | same |
| E | A direct URL cannot bypass nav permission filtering | `apps/admin/src/app/authorization.regression.spec.tsx` |
| F | Client permission state cannot authorize a server action | both suites |
| G | Inactive staff cannot use staff APIs with a valid session | api suite |
| H | A permission change applies on the next resolution | api suite |

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

## Environment

Only `VITE_`-prefixed vars reach the browser. Browser-safe:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy fallback
`VITE_SUPABASE_ANON_KEY`), `VITE_API_BASE_URL` (default `/api/v1`),
`VITE_WEB_URL`, `VITE_ADMIN_URL`.

Server-only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (use
the transaction pooler, `:6543`), `AFHOMES_TARGET_PROJECT_REF`,
`AFHOMES_SUPERADMIN_EMAIL`, `AFHOMES_WEB_URL`, `AFHOMES_ADMIN_URL`,
`EMAIL_FROM`, `RESEND_API_KEY`, `DOCUMENT_HASH_PEPPER`, optional
`OCR_PROVIDER_URL` / `OCR_PROVIDER_API_KEY`.

Never commit `.env*`. Copy `.env.example` to `.env.local` for overrides.

`pnpm check:env` enforces the split directionally: browser code may read only
`VITE_`-prefixed `import.meta.env` values (plus Vite's own `DEV`/`PROD`/`MODE`/
`BASE_URL`/`SSR`) and never `process.env`; server code reads `process.env` and
never `import.meta.env`. Add `-- --built` to also scan `vercel-static/` and
`dist/` for server-only names. `packages/config`'s `loadPublicEnv` is the one
sanctioned whole-object read — it parses through a `VITE_`-only Zod object, and
`packages/config/src/env.spec.ts` pins that unknown keys are stripped.

## Known debt

- **Workspace packages are still named `@jad/*`** (`@jad/contracts`,
  `@jad/shared`, `@jad/ui`, `@jad/config`, plus the `api` and app package
  names). This is churn debt from the JAD era, deliberately **not** mixed into
  security or test work. Do not read it as a signal to reintroduce JAD, and do
  not rename it in a change that also touches authorization — the rename is
  repo-wide and `vercel.json`'s `includeFiles: "packages/**"` is load-bearing
  for the deployed function.

## Deployment

Single Vercel project, single origin:

- `/` → `apps/web/dist`, `/admin` → `apps/admin/dist`
- `/api/v1/*` → the single Function `api/router.ts`
- `/health` → readiness probe, also the only scheduled job (daily `0 0 * * *`)

Build chain: `scripts/prepare-vercel-env.mjs` → `turbo run build` →
`scripts/assemble-vercel-output.mjs` (merges both SPAs into `vercel-static/`).

- `functions["api/router.ts"].includeFiles` **must stay `packages/**`**.
  Narrowing it crashes the deployed function with
  `ERR_MODULE_NOT_FOUND .../@jad/contracts/src/index.ts`.
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

**Do not deploy, run migrations against production, or trigger remote crons
without explicit approval.**
