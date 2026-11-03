# Certified historical imports — native transaction checkpoint

28 October 2026. Workspace `AFhomes-ecofarm-v2`, branch `claud/mongodb-conversion`.
Native implementation and disposable HTTP/database checks pass. The separately
approved Atlas schema apply completed on 29 October 2026. No source data was
transferred.

## Approved target apply — 29 October 2026

The user explicitly approved historical schema setup. A fresh read-only plan
matched the reviewed digest below before operator apply. The scoped apply created
the three empty collections and six unique application indexes, plus automatic
`_id` indexes, and committed the setup receipt/audit event. All three collections
were verified present with zero records and no missing indexes.

Post-apply plan digest:
`e62a25b84bd4cd4039fe7f55ae7188028d30d7e80510da12a17a2544f640f973`.

Independent read-only readiness verification at **06:08 Asia/Singapore** returned
66 target collections, all 48 canonical indexed collections present, zero missing
indexes, zero broken declared references, and no listed money/payment/points
inconsistencies across the two checked memberships. `schemaComplete: true` and
`checkedDataConsistent: true` apply only to the declared reference/checks, not the
entire platform or browser workflows. Collection validators remain absent.

This resolves the historical schema prerequisite. No customer, payment, points,
membership, credential, administrator or permission was changed by the apply.
No migration, business smoke write, commit, push or deployment was performed.

## Actual workbook-to-confirmation proof — 29 October 2026

Fresh native verification passed **59 tests across five import suites**; API
TypeScript passed. Two complete scenarios now fill the generated guided Excel
template with synthetic data, upload its XLSX bytes to the local API, inspect and
reload the persisted review, confirm the job, and query the saved records:

- Fully Paid: one historical customer/sale, verified certified settlement,
  no new commission and no premature membership activation.
- Active VIP: actual historical membership dates, 101 remaining points split
  into 71 weekday/30 weekend, and no duplicate customer, payment or membership
  after repeated confirmation.

Preview creates no business records. Permission denials and the original
transaction/claim/replay regressions remain covered. This strengthens the earlier
separate parsing and fixture-based transaction checks into actual file-through-
confirmation API proof. These runs used disposable loopback MongoDB only; no
customer data was imported into Atlas. Browser UI acceptance remains NOT RUN and
flat/legacy business confirmation remains blocked.

## Result

Certified guided-workbook confirmation and source continuation now use one native
MongoDB transaction per purchase. The six source lifecycle destinations are
implemented: application, reservation, Finance, activation, active and inactive.
The source rules are the historical-import and commission-cutover migrations
`20261223000001` and `20261223000004`; this is not a new business workflow.

- Additional Sales/Finance permissions are checked on every write. Restoring an
  active/inactive membership also requires Finance activation permission.
- Exact reviewed source/target revisions, registered seller scope, current team
  integrity, original purchase identity and frozen reservation terms are retained.
- Source consent, signatures and ID/proof flags remain uncollected when absent.
  Historical acceptance uses its own receipt rather than fabricated signatures.
- Actual payment claims retain their dates/methods. Possible duplicate payments
  are rejected or matched to the exact verified reservation payment. A certified
  settlement explicitly records unavailable individual receipts/dates/methods.
  Undecided money cannot finalize a purchase.
- Historical agreed totals remain frozen even when today's catalog price differs.
  Installments must divide into exact cents. Existing VIP IDs are preserved or
  accepted only with certified evidence and ownership/classification checks.
- An immutable application-side commission policy records whether the original
  import was already settled. Settled imports create no new commission. Originally
  partial purchases retain normal future commission eligibility after collection.
- Historical sales keep original import provenance and do not acquire today's
  genealogy as a purported historical snapshot.
- Actual membership dates/status are restored. Historical remaining points use a
  single opening baseline with the existing 70/30 weekday/weekend split and do
  not consume this year's earning cap. Replay does not restore spent points.
- Receipts, policy and baseline records have insert-only application paths and
  unique indexes. These indexes prevent duplicate identities; they do not make
  arbitrary privileged database updates impossible.
- Audit, payments, membership, points, commercial evidence and row linkage commit
  together. Job confirmation returns the restored membership ID. Guarded import
  writes have a bounded 45-second transaction budget.

Shared application writing, purchase terms, seller resolution, hashing and points
period handling were extracted/reused rather than duplicated. Ordinary prospect
intake and the existing normal purchase/activation paths retain their behavior.

## Verification

- Full API suite: **192 files, 3,089 tests passed**.
- Native historical HTTP tests cover all six stages, exact replay, simultaneous
  retries, job confirmation, real membership IDs, permissions, stale review,
  audit-failure rollback, duplicate money, inexact installments, historical price
  and VIP preservation, later collection/commission and replay after spending.
- The new historical schema guard refuses absent or incompatible unique indexes;
  requests never create the collections/indexes automatically.
- Separate operator tests prove a fresh historical plan/apply, stale-plan refusal,
  replay and preservation of existing staff. They use disposable databases only.
- Repository typecheck, configured lint and build passed. Lint/build used valid
  existing Turbo results for unchanged SPAs; API TypeScript ran afresh. The
  configured lint has 41 existing warnings. Direct lint of the new/extracted
  modules passed. Broader standalone lint of inherited API handlers still reports
  unused/dead-code findings; this work does not claim all API files are lint-clean.
- Environment isolation passed. Every database/HTTP test used fresh loopback
  replicas. This does not establish browser acceptance or hosted readiness.

## Read-only Atlas inspection and exact approval scope

Target: `afhomes_dev`. Inspection at **21:34 Asia/Singapore** found 63 collections,
no broken declared references and no listed money/payment/points inconsistencies.
The expanded canonical setup has 48 indexed collections; these three are absent:

| New empty collection | Required unique indexes |
| --- | --- |
| `customer_external_import_receipts` | `source_id`; `application_id`; `reservation_id` for string values; `sale_id` for string values |
| `customer_import_commission_policies` | `source_id` |
| `customer_import_points_baselines` | `membership_id` |

Six application indexes total, plus MongoDB's automatic `_id` indexes. All three
target collections are absent and contain no existing data. No other collection,
permission, administrator, password, membership or financial record is in this
schema apply scope. The operator writes a setup receipt/audit event after DDL.

Reviewed missing-schema digest:

`828f23ca8d35699568a642ccfac49ddbed12296439bcc6473cb6d9b6aa3defbc`

Read-only refresh:

```sh
pnpm exec tsx api/scripts/prepare-mongodb-imports.ts --historical --plan
```

The new historical mode requires its own
`--approve-historical-import-setup=afhomes_dev` flag, the fresh digest and an
explicit user approval before operator apply. The earlier five-collection core
approval is not reused. Additive DDL is not transactional; an interrupted setup
requires a fresh inspection before retry. The original preparation was read-only;
the separately authorized apply and post-verification are recorded above.

## Still unfinished

The approved historical schema is now present and verified on Atlas. No historical
customer records were automatically imported by applying this empty schema.
Browser acceptance, flat/legacy business-import
writes, one-time migration transformation/password compatibility, file/database
recovery verification and complete platform acceptance remain unfinished. CMS
stays last and existing disabled-module flags remain intact. No commit, push or
deployment was performed.
