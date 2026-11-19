# Production database scope preparation - 30 October 2026

The shared `mongoRuntimeDatabase` selector now binds the connection pool, hosted
configuration and both Better Auth factories to the same explicit namespace.
The existing development default is `afhomes_dev`. Production is limited to
`afhomes_prod` with all four server settings together:

```text
AFHOMES_MONGODB_SCOPE=production
MONGODB_DB=afhomes_prod
NODE_ENV=production
AFHOMES_HOSTED_RUNTIME_ENABLED=true
```

These settings are documentation only; no local or hosted environment was edited.
Unknown scope/database names, missing production opt-ins and mismatched injected
database/client instances fail closed. Existing hosted staging can continue to
use `afhomes_dev` under the development scope. The selector itself never creates
schema, grants permissions, enables business writes or authorizes deployment.
The connection pool validates configuration before reusing a cached connection.

Verification: 34 tests across the namespace, connection, authentication and
hosted-runtime suites passed. A fresh disposable replica used the namespace
`afhomes_prod`; the auth factory alone created no collections, then a synthetic
fixture signed in with its original password and ID in that namespace. The
separate development namespace remained empty. No Atlas connection or real
administrator was used. API typecheck and environment isolation passed.

Production initialization remains a separate reviewed operation: reference
records and permissions, indexes/validators, private storage, backups/independent
restore, scoped operator access and deployment/browser acceptance must be ready.
Current development setup tools remain pinned to `afhomes_dev`; this change does
not silently turn them into production installers. Business writes and hosted
search maintenance retain their separate default-off flags.
