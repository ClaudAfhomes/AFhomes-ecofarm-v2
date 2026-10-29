# Native core readiness and approved Atlas setup

27 October follow-up: the historical Identity and dashboard blockers below are
resolved for the verified native core. See [current acceptance](IDENTITY-PURCHASE-ACCEPTANCE.md).
Full-platform cutover and imported workflows remain incomplete.

26 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

## Applied with explicit user approval

The user approved the prepared additive core setup for `afhomes_dev`. The command
`corepack pnpm mongodb:core --apply --approve-core-setup=afhomes_dev` completed.
The [reviewed index plan](CORE-INDEX-PLAN.json) contains 78 non-default index
definitions across 40 collections; identical preexisting indexes are reused.

Missing canonical references were inserted: nine roles and five departments.
Existing module keys were already complete. New roles use the existing reviewed
`DEFAULT_ROLE_BASELINE`; existing roles, permissions, staff assignments, identities
and passwords are not rewritten. No pricing, people or transactions were seeded.

A subsequent read-only verification returned:

```json
{"database":"afhomes_dev","existingAdministratorVerified":true,"coreInitialized":true,"activePlans":0}
```

The first reference transaction hit the standard 15-second MongoDB operation
timeout. Its marker remained unset and references rolled back. The operator-only
setup now uses the same explicit 60-second transaction budget as the existing
bootstrap implementation. The approved retry succeeded. Additive index DDL is
not transactional; previously completed identical indexes were reused safely.

There was no Supabase data migration, administrator reset, invitation, production
deployment or Git push. No credential or raw driver error was printed.

## Newly completed native behavior

- The existing **Public Verification Settings** screen has its native GET/PUT
  endpoint. Only Admin/Super Admin with the existing configuration grants may
  use it. Saving checks the expected revision, rechecks the principal under the
  organization mutation lock and writes the audit in the same transaction.
- Privacy/retention/contact/support changes rotate the notice version. Changing
  only the enable toggle preserves it, matching the source. An old consent flow
  cannot be reused after a notice change. Browser payloads cannot set cleanup
  readiness. Missing configuration defaults to disabled/unapproved; GET writes
  no default settings or identity records.
- Native search retention now has a long-lived server worker, an exclusive
  lease, bounded sweeps and persisted health. Each sweep removes at most 1,000
  expired contacts, disclosures, attempts and corresponding old IP-lock records
  per collection. Contact retention uses current settings; security records use
  the source's 30-day policy. Business counters/records are excluded.
- Readiness requires exactly one valid live job, a recent successful sweep,
  correct implementation/database and the current retention period. Duplicate,
  failed, stale, stopped or expired workers fail closed. Deletions and successful
  sweep health commit together; an injected failure rolls deletions back.
- Contact disclosure takes a transactional write guard so cleanup cannot consume
  the contact record in the middle of a successful disclosure transaction.
- `pnpm dev` has a server-only operator enablement path. The default still
  blocks commercial writes. `AFHOMES_MONGODB_ENABLE_CORE_WRITES=true` requires
  completed core initialization/reference vocabulary and private storage before
  native core routes and the retention worker can start. Unconverted families
  remain blocked; this is not a whole-platform cutover. Startup never seeds or
  bootstraps. The disposable local runtime starts its own synthetic worker only.

## Proof and limits

Local-storage follow-up on 26 October 2026: 43 focused tests passed, including
native account creation against a disposable replica, persistent file reads
across store instances, signed/unsigned/expired HTTP downloads through the actual
development route gate, and production/non-loopback/provider refusal. Workspace
and separate launcher TypeScript checks passed; environment isolation passed.
Repository lint passed with existing warnings (32 admin, 9 web); the API workspace
does not define a standalone lint command. No frontend sources changed in this follow-up.
`pnpm dev` started with the existing ignored environment unchanged: admin 5184,
web 5183 and API health returned 200; unsigned file delivery returned 403. No
real business records or uploaded photos were created during this verification.
These checks do not prove browser upload acceptance or the unported document flows.

- Full API: **2,890 passed / 168 files**, exit 0, with
  `vitest run --maxWorkers=2 --testTimeout=30000`.
- Workspace/operator TypeScript: PASS (seven workspaces).
- Source/built environment isolation: PASS (733 browser sources, 385 server
  sources). Scoped whitespace checks: PASS.
- New native tests cover administrator-only settings, stale revision conflicts,
  audit rollback, worker lease competition, bounded retention, failure/recovery,
  stale/duplicate health and preservation of existing administrator records.
- A real disposable HTTP test exercises public search **without local preview**:
  explicit synthetic policy approval plus healthy cleanup enables disclosure;
  changing the notice invalidates old flows; stopping the worker disables search.
  Only the external Turnstile verification response is mocked, not MongoDB.
- Atlas execution here was the approved setup plus read-only integrity checks.
  Automated business mutation tests still use disposable loopback replicas only.
  No live private-bucket upload or complete real-data browser acceptance is claimed.

## What still blocks normal purchase/account use

1. **Local private storage is now available.** The user deferred paid cloud
   resources. `pnpm dev` selects persistent home-folder storage with signed
   downloads; no cloud bucket is needed for localhost. See
   [PRIVATE-STORAGE-SETUP.md](PRIVATE-STORAGE-SETUP.md) for the session-only
   write-enable command and backup requirements. Hosted storage remains unverified.
2. **Reference plans are now configured.** The user selected current repository
   `develop` as the pricing authority. Three matching reference plans were
   inserted and verified; see [CATALOG-READINESS-REPORT.md](CATALOG-READINESS-REPORT.md).
   Hosted Supabase data was not copied. The browser's next confirmed blocker is
   native identity-document intake, not missing prices.
3. Public disclosure additionally requires actual administrator privacy approval,
   retention/contact settings and real Turnstile keys. No real privacy approval
   was manufactured by setup or by disposable test fixtures.

Full-platform work still includes member editing/transfers, private document and
import workflows, reporting/analytics/CMS cutover and complete browser acceptance.
Direct OST creation, no staff invitations, mandatory temporary-password change,
VIP code/link activation, removed MongoDB MFA and disabled Redemption/Services
remain the user-confirmed rules.
