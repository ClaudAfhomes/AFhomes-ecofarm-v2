# AF Homes: Supabase Free capacity and implementation SSOT

Updated: 2026-10-13 (Asia/Singapore). Status: current repository practices and a read-only capacity snapshot; proposed policies are explicitly marked. This file is the single reference for working within the Supabase Free budget. Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Update this document when a quota, query, storage rule or company decision changes; do not create parallel capacity documents.

## Current database and application

- Shared project: `ikaevepedpqygdlipsei` (AF homes), `ap-northeast-1`, PostgreSQL 17.6.1.166; verified `ACTIVE_HEALTHY` through read-only project metadata on the date above.
- React/Vite Admin and public Customer/OST applications use TanStack Query and the typed REST clients. A single Vercel Function routes authorized requests to Supabase Postgres, Auth and private Storage.
- Staff permissions are re-resolved on each API request. Customer authorization uses ownership independently of staff permissions. Supabase service credentials stay on the server.
- Security migration execution and release boundaries remain in `security/SECURITY-CHECKPOINT-A-EXECUTION.md`. This capacity work applies no migrations and changes no live configuration, accounts or business data.
- The requested operating budget is Free. Project metadata alone does not prove organization billing entitlement; verify the actual subscription and meters in the Supabase Dashboard before capacity or release decisions.

## Budget and accounting

| Resource | Free operating budget | How to interpret it |
| --- | --- | --- |
| Uncached egress | 5 GB per billing cycle | Includes database responses and uncached downloads, not just browser JSON. |
| Cached egress | Separate 5 GB per billing cycle | Do not assume private authenticated traffic receives cache hits. |
| Database | 500 MB per project | Rows, indexes and database overhead consume space. |
| Auth users | 50,000 monthly active users | A billing allowance, not a concurrent-user or throughput guarantee. |
| File Storage | 1 GB | Documents, receipts and other objects share capacity. |
| Logs ingestion | 1 GB per billing cycle | Platform logs differ from business `audit_events` stored in Postgres. |
| Logs query | 100 GB included query allowance | Volume scanned while querying logs, not another database capacity allowance. |

Supabase bills most allowances across the organization; database size is per project. Count other projects against organization allowances. Cached and uncached egress have separate meters. Vercel-to-Supabase results consume Supabase egress even when the API strips fields before sending the browser response. Narrow the database projection as well as the HTTP response. Browser compression cannot recover bandwidth already sent by Supabase. [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [egress accounting](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

The current logs documentation describes a grace period through early 2027 and future enforcement. Budget for the allowance now, but do not claim its future degraded-state rules are currently enforced. [Logs query allowance and enforcement](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query), [logs ingestion](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest).

Free capacity is finite. Approaching limits requires an approved storage, retention, plan or platform decision; optimization cannot guarantee unlimited growth. Database-size limits can affect write availability. [Database and disk size](https://supabase.com/docs/guides/platform/database-size).

## Read-only usage snapshot

Measured 2026-10-13 against the project above, without reading customer document contents:

- `pg_database_size(current_database())`: **21,056,659 bytes**, approximately 21.06 MB (20.08 MiB). This SQL measurement is an operational estimate; the Dashboard billing meter is authoritative.
- `storage.objects`: **0 recorded objects**, **0 known object bytes** from object size metadata. This is a metadata snapshot, not a billing meter or guarantee about orphaned object bytes.
- Largest application relation measured: `audit_events`, 368,640 bytes including indexes. Index allocations are already material: `card_sales` totals 270,336 bytes, with 245,760 bytes of indexes. Do not add indexes indiscriminately.
- Current billing-cycle egress, MAU, log ingestion and log-query meters: **not verified**. No representative live concurrency benchmark was run. Low current size does not prove performance under future load.

Refresh sizes using read-only SQL, and check the organization Dashboard for bandwidth, users, logs and actual Storage usage:

```sql
select pg_database_size(current_database()) as database_bytes;

select schemaname, relname,
       pg_total_relation_size(relid) as total_bytes,
       pg_indexes_size(relid) as index_bytes
from pg_stat_user_tables
where schemaname in ('public', 'private', 'auth', 'storage')
order by total_bytes desc
limit 10;

select count(*) as recorded_objects,
       coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$'
         then (metadata->>'size')::bigint else 0 end), 0) as known_object_bytes
from storage.objects;
```

## Query and backend rules

1. Authorize before reading; preserve seller/customer ownership, column denials, RLS, masked government IDs and private buckets. Performance never justifies caching stale staff permissions or exposing raw documents.
2. Filter in SQL/PostgREST and select only columns consumed by the read model. Avoid `select('*')` on queues when wide OCR/JSON data is unnecessary. Detailed review endpoints may legitimately require those fields, but never expose storage paths or hashes.
3. Bound list pages and use stable ordering with an ID tiebreaker. Return pagination metadata and provide navigation instead of silently displaying the first page forever. Prefer cursor pagination for demonstrated deep-history workloads; existing offset contracts stay compatible until a measured change is reviewed.
4. Batch relation lookups. The document current-ID query returns at most one eligible child per parent, independent of the displayed history page. Preserve this rule when changing projections or limits.
5. Aggregates belong in scoped database queries when a measured report bottleneck warrants them. Do not repeatedly download every historic sale/payment just to total them in JavaScript. Such changes need representative plans, correctness tests and approved forward-only migrations where necessary.
6. Add or remove an index only after checking the actual filtered query, overlap, representative plans, storage cost and write overhead. The proposed seller-document index is **not applied by this work**.
7. Preserve exact-decimal money, server-calculated totals, verified-payment gates, row locking, idempotency and immutable sale snapshots. A faster read must return the same authorized truth.
8. Bound requests, preserve cancellation, and avoid mutation retries after uncertain outcomes. Aborting a client request does not roll back a transaction that the server already committed. Check persisted state before repeating payments or other changes.

## Implemented request improvements in this local change

- Admin and Customer typed JSON clients share a **60-second deadline** covering session resolution, a permitted 401 refresh, network fetch and response-body consumption. A stalled request reaches a recoverable error instead of loading forever. This does not claim that all direct Auth or binary-upload operations are bounded.
- Caller cancellation propagates to fetch. Late session resolution after cancellation cannot send a new request. Timeout alone does not clear the session or replay a mutation; the existing single 401 recovery remains.
- `/documents?view=summary` explicitly selects metadata without `extracted_data` or `reviewed_data`; the response omits OCR suggestions, review fields and warnings. Default `view=detail`, single-document and current-document reads retain their established detailed contracts.
- Current-ID lookups for lists and current-ID checks fetch only eligibility columns, not OCR payloads. The explicit current-document endpoint still requests the full row for review.
- The ID Documents queue consumes the summary contract, requests **25 rows per page**, exposes existing pagination controls, and passes TanStack Query's cancellation signal to the request. Existing detailed callers remain compatible.

Both smaller projections and smaller pages reduce bytes transferred. They do not create additional database or file capacity. Verification and measured limits are recorded below; these changes are local until separately released.

## Existing cache and freshness practices

- Reuse TanStack Query's existing 30-second default freshness and request deduplication; invalidate affected queries after successful mutations. Logout clears private cached data.
- Polling is for active operational views. TanStack Query normally stops interval polling in background tabs unless explicitly opted in; do not enable background polling without a demonstrated need. Existing operational intervals remain unchanged in this change.
- Pass query cancellation signals through services as screens are improved. The document queue is updated here; other existing services are not claimed to consume signals.
- Do not use shared/CDN caches for private financial, permission or identity responses. Authorized private downloads remain short-lived signed URLs and are requested only when needed.
- Do not add Redis, Realtime subscriptions, cache databases or permanent request-by-request telemetry solely to fit the Free plan.

## File and database growth policy

Existing behavior: identity uploads accept JPEG, PNG and PDF up to 10 MiB, verify actual bytes server-side, and use private buckets. Replacing an identity document creates history; it does not delete the old record or object. At roughly 2 MB per file, 1 GB supports only about 500 files before other objects and overhead. This is illustrative decimal arithmetic, not a user-capacity commitment.

Proposed next controls, **not implemented or company-approved by this change**:

- Compress/downscale suitable image scans before upload only with a readable preview and tests protecting OCR/identity legibility. Do not blindly recompress PDFs, discard pages or impose a lower limit that blocks valid onboarding.
- Define retention separately for abandoned upload reservations, OCR intermediate data, superseded files and platform operational logs. Any cleanup needs ownership checks, dependency checks, auditability, a dry run and explicit approval.
- Keep financial records, ledgers, Super Admin, VIP plans and required audit history. Never delete them to reclaim quota. Archiving needs an approved retention policy, access controls, tested retrieval and a restore process.
- Avoid base64 files in database JSON and avoid duplicating full OCR payloads into audit events. Keep file bytes in Storage and necessary metadata in Postgres.
- Reduce noisy application logs while keeping actionable failures and business audit events. Never log tokens, signed URLs, credentials, ID numbers or complete document payloads. Narrow diagnostic log queries by time/service/error instead of polling broad history.

## Capacity checkpoints and release discipline

Proposed manual warning levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** treat exhaustion risk as urgent. These are operating recommendations, not automatic application alerts or enforced write blocks. Start with the Dashboard; no new monitoring service is introduced.

Estimate monthly bandwidth from response bytes × reads plus file bytes × downloads, Auth and other traffic. For example, 100 KB × 50,000 reads is approximately 5 GB. One 100 KB feed polled every 15 seconds for 8 hours/day across 22 days produces about 4.22 GB for one continuously active screen. These are illustrative uncached workloads, not observed usage.

When a meter approaches its budget, first remove unnecessary reads and oversized projections, then review storage/retention or obtain company approval for additional capacity. Do not silently block financial writes, weaken authentication or create another Supabase project as a quota workaround. Preserve normal recovery and clear service errors when the provider is unavailable.

Release application changes through normal review, local tests and controlled Preview validation. Apply any approved prerequisite migration before dependent APIs. This change requires no new SQL migration. Do not push, deploy, change Auth settings, enable MFA or mutate shared data as part of this document's maintenance.

## Verification

Verification is local unless explicitly stated otherwise. The read-only project and size snapshot above is live. Tests cover the actual document handler and typed API clients using synthetic fixtures; they are not managed Auth/Storage or live-latency benchmarks.

| Check (2026-10-13) | Result |
| --- | --- |
| `corepack pnpm exec turbo run test --force --concurrency=2 -- --maxWorkers=2` | PASS: 3,611 tests across seven test workspaces; no cache replay. |
| `corepack pnpm --filter api exec vitest run _handlers/phase12-documents.spec.ts --maxWorkers=2` | PASS: 50 checks after tightening the before/after payload comparison. |
| `corepack pnpm typecheck` | PASS, including root Supabase script type checking; unaffected package caches reused. |
| `corepack pnpm lint` | PASS: no errors; existing React Refresh warnings remain. |
| `corepack pnpm build` | PASS: both applications rebuilt; existing bundle-size warnings remain. |
| `corepack pnpm check:env` | PASS: browser/server environment isolation. |
| `git diff --check` | PASS. |

The synthetic document test compares the **same one-document list** through default detail and explicit summary modes. The fixture contains approximately 20 KB of extracted field text and 20 KB of reviewed field text. Its summary response is **less than 5% of the detailed list's UTF-8 byte size**, a reduction greater than 95%. Assertions also inspect the actual emitted database projections to reject wildcard/OCR/review selections on the summary path. This is reproducible payload evidence, not a representative production latency benchmark or a guarantee of 95% savings on ordinary records.

Regression coverage includes seller ownership/cross-owner denial, preserved detailed reads, current-document selection across history pages, 25-row queue pagination, session/network/body timeouts, caller cancellation, successful deadline cleanup, late refresh completion, and existing authentication/security tests. No application mutations are automatically replayed after a timeout.

Still unverified: live authenticated Preview UI, deployed request latency, representative concurrent load, actual billing-cycle egress/log meters and total monthly savings. This change performs no new SQL migration, Storage cleanup, quota monitor, image compression or MongoDB implementation. On 2026-10-13 the user authorized committing and pushing this implementation to `claud/develop` for Vercel Preview; verify the resulting commit and deployment through Git/Vercel. Production promotion remains outside this release. A client timeout cannot prove whether a server-side mutation committed; inspect saved state before repeating it.

## Public AA verification (local implementation, not deployed)

`/sale-team-search` submits an exact AA lookup through `/sale-team/search`; no directory, substring search, autocomplete or polling. One unique AA index narrows the database lookup, and one service-only RPC returns only the approved public name, IST/OST classification, AA number, current status and validity dates. Public searches return only currently accredited records. Responses use `Cache-Control: no-store` so new lookups observe revocation; searches do not append business audit rows or store per-search counters in Postgres.

AA records and the generator stay private with RLS and no browser grants. Issuance generates 12 cryptographically random characters containing exactly six uppercase letters and six digits (after the AA- prefix), protected by a unique constraint and bounded collision retries, with approval/revocation audit events. AA numbers survive renewal. Self-service name edits do not change the approved public name. Existing accounts receive no automatic AA backfill. IST approval covers only VD/SSM/SM, by Admin/Super Admin with effective `organization.staff:update`; OST AA issuance requires effective `network.ost_registrations:update` and approved OST terms. New approved OST accounts receive their AA during invitation, but public verification remains blocked until account activation. Number generation is centralized for the future company format.

Release order: separately approve and apply only `20261130000001_afhomes_sale_team_accreditation.sql` after verifying the existing OST workflow and `20261129000002_afhomes_staff_business_security.sql`, then deploy the dependent API and apps. This feature does not authorize other pending migrations. Rollback disables the feature/API, retaining issued identifiers and audit history; never renumber issued AA records or weaken grants. Repeatable local proof: `node packages/db-testing/scripts/test-sale-team.mjs` boots disposable PostgreSQL and checks issuance, concurrency, ownership boundaries, renewal, expiry/revocation and browser ACL denial.

Residual public risk: random AA numbers are public identifiers, not authentication credentials. The existing 30-search/minute IP limiter is per server instance, resets on cold starts and is not a distributed quota control. Verify platform edge throttling separately before broad public rollout; do not claim the in-process limiter prevents distributed scraping. Managed Auth/PostgREST acceptance and deployed latency remain unverified until a separately authorized release.

## Company direction: Supabase and possible MongoDB version 2

Per the company context supplied by the user, the company originally uses MongoDB. The initial direction is to keep version 1 running on Supabase while preparing a possible version 2 using MongoDB. Supabase may therefore be temporary or permanent, depending on company rules and the final approved architecture decision. **No database replacement or cutover is approved or performed by this document.** Repository names containing `v2` do not establish which business release the company calls version 1 or version 2.

Until that decision, Supabase is the authoritative persistence layer for this implementation. Keep shared contracts, effective permissions, exact money, ownership and frozen history explicit so a later implementation can reproduce them. MongoDB does not automatically replace Supabase Auth, private Storage, PostgreSQL transactions, SQL RPCs or RLS: those responsibilities need deliberate equivalents. Avoid adding speculative dual writes or a database abstraction layer now.

A future migration requires a reviewed mapping, preservation of identifiers/history/financial integrity, authorization equivalence, Auth and file strategy, verified export/import and reconciliation, rollback, and a controlled cutover. Keep one authoritative writer through cutover. Company approval determines whether that version proceeds or Supabase remains permanent.
