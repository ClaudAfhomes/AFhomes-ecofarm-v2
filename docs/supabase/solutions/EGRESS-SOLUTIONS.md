# AF Homes: Supabase solutions — Phase 1 (Egress and bandwidth reduction)

Updated: 2026-10-14 (Asia/Singapore). Status: implementation plan — **not yet implemented**. This document turns the Free-plan capacity rules in `docs/supabase/SUPABASE-FREE.md` into concrete, AI-executable work. `docs/supabase/SUPABASE-FREE.md` remains the single reference for quota and accounting; repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Do not create parallel capacity documents — Phase 1 (egress) lives here, Phase 2 (database size) lives in `docs/supabase/solutions/DATABASE-SOLUTIONS.md`, Phase 3 (MAU) lives in `docs/supabase/solutions/MAU-SOLUTIONS.md`, Phase 4 (storage + public URL media) lives in `docs/supabase/solutions/STORAGE-SOLUTIONS.md`, Phase 5 (log ingestion) lives in `docs/supabase/solutions/LOG-SOLUTIONS.md`, Phase 6 (log query) lives in `docs/supabase/solutions/LOG-QUERY-SOLUTIONS.md`, and the quota SSOT is `docs/supabase/SUPABASE-FREE.md`; update these files as phases ship.

> **Instruction to the implementing AI:** execute the phases below in order. Each phase is independently reviewable and releasable. Never combine two phases in one commit when a phase touches authorization, money or contracts. For every phase: run the full command set in "Verification" before claiming completion, and report evidence (command output), not intentions.

## Phase 1 goal

Reduce uncached egress (Free plan: **5 GB per billing cycle**) without changing any business behavior, authorization decision, money figure or contract that a caller legitimately needs. The measured lever is **bytes Supabase sends out per request × number of requests × polling frequency**.

Read this first: `docs/supabase/SUPABASE-FREE.md` — budget table, read-only snapshot, query/backend rules and implemented improvements. Everything below builds on rules already stated there; it does not replace them.

## What egress is (context the AI must assume)

* Egress = every byte that leaves Supabase: database responses to the Vercel Function, file downloads from private buckets, Auth traffic.
* **Vercel-to-Supabase traffic counts even when the API strips fields before the browser response.** Narrow the database projection, not only the HTTP JSON.
* Cached and uncached egress are separate 5 GB meters. Private authenticated traffic must be assumed **uncached**.
* The meter resets **monthly per billing cycle** (org-wide, shared with any other projects in the org). The Dashboard meter is authoritative; `pg_database_size()` and this document are estimates.
* Egress done is done: cancelling a client request does not un-send bytes the server already read from Postgres.

## Non-negotiable guardrails (do not violate in any phase)

1. Authorize before reading. Preserve seller/customer ownership, RLS, column-level grants, masked government IDs and private buckets. Performance never justifies caching stale staff permissions or exposing raw documents.
2. Never weaken security (RLS policies, column grants, `has_permission`, ownership checks) to reduce bytes.
3. Never delete financial records, ledgers, Super Admin data, VIP plans or required audit history to reclaim quota.
4. Never silently block financial writes; never create a second Supabase project as a quota workaround.
5. No shared/CDN caching of private financial, permission or identity responses.
6. Do not add Redis, Realtime subscriptions, cache databases or per-request telemetry solely to fit the Free plan.
7. Preserve exact-decimal money, server-calculated totals, verified-payment gates, row locking, idempotency and immutable sale snapshots. A faster read must return the same authorized truth.
8. Bound requests, preserve cancellation, and never auto-retry a mutation after an uncertain outcome.
9. No new SQL migration unless a phase explicitly requires one and it was reviewed. Phase 1 requires **no** migration.
10. Do not inspect, log or transmit raw customer document contents, tokens, signed URLs, credentials, ID numbers or full payloads.

---

## Phase 1 checklist

### Task 1 — Projection audit and narrowing (highest ROI)

Scan every handler under `api/_handlers/**` and `api/_lib/**` for `.select('*')` and wide JSON selections on queues and list endpoints.

- [ ] Enumerate all list/queue endpoints and record for each: current projection, columns actually consumed by the read model, and the delta.
- [ ] Replace `select('*')` with explicit column lists. Exclude `extracted_data` and `reviewed_data` (OCR/review JSON) from every list and summary path; they are only legitimate on the single-document detail endpoint.
- [ ] Follow the existing pattern in `api/_handlers/documents.ts` (`view=summary` excludes `extracted_data`/`reviewed_data`; the summary response is measured at <5% of the detailed payload in `api/_handlers/phase12-documents.spec.ts`). Reuse rather than reinvent it.
- [ ] Keep default `view=detail` contracts unchanged for existing callers.
- [ ] For each narrowed endpoint, add a spec assertion that inspects the emitted projection and rejects wildcard/OCR/review selections on the summary path (same style as the existing document tests).
- [ ] Never expose storage paths or hashes in any narrowed projection.

### Task 2 — Pagination and list bounds

- [ ] Every list endpoint returns a bounded page (existing convention: 25 rows for the ID Documents queue) with a stable order and an ID tiebreaker, plus pagination metadata.
- [ ] Enforce a server-side maximum page size so a client cannot request an unbounded page.
- [ ] Ensure UIs surface pagination controls instead of silently showing the first page forever.
- [ ] Keep offset contracts compatible until a measured deep-history workload justifies cursor pagination; that change needs review.

### Task 3 — Aggregates in SQL, not in JavaScript

- [ ] Find any flow that downloads historic rows (sales, payments, points) only to total them in TypeScript.
- [ ] Replace with a scoped database aggregate (existing example: `public.sale_financial_summary`). Do not repeatedly download every historic row for a dashboard number.
- [ ] Only if a new function is unavoidable: one idempotent `afhomes_`-prefixed migration, forward-only, with validation queries in the header, plus correctness tests. Otherwise prefer existing scoped queries.
- [ ] Money stays exact-decimal; totals stay server-calculated.

### Task 4 — Relation lookups stay batched

- [ ] The document current-ID query returns at most one eligible child per parent regardless of displayed history page. Preserve this when changing projections or limits.
- [ ] Audit other relation lookups for N+1 patterns and batch them.

### Task 5 — Client polling and cache hygiene

- [ ] Audit every `refetchInterval` in `apps/admin` and `apps/web`. Polling is only for active operational views; no background polling unless TanStack Query already pauses it in background tabs.
- [ ] Keep the established conservative intervals (5s import jobs; 15s finance/activation/history/member-lookup; 30s reports/audit/OST/applications/commissions/memberships/customer points) unless a measured reason justifies a change — then document the measurement.
- [ ] Confirm the 30-second default freshness and request deduplication are in effect; do not lower freshness globally.
- [ ] Mutations invalidate only affected queries (matching key scopes), never the whole cache except on logout.
- [ ] Logout continues to clear the whole QueryClient in both apps.

### Task 6 — Cancellation and deadlines

- [ ] The typed clients (`apps/*/src/lib/api/client.ts`) already implement a 60-second deadline and caller cancellation. Extend `signal` propagation to remaining services that do not yet consume it (the ID Documents queue is done; do not claim others without checking).
- [ ] Ensure a late session resolution after cancellation cannot send a new request.
- [ ] Do not clear sessions or replay mutations on timeout; a client timeout cannot prove a server mutation did not commit — inspect persisted state before repeating.

### Task 7 — Storage download discipline (egress + 1 GB storage meter)

- [ ] Signed URLs stay short-lived and are requested only when a download/view actually happens; never preload or bulk-fetch.
- [ ] No base64 files in database JSON anywhere; file bytes live in Storage, metadata in Postgres.
- [ ] Treat image compression/downscale as **not approved**: it may only proceed with a readable preview and tests protecting OCR/identity legibility, and never blocks valid onboarding. If proposed, mark it as a separate phase.

### Task 8 — Log noise and audit payload hygiene

- [ ] Keep application logs actionable: failures and business audit events only. Reduce noisy per-request chatter.
- [ ] Never log tokens, signed URLs, credentials, ID numbers or complete document payloads.
- [ ] Ensure `audit_events` payloads (`before_data`/`after_data`) stay minimal — IDs, statuses, reasons — and never duplicate full OCR payloads or base64 content. Check the insert sites in `api/_lib/handler-kit.ts`, `api/_lib/afhomes-access.ts`, and the `audit_events` inserts in the migrations.
- [ ] Narrow diagnostic log queries by time/service/error as an operator habit; do not poll broad log history. (Platform logs are a separate 1 GB ingestion / 100 GB query meter — application logging changes only help; `audit_events` count against database size, not log ingestion.)

### Task 9 — Measurement and reporting (no new tooling)

- [ ] Record before/after UTF-8 byte sizes for each narrowed endpoint using synthetic fixtures (pattern: the summary-vs-detail comparison in `api/_handlers/phase12-documents.spec.ts`).
- [ ] Produce a per-endpoint table in the final report: projection delta, measured byte reduction on the fixture, expected reads per day, estimated monthly saving.
- [ ] Include the read-only SQL from `docs/supabase/SUPABASE-FREE.md` for database size, top relations and storage objects, plus a note that the Dashboard is authoritative for egress, MAU, logs and storage meters.
- [ ] Do not build a quota monitor, background alert job or new telemetry service.

---

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
- Report raw results. Do not claim a reduction without a measured before/after number.

## Deliverable format for the AI

For each task: files changed, projection/behavior delta, test names added, measured bytes (before → after), and any deviation from this plan with the reason. Mark each checklist item checked or explain why it was skipped. Mark unverified items as unverified — never present estimates as measurements.

## Out of scope for this phase 1

- No SQL migration, no Storage cleanup, no quota monitor, no image compression, no retention deletion, no MongoDB work, no database abstraction layer.
- No deploy, no production migration, no cron changes without explicit approval.
- No weakening of auth, RLS, column grants or money rules.

## Operator monitoring (manual, monthly)

1. Check the Supabase Dashboard org meters — egress (cached vs uncached), MAU, log ingestion, log query, storage. Dashboard is authoritative.
2. Confirm the billing-cycle reset date; egress resets **monthly per cycle**, not daily or weekly. Database size and Storage **do not reset** — they only change when rows/objects change.
3. Advisory levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** urgent. Start with the Dashboard; no new monitoring service.
4. Refresh sizes with the read-only SQL in `docs/supabase/SUPABASE-FREE.md` (database size, top 10 relations, storage objects) without reading document contents.
5. When a meter approaches its budget: first remove unnecessary reads and oversized projections (this phase), then review storage/retention options or obtain company approval for more capacity. Never silently block financial writes or create a workaround project.
