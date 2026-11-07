---
paths:
  - "api/_lib/*.mongo.ts"
  - "api/_lib/mongo*.ts"
  - "api/_lib/migration-*.ts"
  - "api/_lib/core-validators*.ts"
  - "api/scripts/**"
  - "scripts/*mongo*"
  - "scripts/setup-atlas-indexes.ts"
  - "supabase/**"
  - "packages/db-testing/**"
---

# Database rules

- Active DB: MongoDB Atlas via `mongodb` driver (no Mongoose); default `afhomes_dev`.
  `afhomes_prod` only when all four hosted settings agree (see `docs/mongodb/PRODUCTION-DATABASE-SCOPE.md`).
- Tests use disposable loopback replicas (`api/_lib/testing/mongo-replica.ts`) — never Atlas.
- No Atlas writes, collMod/validators, index creation, imports or setup scripts without explicit approval.
  Read-only checks (`pnpm mongodb:validators`, readiness) still need the user's go-ahead to connect.
- Migration/source-mapping code is unmounted preparation. Owner decision 2026-11-03: fresh native
  operation, no Supabase history import. Do not mount or run it.
- Points are safe integers; money exact-decimal strings; IDs issued once, unique-indexed.
- `supabase/migrations/`: legacy. Never edit applied bodies; forward `afhomes_`-prefixed files only,
  and only when the task is explicitly about the Supabase system.
- Never run Mongo and Supabase migration workflows interchangeably.
