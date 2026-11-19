# Native MongoDB checkpoint - 3 November 2026

Later continuation: the larger 10,000-customer workload exposed a directory
pagination bottleneck that was corrected. Current production-mode and browser
acceptance evidence is in [local release acceptance](LOCAL-RELEASE-ACCEPTANCE-2026-11-03.md).
The small-fixture results below are an earlier checkpoint, not final browser proof.

The owner's latest decision is a fresh native MongoDB system, without combining
Supabase history. Supabase and captured archives stay untouched. Existing native
records and the MongoDB administrator/password/assignments are preserved. This is
not authorization to clear either database. Historical migration conflicts and
unmounted adapters are no longer blockers for native operation.

## Current configuration and database inspection

- Root `pnpm dev` launches `api/scripts/dev-mongodb-admin.ts` and forces MongoDB
  browser authentication. The ignored local file enables previously approved core
  writes and selects `afhomes_dev`; legacy-password migration mode is absent.
  Only these nonsecret settings were inspected; no environment values were changed.
- `check-mongodb-readiness.ts` exited 0 in read-only mode: 67 collections, six
  validators, no missing declared collections/indexes, no broken declared core
  references. Both inspected memberships passed verified-payment/points checks;
  listed malformed-money and points-account checks found zero issues. Schema
  comparison used a fresh disposable replica. No Atlas schema/data was changed.
- Scope is declared relationships/checks, not certification of every record or
  proof of browser usability.

## Defect found and corrected

IST-to-OST integration failed with 400 before any conversion writes. The form
validator used UTC's date while native accreditation used Manila's date, rejecting
today during 00:00-07:59 in the Philippines. A frozen-clock regression reproduced
this at `2026-11-02T16:01:00Z` before the fix. Validation, official form defaults and
Create/Convert OST date defaults now use Manila's date; future application dates
remain rejected. No existing accreditation dates or accounts were edited.

All five native conversion tests now pass, including concurrent replay,
credential/history preservation, permission denials and audit-failure rollback.
The related 18 UI/session tests and all 319 contract tests pass. These UI tests
use controlled fixtures and do not replace browser acceptance.

## Native correctness and load evidence

Fresh disposable MongoDB/HTTP checks passed 74 tests across ten files: native
authentication/activation/recovery, purchase lifecycle, imports, team access,
analytics, GSD lookup grants, points, permanent VIP issuance and bounded load.
The authentication suite now throws on acquiring any Supabase database/Auth/
Storage client and asserts no such client was acquired throughout its HTTP flows.
This proves the covered paths; it does not assert every dormant legacy module
has been removed from source.

The adjacent ten-file member/public-search/catalog/hosting run passed 38 tests
and exposed four conversion failures (one root failure plus dependent cases).
The focused five-test conversion rerun passes after the date correction.

The bounded workload completed 240 requests with eight workers and no failures,
including 48 exact 256-KiB private downloads. This run, alongside other integration
tests on this PC, measured median 126.32 ms / p95 236.37 ms / max 334.71 ms and
59.31 requests/second. The final full-suite run measured median 49.26 ms / p95
83.08 ms / maximum 130.11 ms and 151.38 requests/second for the same workload;
differences reflect concurrent local test work, not a claimed optimization.
Permission denial/restoration and suspension took effect
on the next request. Sixteen simultaneous points corrections all succeeded with
16 ledger entries and exact +160 total / +112 weekday / +48 weekend deltas.
These are synthetic loopback measurements, not Atlas/production capacity.
No authorization cache, new service or speculative index was added.

## Remaining evidence limits

The first full API run passed 3,278 tests / 222 files but failed one suite setup:
the disposable MongoDB server exceeded its 10-second launch limit across an
apparent long PC interruption (that file reported 4,721,995 ms). All three affected
database-readiness tests passed on an isolated rerun in 8.34 seconds. This does
not make the original run green. A second run was also interrupted: one
5-second test reported 9,549,592 ms and one worker failed to start. Both failed
runs remain recorded; no test timeout or application expiry was relaxed.

The final complete API run passed **3,281 tests across 223 files**, exit 0, in
185.42 seconds using four workers. Temporary process-scoped Windows idle-sleep
prevention was enabled for this verification only and released in `finally`.
Permanent power settings were not changed. The full suite includes retained
Supabase fake/source tests as well as native MongoDB suites; the total does not
represent 3,281 native integration tests. The covered native HTTP paths have
separate evidence above.

Repository typecheck, environment isolation and focused lint pass. Both web and
admin builds pass with existing warnings about chunks over 500 KiB; no bundle
size improvement or browser-load improvement is claimed.
Browser tooling observed the disposable signed-in dashboard after the owner
completed password change, but further Windows browser navigation was stopped by
the tool because it could not reliably determine the current URL. Full browser
role acceptance remains unverified. No alternative automation bypass was used.

Backups remain on this PC by owner choice; off-device recovery is not proven.
No commit, push, deployment, historical import, account reset or paid service was
performed in this checkpoint. Passing checks do not establish a flawless system.

## Reproduction commands

Run from `C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2` on
`claud/mongodb-conversion`. Tests use disposable fixtures, not Atlas.

```powershell
pnpm --filter api exec vitest run --maxWorkers=4
pnpm --filter @afhomes/contracts exec vitest run
pnpm --filter @afhomes/admin exec vitest run src/features/network-members/TransferMemberDialog.spec.tsx src/features/network-members/TransferToIstDialog.spec.tsx src/features/network-members/CreateOstDialog.spec.tsx src/features/network-members/CreateOstDialog.mongo.spec.tsx src/lib/session.mongo.spec.tsx
pnpm typecheck
pnpm check:env
pnpm build
```
