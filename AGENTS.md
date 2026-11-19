# AGENTS.md

## Branch integration (6 November 2026)

This checkout is `claud/supabase`. Application code is integrated from
`origin/develop` at `e759f69`; the active backend remains Supabase Postgres,
Supabase Auth and private Supabase Storage through `api/_lib/router.ts`.
`pnpm dev` uses Turborepo and `api/dev-server.ts`, not the MongoDB launcher.
`VITE_AUTH_PROVIDER=mongodb` is rejected by the public environment contract.
MongoDB source, tests and imported notes are reference material for this branch;
do not adopt their Atlas, Better Auth or DigitalOcean operating instructions.
The package namespace is `@afhomes/*`.
The phase summaries (now `docs/agents/afhomes-phase-history.md`) describe the
original foundation; current source, contracts and migrations contain
subsequent work imported from `develop`.
No imported migration is assumed applied. Never modify existing administrators
or run remote writes, migrations, bootstrap, deployment, commit or push without
explicit authorization. Generated graph reports and MongoDB operator guides
are excluded from this integration.

pnpm + Turborepo monorepo for the **AF Homes Ecofarm** platform (membership-card
business). Stack: **React 19 + Vite 8 SPAs → TanStack Query → Vercel Functions
REST API → Supabase Postgres + Supabase Auth**.

> **This file is the authority for the AF Homes codebase.** The retired JAD
> platform (its documents and the `legacy/` tree) was removed in `14b99d3`;
> never implement from JAD material. Business rules: `docs/business-rules/`
> (start at `INDEX.md`, `AGENT-GUIDE.md`, `OPEN_QUESTIONS.md`); navigation:
> `docs/ai/README.md`.

## Reference files (read on demand, not loaded automatically)

| File | Read before |
|---|---|
| `docs/agents/afhomes-phase-history.md` | Changing a Phase 1-5 feature, or needing why a migration/function looks the way it does |
| `docs/agents/afhomes-db-testing.md` | Writing or changing SQL, migrations, RLS, the DB suite or the in-memory fake (execution-found defects and false-pass lessons) |
| `docs/agents/afhomes-operations.md` | Super Admin bootstrap, `/health`, `vercel.json`, build chain or deployment |
| `docs/agents/afhomes-opencode.md` | **OpenCode sessions: read at session start** (skill routing). Claude Code and Codex ignore it. |

## Current state (summary; full history in `docs/agents/afhomes-phase-history.md`)

Phases 1-5 are complete; later `develop` work is integrated on top.

- **Status vocabulary:** `packages/contracts/src/schemas/lifecycle.ts` is the
  **single source for every status string and every legal transition** in the
  system — handlers, contracts and tests all import it.
- **Pure rules:** `api/_lib/commerce.ts` (commission, totals, spot cash,
  sellability, seller resolution); `api/_lib/handler-kit.ts` is the shared
  handler plumbing. API families are data-driven (`BUSINESS_FAMILIES` in
  `api/_lib/router.ts`).
- **Token claim:** `public.claim_customer_onboarding_token` locks token **and**
  customer rows; `FOR UPDATE` is load-bearing. Idempotency (`ALREADY_LINKED`)
  is decided **before** consumption and lifecycle checks.
- **Redemption lock order is fixed and total: membership → customer → item →
  points account.** The points-account lock is taken *before* the balance is
  read; the price is read from the catalog; the acting staff member is
  re-validated inside the function; idempotent per `(redeemed_by,
  idempotency_key)`, checked **after** the locks. Catalog rows
  (`redemption_items`) are deactivated, never deleted; `redemptions` stores
  snapshots so a catalog edit cannot rewrite history; nothing writes the void
  columns. `points_cost` is `bigint`, not money.
- `points_accounts.balance` is the authoritative balance;
  `memberships.points_balance` is kept in step by the redemption function.
- Redemption added **no new module keys** (`operations.redemption`,
  `operations.catalog`). The QR camera decoder (`jsqr`) runs **locally**; no
  frame is ever uploaded.
- **No final-commission-qualification rule exists in this codebase** — the
  `final_qualification_pending → earned` transition is deliberately a manual,
  permission-gated, audited decision with mandatory notes. Do not invent it.
- Deliberately not built as of Phase 4 (verify in source before assuming
  otherwise): OST standalone app, NFC (none exists and none is planned), point
  redemption *by the customer*, genealogy UI, commission payout, email, refunds,
  renewal automation, OCR, notifications, marketing site.
- **A migration runner skips any version it has already recorded.** Never edit
  an applied migration to fix it; ship a new forward-only, idempotent migration
  (as Phase 5's `20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql` did).
- Phase 5 readiness verdict was **NOT READY**: no development/staging Supabase
  project existed, so the managed stack (PostgREST, GoTrue, Storage) had never
  been executed.

## Layout

- `apps/web` (`:5173`) - public SPA + **customer portal** (`/customer/**`).
  Production base `/`.
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
- `legacy/` (the retired JAD application) was removed in `14b99d3`; JAD code is
  never applied or imported. `supabase/apply-migrations.ts` hard-fails if a
  non-`afhomes_` file appears in `supabase/migrations/`.
- `docs/` - business rules (`docs/business-rules/`), navigation (`docs/ai/`),
  agent reference (`docs/agents/`). Never reformat `docs/` (`.prettierignore`).

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

pnpm test:db                    # Phase 2 DB integration suite (needs a dev DB URL)
pnpm test:db:local              # …against a disposable local PostgreSQL it boots itself
pnpm test:db:harness            # …and proves the suite fails closed on an injected fault
```

Local API: `pnpm exec tsx api/dev-server.ts` (`:3000`; Vite proxies `/api`).

> `pnpm` is invoked through corepack. If `turbo` reports "Unable to find package
> manager binary", `pnpm` is not on `PATH` — use `npx pnpm <cmd>` or put a
> `pnpm` shim on `PATH` (this repo has an untracked `.tmp-bin/pnpm.cmd`).

Single spec: `pnpm --filter api exec vitest run <path>` (same per workspace).

## Database integration suite (details: `docs/agents/afhomes-db-testing.md`)

The unit suite is fully offline. `pnpm test:db:local` boots a disposable
loopback PostgreSQL; `pnpm test:db` targets only an explicitly approved
development database via `AFHOMES_TEST_DATABASE_URL`. Both fail closed (exit 2)
without a target, on a Supabase host without `AFHOMES_TEST_PROJECT_REF`, and on
the production ref. Only synthetic, per-run-prefixed data; no connection string,
key or token is ever printed. `supabase/db-testing/supabase-shim.sql` **is a
test fixture and must never be applied to a real Supabase project.**

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
  column. No float math anywhere — use the `BigInt` helpers from `@afhomes/shared`
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
  `audit_events` payload. The browser roles additionally have **no `SELECT`
  privilege on the columns at all** — see the Phase 3 migration.
- **`auth.users` is a platform table.** On a real Supabase project `anon` and
  `authenticated` are granted `USAGE` on schema `auth` and `SELECT` on
  `auth.users` by default, which means a signed-in customer can read every
  account's email through PostgREST. AF Homes never does this, and the customer
  principal is always resolved server-side with the service role, so no AF Homes
  code depends on it. If that platform default ever needs closing, it is a
  project-level `revoke` **outside** the migrations (the migrations must not
  fight the platform), and it must be verified on a real Supabase project — the
  local shim deliberately grants only `USAGE`, so it cannot prove either way.
- **Private buckets** (`afhomes-customer-ids`, `afhomes-ost-ids`,
  `afhomes-payment-receipts`) are non-public. Object delivery must use
  short-lived signed URLs from an authorized server API.
- **Migration discipline:** one idempotent migration per change, prefixed
  `afhomes_`, with the validation queries in the file header and a down note.
  After each batch run `supabase/security/rls_invariants.sql` (empty = PASS) and
  `pnpm test:db:local`.

**A schema that compiles is not a schema that works, and a test that cannot fail
is not a test.** Before changing SQL, migrations, RLS or test harnesses, read the
execution-found defects and false-pass lessons in
`docs/agents/afhomes-db-testing.md`.

## Conventions

- Styling: CSS Modules per component; tokens in `@afhomes/ui`. `@/*` maps to
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
  (`request`/`requestList`), which validates against `@afhomes/contracts`. No
  ad-hoc `fetch` in features.
- Client route guards are **UX only**; the server is the security boundary.
- Prettier: `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`.
- Input rules live in `packages/contracts/src/schemas/input.ts` (single
  source): person names are Unicode-letters-only and stored UPPERCASE, phones
  reject alpha and canonicalize PH mobile to `+63`, emails stay lowercase,
  money stays exact-decimal strings, birth dates must be past and plausible.
  Emails, passwords, tokens, URLs, UUIDs, hashes, keys, paths and notes are
  never case-folded. Frontend normalizes on submit (`apps/admin/src/lib/normalize.ts`);
  handlers normalize the optional fields on write; imports normalize rows.
  Historical records are never rewritten.
- Live search uses `useDebouncedValue` (`apps/admin/src/lib/`, ~300ms) with the
  debounced term in the queryKey; staged `applied` filters sync from the
  settle callback, never from a sync setState-in-effect. Latest query wins by
  key change; superseded results are isolated from the active query state.
  Already-started network requests are not guaranteed to be cancelled.
- Freshness is mutation invalidation first (redeem also invalidates
  `['reports']`; activation also invalidates `member-lookup`/`memberships`/
  `reports`), plus conservative polling on operational lists (5s import jobs,
  15s finance/activation/history/member-lookup, 30s reports/audit/OST/
  applications/commissions/memberships/customer points). No Supabase Realtime
  subscriptions: browser roles hold no table privileges to subscribe to, so
  polling the authorized service-role endpoints is the cross-session channel.
  Logout clears the whole QueryClient in both apps.

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

### Customer authorization is a SEPARATE system

There are now two authorization models, and they never meet:

```
STAFF    auth.users -> staff_users -> roles -> role_permissions
                       MINUS staff_permission_restrictions
CUSTOMER auth.uid() -> customers.auth_user_id -> customer -> membership
```

- Customer access is **ownership**, never permission. There is deliberately **no
  `modules` row** for the customer portal, so `private.has_permission()` cannot
  express it and a customer can never be granted a staff capability.
- `api/_lib/customer-access.ts` imports nothing from `afhomes-access.ts`. A
  signed-in staff member who also owns a customer record gets customer access to
  **that one customer** and no staff capability through the portal.
- A suspended or cancelled customer may read their own profile (so the
  restriction is legible) but the server refuses their membership and points,
  and `reissue_membership_credentials` refuses in SQL too — not only in the
  handler.
- RLS decisions are re-proven on real PostgreSQL in `supabase/db-integration.ts`
  sections 22–24, which impersonate two different members and assert what the
  *database* returns. RLS picks the row; **column grants pick the columns.**

## Card credentials are rotated, never recovered

`memberships.qr_token_hash` and `fallback_code_hash` are SHA-256 hashes, so a
code cannot be displayed on demand without weakening at-rest security. Instead
`reissue_membership_credentials` mints fresh values, replaces the hashes (so the
previous codes stop working immediately) and returns the plaintext exactly once.
The portal therefore shows a "request a new code" action, never a stored code.
The QR payload is the opaque token alone — no name, no customer number, no
government ID. **No NFC.**

## Redemption: the points transaction

Three rules, and every one of them is load-bearing:

1. **Scanning spends nothing.** `GET /redemptions/resolve` is a read. Points move
   only on `POST /redemptions`, inside `public.redeem_membership_points`. A member
   is routinely scanned more than once while an item is chosen, so a scan must
   never be able to spend anything.
2. **The client sends no figures.** The request carries only the membership, the
   item, the quantity and a de-duplication reference. There is no `pointsCost`,
   `balance`, `status` or `redeemedBy` field in the contract, so a tampered body
   cannot change what a redemption costs. The acting staff member is
   `principal.userId` from the session, and the database re-validates it anyway.
3. **The identifier authorizes nothing.** Resolving proves only that the caller
   presented a currently valid credential for some membership. Customer status,
   membership status, expiry and the staff permission are all checked separately,
   in `api/_lib/identifier.ts` and again in SQL.

`api/_lib/identifier.ts` is the single place a QR token or a fallback code becomes
a membership, so the two can never drift apart in their validation. The fallback
code is normalised by case and separator (its format is fixed and known); the QR
token is **not** case-folded, because base64 is case-sensitive.

Both new tables are **staff-only and unexposed**: `revoke all` from `anon` and
`authenticated`, so a direct PostgREST call has no privilege to abuse even if an
RLS policy were wrong. A customer reaches their own redemption history through
their points ledger, which is already RLS-scoped to them.

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

## Operations (details: `docs/agents/afhomes-operations.md`)

- **Do not deploy, run migrations against production, or trigger remote crons
  without explicit approval.**
- `pnpm bootstrap:superadmin` is idempotent, never handles a password, requires
  approval and must not run unattended; it deletes an auth user on failure only
  when that run created it.
- `GET /health` alerts on `ok`; its body never contains credentials, keys, SQL,
  stack traces or environment values.
- Deployment: never remove `pnpm typecheck:deploy` from `vercel.json`'s
  `buildCommand`; `functions["api/router.ts"].includeFiles` **must stay
  `packages/**`**; exactly one Vercel Function (`api/router.ts`) — keep
  `api/_handlers/` and `api/_lib/` underscore-prefixed. Do not set
  `VITE_WEB_URL`/`VITE_ADMIN_URL` in the Vercel env.
