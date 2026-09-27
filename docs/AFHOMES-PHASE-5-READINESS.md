# AF Homes Ecofarm v2 — Phase 5 Production Readiness Report

Status: **NOT READY** (see §N)
Scope of this document: readiness assessment only. Nothing in this task was
deployed, no migration was applied remotely, no Super Admin was created, and
nothing was pushed.

---

## §A Supabase target inventory

| Item | Value |
|---|---|
| Project refs known to this repository | `ikaevepedpqygdlipsei` (one only) |
| Host | `ikaevepedpqygdlipsei.supabase.co` |
| Development project | **none exists** |
| Staging project | **none exists** |
| Production | `ikaevepedpqygdlipsei` — the only project |

Evidence: `AFHOMES_TARGET_PROJECT_REF` in `.env.local`; the same literal is
pinned in source as `PRODUCTION_PROJECT_REF` (`supabase/db-integration.ts:33`)
and `EXPECTED_PROJECT_HOST` (`supabase/invite-superadmin.ts:42`). A project ref
is an identifier, not a secret. No key, password, or token value appears in this
document.

**Consequence:** there is nowhere to validate safely. Every non-production check
in this repository runs against a disposable local PostgreSQL instead.

## §B Real Supabase validation status

**No statement in this report is backed by a real Supabase project.** All
database proof comes from `embedded-postgres` **18.4** plus
`supabase/db-testing/supabase-shim.sql`, a hand-written fixture that reproduces
the platform objects the migrations assume (`auth.users`, `auth.uid()`, the
`anon` / `authenticated` / `service_role` roles, `storage.buckets`,
`storage.objects`). It is a test fixture and is never applied to a real project.

Calling the local run a "Supabase integration test" would be false. What is
proven is that **the AF Homes SQL is correct against real PostgreSQL**. What is
*not* proven is that Supabase's managed stack around it behaves.

Explicitly unproven on real Supabase:

- PostgREST exposure, including column-level grant behaviour as PostgREST
  resolves it.
- The platform default that grants `authenticated` `SELECT` on `auth.users`
  (the shim grants only `USAGE`, so it cannot prove this either way).
- GoTrue: `auth.admin.inviteUserByEmail`, email-confirmation settings, the
  redirect allow-list, password policy.
- Storage: bucket RLS, object policies, signed-URL issuance.
- Any advisor (see §F).

## §C Migration readiness

`pnpm db:migrate -- --check` was run. It connects to nothing, applies nothing,
and reports the inventory:

| # | Migration |
|---|---|
| 1 | `20260926023325_afhomes_phase1_foundation.sql` |
| 2 | `20260926025313_afhomes_phase1_advisor_indexes.sql` |
| 3 | `20260927000001_afhomes_phase2_business_foundation.sql` |
| 4 | `20260927000002_afhomes_phase2_rls.sql` |
| 5 | `20260927000003_afhomes_phase2_rpc.sql` |
| 6 | `20260927000004_afhomes_phase2_support_functions.sql` |
| 7 | `20260927000005_afhomes_phase3_customer_portal.sql` |
| 8 | `20260928000001_afhomes_phase4_redemption.sql` |
| 9 | `20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql` |

`--check` correctly identified the target as PRODUCTION and refused to proceed
on a real run, reporting the missing `DATABASE_URL` as a blocker. JAD migrations
remain excluded — `supabase/apply-migrations.ts` hard-fails on any non-`afhomes_`
filename.

### Why migration 9 exists

Phase 2 migrations `…0001` and `…0003` were corrected **in the working tree after
they were first written**. A migration runner records a version and skips
anything it has already recorded, so a database that recorded the defective
versions will never receive the corrected bodies. Production is believed to be in
exactly that state. Migration 9 re-delivers the four execution-found fixes as a
new, forward-only, idempotent file:

1. `private.money()` no longer wraps its result in `rpad(x, 1, '0')`
   (`rpad` truncates, so `60,000.00` rendered as `"6"` — every
   `sale_financial_summary` figure was wrong).
2. `verify_card_payment()` qualifies every column reference (its `OUT`
   parameters are named `sale_id` and `status`, so unqualified references were
   ambiguous and the function raised on **every** call).
3. `spot_cash_started_at` is set with `coalesce(...)`, not a self-assignment
   that copied the existing `NULL` straight back.
4. `commissions.ost_id` is nullable, so a staff beneficiary is legal — the
   Phase 1 `NOT NULL` contradicted the Phase 2 beneficiary `CHECK`, and no
   commission could be created for a VD/SSM/SM/Admin sale.

### How migration 9 is now proven

Section 37 of the database suite runs on the **successful** path and proves both
directions by execution, not by comparing text:

- **Case A (repair).** The four original defects are installed deliberately,
  asserted to be genuinely present (so the repair cannot pass vacuously), and
  then the real migration file is executed against them. Afterwards the suite
  proves money is exact at every boundary, that `verify_card_payment` executes
  where it previously raised, that `spot_cash_started_at` is now recorded with a
  +7 day deadline, and that a staff-beneficiary commission can exist. This runs
  inside one transaction, so a failure cannot leave a development database
  holding a deliberately broken function.
- **Case B (idempotence).** The same file is applied a second time to the
  already-correct database and every behaviour is re-asserted.

The previous version of this section compared `pg_proc.prosrc` byte-for-byte
after a re-apply. That measured the whitespace of a hand-retyped definition
rather than behaviour, and it **failed against a correct database**. The two
other invalid assertions were: a `length === 9` check on `'60000.00'` (which is
8 characters — unsatisfiable), and a self-assignment regex that matched the
*comment inside the function* documenting the old defect, because `prosrc`
retains comments. All three are fixed; the migration's explanatory comments are
preserved, and one assertion now explicitly guards that they stay.

## §D RLS / Auth / PostgREST

**Proven on real PostgreSQL** (536 checks): RLS enabled on every table; no
`INSERT`/`UPDATE`/`DELETE` granted to `anon` or `authenticated`; browser roles
impersonated through `set local role` in their own transaction; a member sees
only their own customer, membership, points account and ledger; `anon` sees
nothing; a suspended staff principal sees nothing; a super admin still cannot
read onboarding tokens or credential hashes directly; government-ID columns are
unreadable through the browser role while safe columns remain readable;
`redemptions` / `redemption_items` are staff-only and unexposed.

**Structurally reviewed, not executed:** the Supabase platform default granting
`authenticated` `SELECT` on `auth.users`, which would let a signed-in customer
read every account's email through PostgREST. AF Homes never depends on it (the
customer principal is always resolved server-side with the service role), and
closing it is a project-level `revoke` outside the migrations.

**Still needs a real Supabase project:** PostgREST's own view of the column
grants; GoTrue behaviour; the `auth.users` grant closure.

## §E Storage

Three private buckets are created by the Phase 1 migration
(`afhomes-customer-ids`, `afhomes-ost-ids`, `afhomes-payment-receipts`), all
non-public. **No code path that issues a signed URL was executed by any test in
this repository.** The private/non-public property is asserted structurally; the
storage RLS policies and the signed-URL delivery flow are **structurally
reviewed only** and need a real project.

## §F Advisors

**NOT RUN — requires an approved Supabase target.** No result is claimed. Note
that `…advisor_indexes.sql` is applied as migration 2, so the indexes advisors
would recommend are already in place, but that is not a substitute for running
them.

## §G Super Admin readiness

`pnpm bootstrap:superadmin -- --check` **currently fails**, reporting
`SUPABASE_URL is required` — even though `SUPABASE_URL` is present on line 5 of
`.env.local`. The cause was reproduced in isolation and is not a formatting
guess:

```
A1=1        ->  A1="1" A2="2"     (baseline)
A1=1
             ->  A1="1" A3="3"     (blank line between entries is fine)
A1=                          ->  A1="A3=3"     <-- THE BUG
```

Node's `loadEnvFile` treats the text following an **empty value** as a
*continuation* of that value. `.env.local:2` is `VITE_SUPABASE_ANON_KEY=`
followed by a space, so it swallows the blank lines and then consumes line 5,
receiving the literal text `SUPABASE_URL=https://…` — exactly 53 characters
(`SUPABASE_URL=` is 13, plus the 40-character URL) — and `SUPABASE_URL` is never
defined. Both operator scripts (`apply-migrations.ts:47`,
`invite-superadmin.ts:40`) call `loadEnvFile('.env.local')`, so both are affected.

**Required manual correction** (`.env.local` was deliberately not modified):

1. **Delete line 2 entirely.** Do not leave an empty assignment — the empty
   value is the trigger. An empty `KEY=` followed by a blank line is the exact
   failure mode.
2. If the browser apps need the key, add
   `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>` — the name `.env.example`
   documents. `VITE_SUPABASE_ANON_KEY` is only a legacy fallback. The value
   itself is **not** a secret you should paste into chat or a commit; take it
   from the Supabase dashboard.
3. `SUPABASE_URL` on line 5 will then load correctly. No other change is needed
   for it.
4. `DATABASE_URL` is **absent** from `.env.local` and is required by
   `pnpm db:migrate`. Add it from Dashboard → Connect (session pooler, port
   6543). See `.env.example` for the shape.
5. `AFHOMES_WEB_URL` is also absent; add it if you want the server to build
   absolute links.
6. Line 12 holds a `VERCEL_OIDC_TOKEN` (a live Vercel CLI credential). It is
   git-ignored and did not reach any build artifact (§J), but consider moving it
   out of a shared dev file and rotating it if that file has been shared.

After step 1, `--check` is expected to pass. **That has not been verified here**,
because verifying it requires editing `.env.local`, which was out of scope. Treat
"ready" as *expected*, not *confirmed*.

## §H Vercel

`vercel.json` declares exactly one scheduled job:

```json
"crons": [{ "path": "/health", "schedule": "0 0 * * *" }]
```

The retired `/crons/commission-clearing` is **not** in the deployed
configuration, and `api/_lib/router.spec.ts:92` asserts that
`selectHandler('/api/v1/crons/commission-clearing')` returns `null` — the path is
provably unroutable, not merely unscheduled.

**The previously deployed configuration keeps running until the next successful
production deployment.** If production was last deployed before this change, the
stale cron is still firing and will continue to until a deploy succeeds. Treat
this as an active, unresolved item, not a closed one.

`functions["api/router.ts"].includeFiles` remains `packages/**`; narrowing it
crashes the deployed function with `ERR_MODULE_NOT_FOUND`.

## §I Health

`GET /health` (and `/api/v1/health`, and the daily Vercel cron) probes the
`modules` table. `ok` is the field to alert on:

| Condition | Status | Body |
|---|---|---|
| Database answers | 200 | `{ ok: true, db: "ok", service: "afhomes-api", time }` |
| Database errors or throws | **503** | `{ ok: false, db: "error", … }` |
| Supabase not configured | **500** | same shape, `ok: false` |

The response never contains credentials, keys, SQL, stack traces, or environment
values.

## §J Secrets

A value-free scan was run over the 6 artifacts in `vercel-static/`. The scanner
reports variable names and hit counts only; no value is printed or written.

| Check | Result |
|---|---|
| 7 environment values (≥ 20 chars) from `.env.local` | **0 occurrences** |
| `sb_secret_` prefix | 0 |
| Supabase service-role JWT pattern | 0 |
| `postgres://user:password@` | 0 |

`pnpm check:env` also passes (167 browser files, 51 server files): browser code
cannot observe any server-only variable.

## §K Deployment blockers

True blockers — each one independently prevents a controlled deployment:

1. **No development or staging Supabase project exists.** The only project is
   production. There is no target to validate against, so the managed stack
   (PostgREST, GoTrue, Storage) is entirely unvalidated (§B, §D, §E).
2. **The Supabase-managed stack is unproven** — PostgREST, Auth and Storage have
   never been executed.
3. **`.env.local` is defective** and defeats both operator scripts (§G). It also
   lacks `DATABASE_URL`, without which migrations cannot be applied.
4. **Migrations are not applied to production.** The runner will skip
   `…0001` and `…0003` if those versions are already recorded, which is why
   migration 9 exists; until it is applied, production may be running broken
   money formatting and a payment-verification function that fails on every
   call.
5. **No Super Admin exists.** Nobody can log in to `/admin`.
6. **Production is still running the previous deployment**, so the retired
   commission-clearing cron is still live (§H).

Optional improvements, not blockers:

- Commit the 54 untracked files (§M). Nothing is lost, but the tree is not
  reproducible from a clone.
- Close the platform's default `authenticated` grant on `auth.users` (§D).
- Run the suite against PostgreSQL 17.x to match production (see below).

### PostgreSQL version gap

Local proof is on **18.4**; production runs **17.6.1**.

`supabase/migrations/*.sql` was audited for version-specific syntax. There is no
PG18-only construct: no `uuidv7()`, no `MERGE`, no `JSON_TABLE`, no `RETURNING
OLD/NEW`, no `NULLS NOT DISTINCT`. Everything used is long-established —
`trim_scale()` and `gen_random_uuid()` (13+), identity columns (10+),
`ON CONFLICT` (9.5+), partial indexes, `jsonb_build_object`, `%rowtype`,
`SECURITY DEFINER` with a pinned `search_path`, `interval` arithmetic.

**Compatible by feature review, but not yet execution-proven on 17.6.1.**

## §L Production runbook

Operator-driven. **Nothing in this section was executed.** Steps 1-3 are
read-only; steps 4, 8 and 10 are the only write actions, each requiring explicit
approval.

### Step 1 — Secure credentials

Correct `.env.local` per §G. The one change that matters most: **delete the empty
`VITE_SUPABASE_ANON_KEY=` line** — an empty value followed by a blank line makes
Node's `loadEnvFile` swallow the next line.

Verify presence, not values:

```sh
node -e "require('node:process').loadEnvFile('.env.local');
for (const k of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL',
                 'AFHOMES_TARGET_PROJECT_REF','AFHOMES_SUPERADMIN_EMAIL','AFHOMES_ADMIN_URL'])
  console.log(k, process.env[k] ? 'set len=' + process.env[k].length : 'ABSENT')"
```

Never echo a value. Confirm the service-role key is the server-side key (a long
JWT), not the publishable/anon key, and that `AFHOMES_TARGET_PROJECT_REF` is
`ikaevepedpqygdlipsei`.

### Step 2 — Backup

Confirm Supabase's backup/restore path is available **before** any schema
migration. On a Hobby plan, point-in-time recovery may not be offered — in that
case take an explicit `pg_dump` and store it outside the project. **If no
restorable backup exists, stop here.**

```sh
pg_dump "$DATABASE_URL" --format=custom --file=afhomes-pre-phase5.dump
```

Verify the dump is non-empty and record its size and checksum.

### Step 3 — Migration preflight

```sh
pnpm db:migrate -- --check
```

Expect: no connection, 9 migrations listed in the order in §C, target reported as
PRODUCTION, and **no blockers**. A blocker here means Step 1 is incomplete.

### Step 4 — Apply migrations (WRITE — requires approval)

```sh
pnpm db:migrate
```

Expect migration 9 to apply. It is idempotent by construction, so re-running is
safe. Record the versions the runner reports as applied.

### Step 5 — Verify schema

```sql
-- 21 tables, RLS on, browser roles SELECT-only
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity;

select table_name, grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated')
   and privilege_type <> 'SELECT';          -- expect 0 rows

-- the four reconciled fixes
select private.money(60000);                -- expect 60000.00
select is_nullable from information_schema.columns
 where table_schema='public' and table_name='commissions' and column_name='ost_id';
                                                -- expect YES
select prosrc from pg_proc where proname='verify_card_payment';
                                                -- expect coalesce(, no self-assignment

-- history
select version, name from supabase_migrations.schema_migrations order by version;
```

### Step 6 — Security advisors

Run the Supabase security and performance advisors in the dashboard. Record every
warning. Expect the RLS and grant findings to be clean; treat any
`auth.users` exposure as a finding to close with a project-level `revoke`
(outside the migrations).

### Step 7 — Super Admin preflight

```sh
pnpm bootstrap:superadmin -- --check
```

Must exit 0. It performs no network call and creates nothing.

### Step 8 — Create the Super Admin (WRITE — requires approval)

```sh
pnpm bootstrap:superadmin
```

The owner then accepts the Supabase-hosted invitation and sets their own
password. **No Super Admin password exists anywhere in this repository.**

### Step 9 — Vercel environment

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`AFHOMES_TARGET_PROJECT_REF`, plus the `VITE_` build variables.
`VITE_WEB_URL` / `VITE_ADMIN_URL` are **derived** from
`VERCEL_PROJECT_PRODUCTION_URL` at build time by
`scripts/prepare-vercel-env.mjs` — do **not** set them, or preview deployments
break. Confirm `functions["api/router.ts"].includeFiles` is still `packages/**`.

### Step 10 — Deploy (WRITE — requires approval)

Deploy to production through the normal Vercel flow. Build chain:
`prepare-vercel-env.mjs` → `turbo run build` → `assemble-vercel-output.mjs`.
Verify afterwards that the served `vercel.json` has only the `/health` cron —
this is the step that finally retires the stale commission-clearing cron.

### Step 11 — Health

```sh
curl -i https://<host>/health
```

Expect `200` and `ok: true`. A `503` means the database is unreachable; a `500`
means Supabase is unconfigured in the Function's environment.

### Step 12 — Admin login

Open `/admin` and sign in as the Super Admin. Expect the Dashboard, Staff,
Departments and Roles screens to load, and Card Products / Customers / Card Sales
/ Payment Queue / Activation Queue / Redemption to be present per permissions.

### Step 13 — Functional smoke tests

Synthetic or approved data only. In order: Dashboard loads → create a customer →
create a card sale → record a payment → Finance verifies it → activate the card →
customer sets a password via the emailed link → customer sees points → staff
redeems points for a catalog item → redemption appears in history. Verify
`sale_financial_summary` totals are exact to two decimals, and that a *recorded*
payment does not count as money.

### Step 14 — Verify the retired cron is gone

Confirm the deployed configuration lists only `/health`, and that
`/api/v1/crons/commission-clearing` returns 404. This is the first point at
which the previously firing cron can be considered stopped.

### Step 15 — Post-deploy security check

Re-run the advisors, `pnpm check:env`, and the secret scan (§J). Review function
logs for auth errors. Confirm `/health` cron runs and reports `ok: true`.

### Step 16 — Rollback / incident response

**Never delete rows from `supabase_migrations.schema_migrations`.** Migration
history is not a rollback mechanism; editing it only causes the runner to skip
work that is still needed.

- **Migration fails.** Stop. Do not retry blindly. The migration runner applies
  files in order; a partially applied file leaves the schema mid-state. Restore
  from the Step 2 dump, fix the migration, and re-run from `--check`. If the
  failure is in migration 9 specifically, note that it is idempotent and can be
  re-applied as-is.
- **Vercel deployment fails.** The previous deployment stays live, so the stale
  cron keeps firing (§H) — treat that as an open item until a deploy succeeds.
  Fix and redeploy; do not change `includeFiles`.
- **`/health` fails.** 503 means the database is unreachable or credentials are
  wrong in the Function environment; 500 means `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` are missing. Check Vercel env vars before
  suspecting the schema.
- **Admin login fails.** Confirm the Super Admin invitation was accepted and the
  Auth user has a `staff_users` row with an active status and a role assignment.
  Re-run `pnpm bootstrap:superadmin` — it is idempotent and reconciles every
  partial state. It never handles a password.
- **Auth fails for customers.** Confirm the redirect allow-list contains the web
  origin, and that email confirmation is not blocking the link.
- **Payment flow fails.** Check whether `verify_card_payment` is the *old*
  installed body — if migration 9 was skipped, this is the expected symptom and
  re-applying migration 9 is the fix. Verify with the §5 query.

## §M Git state

Nothing staged, nothing pushed, nothing committed by this task.

| State | Count | Notes |
|---|---|---|
| Staged | 0 | |
| Modified (tracked) | 21 | includes `package.json`, `AGENTS.md`, `.gitignore`, `supabase/apply-migrations.ts`, and the two amended Phase 2 migrations |
| Deleted (tracked) | 1 | `apps/web/src/app/App.module.css` (intentional) |
| Untracked | 54 | 32 `apps/`, 11 `api/`, 5 `supabase/`, 4 `scripts/`, 2 `packages/` |

Untracked files that carry production risk, because a fresh clone would not
contain them:

- `supabase/db-integration.ts` — the entire database suite
- `supabase/migrations/20260927000005_…customer_portal.sql`
- `supabase/migrations/20260928000001_…redemption.sql`
- `supabase/migrations/20260929000001_…reconcile_phase2_fixes.sql`
- `supabase/db-testing/supabase-shim.sql`
- `scripts/test-db-local.mjs`, `scripts/test-db-harness.mjs`,
  `scripts/lib/local-postgres.mjs`, `scripts/gen-phase5-reconciliation.mjs`

`.env.local` is ignored via `*.local`; `.env.example` is **not** ignored
(verified with `git check-ignore`).

## §N Readiness verdict

# NOT READY

Four required prerequisites are unresolved: there is no development or staging
Supabase project (§A); the Supabase-managed stack has never been executed
(§B, §D, §E); `.env.local` defeats both operator scripts and lacks
`DATABASE_URL` (§G); and production has neither the migrations nor a Super
Admin, while still running the deployment that fires the retired cron (§H).

What *is* established: the AF Homes SQL is correct against real PostgreSQL 18.4
across 536 executed checks, including both directions of the Phase 5
reconciliation; the validation harness itself now fails closed on an unexpected
exception, on a cleanup failure, and on any leaked row; and no credential
reaches a build artifact.

The gap is not in the code. It is the absence of a safe place to prove the code
against the platform it will actually run on.
