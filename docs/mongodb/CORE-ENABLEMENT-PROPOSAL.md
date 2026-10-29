# afhomes_dev core enablement proposal — approved and applied

26 October 2026. Checkout: `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

Status update: the user explicitly approved this database setup and it completed.
See [CORE-READINESS-REPORT.md](CORE-READINESS-REPORT.md) for execution, verification
and the remaining storage/catalog gates. The proposal below records its approved scope.

## Live read-only findings

`corepack pnpm mongodb:core --plan` completed successfully against the configured
`afhomes_dev` database. It did not create collections/indexes or write records.

- Existing Super Admin foundation is present; no administrator repair is proposed.
- Nine canonical roles are missing: Admin, Vice Director, Senior Sales Manager,
  Sales Manager, Finance, HR, Employee, OST and Customer.
- Five departments are missing: Executive, Sales, Finance, Human Resources and Operations.
- No module keys are missing. No active card plans exist.
- Private S3-compatible storage is not configured.

## Proposed additive database action

The prepared command is:

```sh
corepack pnpm mongodb:core --apply --approve-core-setup=afhomes_dev
```

The implementation is
`api/scripts/prepare-mongodb-core.ts` and `api/_lib/mongo-core-setup.ts`.

1. Require the existing active Super Admin and matching `afhomes_dev` connection.
2. Run the existing explicit native index setup. The generated
   [index plan](CORE-INDEX-PLAN.json) lists 78 non-default index definitions across
   40 collections, rehearsed on a fresh disposable replica. Existing identical
   indexes are reused. Conflicts/duplicates stop setup; nothing drops an index,
   deletes a document or automatically repairs conflicting data.
3. Insert only missing canonical AFHomes department/role/module reference rows.
   New non-customer roles receive the existing `DEFAULT_ROLE_BASELINE` grants.
   Existing roles, their permissions and staff assignments are preserved.
4. Write an audit event and a core-initialization marker after reference setup
   succeeds. Index creation is additive DDL and cannot be rolled back with a
   failed reference transaction; the readiness marker stays unset on failure.

No identity is created, reset, replaced or deleted. No existing person, password,
membership, commercial record, snapshot or Supabase data is imported/changed.
No card pricing, policy approval or activation is fabricated. There is no push
or deployment. Repeating successful setup does not duplicate reference records.

Disposable tests verify denial without an existing Super Admin, read-only
planning, complete preservation of existing administrator records/permissions,
successful reference insertion and replay without new identities or assignments.

## Storage and startup prerequisites

A private S3-compatible bucket and scoped server credentials still need operator
configuration. Secret values belong only in the ignored server environment,
never chat or Markdown. No bucket/service has been created or charged.

After explicit database approval and private-storage configuration, the server
flag `AFHOMES_MONGODB_ENABLE_CORE_WRITES=true` can enable converted core routes.
It defaults to false. Startup requires the successful initialization marker,
complete reference vocabulary and configured private storage before allowing
writes or starting the native retention worker. Normal startup does not seed or
bootstrap anything. Unsupported/unconverted families remain blocked.

The operator must also create/review the real membership category and card plans
through the existing Card Products UI before making purchase applications. The
database currently has no active plans; test prices are not production prices.

Public verification additionally requires the administrator to save and approve
the actual privacy notice/retention settings and configure real Turnstile keys.
The server derives cleanup readiness from its active lease and successful native
sweeps; no client-supplied readiness flag is accepted. This does not automatically
approve a privacy notice or publish a new public service.

## Unchanged boundaries

Direct OST creation immediately accredits the account. Staff use temporary
passwords with mandatory change; MongoDB MFA is removed. VIP activation remains
code/link based. Redemption and operational Services stay disabled. Real Atlas
mutation tests, live storage writes and deployment require their own scoped
authorization; all automated tests remain disposable/loopback-only.
