# Develop integration into claud/supabase

Latest status, 7 November: core database/current dated workflows, the Supabase
API suite and the complete admin suite pass; the two specifically approved live reconciliations are applied
and verified. See the continuation below for the current proof and remaining limits.

Date: 6 November 2026.

Source: `origin/develop` at `e759f69`.
Target: the working tree of `claud/supabase`, originally clean at `ce19f95`.
This is an uncommitted source integration. The branch HEAD and index were not
changed; no merge commit, push, deployment or live database operation was made.

All 1,584 source files under `api/`, `apps/`, `packages/`, `scripts/`, `supabase/`
and the selected root build/configuration files are present. Business/UI changes,
contracts, assets, tests, migrations and the `@afhomes/*` namespace are retained.
Develop's removal of retired JAD files is retained. Generated `graphify-out/`,
output reports, MongoDB hosting templates and MongoDB agent instructions were
excluded. This branch's Supabase AGENTS.md remains authoritative.

## Supabase adaptations

- `pnpm dev` starts the shared Supabase API and both SPAs through Turborepo.
- Public configuration defaults to Supabase and rejects MongoDB authentication.
  Both browser gateways select the Supabase path.
- Supabase Auth, Postgres, private Storage and the Vercel router remain active.
  MongoDB standalone launch/build/operator commands are removed from the active
  package scripts; their source remains available for comparison.
- MongoDB standalone entry points are excluded from Vercel upload.
- The customer reactivation UI now has a permission-checked Supabase endpoint.
  It restores only suspended customer status and records an audit event; it does
  not recreate or reconnect login credentials.
- New migration `20261226000001_afhomes_supabase_review_reason_reconciliation.sql`
  removes the original unnamed mandatory-reason constraint that the earlier
  optional-reason migration missed. Supplied reasons still require 5–500
  characters. Existing migration bodies were not rewritten.
- Purchase integration fixtures follow the optional-reason and automatic
  reservation changes. Manual reservation tests isolate the reservation RPCs.

Develop's feature flags remain as received: Redemption, Services, Reports and
CMS are disabled. Retaining their source does not enable those modules.

## Verification

- Frozen-lockfile installation: PASS; existing develop dependency versions used.
- Typecheck: PASS, including Supabase scripts.
- Build: PASS; existing large-chunk warnings remain.
- Lint: PASS with 42 warnings and no errors.
- Environment isolation: PASS.
- Config: 7 tests PASS; contracts: 334 PASS; shared: 59 PASS; UI package: 243 PASS.
- Web app: 277 tests PASS.
- Customer detail/reactivation and member workbook: 93 tests PASS together.
- Every migration: 149 applied successfully on disposable loopback PostgreSQL.
  The new correction also passed repeated application. RLS invariants: zero violations.
- Purchase-terms database section: 106 checks PASS, including a reasonless review
  and approval's automatic reservation with a recorded, unverified fee payment.
- Full PostgreSQL suite: FAIL, 2,014 of 2,024 checks passed. Remaining failures:
  two obsolete non-draft reservation-save expectations, seven missing legacy
  redemption-fixture assertions, and `STAY_SERVICE_DATES_REQUIRED` in the points
  fixture. Later sections are not proven after that abort.

- Full Supabase API selection: FAIL, 3,071 of 3,074 tests passed; three timed out
  in the concurrent run. Isolated reruns passed 64 of 65 tests across those three
  files; the company-member-workbook malformed-input preview still exceeded 30s.
- Admin app: FAIL, 1,059 of 1,067 tests passed (107 of 113 files passed).
  Eight failures cover the imported-application redirect, view-only finance
  rendering, three staff lifecycle cases, customer-prefill clearing, report
  loading and redemption history. The report/redemption cases still expect
  screens that develop's feature flags disable. The other failures remain
  unresolved; no browser acceptance is claimed.

Release verdict: NOT RELEASE READY. Browser UAT and the managed Supabase stack
were not verified. New migrations require explicit review/authorization before
any shared apply.

## Parity follow-up (7 November 2026)

Fetched `origin/develop` again: it remains at `e759f6904b4fef31ddb6be07f68a903c07c9ee49`.
Compared the actual working files, including untracked imported files, against
Git's source blobs with repository line-ending filters. All 1,584 selected
source/configuration paths are present; no additional develop update is missing.
Ordinary `git diff origin/develop` is insufficient for this checkout because it
treats imported, untracked files as absent from the index.

The requested paths are retained from develop:

| User flow | UI | Supabase implementation |
| --- | --- | --- |
| Public AAI/AAO verification | `/sale-team-search`, `SaleTeamSearch.tsx`, `VerificationResultCard.tsx` | `sale-team.ts` -> `sale-team-public-search.ts` -> private search/contact/disclosure tables through restricted RPCs; private signed profile photos |
| Customer lookup | `/admin/customer-lookup`, `CustomerLookupPage.tsx` | `memberships.ts` -> `customer_directory` and `gsdActiveVipLookupFromDirectory`; separate `operations.customer_lookup` permission |
| Customer application | Existing application routes and shared API contracts | Supabase official-form handlers and frozen purchase terms; retains the requested radio choices, referring-member genealogy, review, and split card/form layout |

Fresh focused verification:

- Public search/accreditation/settings database suite: 139 checks PASS on
  disposable loopback PostgreSQL, applying every migration and cleaning fixtures.
- Public search, accreditation, search security, customer/member lookup access,
  and settings API suites: 58 tests PASS across six files.
- Public search UI: 9 tests PASS, including AAI and AAO results.
- Customer lookup UI: 22 tests PASS.
- Workspace typecheck: PASS, including Supabase scripts.
- Finance/staff lifecycle rerun: 53 tests PASS.
- Application validation/prefill rerun: 23 tests PASS.
- Retained Reports/Redemption UI rerun: 11 tests PASS with explicit feature-on
  fixtures; production feature flags are unchanged.
- Targeted lint: PASS, no errors. Environment isolation: PASS.
- Latest full PostgreSQL run: 2,048 of 2,049 checks PASS. The original
  reservation-save and missing-redemption failures are resolved. Section 65's
  older dateless spending scenario is refused by `STAY_SERVICE_DATES_REQUIRED`;
  the suite exits nonzero and later sections remain unproven. Synthetic cleanup
  restored every tracked table to its pre-run count. No date guard was disabled.

Public verification still requires real Turnstile configuration, privacy
approval and cleanup readiness. These gates are deliberately preserved; no
hosted settings or existing records were changed. The source uses the same
feature flags as develop, including its disabled modules.

The full-suite follow-up also exposed outdated test expectations and fixtures.
Reservation saves must preserve submitted/executed status while allowing the
document fields supported by the current migration to change. Historical ID
conversion needs a historical redemption row even though the old catalog
spending API is retired. Reversal arithmetic uses synthetic manual debit
adjustments rather than bypassing the mandatory dated-stay redemption path.
Application tests now use plan radio cards and isolate persisted drafts.
Cold lazy-route loading gets a five-second asynchronous test wait, within the
existing thirty-second test ceiling; production behavior is unchanged.

Broad diagnostic runs are not green: the admin run reproduced cold-route waits
and obsolete plan-select tests before the fixes above; those failures passed
their focused reruns. The API run also exercised dormant MongoDB recovery and
migration-password suites, plus timed-out workbook cases. Both broad runs were
stopped after collecting failures; they are not a complete suite result.
Browser verification was attempted again but the browser access host is
unavailable. No hosted workflow, deployment or managed Supabase apply is proven.

## Functional continuation and approved live apply (7 November 2026)

This supersedes the earlier database and API failure status above. Develop was
fetched again and still points to `e759f6904b4fef31ddb6be07f68a903c07c9ee49`.

- Core PostgreSQL suite: **2,404/2,404 PASS** on all 150 local migrations.
- Required current dated-stay/external-import suite: **PASS**, including every
  tier/status import path, automatic reservation on normal approval, no invented
  customer consent, separate weekday/weekend allowances, approval concurrency,
  settlement, refunds and retries.
- Catalog reconciliation: **PASS**, including reproducing live drift, denied
  browser purge, ID-type preservation, nullable reason constraint and stable replay.
- Supabase API selection: **2,824 tests across 153 files PASS**. MongoDB native
  runtime/recovery/conversion tests remain reference-only and are excluded from
  this branch's default API command; their source is retained.
- Workspace typecheck, both app builds, lint (no errors) and env isolation: **PASS**.
- Complete admin suite: **1,073 tests across 117 files PASS**. jsdom emits its
  existing navigation-not-implemented warnings; no test failed.

Legacy dateless discount-success scenarios cannot execute against the current
schema. The core suite now asserts their specific date-boundary denial and
privileges, then the normal local command requires the current dated approval,
settlement and refund suite. No production date guard was disabled. Synthetic
ledger/debt fixtures are atomic and retain the allowance reconciliation invariant.
Application tests follow the new radio-card controls and isolate saved drafts.
Workbook matrix fixtures reuse immutable blank templates. API tests use a
30-second default and the 5,000-row fake-storage case a 120-second ceiling;
validation, privacy and persistence assertions are unchanged.

The real local application is running with Supabase:

- Public site: `http://localhost:5173/sale-team-search`.
- Staff customer lookup: `http://localhost:5174/admin/customer-lookup`.
- API health and public search configuration return 200; public search reports
  available. Lookup without a staff session returns 401. Both HTML routes return 200.

The user explicitly approved only migrations `20261226000001` and `20261227000001`
on existing project `ikaevepedpqygdlipsei`. Both were applied with certificate
verification and exact source-hash checks. History is now 129 entries (127 -> 129),
with no unrelated version added. The obsolete mandatory-review-reason constraint
is removed; browser purge execution is denied; the application mirror matches
the approved source. Inspected business row counts, private buckets, verification
settings and the RLS baseline are unchanged. The 20 older history-gap versions
remain unrecorded; their old SQL/backfills were not replayed.

Exact approval scope, hashes and evidence:
`docs/SUPABASE-DEVELOP-RECONCILIATION-2026-11-07.md` and
`docs/supabase/MIGRATION-APPLICATIONS.md`. No administrator change, seed, live
business mutation test, commit, push or deployment was performed. Authenticated
browser acceptance remains unverified because browser access is unavailable.
