# AF Homes — Application-First Purchase Flow: Gate 7 Shared-Migration Preflight

**Target project:** `ikaevepedpqygdlipsei` (PRODUCTION)
**Artifact under review:** `supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql`
**Mode:** READ-ONLY. **The migration was NOT applied.**

---

## CLASSIFICATION: BLOCKED

**Blocked on missing credentials, not on a detected defect.**

Phases 1, 2 and 4 (local half) completed and passed. Phases 3 and 5–9 require
read-only access to the shared PostgreSQL database, and **no credentialed path to
that database exists in this worktree**. Those phases are recorded as **NOT
PROVEN**, not as passed.

No schema drift, data conflict, history anomaly or collision was found. Equally,
none was *ruled out*. This package must not be read as evidence that applying is
safe; it is evidence of what was verified and what was not reachable.

---

## 1–4. Local artifact integrity

| Property | Value |
|---|---|
| Filename | `supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql` |
| SHA-256 (recomputed) | `f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58` |
| SHA-256 expected | `f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58` |
| **Match** | **YES — byte-identical** |
| Line count | 1958 (expected 1958) |
| Byte count | 139 796 (expected 139 796) |

**The migration has not changed since Gate 6.** The checksum was compared
directly against the file on disk, not against git, because the file is
**untracked** (`??` in `git status`). `git diff --check` therefore does **not**
cover it; it would have been a false-clean. The direct hash is the real evidence.

### Git state

| Check | Result |
|---|---|
| Branch | `claud/develop` |
| `git diff --check` | exit 0 — clean (2 benign LF→CRLF warnings) |
| `git diff --cached --check` | exit 0 — clean, nothing staged |
| Working tree | 19 modified, 17 untracked (unchanged from Gate 6) |
| Commits | none created |
| Push | **NO** |

---

## 5–7. Shared project identity — **PASS**

Verified read-only through the Supabase Management API (`supabase projects list`).
No secret, key, password or connection string was read or printed.

| Property | Value |
|---|---|
| Project ref | `ikaevepedpqygdlipsei` — **matches the expected target exactly** |
| Project name | `AF homes` |
| Organization | `wypkzhnsuhmykrtwenrx` |
| Region | `ap-northeast-1` |
| Status | `ACTIVE_HEALTHY` |
| Database host | `db.ikaevepedpqygdlipsei.supabase.co` |
| Postgres version | 17.6.1.166 (engine 17, channel `ga`) |
| Created | 2026-09-25 |
| CLI link state | not linked |

**Target confirmed. Identity check passed. No STOP condition triggered here.**

Note: the project is currently **not linked** to this worktree — there is no
`supabase/config.toml` and no `supabase/.temp/project-ref`. Nothing in this
preflight linked it.

---

## 8–9. Migration history and version collision

### Local side — **PASS**

Connection-free preflight, executed as the repo's own sanctioned command
(`pnpm db:migrate -- --check`; no socket opened, no DDL sent):

| Property | Value |
|---|---|
| Migrations found | 39 |
| Target position | 39 of 39 (last) |
| Immediately prior | `20261029000001_afhomes_operational_access_functions.sql` |
| Tracked at `HEAD` | 38 files |
| Files using version `20261101000001` | **exactly 1** — the target itself |
| `20261024000001` anywhere in the repository | **ABSENT from the entire repository** |
| `20261013000001` present | yes (position 19) |

The runner reported the exact selection it would apply:

```
target project  : ikaevepedpqygdlipsei (PRODUCTION)
migrations found : 39
...
39. 20261101000001_afhomes_application_purchase_flow.sql
```

**No local version collision.** Because `20261024000001` does not exist anywhere
in this repository, this work **structurally cannot** restore it: there is no file
to apply and no history to re-add it from.

Required lineage is present locally: `20261021000001` (random membership-number
allocator), `20261022000001` (mutation idempotency), `20261029000001` (operational
access functions).

### Shared side — **NOT PROVEN**

Whether `20261029000001` is actually **applied** on `ikaevepedpqygdlipsei`;
whether `20261101000001` is **already recorded**; whether `20261013000001` is
applied; and whether any *unrelated* shared migration reuses version
`20261101000001`, could **not** be read.

---

## 10–14. BLOCKED PHASES — not proven, not failed

The following required a read-only SQL connection to
`db.ikaevepedpqygdlipsei.supabase.co`. None executed.

| Phase | Question | Status |
|---|---|---|
| 3 | Is `20261029000001` applied? Is `20261101000001` absent? Is `20261013000001` applied? | **NOT PROVEN** |
| 5 | Shared baseline shape of `customer_applications`, `reservation_agreements`, `payments`, `card_sales`, `memberships`, `private.mutation_requests`, `audit_events`; current NOT NULL on `reservation_agreements.sale_id` and `payments.sale_id`; lifecycle/CHECK constraints; business-ID support; activation and payment-verification lineage | **NOT PROVEN** |
| 6 | Shared row compatibility: reservations with unexpected source combinations; payments with invalid legacy relationships; existing `mutation_requests.operation` values; duplicates that would violate the new partial unique indexes | **NOT PROVEN** |
| 7 | Shared definitions/grants of `verify_card_payment` and `activate_card_sale` and their dependencies, for compatibility with the forward replacements | **NOT PROVEN** |
| 8 | Shared RLS and grants on affected tables, to confirm the migration's assumptions still hold | **NOT PROVEN** |
| 9 | Whether schema-before-code remains backward compatible *against the actual shared baseline* | **NOT PROVEN** |

### Exact reason

`pnpm db:migrate -- --check` reported, and this preflight independently confirmed:

```
BLOCKERS (a real run would refuse):
  - AFHOMES_TARGET_PROJECT_REF must equal ikaevepedpqygdlipsei (got nothing).
  - DATABASE_URL is not set. Copy the Session pooler URI from Supabase Dashboard
    > Connect (username postgres.ikaevepedpqygdlipsei, port 6543) into the
    operator environment.
```

Independent confirmation of credential absence (presence only, no values read):

- No `.env.local` — only `.env.example`. No `.env*` with real values.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
  `DATABASE_URL`, `AFHOMES_TARGET_PROJECT_REF`, `AFHOMES_SUPERADMIN_EMAIL`,
  `POSTGRES_URL`, `PGHOST` — all **false** at process, user and machine scope.
- No `supabase/config.toml`, no `supabase/.temp/project-ref`.
- No `access-token` file under `%USERPROFILE%\.supabase` (only `telemetry.json`
  and `traces\`).

**Management-API access works; database access does not.** The CLI is
authenticated for the API (which is how project identity was proven) but every
subcommand that reads the database — `supabase inspect db *`,
`supabase migration list` — requires either a link with a database password or a
`DATABASE_URL`. Supabase never exposes database passwords through the API, so no
API-only route to these phases exists.

### One path deliberately NOT taken

A sibling worktree, `AFhomes-ecofarm-v2`, **does** contain a `.env.local`. It was
**not opened**. Harvesting credentials from a directory outside this session's
working directory is not read-only preflight work; it was never authorised, and
it is exactly the kind of shortcut that turns a preflight into an unreviewed
production connection. Operator input is required instead — see item 26.

---

## 15–17. Detected drift, data blockers, history blockers

| Category | Finding |
|---|---|
| Schema drift | **None detected.** Not inspectable — see item 10. |
| Data blockers | **None detected.** Not inspectable — see item 12. |
| Migration-history blockers | **None detected.** Not inspectable — see item 10. |

Absence of a finding here means absence of evidence, twice over.

---

## 18. Schema-before-code compatibility

Gate 6 concluded the migration is **additive plus NULL-widening**, therefore
schema-before-backend is backward compatible. That conclusion remains the working
assumption, and its local basis is unchanged: the artifact hash is byte-identical,
so the migration reviewed at Gate 6 is the migration being considered.

**It is not confirmed against the shared baseline.** Phase 9 could not run. If the
shared schema has drifted from the local 38-migration lineage, that conclusion
must be re-derived before applying.

---

## 19. Exact proposed apply mechanism — PREPARED, NOT EXECUTED

To run only after explicit approval, and only once the blockers below are cleared.

**Step 1 — supply credentials (operator action, required first).**

Create `.env.local` in this worktree from `.env.example` with:

```
AFHOMES_TARGET_PROJECT_REF=ikaevepedpqygdlipsei
DATABASE_URL=<Session pooler URI: postgres.ikaevepedpqygdlipsei, port 6543, sslmode=require>
```

Never commit it.

**Step 2 — connection-free preflight (safe, repeatable).**

```sh
npx pnpm db:migrate -- --check
```

**Step 3 — per-version read-only history preflight.**

```sh
npx pnpm db:migrate -- --check --only=20261101000001
```

Opens a connection and issues **only** SELECTs against
`supabase_migrations.schema_migrations`. No migration file is read, no
transaction is opened, no migration SQL is executed.

**Honest caveat:** this path also issues two idempotent no-op DDL statements —
`create schema if not exists supabase_migrations` and
`create table if not exists supabase_migrations.schema_migrations`. They are
no-ops where the objects already exist. They are not literally read-only and are
flagged as such rather than glossed over.

This is the command that answers every item in item 10. **Run it before
requesting apply approval.** It prints whether the selected version is already
applied and enumerates earlier unapplied files it would skip.

**Step 4 — the apply (NOT RUN, requires separate explicit approval).**

```sh
npx pnpm db:migrate -- --approve-production --only=20261101000001
```

Properties of this mechanism, all enforced by `supabase/apply-migrations.ts`:

- **Applies one exact version only.** `--only=20261101000001`.
- **No generic catch-up.** Earlier unapplied files are skipped, not swept in.
- **No `supabase db push`, no `migration up`, no repair, no reset, no seed.**
- **No restoration of `20261024000001`** — the file does not exist in this repo.
- Refuses unless `AFHOMES_TARGET_PROJECT_REF === ikaevepedpqygdlipsei`.
- Refuses without `--approve-production`.
- Re-verifies the target project ref before applying.

---

## 20. Exact post-apply validation plan — PREPARED, NOT EXECUTED

**Read-only:**

1. `npx pnpm db:migrate -- --check --only=20261101000001` — must report the
   version already applied and zero migration SQL executed.
2. Catalog checks: `sale_id` nullability on `reservation_agreements` and
   `payments`; existence of `origin`, `reservation_id`, `purchase_terms_id` and
   the snapshot columns; new CHECK constraints.
3. Index presence: `reservations_one_live_per_application`,
   `payments_reservation_reference_unique`.
4. Trigger presence: reservation purchase-identity guard, payment immutability,
   evidence immutability, mutation-receipt immutability, deferred source
   consistency.
5. New objects: `customer_application_purchase_terms`,
   `private.purchase_document_evidence`.
6. RPC signatures for all 11 new functions and the 2 forward replacements.
7. Every `SECURITY DEFINER` function has a pinned `search_path`; none is
   executable by `anon`, `authenticated` or `public`.
8. `mutation_requests.operation` CHECK now admits the new operations.
9. **Legacy row preservation:** counts of pre-existing `customer_applications`,
   `reservation_agreements`, `payments`, `card_sales`, `memberships` must be
   unchanged from the pre-apply snapshot; every legacy row must still show
   `origin = 'sale'`.
10. `supabase/security/rls_invariants.sql` — must return **zero rows**.
11. Browser roles (`anon`, `authenticated`) still hold **no write privilege** on
    any AF Homes table.
12. `private.purchase_document_evidence` reachable by **no** role, including
    `service_role`.

**Requires writes — identified separately, NOT run without approval:**

- Source-consistency smoke probes (create/transition/finalize on a disposable
  customer).
- `supabase/test:db` against the shared project via `AFHOMES_TEST_DATABASE_URL`.
  This **writes synthetic data** and must never target production without a
  dedicated, explicitly approved disposable target.

---

## 21. Application deployment order — PREPARED, NOT EXECUTED

```
shared schema migration (approved, exact artifact)
        ↓
post-apply validation (item 20) — rls_invariants.sql must be empty
        ↓
commit implementation (explicit paths only; no `git add .`)
        ↓
push claud/develop
        ↓
Vercel Preview
        ↓
AUTHENTICATED BROWSER UAT — the 20-step walkthrough
        ↓
fix if needed, re-verify
        ↓
separate, explicit Production approval
```

**The deploy was not performed. The push was not performed.**

Note for the operator: `verify_card_payment` and `activate_card_sale` are
**forward replacements** with unchanged signatures and result shapes, so
old application code keeps working against the new schema. The new code must
still be deployed before the purchase flow is used in anger.

---

## 22. Recovery strategy — unchanged from Gate 6

- **Before any reservation-origin production row exists:** DDL reversal is
  theoretically possible. It must not be used casually, and it requires a
  verified backup first.
- **Once the feature writes begin:** **no destructive rollback.** Recovery is
  disable the new entrypoints → preserve terms, reservation, payment and evidence
  records → investigate → **roll forward** with a corrective idempotent migration.
- Reservation-origin payments cannot be represented by the old schema, and a
  linked sale cannot be unlinked: both the payment immutability trigger and the
  partial unique index refuse it.
- **No destructive rollback SQL was generated.** None was requested.

---

## 23–25. Actions taken

| Action | Performed |
|---|---|
| Shared database changed during preflight | **NO** |
| Migration applied | **NO** |
| `git push` | **NO** |
| Deployment | **NO** |
| Commits created | **NO** |
| Migration history repaired | **NO** |
| Secrets read or printed | **NO** |

Commands executed were limited to: local file hashing and counting, `git`
read-only inspection (`diff --check`, `status`, `ls-tree`, `ls-files`,
`rev-parse`), `supabase projects list`, `supabase migration list`
(attempted, refused — not linked), `supabase inspect db --help`, and
`pnpm db:migrate -- --check`.

---

## 26. What is needed to unblock

1. **Operator decision:** authorize (or decline) supplying
   `DATABASE_URL` (Session pooler, port 6543) and
   `AFHOMES_TARGET_PROJECT_REF=ikaevepedpqygdlipsei` into this worktree's
   `.env.local` for read-only preflight use.
2. **Then run** `npx pnpm db:migrate -- --check --only=20261101000001` to close
   Phase 3 and the version-collision question on the shared side.
3. **Then run** the read-only catalog, data, RPC/ACL and RLS queries for
   Phases 5–8, and re-derive Phase 9.
4. **Only then** request explicit shared-migration approval.

Phases 5–8 also need a way to run read-only SQL that the current toolchain does
not provide: `supabase inspect db *` is fixed-purpose, so the catalog and data
probes need either a direct `psql`-equivalent connection or a purpose-built
read-only probe script.

---

## Bottom line

The artifact is byte-identical to the one reviewed and approved at Gate 6, the
target project identity is confirmed as `ikaevepedpqygdlipsei` / `AF homes` /
`ACTIVE_HEALTHY`, and the local migration chain is clean with no version
collision and no `20261024000001` anywhere in the repository.

**Everything that would justify applying it to a shared production database is
still unproven, because this worktree has no database credentials.**

This is a blocker of missing access, not a found defect. Supplying read-only
credentials closes it.

---
---

# GATE 7 CONTINUATION — credentialed preflight attempt

**Outcome: still BLOCKED. Zero shared-database statements were issued.**

## A. ENV FILE SAFETY — **PASS**

Verified before any `.env.local` could exist.

| Check | Result |
|---|---|
| `.env.local` ignored by git | **YES** — `.gitignore:33:*.local` |
| Secondary rules | `.gitignore:11` `.env`, `:12` `.env.*`, `:13` `!.env.example` preserved |
| `git ls-files --error-unmatch .env.local` | not tracked (error as required) |
| Tracked secret file would be modified | **NO** |
| Will be staged / committed | **NO** — explicit-path staging only |
| Secret-scanning config in repo | **none exists** — no gitleaks, no pre-commit hooks, no husky |

Last row is a real weakness worth stating: **gitignore is the only protection**,
because the repository carries no secret scanner. That is adequate for an
untracked, unstaged, never-committed `.env.local`, and it is why the file must
never be staged.

## B. `--check --only` — CONFIRMED UNSAFE FOR PREFLIGHT, NOT USED

Re-inspected at source (`supabase/apply-migrations.ts:206-209`). With
`--check --only`, after opening a connection it issues:

```sql
create schema if not exists supabase_migrations
create table if not exists supabase_migrations.schema_migrations (version text primary key)
```

These are persistent DDL statements to the shared database — no-ops only where
the objects already exist, but still DDL. Per the continuation brief, **this path
was NOT run.** Its Phase 3/4 value is reproduced instead by direct `SELECT`
against `supabase_migrations.schema_migrations`, which mutates nothing.

The connection-free `pnpm db:migrate -- --check` remains safe and was run last
turn; it constructs no client and sends no SQL.

## C. Read-only probe prepared

`.tmp-bin/gate7-probe.mjs` — git-ignored via `.gitignore:45:.tmp-bin/`.

Covers Phases 1–9 in one pass and was self-audited before handoff:

| Audit | Result |
|---|---|
| SELECT statements issued | 44, all read-only |
| `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`GRANT`/`REVOKE`/`BEGIN`/`COMMIT` | **0** |
| `create schema` / `create table` / `truncate` | **0 executed** — one header comment and one privilege-name regex literal only |
| Transactions opened | **0** |
| Prints host / port / database / sslmode | yes, sanitized |
| Prints password, username, full URL, or any secret | **NO** — verified by grep |
| Prints PII (name, email, phone, government ID) | **NO** — Phase 6 returns counts only |

It also re-verifies the artifact SHA-256 and aborts on mismatch before connecting.

## D. Blocker

`.env.local` **does not exist**, and `DATABASE_URL` / `AFHOMES_TARGET_PROJECT_REF`
are absent from process, user and machine scope.

The continuation brief requires the operator to supply the connection string
locally and forbids pasting the password or full URL into chat. Both were
honoured:

- Password / URL was **not** requested in chat.
- The sibling worktree `AFhomes-ecofarm-v2`, which does contain a `.env.local`,
  was **not** opened. Copying from it requires separate explicit authorization
  that has not been given.

Therefore Phases 1–9 of the continuation **could not run**. They remain
**NOT PROVEN**, exactly as in the first pass. No schema, data, history, RPC, RLS
or ACL claim about `ikaevepedpqygdlipsei` has been established.

## E. Operator step required

Create this file locally in
`C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote\.env.local`:

```
AFHOMES_TARGET_PROJECT_REF=ikaevepedpqygdlipsei
DATABASE_URL=<Session pooler URI: user postgres.ikaevepedpqygdlipsei, host aws-0-<region>.pooler.supabase.com, port 6543, dbname postgres>
```

The `<region>` in the pooler host should match the project's region,
`ap-northeast-1`. Copy the whole "Session pooler" URI from
Supabase Dashboard → Connect; do not hand-assemble it.

Then reply that the file exists. The probe will run immediately and report
sanitized results for Phases 1–9. It will not print the connection string.

**Alternatively**, explicitly authorize copying `DATABASE_URL` and
`AFHOMES_TARGET_PROJECT_REF` from the sibling worktree `AFhomes-ecofarm-v2` into
this worktree's `.env.local`. That authorization has not been given and was not
assumed.

## F. Actions taken during the continuation

| Action | Performed |
|---|---|
| Shared database statements issued | **NONE — zero connections opened** |
| Migration applied | **NO** |
| Shared DB writes | **NO** |
| `git push` | **NO** |
| Deployment | **NO** |
| Commits created | **NO** |
| Secrets printed | **NO** |
| Artifact SHA-256 | `f9e84638…3b72f58` — unchanged |
| `git diff --check` / `--cached --check` | exit 0 / exit 0 |
| Branch | `claud/develop` |

**Classification: BLOCKED** — awaiting operator-supplied read-only credentials.

---
---

# GATE 7 RESUME ATTEMPT — `.env.local` in the wrong worktree

**Outcome: BLOCKED. Zero connections opened, zero shared-database statements issued.**

## What happened

The operator reported that `.env.local` now existed in this worktree. It does not.

```
Test-Path .env.local  ->  False
```

A presence-only sweep (contents never opened, no values read) across every
`AFhomes*` worktree located the file:

| Worktree | `.env.local` | Last modified |
|---|---|---|
| `AFhomes-ecofarm-v2-claud-**promote**` ← **preflight target** | **absent** | — |
| `AFhomes-ecofarm-v2-claud-**develop**` ← session default cwd | **present** | **2026-10-08 07:11:48** |
| `AFhomes-ecofarm-v2` | present | 2026-09-29 19:10:20 (pre-existing, unrelated) |
| `AFhomes-ecofarm-communications-clean` | absent | — |
| `AFhomes-ecofarm-v2-ops-base` | absent | — |
| `AFhomes-ecofarm-v2-ops-clean` | absent | — |

The file modified at **07:11:48** is in the **develop** worktree; this check ran at
**07:13:05**. The operator's new file landed in `AFhomes-ecofarm-v2-claud-develop`,
not in the promote worktree the brief specifies.

The cause is benign and worth naming: this session's environment reports its
working directory as `AFhomes-ecofarm-v2-claud-develop`, so writing "the
`.env.local` for this repo" naturally landed there. The preflight target has been
`AFhomes-ecofarm-v2-claud-promote` on branch `claud/develop` throughout Gates 1–7.

## What was deliberately NOT done

The develop worktree's `.env.local` is a **different directory from the preflight
target**. Copying it across would:

1. violate the explicit instruction not to copy secrets from sibling worktrees,
   which requires separate authorization that has not been given; and
2. introduce a real risk of the preflight and a later apply running against
   credentials staged for a different worktree's state.

So it was **not** read and **not** copied.

## Resolution

Either:

- **Create `.env.local` in `AFhomes-ecofarm-v2-claud-promote`** (the preflight
  target), containing `AFHOMES_TARGET_PROJECT_REF` and the Session Pooler
  `DATABASE_URL`; or
- **Explicitly authorize** copying those two keys from
  `AFhomes-ecofarm-v2-claud-develop` into the promote worktree's `.env.local`.
  That authorization has not been given and was not assumed.

## Actions during this attempt

| Action | Performed |
|---|---|
| Shared database connections opened | **NONE** |
| Shared database statements issued | **NONE** |
| Secrets printed | **NO** |
| Sibling `.env.local` read or copied | **NO** |
| Migration applied | **NO** |
| `git push` / deployment / commits | **NO** |
| Artifact SHA-256 | `f9e84638…3b72f58` — unchanged |

**Classification: BLOCKED** — credential file present in the wrong worktree.

---
---

# GATE 7 RESUME — COMPLETED READ-ONLY PREFLIGHT

**Classification: READY FOR EXPLICIT SHARED-MIGRATION APPROVAL**

`.env.local` was subsequently created in the correct worktree. The
self-audited SELECT-only probe ran to completion (exit 0). **The migration was
NOT applied. No shared-database write occurred.**

Raw evidence log: `.tmp-bin/gate7.log` (git-ignored, ephemeral).

## 1. Artifact SHA

```
sha256  f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58
bytes   139796
match   YES — recomputed on the shared-preflight run itself
```

The probe aborts before connecting if this mismatches. It did not.

## 2. Sanitized endpoint

| Property | Value |
|---|---|
| Hostname | `aws-0-ap-northeast-1.pooler.supabase.com` |
| Kind | Supabase **connection pooler** |
| Port | **6543** (Session pooler — expected) |
| Database | `postgres` |
| SSL mode | require (implied) |
| Region | `ap-northeast-1` |
| Username | withheld — tenant-identifying |
| Password | withheld — never printed |
| Identity source | username-embedded project ref (pooler addressing) |
| Identity verdict | **resolves to `ikaevepedpqygdlipsei`** |

**Correction to the earlier probe.** The first version of the probe required the
project ref to appear in the *hostname* and aborted on this valid pooler URL.
Supabase's pooler addressing carries the ref in the **username**
(`postgres.<ref>`), not the host; only a direct connection uses
`db.<ref>.supabase.com`. The guard was wrong, not the credentials, and was
corrected to accept and validate both addressing forms without ever printing the
username. This is recorded because a guard that aborts for the wrong reason is
indistinguishable from a real blocker until someone reads the code.

## 3. Connection proof

| Query | Result |
|---|---|
| `current_database()` | `postgres` |
| `current_user` | `postgres` |
| `version()` | `PostgreSQL 17.6 on x86_64-pc-linux-gnu, GCC 15.2.0, 64-bit` |
| active transaction | **none** |
| session `search_path` | `"$user", public, extensions` |
| platform roles | `anon`, `authenticated`, `postgres`, `service_role`, `supabase_admin` |

Matches the `17.6.1.166` / engine 17 recorded by the Management API in the first
Gate 7 pass.

## 4. Actual migration history — **the central result**

Read from `supabase_migrations.schema_migrations`.

| Property | Shared actual | Expected | Verdict |
|---|---|---|---|
| Total recorded migrations | **38** | 38 | **MATCH** |
| Latest applied version | **`20261029000001`** | `20261029000001` | **MATCH** |
| `20261013000001` | **APPLIED** | applied | **MATCH** |
| `20261024000001` | **absent — NOT applied** | not restored | **MATCH** |
| `20261029000001` | **APPLIED** | applied | **MATCH** |
| `20261101000001` | **absent — NOT applied** | not applied | **MATCH** |
| Recorded but file absent locally | **none** | none | **MATCH** |
| Local files not applied | **only** `20261101000001_afhomes_application_purchase_flow.sql` | only the target | **MATCH** |

The shared project carries **exactly** the 38 migrations of local `HEAD`, and the
target migration is the **single** pending item. There is no partial application,
no drift, and no unrelated pending file that a catch-up would sweep in.
`20261024000001` is confirmed absent from shared history — it was never restored,
and nothing in this work restores it.

## 5. Version collision — **NONE**

| Check | Result |
|---|---|
| Local files owning `20261101000001` | **1** — the target itself |
| Shared history entries with that version | **none** |

## 6. Schema compatibility — actual shared definitions

| Object | Shared actual | Migration precondition | Verdict |
|---|---|---|---|
| `reservation_agreements.sale_id` | `uuid NOT NULL` | expected NOT NULL pre-apply | **MATCH** |
| `reservation_agreements` sale uniqueness | `UNIQUE (sale_id)` named `reservation_agreements_sale_id_key` | must coexist | **safe** — see §9 |
| `payments.sale_id` | `uuid NOT NULL` | expected NOT NULL pre-apply | **MATCH** |
| `payments.sale_id` FK | `payments_sale_id_fkey → card_sales(id) ON DELETE RESTRICT` | relaxing NOT NULL does not affect an FK | **safe** |
| `payments_payment_number_unique` | `UNIQUE (payment_number)` | untouched by migration | **MATCH** |
| `payments_sale_reference_unique` | `CREATE UNIQUE INDEX (sale_id, reference) WHERE reference IS NOT NULL` | untouched; legacy rows keep their guarantee | **MATCH** |
| `payments.status` CHECK | `recorded / verified / rejected / voided` | unchanged | **MATCH** |
| `reservation_agreements.status` CHECK | `draft / submitted / executed / cancelled` | unchanged | **MATCH** |
| `reservation_agreements` lifecycle CHECKs | `submitted_at` / `executed_at` guards present | unchanged | **MATCH** |
| money CHECK regexes | present on all snapshot + amount columns | exact-decimal preserved | **MATCH** |
| `private.mutation_requests` | `id, actor_id, operation, request_id, payload_hash, result_identifier, created_at` — **no `result_receipt`** | migration ADDS `result_receipt` | **MATCH** |
| `customer_application_purchase_terms` | **absent** | migration creates | **MATCH** |
| `private.purchase_document_evidence` | **absent** | migration creates | **MATCH** |
| `card_sales` | has `origin text NOT NULL`, `sale_number`, RLS on | untouched | **MATCH** |
| RLS enablement | enabled, **not forced**, on all 6 inspected tables | migration adds no browser policy | **MATCH** |

Migration source confirmed it relaxes only `sale_id` NOT NULL (twice) and drops
only `mutation_requests_operation_check` to widen it. It **does not** drop
`reservation_agreements_sale_id_key`, **does not** drop
`payments_sale_reference_unique`, and issues no `drop index`. That is the correct
and minimal shape.

## 7. Data compatibility — counts only, no PII

| Check | Count | Verdict |
|---|---|---|
| `reservation_agreements` total | 5 | — |
| reservations with NULL `sale_id` | **0** | clean |
| reservations with dangling `sale_id` | **0** | clean |
| reservations with dangling `customer_application_id` | **0** | clean |
| duplicate **live** reservations per application | **0** | clean — new partial unique index is satisfiable |
| `payments` total | 14 | — |
| payments with NULL `sale_id` | **0** | clean |
| payments with dangling `sale_id` | **0** | clean |
| duplicate `(sale_id, reference)` | **0** | clean — existing partial unique index is satisfiable |
| applications with dangling `customer` | **0** | clean |
| `card_sales` total | 15 | — |
| `memberships` total | 6 | — |
| `audit_events` total | 223 | — |
| `private.mutation_requests` total | 2 | — |
| distinct `mutation_requests.operation` values | 1 | — |
| existing `operation` values | `application.create` | all inside the widened CHECK |

The `N/A` entries in the log (`origin`, `reservation_id`, `purchase_terms_id`
columns) are columns the migration **adds**; their absence is the expected
pre-state, not a defect.

**Zero data blockers.** No row violates a new constraint, and no existing row
would collide with `reservations_one_live_per_application` or
`payments_reservation_reference_unique`.

## 8. RPC lineage — forward replacements match exactly

| Function | Shared signature | Shared result | SD | `search_path` |
|---|---|---|---|---|
| `verify_card_payment` | `(p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid)` | `TABLE(sale_id uuid, status text, verified_total text, remaining_balance text, fully_paid boolean, spot_cash_deadline timestamptz)` | true | `public, private, pg_temp` |
| `activate_card_sale` | `(p_sale_id uuid, p_actor_id uuid, p_validity_months integer)` | `TABLE(membership_id uuid, membership_number text, fallback_code text, qr_token text, points_allocated bigint, already_active boolean)` | true | `public, private, pg_temp` |

Both argument lists and both result column lists are **identical** to what the
migration's `create or replace` expects. Neither can fail on signature or result
drift. Supporting lineage all present:

`private.next_membership_number()` (the **random** allocator — the Task H
regression target), `private.has_permission(text, text)`,
`private.mutation_result(uuid, text, uuid, jsonb)`,
`private.complete_mutation(uuid, text, uuid, jsonb, uuid)` (**5 args, no receipt
parameter** — consistent with the migration adding a separate
`complete_purchase_mutation` rather than changing this one),
`public.next_sale_number()`, `public.next_customer_number()`,
`private.money(numeric)`.

**Zero purchase-flow objects pre-exist** — all 11 new RPCs are absent, so there
is no partial-application contamination.

## 9. RLS / ACL — no unexpected browser privilege

| Table | Policies | Browser grants |
|---|---|---|
| `customer_applications` | 1 × SELECT for `authenticated` | SELECT |
| `reservation_agreements` | 1 × SELECT for `authenticated` | SELECT |
| `payments` | 1 × SELECT for `authenticated` | SELECT |
| `card_sales` | 1 × SELECT for `authenticated` | SELECT |
| `memberships` | 1 × SELECT for `authenticated` | **none** |
| `audit_events` | 1 × SELECT for `authenticated` | SELECT |

- **Browser WRITE privileges found: NONE.**
- Every policy is SELECT-only. No INSERT/UPDATE/DELETE policy exists for `anon`
  or `authenticated` on any affected table.
- `private` schema: `postgres` holds owner rights; `service_role` holds **SELECT
  only** on `private.business_id_aliases`; `private.mutation_requests` is reachable
  by `postgres` alone.
- The migration's revoke/grant assumptions hold. It adds no browser policy and
  revokes every new `SECURITY DEFINER` function from `public`/`anon`/
  `authenticated`, which is consistent with what is already there.

## 10. Schema-first release decision

# SCHEMA-FIRST COMPATIBLE

Rests on four facts established above, not on the Gate 6 assumption:

1. **The two NOT NULL relaxations are safe under PostgreSQL's uniqueness rules.**
   `reservation_agreements` keeps `UNIQUE (sale_id)`. PostgreSQL treats NULLs as
   distinct in a unique constraint, so relaxing NOT NULL does not prevent
   multiple application-origin reservations with no sale. No index needs dropping,
   and the migration correctly drops none.
2. **The FK survives.** `payments_sale_id_fkey` constrains only non-NULL values,
   so making `sale_id` nullable weakens nothing that existed.
3. **The forward replacements are drop-in.** Identical signatures, identical
   result column lists, both already `SECURITY DEFINER`. Currently deployed code
   calling either function keeps working against the new definitions.
4. **Nothing can observe the widened schema before the new code exists.** A NULL
   `sale_id` reservation or payment can only be written by the migration's own new
   RPCs, and those RPCs do not exist until the migration is applied. The only
   caller capable of creating one is the new, not-yet-deployed application code.

The ordering is in fact **required, not merely permitted**: deployed before the
schema, the new application would call `reserve_application_purchase_once`, which
does not exist until the migration is applied. Schema-first is the only safe order.

Scope of the claim: schema-first is backward compatible for the existing
codebase and existing rows, proven against the live shared baseline. No
zero-downtime claim beyond that is made.

## 11. Exact future apply plan — PREPARED, NOT EXECUTED

```
project    ikaevepedpqygdlipsei
version    20261101000001
file       supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql
sha256     f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58
command    npx pnpm db:migrate -- --approve-production --only=20261101000001
```

Guarantees, all enforced by `supabase/apply-migrations.ts`:

- **One exact version only** — `--only=20261101000001`.
- **No generic catch-up.** Verified live: exactly one local file is unapplied, so
  even an accidental catch-up would apply only the target — but `--only` makes it
  impossible rather than coincidental.
- **No `20261024000001` restoration.** Confirmed absent from shared history, and
  the file does not exist in this repository.
- **No repair, no reset, no seed, no `db push`, no `migration up`.**
- Refuses unless `AFHOMES_TARGET_PROJECT_REF === ikaevepedpqygdlipsei`, and refuses
  without `--approve-production`.

The tooling **can** guarantee a single exact-version apply, so no alternative
mechanism is proposed.

## 12. Post-apply validation plan — PREPARED

**Read-only, immediately after apply:**

1. `npx pnpm db:migrate -- --check --only=20261101000001` — version now applied.
   *Caveat retained: this path issues two idempotent `CREATE ... IF NOT EXISTS`
   statements, so it is a validation step, not a preflight step.*
2. History contains `20261101000001`; total becomes **39**.
3. `sale_id` nullable on `reservation_agreements` and `payments`; `origin`,
   `reservation_id`, `purchase_terms_id` and snapshot columns present.
4. `customer_application_purchase_terms` and
   `private.purchase_document_evidence` exist.
5. Indexes `reservations_one_live_per_application` and
   `payments_reservation_reference_unique` exist.
6. All 5 purchase triggers and the deferred source-consistency triggers exist.
7. All 11 new RPCs exist with the reviewed signatures; the 2 replacements keep
   theirs; every `SECURITY DEFINER` function pins a `search_path`.
8. `mutation_requests.operation` CHECK admits the new operations.
9. **Row preservation:** counts still `reservations=5`, `payments=14`,
   `card_sales=15`, `memberships=6`, `audit_events=223`,
   `mutation_requests=2`; every legacy row still `origin='sale'`.
10. `supabase/security/rls_invariants.sql` → **zero rows**.
11. Browser roles still hold **no write privilege**.
12. `private.purchase_document_evidence` unreachable by every role including
    `service_role`.

**Write-requiring smoke tests — identified, NOT run, need separate approval:**
create/transition/finalize on a disposable customer; `pnpm test:db` against the
shared project via `AFHOMES_TEST_DATABASE_URL`, which writes synthetic data and
must never target production without a dedicated disposable target.

## 13. Actions performed

| Action | Performed |
|---|---|
| Shared DB **writes** | **NO** — SELECT only |
| Migration applied | **NO** |
| Shared DB connections opened | yes, one read-only session |
| Statements issued | SELECT-only, per probe self-audit |
| Secrets printed | **NO** — username and password withheld |
| PII printed | **NO** — counts only |
| `--check --only` run | **NO** — performs DDL |
| `git push` / deployment / commits | **NO** |
| Artifact SHA-256 | `f9e84638…3b72f58` — unchanged |
| Branch / HEAD | `claud/develop` / `c165a21` |
| `git diff --check` / `--cached --check` | exit 0 / exit 0 |

**Classification: READY FOR EXPLICIT SHARED-MIGRATION APPROVAL**