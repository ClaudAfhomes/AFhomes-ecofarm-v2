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

### Phase 3 (complete — customer account activation and the customer portal)

One migration, `20260927000005_afhomes_phase3_customer_portal.sql`:

- `public.claim_customer_onboarding_token(p_token_hash, p_auth_user_id, p_purpose)`
  — the atomic redemption. Locks the token row **and** the customer row, then in
  one transaction links `customers.auth_user_id`, consumes the token, and appends
  `CUSTOMER_AUTH_ACTIVATED`, `CUSTOMER_ONBOARDING_TOKEN_CONSUMED` and
  `CUSTOMER_ACCOUNT_LINKED`. Idempotent (`CLAIMED` / `ALREADY_LINKED`), and
  `FOR UPDATE` is load-bearing: without it the compare-and-set on `consumed_at`
  is a read-then-write race.
- `public.reissue_membership_credentials(p_membership_id, p_customer_id, p_actor_id)`
  — **rotates** the QR token and fallback code rather than recovering them, and
  returns the new plaintext exactly once. Ownership and the customer's own
  status are re-checked in SQL so a handler bug cannot rotate someone else's card.
- **Column-level SELECT grants** on `customers`, `memberships`, `points_ledger`
  and `points_accounts`. RLS picks the ROW; only the grants pick the COLUMNS.
  Without this, `authenticated` held a table-wide `SELECT` and a customer could
  read their own `government_id_number` through PostgREST.

API: `POST /auth/customer/activate` (unauthenticated) and `GET /customer`,
`/customer/membership`, `/customer/points`, `/customer/points/ledger`,
`POST /customer/membership/credentials` (authenticated). `api/_lib/customer-access.ts`
resolves a customer from **ownership only** and imports nothing from the staff
authorization path.

Portal: `apps/web/src/features/customer/` — login, activate, dashboard, card,
points, profile. `/customer` and `/customer/login` are real routes in the
existing public SPA, so no Vercel output or `vercel.json` change was needed.

### Phase 4 (complete — staff redemption of customer points)

One migration, `20260928000001_afhomes_phase4_redemption.sql`:

- `redemption_items` — the catalog. **Database-backed**, so no item is ever
  hardcoded in a component. `points_cost bigint`, not money: no decimal text, no
  `private.money`, no rounding. Deactivated, never deleted.
- `redemptions` — the auditable transaction, with **snapshots** of the item code,
  name, price and of the balance before/after. Snapshots are why a catalog edit
  cannot rewrite history. `status` includes `voided` and the void columns exist so
  a future rule has a home, but **nothing writes them** and a CHECK makes a
  half-recorded void impossible.
- `public.redeem_membership_points(...)` — the whole transaction in one function,
  because PostgREST cannot span statements and a handler cannot hold a row lock
  across requests. **Lock order is fixed and total: membership → customer → item
  → points account.** The points-account lock is taken *before* the balance is
  read, which is the concurrency control; the price is read from the catalog, and
  the acting staff member is re-validated inside the function.
- Idempotent per `(redeemed_by, idempotency_key)`, checked **after** the locks so
  a retry returns the original receipt even once the token/balance has moved.
- **Column-level repair:** `memberships.points_balance` was written as `0` by
  Phase 2's activation and never maintained, so the staff identifier lookup had
  been reporting `pointsBalance: 0` for a member holding 60,000. The Phase 4
  migration backfills it from `points_accounts` (the authoritative balance) and
  the redemption function keeps it in step.

**No new module keys.** `operations.redemption` and `operations.catalog` already
existed from Phase 1, so redemption adds no authorization vocabulary.

API: `GET /redemptions/resolve`, `GET|POST /redemptions/items`,
`PATCH /redemptions/items/:id`, `GET|POST /redemptions`, `GET /redemptions/:id`.

Staff screens: `/admin/redemption` (identify → price → confirm, with a real
browser QR camera scanner), `/admin/redemption/history`, `/admin/redemption/items`.
The camera decoder is `jsqr`, run **locally**; no frame is ever uploaded.

**Still not built (deliberately):** OST standalone app, NFC (none exists and
none is planned), point redemption *by the customer*, genealogy UI, commission
payout, email, refunds, renewal automation, OCR, notifications, marketing site.
**No final-commission-qualification rule exists in this codebase** — the
`final_qualification_pending → earned` transition is deliberately a manual,
permission-gated, audited decision with mandatory notes. Do not invent it.

### Phase 5 (complete — production readiness, no product change)

One migration, `20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql`, and
one new command. No business rule changed.

The two Phase 2 migrations `…0001` and `…0003` were corrected in the working
tree *after* being first written. A runner **skips any version it has already
recorded**, so a database that recorded the defective versions will never
receive the corrected bodies. Migration 9 therefore re-delivers the four
execution-found fixes as a new, forward-only, **idempotent** file:
`private.money()` (no `rpad` truncation), `verify_card_payment()` (every column
qualified, because its `OUT` parameters are named `sale_id`/`status`),
`spot_cash_started_at` (`coalesce`, not a self-assignment), and
`commissions.ost_id` (nullable, so a staff beneficiary is legal).

It is safe to apply to a database of unknown provenance: applying it to an
already-correct database changes nothing.

`pnpm test:db:harness` is new. It runs the real suite **twice** against a
disposable loopback PostgreSQL — once normally (must exit 0, must run section 37,
must restore every table) and once with `AFHOMES_DB_TEST_INJECT_FAILURE`
armed (must exit **non-zero**, must report the abort, and must **still** run
`finally` cleanup). The flag is refused for any remote target, so it can never
be aimed at a development or production database.

Current readiness status, blockers, and the full production runbook:
`docs/AFHOMES-PHASE-5-READINESS.md`. **Verdict: NOT READY** — there is no
development/staging Supabase project, so the managed stack (PostgREST, GoTrue,
Storage) has never been executed.

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

pnpm test:db                    # Phase 2 DB integration suite (needs a dev DB URL)
pnpm test:db:local              # …against a disposable local PostgreSQL it boots itself
pnpm test:db:harness            # …and proves the suite fails closed on an injected fault
```

Local API: `pnpm exec tsx api/dev-server.ts` (`:3000`; Vite proxies `/api`).

> `pnpm` is invoked through corepack. If `turbo` reports "Unable to find package
> manager binary", `pnpm` is not on `PATH` — use `npx pnpm <cmd>` or put a
> `pnpm` shim on `PATH` (this repo has an untracked `.tmp-bin/pnpm.cmd`).

Single spec: `pnpm --filter @jad/api exec vitest run <path>` (same per workspace).

## Database integration suite

The unit suite is **fully offline** and never needs a database. The SQL, however,
is only truly proven by executing it, so there is a second, opt-in suite:

| Command | Target |
|---|---|
| `pnpm test:db:local` | Boots a **disposable local PostgreSQL**, applies `supabase/db-testing/supabase-shim.sql` then every migration, runs the suite, deletes the server. Loopback only. |
| `pnpm test:db` | An explicitly approved development database, via `AFHOMES_TEST_DATABASE_URL`. |

Safety, all fail-closed with exit code 2:

- No `AFHOMES_TEST_DATABASE_URL` → refuses, explains both commands.
- A `*.supabase.co` / `*.pooler.supabase.com` host with **no** `AFHOMES_TEST_PROJECT_REF` → refuses; the suite never guesses its target.
- `AFHOMES_TEST_PROJECT_REF` equal to the production ref → refuses by name.
- Only synthetic, per-run-prefixed data; removed on exit. No real customer data.
- No connection string, password, key or token value is ever printed.

`supabase/db-testing/supabase-shim.sql` reproduces the Supabase platform objects
the migrations assume but never create (`auth.users`, `auth.uid()`, the
`anon`/`authenticated`/`service_role` roles, `storage.buckets`/`storage.objects`).
**It is a test fixture and must never be applied to a real Supabase project.**
`pnpm db:migrate` does not read it.

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

### Defects that only real PostgreSQL execution found

Text assertions and the in-memory Supabase fake both passed while the database was
broken. These were found by running the SQL, and each now has a tripwire:

- `private.money()` wrapped its result in `rpad(x, 1, '0')`. **`rpad` truncates**,
  so every formatted total collapsed to its first character — `60,000.00` became
  `"6"`. Every `sale_financial_summary` figure was wrong. Never length-cap a
  formatted value with `rpad`.
- `verify_card_payment` declared OUT parameters named `sale_id` and `status`, so
  its own unqualified `where sale_id = ... and status = 'verified'` was ambiguous
  and the function failed on **every** call. **Alias and qualify every table
  inside a `returns table` function.**
- `verify_card_payment` set `spot_cash_started_at = v_sale.spot_cash_started_at`,
  a self-assignment that copied the existing `NULL` straight back, so the instant
  the window opened was never recorded. Use `coalesce(col, now())`.
- `commissions.ost_id` was `NOT NULL` from Phase 1 while Phase 2's new beneficiary
  CHECK allows a **staff** beneficiary. The two constraints contradicted each
  other and no commission could be created for a VD/SSM/SM/Admin sale. When a
  migration generalises a column's meaning, re-read the old constraints.
- **Phase 3:** `authenticated` held a table-wide `SELECT` on `public.customers`,
  so a customer who legitimately passed the self-read policy could read their own
  `government_id_number` through PostgREST. **RLS is row-level; it says nothing
  about columns.** Narrow browser grants to an explicit column list on every
  table a browser role can read.
- **Phase 3:** `claim_customer_onboarding_token` checked `consumed_at` before the
  already-linked branch, which made its `ALREADY_LINKED` outcome **unreachable
  code** — a client retrying after a lost response got "already used" instead of
  the success it had earned. Idempotency must be decided **before** the
  consumption and lifecycle checks.
- **Phase 3:** `reissue_membership_credentials` gated on the *membership* status
  but not the *customer* status. A suspended member's membership row is still
  `active`, so the database would have accepted a rotation that the handler
  refused. A `SECURITY DEFINER` function must re-check every precondition the
  handler checks — the handler is not the security boundary it appears to be.
- **Phase 4:** `memberships.points_balance` was written as `0` by Phase 2's
  activation and never maintained, while `points_accounts.balance` held the real
  figure. The staff identifier lookup had therefore been reporting
  `pointsBalance: 0` for a member holding 60,000 points. Repaired in Phase 4 and
  kept in step. **A denormalized column nobody maintains is worse than none.**
- **Phase 4:** `findNavSubItem` in `apps/admin/src/app/navigation.ts` used
  first-match prefix matching. Once a dropdown held both `/admin/redemption` and
  `/admin/redemption/items`, the catalog screen resolved to the *workflow's*
  module key and checked the wrong permission. The longest match now wins. This
  was UX-only (the server still refused), but the guard must not check the wrong
  permission.

### False passes: harness bugs that hid real behaviour

Recorded because each one let a suite be green while testing nothing:

- A denied statement aborts the enclosing transaction, so every probe after the
  first in a shared transaction reported "current transaction is aborted"
  instead of its own reason. Wrap each write-denial probe in its own
  `SAVEPOINT`.
- The in-memory Supabase fake's `splitTopLevel` did not trim, so
  `"a, customers!inner(status)"` produced a spec with a **leading space**: the
  embed key became `" customers"` and the table name `" customers"` matched no
  declared link. Every embed in the codebase resolved to `undefined` in silence
  and callers read a `?? {}` fallback. Phase 2 and Phase 3 tests passed only
  because none of them asserted an embedded value. **The fake now trims, and its
  embed resolution tries both directions of a relation.**
- The fake never returned `count` at all, so `meta.total` silently fell back to
  the page size and pagination was untestable. It now returns the pre-pagination
  total, as PostgREST does.
- A test fixture used an all-lowercase QR token, so a "does not case-fold" case
  passed for the wrong reason. A real QR token is base64 and mixed case.
- **Phase 5:** section 37 of the DB suite — the reconciliation checks — lived in
  the `catch` for sections 1-36, so on a green run it **never executed**. 493
  checks passed with zero assertions about the migration the phase exists for.
  Section 37 now runs on the successful path, and `pnpm test:db:harness` asserts
  it appeared in the output. **A check that only runs once something else has
  already broken is not a check.**
- **Phase 5:** the abort report sat *inside* section 37's own `catch`, so a
  throw anywhere in sections 1-36 produced a short, entirely green run and
  **exit code 0**. The report now lives in the outer `catch`, and the injection
  flag plus the harness prove the non-zero exit. **Silence is not a pass.**
- **Phase 5:** two of section 37's three assertions were invalid and *failed
  against a correct database* — a `length === 9` check on `'60000.00'` (it is 8),
  and a self-assignment regex that matched the **comment inside the function**
  documenting the old defect, because `pg_proc.prosrc` retains comments. A third
  compared `prosrc` byte-for-byte, measuring hand-typed whitespace rather than
  behaviour. All three now assert semantics, and one guards that the migration's
  explanatory comments are never deleted to satisfy a regex.
- **Phase 5:** cleanup asserted only `count(customers) == 0`, and the synthetic
  **inactive** staff member was never pushed onto `createdStaffIds` — so it
  survived every run, forever, while the check passed. Cleanup now resolves its
  id sets from the database (recorded ids **union** run-prefix marker) and
  verifies every table is back to its **pre-run row count**. **A cleanup check
  that inspects one table is not a cleanup check.**

The lesson is recorded deliberately: **a schema that compiles is not a schema that
works, and a test that cannot fail is not a test.** `pnpm test:db:local` and
`pnpm test:db:harness` are the only things that would have caught these.

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

Build chain: `pnpm typecheck` → `scripts/prepare-vercel-env.mjs` →
`turbo run build` → `scripts/assemble-vercel-output.mjs` (merges both SPAs
into `vercel-static/`). The leading `typecheck` is load-bearing: `turbo run
build` only builds the two SPAs (each runs its own `tsc --noEmit` first), and
nothing else in the chain typechecks `api/` — so without it a TypeScript error
in deployable API code would ship silently. Never remove the typecheck step
from `vercel.json`'s `buildCommand`.

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
- `installCommand` is `pnpm install --filter=!@jad/db-testing`, so the initial
  install covers 8 of 9 workspace projects and never touches
  `embedded-postgres`. Vercel still runs a second, unfiltered install
  (`Scope: all 9 workspace projects`) while processing function outputs — that
  reinstall is Vercel platform behavior, not a repo dependency: nothing in the
  codebase depends on `@jad/db-testing` (no manifest lists it, the `api/`
  function imports only `@jad/contracts` and `@jad/shared`, and there are no
  relative imports into `packages/`). The extra install succeeds silently
  because `allowBuilds` permits exactly the two `embedded-postgres` platform
  packages; the native binary is never loaded by the deployed function, which
  never imports the db-testing sources. Do not "fix" this by weakening pnpm
  security or by narrowing `includeFiles` (see above).

**Do not deploy, run migrations against production, or trigger remote crons
without explicit approval.**
