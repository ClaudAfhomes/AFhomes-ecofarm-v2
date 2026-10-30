# Core collection validator review

**Latest:** the user approved this exact apply. Execution stopped at the first
DDL because the configured application user lacks collMod. Independent checks
verified zero schema/data/index changes. See CORE-VALIDATORS-APPLY-RESULT.md;
the approval remains valid, but a separate maintenance connection is required.

29 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

## Scope and behavior

Six proposed collection validators add database enforcement of existing contract
rules: exact-decimal money/rates, canonical lifecycle states, string IDs and safe
integer points. Definitions live in `api/_lib/core-validators.mongo.ts`; money
regexes and lifecycle lists come from `@afhomes/contracts`.

Unknown/historical fields remain permitted. Optional fields remain optional.
Signed ledger adjustments and weekday/weekend allowances remain legal; balances
and reversal debt remain non-negative. No account permission, pricing, status
transition or allocation rule changes. These validators cannot enforce ownership,
foreign keys, full verified payment, allowed transitions, snapshot immutability
or transaction/idempotency rules; native handlers remain responsible for those.

No runtime/startup installer was added. The only installation helper lives under
`api/_lib/testing`, rejects non-loopback hosts and is used with freshly created
disposable replicas. Shared installation is a separate approval step.

## Read-only command

```sh
pnpm mongodb:validators
```

This loads the ignored repository `.env.local`, uses the existing afhomes_dev
client guard, and runs only collection metadata and count queries. It returns
counts, protection state and proposal digests, never customer records, credential
values or raw database errors. It accepts no write/apply options. Exit 0 means
the inspected data is compatible for review; exit 2 means review blockers; exit
1 means inspection/configuration failed. None means that validators were applied.

The document scans share a snapshot session and have bounded query time. Schema
metadata is read separately; this is a preflight, not a lock or an apply guarantee.
Rerun immediately before any separately approved maintenance operation.

## Live read-only result

The initial complex name filter failed with Atlas server code 8000. Reusing the
existing readiness inspector's simple `listCollections` query resolved it; a
regression test now checks that query shape. No security/network/credential
setting was changed to obtain access.

| Collection | Inspected records | Invalid under proposal | Existing validator |
| --- | ---: | ---: | --- |
| card_sales | 2 | 0 | Missing |
| payments | 9 | 0 | Missing |
| memberships | 2 | 0 | Missing |
| points_accounts | 2 | 0 | Missing |
| points_ledger | 1 | 0 | Missing |
| commissions | 2 | 0 | Missing |

Snapshot total: 18 documents, zero incompatibilities under these six rules.
Review digest: `0c9e1f503ff99981578b6cfd2ae69eacde65525b9e3a03b7b06ee17f3f231552`.
This result is not a whole-database integrity or production-readiness certificate.

## Proposed shared apply, not executed

The exact proposed changes are six `collMod` operations using the corresponding
definitions returned by `mongoCoreValidators()`, `validationLevel: strict` and
`validationAction: error`, for precisely the collections in the table. No records,
indexes, credentials, administrators, grants or feature flags would be replaced.

Before applying, obtain explicit authorization for this scope, preserve the
existing collection options, stop/drain relevant application writes during a
reviewed maintenance window and rerun the preflight. Conflicting existing rules
or invalid records block the apply; do not erase rules, repair records silently,
use `warn` to hide incompatibilities or bypass document validation. Record each
completed DDL operation and its read-back result. MongoDB does not make the six
DDL operations one transaction: failure may leave a partial strengthening; stop
and report it rather than silently removing protections. A rollback of validation
options needs separate review and must never restore old financial/account data.

There is deliberately no real-target apply switch in the read-only command.

## Verification

- Five new disposable tests cover absent collections/no DDL, privacy-preserving
  invalid-record counts, strict inserts/updates, exact large money strings,
  unsafe/fractional points, signed deltas, warning/off/conflicting rules, stable
  proposal digests, wrong database/non-loopback guards and transaction rollback
  including an earlier audit write.
- Native sales, official-forms purchase/Finance/activation, ordinary/legacy import
  confirmation and all six certified historical stages run with the proposed
  strict validators installed on their disposable replicas: 69 targeted tests
  passed in five files; the final rerun also passed all 69 tests with the
  Atlas-compatible metadata query and fixture guards in place.
- Older Finance/lookup test shortcuts now use native string payment IDs and a
  separate paid sale linked to the lookup membership. Existing lookup assertions,
  including authoritative points-account behavior, are unchanged.
- The CLI rejects `--apply` before loading credentials or connecting. Live
  read-only preflight succeeds without installing anything.
- API typecheck, scoped ESLint and environment isolation pass (742 browser,
  465 server source files). No application timeout limits were increased.

No full repository/browser/build rerun in this slice. The preceding full gate
still has 21 deferred CMS-related failures; CMS remains last. Real migration,
durable backups, complete browser acceptance and Linux/Droplet verification are
still open. No Atlas DDL/data writes, invitation/reset/bootstrap, commit, push or
deployment ran.

Primary reference: [MongoDB schema preflight queries](https://www.mongodb.com/docs/manual/core/schema-validation/use-json-schema-query-conditions/).
