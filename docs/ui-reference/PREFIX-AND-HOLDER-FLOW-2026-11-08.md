# Prefix and holder-flow changes ? 8 November 2026

## Local implementation

- Optional free-text Prefix is before First name, occupying the left space,
  for primary and secondary holders. It is trimmed and limited to 20 characters.
  It is included in the write/read contracts, API holder response, Review,
  Customer Application PDF and draft RA name. Suffix remains free text.
- Continue on Holders validates the visible section and advances Personal ?
  Address ? Contact ? Additional. Leaving Holders still validates both complete
  records, and final submission keeps its existing full validation. Back traverses
  those sections without discarding values; direct tab and Review edit links work.
- The optional Gold secondary holder appears below the primary instead of hiding
  it behind a holder-switch button. Both records stay visible and use the same
  selected section. Non-Gold selection clears the optional secondary as before.

## Approved database application

The user explicitly approved only the migration below. It was applied to
`ikaevepedpqygdlipsei` on 8 November 2026 and verified at
`2026-11-08T01:38:30.201Z` (09:38 Singapore time).

Before applying, the approved file hash and target connection were checked with
verified TLS. The live save function matched the expected predecessor exactly.
Prefix was absent before the change and is now available through PostgREST.

Approved and applied migration:

`supabase/migrations/20261228000001_afhomes_application_holder_prefix.sql`

SHA-256: `2160f77c7da2f2a3d64eb4b871f8f08e0b18239986bba8a54ae6e1c5e55aaa69`

It adds nullable `customer_application_holders.prefix text` with a 20-character
limit and updates the current `save_customer_application` function's PRIMARY
and SECONDARY INSERTs to retain the value. All other function behavior is copied
from the latest repository definition. Browser execution remains revoked;
service-role execution remains granted. There is no backfill, seed, account,
administrator, payment, reservation or historical-data rewrite. The transaction
also reloads the PostgREST schema cache. Existing applied migrations are unchanged.

Only version `20261228000001` was added to migration history (129 to 130 entries).
The approved SQL and history entry ran in one transaction; the file's standalone
transaction wrapper was replaced by the encompassing transaction, without changing
its SQL effects. The live function body matches the approved file. The nullable
text column and validated length constraint are present, service-only function
execution is confirmed, table security and business/account row counts are unchanged.
The service API can now select the Prefix column without error.

The two existing RLS audit findings concern `cron.job` and
`cron.job_run_details` policies and are identical before and after. No unrelated
policy was changed. No backfill, seed, application submission, administrator change,
commit, push or deployment was performed. Actual production application submission
was not used as a test; create/read/update Prefix behavior was proven on the local
disposable database and the live implementation was matched against that SQL.

Ignored live metadata evidence: `.tmp-bin/prefix-live-before.json` and
`.tmp-bin/prefix-live-after.json`. No credentials or customer records are stored
in those evidence files.

## Verification

- 55 focused editor/final-blocker checks passed, including Personal continuing
  with hidden sections incomplete and both Gold holder blocks remaining visible.
- 57 API/team checks passed, including Prefix readback and refusal before any
  write when the column is missing; 30 contract checks passed.
- The real disposable PostgreSQL suite passed 2,404 checks and its external-import
  follow-up. `pnpm test:db:application-prefix` additionally replays all 151
  migrations and proves both-holder create/read/update, length rejection, NULL
  legacy behavior, idempotence, function ACLs and RLS invariants. Loopback only.
- API and contracts typechecks passed. Affected frontend ESLint: zero errors,
  18 Fast Refresh export warnings. Admin build includes its typecheck.
- Actual React component browser flow passed at 1440?900 and 390?844. Evidence:
  `.tmp-bin/v4-comparison/holder-prefix-personal-1440.png`,
  `holder-prefix-personal-390.png`, `gold-secondary-below-1440.png`,
  `gold-secondary-below-390.png`. These use synthetic local fixture data and
  are component evidence, not a live Supabase Prefix submission.

Relevant ignored logs: `.tmp-bin/holder-flow-visual.log`,
`prefix-holder-final.log`, `prefix-api-tests.log`, `prefix-contract-tests.log`,
`prefix-db-full.log`, `prefix-permanent-db-proof.log`, `holder-final-build.log`,
`prefix-api-types.log`, `prefix-contract-types.log`, `holder-lint-final.log`.
