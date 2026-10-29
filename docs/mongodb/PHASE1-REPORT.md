# Phase 1 foundation and connection report

Date: 25 October 2026. Local work only; no commits, pushes or deployments.

Follow-up: [validation cleanup findings and current results](VALIDATION-CLEANUP.md).
The initial validation table below is retained as historical evidence; the linked
cleanup report records the later fixes and supersedes its open-failure status.
Current local validation: **4,574 tests pass across 326 files**; typecheck,
lint, both SPA builds, and source/built environment isolation all pass.
Live authenticated/browser/database workflow acceptance remains NOT RUN.

## Repository foundation

- Source: `https://github.com/ClaudAfhomes/AFhomes-ecofarm-v2`, branch `develop`,
  snapshot `f512c1416550feaf0c79a6bb204c51d08fa990f6`.
- Target: `https://github.com/ClaudAfhomes/afhomes-mongodb`, local branch
  `claud/develop`, tracking `origin/claud/develop`.
- Target history remains its original initial commit
  `5bfa6f02fc347e516b8f2fb3d6dd9958da4a25db`. No source commits, remote, merge,
  or unrelated histories were imported. No files were staged.
- Source was inspected in a separate temporary local clone at
  `C:\Users\SSD-CLAUD\afhomes-mongodb-source-inspect`; its working tree is clean.
  The source remote and existing AFHomes workspaces were not modified.
- Copied 1,372 tracked source files and verified each copy with SHA-256.
  Kept the target `.git`, README and ignore rules; merged necessary ignore rules.
  Excluded 388 generated `graphify-out` files. No source environment secrets,
  dependency directories, Git metadata or deployment credentials were copied.
- A subsequent comparison found no missing application/source files, excluding
  the documented generated-output exclusion. Intentional changes are the driver,
  connection check, flags, tests, environment isolation, target guidance and docs.

Remote branch heads observed during inspection:

| Source branch | Head |
| --- | --- |
| develop | f512c141 |
| claud/develop | d7410454 |
| claud/clean-develop | dc98db6a |
| orly/develop | e965d66c |
| main | 75ec4704 |
| feature/afhomes-communications | c6d5a420 |
| release/v1.0 | ce19f95d |
| staging/v1.0 | 77d7436b |

Target `main`, `develop`, and `claud/develop` all pointed to `5bfa6f02`.
These are inspection snapshots, not promises about later remote branch state.

## Preserved and disabled functionality

Sales, Finance, Customers, IST/OST, Sales Network/genealogy, Organization,
RBAC and Reports retain their source components, contracts and handlers.
They have NOT been converted to MongoDB, and live workflow operation is unverified.

`packages/shared/src/features.ts` is the single feature-flag authority:
`redemption: false`, `services: false`. Enabling requires a reviewed code change;
there are no browser-controlled authorization flags.

- Admin Redemption, transaction member lookup and operational Services (`/admin/points`)
  are removed from the sidebar and denied on direct entry, including existing
  portal aliases through the inherited path normalization.
- Customer redemption and purchase-claim points screens and their navigation/dashboard
  links are hidden/disabled. Read-only customer points endpoints remain available
  for the preserved account dashboard. Customer card-payment history stays enabled.
- `/api[/v1]/redemptions/*`, `/earning/*`, customer refunds and the redemption
  report are unroutable before handler/database access. The redemption report
  is also omitted from the report selector; other report families remain.
- The public operational service-catalog query does not execute. Existing CMS
  destination/experience pages remain separate and retain their source content.
- All Redemption/Services implementation files remain present. Retained behavior
  suites use explicitly enabled test fixtures; separate tests prove the real
  default flags hide/refuse these modules.

## MongoDB connection verification

Official backend dependency: `mongodb@7.7.0`, pinned in `api/package.json` and
`pnpm-lock.yaml`. License: Apache-2.0. Driver requires Node >=20.19.0; local Node
is 24.19.0, compatible with the inherited runtime floor. Existing pnpm 11.22.0
was used; no ORM or alternative package manager was added.

Configuration remains in ignored root `.env.local`: `MONGODB_URI`,
`MONGODB_DB=afhomes_dev`. The agent never edited or printed that file's values.
The user corrected its credentials locally after the first connection rejection.
The configured username then matched `afhomes_dev_app` and the retry passed.

Command: `corepack pnpm mongodb:ping`.

Result: **PASS**, exit 0: authenticated ping against `afhomes_dev`.
The command loads the local environment with Node's built-in loader, validates
the database allowlist, connects using the backend driver, executes exactly
`client.db(database).command({ ping: 1 })`, checks `ok === 1`, and closes in
`finally`. It prints only a static status line; failures omit driver error details.

Initial attempt: FAIL, Atlas server error code 8000; DNS SRV lookup passed and
the local username did not match the requested user. The user updated the local
file; no network, Atlas account, credential, or database settings were changed
by the agent.

No collection/index creation, inserts, updates, deletes, seeds or migrations were
executed. Ping does not prove collection permissions, existing database contents,
transactions, Atlas administrative project/cluster identity or business workflow
readiness. The Atlas project/Cluster0 names are user-provided context; no Atlas
administrative API was queried.

## Supabase audit and conversion plan

[SUPABASE-INVENTORY.md](SUPABASE-INVENTORY.md) records exact source paths and
literal RPC/table/bucket names. Initial static scan: 7 Supabase import files,
77 query files, 37 RPC files, 23 Auth files, 3 Storage files, 149 literal RPC
names and 59 literal table/bucket names. No live Supabase data or settings were
queried and no Supabase writes were made.

[CONVERSION-PLAN.md](CONVERSION-PLAN.md) covers identity-provider choice,
sessions/invitations/MFA/recovery, effective permissions/customer ownership,
collection/index proposals, exact-money/points/date representation, UUID and
business-number generation, atomic transactions/idempotency, storage/outbox,
reports/imports and staged acceptance gates. Authentication design is a review
decision, not an implemented replacement.

## Initial foundation verification (historical)

| Check | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile --filter=!@afhomes/db-testing` | PASS, exit 0; preserved existing package manager and added only driver dependencies |
| `corepack pnpm mongodb:ping` | PASS, exit 0 after user corrected local credentials |
| `corepack pnpm typecheck` | PASS, exit 0; all 7 configured workspace checks plus Supabase operator TypeScript |
| `corepack pnpm build` | PASS, exit 0; both SPAs and public SEO prerender; existing large-chunk warnings |
| `corepack pnpm lint` | PASS, exit 0; warnings remain (admin: 29, no errors) |
| Focused API MongoDB/flags/router/real HTTP tests | PASS: 5 files, 40 tests |
| Focused default admin flags/navigation/authorization/report availability | PASS: 4 files, 40 tests |
| Default web flags/no catalog request/direct-entry denial | PASS: 3 tests; included in full web result below |
| Full web suite, final run | PASS: 22 files, 265 tests |
| Contracts/config/shared/UI package suites | PASS: 61 files, 600 tests total (313 + 6 + 51 + 230) |
| Full API suite, final broad run | FAIL: 2,712 passed, 3 failed; one unchanged workbook expectation mismatch and two 5-second timeout failures |
| API timeout cases, isolated single-worker rerun | PASS: both selected cases; 46 other tests intentionally filtered out, not counted as passes |
| Admin full initial run | FAIL: 953 passed, 32 failed; included old expectations for now-disabled modules plus copied forms/address tests and runtime/timing failures; this was before test-fixture updates |
| Admin final impacted suites (7 files) | FAIL: 75 passed, 2 failed in inherited staff/role responsive fixtures; flags, navigation, authorization, reports and retained redemption tests passed |
| Admin responsive failures, isolated single-worker rerun | PASS: both selected staff/roles cases; 27 other tests intentionally filtered out |
| `corepack pnpm check:env` | FAIL: two unchanged source `import.meta.env.VITEST` usages in `official-forms-applications.tsx` (lines 664 and 693) violate the existing scanner |
| MongoDB server names in browser bundles | PASS: neither `MONGODB_URI` nor `MONGODB_DB` occurs in either built SPA's JS/HTML/CSS |
| Source tree / target Git boundary | PASS: inspected source clone clean; target remains on `claud/develop` at its initial commit; `.env.local` ignored, nothing staged |
| Live authenticated browser UAT, source DB integration, Atlas collection/transaction permissions | NOT RUN; no new workflow implementation, source credentials or database writes were used |

Initial failures investigated in the follow-up cleanup:

- `api/_handlers/membership-template.spec.ts:200` expects eight workbook tabs;
  the unchanged workbook includes an additional `Examples Guide` tab. Neither
  this test nor its workbook asset was altered by Phase 1.
- Final broad API run timed out at 5 seconds in the 500-row company workbook
  test and the bad-guided-values import test. Earlier broad runs also had
  workbook parsing timeouts. Both final timeout cases pass in an isolated
  single-worker rerun (2 selected tests, 46 filtered out). The full concurrent
  suite remains FAIL; no timeout limit was changed to obtain a pass.
- Final impacted admin run could not find its expected synthetic staff name and
  role table in two 390px responsive tests. Both pass in an isolated single-worker
  rerun (2 selected tests, 27 filtered out), so no product code or test timeout
  was changed. The initial full run also failed
  unchanged application-actions, final-blockers, official-forms-fields and legacy
  address tests. These require a separate investigation; there was no clean
  source-checkout runtime baseline, so their underlying causes are not established.
- Database integration suites intentionally not executed: they can create test
  records or provision a database and are outside this phase's read-only boundary.

Raw check logs are ignored local `.phase1-*.log` files. Broad-suite results are
not release acceptance. Retained module behavior tests explicitly enable flags
only inside isolated fixtures; default-off behavior has separate passing proofs.

## Scope held

No existing Supabase data migration. No MongoDB data/schema changes. No deployment
to DigitalOcean or Vercel. No source repository changes. No credentials or local
environment files staged or committed. No commits or pushes. No implementation
of the remaining MongoDB business workflows.

Next gate: review these results and the conversion/authentication plan before
authorizing a separately scoped next phase. Current application business APIs
and `/health` still use Supabase; an Atlas ping is not an application cutover.
