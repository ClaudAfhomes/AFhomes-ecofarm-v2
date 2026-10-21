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

## Changing retention

1. Set `AFHOMES_SEARCH_CONTACT_RETENTION_DAYS` to a whole number from 1 to 3650 in the intended API environment and root `.env.local` used by the operator script.
2. Run the explicitly targeted configuration command below, then run it again with `--check` instead of `--apply`. It updates only the named job and verifies other jobs were preserved.
3. Restart/redeploy the API with the matching setting. Current local code interpolates `{{CONTACT_RETENTION_DAYS}}` in the notice template. The redeployed older develop code uses a rendered notice: update its `AFHOMES_SEARCH_PRIVACY_NOTICE` text to the same number until the template code is released.

```powershell
$env:AFHOMES_TARGET_PROJECT_REF = 'ikaevepedpqygdlipsei'
node scripts/configure-sale-team-search-cleanup.mjs --apply
node scripts/configure-sale-team-search-cleanup.mjs --check
```

This is a shared production database: obtain explicit approval for future shared configuration changes. The script defaults to read-only and validates the project before writing. Do not apply all pending migrations or create synthetic customers/contacts here for testing.

## Acceptance still required

- First automatic cron run and cleanup backlog monitoring.
- User-completed real Turnstile and contact submission, IST/OST result/photo enlargement, reload/reuse and quota behavior. No synthetic live contact was created for verification.

Use `https://afhomes-ecofarm-v2-git-develop-afhomes.vercel.app/sale-team-search` for hosted checks. Immutable random deployment URLs are not allowed by this widget. The runtime permits 3 disclosures per rolling 24 hours; the separate upstream 7-day request remains pending.
