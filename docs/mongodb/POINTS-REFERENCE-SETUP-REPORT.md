# Missing points-tier reference configuration

28 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

Read-only inspection found zero MongoDB `tier_points_config` records and two Gold
sales awaiting activation. The working source's annual caps match
`20261104000001_afhomes_points_rebuild.sql`: BRONZE 25000, SILVER 40000, GOLD 60000.
These are annual earning caps, distinct from the catalog's yearly loyalty figures.
No payment or sale mutation was executed while inspecting this failure.

The operator-only reference initializer now includes missing points-tier rows and
offers a points-only mode. It requires the existing active bootstrap owner, Super
Admin assignment and approved core setup. It inserts only missing rows under the
organization lock with an audit, preserves valid customized caps, rejects duplicate
or invalid existing caps, and rolls back on failure. It never runs on ordinary
startup or activation requests and points-only mode creates no card categories or
plans. Nothing silently substitutes a cap from the plan or current loyalty balance.

Read-only reviewed plan:

```sh
pnpm exec tsx api/scripts/prepare-mongodb-catalog.ts --plan --points-only
```

Result: all three rows are missing; three active card plans already exist. The
proposed target apply inserts BRONZE 25000, SILVER 40000 and GOLD 60000, increments
the organization serialization counter and appends a configuration audit. It does
not activate sales, issue credentials, allocate points, update payments, rewrite
existing periods or alter existing administrators. No index apply is included.

Only after scoped approval:

```sh
pnpm exec tsx api/scripts/prepare-mongodb-catalog.ts --apply --points-only --approve-points-config=afhomes_dev
```

PASS: 15 native tests across reference setup, sales and customer points. A synthetic
fully verified sale reproduces the missing-config failure without leaving a
membership or changed customer behind. Installing the canonical reference rows
then permits the existing activation tests, including concurrent retry and audit
rollback. Points-only behavior, preservation of custom plans/caps/owner, denied
setup and duplicate configuration are covered. API TypeScript and environment
isolation also passed.

Status: explicitly approved by the user and applied to `afhomes_dev` on 28 October
2026. The operator command exited 0 and reported exactly the three points-tier
inserts. Post-apply reads found one row per tier with caps 25000, 40000 and 60000;
three active card plans remain. The transaction also serialized and audited the
setup as designed. No real activation was executed; the user should retry it.
