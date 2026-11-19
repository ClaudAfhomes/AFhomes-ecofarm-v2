# AF Homes: Supabase solutions — Phase 2 (Database size control)

Updated: 2026-10-14 (Asia/Singapore). Status: implementation plan — **not yet implemented**. This document turns the database-size rules in `docs/supabase/SUPABASE-FREE.md` into concrete, AI-executable work. `docs/supabase/SUPABASE-FREE.md` remains the single reference for quota and accounting; `docs/supabase/solutions/EGRESS-SOLUTIONS.md` is the Phase 1 plan for egress and bandwidth; `docs/supabase/solutions/MAU-SOLUTIONS.md` is the Phase 3 plan for Monthly Active Users; `docs/supabase/solutions/STORAGE-SOLUTIONS.md` is the Phase 4 plan for File Storage + public URL media; `docs/supabase/solutions/LOG-SOLUTIONS.md` is the Phase 5 plan for Log Ingestion control; `docs/supabase/solutions/LOG-QUERY-SOLUTIONS.md` is the Phase 6 plan for Log Query control. Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Do not create parallel capacity documents — update this file as phases ship.

> **Instruction to the implementing AI:** execute the tasks below in order of the priority section. Tasks 1–6 are foundational and mostly code-free; tasks 7–10 are structural and require a migration, tests and explicit approval before execution. Never combine two tasks in one commit when a task touches authorization, money or contracts. For every task: run the full command set in "Verification" before claiming completion, and report evidence (command output), not intentions.

## Phase 2 goal

Keep `pg_database_size()` far from the Free-plan **500 MB per-project** cap without deleting a single record that the business depends on. The measured lever is **rows × (row width + indexes + overhead)**, plus **dead-tuple bloat** from updates and deletes. Database size **does not reset** — it only grows or shrinks through the work below.

Read this first: `docs/supabase/SUPABASE-FREE.md` — budget table, read-only snapshot, query/backend rules. Everything below builds on rules already stated there; it does not replace them.

## What database size is (context the AI must assume)

* Database size = rows + indexes + database overhead on disk. It is **per project** (unlike egress, which is org-wide) and **does not reset** per billing cycle. The Dashboard billing meter is authoritative; `pg_database_size()` is an operational estimate.
* Snapshot 2026-10-13: **21,056,659 bytes (~21 MB) used of 500 MB (~4%)**. Largest relation: `audit_events` (368,640 bytes including indexes). `card_sales` totals 270,336 bytes of which **245,760 bytes (~91%) are indexes** — index allocations are already material. Do not add indexes indiscriminately.
* When the limit is reached, **writes can fail**. This is the dangerous meter, unlike MAU or logs.
* Illustrative growth math (not a commitment): 10,000 sales/year at ~2 KB row + ~2 KB indexes ≈ ~40 MB/year; 100 audit events/day at ~1 KB ≈ ~36 MB/year. At current scale this is not an emergency — the correct first move is **measurement and index discipline**, not aggressive cleanup.
* `DELETE` does not return space to the OS; it marks pages reusable. `UPDATE` creates dead tuples. Both are reclaimed only by vacuum/reorg — see Task 7.

## Non-negotiable guardrails (do not violate in any task)

1. Never delete financial records, ledgers, points history, Super Admin data, VIP plans or required audit history to reclaim quota.
2. Any cleanup or retention action requires: ownership checks, dependency checks, auditability (an `audit_events` entry), a dry run, and **explicit company approval**. Nothing deletes automatically.
3. Never silently block financial writes; never create a second Supabase project as a quota workaround.
4. Never weaken security (RLS policies, column grants, `has_permission`, ownership checks) to reduce size.
5. No base64 files in database JSON. File bytes live in Storage; necessary metadata lives in Postgres.
6. Preserve exact-decimal money, server-calculated totals, verified-payment gates, row locking, idempotency and immutable sale snapshots. A smaller row set must still return the same authorized truth.
7. Migration discipline: one idempotent migration per change, prefixed `afhomes_`, forward-only, validation queries in the file header, down note. After each batch run `supabase/security/rls_invariants.sql` (empty = PASS) and `pnpm test:db:local`.
8. Index changes only after checking the actual filtered query, index overlap, representative plans (`EXPLAIN`), storage cost and write overhead.
9. No new monitoring service, no quota monitor, no speculative database abstraction layer, no MongoDB work in this phase.

## Solution inventory at a glance

| # | Solution | Tier | Needs migration | Needs approval |
| --- | --- | --- | --- | --- |
| 1 | Measurement baseline and capacity checkpoints | Foundational | No | No |
| 2 | Index audit, redundant-index removal, index discipline | Foundational | Yes (removals) | Yes |
| 3 | Audit payload hygiene (`before_data`/`after_data` stay minimal) | Foundational | No | No |
| 4 | JSONB payload control and OCR storage discipline | Foundational | No | No |
| 5 | Denormalized-column discipline | Foundational | No | No |
| 6 | Lifecycle cleanup candidates and retention/archival policy | Foundational (policy) | Maybe | Yes |
| 7 | Bloat and vacuum management (autovacuum, fillfactor, VACUUM ANALYZE) | Advanced | No (config) | Yes |
| 8 | Partition `audit_events` by month and archive old partitions | Advanced | Yes | Yes |
| 9 | Aggregation tables / materialized views for reports | Advanced | Yes | Yes |
| 10 | Schema-level savings and future design decisions | Future | Yes | Yes |

---

## Phase 2 checklist

### Task 1 — Measurement baseline and checkpoints [Foundational]

- [ ] Record the current baseline: total `pg_database_size`, top 10 relations with index bytes, dead tuples, per-index size and scans. SQL below; never read customer document contents while measuring.
- [ ] Confirm the Dashboard org meters are the authoritative numbers; note that database size is per project and does not reset.
- [ ] Adopt the advisory levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** urgent. No automatic alerts, no new monitoring service.
- [ ] Re-run monthly, and after any Task 2/6/7/8 change.

```sql
select pg_database_size(current_database()) as database_bytes;

select schemaname, relname,
       pg_total_relation_size(relid) as total_bytes,
       pg_indexes_size(relid) as index_bytes
from pg_stat_user_tables
where schemaname in ('public', 'private', 'auth', 'storage')
order by total_bytes desc
limit 10;

select schemaname, relname, n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_user_tables
where schemaname in ('public', 'private')
order by n_dead_tup desc
limit 10;

select schemaname, relname, indexrelname,
       pg_relation_size(indexrelid) as index_bytes, idx_scan
from pg_stat_user_indexes
order by index_bytes desc
limit 20;
```

> Note: `idx_scan` resets when statistics reset; treat `idx_scan = 0` as a candidate for review, never as proof by itself.

### Task 2 — Index audit and discipline [Foundational; removals need migration + approval]

- [ ] Enumerate every index (Task 1 SQL) and classify: required (unique constraint backing, FK support, proven filtered query) vs candidate (duplicate, overlapping, subsumed by a composite, never scanned).
- [ ] Run `EXPLAIN` for the actual queries each candidate serves before removing anything.
- [ ] Remove only redundant/overlapping indexes, one idempotent `afhomes_` migration per batch, with validation queries in the header and a down note.
- [ ] Remember the measured fact: `card_sales` is ~91% indexes. Every new index costs storage **and** write overhead; low-selectivity single-column indexes (status, boolean) are almost never worth it without a proven composite query.
- [ ] The proposed seller-document index from `SUPABASE-FREE.md` stays **not applied** unless separately reviewed.

### Task 3 — Audit payload hygiene [Foundational, no migration]

- [ ] Verify every `audit_events` insert writes minimal payloads: IDs, statuses, reasons only. Check the insert sites in `api/_lib/handler-kit.ts`, `api/_lib/afhomes-access.ts`, and the `audit_events` inserts across the migrations.
- [ ] Never duplicate full OCR payloads, review data or base64 content into `before_data`/`after_data`.
- [ ] Never store customer document contents, government ID numbers, tokens, signed URLs or credentials in audit rows.
- [ ] `audit_events` is append-only and the largest relation — treat its write sites as the primary growth surface. Any trimming must be archival (Task 8), never deletion of required history.

### Task 4 — JSONB payload control and OCR storage discipline [Foundational, no migration]

- [ ] `identity_documents.extracted_data` / `reviewed_data` (`20260926023325_afhomes_phase1_foundation.sql:217-218`): store extracted **fields and warnings**, never base64 blobs, never full provider responses.
- [ ] Keep the Phase 1 egress rule here too: list/summary paths never load these columns; only the single-document detail endpoint does.
- [ ] Purge-after-review of OCR intermediate data is a **retention decision** (Task 6), not an automatic behavior. Do not implement deletion in this task.
- [ ] Audit every other `jsonb` column (`address`, `registration_details`, etc.) for duplicated or derived state that could be computed instead of stored.

### Task 5 — Denormalized-column discipline [Foundational, no migration]

- [ ] Apply the Phase 4 lesson from `AGENTS.md`: a denormalized column nobody maintains is worse than none (`memberships.points_balance` was written `0` once and never kept in step, misreporting balances).
- [ ] For every stored copy of a computed value, verify a writer keeps it in step or a trigger/function owns it — otherwise propose removal with owner sign-off.

### Task 6 — Lifecycle cleanup candidates and retention policy [Policy; execution needs approval]

- [ ] Inventory cleanup candidates (no deletions yet): abandoned upload reservations, consumed/expired `customer_onboarding_tokens`, expired `staff_invitations`, OCR intermediate data after review, superseded identity-document rows/objects, import-job payloads, platform operational logs.
- [ ] For each class, define separately: owner, retention window, dependency check, cleanup mechanism (dry run first), audit trail, and what must be kept forever (financial records, ledgers, Super Admin, VIP plans, required audit history).
- [ ] Produce the retention policy document for company approval. **No cleanup runs before written approval**; then run as a dry run → review → approved execution, each with an `audit_events` record.
- [ ] Archiving (if approved) requires access controls, tested retrieval and a restore process — deletion is not archiving.

### Task 7 — Bloat and vacuum management [Advanced; ops, approval]

- [ ] Measure dead tuples and last autovacuum per table (Task 1 SQL). Identify update-heavy tables.
- [ ] Propose, for measured cases only: `fillfactor` below 100 for update-heavy tables (fewer page splits, less bloat), autovacuum scale-factor tuning for hot tables, and periodic `VACUUM (ANALYZE)` after large deletions.
- [ ] Any table rewrite (`VACUUM FULL`, reorg) needs a maintenance-window decision, a before/after size measurement and an approved plan. Never run destructive maintenance unannounced.

### Task 8 — Partition `audit_events` by month and archive old partitions [Advanced; migration + approval]

- [ ] Design: `PARTITION BY RANGE (created_at)` with monthly partitions; new partitions created ahead of time.
- [ ] Archival path for closed partitions: detach → export to approved cheap storage → keep the export reference. **Never delete required audit history.**
- [ ] Deliverables: one forward-only idempotent `afhomes_` migration with validation queries and a down note, correctness tests in the DB suite, an explicit rollback plan, and measured before/after sizes.
- [ ] This does not shrink bytes immediately; it bounds future growth and improves index locality. Revisit only when measurement shows it is warranted.

### Task 9 — Aggregation tables / materialized views for reports [Advanced; migration + approval]

- [ ] Reuse scoped SQL aggregates first (existing example: `public.sale_financial_summary`). Never download historic rows to total them in TypeScript.
- [ ] If a measured report bottleneck remains, propose daily aggregate tables or a materialized view refreshed by a scheduled job — with refresh strategy, correctness tests and a forward-only migration.
- [ ] Money stays exact-decimal; totals stay server-calculated.

### Task 10 — Schema-level savings and future design decisions [Future, not now]

- [ ] Document-only, no changes: money-as-text vs `numeric(12,2)`; random UUID inserts vs sequential `bigint identity` (UUID randomness costs index locality and WAL; changing key types is breaking and must not be done casually); JSON key normalization for large jsonb columns; new wide columns need justification because every column costs per row.
- [ ] Any of these becomes a separate reviewed migration with a measured benefit and an approved plan — never bundled into optimization work.

---

## Priority order (execute in this sequence)

1. **Task 1** — measurement baseline (no risk, informs everything).
2. **Task 2** — index audit; the fastest real savings (indexes dominate current large relations).
3. **Tasks 3–5** — payload hygiene at write sites (code-level, prevents future bloat).
4. **Task 6** — retention/archival policy definition and company approval.
5. **Task 7** — bloat/vacuum tuning for measured hot tables.
6. **Task 8** — `audit_events` partitioning and archival.
7. **Task 9** — report aggregation materialization if measured.
8. **Task 10** — schema redesign decisions, only with measures and approval.

## Verification (run all, in this order)

```sh
corepack pnpm exec turbo run test --force --concurrency=2 -- --maxWorkers=2
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm check:env
git diff --check
```

- New/changed specs: `corepack pnpm --filter api exec vitest run <path> --maxWorkers=2` (same per workspace).
- If any SQL changed: `pnpm test:db:local` and `pnpm test:db:harness`, plus `supabase/security/rls_invariants.sql` (empty = PASS).
- Before/after evidence required for any size claim: `pg_database_size()` and `pg_total_relation_size` of every changed table, measured the same way both times.
- Report raw results. Do not claim a reduction without a measured before/after number.

## Deliverable format for the AI

For each task: files changed, migration names (if any), measured bytes before → after, tests added, and any deviation from this plan with the reason. Mark each checklist item checked or explain why it was skipped. Mark unverified items as unverified — never present estimates as measurements.

## Out of scope for this phase

- No deletions of financial records, audit history or any retained class without written approval.
- No Storage cleanup or image compression (tracked separately); no egress work (Phase 1, `docs/supabase/solutions/EGRESS-SOLUTIONS.md`).
- No quota monitor, no new monitoring service, no MongoDB work, no database abstraction layer.
- No deploy, no production migration, no cron changes without explicit approval.
- No weakening of auth, RLS, column grants or money rules.

## Operator monitoring (manual, monthly)

1. Check the Supabase Dashboard org meters. Dashboard is authoritative; `pg_database_size()` is an estimate.
2. Remember: database size is **per project** and **does not reset** — unlike egress, MAU and logs. It only changes when rows, indexes or bloat change.
3. Advisory levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** urgent.
4. Refresh sizes with the read-only SQL in this file and in `docs/supabase/SUPABASE-FREE.md`, without reading document contents.
5. When the meter approaches its budget: first remove redundant indexes and oversized payloads (Tasks 2–5), then review retention/archival options or obtain company approval for more capacity. Never silently block financial writes or create a workaround project.
