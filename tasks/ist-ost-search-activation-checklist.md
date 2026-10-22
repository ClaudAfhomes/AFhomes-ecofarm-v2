# Public IST/OST search activation - 2026-10-21

## Completed

- User approved the operational privacy notice in `ist-ost-search-privacy-notice.txt`, privacy contact `claudmarsjimenez.afhomes@gmail.com`, and configurable contact retention starting at 30 days.
- Applied only `20261212000002_afhomes_reconcile_public_sale_team_search.sql` to shared project `ikaevepedpqygdlipsei`. SHA-256: `48661964b40907fa686d4e012e738af7a72d428163548927c8c91997d501702b`. History increased 116 to 117; 13 older pending migrations were skipped. Protected row counts, service-only routine ACLs, private-table RLS and the invariant audit passed. Managed PostgREST exposes all five routines. See `docs/supabase/MIGRATION-APPLICATIONS.md`.
- Disposable PostgreSQL removed the missing objects, applied the repair twice and passed 49 search checks.
- Separately approved `pg_cron` setup is installed. Only `afhomes-sale-team-search-cleanup` was configured, active at `0 * * * *`, executing `select public.cleanup_sale_team_search(30);`. Other jobs were preserved. The command executed successfully against empty search tables; automatic hourly execution has not yet been observed.
- Existing Turnstile widget allows exactly the stable develop Preview hostname, `localhost` and `127.0.0.1`. Managed mode and no pre-clearance remain. The live API accepts only its own hostname; the local API accepts only the two loopback names. Keys remain outside Git and Markdown.
- Configured root `.env.local` and Vercel Preview scoped to git branch `develop`. Search and cleanup readiness are enabled. The signing/deduplication secret is shared between these writers because they use the same contact store. Local API restarted and config returns `available: true`; the browser opens the approved notice with 30 days and the correct email.
- Preview redeployment `dpl_E63w9dS5j7xSyF7GMHEXR9py1hUj` reached READY (existing develop code, updated environment). It does not deploy the repository changes accompanying this checklist. Its config returns `available: true`, and the stable-alias browser displays the enabled form and approved 30-day privacy notice, with Continue disabled until acknowledgment. An already-open homepage initially referenced an old lazy-loaded asset; refreshing loaded the new page successfully. Production website was not promoted.
- Verification: 14 focused API/helper tests passed; full typecheck and environment isolation passed; lint completed with zero errors and existing React Refresh warnings. The cleanup configuration self-test passed. Full unit suite was not rerun here; two previously observed payment-queue test failures remain unrelated.

## Database-backed administration (applied 2026-10-22)

The approved migration `20261212000003_afhomes_public_verification_settings.sql` is applied to shared project `ikaevepedpqygdlipsei`. With this application release, use **Organization -> Public Verification Settings** for verification phone, privacy notice, contact retention and enabled/disabled status. Hosted and ordinary local runtimes ignore the old environment control values. Secret keys, approved hostname allowlists and infrastructure readiness remain server-only configuration.

The singleton preserves the supplied enabled state, prefilled with the owner-approved phone, notice and 30-day retention. Administrators with `governance.config` view/update rights may manage it; browser roles cannot directly access its private table or RPCs. Saves reject stale revisions and audit changes atomically. Phone, notice or retention edits issue a new notice version.

The existing named hourly job is changed by the migration to `select public.cleanup_sale_team_search();`, whose wrapper reads current saved retention on every run, even when public search is disabled. Other jobs are preserved. Fresh installations still require separately approved scheduler setup using `scripts/configure-sale-team-search-cleanup.mjs`; retention edits then require no environment change, rescheduling or redeployment. The disposable loopback demo remains isolated and may use temporary preview settings.

The user separately approved this exact migration and branch commit/push. No production website deployment is included.

## Acceptance still required

- First automatic cron run and cleanup backlog monitoring.
- User-completed real Turnstile and contact submission, IST/OST result/photo enlargement, reload/reuse and quota behavior. No synthetic live contact was created for verification.

Use `https://afhomes-ecofarm-v2-git-develop-afhomes.vercel.app/sale-team-search` for hosted checks. Immutable random deployment URLs are not allowed by this widget. The runtime permits 3 disclosures per rolling 24 hours; the separate upstream 7-day request remains pending.

## Settings release verification - 2026-10-22

Prepared migration: `supabase/migrations/20261212000003_afhomes_public_verification_settings.sql`.
SHA-256: `584ece6f2c39b0aae945af80c9a811422030961fab58e4a2334236a481442601`.
The CLI-created scaffold was ordered after the existing future-dated search dependencies; its reviewed body hash is pinned above.

- PASS: 176 relevant API/route tests, including the existing administration handler suite.
- PASS: 12 settings-form/navigation tests; read-only view, save/reopen, write failure and unauthorized-role paths included.
- PASS: 74 real PostgreSQL search/settings checks, including concurrent update conflicts, automatic retention use, idempotent migration replay, SQL administrator-role denial, service-only ACLs and an empty RLS invariant audit.
- PASS: typecheck, targeted admin lint, environment isolation, admin production build and cleanup-script self-test. Build reports existing large-chunk warnings.
- Full disposable DB suite: 2707 checks, 2703 pass, 4 fail. The 130-migration baseline without this migration reproduces the same four failures (2704 checks, 2700 pass): external-import function search_path assertion; historical import referral attribution; two obsolete purchase-review reason assertions. These failures are not repaired by this feature and the full suite is not green.
- Read-only shared precheck: target `ikaevepedpqygdlipsei`, 117 recorded versions, new version unrecorded and settings table absent; required cleanup and authorization routines present. The existing named cleanup job is active, hourly, owned by postgres. The guarded single-version runner confirms 13 earlier missing versions will be skipped and executes zero SQL in check mode.
- Shared apply PASS: only version `20261212000003` added (117 to 118 history entries); 13 earlier missing versions skipped. Independent checks confirmed service-only RPCs, private-table RLS/restricted grants, unchanged eight protected business-table counts, unchanged existing integer cleanup function and preserved other jobs. The existing hourly job now calls the no-argument database-backed wrapper. Managed PostgREST returns the seeded settings successfully.
- The shared invariant audit reports no application findings, but its broad policy query also returns the two platform-owned cron policies (`cron_job_policy`, `cron_job_run_details_policy`). These are not an empty audit result and were not modified.
- Authenticated administrator browser acceptance is NOT RUN: the current local browser session is an OST account and redirects outside the administration route. No production visitor contact or account was created or changed. Production website deployment is NOT RUN.
