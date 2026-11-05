---
name: afhomes-database
description: MongoDB Atlas data work for AF Homes (collections, indexes, validators, transactions, counters, idempotency) and, only when explicitly scoped, the legacy Supabase/Postgres migrations. Use for schema, query, index, performance or data-integrity reviews.
---

# Database

## Active: MongoDB
- Client `api/_lib/mongodb.ts` (driver 7.7, no Mongoose); scope `api/_lib/mongodb-scope.ts`.
- Setup/readiness: `api/_lib/mongo-core-setup.ts`, `core-validators.mongo.ts`, `database-readiness.mongo.ts`,
  scripts in `api/scripts/` (prepare-*, check-*). Six core validators installed (31 Oct).
- Docs: `docs/mongodb/PRODUCTION-DATABASE-SCOPE.md`, `CORE-VALIDATORS-REVIEW.md`,
  `PERFORMANCE-CHECKPOINT-2026-11-02.md`, `NATIVE-READINESS-2026-11-03.md`.
- Tests: disposable replica `api/_lib/testing/mongo-replica.ts`; `pnpm test:mongodb:local`, `:recovery`.

## Review checklist
- Query uses an existing index (check setup file) — no unbounded scans or pre-pagination enrichment
  (the 10k-customer directory defect, 2026-11-03).
- Multi-document writes in a transaction with bounded deadline; idempotency key; replay-safe.
- References validated (string UUID `_id`s are common — verify, don't assume ObjectId).
- Unique indexes for every issued identifier; counters never decrease.
- Safe-integer points; exact-decimal money strings.

## Legacy: Supabase/Postgres
Only when the task names it. Forward-only `afhomes_` migrations; never edit applied bodies;
`pnpm test:db:local`; run `supabase/security/rls_invariants.sql`. Known failing section 77.

## Approval required
Any Atlas connection that writes, collMod, index build, import, cleanup, backup restore, or
running migration adapters. Owner decision 2026-11-03: no Supabase history import.
