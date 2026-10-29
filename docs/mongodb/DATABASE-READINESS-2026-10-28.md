# MongoDB database readiness

29 October 2026, 06:08 Asia/Singapore: after explicit approval, the three
historical-import collections and six unique indexes were applied and verified.
The fresh read-only check reports 66 target collections, all 48 canonical indexed
collections present, no missing collections/indexes, no broken declared
references, and no listed money/payment/points inconsistencies for the two checked
memberships. The three new collections remain empty. This is canonical schema and
limited integrity proof, not full system, migration, browser or recovery acceptance.
See `HISTORICAL-IMPORT-TRANSACTION-REPORT.md` for apply scope and digests.

Later checkpoint, 21:34 Asia/Singapore: historical import implementation adds
three canonical collections and six unique indexes. They are absent on Atlas and
await separate approval. Existing inspected data remains consistent. See
`HISTORICAL-IMPORT-TRANSACTION-REPORT.md`; the 45-collection result below describes
the earlier core setup, before this additional feature schema.

28 October 2026, initial read-only inspection at 16:07 Asia/Singapore;
approved setup followed by read-only post-verification at 16:15 Asia/Singapore.
Target: `afhomes_dev`; workspace: `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

**Verdict: PARTIALLY READY, NOT COMPLETE for the entire AFHomes system.**
MongoDB is serving converted core workflows. This does not establish complete
source parity, migrated historical data, recovery readiness or production readiness.

## Fresh database evidence

The inspection compared the target with the canonical setup executed on a new
disposable loopback replica. The target was never initialized by the inspection.
Core data checks used a read-only snapshot session and returned counts only.

| Check | Observed result |
| --- | --- |
| Existing target collections | 63 after approved setup (58 before) |
| Collections created by canonical indexed core setup | 45 |
| Required setup collections absent from target | 0 after approved setup (5 before) |
| Missing canonical indexes on existing collections | 0 |
| Broken references across the 24 declared core relationships | 0 |
| Memberships checked | 2 |
| Active memberships lacking full verified payment | 0 |
| Membership/points-account balance mismatches | 0 |
| Memberships missing points accounts | 0 |
| Invalid points balances or malformed checked money | 0 |
| Collections with database validators | 0; additional schema hardening remains |

The collection counts are inventories, not a completeness score. The reference
contains indexed setup collections; some application collections are created on
first use. These checks do not inspect every possible field or relationship.
They do not certify credentials, private file bytes or role-by-role browser flows.

## Approved import initialization (applied and verified)

All five collections were absent before apply. The user explicitly approved their
initialization, and they now exist with zero import records and all reviewed indexes:

| Collection | Canonical indexes | Additional read indexes |
| --- | ---: | ---: |
| customer_import_jobs | 1 | 0 |
| customer_import_payment_claims | 4 | 0 |
| customer_import_purchase_sources | 2 | 1 |
| customer_import_rows | 1 | 2 |
| customer_import_source_rows | 1 | 0 |

This creates five empty collections and twelve application indexes, plus MongoDB's
automatic `_id` indexes. The canonical unique/partial indexes come directly from
the existing `setupMongoImportClaims` and `setupMongoImportJobs` implementations.
The three read indexes were measured and tested during the preceding pass.

Index keys and constraints:

- Jobs: unique `job_number`, only for string job numbers.
- Claims: unique `(source_id, normalized_reference)`; nonunique `fingerprint`;
  unique `proof_id` and `proof_path`, each restricted to string values.
- Sources: unique `(issuer_scope, normalized_reference)`; unique `application_id`
  restricted to string IDs; read `(original_row_id, superseded_by, created_at, _id)`.
- Rows: unique `(import_job_id, row_number)` restricted to numeric row numbers;
  read `(raw_data.referrer_staff_id, committed_at)` and
  `(raw_data.recommender_staff_id, committed_at)`.
- Source links: unique `row_id`.

Operator preparation includes native tests for no-write planning, owner validation,
changed-plan rejection, replay, exact index counts, administrator preservation and
refusal to add missing constraints over existing import data without a new review.
DDL is additive and not transactional; interruption requires a fresh reviewed plan.
A separate atomic setup receipt/audit event records successful initialization.
It does not run on startup or on a business request.

Read-only command:

```powershell
pnpm --filter api exec tsx scripts/prepare-mongodb-imports.ts --plan
```

Reviewed digest:
`e926d6ab5f064ae3116dcaf20b26f5050d42c8a0772325b088c15ea015d4d325`.
An approved apply uses `--apply --approve-import-setup=afhomes_dev` and
`--approve-plan=<reviewed digest>`. The plan is recalculated before any DDL.

Actual result: five collections created, nine canonical and three read indexes
installed, setup receipt and audit committed. Post-apply plan digest:
`2d52d283891bb9e8970752481d96ea908c0fcd1a1390347ef503ef20b8009239`.
Read-only readiness verification reports `schemaComplete: true` for the canonical
indexed core setup and `checkedDataConsistent: true` for the declared checks.
These are bounded checks, not a whole-platform completion verdict.

This setup does not copy Supabase data, create users, change passwords/permissions,
issue invitations, create financial records, enable disabled modules, push or deploy.
It supplies missing schema for the already converted ordinary import workflows.
It does not implement the blocked historical workflows described below.

## Remaining completion gates

- Certified historical parsing, continuation and financial confirmation, and legacy
  business confirmation, still deliberately return 501 in native paths.
- Source data export/mapping, legacy bcrypt compatibility, private file transfer,
  disposable migration dry run and approved target data migration remain incomplete.
- Database/private-file backup and a verified independent restore are not complete.
- Full role-by-role browser acceptance remains unverified; passing automated
  API/component tests alone does not prove every user workflow.
- CMS stays disabled and last. The previously recorded twenty CMS UI expectations
  and one CMS dialog scan remain unresolved; the whole-repository suite is not green.
- Reports, Services and Redemption remain deliberately disabled as requested.

The existing administrator and current business history must survive every later
setup or migration. A successful ping, all indexes present, or consistent existing
membership totals must never be reported as full-platform completion.

## Verification in this pass

- New disposable MongoDB tests: 4 passed (read-only inspection, integrity findings,
  schema initialization, owner preservation, replay and refusal over existing data).
- API TypeScript: passed.
- Targeted lint and browser/server environment isolation: passed.
- No application data migration, user bootstrap/reset, commit, push or deployment.
- Whole UI test suite was not rerun in this pass; its recorded CMS failures remain.
